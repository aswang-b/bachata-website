import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { REASON_MAX_LENGTH } from '../../../lib/linkRules';
import { isSeriesKey, LinkInputError, linkSeries, listLinks, makeChooseOne, setRule, unlinkSeries, type RuleChoice } from '../../../lib/linksStore';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Every link and rule (both tables are small), for the editor's
// "Linked Classes/Events" section.
export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  try {
    return json(await listLinks());
  } catch (err) {
    console.error(err);
    return json({ error: 'Failed to load linked classes.' }, 500);
  }
};

// Changes take effect right away (not with the editor's Save), and answer
// with every link and rule so the editor redraws from what was saved.
export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  try {
    let flyerUrl: string | null | undefined;
    if (action === 'link' && isSeriesKey(body?.sourceKey) && isSeriesKey(body?.targetKey)) {
      ({ flyerUrl } = await linkSeries(body.sourceKey, body.targetKey));
    } else if (action === 'unlink' && isSeriesKey(body?.seriesKey)) {
      await unlinkSeries(body.seriesKey);
    } else if (action === 'rule' && isSeriesKey(body?.keyA) && isSeriesKey(body?.keyB) && ['both', 'exclusive', 'includes'].includes(body?.choice as string)) {
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (reason.length > REASON_MAX_LENGTH) return json({ error: `Keep the note to ${REASON_MAX_LENGTH} characters or fewer.` }, 400);
      await setRule(body.keyA, body.keyB, body.choice as RuleChoice, reason || null, body.countHeadcount !== false);
    } else if (action === 'choose-one' && isSeriesKey(body?.seriesKey)) {
      await makeChooseOne(body.seriesKey);
    } else {
      return json({ error: 'Unknown request.' }, 400);
    }
    return json({ ...(await listLinks()), flyerUrl });
  } catch (err) {
    if (err instanceof LinkInputError) return json({ error: err.message }, 400);
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Failed to save.' }, 500);
  }
};
