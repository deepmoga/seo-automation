// fixer.js
// Applies SEO fixes to WordPress via the REST API using Basic Auth
// (Application Passwords). Updates Yoast SEO fields when available,
// falls back to core fields otherwise. Never deletes existing content.

const axios = require("axios");
const config = require("./config");

/**
 * Build the Basic Auth header from WP_USERNAME + WP_APP_PASSWORD.
 */
function getAuthHeader() {
  const { WP_USERNAME, WP_APP_PASSWORD } = config;

  if (!WP_USERNAME || !WP_APP_PASSWORD) {
    throw new Error("WP_USERNAME or WP_APP_PASSWORD is not set in .env");
  }

  const token = Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString("base64");
  return `Basic ${token}`;
}

/**
 * Return an axios instance pre-configured with the WP REST API base URL
 * and auth header.
 */
function getApiClient() {
  return axios.create({
    baseURL: config.WP_API_URL,
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json"
    },
    timeout: 20000
  });
}

/**
 * Try to find a WordPress post or page by its front-end URL.
 * Searches both /posts and /pages endpoints by slug.
 * Returns { id, type } or null if not found.
 */
async function findPostByUrl(pageUrl) {
  try {
    const api = getApiClient();
    const url = new URL(pageUrl);

    // Slug is the last non-empty path segment (or empty for homepage)
    const segments = url.pathname.split("/").filter(Boolean);
    const slug = segments.length > 0 ? segments[segments.length - 1] : "";

    if (!slug) {
      return null; // homepage usually maps to a special "front page" setting
    }

    // Try posts first, then pages
    for (const type of ["posts", "pages"]) {
      try {
        const { data } = await api.get(`/${type}`, {
          params: { slug, status: "any" }
        });

        if (Array.isArray(data) && data.length > 0) {
          return { id: data[0].id, type };
        }
      } catch (err) {
        // try next type
      }
    }

    return null;
  } catch (err) {
    console.log(`⚠️  findPostByUrl failed for ${pageUrl}: ${err.message}`);
    return null;
  }
}

/**
 * Find a media library item by its source URL (used to update alt text).
 * Returns the media ID or null if not found.
 */
async function findMediaByUrl(imageUrl) {
  try {
    const api = getApiClient();
    const filename = imageUrl.split("/").pop().split("?")[0];

    const { data } = await api.get("/media", {
      params: { search: filename, per_page: 10 }
    });

    if (Array.isArray(data) && data.length > 0) {
      // Prefer exact source_url match if possible
      const exact = data.find((item) => item.source_url === imageUrl);
      return (exact || data[0]).id;
    }

    return null;
  } catch (err) {
    console.log(`⚠️  findMediaByUrl failed for ${imageUrl}: ${err.message}`);
    return null;
  }
}

/**
 * Update SEO fields for a post/page: title, meta description, and schema.
 *
 * @param {number} postId - WordPress post/page ID
 * @param {object} fixes - { title, metaDescription, schema, postType }
 *   postType defaults to "posts" if not provided.
 */
async function updatePostSEO(postId, fixes = {}) {
  const { title, metaDescription, schema, postType = "posts" } = fixes;

  try {
    const api = getApiClient();
    const payload = {};

    // Try Yoast SEO fields first (used by Yoast SEO plugin's REST support)
    if (title || metaDescription) {
      payload.meta = {};
      if (title) payload.meta.yoast_wpseo_title = title;
      if (metaDescription) payload.meta.yoast_wpseo_metadesc = metaDescription;
    }

    // Always also update the core title field as a fallback so the
    // SEO title is reflected even if Yoast is not installed.
    if (title) {
      payload.title = title;
    }

    if (Object.keys(payload).length > 0) {
      await api.post(`/${postType}/${postId}`, payload);
      console.log(`   ✏️  Updated SEO meta for ${postType} #${postId}`);

      if (title) console.log(`      • Title: "${title}"`);
      if (metaDescription) console.log(`      • Meta description: "${metaDescription}"`);
    }

    // Inject schema markup if provided
    if (schema) {
      await injectSchema(postId, schema, postType);
    }

    return true;
  } catch (err) {
    console.log(`⚠️  updatePostSEO failed for ${postType} #${postId}: ${err.message}`);
    return false;
  }
}

/**
 * Update the alt text of a media library image.
 *
 * @param {number} mediaId - WordPress media item ID
 * @param {string} altText - new alt text
 */
async function updateImageAlt(mediaId, altText) {
  if (!mediaId || !altText) return false;

  try {
    const api = getApiClient();
    await api.post(`/media/${mediaId}`, { alt_text: altText });

    console.log(`   🖼️  Updated alt text for media #${mediaId}: "${altText}"`);
    return true;
  } catch (err) {
    console.log(`⚠️  updateImageAlt failed for media #${mediaId}: ${err.message}`);
    return false;
  }
}

/**
 * Inject JSON-LD schema markup into a post's content as a final
 * <script type="application/ld+json"> element. Existing content is
 * preserved - the schema is appended, never replacing anything.
 *
 * @param {number} postId - WordPress post/page ID
 * @param {string|object} schemaJson - schema object or JSON string
 * @param {string} postType - "posts" or "pages"
 */
async function injectSchema(postId, schemaJson, postType = "posts") {
  if (!schemaJson) return false;

  try {
    const api = getApiClient();

    // Normalize schema to a JSON string
    const schemaString =
      typeof schemaJson === "string" ? schemaJson : JSON.stringify(schemaJson, null, 2);

    // Validate it's valid JSON
    JSON.parse(schemaString);

    // Fetch current content so we can append without losing anything
    const { data: post } = await api.get(`/${postType}/${postId}`, {
      params: { context: "edit" }
    });

    const currentContent = (post.content && post.content.raw) || post.content?.rendered || "";

    // Remove any previously injected schema block from this tool to avoid duplicates
    const marker = "<!-- SEO-AUTOMATION-SCHEMA -->";
    const markerEnd = "<!-- /SEO-AUTOMATION-SCHEMA -->";
    const markerRegex = new RegExp(`${marker}[\\s\\S]*?${markerEnd}`, "g");
    const cleanedContent = currentContent.replace(markerRegex, "").trimEnd();

    const schemaBlock = `\n\n${marker}\n<script type="application/ld+json">\n${schemaString}\n</script>\n${markerEnd}`;

    const newContent = `${cleanedContent}${schemaBlock}`;

    await api.post(`/${postType}/${postId}`, { content: newContent });

    console.log(`   🧩  Injected schema markup into ${postType} #${postId}`);
    return true;
  } catch (err) {
    console.log(`⚠️  injectSchema failed for ${postType} #${postId}: ${err.message}`);
    return false;
  }
}

module.exports = {
  findPostByUrl,
  findMediaByUrl,
  updatePostSEO,
  updateImageAlt,
  injectSchema
};
