// The phone's side of push notifications, for the header bell
// (components/InstallApp.astro): turning them on and off with the browser,
// and telling the site (api/push.ts). Runs in the browser only.

const publicKey = (import.meta.env.PUBLIC_VAPID_KEY as string | undefined) ?? '';

export type PushState = 'unsupported' | 'blocked' | 'off' | 'on';

// iPhones only offer push inside the installed app (iOS 16.4+), so a Safari tab is 'unsupported'.
export function pushSupported(): boolean {
  return Boolean(publicKey) && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function phonePlatform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  return /Android/.test(ua) ? 'android' : 'other';
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register('/sw.js');
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const subscription = await (await registration()).pushManager.getSubscription();
  return subscription && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function tellSite(body: unknown): Promise<void> {
  const res = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't reach the site. Try again.");
}

// Must run from a tap: browsers only ask for permission then.
export async function turnOn(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  await navigator.serviceWorker.ready;
  const reg = await registration();
  const subscription = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  try {
    await tellSite({ action: 'subscribe', subscription: subscription.toJSON(), platform: phonePlatform() });
  } catch (e) {
    // The site doesn't have it, so don't leave the phone thinking it's on.
    await subscription.unsubscribe().catch(() => {});
    throw e;
  }
  return 'on';
}

export async function turnOff(): Promise<PushState> {
  const subscription = await (await registration()).pushManager.getSubscription();
  if (subscription) {
    const { endpoint, keys } = subscription.toJSON();
    await subscription.unsubscribe();
    // If the site can't be told now, its next send finds the phone gone and removes it.
    await tellSite({ action: 'unsubscribe', endpoint, auth: keys?.auth }).catch(() => {});
  }
  return 'off';
}
