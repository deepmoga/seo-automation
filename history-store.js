// history-store.js
// Stores timestamped SEO score snapshots per site so trends over time
// can be shown on the dashboard. Each entry:
//   { date, totalPages, avgScore, critical, warning, info }

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "data", "history");
const MAX_ENTRIES = 200;

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

function getHistoryPath(siteId) {
  return path.join(DIR, `${siteId}.json`);
}

/**
 * Return the full history array for a site (oldest first), or [] if none.
 */
function getHistory(siteId) {
  ensureDir();
  const filePath = getHistoryPath(siteId);

  if (!fs.existsSync(filePath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.log(`⚠️  Failed to read history for ${siteId}: ${err.message}`);
    return [];
  }
}

/**
 * Build a score snapshot from a set of analyzed pages.
 */
function summarize(analyzedPages) {
  const totalPages = analyzedPages.length;
  const avgScore = totalPages
    ? Math.round(analyzedPages.reduce((sum, p) => sum + p.seoScore, 0) / totalPages)
    : 0;

  const counts = { critical: 0, warning: 0, info: 0 };
  for (const page of analyzedPages) {
    for (const issue of page.issues || []) {
      counts[issue.severity] = (counts[issue.severity] || 0) + 1;
    }
  }

  return {
    date: new Date().toISOString(),
    totalPages,
    avgScore,
    ...counts
  };
}

/**
 * Append a snapshot for a site, trimming to the most recent MAX_ENTRIES.
 */
function appendHistory(siteId, analyzedPages) {
  ensureDir();

  const entry = summarize(analyzedPages);
  const history = getHistory(siteId);
  history.push(entry);

  const trimmed = history.slice(-MAX_ENTRIES);
  fs.writeFileSync(getHistoryPath(siteId), JSON.stringify(trimmed, null, 2), "utf-8");

  return trimmed;
}

module.exports = {
  getHistory,
  appendHistory,
  summarize
};
