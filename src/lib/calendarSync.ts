import { supabase } from './supabase';
import {
  refreshAccessToken,
  listCalendarEvents,
  insertCalendarEvent,
  updateCalendarEvent,
  googleColorIdToSiteColor,
  type EventVisibility,
} from './googleCalendar';
import { sanitizeEventDescriptionHtml } from './richText';

const SYNC_WINDOW_PAST_DAYS = 1;
const SYNC_WINDOW_FUTURE_DAYS = 180;

// Caps how many events are processed at once within a single sync pass, so a
// sync with hundreds of occurrences doesn't serialize one round trip after
// another (slow) while still staying well under Google Calendar's per-user
// rate limits (unlike an unbounded Promise.all would).
const SYNC_CONCURRENCY = 8;

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export interface SyncResult {
  pulledCreated: number;
  pulledUpdated: number;
  pulledDeleted: number;
  pushedCreated: number;
}

async function syncCalendar(accessToken: string, visibility: EventVisibility): Promise<SyncResult> {
  const now = Date.now();
  const timeMin = new Date(now - SYNC_WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now + SYNC_WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const googleEvents = await listCalendarEvents(accessToken, visibility, timeMin, timeMax);

  const { data: existingRows, error: rowsError } = await supabase
    .from('events')
    .select(
      'id, title, description, location, color, event_type, start_time, end_time, google_event_id, google_recurring_event_id, price_whole_series, price_drop_in, price_student, registration_closed, price_whole_series_early_bird, price_drop_in_early_bird, price_student_early_bird, early_bird_until, price_whole_series_flash_sale, price_drop_in_flash_sale, price_student_flash_sale, flash_sale_until, updated_at'
    )
    .eq('visibility', visibility)
    .gte('start_time', timeMin);

  if (rowsError) throw new Error(`Failed to load existing ${visibility} events: ${rowsError.message}`);

  const rows = existingRows ?? [];
  const rowsByGoogleId = new Map(rows.filter((r) => r.google_event_id).map((r) => [r.google_event_id as string, r]));

  // If a recurring series is edited directly on Google Calendar (time, day,
  // or pattern changed), Google regenerates every future instance's id while
  // the series' recurringEventId stays the same — so what looks like a
  // brand-new instance below is really an existing series occurrence, and
  // site-only data with no Google equivalent (price, class vs. event) needs
  // to be carried forward from a surviving sibling instead of being lost.
  const seriesMetaByRecurringId = new Map<
    string,
    {
      eventType: string;
      priceWholeSeries: number | null;
      priceDropIn: number | null;
      priceStudent: number | null;
      registrationClosed: boolean;
      priceWholeSeriesEarlyBird: number | null;
      priceDropInEarlyBird: number | null;
      priceStudentEarlyBird: number | null;
      earlyBirdUntil: string | null;
      priceWholeSeriesFlashSale: number | null;
      priceDropInFlashSale: number | null;
      priceStudentFlashSale: number | null;
      flashSaleUntil: string | null;
    }
  >();
  for (const r of rows) {
    if (r.google_recurring_event_id && !seriesMetaByRecurringId.has(r.google_recurring_event_id)) {
      seriesMetaByRecurringId.set(r.google_recurring_event_id, {
        eventType: r.event_type,
        priceWholeSeries: r.price_whole_series,
        priceDropIn: r.price_drop_in,
        priceStudent: r.price_student,
        registrationClosed: r.registration_closed,
        priceWholeSeriesEarlyBird: r.price_whole_series_early_bird,
        priceDropInEarlyBird: r.price_drop_in_early_bird,
        priceStudentEarlyBird: r.price_student_early_bird,
        earlyBirdUntil: r.early_bird_until,
        priceWholeSeriesFlashSale: r.price_whole_series_flash_sale,
        priceDropInFlashSale: r.price_drop_in_flash_sale,
        priceStudentFlashSale: r.price_student_flash_sale,
        flashSaleUntil: r.flash_sale_until,
      });
    }
  }

  let pulledCreated = 0;
  let pulledUpdated = 0;
  let pulledDeleted = 0;
  let pushedCreated = 0;

  const seenGoogleIds = new Set<string>();

  await mapConcurrent(googleEvents, SYNC_CONCURRENCY, async (gEvent) => {
    if (gEvent.status === 'cancelled') return;
    const startTime = gEvent.start?.dateTime ?? gEvent.start?.date;
    const endTime = gEvent.end?.dateTime ?? gEvent.end?.date;
    if (!startTime || !endTime) return;

    seenGoogleIds.add(gEvent.id);
    const existing = rowsByGoogleId.get(gEvent.id);

    if (!existing) {
      // New event added directly on this Google Calendar by any collaborator
      // with access — unless it's a regenerated instance of a series we
      // already track (see seriesMetaByRecurringId above), in which case its
      // class/event type and pricing are carried forward from a sibling
      // instead of falling back to generic "event" / no price.
      const seriesMeta = gEvent.recurringEventId ? seriesMetaByRecurringId.get(gEvent.recurringEventId) : undefined;

      // Upserted on google_event_id (unique constraint) rather than a bare
      // insert, so a race with another sync pass — or a leftover row that
      // still references this exact Google event — updates in place instead
      // of creating a duplicate.
      const { error: insertError } = await supabase.from('events').upsert(
        {
          title: gEvent.summary ?? 'Untitled event',
          description: gEvent.description ? sanitizeEventDescriptionHtml(gEvent.description) : null,
          location: gEvent.location ?? null,
          event_type: seriesMeta?.eventType ?? 'event',
          color: googleColorIdToSiteColor(gEvent.colorId),
          visibility,
          start_time: startTime,
          end_time: endTime,
          google_event_id: gEvent.id,
          google_recurring_event_id: gEvent.recurringEventId ?? null,
          price_whole_series: seriesMeta?.priceWholeSeries ?? null,
          price_drop_in: seriesMeta?.priceDropIn ?? null,
          price_student: seriesMeta?.priceStudent ?? null,
          registration_closed: seriesMeta?.registrationClosed ?? false,
          price_whole_series_early_bird: seriesMeta?.priceWholeSeriesEarlyBird ?? null,
          price_drop_in_early_bird: seriesMeta?.priceDropInEarlyBird ?? null,
          price_student_early_bird: seriesMeta?.priceStudentEarlyBird ?? null,
          early_bird_until: seriesMeta?.earlyBirdUntil ?? null,
          price_whole_series_flash_sale: seriesMeta?.priceWholeSeriesFlashSale ?? null,
          price_drop_in_flash_sale: seriesMeta?.priceDropInFlashSale ?? null,
          price_student_flash_sale: seriesMeta?.priceStudentFlashSale ?? null,
          flash_sale_until: seriesMeta?.flashSaleUntil ?? null,
        },
        { onConflict: 'google_event_id' }
      );
      if (!insertError) pulledCreated += 1;
      return;
    }

    const googleUpdated = gEvent.updated ? new Date(gEvent.updated).getTime() : 0;
    const siteUpdated = new Date(existing.updated_at).getTime();

    if (googleUpdated > siteUpdated) {
      const { error: updateError } = await supabase
        .from('events')
        .update({
          title: gEvent.summary ?? existing.title,
          description: gEvent.description ? sanitizeEventDescriptionHtml(gEvent.description) : null,
          location: gEvent.location ?? null,
          start_time: startTime,
          end_time: endTime,
        })
        .eq('id', existing.id);
      if (!updateError) pulledUpdated += 1;
    } else if (siteUpdated > googleUpdated) {
      await updateCalendarEvent(accessToken, visibility, gEvent.id, {
        summary: existing.title,
        description: existing.description,
        location: existing.location,
        startTime: existing.start_time,
        endTime: existing.end_time,
        color: existing.color,
      });
    }
  });

  // A row with a google_event_id we didn't see this pass was deleted on Google's side.
  const rowsDeletedOnGoogle = rows.filter((row) => row.google_event_id && !seenGoogleIds.has(row.google_event_id));
  await mapConcurrent(rowsDeletedOnGoogle, SYNC_CONCURRENCY, async (row) => {
    const { error: deleteError } = await supabase.from('events').delete().eq('id', row.id);
    if (!deleteError) pulledDeleted += 1;
  });

  // Push site-created rows (no google_event_id yet) to this calendar.
  const rowsToPush = rows.filter((r) => !r.google_event_id);
  await mapConcurrent(rowsToPush, SYNC_CONCURRENCY, async (row) => {
    const created = await insertCalendarEvent(accessToken, visibility, {
      siteEventId: row.id,
      summary: row.title,
      description: row.description,
      location: row.location,
      startTime: row.start_time,
      endTime: row.end_time,
      color: row.color,
    });
    const { error: linkError } = await supabase.from('events').update({ google_event_id: created.id }).eq('id', row.id);
    if (!linkError) pushedCreated += 1;
  });

  return { pulledCreated, pulledUpdated, pulledDeleted, pushedCreated };
}

export async function runCalendarSync(): Promise<{ public: SyncResult; private: SyncResult }> {
  const { data: tokenRow, error: tokenError } = await supabase
    .from('admin_google_tokens')
    .select('refresh_token')
    .limit(1)
    .maybeSingle();

  if (tokenError) throw new Error(`Failed to load admin Google token: ${tokenError.message}`);
  if (!tokenRow) throw new Error('No admin has connected Google Calendar yet.');

  const accessToken = await refreshAccessToken(tokenRow.refresh_token);

  const [publicResult, privateResult] = await Promise.all([
    syncCalendar(accessToken, 'public'),
    syncCalendar(accessToken, 'private'),
  ]);

  return { public: publicResult, private: privateResult };
}
