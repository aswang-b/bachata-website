// What a class's own register link shows when it is pasted into WhatsApp,
// iMessage or Facebook (/register?series=<key>, /register/events?series=<key>):
// the class's flyer, name, schedule and city, instead of the generic site
// preview. Pure, so it is unit-tested.
import { scheduleLine } from './classSchedule';
import { scaledImageUrl } from './eventImages';
import { previewImageWith } from './flyerImage';
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

const MAX_DESCRIPTION = 200;

// The flyer sized for previews (rule and reasons: flyerImage.previewImageWith), through this site's bucket only.
export function previewImage(flyerUrl: string): { url: string; width?: number; height?: number } | null {
  return previewImageWith(flyerUrl, scaledImageUrl);
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
  const schedule = scheduleLine({ rows, whole: opts.whole, total: opts.total, isEvent: opts.isEvent });
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
