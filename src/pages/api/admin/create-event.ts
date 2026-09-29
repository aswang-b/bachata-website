import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { getGoogleAccessToken, GoogleNotConnectedError, insertCalendarEvent, buildWeeklyRecurrenceRule } from '../../../lib/googleCalendar';
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
  } = body ?? {};

  if (!title || !startTime || !endTime) {
    return new Response(JSON.stringify({ error: 'Missing title, startTime, or endTime.' }), { status: 400 });
  }

  const rowVisibility = visibility === 'private' ? 'private' : 'public';
  const rowColor = ALLOWED_COLORS.includes(color) ? color : 'accent';
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
  const rowDescription = description ? sanitizeEventDescriptionHtml(description) : null;

  const isSeries = recurrence && Array.isArray(recurrence.byDay) && recurrence.byDay.length > 0;

  if (isSeries) {
    try {
      const accessToken = await getGoogleAccessToken();
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
        .update({
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
        })
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
    })
    .select()
    .single();

  if (insertError || !row) {
    return new Response(JSON.stringify({ error: 'Failed to create event.' }), { status: 500 });
  }

  try {
    const accessToken = await getGoogleAccessToken();
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
    if (!(err instanceof GoogleNotConnectedError)) {
      console.error('Failed to push new event to Google:', err);
    }
    // The event still exists on the site; the next scheduled sync will retry the push.
  }

  return new Response(JSON.stringify({ ok: true, id: row.id }), { status: 200 });
};
