// The editor's server calls: the admin's auth header, deleting, and the sync indicator.
import { showErrorDialog } from '../../../lib/errorDialog';
import { supabaseBrowser } from '../../../lib/supabaseBrowser';
import { syncIndicator, syncIndicatorText } from './dom';

export function showSync(text: string, autoHide: boolean) {
  syncIndicatorText.textContent = text;
  syncIndicator.classList.remove('hidden');
  syncIndicator.classList.add('flex');
  syncIndicator.style.opacity = '1';
  if (autoHide) {
    setTimeout(() => {
      syncIndicator.style.opacity = '0';
      setTimeout(() => {
        syncIndicator.classList.add('hidden');
        syncIndicator.classList.remove('flex');
      }, 300);
    }, 1500);
  }
}

export function hideSync() {
  syncIndicator.style.opacity = '0';
  syncIndicator.classList.add('hidden');
  syncIndicator.classList.remove('flex');
}

export async function withAuthHeader() {
  const {
    data: { session },
  } = await supabaseBrowser.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : null;
}

export async function performDelete(id: string, deleteSeries = false) {
  const confirmMsg = deleteSeries
    ? 'Delete the ENTIRE series? This removes every occurrence from the site and Google Calendar.'
    : 'Delete this event? This also removes it from Google Calendar.';
  if (!confirm(confirmMsg)) return;
  const headers = await withAuthHeader();
  if (!headers) return;

  showSync('Syncing to Google Calendar…', false);
  const res = await fetch('/api/admin/delete-event', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: id, deleteSeries }),
  });

  if (res.ok) {
    showSync('Synced!', true);
    setTimeout(() => window.location.reload(), 900);
  } else {
    const data = await res.json().catch(() => ({}));
    hideSync();
    await showErrorDialog('Delete failed', `The server returned ${res.status}.`, data.error ?? 'unknown error');
  }
}
