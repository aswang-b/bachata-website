import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { isEventImageUrl } from '../../../lib/eventImages';
import {
  getGoogleAccessToken,
  GoogleNotConnectedError,
  insertCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  buildWeeklyRecurrenceRule,
  withCalendarDeadline,
  type EventVisibility,
} from '../../../lib/googleCalendar';
import { runCalendarSync, syncErrorText } from '../../../lib/calendarSync';
import { sanitizeEventDescriptionHtml } from '../../../lib/richText';
import { normalizeLessonOverviewOverride } from '../../../lib/homepageContent';
import { capacityColumns } from '../../../lib/capacity';
import { isValidEventColor } from '../../../lib/eventColors';
import { seriesAnchorEndDate } from '../../../lib/eventTimes';
import { zonedDateKey, zonedTimeOfDay } from '../../../lib/siteTime';

export const prerender = false;

// Includes legacy colors ('accent', 'yellow') so existing data of those
// colors keeps validating even though the admin picker no longer offers them.

async function pushRowToGoogle(
  accessToken: string,
  oldVisibility: EventVisibility,
  newVisibility: EventVisibility,
  oldGoogleEventId: string | null,
  row: {
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    start_time: string;
    end_time: string;
    color: string;
    google_event_id: string | null;
  }
) {
  const visibilityChanged = oldVisibility !== newVisibility;

  if (visibilityChanged && oldGoogleEventId) {
    await deleteCalendarEvent(accessToken, oldVisibility, oldGoogleEventId);
  }

  if (!visibilityChanged && row.google_event_id) {
    await updateCalendarEvent(accessToken, newVisibility, row.google_event_id, {
      summary: row.title,
      description: row.description,
      location: row.location,
      startTime: row.start_time,
      endTime: row.end_time,
      color: row.color,
    });
    return row.google_event_id;
  }

  const created = await insertCalendarEvent(accessToken, newVisibility, {
    siteEventId: row.id,
    summary: row.title,
    description: row.description,
    location: row.location,
    startTime: row.start_time,
    endTime: row.end_time,
    color: row.color,
  });
  return created.id;
}

const handlePost: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const {
    id,
    title,
    description,
    location,
    eventType,
    color,
    visibility,
    startTime,
    endTime,
    applyToSeries,
    rebuildSeries,
    recurrence,
    priceWholeSeries,
    priceDropIn,
    priceStudent,
    priceWholeSeriesEarlyBird,
    priceDropInEarlyBird,
    priceStudentEarlyBird,
    earlyBirdUntil,
    priceWholeSeriesFlashSale,
    priceDropInFlashSale,
    priceStudentFlashSale,
    flashSaleUntil,
    registrationClosed,
    imageUrl,
    flyerUrl,
    lessonOverviewTitle,
    lessonOverviewBody,
    hideLessonOverview,
  } = body ?? {};

  if (!id || !title || !startTime || !endTime) {
    return new Response(JSON.stringify({ error: 'Missing id, title, startTime, or endTime.' }), { status: 400 });
  }

  // Shown on the public homepage, so only this site's own uploads (see eventImages.ts).
  for (const url of [imageUrl, flyerUrl]) {
    if (url !== undefined && url !== null && url !== '' && !isEventImageUrl(url)) {
      return new Response(JSON.stringify({ error: 'Images must be uploaded from the editor.' }), { status: 400 });
    }
  }

  const { data: before, error: beforeError } = await supabase
    .from('events')
    .select('visibility, google_event_id, google_recurring_event_id')
    .eq('id', id)
    .maybeSingle();

  if (beforeError || !before) {
    return new Response(JSON.stringify({ error: 'Event not found.' }), { status: 404 });
  }

  // An e2e test class (visibility 'test', see testMode.ts) stays one, so
  // editing it never puts it on the live site; it never reaches Google.
  const isTestRow = before.visibility === 'test';
  const newVisibility: EventVisibility = visibility === 'private' ? 'private' : 'public';
  const rowVisibility = isTestRow ? 'test' : newVisibility;
  const oldVisibility = before.visibility as EventVisibility;
  const visibilityChanged = oldVisibility !== rowVisibility;
  // A named color or any "#rrggbb" from the color picker.
  const rowColor = isValidEventColor(color) ? color.toLowerCase() : 'accent';
  const rowEventType = eventType === 'event' ? 'event' : 'class';
  const toPrice = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));
  const toTimestamp = (v: unknown) => (v === '' || v === null || v === undefined ? null : String(v));
  const rowPriceWholeSeries = toPrice(priceWholeSeries);
  const rowPriceDropIn = toPrice(priceDropIn);
  const rowPriceStudent = toPrice(priceStudent);
  const rowPriceWholeSeriesEarlyBird = toPrice(priceWholeSeriesEarlyBird);
  const rowPriceDropInEarlyBird = toPrice(priceDropInEarlyBird);
  const rowPriceStudentEarlyBird = toPrice(priceStudentEarlyBird);
  const rowEarlyBirdUntil = toTimestamp(earlyBirdUntil);
  const rowPriceWholeSeriesFlashSale = toPrice(priceWholeSeriesFlashSale);
  const rowPriceDropInFlashSale = toPrice(priceDropInFlashSale);
  const rowPriceStudentFlashSale = toPrice(priceStudentFlashSale);
  const rowFlashSaleUntil = toTimestamp(flashSaleUntil);
  const rowRegistrationClosed = Boolean(registrationClosed);
  const rowImageUrl = imageUrl || null;
  // Left alone when a request doesn't send it, so saving from an older form can't clear the flyer.
  const rowFlyerColumns = flyerUrl === undefined ? {} : { flyer_url: typeof flyerUrl === 'string' && flyerUrl ? flyerUrl : null };
  const rowLessonOverview = normalizeLessonOverviewOverride(lessonOverviewTitle, lessonOverviewBody);
  const rowHideLessonOverview = Boolean(hideLessonOverview);
  const rowCapacityColumns = capacityColumns(body ?? {}, rowEventType);
  const rowDescription = description ? sanitizeEventDescriptionHtml(description) : null;

  // Tracks whether we actually managed to push this change to Google, so the
  // response can tell the admin their DB save succeeded but the calendar
  // sync didn't — instead of silently reporting a full success either way.
  let calendarSyncSkipped = false;
  // The first Google error hit, returned so the admin can read/copy it.
  let calendarSyncError: string | null = null;
  const noteSyncFailure = (err: unknown) => {
    calendarSyncSkipped = true;
    calendarSyncError ??= err instanceof Error ? err.message : String(err);
  };
  const accessToken = isTestRow ? null : await getGoogleAccessToken().catch((err) => {
    // No Google connection at all just means there's nothing to push to.
    if (err instanceof GoogleNotConnectedError) return null;
    console.error('Failed to get a Google access token; skipping calendar push:', err);
    noteSyncFailure(err);
    return null;
  });

  if (rebuildSeries && applyToSeries && before.google_recurring_event_id && recurrence) {
    // The recurrence pattern itself changed: the only way to change an
    // existing Google recurring event's pattern is to replace it — delete
    // the old master + every occurrence we've synced, then create a fresh
    // recurring master and let the sync pull the new occurrences back in.
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'No admin Google connection found.' }), { status: 500 });
    }

    const { data: siblings, error: siblingsError } = await supabase
      .from('events')
      .select('id, start_time')
      .eq('google_recurring_event_id', before.google_recurring_event_id);

    if (siblingsError || !siblings || siblings.length === 0) {
      return new Response(JSON.stringify({ error: 'Failed to load series.' }), { status: 500 });
    }

    const earliestStart = siblings.reduce((min, s) => (s.start_time < min ? s.start_time : min), siblings[0].start_time);
    // The series' first date and the new times as the site's time zone sees
    // them (the server's own zone is UTC, which shifted evening classes), sent
    // to Google as wall-clock times in that zone.
    const anchorDate = zonedDateKey(earliestStart);
    const timePart = zonedTimeOfDay(startTime);
    const endTimePart = zonedTimeOfDay(endTime);
    const anchorStart = `${anchorDate}T${timePart}:00`;
    // An end at or before the start time (e.g. ending at midnight) is on the next day.
    const anchorEndDate = seriesAnchorEndDate(anchorDate, timePart, endTimePart);
    const anchorEnd = `${anchorEndDate}T${endTimePart}:00`;

    try {
      await deleteCalendarEvent(accessToken, oldVisibility, before.google_recurring_event_id);
    } catch (err) {
      console.error('Failed to delete old recurring master:', err);
    }

    await supabase
      .from('events')
      .delete()
      .eq('google_recurring_event_id', before.google_recurring_event_id);

    try {
      const createdMaster = await insertCalendarEvent(accessToken, newVisibility, {
        siteEventId: id,
        summary: title,
        description: rowDescription,
        location: location || null,
        startTime: anchorStart,
        endTime: anchorEnd,
        color: rowColor,
        recurrence: buildWeeklyRecurrenceRule({
          byDay: recurrence.byDay,
          interval: Number(recurrence.interval) || 1,
          count: recurrence.endType === 'count' ? Number(recurrence.count) || undefined : undefined,
          until: recurrence.endType === 'until' ? recurrence.until : undefined,
        }),
      });
      const rebuildSyncError = syncErrorText(await runCalendarSync());
      if (rebuildSyncError) noteSyncFailure(new Error(rebuildSyncError));
      // Pricing (and the homepage thumbnail) have no Google Calendar
      // equivalent, so the sync never touches them — backfill onto the
      // freshly-synced occurrence rows directly.
      await supabase
        .from('events')
        .update({
          // The sync inserts new rows as 'event', so a class series must be set back.
          event_type: rowEventType,
          // The sync can only give the new rows Google's closest color; keep the picked one.
          color: rowColor,
          price_whole_series: rowPriceWholeSeries,
          price_drop_in: rowPriceDropIn,
          price_student: rowPriceStudent,
          price_whole_series_early_bird: rowPriceWholeSeriesEarlyBird,
          price_drop_in_early_bird: rowPriceDropInEarlyBird,
          price_student_early_bird: rowPriceStudentEarlyBird,
          early_bird_until: rowEarlyBirdUntil,
          price_whole_series_flash_sale: rowPriceWholeSeriesFlashSale,
          price_drop_in_flash_sale: rowPriceDropInFlashSale,
          price_student_flash_sale: rowPriceStudentFlashSale,
          flash_sale_until: rowFlashSaleUntil,
          registration_closed: rowRegistrationClosed,
          image_url: rowImageUrl,
          ...rowFlyerColumns,
          lesson_overview_title: rowLessonOverview.title,
          lesson_overview_body: rowLessonOverview.body,
          hide_lesson_overview: rowHideLessonOverview,
          ...rowCapacityColumns,
        })
        .eq('google_recurring_event_id', createdMaster.id);
      // The series' sign-ups follow it to its new Google id so they keep
      // counting toward its capacity (the spot-count trigger recounts it).
      const { error: remapError } = await supabase
        .from('class_registrations')
        .update({ series_key: createdMaster.id })
        .eq('series_key', before.google_recurring_event_id);
      if (remapError) console.error('Failed to move sign-ups to the rebuilt series:', remapError.message);
    } catch (err) {
      console.error('Failed to create rebuilt series:', err);
      const message = err instanceof Error ? err.message : 'Failed to rebuild series.';
      return new Response(JSON.stringify({ error: message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, rebuilt: true, calendarSyncSkipped, calendarSyncError }), {
      status: 200,
    });
  }

  if (applyToSeries && before.google_recurring_event_id) {
    // Series-wide edit: title/description/location/color/type/visibility
    // apply to every occurrence, but each occurrence keeps its own date/time.
    const { data: siblings, error: siblingsError } = await supabase
      .from('events')
      .select('id, title, description, location, start_time, end_time, google_event_id')
      .eq('google_recurring_event_id', before.google_recurring_event_id);

    if (siblingsError || !siblings) {
      return new Response(JSON.stringify({ error: 'Failed to load series.' }), { status: 500 });
    }

    for (const sibling of siblings) {
      const { data: updatedRow } = await supabase
        .from('events')
        .update({
          title,
          description: rowDescription,
          location: location || null,
          event_type: rowEventType,
          color: rowColor,
          visibility: rowVisibility,
          google_event_id: visibilityChanged ? null : sibling.google_event_id,
          price_whole_series: rowPriceWholeSeries,
          price_drop_in: rowPriceDropIn,
          price_student: rowPriceStudent,
          price_whole_series_early_bird: rowPriceWholeSeriesEarlyBird,
          price_drop_in_early_bird: rowPriceDropInEarlyBird,
          price_student_early_bird: rowPriceStudentEarlyBird,
          early_bird_until: rowEarlyBirdUntil,
          price_whole_series_flash_sale: rowPriceWholeSeriesFlashSale,
          price_drop_in_flash_sale: rowPriceDropInFlashSale,
          price_student_flash_sale: rowPriceStudentFlashSale,
          flash_sale_until: rowFlashSaleUntil,
          registration_closed: rowRegistrationClosed,
          image_url: rowImageUrl,
          ...rowFlyerColumns,
          lesson_overview_title: rowLessonOverview.title,
          lesson_overview_body: rowLessonOverview.body,
          hide_lesson_overview: rowHideLessonOverview,
          ...rowCapacityColumns,
        })
        .eq('id', sibling.id)
        .select()
        .single();

      if (accessToken && updatedRow) {
        try {
          const newGoogleId = await pushRowToGoogle(accessToken, oldVisibility, newVisibility, sibling.google_event_id, updatedRow);
          if (newGoogleId !== updatedRow.google_event_id) {
            await supabase.from('events').update({ google_event_id: newGoogleId }).eq('id', sibling.id);
          }
        } catch (err) {
          console.error(`Failed to push series update to Google for ${sibling.id}:`, err);
          noteSyncFailure(err);
        }
      } else if (!accessToken) {
        calendarSyncSkipped = true;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, seriesCount: siblings.length, calendarSyncSkipped, calendarSyncError }),
      { status: 200 }
    );
  }

  const { data: row, error: updateError } = await supabase
    .from('events')
    .update({
      title,
      description: rowDescription,
      location: location || null,
      event_type: rowEventType,
      color: rowColor,
      visibility: rowVisibility,
      google_event_id: visibilityChanged ? null : before.google_event_id,
      start_time: startTime,
      end_time: endTime,
      price_whole_series: rowPriceWholeSeries,
      price_drop_in: rowPriceDropIn,
      price_student: rowPriceStudent,
      price_whole_series_early_bird: rowPriceWholeSeriesEarlyBird,
      price_drop_in_early_bird: rowPriceDropInEarlyBird,
      price_student_early_bird: rowPriceStudentEarlyBird,
      early_bird_until: rowEarlyBirdUntil,
      price_whole_series_flash_sale: rowPriceWholeSeriesFlashSale,
      price_drop_in_flash_sale: rowPriceDropInFlashSale,
      price_student_flash_sale: rowPriceStudentFlashSale,
      flash_sale_until: rowFlashSaleUntil,
      registration_closed: rowRegistrationClosed,
      image_url: rowImageUrl,
      ...rowFlyerColumns,
      lesson_overview_title: rowLessonOverview.title,
      lesson_overview_body: rowLessonOverview.body,
      hide_lesson_overview: rowHideLessonOverview,
      ...rowCapacityColumns,
    })
    .eq('id', id)
    .select()
    .single();

  if (updateError || !row) {
    return new Response(JSON.stringify({ error: 'Failed to update event.' }), { status: 500 });
  }

  if (accessToken) {
    try {
      const newGoogleId = await pushRowToGoogle(accessToken, oldVisibility, newVisibility, before.google_event_id, row);
      if (newGoogleId !== row.google_event_id) {
        await supabase.from('events').update({ google_event_id: newGoogleId }).eq('id', row.id);
      }
    } catch (err) {
      console.error('Failed to push event update to Google:', err);
      // The site row is already saved; the next scheduled sync will retry the push.
      noteSyncFailure(err);
    }
  } else {
    calendarSyncSkipped = true;
  }

  return new Response(JSON.stringify({ ok: true, calendarSyncSkipped, calendarSyncError }), { status: 200 });
};

// Caps Google rate-limit retries so they can't push the request past the function time limit.
export const POST: APIRoute = (context) => withCalendarDeadline(async () => handlePost(context));
