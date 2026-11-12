// Flyer images by file name and URL rules, with no Supabase import, so the
// server (link previews) and the calendar's admin script (the flyer an admin
// shares) apply the same ones. Pure.

// The pixel size in a flyer's file name ("<id>_1600x2000.jpg"), if it has one
// (flyers uploaded before it don't).
export function flyerSize(url: string): { width: number; height: number } | null {
  const m = /_(\d{1,5})x(\d{1,5})\.[a-z]+$/i.exec(url);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

// Link previews: WhatsApp wants an image under 600 KB (some sources say 300 KB, so
// stay under that) and at least 300 px wide; 1200 px is the usual large size.
const PREVIEW_WIDTH = 1200;
const PREVIEW_QUALITY = 70;

// A bucket image through Supabase's image transforms at `width` (aspect kept),
// judged by the bucket's path alone (the browser has no list of this site's
// project); any other URL as it is. The server's own check is eventImages.scaledImageUrl.
export function scaleBucketUrl(url: string, width: number): string {
  if (!url.includes('/storage/v1/object/public/event-images/')) return url;
  return `${url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')}?width=${width}&resize=contain`;
}

// The flyer sized for previews and for sharing as a picture, never scaled up
// when its width is known (its file name carries it). A crawler that doesn't
// ask for WebP gets the upload's own format back, which is a JPEG for a JPEG or
// WebP upload but a very large PNG for a PNG one, so a PNG is requested as WebP.
// `scale` is the caller's transform (scaleBucketUrl, or the server's checked one).
export function previewImageWith(
  flyerUrl: string,
  scale: (url: string, width: number) => string
): { url: string; width?: number; height?: number } | null {
  const size = flyerSize(flyerUrl);
  const width = size ? Math.min(PREVIEW_WIDTH, size.width) : PREVIEW_WIDTH;
  const scaled = scale(flyerUrl, width);
  // Not in the site's bucket (can't be scaled): used as it is when it is a secure link, else not at all.
  if (scaled === flyerUrl) return flyerUrl.startsWith('https://') ? { url: flyerUrl } : null;
  const asWebp = /\.png$/i.test(flyerUrl) ? '&format=webp' : '';
  return {
    url: `${scaled}&quality=${PREVIEW_QUALITY}${asWebp}`,
    ...(size ? { width, height: Math.round((size.height * width) / size.width) } : {}),
  };
}
