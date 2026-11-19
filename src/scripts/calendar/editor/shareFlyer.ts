// "Share flyer" in the details panel, for admins only (loaded with the editor,
// so public visitors never download it). One tap copies a ready caption, then
// hands the class's flyer and that caption to the phone's share sheet. The
// caption is copied FIRST because WhatsApp and iOS often drop the text when a
// file is shared with it.
import { previewImageWith, scaleBucketUrl } from '../../../lib/flyerImage';
import { shareCaption } from '../../../lib/shareCaption';
import { classShareUrl, copyText, flashStatus, isAbort, type ShareNav } from '../../share';
import { shared } from '../state';
import type { SiteEvent } from '../types';
import { editor } from './state';

export interface FlyerNav extends ShareNav {
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; text?: string; url?: string }) => Promise<void>;
}

// What happened, in words for the panel; '' says nothing (the share sheet is its own feedback).
export interface FlyerOutcome {
  message: string;
  // The flyer to save by hand, when nothing could share it.
  download?: File;
}

// The class with the rest of its series: its upcoming classes, and the first and last class overall.
export function seriesOf(event: SiteEvent, all: SiteEvent[], now = Date.now()) {
  const key = event.google_recurring_event_id ?? event.id;
  const siblings = all.filter((e) => (e.google_recurring_event_id ?? e.id) === key).sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
  const upcoming = siblings.filter((e) => Date.parse(e.end_time) >= now);
  return {
    key,
    upcoming: upcoming.length > 0 ? upcoming : [event],
    total: Math.max(1, siblings.length),
    whole: siblings.length > 0 ? { first: siblings[0].start_time, last: siblings[siblings.length - 1].start_time } : undefined,
  };
}

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };

// "ZZZ Beginner Bachata" -> "zzz-beginner-bachata.jpg" (webp for a WebP picture).
export function flyerFileName(title: string, type: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'flyer';
  return `${slug}.${EXTENSIONS[type] ?? 'jpg'}`;
}

async function fetchFlyer(event: SiteEvent): Promise<File | null> {
  const image = event.flyer_url ? previewImageWith(event.flyer_url, scaleBucketUrl) : null;
  if (!image) return null;
  const res = await fetch(image.url);
  if (!res.ok) throw new Error(`flyer ${res.status}`);
  const blob = await res.blob();
  const type = EXTENSIONS[blob.type] ? blob.type : /\.png/i.test(image.url) ? 'image/webp' : 'image/jpeg';
  return new File([blob], flyerFileName(event.title, type), { type });
}

export async function shareFlyer(
  event: SiteEvent,
  all: SiteEvent[],
  nav: FlyerNav,
  getFlyer: (event: SiteEvent) => Promise<File | null> = fetchFlyer
): Promise<FlyerOutcome> {
  const { key, upcoming, total, whole } = seriesOf(event, all);
  const url = classShareUrl(location.origin, event.event_type, key);
  // A private class has no page to register on, so its caption carries no link.
  const caption = shareCaption({ event, upcoming, total, whole, url: event.visibility === 'private' ? null : url });
  const copied = await copyText(caption, nav);
  const note = copied ? 'Caption copied' : "Couldn't copy the caption";

  let file: File | null = null;
  try {
    file = await getFlyer(event);
  } catch {
    file = null;
    if (!event.flyer_url) return { message: note };
  }
  try {
    if (file && nav.canShare?.({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], text: caption });
      return { message: '' };
    }
    if (nav.share) {
      await nav.share({ text: caption, url });
      return { message: '' };
    }
  } catch (err) {
    if (isAbort(err)) return { message: '' };
    return { message: `${note}. The share sheet couldn't open.` };
  }
  return file ? { message: note, download: file } : { message: note };
}

// The address of the picture behind the "Download flyer" link. A page holds each
// one until it is revoked, so only the newest is kept: the one before goes when
// a new one is made, and the last when its link is removed (release).
export function createObjectUrlHolder(urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>) {
  let current: string | null = null;
  const release = () => {
    if (current) urls.revokeObjectURL(current);
    current = null;
  };
  return {
    release,
    make(blob: Blob): string {
      release();
      current = urls.createObjectURL(blob);
      return current;
    },
  };
}

export function initShareFlyer() {
  const actions = document.getElementById('detail-admin-actions');
  if (!actions || document.getElementById('detail-share-flyer-btn')) return;
  const button = document.createElement('button');
  button.id = 'detail-share-flyer-btn';
  button.type = 'button';
  button.className =
    'rounded-full border border-accent px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-60';
  button.textContent = 'Share flyer';
  const status = document.createElement('span');
  status.id = 'detail-share-flyer-status';
  status.setAttribute('role', 'status');
  status.className = 'basis-full text-xs font-semibold text-muted';
  actions.prepend(button);
  actions.append(status);
  const flyerUrl = createObjectUrlHolder(URL);

  button.addEventListener('click', async () => {
    const event = shared.detailEvent;
    if (!event || button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Preparing…';
    window.clearTimeout(Number(status.dataset.timer));
    status.replaceChildren();
    flyerUrl.release(); // its link was just removed
    try {
      // The series' other classes come from the admin copy of the events: wait for it, as Edit does.
      await editor.adminEventsReady;
      const full = editor.cachedAllEvents.find((e) => e.id === event.id) ?? event;
      const outcome = await shareFlyer(full, editor.cachedAllEvents, navigator as unknown as FlyerNav);
      if (outcome.download) {
        // Stays until the next tap: it is the only way to the picture.
        status.textContent = outcome.message;
        const link = document.createElement('a');
        link.href = flyerUrl.make(outcome.download);
        link.download = outcome.download.name;
        link.textContent = 'Download flyer';
        link.className = 'ml-2 font-bold text-accent underline';
        status.append(link);
      } else if (outcome.message) flashStatus(status, outcome.message);
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = 'Share flyer';
    }
  });
}
