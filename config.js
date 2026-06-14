// config.js
// Central configuration for the SEO automation system.
// Edit these values to point the tool at a different site or tweak limits.

require("dotenv").config();

module.exports = {
  // Default site (used by the CLI when no site is specified, and as
  // fallback values for the first site created via the dashboard)
  SITE_URL: "https://officialsolutions.in",

  // WordPress REST API base URL
  WP_API_URL: "https://officialsolutions.in/wp-json/wp/v2",

  // Maximum number of pages to crawl (safety limit, can be overridden per-site)
  MAX_PAGES: 200,

  // Default content language (used in AI prompts)
  LANGUAGE: "en",

  // Delay (ms) between outbound API calls to avoid rate limiting
  API_DELAY_MS: 1000,

  // SEO thresholds used by the analyzer
  THRESHOLDS: {
    TITLE_MIN: 30,
    TITLE_MAX: 60,
    META_DESC_MIN: 120,
    META_DESC_MAX: 155,
    MIN_WORD_COUNT: 300
  },

  // OpenAI model used for content generation
  OPENAI_MODEL: "gpt-4o-mini",

  // Credentials / secrets loaded from .env
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  WP_USERNAME: process.env.WP_USERNAME,
  WP_APP_PASSWORD: process.env.WP_APP_PASSWORD,

  // Web dashboard settings
  PORT: process.env.PORT || 4600,
  ADMIN_USER: process.env.ADMIN_USER || "admin",
  ADMIN_PASS: process.env.ADMIN_PASS || "admin",

  // Google PageSpeed Insights (Core Web Vitals)
  PAGESPEED_API_KEY: process.env.PAGESPEED_API_KEY || "",
  PAGESPEED_MAX_PAGES: parseInt(process.env.PAGESPEED_MAX_PAGES, 10) || 5,

  // Telegram bot alerts
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || "",

  // Email (SMTP) alerts
  SMTP_HOST: process.env.SMTP_HOST || "",
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",
  NOTIFY_EMAIL_TO: process.env.NOTIFY_EMAIL_TO || "",

  // Google OAuth (Search Console)
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || ""
};
