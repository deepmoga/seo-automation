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
    maxPages: site.maxPages,
    schedule: site.schedule || "off",
    scheduleAutoFix: !!site.scheduleAutoFix
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
  const mode = ["audit", "audit-fix", "suggestions", "meta-suggestions"].includes(req.body.mode)
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
  }
];

function renderSettingsPage(message = "") {
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Settings - SEO Automation</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <div class="card">
    <h1>🔑 Settings</h1>
    <p class="subtitle">Global credentials &amp; login. Per-site WordPress credentials are managed on the <a href="/sites" style="color:#38bdf8;">Sites</a> page.</p>
    ${messageHtml}
    <form method="POST" action="/settings">
      ${fieldsHtml}
      <button type="submit">Save Settings</button>
    </form>
    <p class="back"><a href="/">&larr; Back to Dashboard</a></p>
  </div>
</body>
</html>`;
}

app.get("/settings", (req, res) => {
  res.send(renderSettingsPage());
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
