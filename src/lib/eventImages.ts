import { supabase } from './supabase';
import { flyerSize } from './flyerImage';

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

// The pixel size in a flyer's file name, if it has one (flyers uploaded before it
// don't); the rule lives in flyerImage.ts, which the browser can import too.
export { flyerSize };

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

// Never scaled up: a flyer narrower than a width is offered at its own width
// instead, still through the image transforms (the same picture compressed;
// the raw upload is several times the bytes). The full-size view
// (FlyerDialog) opens the original URL itself. None for an image outside the
// bucket (it can't be scaled).
export function flyerSrcset(url: string): string | undefined {
  if (!url.startsWith(publicPrefix())) return undefined;
  return scaledCandidates(url, FLYER_WIDTHS);
}

function scaledCandidates(url: string, steps: number[]): string {
  const size = flyerSize(url);
  const widths = size ? steps.filter((w) => w < size.width) : [...steps];
  if (size && widths.length < steps.length) widths.push(size.width);
  return widths.map((w) => `${scaledImageUrl(url, w)} ${w}w`).join(', ');
}

// The past-flyers row shows each flyer at a fixed height (16rem, 20rem from
// 640px wide) with its width following the picture.
const GALLERY_HEIGHTS = { phone: 256, wide: 320 };
const GALLERY_WIDTHS = [320, 480, 640, 800];

// What the gallery's <img> needs: scaled candidates that match the rendered
// size, and the stored pixel size (when the file name has one) so the row
// reserves each flyer's width before it loads. Without a stored size, `sizes`
// assumes the widest a flyer can be (square), so a sharp screen is never
// served less than it shows.
export function galleryImageAttrs(url: string): { src: string; srcset?: string; sizes?: string; width?: number; height?: number } {
  if (!url.startsWith(publicPrefix())) return { src: url };
  const size = flyerSize(url);
  const ratio = size ? size.width / size.height : 1;
  return {
    src: scaledImageUrl(url, 640),
    srcset: scaledCandidates(url, GALLERY_WIDTHS),
    sizes: `(min-width: 640px) ${Math.round(GALLERY_HEIGHTS.wide * ratio)}px, ${Math.round(GALLERY_HEIGHTS.phone * ratio)}px`,
    ...size,
  };
}
