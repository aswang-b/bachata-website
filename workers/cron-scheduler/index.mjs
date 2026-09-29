// Calls the site's calendar-sync endpoint on a schedule. Lives outside the
// web host on purpose: Vercel Hobby crons only run once a day, and this way
// the schedule keeps working no matter which host is serving the domain.
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runSync(env));
  },
};

async function runSync(env) {
  const res = await fetch(env.TARGET_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CRON_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  const body = await res.text();
  if (!res.ok) {
    // Throwing marks the invocation as failed in the Cloudflare dashboard.
    throw new Error(`Calendar sync cron failed: ${res.status} ${body}`);
  }
  console.log('Calendar sync cron ok:', body);
}
