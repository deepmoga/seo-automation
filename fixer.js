// fixer.js
// Applies SEO fixes to WordPress via the REST API using Basic Auth
// (Application Passwords). Updates Yoast SEO fields when available,
// falls back to core fields otherwise. Never deletes existing content.

const axios = require("axios");
const config = require("./config");

/**
 * Build a human-readable error message from an axios error, including
 * the WordPress REST API's own error message/code when available
 * (e.g. "401 rest_cannot_edit: Sorry, you are not allowed to edit this post.").
 */
function describeError(err) {
  const res = err.response;
  if (res) {
    const wpMessage = res.data && (res.data.message || res.data.code);
    return `${res.status}${wpMessage ? ` ${wpMessage}` : ""}`;
  }
  return err.message;
}

/**
 * Build the Basic Auth header from the given WP credentials, falling
 * back to global config (single-site/.env mode) if not provided.
 */
function getAuthHeader(creds = {}) {
  const wpUsername = creds.wpUsername || config.WP_USERNAME;
  const wpAppPassword = creds.wpAppPassword || config.WP_APP_PASSWORD;

  if (!wpUsername || !wpAppPassword) {
    throw new Error("WordPress username/application password is not configured for this site");
  }

  const token = Buffer.from(`${wpUsername}:${wpAppPassword}`).toString("base64");
  return `Basic ${token}`;
}

/**
 * Return an axios instance pre-configured with the WP REST API base URL
 * and auth header. Accepts optional { wpApiUrl, wpUsername, wpAppPassword }
 * to target a specific site; falls back to global config otherwise.
 */
function getApiClient(creds = {}) {
  return axios.create({
    baseURL: creds.wpApiUrl || config.WP_API_URL,
    headers: {
      Authorization: getAuthHeader(creds),
      "Content-Type": "application/json"
    },
    timeout: 20000
  });
}

// Cache of REST-enabled post type bases per WP API base URL, so we only
// hit /types once per site instead of once per page.
const restTypesCache = new Map();

/**
 * Fetch the list of REST API bases to search for a post by slug:
 * "posts" and "pages" first, then any other REST-enabled post types
 * (e.g. custom post types like "service", "portfolio", "product").
 */
async function getSearchableTypes(api, baseURL) {
  if (restTypesCache.has(baseURL)) return restTypesCache.get(baseURL);

  let types = ["posts", "pages"];

  try {
    const { data } = await api.get("/types");
    const customBases = Object.values(data)
      .map((t) => t.rest_base)
      .filter((base) => base && !types.includes(base));

    types = [...types, ...customBases];
  } catch (err) {
    // Fall back to the default posts/pages if /types isn't available
  }

  restTypesCache.set(baseURL, types);
  return types;
}

/**
 * Try to find a WordPress post or page by its front-end URL.
 * Searches /posts and /pages first, then any other REST-enabled custom
 * post types (e.g. "service", "product", "portfolio") by slug.
 * Returns { id, type } or null if not found.
 */
async function findPostByUrl(pageUrl, creds = {}) {
  try {
    const api = getApiClient(creds);
    const url = new URL(pageUrl);

    // Slug is the last non-empty path segment (or empty for homepage)
    const segments = url.pathname.split("/").filter(Boolean);
    const slug = segments.length > 0 ? segments[segments.length - 1] : "";

    if (!slug) {
      return null; // homepage usually maps to a special "front page" setting
    }

    const types = await getSearchableTypes(api, api.defaults.baseURL);

    for (const type of types) {
      // Try without a status filter first - this returns published
      // content and works even if Basic Auth isn't valid/configured.
      // "status: any" requires WordPress to recognize the request as
      // authenticated, and returns 400 Bad Request otherwise, so it's
      // only used as a fallback for drafts/private posts.
      for (const params of [{ slug }, { slug, status: "any" }]) {
        try {
          const { data } = await api.get(`/${type}`, { params });

          if (Array.isArray(data) && data.length > 0) {
            return { id: data[0].id, type };
          }
        } catch (err) {
          // try next params/type
        }
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
async function findMediaByUrl(imageUrl, creds = {}) {
  try {
    const api = getApiClient(creds);
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
async function updatePostSEO(postId, fixes = {}, creds = {}) {
  const { title, metaDescription, schema, postType = "posts" } = fixes;

  try {
    const api = getApiClient(creds);
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
      const schemaResult = await injectSchema(postId, schema, postType, creds);
      if (!schemaResult.success) return schemaResult;
    }

    return { success: true, error: null };
  } catch (err) {
    const error = describeError(err);
    console.log(`⚠️  updatePostSEO failed for ${postType} #${postId}: ${error}`);
    return { success: false, error };
  }
}

/**
 * Update the alt text of a media library image.
 *
 * @param {number} mediaId - WordPress media item ID
 * @param {string} altText - new alt text
 */
async function updateImageAlt(mediaId, altText, creds = {}) {
  if (!mediaId || !altText) return false;

  try {
    const api = getApiClient(creds);
    await api.post(`/media/${mediaId}`, { alt_text: altText });

    console.log(`   🖼️  Updated alt text for media #${mediaId}: "${altText}"`);
    return true;
  } catch (err) {
    console.log(`⚠️  updateImageAlt failed for media #${mediaId}: ${describeError(err)}`);
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
async function injectSchema(postId, schemaJson, postType = "posts", creds = {}) {
  if (!schemaJson) return { success: false, error: null };

  try {
    const api = getApiClient(creds);

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
    return { success: true, error: null };
  } catch (err) {
    const error = describeError(err);
    console.log(`⚠️  injectSchema failed for ${postType} #${postId}: ${error}`);
    return { success: false, error };
  }
}

module.exports = {
  findPostByUrl,
  findMediaByUrl,
  updatePostSEO,
  updateImageAlt,
  injectSchema
};
