import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { refreshAccessToken, insertCalendarEvent, buildWeeklyRecurrenceRule } from '../../../lib/googleCalendar';
import { runCalendarSync } from '../../../lib/calendarSync';
import { sanitizeEventDescriptionHtml } from '../../../lib/richText';

export const prerender = false;

// Includes legacy colors ('accent', 'yellow') so existing data of those
// colors keeps validating even though the admin picker no longer offers them.
const ALLOWED_COLORS = ['green', 'blue', 'red', 'orange', 'purple', 'accent', 'yellow'];

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const {
    title,
    description,
    location,
    eventType,
    color,
    visibility,
    startTime,
    endTime,
    recurrence,
    priceWholeSeries,
    priceDropIn,
    priceStudent,
    imageUrl,
  } = body ?? {};

  if (!title || !startTime || !endTime) {
    return new Response(JSON.stringify({ error: 'Missing title, startTime, or endTime.' }), { status: 400 });
  }

  const rowVisibility = visibility === 'private' ? 'private' : 'public';
  const rowColor = ALLOWED_COLORS.includes(color) ? color : 'accent';
  const rowEventType = eventType === 'event' ? 'event' : 'class';
  const toPrice = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));
  const rowPriceWholeSeries = toPrice(priceWholeSeries);
  const rowPriceDropIn = toPrice(priceDropIn);
  const rowPriceStudent = toPrice(priceStudent);
  const rowImageUrl = imageUrl || null;
  const rowDescription = description ? sanitizeEventDescriptionHtml(description) : null;

  const { data: tokenRow } = await supabase
    .from('admin_google_tokens')
    .select('refresh_token')
    .limit(1)
    .maybeSingle();

  const isSeries = recurrence && Array.isArray(recurrence.byDay) && recurrence.byDay.length > 0;

  if (isSeries) {
    if (!tokenRow) {
      return new Response(JSON.stringify({ error: 'No admin Google connection found — connect Google before creating a series.' }), { status: 500 });
    }

    try {
      const accessToken = await refreshAccessToken(tokenRow.refresh_token);
      const createdMaster = await insertCalendarEvent(accessToken, rowVisibility, {
        siteEventId: randomUUID(),
        summary: title,
        description: rowDescription,
        location: location || null,
        startTime,
        endTime,
        color: rowColor,
        recurrence: buildWeeklyRecurrenceRule({
          byDay: recurrence.byDay,
          interval: Number(recurrence.interval) || 1,
          count: recurrence.endType === 'count' ? Number(recurrence.count) || undefined : undefined,
          until: recurrence.endType === 'until' ? recurrence.until : undefined,
        }),
      });
      // The recurring event's individual occurrences get pulled in as
      // regular one-off rows by the normal sync/expansion logic. Pricing has
      // no Google Calendar equivalent, so it's never part of that sync —
      // backfill it onto the newly-synced occurrence rows directly.
      await runCalendarSync();
      await supabase
        .from('events')
        .update({ price_whole_series: rowPriceWholeSeries, price_drop_in: rowPriceDropIn, price_student: rowPriceStudent, image_url: rowImageUrl })
        .eq('google_recurring_event_id', createdMaster.id);
    } catch (err) {
      console.error('Failed to create recurring event:', err);
      const message = err instanceof Error ? err.message : 'Failed to create series.';
      return new Response(JSON.stringify({ error: message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const { data: row, error: insertError } = await supabase
    .from('events')
    .insert({
      title,
      description: rowDescription,
      location: location || null,
      event_type: rowEventType,
      color: rowColor,
      visibility: rowVisibility,
      start_time: startTime,
      end_time: endTime,
      price_whole_series: rowPriceWholeSeries,
      price_drop_in: rowPriceDropIn,
      price_student: rowPriceStudent,
      image_url: rowImageUrl,
    })
    .select()
    .single();

  if (insertError || !row) {
    return new Response(JSON.stringify({ error: 'Failed to create event.' }), { status: 500 });
  }

  if (tokenRow) {
    try {
      const accessToken = await refreshAccessToken(tokenRow.refresh_token);
      const created = await insertCalendarEvent(accessToken, rowVisibility, {
        siteEventId: row.id,
        summary: row.title,
        description: row.description,
        location: row.location,
        startTime: row.start_time,
        endTime: row.end_time,
        color: row.color,
      });
      await supabase.from('events').update({ google_event_id: created.id }).eq('id', row.id);
    } catch (err) {
      console.error('Failed to push new event to Google:', err);
      // The event still exists on the site; the next scheduled sync will retry the push.
    }
  }

  return new Response(JSON.stringify({ ok: true, id: row.id }), { status: 200 });
};
