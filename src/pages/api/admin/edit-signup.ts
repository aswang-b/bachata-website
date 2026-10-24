import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { EVENT_REGISTRATIONS_LOCK_RESOURCE, SIGNUPS_LOCK_RESOURCE, requireLock } from '../../../lib/editLock';
import { RecyclingBinError, isDeletedDancer, softDeleteDancer } from '../../../lib/recyclingBin';
import {
  ClassRegistrationInputError,
  insertClassRegistrations,
  replaceClassRegistrations,
  setDropInOccurrences,
  updateDancerOnClassRegistrations,
  type DropInOccurrenceUpdate,
} from '../../../lib/classRegistrations';

export const prerender = false;

const MAX_CLASS_SELECTIONS_LENGTH = 10000;

// The picker's structured selections (series key, mode, chosen drop-in date),
// serialized for the same class_selections field the public form submits.
function serializeClassSelections(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const json = JSON.stringify(raw);
  return json.length <= MAX_CLASS_SELECTIONS_LENGTH ? json : null;
}

function parseOccurrenceUpdates(raw: unknown): DropInOccurrenceUpdate[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((u): DropInOccurrenceUpdate[] => {
    if (!u || typeof u !== 'object') return [];
    const { registrationId, occurrenceEventId } = u as Record<string, unknown>;
    if (typeof registrationId !== 'string' || !registrationId) return [];
    return [{ registrationId, occurrenceEventId: typeof occurrenceEventId === 'string' && occurrenceEventId ? occurrenceEventId : null }];
  });
}

interface Dancer {
  firstName?: string;
  lastName?: string;
  role?: string;
  phone?: string;
  email?: string;
}

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { action, holderId } = body ?? {};
  const holder = `${user.email}::${holderId}`;

  // An event registration added by an admin (e.g. at the door), under the Event Registration tab's lock.
  if (action === 'create' && body.registrationType === 'events') {
    try {
      await requireLock(EVENT_REGISTRATIONS_LOCK_RESOURCE, holder);
    } catch (err) {
      return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Lock required.' }), { status: 409 });
    }
    const { firstName, lastName, email, phone, className, paymentMethod, paid } = body;
    if (!firstName || !lastName) {
      return new Response(JSON.stringify({ error: 'First and last name are required.' }), { status: 400 });
    }
    const classSelectionsRaw = serializeClassSelections(body.classSelections);
    if (!classSelectionsRaw) return new Response(JSON.stringify({ error: 'Pick an event.' }), { status: 400 });
    // Saved like a public event registration: one attendee, no role.
    const dancer = { firstName, lastName, role: '', phone: phone || '', email: email || '' };
    const { data: newRow, error } = await supabase
      .from('intake_submissions')
      .insert({
        registration_type: 'events',
        first_name: firstName,
        last_name: lastName,
        email: email || null,
        phone: phone || null,
        class: className || null,
        payment_method: paymentMethod || null,
        paid: Boolean(paid),
        dancers: [dancer],
      })
      .select('id')
      .single();
    if (error || !newRow) return new Response(JSON.stringify({ error: 'Failed to create the registration.' }), { status: 500 });
    await insertClassRegistrations({
      submissionId: newRow.id,
      classRaw: className || null,
      classSelectionsRaw,
      dancers: [dancer],
      fallbackFirstName: firstName,
      fallbackLastName: lastName,
      fallbackEmail: email || null,
      fallbackPhone: phone || null,
      eventType: 'event',
    });
    return new Response(JSON.stringify({ ok: true, submissionId: newRow.id }), { status: 200 });
  }

  if (action === 'create') {
    try {
      await requireLock(SIGNUPS_LOCK_RESOURCE, holder);
    } catch (err) {
      return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Lock required.' }), { status: 409 });
    }

    const { firstName, lastName, email, phone, className, paymentMethod, paid } = body;
    if (!firstName || !lastName) {
      return new Response(JSON.stringify({ error: 'First and last name are required.' }), { status: 400 });
    }

    const { data: newRow, error } = await supabase
      .from('intake_submissions')
      .insert({
        registration_type: 'group',
        first_name: firstName,
        last_name: lastName,
        email: email || null,
        phone: phone || null,
        class: className || null,
        payment_method: paymentMethod || null,
        paid: Boolean(paid),
        dancers: null,
      })
      .select('id')
      .single();
    if (error || !newRow) return new Response(JSON.stringify({ error: 'Failed to create sign-up.' }), { status: 500 });

    await insertClassRegistrations({
      submissionId: newRow.id,
      classRaw: className || null,
      classSelectionsRaw: serializeClassSelections(body.classSelections),
      dancers: null,
      fallbackFirstName: firstName,
      fallbackLastName: lastName,
      fallbackEmail: email || null,
      fallbackPhone: phone || null,
      // Always a group sign-up, so a selection without a key matches a class by title.
      eventType: 'class',
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const { submissionId, dancerIndex } = body;
  if (!submissionId) {
    return new Response(JSON.stringify({ error: 'Missing submissionId.' }), { status: 400 });
  }

  const { data: row, error: fetchError } = await supabase
    .from('intake_submissions')
    .select('*')
    .eq('id', submissionId)
    .is('deleted_at', null)
    .maybeSingle();

  if (fetchError || !row) {
    return new Response(JSON.stringify({ error: 'Sign-up not found.' }), { status: 404 });
  }

  // Event registrations are edited from their own dashboard tab, under its own lock.
  try {
    await requireLock(row.registration_type === 'events' ? EVENT_REGISTRATIONS_LOCK_RESOURCE : SIGNUPS_LOCK_RESOURCE, holder);
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Lock required.' }), { status: 409 });
  }

  const dancers = Array.isArray(row.dancers) ? (row.dancers as Dancer[]) : null;
  const hasDancerIndex = dancers && typeof dancerIndex === 'number' && dancerIndex >= 0 && dancerIndex < dancers.length;

  if (action === 'delete') {
    // Moves the dancer (or the whole sign-up, if they're its only dancer) to
    // the Recycling Bin; nothing is removed until the bin is emptied.
    try {
      await softDeleteDancer(submissionId, hasDancerIndex ? dancerIndex : null, user.email ?? 'unknown');
    } catch (err) {
      const status = err instanceof RecyclingBinError ? err.status : 500;
      return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to delete.' }), { status });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (action === 'update') {
    const { firstName, lastName, email, phone, className, paymentMethod, paid } = body;
    // A dancer in the Recycling Bin can only come back through a restore.
    if (hasDancerIndex && isDeletedDancer(dancers![dancerIndex])) {
      return new Response(JSON.stringify({ error: 'Dancer not found.' }), { status: 404 });
    }

    const targetDancerIndex = hasDancerIndex ? dancerIndex : null;
    // A class dancer's Leader/Follower role (saved on the dancer, so the spot
    // counts follow it); events and single-person sign-ups have none.
    const role = body.role === 'leader' || body.role === 'follower' ? body.role : undefined;
    const dancer = { firstName, lastName, email, phone, ...(role && targetDancerIndex != null && row.registration_type !== 'events' ? { role } : {}) };

    try {
      if (body.keepClasses === true) {
        // No new classes were picked: leave the existing registrations (and
        // their stored Drop-In dates) alone, only refreshing the dancer's
        // details and applying any Drop-In date changes.
        await setDropInOccurrences(submissionId, targetDancerIndex, parseOccurrenceUpdates(body.occurrenceUpdates));
        await updateDancerOnClassRegistrations(submissionId, targetDancerIndex, dancer);
      } else {
        await replaceClassRegistrations({
          submissionId,
          dancerIndex: targetDancerIndex,
          classRaw: className || null,
          classSelectionsRaw: serializeClassSelections(body.classSelections),
          dancer,
          eventType: row.registration_type === 'events' ? 'event' : 'class',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update class registrations.';
      return new Response(JSON.stringify({ error: message }), { status: err instanceof ClassRegistrationInputError ? 400 : 500 });
    }

    // Writes only this dancer's entry, with the sign-up row locked, so a
    // delete of another dancer from the Attendance tab isn't overwritten.
    const { error } = await supabase.rpc('update_signup_dancer', {
      p_submission_id: submissionId,
      p_dancer_index: targetDancerIndex,
      p_dancer: dancer,
      p_payment_method: paymentMethod || null,
      p_paid: Boolean(paid),
    });
    if (error?.code === 'P0002') return new Response(JSON.stringify({ error: error.message }), { status: 404 });
    if (error) return new Response(JSON.stringify({ error: 'Failed to update sign-up.' }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Unknown action.' }), { status: 400 });
};
