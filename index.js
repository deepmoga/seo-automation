// index.js
// CLI entry point for the On-Page SEO Automation System.
//
// Flow:
//   1. Crawl the site for internal pages
//   2. Analyze each page for SEO issues + score
//   3. Print a report to the console
//   4. Ask the user whether to auto-fix issues
//   5. If yes, generate AI fixes and apply them via the WP REST API
//   6. Save the final report

const readline = require("readline");

const runner = require("./runner");

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
 * Main program flow.
 */
async function main() {
  const args = process.argv.slice(2);
  const crawlOnly = args.includes("--crawl-only");

  // 1-3. Crawl, analyze, print + save report
  let analyzedPages = [];
  try {
    analyzedPages = await runner.runAudit();
  } catch (err) {
    console.log(`❌ ${err.message}`);
    return;
  }

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

  // 5-6. Apply AI-generated fixes via WordPress REST API + save final report
  await runner.runAutoFix(analyzedPages);
}

// Run and never let an unhandled error crash the process silently
main().catch((err) => {
  console.log(`❌ Fatal error: ${err.message}`);
});
