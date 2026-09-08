import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();

  const firstName = String(formData.get('first_name') ?? '').trim();
  const lastName = String(formData.get('last_name') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const eventId = String(formData.get('event_id') ?? '').trim();

  if (!firstName || !lastName || !phone || !eventId) {
    return new Response('Missing required fields: First Name, Last Name, Phone, and a class are required.', {
      status: 400,
    });
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, title')
    .eq('id', eventId)
    .eq('visibility', 'public')
    .maybeSingle();

  if (eventError || !event) {
    return new Response('That class could not be found — please pick again.', { status: 400 });
  }

  const { data: checkin, error } = await supabase
    .from('class_checkins')
    .insert({
      first_name: firstName,
      last_name: lastName,
      phone,
      class_title: event.title,
      event_id: event.id,
    })
    .select('id')
    .single();

  if (error || !checkin) {
    console.error('Failed to insert class check-in:', error);
    return new Response('Something went wrong checking you in. Please try again.', { status: 500 });
  }

  return redirect(`/check-in/confirmation?id=${checkin.id}`, 303);
};
