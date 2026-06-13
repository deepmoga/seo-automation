// config.js
// Central configuration for the SEO automation system.
// Edit these values to point the tool at a different site or tweak limits.

require("dotenv").config();

module.exports = {
  // The website to crawl and audit
  SITE_URL: "https://officialsolutions.in",

  // WordPress REST API base URL
  WP_API_URL: "https://officialsolutions.in/wp-json/wp/v2",

  // Maximum number of pages to crawl (safety limit)
  MAX_PAGES: 50,

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
  WP_APP_PASSWORD: process.env.WP_APP_PASSWORD
};
