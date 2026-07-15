const axios = require("axios");
const FormData = require("form-data");
const { BOT_TOKEN, TELEGRAM_API_BASE } = require("./telegramConfig");

/**
 * Make a GET/POST API request to Telegram
 */
async function makeApiRequest(method, params = {}) {
  const url = `${TELEGRAM_API_BASE}${BOT_TOKEN}/${method}`;

  try {
    const response = await axios.post(url, params);
    return response.data;
  } catch (error) {
    throw new Error(
      `Telegram API Error: ${error.response?.data?.description || error.message}`,
    );
  }
}

/**
 * Make a form-data API request to Telegram
 */
async function makeApiRequestForm(method, formData) {
  const url = `${TELEGRAM_API_BASE}${BOT_TOKEN}/${method}`;

  try {
    const response = await axios.post(url, formData, {
      headers: formData.getHeaders(),
    });
    return response.data;
  } catch (error) {
    throw new Error(
      `Telegram API Error: ${error.response?.data?.description || error.message}`,
    );
  }
}

/**
 * Get file information from Telegram
 */
async function getFileInfo(fileId) {
  const result = await makeApiRequest("getFile", { file_id: fileId });
  if (!result.ok) {
    throw new Error(`Failed to get file info: ${result.description}`);
  }
  return result.result;
}

/**
 * Get chat information
 */
async function getChat(chatId) {
  const result = await makeApiRequest("getChat", { chat_id: chatId });
  if (!result.ok) {
    throw new Error(`Failed to get chat: ${result.description}`);
  }
  return result.result;
}

/**
 * Get bot updates
 */
async function getUpdates(offset, limit, timeout, allowedUpdates) {
  const params = {};
  if (offset) params.offset = offset;
  if (limit) params.limit = limit;
  if (timeout) params.timeout = timeout;
  if (allowedUpdates) params.allowed_updates = allowedUpdates;

  const result = await makeApiRequest("getUpdates", params);
  if (!result.ok) {
    throw new Error(`Failed to get updates: ${result.description}`);
  }
  return result.result;
}

/**
 * Send message to chat
 */
async function sendMessage(chatId, text, parseMode) {
  const params = {
    chat_id: chatId,
    text: text,
  };
  if (parseMode) params.parse_mode = parseMode;

  const result = await makeApiRequest("sendMessage", params);
  if (!result.ok) {
    throw new Error(`Failed to send message: ${result.description}`);
  }
  return result.result;
}

module.exports = {
  makeApiRequest,
  makeApiRequestForm,
  getFileInfo,
  getChat,
  getUpdates,
  sendMessage,
};
