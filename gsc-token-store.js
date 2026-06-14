// gsc-token-store.js
// Persists the Google OAuth tokens used for Search Console access.
// Single global Google account (one dashboard = one Google login).

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const TOKEN_PATH = path.join(DATA_DIR, "google-token.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Returns { access_token, refresh_token, expiry } or null if not connected.
 */
function getToken() {
  if (!fs.existsSync(TOKEN_PATH)) return null;

  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  } catch (err) {
    console.log(`⚠️  Failed to read Google token: ${err.message}`);
    return null;
  }
}

function saveToken(token) {
  ensureDataDir();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), "utf-8");
}

function clearToken() {
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
}

module.exports = { getToken, saveToken, clearToken };
