const WppSessionManager = require("./wppSessionManager");
const fs = require("fs");

class WhatsAppController {
  constructor() {
    this.wppManager = new WppSessionManager();
  }

  // ═══════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Applies optional pagination to a messages/chats array.
   */
  _paginate(items, pageParam, limitParam) {
    const total = items.length;
    if (!pageParam && !limitParam) {
      return { items, total, page: null, limit: null, totalPages: null };
    }
    const page = Math.max(1, parseInt(pageParam, 10) || 1);
    const limit = Math.max(1, parseInt(limitParam, 10) || 20);
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;

    return {
      items: items.slice(start, start + limit),
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Maps a WPPConnect message object to the existing route schema.
   */
  _mapMessage(msg) {
    let status = null;
    if (msg.ack === 1) status = "sent";
    else if (msg.ack === 2) status = "delivered";
    else if (msg.ack === 3 || msg.ack === 4) status = "read";

    let type = msg.type;
    if (type === "chat") type = "text";
    else if (type === "ptt") type = "audio";

    // Format time from UNIX timestamp
    const date = new Date(msg.t * 1000);
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return {
      messageId: msg.id._serialized || msg.id,
      type,
      text: msg.body || null,
      mediaThumbnail: msg.body && msg.isMedia ? `data:image/jpeg;base64,${msg.body}` : null,
      isMediaDownloaded: false,
      downloadButtonAvailable: msg.isMedia ? true : false,
      sender: msg.fromMe ? "me" : msg.from,
      time,
      isFromMe: msg.fromMe,
      status,
      timestamp: msg.t
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Route Handlers
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/whatsapp/profile
   */
  async getProfile(req, res, next) {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ success: false, message: "User ID required" });

      const client = await this.wppManager.getClient(userId);
      const sessionStatus = await this.wppManager.getStatus(userId);

      if (!sessionStatus.loggedIn) {
        return res.status(401).json({ success: false, loggedIn: false, message: "Not logged in. Authenticate first via /status." });
      }

      console.log(`[WhatsApp] getProfile — user ${userId}`);

      const host = await client.getHostDevice();
      const meWid = host.wid ? host.wid._serialized : null;
      let avatar = null;
      
      if (meWid) {
        try {
          avatar = await client.getProfilePicFromServer(meWid);
        } catch (e) {
          console.error("Failed to fetch profile pic", e.message);
        }
      }

      const profile = {
        name: host.pushname || "Unknown",
        phone: host.phone || (meWid ? meWid.split("@")[0] : null),
        about: host.status || "Hey there! I am using WhatsApp.",
        avatar: avatar || null
      };

      return res.json({ success: true, profile });
    } catch (error) {
      console.error("========== ERROR ==========");
      console.error(error);
      return next(error);
    }
  }

  /**
   * GET /api/v1/whatsapp/status
   */
  async getStatus(req, res, next) {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ success: false, message: "User ID required" });

      console.log(`[WhatsApp] getStatus — user ${userId}`);

      // Don't wait for getClient to finish if it's scanning QR
      const state = await this.wppManager.getStatus(userId);

      if (state.loggedIn) {
        return res.json({ success: true, loggedIn: true });
      }

      if (state.status === "qr" && state.qrCode) {
        return res.json({
          success: true,
          loggedIn: false,
          qrCode: state.qrCode,
          message: "Scan the QR code with your WhatsApp mobile app to link this device.",
        });
      }

      if (state.status === "initializing") {
        return res.status(202).json({ success: false, message: "WhatsApp is initializing in the background. Please wait a few seconds and try again." });
      }

      return res.status(408).json({ success: false, message: "Waiting for QR Code. Please try again." });
    } catch (error) {
      console.error("========== ERROR ==========");
      console.error(error);
      return next(error);
    }
  }

  /**
   * GET /api/v1/whatsapp/chats?page=1&limit=20
   */
  async getChats(req, res, next) {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ success: false, message: "User ID required" });

      const pageParam = parseInt(req.query.page || "1", 10);
      const limitParam = parseInt(req.query.limit || "20", 10);

      const client = await this.wppManager.getClient(userId);
      const wppChats = await client.getAllChats();

      console.log(`[WhatsApp] getChats — user ${userId}, found ${wppChats.length} chats`);

      // Map WPPConnect chat array to expected schema
      const mappedChats = wppChats.map((chat, idx) => {
        return {
          chatId: chat.id._serialized,
          name: chat.name || chat.formattedTitle || chat.id.user,
          avatar: chat.contact?.profilePicThumbObj?.eurl || null,
          time: chat.t ? new Date(chat.t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
          lastMessage: chat.lastReceivedKey ? "Message..." : null, // wppconnect doesn't always populate last message body
          unreadCount: chat.unreadCount || 0,
          selected: false,
          index: idx
        };
      });

      const { items: chats, total } = this._paginate(mappedChats, pageParam, limitParam);

      return res.json({
        success: true,
        page: pageParam,
        limit: limitParam,
        total,
        selectedChat: null,
        chats,
      });
    } catch (error) {
      console.error("========== ERROR ==========");
      console.error(error);
      return next(error);
    }
  }

  /**
   * POST /api/v1/whatsapp/open-chat
   */
  async openChat(req, res, next) {
    try {
      const userId = req.userId;
      const { chatId, chatName } = req.body || {};
      const targetChatId = chatId || chatName;

      if (!userId) return res.status(401).json({ success: false, message: "User ID required" });
      if (!targetChatId) return res.status(400).json({ success: false, message: '"chatId" is required' });

      console.log(`[WhatsApp] openChat — user ${userId}, chatId "${targetChatId}"`);

      const client = await this.wppManager.getClient(userId);

      // WPPConnect fetches messages natively
      const wppMessages = await client.getMessages(targetChatId, { count: 20 });
      const mappedMessages = wppMessages.map(msg => this._mapMessage(msg));

      // Determine if there are more messages (if we got exactly 20, assume true)
      const hasMoreMessages = mappedMessages.length >= 20;

      return res.json({
        success: true,
        chatId: targetChatId,
        hasMoreMessages,
        messages: mappedMessages,
      });
    } catch (error) {
      console.error("========== ERROR ==========");
      console.error(error);
      return next(error);
    }
  }

  /**
   * GET /api/v1/whatsapp/messages
   */
  async getMessages(req, res, next) {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ success: false, message: "User ID required" });
      
      return res.status(400).json({ success: false, message: "Use /open-chat to get messages for a specific chat." });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/v1/whatsapp/load-more-messages
   */
  async loadMoreMessages(req, res, next) {
    try {
      const userId = req.userId;
      const { chatId, lastMessageId } = req.body || {};

      if (!userId) return res.status(401).json({ success: false, message: "User ID required" });
      if (!chatId) return res.status(400).json({ success: false, message: "chatId is required" });

      console.log(`[WhatsApp] loadMoreMessages — user ${userId}, chat ${chatId}`);

      const client = await this.wppManager.getClient(userId);
      let fetchOptions = { count: 20, direction: 'before' };
      if (lastMessageId) {
        fetchOptions.id = lastMessageId;
      }

      const wppMessages = await client.getMessages(chatId, fetchOptions);
      const mappedMessages = wppMessages.map(msg => this._mapMessage(msg));

      const hasMoreMessages = mappedMessages.length >= 20;

      return res.json({
        success: true,
        hasMoreMessages,
        messages: mappedMessages,
      });
    } catch (error) {
      console.error("========== ERROR ==========");
      console.error(error);
      return next(error);
    }
  }

  /**
   * POST /api/v1/whatsapp/download-message
   */
  async downloadMessage(req, res, next) {
    // Falls back to getMediaData
    return this.getMediaData(req, res, next);
  }

  /**
   * POST /api/v1/whatsapp/get-media-data
   */
  async getMediaData(req, res, next) {
    try {
      const userId = req.userId;
      const { messageId } = req.body || {};

      if (!userId) return res.status(401).json({ success: false, message: "User ID required" });
      if (!messageId) return res.status(400).json({ success: false, message: "messageId is required" });

      console.log(`[WhatsApp] getMediaData — user ${userId}, messageId ${messageId}`);

      const client = await this.wppManager.getClient(userId);
      
      // downloadMedia automatically decrypts the media and returns a base64 string
      const base64Data = await client.downloadMedia(messageId);
      
      if (!base64Data) {
        return res.status(404).json({ success: false, message: "Media not found or download failed" });
      }

      return res.json({
        success: true,
        messageId,
        mediaData: base64Data, // Data URI: "data:image/jpeg;base64,..."
      });
    } catch (error) {
      console.error("========== ERROR ==========");
      console.error(error);
      return next(error);
    }
  }

  /**
   * GET /api/v1/whatsapp/qr-refresh
   */
  async refreshQr(req, res, next) {
    // wppconnect automatically refreshes QR internally and triggers catchQR.
    // We just return the status.
    return this.getStatus(req, res, next);
  }

  /**
   * POST /api/v1/whatsapp/logout
   */
  async logout(req, res, next) {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ success: false, message: "User ID required" });

      const forceLogout = req.body?.forceLogout === true;
      console.log(`[WhatsApp] logout — user ${userId}, force=${forceLogout}`);

      await this.wppManager.logout(userId, forceLogout);

      return res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      console.error("========== ERROR ==========");
      console.error(error);
      return next(error);
    }
  }
}

module.exports = WhatsAppController;
