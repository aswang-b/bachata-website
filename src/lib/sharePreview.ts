// What a class's own register link shows when it is pasted into WhatsApp,
// iMessage or Facebook (/register?series=<key>, /register/events?series=<key>):
// the class's flyer, name, schedule and city, instead of the generic site
// preview. Pure, so it is unit-tested.
import { eventDate, eventTimeRange } from './eventClock';
import { flyerSize, scaledImageUrl } from './eventImages';
import { seriesSubLabel } from './registrationLabels';
import { placeLabel, type SiteLocation } from './siteLocation';

export interface PreviewOccurrence {
  title: string;
  start_time: string;
  end_time: string;
  time_zone?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  flyer_url?: string | null;
}

export interface SharePreview {
  title: string;
  description: string;
  // Absolute URL of the flyer (undefined: the page keeps the site's default image).
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string;
  // The class's own link: path plus the series key, nothing else.
  canonical: string;
}

// Link previews: WhatsApp wants an image under 600 KB (some sources say 300 KB, so
// stay under that) and at least 300 px wide; 1200 px is the usual large size.
const PREVIEW_WIDTH = 1200;
const PREVIEW_QUALITY = 70;
const MAX_DESCRIPTION = 200;

// The flyer through the image transforms, sized for previews, never scaled up
// when its width is known (its file name carries it). A crawler that doesn't
// ask for WebP gets the upload's own format back, which is a JPEG for a JPEG or
// WebP upload but a very large PNG for a PNG one, so a PNG is requested as WebP.
export function previewImage(flyerUrl: string): { url: string; width?: number; height?: number } | null {
  const size = flyerSize(flyerUrl);
  const width = size ? Math.min(PREVIEW_WIDTH, size.width) : PREVIEW_WIDTH;
  const scaled = scaledImageUrl(flyerUrl, width);
  // Not in the site's bucket (can't be scaled): used as it is when it is a secure link, else not at all.
  if (scaled === flyerUrl) return flyerUrl.startsWith('https://') ? { url: flyerUrl } : null;
  const asWebp = /\.png$/i.test(flyerUrl) ? '&format=webp' : '';
  return {
    url: `${scaled}&quality=${PREVIEW_QUALITY}${asWebp}`,
    ...(size ? { width, height: Math.round((size.height * width) / size.width) } : {}),
  };
}

// At most `max` characters, cut at a word boundary with an ellipsis.
export function capOnWord(text: string, max = MAX_DESCRIPTION): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;·.-]+$/, '')}…`;
}

// `rows`: the class's upcoming classes; `whole`: the series' first and last class,
// past ones included (flyerBlocks.seriesBounds); `total`: its class count.
export function classSharePreview(opts: {
  path: string;
  key: string;
  rows: PreviewOccurrence[];
  whole?: { first: string; last: string };
  total?: number;
  isEvent: boolean;
  home: SiteLocation;
}): SharePreview | null {
  const rows = [...opts.rows].sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
  const first = rows[0];
  if (!first) return null;
  const last = rows[rows.length - 1];
  const isSeries = (opts.total ?? rows.length) > 1;
  const schedule = isSeries
    ? seriesSubLabel(first, last, opts.whole, true, opts.isEvent)
    : `${eventDate(first)} · ${eventTimeRange(first)}`;
  const city = (first.city ?? '').trim();
  const place = city ? (first.state?.trim() ? `${city}, ${first.state.trim()}` : city) : placeLabel(opts.home);
  const description = capOnWord([schedule, first.location?.trim(), place].filter(Boolean).join(' · '));
  const flyer = first.flyer_url ? previewImage(first.flyer_url) : null;
  return {
    title: `${first.title} · Dance with B`,
    description,
    canonical: `${opts.path}?series=${encodeURIComponent(opts.key)}`,
    ...(flyer ? { image: flyer.url, imageWidth: flyer.width, imageHeight: flyer.height, imageAlt: `Flyer for ${first.title}` } : {}),
  };
}
