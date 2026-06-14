// analyzer.js
// Analyzes crawled page data for common on-page SEO issues and
// calculates an overall SEO score (0-100) for each page.

const config = require("./config");

const {
  TITLE_MIN,
  TITLE_MAX,
  META_DESC_MIN,
  META_DESC_MAX,
  MIN_WORD_COUNT
} = config.THRESHOLDS;

/**
 * Run all SEO checks against a single page and return a list of issues.
 * Each issue has: type, message, severity ("critical" | "warning" | "info")
 */
function checkPage(page) {
  const issues = [];

  // --- Title tag checks ---
  if (!page.title) {
    issues.push({
      type: "missing_title",
      message: "Missing title tag",
      severity: "critical"
    });
  } else if (page.title.length < TITLE_MIN) {
    issues.push({
      type: "title_too_short",
      message: `Title tag too short (${page.title.length} chars, recommended ${TITLE_MIN}-${TITLE_MAX})`,
      severity: "warning"
    });
  } else if (page.title.length > TITLE_MAX) {
    issues.push({
      type: "title_too_long",
      message: `Title tag too long (${page.title.length} chars, recommended ${TITLE_MIN}-${TITLE_MAX})`,
      severity: "warning"
    });
  }

  // --- Meta description checks ---
  if (!page.metaDescription) {
    issues.push({
      type: "missing_meta_description",
      message: "Missing meta description",
      severity: "critical"
    });
  } else if (page.metaDescription.length < META_DESC_MIN) {
    issues.push({
      type: "meta_description_too_short",
      message: `Meta description too short (${page.metaDescription.length} chars, recommended ${META_DESC_MIN}-${META_DESC_MAX})`,
      severity: "warning"
    });
  } else if (page.metaDescription.length > META_DESC_MAX) {
    issues.push({
      type: "meta_description_too_long",
      message: `Meta description too long (${page.metaDescription.length} chars, recommended ${META_DESC_MIN}-${META_DESC_MAX})`,
      severity: "warning"
    });
  }

  // --- Meta keywords checks ---
  if (!page.metaKeywords) {
    issues.push({
      type: "missing_meta_keywords",
      message: "Missing meta keywords tag",
      severity: "info"
    });
  } else {
    const keywordCount = page.metaKeywords.split(",").map((k) => k.trim()).filter(Boolean).length;
    if (keywordCount > 10) {
      issues.push({
        type: "meta_keywords_stuffed",
        message: `Meta keywords tag has too many keywords (${keywordCount}, recommended up to 10) - looks like keyword stuffing`,
        severity: "info"
      });
    }
  }

  // --- H1 checks ---
  if (!page.h1 || page.h1.length === 0) {
    issues.push({
      type: "missing_h1",
      message: "Missing H1 tag",
      severity: "critical"
    });
  } else if (page.h1.length > 1) {
    issues.push({
      type: "multiple_h1",
      message: `Multiple H1 tags found (${page.h1.length})`,
      severity: "warning"
    });
  }

  // --- Image alt text checks ---
  const imagesMissingAlt = (page.images || []).filter((img) => !img.alt);
  if (imagesMissingAlt.length > 0) {
    issues.push({
      type: "images_missing_alt",
      message: `${imagesMissingAlt.length} image(s) missing alt text`,
      severity: "warning",
      images: imagesMissingAlt
    });
  }

  // --- Thin content check ---
  if (page.wordCount < MIN_WORD_COUNT) {
    issues.push({
      type: "thin_content",
      message: `Thin content: only ${page.wordCount} words (recommended ${MIN_WORD_COUNT}+)`,
      severity: "warning"
    });
  }

  // --- Internal links check ---
  if (!page.internalLinksCount || page.internalLinksCount === 0) {
    issues.push({
      type: "no_internal_links",
      message: "No internal links found on this page",
      severity: "info"
    });
  }

  // --- Canonical tag check ---
  if (!page.canonical) {
    issues.push({
      type: "missing_canonical",
      message: "Missing canonical tag",
      severity: "info"
    });
  }

  // --- Schema markup check ---
  if (!page.hasSchema) {
    issues.push({
      type: "missing_schema",
      message: "Missing schema markup (JSON-LD/microdata)",
      severity: "info"
    });
  }

  // --- Broken links check ---
  if (page.brokenLinks && page.brokenLinks.length > 0) {
    issues.push({
      type: "broken_links",
      message: `${page.brokenLinks.length} broken link(s) found on this page`,
      severity: "warning",
      links: page.brokenLinks
    });
  }

  return issues;
}

/**
 * Calculate an SEO score (0-100) for a page based on the severity of
 * its issues. Each severity level deducts a fixed number of points.
 */
function calculateScore(issues) {
  const PENALTIES = {
    critical: 15,
    warning: 7,
    info: 3
  };

  let score = 100;

  for (const issue of issues) {
    score -= PENALTIES[issue.severity] || 0;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Analyze an array of crawled pages. Returns a new array where each
 * page object is enriched with `issues` and `seoScore`.
 */
function analyzePages(pages) {
  console.log(`🧐 Analyzing ${pages.length} page(s) for SEO issues...`);

  const results = pages.map((page) => {
    let issues = [];

    try {
      issues = checkPage(page);
    } catch (err) {
      console.log(`⚠️  Failed to analyze ${page.url}: ${err.message}`);
    }

    const seoScore = calculateScore(issues);

    return {
      ...page,
      issues,
      seoScore
    };
  });

  console.log(`✅ Analysis complete.`);
  return results;
}

module.exports = {
  analyzePages,
  checkPage,
  calculateScore
};
