// notifier.js
// Sends Telegram and/or email alerts when a scheduled/manual audit
// completes or fails. Both channels are optional - if not configured,
// sending is skipped silently (with a log message).

const axios = require("axios");
const config = require("./config");

/**
 * Send a message via Telegram Bot API.
 * Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
 */
async function sendTelegram(message) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = config;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return { sent: false, reason: "Telegram not configured" };
  }

  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "HTML"
    });
    return { sent: true };
  } catch (err) {
    const reason = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    console.log(`⚠️  Telegram notification failed: ${reason}`);
    return { sent: false, reason };
  }
}

/**
 * Send an email via SMTP using nodemailer.
 * Requires SMTP_HOST, SMTP_USER, SMTP_PASS, NOTIFY_EMAIL_TO.
 */
async function sendEmail(subject, message) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, NOTIFY_EMAIL_TO } = config;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !NOTIFY_EMAIL_TO) {
    return { sent: false, reason: "Email not configured" };
  }

  try {
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    await transporter.sendMail({
      from: SMTP_USER,
      to: NOTIFY_EMAIL_TO,
      subject,
      text: message
    });
    return { sent: true };
  } catch (err) {
    console.log(`⚠️  Email notification failed: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

/**
 * Send a notification to all configured channels (Telegram + Email).
 * Failures on one channel don't block the other.
 */
async function notify(subject, message) {
  const telegramText = `<b>${escapeHtml(subject)}</b>\n${escapeHtml(message)}`;
  await Promise.all([
    sendTelegram(telegramText),
    sendEmail(subject, message)
  ]);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = { sendTelegram, sendEmail, notify };
