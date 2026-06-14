// sites-store.js
// Simple JSON-file-backed CRUD store for multi-site configuration.
// Each site: { id, name, siteUrl, wpApiUrl, wpUsername, wpAppPassword, maxPages, createdAt }

const fs = require("fs");
const path = require("path");
const config = require("./config");

const DATA_DIR = path.join(__dirname, "data");
const SITES_PATH = path.join(DATA_DIR, "sites.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Read all sites from data/sites.json. Returns [] if the file doesn't exist.
 * If no sites exist yet, seeds one default site from config.js so the
 * dashboard always has something to show.
 */
function getSites() {
  ensureDataDir();

  if (!fs.existsSync(SITES_PATH)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(SITES_PATH, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.log(`⚠️  Failed to read sites.json: ${err.message}`);
    return [];
  }
}

function saveSites(sites) {
  ensureDataDir();
  fs.writeFileSync(SITES_PATH, JSON.stringify(sites, null, 2), "utf-8");
}

function getSite(id) {
  return getSites().find((s) => s.id === id) || null;
}

/**
 * Derive a WordPress REST API base URL from a site URL if one
 * isn't explicitly provided.
 */
function deriveWpApiUrl(siteUrl) {
  return siteUrl.replace(/\/+$/, "") + "/wp-json/wp/v2";
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Add a new site. Returns the created site object.
 */
function addSite(data) {
  const sites = getSites();

  const siteUrl = (data.siteUrl || "").trim().replace(/\/+$/, "");

  const site = {
    id: generateId(),
    name: (data.name || siteUrl || "Site").trim(),
    siteUrl,
    wpApiUrl: (data.wpApiUrl || "").trim() || deriveWpApiUrl(siteUrl),
    wpUsername: (data.wpUsername || "").trim(),
    wpAppPassword: (data.wpAppPassword || "").trim(),
    maxPages: Number(data.maxPages) > 0 ? Number(data.maxPages) : config.MAX_PAGES,
    schedule: ["off", "daily", "weekly"].includes(data.schedule) ? data.schedule : "off",
    scheduleAutoFix: !!data.scheduleAutoFix,
    createdAt: new Date().toISOString()
  };

  sites.push(site);
  saveSites(sites);
  return site;
}

/**
 * Update an existing site by id. Only provided fields are changed.
 * Returns the updated site, or null if not found.
 */
function updateSite(id, data) {
  const sites = getSites();
  const index = sites.findIndex((s) => s.id === id);

  if (index === -1) return null;

  const existing = sites[index];

  const siteUrl = data.siteUrl !== undefined ? data.siteUrl.trim().replace(/\/+$/, "") : existing.siteUrl;

  const updated = {
    ...existing,
    name: data.name !== undefined ? data.name.trim() || siteUrl : existing.name,
    siteUrl,
    wpApiUrl: data.wpApiUrl !== undefined && data.wpApiUrl.trim()
      ? data.wpApiUrl.trim()
      : (data.siteUrl !== undefined ? deriveWpApiUrl(siteUrl) : existing.wpApiUrl),
    wpUsername: data.wpUsername !== undefined ? data.wpUsername.trim() : existing.wpUsername,
    wpAppPassword: data.wpAppPassword !== undefined && data.wpAppPassword.trim()
      ? data.wpAppPassword.trim()
      : existing.wpAppPassword,
    maxPages: data.maxPages !== undefined && Number(data.maxPages) > 0
      ? Number(data.maxPages)
      : existing.maxPages,
    schedule: ["off", "daily", "weekly"].includes(data.schedule) ? data.schedule : existing.schedule || "off",
    scheduleAutoFix: data.scheduleAutoFix !== undefined ? !!data.scheduleAutoFix : !!existing.scheduleAutoFix
  };

  sites[index] = updated;
  saveSites(sites);
  return updated;
}

/**
 * Delete a site by id. Returns true if deleted, false if not found.
 */
function deleteSite(id) {
  const sites = getSites();
  const next = sites.filter((s) => s.id !== id);

  if (next.length === sites.length) return false;

  saveSites(next);
  return true;
}

module.exports = {
  getSites,
  getSite,
  addSite,
  updateSite,
  deleteSite,
  deriveWpApiUrl
};
