// Sharing a class from the browser: the homepage's Share buttons (dancers) and
// the pieces the calendar's admin "Share flyer" reuses. The decisions are pure
// functions of a navigator-like object so they are unit-tested; the wiring at
// the bottom is thin. Never opens a window or a third-party share URL.
import { classPath } from '../lib/classLink';

// The class's own absolute link (the path rule of the Register button).
export function classShareUrl(origin: string, eventType: string | null | undefined, key: string): string {
  return `${origin}${classPath(eventType, key)}`;
}

export interface ShareData {
  title?: string;
  text?: string;
  url?: string;
}
export interface ShareNav {
  share?: (data: ShareData) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
}
// shared: the phone's share sheet took it; cancelled: closed without sharing (say nothing);
// copied: the link is on the clipboard; manual: nothing worked, show the link to copy by hand.
export type ShareResult = 'shared' | 'cancelled' | 'copied' | 'manual';

export const isAbort = (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError';

export async function copyText(text: string, nav: ShareNav): Promise<boolean> {
  try {
    if (!nav.clipboard) return false;
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function shareLink(data: Required<ShareData>, nav: ShareNav = navigator): Promise<ShareResult> {
  if (typeof nav.share === 'function') {
    try {
      await nav.share(data);
      return 'shared';
    } catch (err) {
      if (isAbort(err)) return 'cancelled';
    }
  }
  return (await copyText(data.url, nav)) ? 'copied' : 'manual';
}

// A polite status message beside a button that clears after about 3 seconds.
const SHOWN_MS = 3000;
export function flashStatus(status: HTMLElement, message: string): void {
  status.textContent = message;
  window.clearTimeout(Number(status.dataset.timer));
  status.dataset.timer = String(window.setTimeout(() => (status.textContent = ''), SHOWN_MS));
}

// The link in a small selectable field, when it can't be copied for the visitor.
export function showManualLink(host: HTMLElement, url: string): void {
  host.querySelector('[data-share-manual]')?.remove();
  const field = document.createElement('input');
  field.readOnly = true;
  field.value = url;
  field.setAttribute('data-share-manual', '');
  field.setAttribute('aria-label', 'Link to copy');
  field.className = 'mt-1 w-full rounded-lg border border-border bg-bg px-2 py-1 text-xs text-ink';
  host.append(field);
  field.focus();
  field.select();
}

// Every [data-share] button on the page (rendered by the server with its data).
export function initShareButtons(): void {
  document.addEventListener('click', async (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-share]');
    if (!button) return;
    const host = button.closest<HTMLElement>('[data-share-row]')!;
    const status = host.querySelector<HTMLElement>('[data-share-status]')!;
    const url = classShareUrl(location.origin, button.dataset.shareType, button.dataset.shareKey ?? '');
    const result = await shareLink({ title: button.dataset.shareTitle ?? '', text: button.dataset.shareText ?? '', url });
    if (result === 'copied') flashStatus(status, 'Link copied');
    else if (result === 'manual') showManualLink(host, url);
  });
}
