// ai.js
// OpenAI integration for generating SEO content: titles, meta descriptions,
// image alt text, and JSON-LD schema markup.

const OpenAI = require("openai");
const config = require("./config");

let client = null;

/**
 * Lazily create the OpenAI client. Throws a clear error if no API key
 * is configured so callers can handle it gracefully.
 */
function getClient() {
  if (!config.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set in .env");
  }

  if (!client) {
    client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }

  return client;
}

/**
 * Strip surrounding quotes/whitespace and markdown formatting that the
 * model sometimes adds, so we return a clean plain string.
 */
function cleanText(text) {
  if (!text) return "";

  return text
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "") // strip leading/trailing quotes
    .replace(/^#+\s*/, "") // strip leading markdown headers
    .trim();
}

/**
 * Build a short, human-readable summary of a page used as context
 * for AI prompts.
 */
function buildPageContext(pageData) {
  const h1 = (pageData.h1 && pageData.h1[0]) || "";
  const h2 = (pageData.h2 || []).slice(0, 3).join(", ");

  return [
    `URL: ${pageData.url}`,
    `Current title: ${pageData.title || "(none)"}`,
    `H1: ${h1 || "(none)"}`,
    `H2s: ${h2 || "(none)"}`,
    `Word count: ${pageData.wordCount || 0}`
  ].join("\n");
}

/**
 * Generate an SEO-optimized title tag (50-60 characters) that includes
 * the page's main keyword naturally and is compelling to click.
 */
async function generateTitle(pageData) {
  try {
    const openai = getClient();
    const context = buildPageContext(pageData);

    const response = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are an expert SEO copywriter. You write SEO title tags in English. " +
            "Reply with ONLY the title tag text, no quotes, no explanation, no extra formatting."
        },
        {
          role: "user",
          content:
            `Write an SEO-optimized title tag for the following web page. ` +
            `Requirements: 50-60 characters total, include the main keyword/topic naturally, ` +
            `make it compelling and click-worthy, and accurately reflect the page content.\n\n${context}`
        }
      ],
      temperature: 0.7,
      max_tokens: 60
    });

    const text = response.choices[0]?.message?.content || "";
    return cleanText(text);
  } catch (err) {
    console.log(`⚠️  AI generateTitle failed: ${err.message}`);
    return "";
  }
}

/**
 * Generate an SEO meta description (140-155 characters) that includes
 * the main keyword and ends with a call to action.
 */
async function generateMetaDescription(pageData) {
  try {
    const openai = getClient();
    const context = buildPageContext(pageData);

    const response = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are an expert SEO copywriter. You write meta descriptions in English. " +
            "Reply with ONLY the meta description text, no quotes, no explanation, no extra formatting."
        },
        {
          role: "user",
          content:
            `Write an SEO meta description for the following web page. ` +
            `Requirements: 140-155 characters total, include the main keyword/topic naturally, ` +
            `summarize the page value, and end with a short call to action.\n\n${context}`
        }
      ],
      temperature: 0.7,
      max_tokens: 80
    });

    const text = response.choices[0]?.message?.content || "";
    return cleanText(text);
  } catch (err) {
    console.log(`⚠️  AI generateMetaDescription failed: ${err.message}`);
    return "";
  }
}

/**
 * Generate descriptive, accessible alt text for an image based on its
 * URL and the surrounding page context.
 */
async function generateAltText(imageUrl, pageContext) {
  try {
    const openai = getClient();

    const contextText =
      typeof pageContext === "string" ? pageContext : buildPageContext(pageContext || {});

    const response = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are an expert in web accessibility and SEO. You write image alt text in English. " +
            "Reply with ONLY the alt text, no quotes, no explanation, no extra formatting."
        },
        {
          role: "user",
          content:
            `Write a concise, descriptive alt text (under 125 characters) for an image used on the ` +
            `following page. The alt text should describe what the image likely shows based on its ` +
            `filename/URL and the page context, and should naturally relate to the page topic.\n\n` +
            `Image URL: ${imageUrl}\n\nPage context:\n${contextText}`
        }
      ],
      temperature: 0.6,
      max_tokens: 50
    });

    const text = response.choices[0]?.message?.content || "";
    return cleanText(text);
  } catch (err) {
    console.log(`⚠️  AI generateAltText failed: ${err.message}`);
    return "";
  }
}

/**
 * Generate appropriate JSON-LD schema markup for a page (Article,
 * Service, LocalBusiness, etc.) based on its content/type.
 * Returns a JSON string (the JSON-LD object) or empty string on failure.
 */
async function generateSchema(pageData) {
  try {
    const openai = getClient();
    const context = buildPageContext(pageData);

    const response = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are an expert in structured data / schema.org markup. " +
            "Reply with ONLY a valid JSON-LD object (starting with { and ending with }), " +
            "no markdown code fences, no explanation."
        },
        {
          role: "user",
          content:
            `Generate the most appropriate JSON-LD schema markup (schema.org) for the following web page. ` +
            `Choose the schema type that best fits the page (e.g. Article, Service, LocalBusiness, ` +
            `WebPage, FAQPage, etc.) based on its content. Include "@context" and "@type" fields, ` +
            `and fill in reasonable values (name, description, url) based on the page data below.\n\n${context}`
        }
      ],
      temperature: 0.4,
      max_tokens: 400
    });

    const text = response.choices[0]?.message?.content || "";
    let cleaned = cleanText(text);

    // Strip markdown code fences if the model added them anyway
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

    // Validate JSON before returning
    JSON.parse(cleaned);

    return cleaned;
  } catch (err) {
    console.log(`⚠️  AI generateSchema failed: ${err.message}`);
    return "";
  }
}

/**
 * Generate a non-destructive suggestion for a page's title, meta
 * description and meta keywords - used to show "here's what we'd
 * suggest" without applying anything. Returns
 * { title, metaDescription, metaKeywords, reason } or null on failure.
 */
async function suggestMetaForPage(pageData) {
  try {
    const openai = getClient();
    const context = buildPageContext(pageData);

    const response = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are an expert SEO consultant. Reply with ONLY a valid JSON object " +
            '(no markdown fences) in this exact shape: ' +
            '{"title": "...", "metaDescription": "...", "metaKeywords": "...", "reason": "..."}. ' +
            "title must be 50-60 characters, metaDescription 140-155 characters, " +
            "metaKeywords a comma-separated list of up to 8 relevant keywords/phrases, " +
            "and reason a short (1-2 sentence) explanation of what changed and why."
        },
        {
          role: "user",
          content:
            `Current title: ${pageData.title || "(none)"}\n` +
            `Current meta description: ${pageData.metaDescription || "(none)"}\n` +
            `Current meta keywords: ${pageData.metaKeywords || "(none)"}\n\n` +
            `Page details:\n${context}\n\n` +
            `Suggest improved values for title, meta description and meta keywords. ` +
            `If the current values are already good, you may keep them mostly the same ` +
            `but still return all fields.`
        }
      ],
      temperature: 0.5,
      max_tokens: 300
    });

    const text = response.choices[0]?.message?.content || "";
    let cleaned = cleanText(text);
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

    const parsed = JSON.parse(cleaned);
    return {
      title: parsed.title || "",
      metaDescription: parsed.metaDescription || "",
      metaKeywords: parsed.metaKeywords || "",
      reason: parsed.reason || ""
    };
  } catch (err) {
    console.log(`⚠️  AI suggestMetaForPage failed for ${pageData.url}: ${err.message}`);
    return null;
  }
}

/**
 * Generate prioritized, site-wide SEO improvement suggestions based on
 * the analyzed pages and keyword analysis. Returns an array of
 * { title, detail, priority } objects, or [] on failure.
 */
async function generateSiteSuggestions(analyzedPages, keywordData = {}) {
  try {
    const openai = getClient();

    const totalPages = analyzedPages.length;
    const avgScore = totalPages
      ? Math.round(analyzedPages.reduce((s, p) => s + p.seoScore, 0) / totalPages)
      : 0;

    // Count issue types across the site
    const issueCounts = {};
    for (const page of analyzedPages) {
      for (const issue of page.issues || []) {
        issueCounts[issue.type] = (issueCounts[issue.type] || 0) + 1;
      }
    }

    const topIssues = Object.entries(issueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([type, count]) => `${type} (${count} pages)`)
      .join(", ");

    const topKeywords = (keywordData.topKeywords || [])
      .slice(0, 10)
      .map((k) => `${k.keyword} (used on ${k.pageCount} pages)`)
      .join(", ");

    const longTail = (keywordData.longTailKeywords || [])
      .slice(0, 10)
      .map((k) => `"${k.phrase}"`)
      .join(", ");

    const lowestScoringPages = [...analyzedPages]
      .sort((a, b) => a.seoScore - b.seoScore)
      .slice(0, 5)
      .map((p) => `${p.url} (score ${p.seoScore}/100, ${(p.issues || []).length} issues)`)
      .join("\n");

    const summary = [
      `Total pages crawled: ${totalPages}`,
      `Average SEO score: ${avgScore}/100`,
      `Most common issues across the site: ${topIssues || "none"}`,
      `Top recurring keywords/topics: ${topKeywords || "none detected"}`,
      `Long-tail keyword opportunities: ${longTail || "none detected"}`,
      `Lowest-scoring pages:\n${lowestScoringPages || "none"}`
    ].join("\n");

    const response = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a senior SEO consultant reviewing a full site audit. " +
            "Reply with ONLY a valid JSON array (no markdown fences) of 5-8 objects, " +
            'each shaped as {"title": "short action title", "detail": "1-3 sentence explanation/recommendation", "priority": "high"|"medium"|"low"}. ' +
            "Order from highest to lowest priority."
        },
        {
          role: "user",
          content:
            `Here is a summary of an on-page SEO audit for a WordPress website:\n\n${summary}\n\n` +
            `Based on this, provide prioritized, actionable SEO improvement suggestions ` +
            `covering on-page fixes, content/keyword strategy (including how to use the ` +
            `long-tail keyword opportunities), and overall site health.`
        }
      ],
      temperature: 0.6,
      max_tokens: 700
    });

    const text = response.choices[0]?.message?.content || "";
    let cleaned = cleanText(text);
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.log(`⚠️  AI generateSiteSuggestions failed: ${err.message}`);
    return [];
  }
}

module.exports = {
  generateTitle,
  generateMetaDescription,
  generateAltText,
  generateSchema,
  suggestMetaForPage,
  generateSiteSuggestions
};
