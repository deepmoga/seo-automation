// crawler.js
// Crawls the target WordPress site starting from the homepage, following
// only internal links, and extracts on-page SEO data from each page.

const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("url");
const config = require("./config");

// Paths that should never be crawled (admin/system URLs, feeds, sitemaps)
const SKIP_PATTERNS = [
  "/wp-admin",
  "/wp-login",
  "/feed",
  "/sitemap",
  "/wp-json",
  "/?s=", // search results
  ".xml",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".pdf",
  ".zip",
  ".css",
  ".js"
];

/**
 * Download and parse robots.txt for the site, returning a list of
 * disallowed path prefixes for the "*" user-agent.
 */
async function getDisallowedPaths(siteUrl) {
  const disallowed = [];

  try {
    const robotsUrl = new URL("/robots.txt", siteUrl).toString();
    const { data } = await axios.get(robotsUrl, { timeout: 10000 });

    let appliesToAll = false;

    data.split("\n").forEach((line) => {
      const trimmed = line.trim();

      if (/^user-agent:/i.test(trimmed)) {
        const agent = trimmed.split(":")[1].trim();
        appliesToAll = agent === "*";
      } else if (appliesToAll && /^disallow:/i.test(trimmed)) {
        const path = trimmed.split(":")[1].trim();
        if (path) disallowed.push(path);
      }
    });
  } catch (err) {
    console.log("⚠️  Could not fetch robots.txt, continuing without restrictions:", err.message);
  }

  return disallowed;
}

/**
 * Check if a URL should be skipped based on SKIP_PATTERNS or robots.txt rules.
 */
function shouldSkipUrl(pathname, disallowedPaths) {
  const lowerPath = pathname.toLowerCase();

  for (const pattern of SKIP_PATTERNS) {
    if (lowerPath.includes(pattern)) return true;
  }

  for (const disallowed of disallowedPaths) {
    if (disallowed !== "/" && lowerPath.startsWith(disallowed.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Normalize a URL: strip query strings/fragments and trailing slashes
 * so the same page isn't visited multiple times under different URLs.
 */
function normalizeUrl(rawUrl, baseUrl) {
  try {
    const url = new URL(rawUrl, baseUrl);
    url.hash = "";
    url.search = "";

    let normalized = url.toString();
    if (normalized.endsWith("/") && normalized !== `${url.origin}/`) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch (err) {
    return null;
  }
}

/**
 * Extract all on-page SEO data points from a page's HTML.
 */
function extractPageData(html, pageUrl) {
  const $ = cheerio.load(html);

  // Title tag
  const title = $("title").first().text().trim();

  // Meta description
  const metaDescription = $('meta[name="description"]').attr("content") || "";

  // Meta keywords
  const metaKeywords = $('meta[name="keywords"]').attr("content") || "";

  // Headings
  const h1s = $("h1").map((i, el) => $(el).text().trim()).get();
  const h2s = $("h2").map((i, el) => $(el).text().trim()).get();
  const h3s = $("h3").map((i, el) => $(el).text().trim()).get();

  // Images: src + alt
  const images = $("img")
    .map((i, el) => ({
      src: $(el).attr("src") || "",
      alt: ($(el).attr("alt") || "").trim()
    }))
    .get()
    .filter((img) => img.src);

  // Canonical tag
  const canonical = $('link[rel="canonical"]').attr("href") || "";

  // Schema markup (JSON-LD or microdata)
  const hasJsonLd = $('script[type="application/ld+json"]').length > 0;
  const hasMicrodata = $("[itemtype]").length > 0;
  const hasSchema = hasJsonLd || hasMicrodata;

  // Word count from visible body text (strip script/style/noscript/svg
  // content first - otherwise Elementor/JS config JSON pollutes the text)
  const $body = $("body").clone();
  $body.find("script, style, noscript, svg, template").remove();
  const bodyText = $body.text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  // Internal links (count + collect for crawling)
  const baseHost = new URL(pageUrl).host;
  const internalLinks = [];

  $("a[href]").each((i, el) => {
    const href = $(el).attr("href");
    const normalized = normalizeUrl(href, pageUrl);
    if (normalized) {
      try {
        const linkHost = new URL(normalized).host;
        if (linkHost === baseHost) {
          internalLinks.push(normalized);
        }
      } catch (err) {
        // ignore malformed links
      }
    }
  });

  return {
    url: pageUrl,
    title,
    metaDescription,
    metaKeywords,
    bodyText,
    h1: h1s,
    h2: h2s,
    h3: h3s,
    images,
    canonical,
    hasSchema,
    wordCount,
    internalLinksCount: internalLinks.length,
    internalLinks
  };
}

/**
 * Crawl a site starting from its homepage, following internal links only,
 * up to maxPages. Returns an array of page data objects.
 *
 * @param {string} [siteUrl] - site to crawl (defaults to config.SITE_URL)
 * @param {number} [maxPages] - max pages to crawl (defaults to config.MAX_PAGES)
 */
async function crawlSite(siteUrl = config.SITE_URL, maxPages = config.MAX_PAGES) {

  console.log(`🔎 Starting crawl: ${siteUrl}`);
  console.log(`📄 Max pages to crawl: ${maxPages}`);

  const disallowedPaths = await getDisallowedPaths(siteUrl);
  if (disallowedPaths.length > 0) {
    console.log(`🤖 robots.txt disallow rules found: ${disallowedPaths.join(", ")}`);
  }

  const startUrl = normalizeUrl(siteUrl, siteUrl);
  const visited = new Set();
  const queue = [startUrl];
  const pages = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const currentUrl = queue.shift();

    if (!currentUrl || visited.has(currentUrl)) continue;

    let pathname;
    try {
      pathname = new URL(currentUrl).pathname;
    } catch (err) {
      continue;
    }

    if (shouldSkipUrl(pathname, disallowedPaths)) {
      visited.add(currentUrl);
      continue;
    }

    visited.add(currentUrl);

    try {
      console.log(`➡️  Crawling (${pages.length + 1}/${maxPages}): ${currentUrl}`);

      const response = await axios.get(currentUrl, {
        timeout: 15000,
        headers: { "User-Agent": "SEO-Automation-Bot/1.0" }
      });

      const contentType = response.headers["content-type"] || "";
      if (!contentType.includes("text/html")) {
        continue;
      }

      const pageData = extractPageData(response.data, currentUrl);
      pages.push(pageData);

      // Queue new internal links for crawling
      for (const link of pageData.internalLinks) {
        let linkPath;
        try {
          linkPath = new URL(link).pathname;
        } catch (err) {
          continue;
        }

        if (!visited.has(link) && !queue.includes(link) && !shouldSkipUrl(linkPath, disallowedPaths)) {
          queue.push(link);
        }
      }
    } catch (err) {
      console.log(`⚠️  Failed to crawl ${currentUrl}: ${err.message}`);
    }
  }

  console.log(`✅ Crawl complete. ${pages.length} pages collected.`);
  return pages;
}

module.exports = {
  crawlSite,
  extractPageData,
  normalizeUrl,
  shouldSkipUrl
};
