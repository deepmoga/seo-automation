// link-checker.js
// Checks all links (internal + external) collected during a crawl for
// broken pages (4xx/5xx responses or network failures).

const axios = require("axios");

const CONCURRENCY = 8;
const TIMEOUT_MS = 10000;

const REQUEST_HEADERS = { "User-Agent": "SEO-Automation-Bot/1.0" };

/**
 * Check a single URL. Tries HEAD first (cheaper), falls back to GET if
 * the server doesn't support HEAD or returns an error status.
 */
async function checkUrl(url) {
  try {
    let res = await axios.head(url, {
      timeout: TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: REQUEST_HEADERS
    }).catch(() => null);

    if (!res || res.status === 405 || res.status >= 400) {
      res = await axios.get(url, {
        timeout: TIMEOUT_MS,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: REQUEST_HEADERS
      });
    }

    return { status: res.status, ok: res.status < 400 };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  }
}

/**
 * Check every unique link found across the crawled pages.
 * Returns an array of broken links: { url, status, foundOn: [pageUrl, ...] }
 */
async function checkBrokenLinks(pages) {
  const linkMap = new Map(); // url -> Set<pageUrl>

  for (const page of pages) {
    for (const link of page.links || []) {
      // Skip Cloudflare's email-obfuscation endpoint - these only work
      // when rewritten client-side and always 404 on direct requests.
      if (link.includes("/cdn-cgi/")) continue;

      if (!linkMap.has(link)) linkMap.set(link, new Set());
      linkMap.get(link).add(page.url);
    }
  }

  const urls = [...linkMap.keys()];
  if (urls.length === 0) return [];

  console.log(`🔗 Checking ${urls.length} unique link(s) for broken links...`);

  const results = new Map();
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < urls.length) {
      const i = nextIndex++;
      const url = urls[i];
      results.set(url, await checkUrl(url));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker)
  );

  const broken = [];
  for (const [url, result] of results) {
    if (!result.ok) {
      broken.push({
        url,
        status: result.status,
        foundOn: [...linkMap.get(url)]
      });
    }
  }

  console.log(`✅ Link check complete. ${broken.length} broken link(s) found.`);
  return broken;
}

module.exports = { checkBrokenLinks, checkUrl };
