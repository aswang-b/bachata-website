import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { SIGNUPS_LOCK_RESOURCE, requireLock } from '../../../lib/editLock';
import { recordDeletion } from '../../../lib/deletionAudit';
import {
  ClassRegistrationInputError,
  getClassRegistrationsForDancer,
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

  try {
    await requireLock(SIGNUPS_LOCK_RESOURCE, holder);
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Lock required.' }), { status: 409 });
  }

  if (action === 'create') {
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
    .maybeSingle();

  if (fetchError || !row) {
    return new Response(JSON.stringify({ error: 'Sign-up not found.' }), { status: 404 });
  }

  const dancers = Array.isArray(row.dancers) ? (row.dancers as Dancer[]) : null;
  const hasDancerIndex = dancers && typeof dancerIndex === 'number' && dancerIndex >= 0 && dancerIndex < dancers.length;

  if (action === 'delete') {
    // The dancer's own class registrations are snapshotted alongside the
    // submission/dancer so restore-signup.ts can recreate them — deleting
    // the dancer here never touches any other dancer's class_registrations
    // rows on this same submission.
    const dancerClassRegistrations = await getClassRegistrationsForDancer(submissionId, hasDancerIndex ? dancerIndex : null);

    if (hasDancerIndex && dancers!.length > 1) {
      await recordDeletion({
        deletedBy: user.email ?? 'unknown',
        tableName: 'intake_submissions',
        action: 'remove_dancer',
        recordId: submissionId,
        dancerIndex,
        snapshot: { ...row, classRegistrations: dancerClassRegistrations },
      });

      const nextDancers = dancers!.filter((_, i) => i !== dancerIndex);
      const { error } = await supabase
        .from('intake_submissions')
        .update({
          dancers: nextDancers,
          first_name: nextDancers[0]?.firstName ?? '',
          last_name: nextDancers[0]?.lastName ?? '',
          email: nextDancers[0]?.email || null,
          phone: nextDancers[0]?.phone || null,
        })
        .eq('id', submissionId);
      if (error) return new Response(JSON.stringify({ error: 'Failed to remove dancer.' }), { status: 500 });

      const { error: deleteRegError } = await supabase
        .from('class_registrations')
        .delete()
        .eq('submission_id', submissionId)
        .eq('dancer_index', dancerIndex);
      if (deleteRegError) console.error('Failed to delete dancer class registrations:', deleteRegError.message);

      // Removing a dancer shifts everyone after them down by one position in
      // `dancers[]` — re-align their class_registrations rows to match, or
      // they'd point at a dancer_index that no longer matches anyone (making
      // that dancer's price/class silently disappear from the Sign-Ups table
      // until they're next edited or the removed dancer is restored).
      const { data: toShift } = await supabase
        .from('class_registrations')
        .select('id, dancer_index')
        .eq('submission_id', submissionId)
        .gt('dancer_index', dancerIndex);
      for (const r of toShift ?? []) {
        await supabase
          .from('class_registrations')
          .update({ dancer_index: (r.dancer_index ?? 1) - 1 })
          .eq('id', r.id);
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Whole-submission delete — reaching this branch means there's at most
    // one dancer, so dancerClassRegistrations (fetched above) already covers
    // every class_registrations row for the submission. Cascade-deletes with
    // the submission itself; snapshotted here so restore can recreate them.
    await recordDeletion({
      deletedBy: user.email ?? 'unknown',
      tableName: 'intake_submissions',
      action: 'delete_submission',
      recordId: submissionId,
      snapshot: { ...row, classRegistrations: dancerClassRegistrations },
    });

    const { error } = await supabase.from('intake_submissions').delete().eq('id', submissionId);
    if (error) return new Response(JSON.stringify({ error: 'Failed to delete sign-up.' }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (action === 'update') {
    const { firstName, lastName, email, phone, className, paymentMethod, paid } = body;
    const patch: Record<string, unknown> = {
      payment_method: paymentMethod || null,
      paid: Boolean(paid),
    };

    if (hasDancerIndex) {
      const nextDancers = [...dancers!];
      nextDancers[dancerIndex] = { ...nextDancers[dancerIndex], firstName, lastName, email, phone };
      patch.dancers = nextDancers;
      if (dancerIndex === 0) {
        patch.first_name = firstName;
        patch.last_name = lastName;
        patch.email = email || null;
        patch.phone = phone || null;
      }
    } else {
      patch.first_name = firstName;
      patch.last_name = lastName;
      patch.email = email || null;
      patch.phone = phone || null;
    }

    const targetDancerIndex = hasDancerIndex ? dancerIndex : null;
    const dancer = { firstName, lastName, email, phone };

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
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update class registrations.';
      return new Response(JSON.stringify({ error: message }), { status: err instanceof ClassRegistrationInputError ? 400 : 500 });
    }

    const { error } = await supabase.from('intake_submissions').update(patch).eq('id', submissionId);
    if (error) return new Response(JSON.stringify({ error: 'Failed to update sign-up.' }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Unknown action.' }), { status: 400 });
};
