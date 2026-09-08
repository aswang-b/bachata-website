import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';

export const prerender = false;

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');

  if (!file || !(file instanceof File)) {
    return new Response(JSON.stringify({ error: 'Missing file.' }), { status: 400 });
  }

  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    return new Response(JSON.stringify({ error: 'Only JPEG, PNG, WebP, or GIF images are allowed.' }), { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'Image must be 5MB or smaller.' }), { status: 400 });
  }

  const path = `${randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from('event-images').upload(path, file, {
    contentType: file.type,
    cacheControl: '31536000',
  });

  if (uploadError) {
    console.error('Failed to upload event image:', uploadError);
    return new Response(JSON.stringify({ error: 'Failed to upload image.' }), { status: 500 });
  }

  const { data: publicUrlData } = supabase.storage.from('event-images').getPublicUrl(path);

  return new Response(JSON.stringify({ ok: true, url: publicUrlData.publicUrl }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
