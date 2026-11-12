import { test, expect } from './support/fixtures';
import { db, seedEvent, siteHome, sweepTestData, type Seeded } from './support/db';
import { env } from './support/env';

// A class's own register link previews that class where it is pasted
// (WhatsApp, iMessage, Facebook): its flyer, name, schedule and city. Any other
// request keeps the site's head. Read from the raw HTML, as a link crawler does.
test.afterAll(sweepTestData);

const DEFAULT_IMAGE = 'https://dancewithb.fun/icon-512.png';
const SITE = 'https://dancewithb.fun';
let flyerUrl: string;
let withFlyer: Seeded;
let eventWithFlyer: Seeded;
let noFlyer: Seeded;
let past: Seeded;
let homeCity: { city: string; state: string };

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function head(html: string) {
  const content = (attr: 'property' | 'name', name: string) => {
    const m = new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(html);
    return m ? decode(m[1]) : null;
  };
  return {
    ogTitle: content('property', 'og:title'),
    ogDescription: content('property', 'og:description'),
    ogImage: content('property', 'og:image'),
    ogUrl: content('property', 'og:url'),
    ogWidth: content('property', 'og:image:width'),
    ogHeight: content('property', 'og:image:height'),
    ogAlt: content('property', 'og:image:alt'),
    card: content('name', 'twitter:card'),
    twitterTitle: content('name', 'twitter:title'),
    twitterDescription: content('name', 'twitter:description'),
    twitterImage: content('name', 'twitter:image'),
    description: content('name', 'description'),
    canonical: /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? null,
    robots: content('name', 'robots'),
    title: decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? ''),
  };
}

test.beforeAll(async () => {
  homeCity = await siteHome();
  flyerUrl = `${env('SUPABASE_URL')}/storage/v1/object/public/event-images/zzz-link-preview_1080x1440.jpg`;
  withFlyer = await seedEvent({ name: 'Preview Series', occurrences: 2, flyerUrl, city: 'Santa Fe', state: 'NM', priceDropIn: 15, dayOffset: 60 });
  eventWithFlyer = await seedEvent({ name: 'Preview Social', type: 'event', flyerUrl, dayOffset: 61 });
  noFlyer = await seedEvent({ name: 'Preview No Flyer', dayOffset: 62 });
  past = await seedEvent({ name: 'Preview Past', flyerUrl, dayOffset: 63 });
  const { error } = await db
    .from('events')
    .update({ start_time: '2020-01-01T01:00:00Z', end_time: '2020-01-01T02:00:00Z' })
    .eq('id', past.ids[0]);
  if (error) throw new Error(error.message);
});

async function previewOf(request: import('@playwright/test').APIRequestContext, path: string) {
  const res = await request.get(path);
  expect(res.status(), path).toBe(200);
  return head(await res.text());
}

test("a class's register link carries its flyer, name, schedule and city", async ({ request }) => {
  const h = await previewOf(request, `/register?series=${encodeURIComponent(withFlyer.key)}&utm_source=whatsapp`);
  expect(h.ogTitle).toBe(`${withFlyer.title} · Dance with B`);
  expect(h.twitterTitle).toBe(h.ogTitle);
  expect(h.title).toBe(h.ogTitle);
  expect(h.ogDescription).toContain('Santa Fe, NM');
  expect(h.ogDescription).toContain('ZZZ Test Studio');
  expect(h.ogDescription!.length).toBeLessThanOrEqual(200);
  expect(h.twitterDescription).toBe(h.ogDescription);
  expect(h.description).toBe(h.ogDescription);
  // The flyer through the image transforms, at the size the file name stores.
  expect(h.ogImage).toMatch(/^https:\/\/[^/]+\/storage\/v1\/render\/image\/public\/event-images\/zzz-link-preview_1080x1440\.jpg\?width=1080&resize=contain&quality=70$/);
  expect(h.twitterImage).toBe(h.ogImage);
  expect([h.ogWidth, h.ogHeight]).toEqual(['1080', '1440']);
  expect(h.ogAlt).toBe(`Flyer for ${withFlyer.title}`);
  expect(h.card).toBe('summary_large_image');
  // The class's own link: the series key alone, no other query parameter.
  const own = `${SITE}/register?series=${encodeURIComponent(withFlyer.key)}`;
  expect(h.ogUrl).toBe(own);
  expect(h.canonical).toBe(own);
  // Indexing is as it always was for these pages.
  expect(h.robots).toBeNull();
});

test("an event's link on the events page previews the event, with its own path", async ({ request }) => {
  const h = await previewOf(request, `/register/events?series=${encodeURIComponent(eventWithFlyer.key)}`);
  expect(h.ogTitle).toBe(`${eventWithFlyer.title} · Dance with B`);
  expect(h.ogImage).toContain('/render/image/public/event-images/zzz-link-preview_1080x1440.jpg');
  expect(h.card).toBe('summary_large_image');
  // No city on the class: the home city shows in a link preview.
  expect(h.ogDescription).toContain(`${homeCity.city}`);
  expect(h.canonical).toBe(`${SITE}/register/events?series=${encodeURIComponent(eventWithFlyer.key)}`);
  expect(h.ogUrl).toBe(h.canonical);
});

test('a class without a flyer keeps the default image but gets its own title and description', async ({ request }) => {
  const h = await previewOf(request, `/register?series=${encodeURIComponent(noFlyer.key)}`);
  expect(h.ogTitle).toBe(`${noFlyer.title} · Dance with B`);
  expect(h.ogDescription).toContain('ZZZ Test Studio');
  expect(h.ogImage).toBe(DEFAULT_IMAGE);
  expect(h.twitterImage).toBe(DEFAULT_IMAGE);
  expect(h.card).toBe('summary');
  expect([h.ogWidth, h.ogHeight, h.ogAlt]).toEqual([null, null, null]);
  expect(h.canonical).toBe(`${SITE}/register?series=${encodeURIComponent(noFlyer.key)}`);
});

test('no key, an unknown key, a past class and a class on the other page keep the usual head', async ({ request }) => {
  const plain = await previewOf(request, '/register');
  expect(plain.ogTitle).toBe('Register — Group Bachata Classes | Dance with B');
  expect(plain.ogImage).toBe(DEFAULT_IMAGE);
  expect(plain.canonical).toBe(`${SITE}/register`);
  expect(plain.card).toBe('summary');
  expect(plain.ogWidth).toBeNull();
  for (const path of [
    '/register?series=zzz-no-such-class',
    '/register?series=',
    `/register?series=${past.key}`,
    // An event's key on the classes page (and a class's on the events page) is not a class there.
    `/register?series=${eventWithFlyer.key}`,
    `/register/events?series=${withFlyer.key}`,
  ]) {
    const h = await previewOf(request, path);
    const usual = path.startsWith('/register/events') ? 'Register — Bachata Socials & Events | Dance with B' : plain.ogTitle;
    expect(h.ogTitle, path).toBe(usual);
    expect(h.ogImage, path).toBe(DEFAULT_IMAGE);
    expect(h.canonical, path).toBe(`${SITE}${path.split('?')[0]}`);
    expect(h.card, path).toBe('summary');
  }
});
