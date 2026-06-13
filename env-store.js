// env-store.js
// Shared helpers for reading/writing the .env file. Used by both the
// local setup panel (setup.js) and the web dashboard settings page
// (server.js).

const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, ".env");

/**
 * Read the current .env file (if any) into a key -> value object.
 */
function readEnv() {
  const values = {};

  if (!fs.existsSync(ENV_PATH)) return values;

  try {
    const content = fs.readFileSync(ENV_PATH, "utf-8");

    content.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;

      const idx = trimmed.indexOf("=");
      if (idx === -1) return;

      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      values[key] = value;
    });
  } catch (err) {
    console.log(`⚠️  Could not read existing .env: ${err.message}`);
  }

  return values;
}

/**
 * Write the given key -> value map to .env, preserving any existing
 * keys that aren't part of the update. Reloads process.env afterwards
 * so the running process picks up the new values immediately.
 */
function writeEnv(newValues) {
  const current = readEnv();
  const merged = { ...current, ...newValues };

  const lines = Object.entries(merged)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`);

  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf-8");

  // Apply immediately to the running process
  for (const [key, value] of Object.entries(newValues)) {
    if (value) process.env[key] = value;
  }
}

/**
 * Mask a secret value for display (show only first/last few chars).
 */
function maskValue(value) {
  if (!value) return "";
  if (value.length <= 6) return "*".repeat(value.length);
  return value.slice(0, 3) + "*".repeat(value.length - 6) + value.slice(-3);
}

module.exports = {
  ENV_PATH,
  readEnv,
  writeEnv,
  maskValue
};
