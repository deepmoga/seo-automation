// runner.js
// Shared "core" logic used by both the CLI (index.js) and the web
// dashboard (server.js): crawl + analyze, and AI-powered auto-fix.
// All functions accept an optional `site` object
// ({ id, name, siteUrl, wpApiUrl, wpUsername, wpAppPassword, maxPages }).
// When omitted, the legacy single-site config.js values are used.

const config = require("./config");
const { crawlSite } = require("./crawler");
const { analyzePages } = require("./analyzer");
const { analyzeKeywords } = require("./keywords");
const ai = require("./ai");
const fixer = require("./fixer");
const reporter = require("./reporter");

/**
 * Simple delay helper to throttle API calls.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build WP credentials object for fixer.js from a site config, falling
 * back to global config (.env) values when not provided.
 */
function wpCreds(site) {
  if (!site) return {};
  return {
    wpApiUrl: site.wpApiUrl,
    wpUsername: site.wpUsername,
    wpAppPassword: site.wpAppPassword
  };
}

/**
 * Crawl the site and analyze every page for SEO issues.
 * Also runs keyword analysis. Saves the report and returns the
 * analyzed pages array.
 */
async function runAudit(site = null) {
  const siteUrl = site ? site.siteUrl : config.SITE_URL;
  const maxPages = site ? site.maxPages : config.MAX_PAGES;
  const siteId = site ? site.id : null;

  console.log("🚀 Starting On-Page SEO Automation System");
  console.log(`🌐 Target site: ${siteUrl}\n`);

  const pages = await crawlSite(siteUrl, maxPages);

  if (pages.length === 0) {
    throw new Error("No pages were crawled.");
  }

  const analyzedPages = analyzePages(pages);
  const keywordData = analyzeKeywords(analyzedPages);

  reporter.printReport(analyzedPages);
  reporter.saveReport(analyzedPages, { keywords: keywordData }, siteId);

  return analyzedPages;
}

/**
 * For a single page, generate AI-powered fixes for the issues found
 * and apply them via the WordPress REST API.
 */
async function fixPage(page, site = null) {
  const creds = wpCreds(site);

  const fixesApplied = {
    url: page.url,
    title: null,
    metaDescription: null,
    schema: null,
    altTextsFixed: 0
  };

  try {
    const issueTypes = (page.issues || []).map((issue) => issue.type);

    // Find the corresponding WordPress post/page
    const wpPost = await fixer.findPostByUrl(page.url, creds);

    if (!wpPost) {
      console.log(`   ⚠️  Could not find a matching WordPress post/page for ${page.url} - skipping fixes.`);
      return fixesApplied;
    }

    let newTitle = null;
    let newMetaDescription = null;
    let newSchema = null;

    // --- Title fixes ---
    if (
      issueTypes.includes("missing_title") ||
      issueTypes.includes("title_too_short") ||
      issueTypes.includes("title_too_long")
    ) {
      console.log(`   🤖 Generating SEO title for ${page.url} ...`);
      newTitle = await ai.generateTitle(page);
      await delay(config.API_DELAY_MS);
    }

    // --- Meta description fixes ---
    if (
      issueTypes.includes("missing_meta_description") ||
      issueTypes.includes("meta_description_too_short") ||
      issueTypes.includes("meta_description_too_long")
    ) {
      console.log(`   🤖 Generating meta description for ${page.url} ...`);
      newMetaDescription = await ai.generateMetaDescription(page);
      await delay(config.API_DELAY_MS);
    }

    // --- Schema fixes ---
    if (issueTypes.includes("missing_schema")) {
      console.log(`   🤖 Generating schema markup for ${page.url} ...`);
      newSchema = await ai.generateSchema(page);
      await delay(config.API_DELAY_MS);
    }

    // Apply title / meta description / schema together
    if (newTitle || newMetaDescription || newSchema) {
      await fixer.updatePostSEO(wpPost.id, {
        title: newTitle || undefined,
        metaDescription: newMetaDescription || undefined,
        schema: newSchema || undefined,
        postType: wpPost.type
      }, creds);

      fixesApplied.title = newTitle || null;
      fixesApplied.metaDescription = newMetaDescription || null;
      fixesApplied.schema = newSchema || null;

      await delay(config.API_DELAY_MS);
    }

    // --- Image alt text fixes ---
    const altIssue = (page.issues || []).find((issue) => issue.type === "images_missing_alt");

    if (altIssue && altIssue.images && altIssue.images.length > 0) {
      for (const img of altIssue.images) {
        try {
          console.log(`   🤖 Generating alt text for image: ${img.src}`);
          const altText = await ai.generateAltText(img.src, page);
          await delay(config.API_DELAY_MS);

          if (!altText) continue;

          const mediaId = await fixer.findMediaByUrl(img.src, creds);
          await delay(config.API_DELAY_MS);

          if (mediaId) {
            const success = await fixer.updateImageAlt(mediaId, altText, creds);
            if (success) fixesApplied.altTextsFixed += 1;
          } else {
            console.log(`   ⚠️  Could not find media item for ${img.src} - skipping alt text update.`);
          }
        } catch (err) {
          console.log(`   ⚠️  Failed to fix image alt text for ${img.src}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.log(`⚠️  Failed to fix page ${page.url}: ${err.message}`);
  }

  return fixesApplied;
}

/**
 * Run AI-powered auto-fix for every page that has issues.
 * Saves the final report (including fix results) and returns
 * the fix results array.
 */
async function runAutoFix(analyzedPages, site = null) {
  const siteId = site ? site.id : null;
  const pagesWithIssues = analyzedPages.filter((page) => (page.issues || []).length > 0);

  if (pagesWithIssues.length === 0) {
    console.log("\n🎉 No issues found - nothing to fix!");
    return [];
  }

  console.log("\n🔧 Starting auto-fix process...\n");

  const fixResults = [];

  for (let i = 0; i < pagesWithIssues.length; i++) {
    const page = pagesWithIssues[i];

    console.log(`\n[${i + 1}/${pagesWithIssues.length}] Fixing: ${page.url}`);

    try {
      const result = await fixPage(page, site);
      fixResults.push(result);
    } catch (err) {
      console.log(`⚠️  Error fixing ${page.url}: ${err.message}`);
    }

    await delay(config.API_DELAY_MS);
  }

  const keywordData = analyzeKeywords(analyzedPages);
  reporter.saveReport(analyzedPages, { fixes: fixResults, keywords: keywordData }, siteId);

  const totalAltFixed = fixResults.reduce((sum, r) => sum + (r.altTextsFixed || 0), 0);
  const totalTitlesFixed = fixResults.filter((r) => r.title).length;
  const totalMetaFixed = fixResults.filter((r) => r.metaDescription).length;
  const totalSchemaFixed = fixResults.filter((r) => r.schema).length;

  console.log("\n" + "=".repeat(60));
  console.log("🏁 AUTO-FIX COMPLETE");
  console.log("=".repeat(60));
  console.log(`✏️  Titles updated: ${totalTitlesFixed}`);
  console.log(`📝 Meta descriptions updated: ${totalMetaFixed}`);
  console.log(`🧩 Schema markup injected: ${totalSchemaFixed}`);
  console.log(`🖼️  Image alt texts updated: ${totalAltFixed}`);
  console.log("=".repeat(60));
  console.log("\n✅ Done! Final report saved.");

  return fixResults;
}

/**
 * Generate AI-powered, site-wide SEO improvement suggestions for an
 * already-analyzed set of pages and save them into the report.
 */
async function runSuggestions(analyzedPages, site = null) {
  const siteId = site ? site.id : null;
  const keywordData = analyzeKeywords(analyzedPages);

  console.log("\n🤖 Generating SEO improvement suggestions...");
  const suggestions = await ai.generateSiteSuggestions(analyzedPages, keywordData);

  const existing = reporter.loadReport(siteId) || {};
  reporter.saveReport(analyzedPages, {
    ...existing,
    keywords: keywordData,
    suggestions
  }, siteId);

  console.log(`✅ Generated ${suggestions.length} suggestion(s).`);
  return suggestions;
}

/**
 * Generate non-destructive per-page meta title/description/keywords
 * suggestions for every page with issues, and save them into the report.
 */
async function runMetaSuggestions(analyzedPages, site = null) {
  const siteId = site ? site.id : null;

  console.log("\n🤖 Generating per-page meta suggestions...");

  const metaSuggestions = {};
  const pagesToSuggest = analyzedPages.filter((page) => (page.issues || []).length > 0);

  for (let i = 0; i < pagesToSuggest.length; i++) {
    const page = pagesToSuggest[i];
    console.log(`   [${i + 1}/${pagesToSuggest.length}] ${page.url}`);

    const suggestion = await ai.suggestMetaForPage(page);
    if (suggestion) metaSuggestions[page.url] = suggestion;

    await delay(config.API_DELAY_MS);
  }

  const existing = reporter.loadReport(siteId) || {};
  reporter.saveReport(analyzedPages, {
    ...existing,
    metaSuggestions
  }, siteId);

  console.log(`✅ Generated meta suggestions for ${Object.keys(metaSuggestions).length} page(s).`);
  return metaSuggestions;
}

module.exports = {
  runAudit,
  runAutoFix,
  runSuggestions,
  runMetaSuggestions,
  fixPage,
  delay
};
