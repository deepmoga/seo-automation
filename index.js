// index.js
// Main entry point for the On-Page SEO Automation System.
//
// Flow:
//   1. Crawl the site for internal pages
//   2. Analyze each page for SEO issues + score
//   3. Print a report to the console
//   4. Ask the user whether to auto-fix issues
//   5. If yes, generate AI fixes and apply them via the WP REST API
//   6. Save the final report

const readline = require("readline");

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
 * Ask the user a yes/no question on the CLI. Returns true for "yes".
 */
function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "yes" || normalized === "y");
    });
  });
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
 * Main program flow.
 */
async function main() {
  const args = process.argv.slice(2);
  const crawlOnly = args.includes("--crawl-only");

  console.log("🚀 Starting On-Page SEO Automation System");
  console.log(`🌐 Target site: ${config.SITE_URL}\n`);

  // 1. Crawl the site
  let pages = [];
  try {
    pages = await crawlSite();
  } catch (err) {
    console.log(`❌ Crawl failed: ${err.message}`);
    return;
  }

  if (pages.length === 0) {
    console.log("❌ No pages were crawled. Exiting.");
    return;
  }

  // 2. Analyze pages for SEO issues
  let analyzedPages = [];
  try {
    analyzedPages = analyzePages(pages);
  } catch (err) {
    console.log(`❌ Analysis failed: ${err.message}`);
    return;
  }

  // 3. Print report
  try {
    reporter.printReport(analyzedPages);
  } catch (err) {
    console.log(`⚠️  Failed to print report: ${err.message}`);
  }

  // Save initial report
  reporter.saveReport(analyzedPages);

  if (crawlOnly) {
    console.log("\n🏁 Crawl-only mode complete. Skipping auto-fix step.");
    return;
  }

  // 4. Ask for confirmation before auto-fixing
  const pagesWithIssues = analyzedPages.filter((page) => (page.issues || []).length > 0);

  if (pagesWithIssues.length === 0) {
    console.log("\n🎉 No issues found - nothing to fix!");
    return;
  }

  const confirmed = await askConfirmation(
    `\n❓ Do you want to auto-fix these issues for ${pagesWithIssues.length} page(s)? (yes/no): `
  );

  if (!confirmed) {
    console.log("\n👋 Skipping auto-fix. Final report saved to report.json.");
    return;
  }

  // 5. Apply AI-generated fixes via WordPress REST API
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

  // 6. Save final report including fix results
  reporter.saveReport(analyzedPages, { fixes: fixResults });

  // 7. Completion summary
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
}

// Run and never let an unhandled error crash the process silently
main().catch((err) => {
  console.log(`❌ Fatal error: ${err.message}`);
});
