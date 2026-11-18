/**
 * Local scheduler (GOAL G-PLT-6): calls the app's tick endpoint on a timer, as Supabase pg_cron does in the
 * cloud (docs/SETUP.md section 8). Runs as the `worker` service in docker-compose.yml, or `npm run worker`.
 *   TICK_URL (default http://localhost:3000/api/cron/tick), CRON_SECRET (required),
 *   TICK_EVERY_SECONDS (default 600, like the cloud schedule).
 */
const url = process.env.TICK_URL || "http://localhost:3000/api/cron/tick";
const secret = process.env.CRON_SECRET;
const every = Math.max(30, Number(process.env.TICK_EVERY_SECONDS || 600)) * 1000;
if (!secret) {
  console.error("[worker] CRON_SECRET is not set.");
  process.exit(1);
}
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);

async function tick() {
  try {
    const res = await fetch(url, { method: "POST", headers: { "x-cron-secret": secret } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) console.error(`[worker] ${stamp()} tick failed: HTTP ${res.status}`);
    else console.log(`[worker] ${stamp()} tick: ${body.processed ?? 0} job(s) run`);
  } catch {
    console.log(`[worker] ${stamp()} app not reachable yet at ${url}`);
  }
}

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = true; process.exit(0); });
console.log(`[worker] calling ${url} every ${every / 1000} s`);
while (!stopping) {
  await tick();
  await new Promise((r) => setTimeout(r, every));
}
