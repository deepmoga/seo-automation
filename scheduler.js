// scheduler.js
// Sets up node-cron jobs for sites that have an audit schedule
// configured ("daily" | "weekly"). Call reload() at startup and again
// any time sites are added/edited/deleted so schedules stay in sync.

const cron = require("node-cron");
const sitesStore = require("./sites-store");
const jobs = require("./jobs");

// siteId -> cron task
const tasks = new Map();

function scheduleExpression(schedule) {
  if (schedule === "daily") return "0 2 * * *"; // every day at 02:00
  if (schedule === "weekly") return "0 2 * * 1"; // every Monday at 02:00
  return null;
}

/**
 * Rebuild all cron tasks from the current sites configuration.
 */
function reload() {
  for (const task of tasks.values()) task.stop();
  tasks.clear();

  const sites = sitesStore.getSites();

  for (const site of sites) {
    const expr = scheduleExpression(site.schedule);
    if (!expr) continue;

    const task = cron.schedule(expr, async () => {
      if (jobs.job.status === "running") {
        console.log(`⏭️  Skipping scheduled audit for "${site.name}" - a job is already running.`);
        return;
      }

      const latestSite = sitesStore.getSite(site.id);
      if (!latestSite) return;

      const mode = latestSite.scheduleAutoFix ? "audit-fix" : "audit";
      console.log(`⏰ Running scheduled ${mode} for "${latestSite.name}"...`);

      try {
        await jobs.runJob(mode, latestSite);
      } catch (err) {
        console.log(`⚠️  Scheduled job for "${latestSite.name}" failed: ${err.message}`);
      }
    });

    tasks.set(site.id, task);
  }

  console.log(`⏰ Scheduler: ${tasks.size} site(s) with active schedules.`);
}

module.exports = { reload };
