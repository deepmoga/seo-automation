// jobs.js
// Shared background job state/runner used by both the web dashboard
// (server.js) and the scheduler (scheduler.js), so scheduled audits
// show up in the same status/log feed as manually-triggered ones.

const runner = require("./runner");
const reporter = require("./reporter");
const historyStore = require("./history-store");
const notifier = require("./notifier");

const SCORE_CHANGE_THRESHOLD = 5;

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
      const previous = historyStore.getHistory(site.id).slice(-1)[0] || null;
      historyStore.appendHistory(site.id, analyzedPages);
      await notifyAuditResult(site, analyzedPages, previous);
    } else if (mode === "audit-fix") {
      const analyzedPages = await runner.runAudit(site);
      const previous = historyStore.getHistory(site.id).slice(-1)[0] || null;
      historyStore.appendHistory(site.id, analyzedPages);
      await runner.runAutoFix(analyzedPages, site);
      await notifyAuditResult(site, analyzedPages, previous);
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
    } else if (mode === "pagespeed") {
      const existing = reporter.loadReport(site.id);
      if (!existing || !existing.pages) {
        throw new Error("No audit report found. Run an audit first.");
      }
      await runner.runPageSpeed(existing.pages, site);
    } else {
      throw new Error(`Unknown job mode: ${mode}`);
    }

    job.status = "done";
  } catch (err) {
    job.status = "error";
    job.error = err.message;
    pushLog(`❌ ${err.message}`);

    try {
      await notifier.notify(
        `❌ SEO Audit Failed: ${site.name || site.siteUrl}`,
        `The "${mode}" job for ${site.siteUrl} failed:\n${err.message}`
      );
    } catch (notifyErr) {
      pushLog(`⚠️  Failed to send failure notification: ${notifyErr.message}`);
    }
  } finally {
    console.log = originalLog;
    job.finishedAt = new Date().toISOString();
  }
}

/**
 * Send a Telegram/email summary after an audit completes, including a
 * score-drop/improvement alert if it changed by more than the threshold.
 */
async function notifyAuditResult(site, analyzedPages, previous) {
  const summary = historyStore.summarize(analyzedPages);
  const siteName = site.name || site.siteUrl;

  let scoreLine = `Average SEO score: ${summary.avgScore}/100`;
  if (previous) {
    const diff = summary.avgScore - previous.avgScore;
    if (diff <= -SCORE_CHANGE_THRESHOLD) {
      scoreLine += `\n⚠️ Score dropped by ${Math.abs(diff)} points (was ${previous.avgScore})`;
    } else if (diff >= SCORE_CHANGE_THRESHOLD) {
      scoreLine += `\n✅ Score improved by ${diff} points (was ${previous.avgScore})`;
    }
  }

  const message = [
    `Site: ${siteName} (${site.siteUrl})`,
    `Pages crawled: ${summary.totalPages}`,
    scoreLine,
    `Issues - Critical: ${summary.critical}, Warning: ${summary.warning}, Info: ${summary.info}`
  ].join("\n");

  try {
    await notifier.notify(`✅ SEO Audit Complete: ${siteName}`, message);
  } catch (err) {
    pushLog(`⚠️  Failed to send audit notification: ${err.message}`);
  }
}

module.exports = {
  job,
  runJob,
  pushLog
};
