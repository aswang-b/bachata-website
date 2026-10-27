import { supabase } from './supabase';

// Images in the event-images storage bucket (admin uploads: class/event
// images and flyers). Flyers are shown on the public homepage, so only URLs
// of this bucket are ever saved as one.

const BUCKET = 'event-images';

const publicPrefix = () => supabase.storage.from(BUCKET).getPublicUrl('').data.publicUrl;

// A file uploaded to this site's event-images bucket (its public URL).
export function isEventImageUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 500) return false;
  const prefix = publicPrefix();
  return url.startsWith(prefix) && /^[A-Za-z0-9._-]+$/.test(url.slice(prefix.length));
}

// The file name an upload is saved under. Flyers carry their pixel size
// ("<id>_1600x2000.jpg") so the homepage can reserve their space before they load.
export function eventImagePath(id: string, extension: string, size?: { width: number; height: number } | null): string {
  return size ? `${id}_${size.width}x${size.height}.${extension}` : `${id}.${extension}`;
}

// The pixel size in a flyer's file name, if it has one (flyers uploaded before it don't).
export function flyerSize(url: string): { width: number; height: number } | null {
  const m = /_(\d{1,5})x(\d{1,5})\.[a-z]+$/i.exec(url);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

// Widths the homepage asks for: its flyer column is about 380px wide (on a
// phone, the screen's width), at 1x to 3x.
const FLYER_WIDTHS = [400, 800, 1200];

// A bucket image scaled down by Supabase's image transforms (aspect kept);
// any other URL as it is.
export function scaledImageUrl(url: string, width: number): string {
  const prefix = publicPrefix();
  if (!url.startsWith(prefix)) return url;
  const scaled = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  return `${scaled}?width=${width}&resize=contain`;
}

// Never scaled up: a flyer narrower than a width is offered at its own size
// instead. None for an image outside the bucket (it can't be scaled).
export function flyerSrcset(url: string): string | undefined {
  if (!url.startsWith(publicPrefix())) return undefined;
  const size = flyerSize(url);
  const widths = size ? FLYER_WIDTHS.filter((w) => w < size.width) : FLYER_WIDTHS;
  const candidates = widths.map((w) => `${scaledImageUrl(url, w)} ${w}w`);
  if (size && widths.length < FLYER_WIDTHS.length) candidates.push(`${url} ${size.width}w`);
  return candidates.join(', ');
}
