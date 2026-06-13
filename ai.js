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

module.exports = {
  generateTitle,
  generateMetaDescription,
  generateAltText,
  generateSchema
};
