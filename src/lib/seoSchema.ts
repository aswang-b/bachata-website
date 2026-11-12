import { getActivePrice } from './pricing';
import { DEFAULT_LOCATION, placeLabel, type SiteLocation } from './siteLocation';

// Structured data (schema.org JSON-LD) for search engines; nothing here shows
// on the page. It describes Dance with B and B as the instructor and
// organizer, not the rented studio: no street address or opening hours are
// hard-coded, and each class's venue comes from its own location field, so a
// move only needs the classes' locations updated. Pure, so it's unit-tested.

export const SITE_URL = 'https://dancewithb.fun';
export const DEFAULT_SHARE_IMAGE = `${SITE_URL}/icon-512.png`;
const ORG_ID = `${SITE_URL}/#organization`;
const PERSON_ID = `${SITE_URL}/#b`;
// B goes by B Li; Belinda Li (her legal name) is used in some marketing, so
// search engines should know both as the same person.
const B = { name: 'B Li', alternateName: ['Belinda Li', 'B'] };

// `location` is where the business is now (Admin → Where we are); the area
// served is city level only, for local searches.
export function siteSchema(sameAs: string[], location: SiteLocation = DEFAULT_LOCATION) {
  const AREA = { '@type': 'City', name: placeLabel(location) };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      // The site's name as Google shows it in results, and the ways people search for it.
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: 'Dance with B',
        alternateName: ['DanceWithB', 'dancewithb.fun', 'Dance with B Li'],
        url: `${SITE_URL}/`,
        publisher: { '@id': ORG_ID },
      },
      {
        '@type': 'Organization',
        '@id': ORG_ID,
        name: 'Dance with B',
        alternateName: ['DanceWithB', 'Dance with B Li', 'Dance with Belinda Li'],
        url: SITE_URL,
        logo: DEFAULT_SHARE_IMAGE,
        description: `Bachata and sensual bachata classes, workshops, and social dance events in ${placeLabel(location)}, taught and organized by B Li (Belinda Li).`,
        founder: { '@id': PERSON_ID },
        areaServed: AREA,
        sameAs,
      },
      {
        '@type': 'Person',
        '@id': PERSON_ID,
        ...B,
        jobTitle: 'Dance instructor and event organizer',
        url: `${SITE_URL}/about`,
        knowsAbout: ['Bachata', 'Sensual bachata', 'Brazilian zouk', 'Salsa', 'Partner dancing'],
        worksFor: { '@id': ORG_ID },
        homeLocation: AREA,
        sameAs,
      },
    ],
  };
}

export interface EventSchemaRow {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  // Where the class is held (migration 0077); its address when set, else the site's.
  city?: string | null;
  state?: string | null;
  start_time: string;
  end_time: string;
  event_type?: string;
  google_recurring_event_id: string | null;
  flyer_url?: string | null;
  registration_closed?: boolean;
  price_whole_series?: number | null;
  price_drop_in?: number | null;
  price_whole_series_early_bird?: number | null;
  price_drop_in_early_bird?: number | null;
  early_bird_until?: string | null;
  price_whole_series_flash_sale?: number | null;
  price_drop_in_flash_sale?: number | null;
  flash_sale_until?: string | null;
}

// Plain text from the editor's HTML, shortened for a search result.
export function plainText(html: string | null | undefined, max = 300): string {
  const text = (html ?? '')
    .replace(/<(br|\/p|\/li|\/div)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// One schema.org Event per upcoming class/event occurrence, soonest first:
// today's prices (early bird / flash sale applied), its venue, flyer and
// register link. `full` holds the occurrence ids with no spots left.
export function eventSchemas(rows: EventSchemaRow[], now: Date, full: Set<string>, limit = 40, location: SiteLocation = DEFAULT_LOCATION) {
  const place = placeLabel(location);
  return [...rows]
    .filter((r) => Date.parse(r.start_time) >= now.getTime())
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .slice(0, limit)
    .map((r) => {
      const isEvent = r.event_type === 'event';
      const own = r.city?.trim() ? { city: r.city.trim(), state: r.state?.trim() ?? '', note: '' } : location;
      const classPlace = own === location ? place : placeLabel(own);
      const key = r.google_recurring_event_id ?? r.id;
      const register = `${SITE_URL}${isEvent ? '/register/events' : '/register'}?series=${encodeURIComponent(key)}`;
      const availability = r.registration_closed || full.has(r.id) ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock';
      const price = (base: number | null | undefined, earlyBird: number | null | undefined, flashSale: number | null | undefined) =>
        base == null
          ? null
          : getActivePrice(now, { base, earlyBird: earlyBird ?? null, earlyBirdUntil: r.early_bird_until ?? null, flashSale: flashSale ?? null, flashSaleUntil: r.flash_sale_until ?? null }).activePrice;
      const offers = [
        { name: isEvent ? 'Ticket' : r.google_recurring_event_id ? 'Whole series' : 'Class', price: price(r.price_whole_series, r.price_whole_series_early_bird, r.price_whole_series_flash_sale) },
        ...(isEvent ? [] : [{ name: 'Drop-in', price: price(r.price_drop_in, r.price_drop_in_early_bird, r.price_drop_in_flash_sale) }]),
      ]
        .filter((o): o is { name: string; price: number } => o.price != null)
        .map((o) => ({ '@type': 'Offer', name: o.name, price: o.price, priceCurrency: 'USD', url: register, availability }));
      return {
        '@context': 'https://schema.org',
        '@type': 'DanceEvent',
        name: r.title,
        description: plainText(r.description) || `${r.title} with B in ${classPlace}.`,
        startDate: r.start_time,
        endDate: r.end_time,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: {
          '@type': 'Place',
          name: r.location || classPlace,
          address: { '@type': 'PostalAddress', addressLocality: own.city, ...(own.state ? { addressRegion: own.state } : {}), addressCountry: 'US' },
        },
        image: [r.flyer_url || DEFAULT_SHARE_IMAGE],
        organizer: { '@type': 'Organization', name: 'Dance with B', url: SITE_URL },
        performer: { '@type': 'Person', '@id': PERSON_ID, ...B },
        url: register,
        ...(offers.length > 0 ? { offers } : {}),
      };
    });
}

// JSON for a <script type="application/ld+json">, with "<" escaped so no text
// (a class description, say) can close the script tag early.
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
