// server.js
// Web dashboard for the On-Page SEO Automation System.
// Lets you log in, manage multiple WordPress sites, trigger
// crawl/audit (+ optional AI auto-fix), view keyword analysis and
// AI-generated SEO suggestions, and manage credentials.
//
// Run with: node server.js   (or via PM2 in production)

const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const config = require("./config");
const reporter = require("./reporter");
const sitesStore = require("./sites-store");
const historyStore = require("./history-store");
const jobs = require("./jobs");
const scheduler = require("./scheduler");
const { readEnv, writeEnv, maskValue } = require("./env-store");
const searchConsole = require("./search-console");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---------------------------------------------------------------------
// Seed a default site from config.js / .env if none exist yet, so the
// dashboard always has at least one site to work with.
// ---------------------------------------------------------------------
if (sitesStore.getSites().length === 0) {
  sitesStore.addSite({
    name: "Default Site",
    siteUrl: config.SITE_URL,
    wpApiUrl: config.WP_API_URL,
    wpUsername: config.WP_USERNAME || "",
    wpAppPassword: config.WP_APP_PASSWORD || "",
    maxPages: config.MAX_PAGES
  });
}

// ---------------------------------------------------------------------
// Session setup - generate + persist a secret on first run
// ---------------------------------------------------------------------
const env = readEnv();
let sessionSecret = env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString("hex");
  writeEnv({ SESSION_SECRET: sessionSecret });
}

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 days
  })
);

// ---------------------------------------------------------------------
// Login page (no auth required)
// ---------------------------------------------------------------------
app.get("/style.css", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "style.css"));
});

function renderLoginPage(error = "") {
  const errorHtml = error ? `<div class="message error">${error}</div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Login - SEO Automation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <div class="card">
    <h1>🤖 SEO Automation</h1>
    <p class="subtitle">Login to access the dashboard.</p>
    ${errorHtml}
    <form method="POST" action="/login">
      <div class="field">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" autocomplete="username" required />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" autocomplete="current-password" required />
      </div>
      <button type="submit">Log In</button>
    </form>
  </div>
</body>
</html>`;
}

app.get("/login", (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect("/");
  res.send(renderLoginPage());
});

app.post("/login", (req, res) => {
  const current = readEnv();
  const adminUser = current.ADMIN_USER || config.ADMIN_USER;
  const adminPass = current.ADMIN_PASS || config.ADMIN_PASS;

  const { username, password } = req.body;

  if (username === adminUser && password === adminPass) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.redirect("/");
  }

  res.send(renderLoginPage("❌ Invalid username or password."));
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ---------------------------------------------------------------------
// Auth middleware - protects everything below this point
// ---------------------------------------------------------------------
app.use((req, res, next) => {
  if (req.session && req.session.authenticated) return next();

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  res.redirect("/login");
});

// ---------------------------------------------------------------------
// Sites API
// ---------------------------------------------------------------------
function publicSite(site) {
  return {
    id: site.id,
    name: site.name,
    siteUrl: site.siteUrl,
    wpApiUrl: site.wpApiUrl,
    wpUsername: site.wpUsername,
    wpAppPasswordSet: !!site.wpAppPassword,
    wpLoginUrl: site.wpLoginUrl || `${site.siteUrl.replace(/\/+$/, "")}/wp-admin`,
    maxPages: site.maxPages,
    schedule: site.schedule || "off",
    scheduleAutoFix: !!site.scheduleAutoFix,
    gscProperty: site.gscProperty || ""
  };
}

app.get("/api/sites", (req, res) => {
  res.json({ sites: sitesStore.getSites().map(publicSite) });
});

app.post("/api/sites", (req, res) => {
  if (!req.body.siteUrl) {
    return res.status(400).json({ error: "siteUrl is required" });
  }
  const site = sitesStore.addSite(req.body);
  scheduler.reload();
  res.json({ ok: true, site: publicSite(site) });
});

app.put("/api/sites/:id", (req, res) => {
  const site = sitesStore.updateSite(req.params.id, req.body);
  if (!site) return res.status(404).json({ error: "Site not found" });
  scheduler.reload();
  res.json({ ok: true, site: publicSite(site) });
});

app.delete("/api/sites/:id", (req, res) => {
  const ok = sitesStore.deleteSite(req.params.id);
  if (!ok) return res.status(404).json({ error: "Site not found" });
  scheduler.reload();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Job / report API routes
// ---------------------------------------------------------------------

// Current job status + recent logs
app.get("/api/status", (req, res) => {
  const job = jobs.job;
  res.json({
    status: job.status,
    mode: job.mode,
    siteId: job.siteId,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    logs: job.logs
  });
});

// Latest saved report for a site
app.get("/api/report", (req, res) => {
  const siteId = req.query.siteId;
  if (!siteId) return res.status(400).json({ error: "siteId is required" });

  const data = reporter.loadReport(siteId);
  if (!data) return res.json({ exists: false });

  res.json({ exists: true, ...data });
});

// Score history for a site (for trend display)
app.get("/api/history", (req, res) => {
  const siteId = req.query.siteId;
  if (!siteId) return res.status(400).json({ error: "siteId is required" });

  res.json({ history: historyStore.getHistory(siteId) });
});

// Start a new job for a site
app.post("/api/run", (req, res) => {
  const mode = ["audit", "audit-fix", "suggestions", "meta-suggestions", "pagespeed"].includes(req.body.mode)
    ? req.body.mode
    : "audit";

  const site = sitesStore.getSite(req.body.siteId);
  if (!site) return res.status(404).json({ error: "Site not found" });

  if (jobs.job.status === "running") {
    return res.status(409).json({ error: "A job is already running." });
  }

  jobs.runJob(mode, site);
  res.json({ ok: true, mode, siteId: site.id });
});

// Site info for the dashboard header
app.get("/api/config", (req, res) => {
  const site = sitesStore.getSite(req.query.siteId) || sitesStore.getSites()[0];
  if (!site) return res.status(404).json({ error: "No sites configured" });

  res.json({
    siteId: site.id,
    name: site.name,
    siteUrl: site.siteUrl,
    maxPages: site.maxPages
  });
});

// ---------------------------------------------------------------------
// Google Search Console integration
// ---------------------------------------------------------------------

function googleRedirectUri(req) {
  return config.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get("host")}/auth/google/callback`;
}

// Status (for settings page UI)
app.get("/api/search-console/status", (req, res) => {
  res.json({
    configured: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
    connected: searchConsole.isConnected()
  });
});

// List verified Search Console properties (for picking a site's gscProperty)
app.get("/api/search-console/sites", async (req, res) => {
  try {
    const sites = await searchConsole.listSites();
    res.json({ sites });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search performance data for a dashboard site
app.get("/api/search-console", async (req, res) => {
  const site = sitesStore.getSite(req.query.siteId);
  if (!site) return res.status(404).json({ error: "Site not found" });

  const property = site.gscProperty || `${site.siteUrl.replace(/\/+$/, "")}/`;

  try {
    const data = await searchConsole.querySearchAnalytics(property, {
      days: 28,
      dimensions: ["query"],
      rowLimit: 20
    });
    res.json({ connected: true, property, ...data });
  } catch (err) {
    if (!searchConsole.isConnected()) {
      return res.json({ connected: false });
    }
    res.status(500).json({ connected: true, error: err.message });
  }
});

// Start the OAuth flow
app.get("/auth/google", (req, res) => {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    return res.redirect("/settings?gscError=" + encodeURIComponent("Add your Google Client ID/Secret first."));
  }
  res.redirect(searchConsole.getAuthUrl(googleRedirectUri(req)));
});

// OAuth callback
app.get("/auth/google/callback", async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect("/settings?gscError=" + encodeURIComponent(error || "No code returned from Google."));
  }

  try {
    await searchConsole.exchangeCode(code, googleRedirectUri(req));
    res.redirect("/settings?gscConnected=1");
  } catch (err) {
    const message = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    res.redirect("/settings?gscError=" + encodeURIComponent(message));
  }
});

// Disconnect Google account
app.post("/auth/google/disconnect", (req, res) => {
  searchConsole.disconnect();
  res.redirect("/settings");
});

// ---------------------------------------------------------------------
// Sites management page
// ---------------------------------------------------------------------
app.get("/sites", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "sites.html"));
});

// ---------------------------------------------------------------------
// Settings page - manage .env credentials from the browser
// ---------------------------------------------------------------------
const SETTINGS_FIELDS = [
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API Key",
    help: "Used to generate titles, meta descriptions, alt text, schema, suggestions (gpt-4o-mini)."
  },
  {
    key: "ADMIN_USER",
    label: "Dashboard Login Username",
    help: "Username used to log in to this dashboard."
  },
  {
    key: "ADMIN_PASS",
    label: "Dashboard Login Password",
    help: "Password used to log in to this dashboard."
  },
  {
    key: "PAGESPEED_API_KEY",
    label: "Google PageSpeed Insights API Key",
    help: "Free key from Google Cloud Console (enable 'PageSpeed Insights API'). Used for Core Web Vitals checks."
  },
  {
    key: "TELEGRAM_BOT_TOKEN",
    label: "Telegram Bot Token",
    help: "Create a bot via @BotFather on Telegram and paste its token here."
  },
  {
    key: "TELEGRAM_CHAT_ID",
    label: "Telegram Chat ID",
    help: "Your Telegram user/group/channel chat ID to receive audit alerts."
  },
  {
    key: "SMTP_HOST",
    label: "SMTP Host",
    help: "e.g. smtp.gmail.com - for sending email alerts."
  },
  {
    key: "SMTP_PORT",
    label: "SMTP Port",
    help: "e.g. 587 (TLS) or 465 (SSL)."
  },
  {
    key: "SMTP_USER",
    label: "SMTP Username",
    help: "Usually your email address."
  },
  {
    key: "SMTP_PASS",
    label: "SMTP Password",
    help: "App password or SMTP password."
  },
  {
    key: "NOTIFY_EMAIL_TO",
    label: "Send Alerts To (Email)",
    help: "Email address that receives audit completion/score-drop alerts."
  },
  {
    key: "GOOGLE_CLIENT_ID",
    label: "Google OAuth Client ID",
    help: "From Google Cloud Console (OAuth 2.0 Client). Used to connect Search Console."
  },
  {
    key: "GOOGLE_CLIENT_SECRET",
    label: "Google OAuth Client Secret",
    help: "From Google Cloud Console (OAuth 2.0 Client)."
  }
];

function renderSettingsPage(message = "", extra = {}) {
  const current = readEnv();

  const fieldsHtml = SETTINGS_FIELDS.map((field) => {
    const existing = current[field.key];
    const placeholder = existing ? `Current: ${maskValue(existing)} (leave blank to keep)` : "";

    return `
      <div class="field">
        <label for="${field.key}">${field.label}</label>
        <input type="password" id="${field.key}" name="${field.key}" placeholder="${placeholder}" autocomplete="off" />
        <p class="help">${field.help}</p>
      </div>`;
  }).join("\n");

  const messageHtml = message ? `<div class="message">${message}</div>` : "";

  const gscConfigured = !!(current.GOOGLE_CLIENT_ID && current.GOOGLE_CLIENT_SECRET);
  const gscConnected = searchConsole.isConnected();

  let gscStatusHtml;
  if (extra.gscError) {
    gscStatusHtml = `<div class="message error">❌ Google connection failed: ${extra.gscError}</div>`;
  } else if (extra.gscConnected) {
    gscStatusHtml = `<div class="message">✅ Google account connected successfully.</div>`;
  }

  const gscActionHtml = !gscConfigured
    ? `<p class="help">Save your Google OAuth Client ID/Secret above first, then connect.</p>`
    : gscConnected
      ? `<p class="help">✅ Connected to Google Search Console.</p>
         <form method="POST" action="/auth/google/disconnect"><button type="submit" class="btn-secondary">Disconnect Google Account</button></form>`
      : `<a href="/auth/google"><button type="button">Connect Google Account</button></a>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Settings - SEO Automation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-icon">🤖</span>
        <span class="brand-name">SEO Automation</span>
      </div>
      <nav class="side-nav">
        <a href="/"><span class="icon">📊</span>Dashboard</a>
        <a href="/sites"><span class="icon">🌐</span>Sites</a>
        <a href="/settings" class="active"><span class="icon">⚙️</span>Settings</a>
      </nav>
      <div class="sidebar-footer">
        <a href="/logout"><span class="icon">🚪</span>Logout</a>
      </div>
    </aside>

    <main class="main">
      <div class="content">
        <div class="topbar">
          <div>
            <h1>Settings</h1>
            <div class="page-subtitle muted">Global credentials &amp; login. Per-site WordPress credentials are managed on the <a href="/sites" style="color:#38bdf8;">Sites</a> page.</div>
          </div>
        </div>

        <div class="section">
          ${messageHtml}
          ${gscStatusHtml || ""}
          <form method="POST" action="/settings">
            ${fieldsHtml}
            <button type="submit">Save Settings</button>
          </form>
        </div>

        <div class="section">
          <h2>Google Search Console</h2>
          <p class="help">Connect your Google account to show real impressions, clicks, CTR and average position on the dashboard.</p>
          ${gscActionHtml}
        </div>
      </div>
    </main>
  </div>
</body>
</html>`;
}

app.get("/settings", (req, res) => {
  res.send(renderSettingsPage("", {
    gscConnected: req.query.gscConnected === "1",
    gscError: req.query.gscError || ""
  }));
});

app.post("/settings", (req, res) => {
  const newValues = {};

  for (const field of SETTINGS_FIELDS) {
    if (req.body[field.key]) {
      newValues[field.key] = req.body[field.key];
    }
  }

  writeEnv(newValues);
  console.log("✅ Settings saved to .env");

  res.send(renderSettingsPage("✅ Settings saved successfully."));
});

// ---------------------------------------------------------------------
// Static dashboard (public/)
// ---------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

app.listen(config.PORT, () => {
  console.log("🚀 SEO Automation dashboard running!");
  console.log(`🌐 Open: http://localhost:${config.PORT}`);
});

scheduler.reload();
