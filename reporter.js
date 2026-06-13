// reporter.js
// Prints a readable, colored console report of the SEO audit and saves
// the full results to report.json.

const fs = require("fs");
const path = require("path");

// Simple ANSI color codes (no extra dependencies needed)
const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  bold: "\x1b[1m"
};

const SEVERITY_EMOJI = {
  critical: "🔴",
  warning: "🟡",
  info: "🔵"
};

const SEVERITY_COLOR = {
  critical: COLORS.red,
  warning: COLORS.yellow,
  info: COLORS.cyan
};

/**
 * Print the full SEO report to the console: per-page issues, scores,
 * and an overall summary table.
 */
function printReport(pages) {
  console.log("\n" + "=".repeat(60));
  console.log(`${COLORS.bold}📊  SEO AUDIT REPORT${COLORS.reset}`);
  console.log("=".repeat(60));

  console.log(`📄 Total pages crawled: ${pages.length}\n`);

  // Count issues by severity
  const counts = { critical: 0, warning: 0, info: 0 };

  for (const page of pages) {
    for (const issue of page.issues || []) {
      counts[issue.severity] = (counts[issue.severity] || 0) + 1;
    }
  }

  console.log(`${SEVERITY_EMOJI.critical} Critical issues: ${counts.critical}`);
  console.log(`${SEVERITY_EMOJI.warning} Warning issues:  ${counts.warning}`);
  console.log(`${SEVERITY_EMOJI.info} Info issues:     ${counts.info}\n`);

  // Per-page detail
  for (const page of pages) {
    const scoreColor = page.seoScore >= 80 ? COLORS.green : page.seoScore >= 50 ? COLORS.yellow : COLORS.red;

    console.log("-".repeat(60));
    console.log(`🔗 ${page.url}`);
    console.log(`   Score: ${scoreColor}${page.seoScore}/100${COLORS.reset}`);

    if (!page.issues || page.issues.length === 0) {
      console.log(`   ${COLORS.green}✅ No issues found${COLORS.reset}`);
    } else {
      for (const issue of page.issues) {
        const color = SEVERITY_COLOR[issue.severity] || COLORS.reset;
        const emoji = SEVERITY_EMOJI[issue.severity] || "•";
        console.log(`   ${emoji} ${color}${issue.message}${COLORS.reset}`);
      }
    }
  }

  console.log("-".repeat(60));

  // Summary table
  printSummaryTable(pages);
}

/**
 * Print a simple summary table: URL, score, and issue count.
 */
function printSummaryTable(pages) {
  console.log(`\n${COLORS.bold}📋 SUMMARY TABLE${COLORS.reset}`);
  console.log("-".repeat(80));
  console.log(
    `${"URL".padEnd(50)} | ${"Score".padEnd(7)} | ${"Issues".padEnd(7)}`
  );
  console.log("-".repeat(80));

  for (const page of pages) {
    const shortUrl = page.url.length > 48 ? page.url.slice(0, 45) + "..." : page.url;
    const issueCount = (page.issues || []).length;

    console.log(
      `${shortUrl.padEnd(50)} | ${String(page.seoScore).padEnd(7)} | ${String(issueCount).padEnd(7)}`
    );
  }

  console.log("-".repeat(80));

  const avgScore =
    pages.length > 0
      ? Math.round(pages.reduce((sum, p) => sum + p.seoScore, 0) / pages.length)
      : 0;

  console.log(`\n${COLORS.bold}📈 Average SEO score: ${avgScore}/100${COLORS.reset}\n`);
}

/**
 * Save the full report (pages with issues, scores, fixes applied)
 * to report.json in the project root.
 */
function saveReport(pages, extra = {}) {
  try {
    const reportPath = path.join(__dirname, "report.json");

    const report = {
      generatedAt: new Date().toISOString(),
      totalPages: pages.length,
      pages,
      ...extra
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`💾 Report saved to ${reportPath}`);
  } catch (err) {
    console.log(`⚠️  Failed to save report.json: ${err.message}`);
  }
}

module.exports = {
  printReport,
  printSummaryTable,
  saveReport
};
