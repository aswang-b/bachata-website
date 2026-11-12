// The editor's Location field: Google Places suggestions, or plain text when Places is unavailable.
import { withAuthHeader } from './api';
import { locationInput, setLocationInput } from './dom';

declare const google: any;
let mapsBootstrapped = false;
let locationAutocomplete: any = null;

// Google's official dynamic-library-import bootstrap loader. Deliberately
// NOT the simpler `<script src="...&libraries=places&loading=async">` +
// onload approach — that races the `places` library against the main
// script's load event and can silently leave `google.maps.places`
// undefined on a cold load (it only "worked" in earlier manual testing
// because the browser had a warm cache). `importLibrary` awaits the
// specific library actually being ready.
function bootstrapGoogleMaps(apiKey: string) {
  if (mapsBootstrapped) return;
  mapsBootstrapped = true;
  (g => {
    let h: any, a: any, k: string, p = 'The Google Maps JavaScript API', c = 'google', l = 'importLibrary', q = '__ib__',
      m = document, b: any = window;
    b = b[c] || (b[c] = {});
    let d = b.maps || (b.maps = {}), r = new Set<string>(), e = new URLSearchParams(),
      u = () => h || (h = new Promise(async (f: any, n: any) => {
        await (a = m.createElement('script'));
        e.set('libraries', [...r] + '');
        for (k in g) e.set(k.replace(/[A-Z]/g, (t) => '_' + t[0].toLowerCase()), (g as any)[k]);
        e.set('callback', c + '.maps.' + q);
        a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
        d[q] = f;
        a.onerror = () => (h = n(new Error(p + ' could not load.')));
        a.nonce = (m.querySelector('script[nonce]') as HTMLScriptElement | null)?.nonce || '';
        m.head.append(a);
      }));
    d[l] ? console.warn(p + ' only loads once. Ignoring:', g) : (d[l] = (f: any, ...n: any[]) => r.add(f) && u().then(() => d[l](f, ...n)));
  })({ key: apiKey, v: 'weekly' });
}

let placesUnavailable = false;

// When Google rejects the key (referrer not allowed, API not enabled,
// billing/quota), the legacy Autocomplete widget only finds out on the
// first prediction request a few keystrokes in. It then disables the input
// and swaps the placeholder for "Oops! Something went wrong.", locking the
// admin out of the field. Google calls `window.gm_authFailure` when this
// happens, so swap in a fresh clone of the input (dropping the widget's
// listeners) and fall back to plain-text entry for the rest of the visit.
function installPlacesAuthFailureFallback() {
  (window as any).gm_authFailure = () => {
    console.error(
      'Google Maps rejected the API key (check its HTTP referrer restrictions and that the Places API is enabled). Location field falls back to plain text.'
    );
    placesUnavailable = true;
    // Google may finish disabling the input after this callback returns.
    setTimeout(restorePlainLocationInput, 0);
  };
}

function restorePlainLocationInput() {
  if (locationAutocomplete) google.maps.event.clearInstanceListeners(locationAutocomplete);
  locationAutocomplete = null;
  document.querySelectorAll('.pac-container').forEach((el) => el.remove());

  const typed = locationInput.value;
  const fresh = locationInput.cloneNode(false) as HTMLInputElement;
  fresh.disabled = false;
  fresh.classList.remove('gm-err-autocomplete');
  fresh.removeAttribute('style');
  fresh.removeAttribute('autocomplete');
  fresh.placeholder = 'Location';
  fresh.value = typed;
  const hadFocus = document.activeElement === locationInput;
  locationInput.replaceWith(fresh);
  setLocationInput(fresh);
  if (hadFocus) fresh.focus();
}

export async function initLocationAutocomplete() {
  if (locationAutocomplete || placesUnavailable) return;

  try {
    const headers = await withAuthHeader();
    if (!headers) return;
    const usageRes = await fetch('/api/admin/places-usage-check', { headers });
    const { allowed } = await usageRes.json();
    if (!allowed) {
      console.warn('Daily Places Autocomplete usage cap reached — location field will accept plain text only today.');
      return;
    }

    const apiKey = import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) throw new Error('Missing PUBLIC_GOOGLE_MAPS_API_KEY.');
    bootstrapGoogleMaps(apiKey);
    const { Autocomplete } = await google.maps.importLibrary('places');

    installPlacesAuthFailureFallback();
    locationAutocomplete = new Autocomplete(locationInput, {
      fields: ['name', 'formatted_address'],
    });
    locationAutocomplete.addListener('place_changed', () => {
      const place = locationAutocomplete.getPlace();
      locationInput.value = place?.name || place?.formatted_address || locationInput.value;
    });
  } catch (err) {
    console.error('Failed to initialize location autocomplete:', err);
  }
}
