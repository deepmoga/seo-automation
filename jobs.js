// jobs.js
// Shared background job state/runner used by both the web dashboard
// (server.js) and the scheduler (scheduler.js), so scheduled audits
// show up in the same status/log feed as manually-triggered ones.

const runner = require("./runner");
const reporter = require("./reporter");
const historyStore = require("./history-store");

const job = {
  status: "idle", // idle | running | done | error
  mode: null, // "audit" | "audit-fix" | "suggestions" | "meta-suggestions"
  siteId: null,
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
 * Run a job in the background, capturing console.log output into
 * job.logs so the dashboard can show progress. Returns once finished.
 */
async function runJob(mode, site) {
  if (job.status === "running") return;

  job.status = "running";
  job.mode = mode;
  job.siteId = site.id;
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
    if (mode === "audit") {
      const analyzedPages = await runner.runAudit(site);
      historyStore.appendHistory(site.id, analyzedPages);
    } else if (mode === "audit-fix") {
      const analyzedPages = await runner.runAudit(site);
      historyStore.appendHistory(site.id, analyzedPages);
      await runner.runAutoFix(analyzedPages, site);
    } else if (mode === "suggestions") {
      const existing = reporter.loadReport(site.id);
      if (!existing || !existing.pages) {
        throw new Error("No audit report found. Run an audit first.");
      }
      await runner.runSuggestions(existing.pages, site);
    } else if (mode === "meta-suggestions") {
      const existing = reporter.loadReport(site.id);
      if (!existing || !existing.pages) {
        throw new Error("No audit report found. Run an audit first.");
      }
      await runner.runMetaSuggestions(existing.pages, site);
    } else {
      throw new Error(`Unknown job mode: ${mode}`);
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

module.exports = {
  job,
  runJob,
  pushLog
};
