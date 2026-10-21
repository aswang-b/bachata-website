import { supabase } from './supabase';
import {
  getGoogleAccessToken,
  listCalendarEvents,
  insertCalendarEvent,
  updateCalendarEvent,
  googleColorIdToSiteColor,
  siteColorToGoogleColorId,
  type EventVisibility,
  type GoogleCalendarEvent,
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

// True when a site row and its Google event disagree on any field the two
// sides mirror (title, description, location, times, color).
function differsFromGoogle(
  row: {
    title: string;
    description: string | null;
    location: string | null;
    start_time: string;
    end_time: string;
    color: string | null;
  },
  gEvent: GoogleCalendarEvent,
  startTime: string,
  endTime: string
): boolean {
  const googleDescription = gEvent.description ? sanitizeEventDescriptionHtml(gEvent.description) : null;
  return (
    row.title !== (gEvent.summary ?? row.title) ||
    (row.description ?? null) !== googleDescription ||
    (row.location ?? null) !== (gEvent.location ?? null) ||
    Date.parse(row.start_time) !== Date.parse(startTime) ||
    Date.parse(row.end_time) !== Date.parse(endTime) ||
    !sameColorOnGoogle(row.color, gEvent.colorId)
  );
}

// Google only has 11 colors, so a picked "#rrggbb" color counts as unchanged
// while Google shows its closest one (compared as the site color each maps to,
// so e.g. Sage and Basil both count as green, as before).
function sameColorOnGoogle(siteColor: string | null, googleColorId: string | undefined): boolean {
  return googleColorIdToSiteColor(siteColorToGoogleColorId(siteColor ?? 'accent')) === googleColorIdToSiteColor(googleColorId);
}

export interface SyncResult {
  pulledCreated: number;
  pulledUpdated: number;
  pulledDeleted: number;
  pushedCreated: number;
  // Per-event failures that didn't abort the pass, so the admin can see them.
  errors: string[];
}

async function syncCalendar(accessToken: string, visibility: EventVisibility): Promise<SyncResult> {
  const now = Date.now();
  const timeMin = new Date(now - SYNC_WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now + SYNC_WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const googleEvents = await listCalendarEvents(accessToken, visibility, timeMin, timeMax);

  const { data: existingRows, error: rowsError } = await supabase
    .from('events')
    .select(
      'id, title, description, location, color, event_type, start_time, end_time, google_event_id, google_recurring_event_id, price_whole_series, price_drop_in, price_student, registration_closed, price_whole_series_early_bird, price_drop_in_early_bird, price_student_early_bird, early_bird_until, price_whole_series_flash_sale, price_drop_in_flash_sale, price_student_flash_sale, flash_sale_until, lesson_overview_title, lesson_overview_body, hide_lesson_overview, capacity, show_capacity, capacity_by_role, leader_capacity, follower_capacity, updated_at'
    )
    .eq('visibility', visibility)
    // The same window Google was asked for: a linked row past it would look
    // deleted on Google's side (and be deleted here), and an unlinked one
    // would be pushed before it's due. (Google's timeMax is exclusive.)
    .gte('start_time', timeMin)
    .lt('start_time', timeMax);

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
      color: string | null;
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
      lessonOverviewTitle: string | null;
      lessonOverviewBody: string | null;
      hideLessonOverview: boolean;
      capacity: number | null;
      showCapacity: boolean;
      capacityByRole: boolean;
      leaderCapacity: number | null;
      followerCapacity: number | null;
    }
  >();
  for (const r of rows) {
    if (r.google_recurring_event_id && !seriesMetaByRecurringId.has(r.google_recurring_event_id)) {
      seriesMetaByRecurringId.set(r.google_recurring_event_id, {
        eventType: r.event_type,
        color: r.color,
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
        lessonOverviewTitle: r.lesson_overview_title,
        lessonOverviewBody: r.lesson_overview_body,
        hideLessonOverview: r.hide_lesson_overview,
        capacity: r.capacity,
        showCapacity: r.show_capacity,
        capacityByRole: r.capacity_by_role,
        leaderCapacity: r.leader_capacity,
        followerCapacity: r.follower_capacity,
      });
    }
  }

  let pulledCreated = 0;
  let pulledUpdated = 0;
  let pulledDeleted = 0;
  let pushedCreated = 0;
  const errors: string[] = [];
  const recordError = (gEvent: { id: string; summary?: string }, message: string) => {
    const line = `Couldn't save "${gEvent.summary ?? 'Untitled event'}" (${gEvent.id}) from Google: ${message}`;
    console.error(line);
    errors.push(line);
  };

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

      // A plain insert, not an upsert: the unique index on google_event_id is
      // partial (WHERE google_event_id IS NOT NULL), and Postgres can't use a
      // partial index as an ON CONFLICT target, so every upsert here failed.
      // The index still blocks duplicates; a race with another sync pass (or a
      // leftover row outside the sync window) surfaces as 23505 and updates
      // that row in place instead.
      const { error: insertError } = await supabase.from('events').insert(
        {
          title: gEvent.summary ?? 'Untitled event',
          description: gEvent.description ? sanitizeEventDescriptionHtml(gEvent.description) : null,
          location: gEvent.location ?? null,
          event_type: seriesMeta?.eventType ?? 'event',
          // A series's picked color carries over unless the color was changed on Google.
          color: seriesMeta && sameColorOnGoogle(seriesMeta.color, gEvent.colorId) ? seriesMeta.color : googleColorIdToSiteColor(gEvent.colorId),
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
          lesson_overview_title: seriesMeta?.lessonOverviewTitle ?? null,
          lesson_overview_body: seriesMeta?.lessonOverviewBody ?? null,
          hide_lesson_overview: seriesMeta?.hideLessonOverview ?? false,
          capacity: seriesMeta?.capacity ?? null,
          show_capacity: seriesMeta?.showCapacity ?? false,
          capacity_by_role: seriesMeta?.capacityByRole ?? false,
          leader_capacity: seriesMeta?.leaderCapacity ?? null,
          follower_capacity: seriesMeta?.followerCapacity ?? null,
        }
      );
      if (!insertError) {
        pulledCreated += 1;
        return;
      }
      if (insertError.code === '23505') {
        const { error: updateError } = await supabase
          .from('events')
          .update({
            title: gEvent.summary ?? 'Untitled event',
            description: gEvent.description ? sanitizeEventDescriptionHtml(gEvent.description) : null,
            location: gEvent.location ?? null,
            start_time: startTime,
            end_time: endTime,
          })
          .eq('google_event_id', gEvent.id);
        if (!updateError) {
          pulledUpdated += 1;
          return;
        }
        recordError(gEvent, updateError.message);
        return;
      }
      recordError(gEvent, insertError.message);
      return;
    }

    // updated_at is bumped by a trigger on every row write, including the
    // pull itself and site-only fields (prices, class type), so "site row is
    // newer" alone doesn't mean anything Google mirrors changed. Without this
    // check every pulled occurrence was PATCHed straight back to Google on the
    // next pass, which tripped Google's per-user write rate limit (403).
    if (!differsFromGoogle(existing, gEvent, startTime, endTime)) return;

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
          // A picked color Google can only approximate stays as picked.
          color: sameColorOnGoogle(existing.color, gEvent.colorId) ? existing.color : googleColorIdToSiteColor(gEvent.colorId),
        })
        .eq('id', existing.id);
      if (updateError) recordError(gEvent, updateError.message);
      else pulledUpdated += 1;
    } else if (siteUpdated > googleUpdated) {
      // Caught per event so one rejected push (e.g. a Google 403) doesn't
      // abort the whole pass and block every other event from syncing.
      try {
        await updateCalendarEvent(accessToken, visibility, gEvent.id, {
          summary: existing.title,
          description: existing.description,
          location: existing.location,
          startTime: existing.start_time,
          endTime: existing.end_time,
          color: existing.color,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const line = `Couldn't push "${existing.title}" (${gEvent.id}) to Google: ${message}`;
        console.error(line);
        errors.push(line);
      }
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
    try {
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
      if (linkError) throw new Error(linkError.message);
      pushedCreated += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const line = `Couldn't push "${row.title}" to Google: ${message}`;
      console.error(line);
      errors.push(line);
    }
  });

  return { pulledCreated, pulledUpdated, pulledDeleted, pushedCreated, errors };
}

// Every per-event failure from a runCalendarSync() result, joined for display,
// or null when the pass was clean.
export function syncErrorText(result: { public: SyncResult; private: SyncResult }): string | null {
  const all = [...result.public.errors, ...result.private.errors];
  return all.length > 0 ? all.join('\n') : null;
}

export async function runCalendarSync(): Promise<{ public: SyncResult; private: SyncResult }> {
  const accessToken = await getGoogleAccessToken();

  const [publicResult, privateResult] = await Promise.all([
    syncCalendar(accessToken, 'public'),
    syncCalendar(accessToken, 'private'),
  ]);

  return { public: publicResult, private: privateResult };
}
