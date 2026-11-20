// Sharing pieces the calendar's admin "Share flyer" (calendar/editor/shareFlyer.ts)
// uses. Pure functions of a navigator-like object so they are unit-tested.
// Never opens a window or a third-party share URL.
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

// A polite status message beside a button that clears after about 3 seconds.
const SHOWN_MS = 3000;
export function flashStatus(status: HTMLElement, message: string): void {
  status.textContent = message;
  window.clearTimeout(Number(status.dataset.timer));
  status.dataset.timer = String(window.setTimeout(() => (status.textContent = ''), SHOWN_MS));
}
