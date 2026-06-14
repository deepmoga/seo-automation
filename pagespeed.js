// pagespeed.js
// Runs Google PageSpeed Insights (Lighthouse) checks for a small subset of
// pages, returning performance/SEO/accessibility scores and Core Web Vitals.

const axios = require("axios");

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CATEGORIES = ["performance", "seo", "accessibility", "best-practices"];

/**
 * Run a PageSpeed Insights audit for a single URL.
 * Returns { url, strategy, scores: {performance, seo, accessibility, bestPractices}, vitals: {...} }
 * or { url, strategy, error } on failure.
 */
async function analyzePageSpeed(url, apiKey, strategy = "mobile") {
  try {
    const { data } = await axios.get(PSI_ENDPOINT, {
      params: {
        url,
        key: apiKey,
        strategy,
        category: CATEGORIES
      },
      paramsSerializer: { indexes: null },
      timeout: 60000
    });

    const lh = data.lighthouseResult;
    const categories = lh.categories || {};
    const audits = lh.audits || {};

    return {
      url,
      strategy,
      scores: {
        performance: categoryScore(categories.performance),
        seo: categoryScore(categories.seo),
        accessibility: categoryScore(categories.accessibility),
        bestPractices: categoryScore(categories["best-practices"])
      },
      vitals: {
        lcp: audits["largest-contentful-paint"] ? audits["largest-contentful-paint"].displayValue : null,
        cls: audits["cumulative-layout-shift"] ? audits["cumulative-layout-shift"].displayValue : null,
        tbt: audits["total-blocking-time"] ? audits["total-blocking-time"].displayValue : null,
        fcp: audits["first-contentful-paint"] ? audits["first-contentful-paint"].displayValue : null
      }
    };
  } catch (err) {
    const message = err.response && err.response.data && err.response.data.error
      ? err.response.data.error.message
      : err.message;
    return { url, strategy, error: message };
  }
}

function categoryScore(category) {
  if (!category || typeof category.score !== "number") return null;
  return Math.round(category.score * 100);
}

/**
 * Run PageSpeed Insights for the first `maxPages` pages of a site.
 * Returns an array of results (one per page), in the same order.
 */
async function runPageSpeedForSite(pages, apiKey, maxPages) {
  if (!apiKey) {
    throw new Error("PageSpeed API key is not configured. Add PAGESPEED_API_KEY in Settings.");
  }

  const subset = pages.slice(0, maxPages);
  const results = [];

  console.log(`🚀 Running PageSpeed Insights for ${subset.length} page(s)...`);

  for (let i = 0; i < subset.length; i++) {
    const page = subset[i];
    console.log(`   [${i + 1}/${subset.length}] ${page.url}`);
    const result = await analyzePageSpeed(page.url, apiKey, "mobile");
    if (result.error) {
      console.log(`   ⚠️  ${page.url}: ${result.error}`);
    } else {
      console.log(`   ✅ performance=${result.scores.performance} seo=${result.scores.seo}`);
    }
    results.push(result);
  }

  console.log("✅ PageSpeed check complete.");
  return results;
}

module.exports = { analyzePageSpeed, runPageSpeedForSite };
