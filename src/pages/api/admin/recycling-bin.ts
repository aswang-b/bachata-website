import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { RECYCLING_LOCK_RESOURCE, requireLock } from '../../../lib/editLock';
import { RecyclingBinError, emptyRecyclingBin, listRecyclingBin, restoreDeletion } from '../../../lib/recyclingBin';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function errorResponse(err: unknown, fallback: string) {
  return json({ error: err instanceof Error ? err.message : fallback }, err instanceof RecyclingBinError ? err.status : 500);
}

export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);

  try {
    return json({ items: await listRecyclingBin() });
  } catch (err) {
    return errorResponse(err, 'Failed to load the recycling bin.');
  }
};

// { action: 'restore', deletionId } puts one deleted item back;
// { action: 'empty' } permanently deletes everything in the bin.
export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);

  const body = await request.json().catch(() => null);
  const { action, holderId, deletionId } = body ?? {};

  try {
    await requireLock(RECYCLING_LOCK_RESOURCE, `${user.email}::${holderId}`);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Lock required.' }, 409);
  }

  try {
    if (action === 'restore') {
      if (typeof deletionId !== 'string' || !deletionId) return json({ error: 'Missing deletionId.' }, 400);
      await restoreDeletion(deletionId);
      return json({ ok: true });
    }
    if (action === 'empty') {
      await emptyRecyclingBin();
      return json({ ok: true });
    }
  } catch (err) {
    return errorResponse(err, action === 'empty' ? 'Failed to empty the recycling bin.' : 'Failed to restore.');
  }
  return json({ error: 'Unknown action.' }, 400);
};
