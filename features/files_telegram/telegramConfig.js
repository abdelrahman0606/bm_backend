// Telegram Bot Configuration
const BOT_TOKEN = "8595848673:AAEKg4YyNdtjQXA8H-aN4-5BIFuomMMh6fI";
const TELEGRAM_API_BASE = "https://api.telegram.org/bot";
const CHAT_ID = "-1003434490847";

// CORS headers helper
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const getCorsHeaders = (origin) => ({
  ...corsHeaders,
  "Access-Control-Allow-Origin": origin || "*",
});

module.exports = {
  BOT_TOKEN,
  TELEGRAM_API_BASE,
  CHAT_ID,
  corsHeaders,
  getCorsHeaders,
};
