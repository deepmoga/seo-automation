// search-console.js
// Minimal Google Search Console integration via raw OAuth2 + REST calls
// (no `googleapis` dependency). Provides real impressions/clicks/CTR/
// position data per query, to validate AI suggestions against reality.

const axios = require("axios");
const config = require("./config");
const tokenStore = require("./gsc-token-store");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/**
 * Build the Google OAuth consent URL for the user to visit.
 */
function getAuthUrl(redirectUri) {
  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent"
  });

  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an OAuth authorization code for access/refresh tokens and
 * persist them.
 */
async function exchangeCode(code, redirectUri) {
  const { data } = await axios.post(TOKEN_URL, new URLSearchParams({
    code,
    client_id: config.GOOGLE_CLIENT_ID,
    client_secret: config.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  }).toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  tokenStore.saveToken({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry: Date.now() + (data.expires_in || 3600) * 1000
  });

  return data;
}

/**
 * Refresh the access token using the stored refresh token.
 */
async function refreshAccessToken(token) {
  const { data } = await axios.post(TOKEN_URL, new URLSearchParams({
    refresh_token: token.refresh_token,
    client_id: config.GOOGLE_CLIENT_ID,
    client_secret: config.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token"
  }).toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  const updated = {
    access_token: data.access_token,
    refresh_token: token.refresh_token,
    expiry: Date.now() + (data.expires_in || 3600) * 1000
  };

  tokenStore.saveToken(updated);
  return updated;
}

/**
 * Get a valid access token, refreshing it first if it's expired/about
 * to expire. Throws if not connected.
 */
async function getAccessToken() {
  let token = tokenStore.getToken();
  if (!token) throw new Error("Google Search Console is not connected.");

  if (!token.expiry || Date.now() > token.expiry - 60000) {
    token = await refreshAccessToken(token);
  }

  return token.access_token;
}

function isConnected() {
  return !!tokenStore.getToken();
}

function disconnect() {
  tokenStore.clearToken();
}

/**
 * List Search Console properties (sites) verified for this account.
 */
async function listSites() {
  const accessToken = await getAccessToken();

  const { data } = await axios.get("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  return (data.siteEntry || []).map((entry) => entry.siteUrl);
}

/**
 * Query Search Analytics for a property (siteUrl, e.g. "https://example.com/"
 * or "sc-domain:example.com").
 * Returns { totals: {clicks, impressions, ctr, position}, rows: [...] }
 */
async function querySearchAnalytics(siteUrl, { days = 28, dimensions = ["query"], rowLimit = 20 } = {}) {
  const accessToken = await getAccessToken();

  const end = new Date();
  end.setDate(end.getDate() - 3); // GSC data has ~2-3 day lag
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const fmt = (d) => d.toISOString().slice(0, 10);

  const { data } = await axios.post(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions,
      rowLimit
    },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const rows = (data.rows || []).map((row) => ({
    keys: row.keys,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position
  }));

  const totals = rows.reduce(
    (acc, row) => {
      acc.clicks += row.clicks;
      acc.impressions += row.impressions;
      acc.positionSum += row.position * row.impressions;
      return acc;
    },
    { clicks: 0, impressions: 0, positionSum: 0 }
  );

  return {
    totals: {
      clicks: totals.clicks,
      impressions: totals.impressions,
      ctr: totals.impressions ? totals.clicks / totals.impressions : 0,
      position: totals.impressions ? totals.positionSum / totals.impressions : 0
    },
    rows
  };
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  getAccessToken,
  isConnected,
  disconnect,
  listSites,
  querySearchAnalytics
};
