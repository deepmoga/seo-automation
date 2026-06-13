// server.js
// Web dashboard for the On-Page SEO Automation System.
// Lets you trigger a crawl/audit (and optional AI auto-fix) from the
// browser, view the latest report, and manage credentials.
//
// Run with: node server.js   (or via PM2 in production)

const express = require("express");
const config = require("./config");
const runner = require("./runner");
const reporter = require("./reporter");
const { readEnv, writeEnv, maskValue } = require("./env-store");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---------------------------------------------------------------------
// Basic Auth - protects the whole dashboard (credentials in .env)
// ---------------------------------------------------------------------
app.use((req, res, next) => {
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const [user, pass] = decoded.split(":");

    if (user === config.ADMIN_USER && pass === config.ADMIN_PASS) {
      return next();
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="SEO Automation Dashboard"');
  res.status(401).send("Authentication required.");
});

// ---------------------------------------------------------------------
// In-memory job state (single job at a time)
// ---------------------------------------------------------------------
const job = {
  status: "idle", // idle | running | done | error
  mode: null, // "audit" | "audit-fix"
  logs: [],
  startedAt: null,
  finishedAt: null,
  error: null
};

const MAX_LOG_LINES = 500;

function pushLog(...args) {
  const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  job.logs.push(line);
  if (job.logs.length > MAX_LOG_LINES) job.logs.shift();
}

/**
 * Run a job (audit or audit+fix) in the background, capturing
 * console.log output into job.logs so the dashboard can show progress.
 */
async function runJob(mode) {
  if (job.status === "running") return;

  job.status = "running";
  job.mode = mode;
  job.logs = [];
  job.startedAt = new Date().toISOString();
  job.finishedAt = null;
  job.error = null;

  const originalLog = console.log;
  console.log = (...args) => {
    pushLog(...args);
    originalLog(...args);
  };

  try {
    const analyzedPages = await runner.runAudit();

    if (mode === "audit-fix") {
      await runner.runAutoFix(analyzedPages);
    }

    job.status = "done";
  } catch (err) {
    job.status = "error";
    job.error = err.message;
    pushLog(`❌ ${err.message}`);
  } finally {
    console.log = originalLog;
    job.finishedAt = new Date().toISOString();
  }
}

// ---------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------

// Current job status + recent logs
app.get("/api/status", (req, res) => {
  res.json({
    status: job.status,
    mode: job.mode,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    logs: job.logs
  });
});

// Latest saved report.json (if any)
app.get("/api/report", (req, res) => {
  try {
    const reportPath = path.join(__dirname, "report.json");

    if (!fs.existsSync(reportPath)) {
      return res.json({ exists: false });
    }

    const data = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    res.json({ exists: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start a new audit / audit+fix job
app.post("/api/run", (req, res) => {
  const mode = req.body.mode === "audit-fix" ? "audit-fix" : "audit";

  if (job.status === "running") {
    return res.status(409).json({ error: "A job is already running." });
  }

  runJob(mode);
  res.json({ ok: true, mode });
});

// Basic site info for the dashboard header
app.get("/api/config", (req, res) => {
  res.json({
    siteUrl: config.SITE_URL,
    maxPages: config.MAX_PAGES
  });
});

// ---------------------------------------------------------------------
// Settings page - manage .env credentials from the browser
// ---------------------------------------------------------------------
const SETTINGS_FIELDS = [
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API Key",
    help: "Used to generate titles, meta descriptions, alt text, schema (gpt-4o-mini)."
  },
  {
    key: "WP_USERNAME",
    label: "WordPress Username",
    help: "Your WordPress admin/editor login username."
  },
  {
    key: "WP_APP_PASSWORD",
    label: "WordPress Application Password",
    help: "WP Admin -> Users -> Profile -> Application Passwords -> Add New."
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
    <p class="subtitle">Apni keys / login yahan update karo - .env file mein save hongi.</p>
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
  console.log(`👤 Login: ${config.ADMIN_USER} / (set in .env)`);
});
