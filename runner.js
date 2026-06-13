// runner.js
// Shared "core" logic used by both the CLI (index.js) and the web
// dashboard (server.js): crawl + analyze, and AI-powered auto-fix.

const config = require("./config");
const { crawlSite } = require("./crawler");
const { analyzePages } = require("./analyzer");
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
 * Crawl the site and analyze every page for SEO issues.
 * Saves report.json and returns the analyzed pages array.
 */
async function runAudit() {
  console.log("🚀 Starting On-Page SEO Automation System");
  console.log(`🌐 Target site: ${config.SITE_URL}\n`);

  const pages = await crawlSite();

  if (pages.length === 0) {
    throw new Error("No pages were crawled.");
  }

  const analyzedPages = analyzePages(pages);

  reporter.printReport(analyzedPages);
  reporter.saveReport(analyzedPages);

  return analyzedPages;
}

/**
 * For a single page, generate AI-powered fixes for the issues found
 * and apply them via the WordPress REST API.
 */
async function fixPage(page) {
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
    const wpPost = await fixer.findPostByUrl(page.url);

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
      });

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

          const mediaId = await fixer.findMediaByUrl(img.src);
          await delay(config.API_DELAY_MS);

          if (mediaId) {
            const success = await fixer.updateImageAlt(mediaId, altText);
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
 * Saves the final report.json (including fix results) and returns
 * the fix results array.
 */
async function runAutoFix(analyzedPages) {
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
      const result = await fixPage(page);
      fixResults.push(result);
    } catch (err) {
      console.log(`⚠️  Error fixing ${page.url}: ${err.message}`);
    }

    await delay(config.API_DELAY_MS);
  }

  reporter.saveReport(analyzedPages, { fixes: fixResults });

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
  console.log("\n✅ Done! Final report saved to report.json");

  return fixResults;
}

module.exports = {
  runAudit,
  runAutoFix,
  fixPage,
  delay
};
