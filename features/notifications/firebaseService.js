const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

class FirebaseService {
  constructor() {
    this.isInitialized = false;
  }

  initializeFirebase() {
    if (this.isInitialized) return;

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      : undefined;

    if (!projectId || !clientEmail || !privateKey) {
      console.warn("Firebase credentials missing in config.env. Notifications will be stored in DB but not pushed to devices.");
      return;
    }

    try {
      if (!getApps().length) {
        initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        });
      }
      this.isInitialized = true;
      console.log("Firebase Admin SDK successfully initialized.");
    } catch (error) {
      console.error("Failed to initialize Firebase Admin SDK:", error.message);
    }
  }

  /**
   * Build unified FCM payload
   */
  _buildPayload(notification) {
    const defaultIcon = process.env.FCM_DEFAULT_ICON || "";
    const defaultImage = process.env.FCM_DEFAULT_IMAGE || "";

    const payload = {
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        notificationId: notification.id ? notification.id.toString() : "",
        companyId: notification.companyId ? notification.companyId.toString() : "",
        type: notification.type || "",
        entityId: notification.action?.entityId || "",
        route: notification.action?.route || "",
      },
    };

    if (notification.image || defaultImage) {
      payload.notification.imageUrl = notification.image || defaultImage;
    }
    
    return payload;
  }

  /**
   * Send to a single token
   */
  async sendToToken(token, notification) {
    if (!this.isInitialized) return null;
    if (!token) return null;

    try {
      const payload = this._buildPayload(notification);
      payload.token = token;
      
      const response = await getMessaging().send(payload);
      return response;
    } catch (error) {
      console.error("Failed to send FCM to token:", error.message);
      return null;
    }
  }

  /**
   * Send to multiple tokens
   */
  async sendToTokens(tokens, notification) {
    if (!this.isInitialized) return null;
    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) return null;

    try {
      // FCM allows a maximum of 500 tokens per multicast
      const MAX_TOKENS = 500;
      let totalSuccess = 0;
      let totalFailure = 0;

      for (let i = 0; i < tokens.length; i += MAX_TOKENS) {
        const chunk = tokens.slice(i, i + MAX_TOKENS);
        const payload = this._buildPayload(notification);
        payload.tokens = chunk;

        const response = await getMessaging().sendEachForMulticast(payload);
        totalSuccess += response.successCount;
        totalFailure += response.failureCount;
      }

      if (totalFailure > 0) {
        console.warn(`FCM multicast sent with ${totalFailure} failures.`);
      }
      return { successCount: totalSuccess, failureCount: totalFailure };
    } catch (error) {
      console.error("Failed to send FCM to multiple tokens:", error.message);
      return null;
    }
  }

  /**
   * Send to topic
   */
  async sendTopic(topic, notification) {
    if (!this.isInitialized) return null;
    if (!topic) return null;

    try {
      const payload = this._buildPayload(notification);
      payload.topic = topic;

      const response = await getMessaging().send(payload);
      return response;
    } catch (error) {
      console.error("Failed to send FCM to topic:", error.message);
      return null;
    }
  }
}

const instance = new FirebaseService();
module.exports = instance;
