const asyncHandler = require("express-async-handler");
const axios = require("axios");
const FormData = require("form-data");
const { BOT_TOKEN, CHAT_ID, } = require("./telegramConfig");
const {
  getFileInfo,
  makeApiRequest,
  makeApiRequestForm,
  getChat,
  getUpdates,
  sendMessage,
} = require("./telegramApi");
const FileService = require("../fileService");

// MIME type mapping
const mimeMap = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

// Get MIME type from extension
function getMimeType(ext) {
  ext = ext.toLowerCase();
  return mimeMap[ext] || "application/octet-stream";
}

// Resolve upload file name using body-provided file_name when available
function resolveUploadFileName(requestedName, originalName) {
  if (!requestedName) {
    return originalName;
  }

  requestedName = String(requestedName).trim();
  if (!requestedName) {
    return originalName;
  }

  const hasExtension = /\.[^./\\]+$/.test(requestedName);
  if (hasExtension || !originalName) {
    return requestedName;
  }

  const originalExtension = originalName.includes(".")
    ? originalName.substring(originalName.lastIndexOf("."))
    : "";
  return `${requestedName}${originalExtension}`;
}

// Build proxy URL for file download
function buildProxyUrl(fileId, filePath, fileName) {
  return `/files-v2?fileId=${encodeURIComponent(fileId)}${fileName ? `&name=${encodeURIComponent(fileName)}` : ""}&path=${encodeURIComponent(filePath)}`;
}

// Extract file extension from a filename or URL
function getFileExtension(fileNameOrUrl) {
  if (!fileNameOrUrl) return null;
  const match = String(fileNameOrUrl)
    .toLowerCase()
    .match(/\.([^./\\?#]+)(?:[/\\?#]|$)/);
  return match ? match[1] : null;
}

// Decide whether to send the file as a document to preserve original image format
function shouldSendAsDocument(extension) {
  return ["png", "webp", "gif"].includes(extension);
}

// Upload photo to Telegram
async function uploadPhotoToTelegram(
  chatId,
  fileData,
  fileName,
  caption,
  parseMode,
) {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("photo", fileData, fileName);

  if (caption) formData.append("caption", caption);
  if (parseMode) formData.append("parse_mode", parseMode);

  const response = await makeApiRequestForm("sendPhoto", formData);
  if (!response.ok) {
    throw new Error(`Upload Photo Error: ${response.description || response}`);
  }
  return response;
}

// Upload photo from URL to Telegram
async function uploadPhotoFromUrl(chatId, photoUrl, caption, parseMode) {
  const params = {
    chat_id: chatId,
    photo: photoUrl,
  };

  if (caption) params.caption = caption;
  if (parseMode) params.parse_mode = parseMode;

  const response = await makeApiRequest("sendPhoto", params);
  if (!response.ok) {
    throw new Error(`Telegram API Error: ${response.description}`);
  }
  return response;
}

// Upload video to Telegram
async function uploadVideoToTelegram(
  chatId,
  fileData,
  fileName,
  caption,
  parseMode,
) {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("video", fileData, fileName);

  if (caption) formData.append("caption", caption);
  if (parseMode) formData.append("parse_mode", parseMode);

  const response = await makeApiRequestForm("sendVideo", formData);
  if (!response.ok) {
    throw new Error(`Upload Video Error: ${response.description || response}`);
  }
  return response;
}

// Upload video from URL to Telegram
async function uploadVideoFromUrl(chatId, videoUrl, caption, parseMode) {
  const params = {
    chat_id: chatId,
    video: videoUrl,
  };

  if (caption) params.caption = caption;
  if (parseMode) params.parse_mode = parseMode;

  const response = await makeApiRequest("sendVideo", params);
  if (!response.ok) {
    throw new Error(`Telegram API Error: ${response.description}`);
  }
  return response;
}

// Upload document to Telegram
async function uploadDocumentToTelegram(
  chatId,
  fileData,
  fileName,
  caption,
  parseMode,
) {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("document", fileData, fileName);

  if (caption) formData.append("caption", caption);
  if (parseMode) formData.append("parse_mode", parseMode);

  const response = await makeApiRequestForm("sendDocument", formData);
  if (!response.ok) {
    throw new Error(
      `Upload Document Error: ${response.description || response}`,
    );
  }
  return response;
}

// Upload document from URL to Telegram
async function uploadDocumentFromUrl(chatId, documentUrl, caption, parseMode) {
  const params = {
    chat_id: chatId,
    document: documentUrl,
  };

  if (caption) params.caption = caption;
  if (parseMode) params.parse_mode = parseMode;

  const response = await makeApiRequest("sendDocument", params);
  if (!response.ok) {
    throw new Error(`Telegram API Error: ${response.description}`);
  }
  return response;
}

// Upload photo route handler
exports.uploadPhoto = asyncHandler(async (req, res) => {
  const contentType = req.headers["content-type"] || "";

  let chatId;
  let photoNetworkUrl = null;
  let caption = null;
  let parseMode = null;
  let fileData = null;
  let fileName = null;

  let id = null;
  let category = null;
  let entityId = null;
  let withDatabase = false;

  // Parse request based on content type
  if (contentType.includes("multipart/form-data")) {
    const formData = req.body; // multer would have parsed this
    chatId = formData.chat_id || CHAT_ID;
    caption = formData.caption;
    parseMode = formData.parse_mode;
    id = formData.id;
    category = formData.category;
    entityId = formData.entityId;
    withDatabase = String(formData.withDatabase).toLowerCase() === "true";
    const requestedFileName =
      formData.file_name || formData.fileName || formData.name;

    if (req.file) {
      fileData = req.file.buffer;
      fileName = resolveUploadFileName(
        requestedFileName,
        req.file.originalname,
      );
    }
  } else {
    const { body } = req;
    chatId = body.chatId || body.chat_id || CHAT_ID;
    photoNetworkUrl = body.photoNetworkUrl || body.photo;
    caption = body.caption;
    parseMode = body.parseMode || body.parse_mode;
    id = body.id;
    category = body.category;
    entityId = body.entityId;
    withDatabase = String(body.withDatabase).toLowerCase() === "true";
  }

  // Validate input
  if (!chatId) {
    return res.status(400).json({ error: "chat_id is required" });
  }

  if (!photoNetworkUrl && !fileData) {
    return res
      .status(400)
      .json({ error: "photo (network URL or file) is required" });
  }

  console.log("Uploading photo to chat:", chatId);

  const uploadSource = fileName || photoNetworkUrl;
  const extension = getFileExtension(uploadSource);
  const useDocumentUpload = shouldSendAsDocument(extension);

  // Upload photo or document to Telegram
  let result;
  if (photoNetworkUrl) {
    if (useDocumentUpload) {
      result = await uploadDocumentFromUrl(
        chatId,
        photoNetworkUrl,
        caption,
        parseMode,
      );
    } else {
      result = await uploadPhotoFromUrl(
        chatId,
        photoNetworkUrl,
        caption,
        parseMode,
      );
    }
  } else if (fileData) {
    if (useDocumentUpload) {
      result = await uploadDocumentToTelegram(
        chatId,
        fileData,
        fileName,
        caption,
        parseMode,
      );
    } else {
      result = await uploadPhotoToTelegram(
        chatId,
        fileData,
        fileName,
        caption,
        parseMode,
      );
    }
  }

  console.log("Photo uploaded successfully");

  let telegramResponseData;

  if (useDocumentUpload) {
    const document = result.result.document;
    console.log("Getting file info for document:", document.file_id);
    const fileInfo = await getFileInfo(document.file_id);
    console.log("File info received:", fileInfo);

    const proxyUrl = buildProxyUrl(
      document.file_id,
      fileInfo.file_path,
      document.file_name,
    );

    telegramResponseData = {
      size: document.file_size,
      name: document.file_name,
      url: proxyUrl,
      path: fileInfo.file_path,
      fileId: document.file_id,
    };
  } else {
    // Get all photo sizes
    const photos = result.result.photo;
    // Get the largest photo (original quality)
    const originalPhoto = photos[photos.length - 1];

    console.log("Getting file info for original photo:", originalPhoto.file_id);
    // Get file path from Telegram
    const fileInfo = await getFileInfo(originalPhoto.file_id);
    console.log("File info received:", fileInfo);

    // Build proxy URL
    const proxyUrl = buildProxyUrl(originalPhoto.file_id, fileInfo.file_path);

    telegramResponseData = {
      size: originalPhoto.file_size,
      width: originalPhoto.width,
      height: originalPhoto.height,
      url: proxyUrl,
      path: fileInfo.file_path,
      fileId: originalPhoto.file_id,
    };
  }

  if (withDatabase) {
    const finalFileName = telegramResponseData.name || fileName || "photo";
    const dbFile = await FileService.saveTelegramFileToDatabase(
      fileData,
      finalFileName,
      getMimeType(getFileExtension(finalFileName)),
      id,
      category,
      entityId,
      telegramResponseData.path || telegramResponseData.url,
      telegramResponseData.fileId,
      telegramResponseData.size,
      { width: telegramResponseData.width, height: telegramResponseData.height }
    );
    return res.status(200).json({ success: true, data: dbFile });
  }

  return res.status(200).json({ success: true, data: telegramResponseData });
});

// Download photo route handler
exports.downloadPhoto = asyncHandler(async (req, res) => {
  const { fileId, path } = req.query;
  const fileExtension = path ? path.split(".").pop() : null;

  if (!fileExtension) {
    return res
      .status(400)
      .json({ error: "Unable to determine file extension from path" });
  }

  if (!fileId && !path) {
    return res
      .status(400)
      .json({ error: "fileId or path parameter is required" });
  }

  // Get MIME type
  const mimeType = getMimeType(fileExtension);

  // Prevent video download for non-app users
  if (mimeType.startsWith("video/")) {
    const ref = req.headers.referer || null;
    if (
      ref === null ||
      (!ref.includes("relinecode.com") &&
        !ref.includes("http://localhost:5000"))
    ) {
      return res
        .status(403)
        .json({ error: "You do not have permission to download this video" });
    }
  }

  console.log("Proxying photo download...");
  console.log("File ID:", fileId);
  console.log("Path:", path);

  let photoUrl;

  if (path) {
    // Use path if provided
    photoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`;
  } else if (fileId) {
    // Get file info from fileId if path not provided
    const fileInfo = await getFileInfo(fileId);
    photoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
  } else {
    return res.status(400).json({ error: "Unable to construct photo URL" });
  }

  const response = await axios.get(photoUrl, { responseType: "stream" });
  if (response.status !== 200) {
    return res
      .status(response.status)
      .json({ error: `Failed to fetch photo: ${response.status}` });
  }

  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Length", response.headers["content-length"] || "0");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="chat-photo.${fileExtension || "bin"}"`,
  );

  response.data.pipe(res);
});

// Fetch image and convert to bytes
exports.fetchImage = asyncHandler(async (req, res) => {
  const { url: imageUrl } = req.body;

  if (!imageUrl) {
    return res.status(400).json({ error: "URL is required" });
  }

  console.log("Fetching URL:", imageUrl);

  const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
  if (response.status !== 200) {
    return res
      .status(response.status)
      .json({ error: `Failed to fetch: ${response.status}` });
  }

  const imageBuffer = Buffer.from(response.data);
  const imageBytes = Array.from(imageBuffer);

  console.log("Image fetched, size:", imageBytes.length);

  res.status(200).json(imageBytes);
});

// Fetch video without exposing token
exports.fetchVideo = asyncHandler(async (req, res) => {
  const { url: videoUrl } = req.body;

  if (!videoUrl) {
    return res.status(400).json({ error: "URL is required" });
  }

  console.log("Fetching Video URL:", videoUrl);

  const response = await axios.get(videoUrl, { responseType: "arraybuffer" });
  if (response.status !== 200) {
    return res
      .status(response.status)
      .json({ error: `Failed to fetch: ${response.status}` });
  }

  const videoBuffer = Buffer.from(response.data);

  console.log("Video fetched, size:", videoBuffer.byteLength);

  const base64Video = videoBuffer.toString("base64");

  res.status(200).json({
    success: true,
    size: videoBuffer.byteLength,
    base64: base64Video,
    mimeType: response.headers["content-type"] || "video/mp4",
  });
});

// Get video information without downloading
exports.getVideoInfo = asyncHandler(async (req, res) => {
  const { fileId } = req.body;

  if (!fileId) {
    return res.status(400).json({ error: "fileId is required" });
  }

  console.log("Getting file info for:", fileId);

  const fileInfo = await getFileInfo(fileId);

  const proxyUrl = `http://localhost:8000/download-video?path=${encodeURIComponent(fileInfo.file_path)}`;

  res.status(200).json({
    success: true,
    fileSize: fileInfo.file_size,
    filePath: fileInfo.file_path,
    proxyUrl: proxyUrl,
    downloadUrl: `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`,
  });
});

// Download video via proxy
exports.downloadVideo = asyncHandler(async (req, res) => {
  const { path } = req.query;

  if (!path) {
    return res.status(400).json({ error: "path parameter is required" });
  }

  const videoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`;

  console.log("Proxying video download...");

  const response = await axios.get(videoUrl, { responseType: "stream" });
  if (response.status !== 200) {
    return res
      .status(response.status)
      .json({ error: `Failed to fetch video: ${response.status}` });
  }

  res.setHeader(
    "Content-Type",
    response.headers["content-type"] || "video/mp4",
  );
  res.setHeader("Content-Length", response.headers["content-length"] || "0");
  res.setHeader("Content-Disposition", `attachment; filename="video.mp4"`);

  response.data.pipe(res);
});

// Get updates from Telegram
exports.getUpdates = asyncHandler(async (req, res) => {
  const { offset, limit, timeout, allowedUpdates } = req.body;

  console.log("Getting updates for bot...");

  const updates = await getUpdates(offset, limit, timeout, allowedUpdates);

  res.status(200).json({
    success: true,
    updates,
  });
});

// Send message to specific chat
exports.sendMessage = asyncHandler(async (req, res) => {
  const { chatId, text, parseMode } = req.body;

  if (!chatId) {
    return res.status(400).json({ error: "chatId is required" });
  }
  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }

  console.log("Sending message to chat:", chatId);

  const result = await sendMessage(chatId, text, parseMode);

  res.status(200).json({
    success: true,
    result,
  });
});

// Download file from proxyUrl and return as bytes
exports.downloadFile = asyncHandler(async (req, res) => {
  const { url: proxyUrl } = req.body;

  if (!proxyUrl) {
    return res.status(400).json({ error: "proxyUrl is required" });
  }

  console.log("Received proxyUrl:", proxyUrl);

  try {
    // Extract path from query string without depending on global URL support
    const queryStart = proxyUrl.indexOf("?");
    if (queryStart === -1) {
      return res.status(400).json({ error: "path parameter not found in URL" });
    }

    const queryString = proxyUrl.slice(queryStart + 1);
    const params = queryString.split("&").reduce((acc, part) => {
      const [rawKey, rawValue] = part.split("=");
      if (!rawKey) return acc;
      const key = decodeURIComponent(rawKey);
      const value = rawValue ? decodeURIComponent(rawValue) : "";
      acc[key] = value;
      return acc;
    }, {});

    const path = params.path;

    if (!path) {
      return res.status(400).json({ error: "path parameter not found in URL" });
    }

    console.log("Extracted path:", path);

    // Construct Telegram file URL
    const imageUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`;
    console.log("Fetching from Telegram:", imageUrl);

    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
    if (response.status !== 200) {
      return res
        .status(response.status)
        .json({ error: `Failed to fetch: ${response.status}` });
    }

    const imageBuffer = Buffer.from(response.data);
    const imageBytes = Array.from(imageBuffer);

    console.log("File fetched, size:", imageBytes.length);

    res.status(200).json(imageBytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error in downloadFile:", message);
    res.status(500).json({ error: message });
  }
});

// Get chat photo/image
exports.getChatImage = asyncHandler(async (req, res) => {
  const { chatId } = req.body;

  if (!chatId) {
    return res.status(400).json({ error: "chatId is required" });
  }

  console.log("Getting chat photo for chat ID:", chatId);

  try {
    // Get chat information
    const chat = await getChat(chatId);

    // Check if chat has a photo
    if (!chat.photo || !chat.photo.big_file_id) {
      return res.status(200).json({
        success: false,
        error: "Chat has no photo",
        chatId: chatId,
        proxyUrl: null,
      });
    }

    // Get file information using the big_file_id
    const fileId = chat.photo.big_file_id;
    console.log("File ID:", fileId);

    const fileInfo = await getFileInfo(fileId);
    console.log("File info:", fileInfo);

    // Construct URLs
    const filePath = fileInfo.file_path;
    const directUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    const proxyUrl = `/files-v2?fileId=${encodeURIComponent(fileId)}&path=${encodeURIComponent(filePath)}`;

    res.status(200).json({
      success: true,
      chatId: chatId,
      fileId: fileId,
      filePath: filePath,
      fileSize: fileInfo.file_size,
      directUrl: directUrl,
      proxyUrl: proxyUrl,
      chatTitle: chat.title || chat.first_name || "Unknown",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error getting chat photo:", message);
    res.status(200).json({
      success: false,
      error: message,
      chatId: chatId,
      proxyUrl: null,
    });
  }
});

// Upload video route handler
exports.uploadVideo = asyncHandler(async (req, res) => {
  const contentType = req.headers["content-type"] || "";

  let chatId;
  let videoNetworkUrl = null;
  let caption = null;
  let parseMode = null;
  let fileData = null;
  let fileName = null;

  let id = null;
  let category = null;
  let entityId = null;
  let withDatabase = false;

  // Parse request based on content type
  if (contentType.includes("multipart/form-data")) {
    const formData = req.body;
    chatId = formData.chat_id;
    caption = formData.caption;
    parseMode = formData.parse_mode;
    id = formData.id;
    category = formData.category;
    entityId = formData.entityId;
    withDatabase = String(formData.withDatabase).toLowerCase() === "true";
    const requestedFileName =
      formData.file_name || formData.fileName || formData.name;

    if (req.file) {
      fileData = req.file.buffer;
      fileName = resolveUploadFileName(
        requestedFileName,
        req.file.originalname,
      );
    }
  } else {
    const body = req.body;
    chatId = body.chatId || body.chat_id;
    videoNetworkUrl = body.videoNetworkUrl || body.video;
    caption = body.caption;
    parseMode = body.parseMode || body.parse_mode;
    id = body.id;
    category = body.category;
    entityId = body.entityId;
    withDatabase = String(body.withDatabase).toLowerCase() === "true";
  }

  // Validate input
  if (!chatId) {
    return res.status(400).json({ error: "chat_id is required" });
  }

  if (!videoNetworkUrl && !fileData) {
    return res
      .status(400)
      .json({ error: "video (network URL or file) is required" });
  }

  console.log("Uploading video to chat:", chatId);

  // Upload video to Telegram
  let result;
  if (videoNetworkUrl) {
    result = await uploadVideoFromUrl(
      chatId,
      videoNetworkUrl,
      caption,
      parseMode,
    );
  } else if (fileData) {
    result = await uploadVideoToTelegram(
      chatId,
      fileData,
      fileName,
      caption,
      parseMode,
    );
  }

  console.log("Video uploaded successfully");

  // Get all video sizes
  const video = result.result.video;

  console.log("Getting file info for video:", video);

  // Get file path from Telegram
  const fileInfo = await getFileInfo(video.file_id);
  const thumbnail = video.thumbnail
    ? await getFileInfo(video.thumbnail.file_id)
    : null;

  console.log("File info received:", fileInfo);
  if (thumbnail) console.log("Thumbnail info received:", thumbnail);

  // Build proxy URL
  const proxyUrl = buildProxyUrl(
    video.file_id,
    fileInfo.file_path,
    video.file_name,
  );
  const proxyUrlThumbnail = thumbnail
    ? buildProxyUrl(video.thumbnail.file_id, thumbnail.file_path)
    : null;

  const telegramResponseData = {
    size: video.file_size,
    width: video.width,
    height: video.height,
    url: proxyUrl,
    thumbnail: proxyUrlThumbnail,
    path: fileInfo.file_path,
    name: video.file_name,
    duration: video.duration,
  };

  if (withDatabase) {
    const finalFileName = telegramResponseData.name || fileName || "video.mp4";
    const dbFile = await FileService.saveTelegramFileToDatabase(
      fileData,
      finalFileName,
      getMimeType(getFileExtension(finalFileName)),
      id,
      category,
      entityId,
      telegramResponseData.path || telegramResponseData.url,
      video.file_id,
      telegramResponseData.size,
      { width: telegramResponseData.width, height: telegramResponseData.height, duration: telegramResponseData.duration }
    );
    return res.status(200).json({ success: true, data: dbFile });
  }

  return res.status(200).json({ success: true, data: telegramResponseData });
});

// Upload document route handler
exports.uploadDocument = asyncHandler(async (req, res) => {
  const contentType = req.headers["content-type"] || "";

  let chatId;
  let documentNetworkUrl = null;
  let caption = null;
  let parseMode = null;
  let fileData = null;
  let fileName = null;

  let id = null;
  let category = null;
  let entityId = null;
  let withDatabase = false;

  // Parse request based on content type
  if (contentType.includes("multipart/form-data")) {
    const formData = req.body;
    chatId = formData.chat_id;
    caption = formData.caption;
    parseMode = formData.parse_mode;
    id = formData.id;
    category = formData.category;
    entityId = formData.entityId;
    withDatabase = String(formData.withDatabase).toLowerCase() === "true";
    const requestedFileName =
      formData.file_name || formData.fileName || formData.name;

    if (req.file) {
      fileData = req.file.buffer;
      fileName = resolveUploadFileName(
        requestedFileName,
        req.file.originalname,
      );
    }
  } else {
    const body = req.body;
    chatId = body.chatId || body.chat_id;
    documentNetworkUrl = body.documentNetworkUrl || body.document;
    caption = body.caption;
    parseMode = body.parseMode || body.parse_mode;
    id = body.id;
    category = body.category;
    entityId = body.entityId;
    withDatabase = String(body.withDatabase).toLowerCase() === "true";
  }

  // Validate input
  if (!chatId) {
    return res.status(400).json({ error: "chat_id is required" });
  }

  if (!documentNetworkUrl && !fileData) {
    return res
      .status(400)
      .json({ error: "document (network URL or file) is required" });
  }

  console.log("Uploading document to chat:", chatId);

  // Upload document to Telegram
  let result;
  if (documentNetworkUrl) {
    result = await uploadDocumentFromUrl(
      chatId,
      documentNetworkUrl,
      caption,
      parseMode,
    );
  } else if (fileData) {
    result = await uploadDocumentToTelegram(
      chatId,
      fileData,
      fileName,
      caption,
      parseMode,
    );
  }

  console.log("Document uploaded successfully");

  // Get document info
  const document = result.result.document;

  console.log("Getting file info for document:", document);

  // Get file path from Telegram
  const fileInfo = await getFileInfo(document.file_id);

  console.log("File info received:", fileInfo);

  // Build proxy URL
  const proxyUrl = buildProxyUrl(
    document.file_id,
    fileInfo.file_path,
    document.file_name,
  );

  const telegramResponseData = {
    size: document.file_size,
    url: proxyUrl,
    name: document.file_name,
    path: fileInfo.file_path,
    fileId: document.file_id,
  };

  if (withDatabase) {
    const finalFileName = telegramResponseData.name || fileName || "document";
    const dbFile = await FileService.saveTelegramFileToDatabase(
      fileData,
      finalFileName,
      getMimeType(getFileExtension(finalFileName)),
      id,
      category,
      entityId,
      telegramResponseData.path || telegramResponseData.url,
      telegramResponseData.fileId,
      telegramResponseData.size,
      {}
    );
    return res.status(200).json({ success: true, data: dbFile });
  }

  return res.status(200).json({ success: true, data: telegramResponseData });
});
