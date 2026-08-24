const wppconnect = require("@wppconnect-team/wppconnect");
const os = require("os");
const path = require("path");

class WppSessionManager {
  constructor() {
    // Map<userId, { client, status, qrCode, initPromise }>
    this.sessions = new Map();
  }

  /**
   * Initializes or returns an existing WPPConnect client for the given userId.
   */
  async getClient(userId) {
    if (!userId) throw new Error("userId is required");

    if (this.sessions.has(userId)) {
      const session = this.sessions.get(userId);
      if (session.initPromise) {
        await session.initPromise;
      }
      return session.client;
    }

    let resolveInit;
    const initPromise = new Promise((resolve) => {
      resolveInit = resolve;
    });

    const sessionData = {
      client: null,
      status: "initializing", // initializing, qr, loggedIn
      qrCode: null,
      initPromise,
    };

    this.sessions.set(userId, sessionData);

    try {
      const isLinux = os.platform() === "linux";
      let browserArgs = [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--window-size=1280,800",
      ];

      if (isLinux) {
        browserArgs.push(
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-gpu",
          "--no-zygote",
          "--single-process"
        );
      }

      const client = await wppconnect.create({
        session: `user_${userId}`,
        folderNameToken: "tokens", // stores tokens at projectRoot/tokens
        headless: isLinux ? true : false,
        autoClose: 0, // Disable auto close to allow QR scanning at any time
        browserArgs: browserArgs,
        puppeteerOptions: {
          userDataDir: path.join(
            os.platform() === "win32" ? "D:\\ChromeProfiles" : "/tmp/ChromeProfiles",
            `WppProfile_${userId}`
          ),
        },
        catchQR: (base64Qrimg, asciiQR, attempts, urlCode) => {
          console.log(`[WPP] New QR Code for user ${userId}`);
          sessionData.qrCode = base64Qrimg;
          sessionData.status = "qr";
        },
        statusFind: (statusSession, session) => {
          console.log(`[WPP] Status for ${userId}:`, statusSession);
          if (statusSession === "isLogged" || statusSession === "inChat") {
            sessionData.status = "loggedIn";
            sessionData.qrCode = null;
          } else if (statusSession === "notLogged") {
            sessionData.status = "qr";
          }
        },
      });

      sessionData.client = client;
      resolveInit();
      return client;
    } catch (err) {
      this.sessions.delete(userId);
      resolveInit();
      throw err;
    }
  }

  /**
   * Returns the current status of the session without creating a new client if it doesn't exist.
   * Useful for the /status route.
   */
  async getStatus(userId) {
    if (!this.sessions.has(userId)) {
      // Not loaded into memory yet, let's start it in background and return initializing
      this.getClient(userId).catch(console.error);
      return { loggedIn: false, qrCode: null, status: "initializing" };
    }

    const session = this.sessions.get(userId);
    return {
      loggedIn: session.status === "loggedIn",
      qrCode: session.qrCode,
      status: session.status
    };
  }

  async logout(userId, force = false) {
    const session = this.sessions.get(userId);
    if (!session) return;

    if (session.initPromise) {
      await session.initPromise;
    }

    try {
      if (session.client) {
        if (force) {
          await session.client.logout(); // explicitly unlinks device from whatsapp
        }
        await session.client.close();
      }
    } catch (err) {
      console.error(`[WPP] Error closing client for ${userId}:`, err.message);
    } finally {
      this.sessions.delete(userId);
    }
  }
}

module.exports = WppSessionManager;
