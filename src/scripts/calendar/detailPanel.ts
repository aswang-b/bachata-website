// The details panel beside the month grid: the event a banner or day opened.
import { eventTypeLabel } from '../../lib/classSeries';
import { eventDotStyle, eventTextStyle } from '../../lib/eventColors';
import { locationHref } from '../../lib/locationLink';
import { PIN_SVG } from '../../lib/locationPin';
import { eventDate, eventTimeRange } from '../../lib/eventClock';
import { buildPriceLines, spotsText } from './format';
import { shared } from './state';
import type { SiteEvent } from './types';

const detailPlaceholder = document.getElementById('detail-placeholder')!;
const detailContent = document.getElementById('detail-content')!;
const detailType = document.getElementById('detail-type')!;
const detailTitle = document.getElementById('detail-title')!;
const detailDatetime = document.getElementById('detail-datetime')!;
const detailDescription = document.getElementById('detail-description')!;
const detailPrice = document.getElementById('detail-price')!;
const detailPriceStudent = document.getElementById('detail-price-student')!;
const detailRegisterBtn = document.getElementById('detail-register-btn') as HTMLAnchorElement;
const detailFlyerBtn = document.getElementById('detail-flyer-btn') as HTMLButtonElement;
const detailLocation = document.getElementById('detail-location') as HTMLAnchorElement;
const detailSpots = document.getElementById('detail-spots')!;
const detailAdminActions = document.getElementById('detail-admin-actions')!;
const detailDeleteSeriesBtn = document.getElementById('detail-delete-series-btn')!;

export function showEventDetail(event: SiteEvent) {
  shared.detailEvent = event;
  detailPlaceholder.classList.add('hidden');
  detailContent.classList.remove('hidden');
  detailContent.classList.add('flex');

  const lock = event.visibility === 'private' ? '🔒 ' : '';
  detailType.className = 'flex items-center gap-2 text-xs font-bold uppercase tracking-wider';
  detailType.style.cssText = eventTextStyle(event.color);
  detailType.innerHTML = `<span class="h-2 w-2 rounded-full" style="${eventDotStyle(event.color)}"></span>${eventTypeLabel(event.event_type, event.weekNumber)}${event.weekNumber ? `<span class="font-bold text-ink">&middot; Week ${event.weekNumber}</span>` : ''}`;
  detailTitle.textContent = `${lock}${event.title}`;
  detailDatetime.textContent = `${eventDate(event)} · ${eventTimeRange(event)}`;
  detailDescription.innerHTML = event.description ?? '';
  detailDescription.classList.toggle('hidden', !event.description);

  const priceLines = buildPriceLines(event);
  detailPrice.innerHTML = priceLines.main;
  detailPrice.classList.toggle('hidden', !priceLines.main);
  detailPriceStudent.innerHTML = priceLines.student;
  detailPriceStudent.classList.toggle('hidden', !priceLines.student);
  detailSpots.textContent = spotsText(event);
  detailSpots.classList.toggle('hidden', !detailSpots.textContent);

  // Only public classes/events actually appear as a pickable series on
  // the registration pages — a private one would 404 the preselect, so
  // the button only shows where it can actually work.
  if (event.visibility !== 'private' && event.registration_closed) {
    detailRegisterBtn.removeAttribute('href');
    detailRegisterBtn.textContent = 'Registration Closed';
    detailRegisterBtn.classList.remove('hidden', 'gradient-accent', 'hover:opacity-90');
    detailRegisterBtn.classList.add('bg-border', 'text-ink/50', 'pointer-events-none');
  } else if (event.visibility !== 'private') {
    const seriesKey = event.google_recurring_event_id ?? event.id;
    const base = event.event_type === 'event' ? '/register/events' : '/register';
    detailRegisterBtn.href = `${base}?series=${encodeURIComponent(seriesKey)}`;
    detailRegisterBtn.textContent = 'Register Now';
    detailRegisterBtn.classList.remove('hidden', 'bg-border', 'text-ink/50', 'pointer-events-none');
    detailRegisterBtn.classList.add('gradient-accent', 'hover:opacity-90');
  } else {
    detailRegisterBtn.classList.add('hidden');
  }

  if (event.flyer_url) detailFlyerBtn.dataset.flyerOpen = event.flyer_url;
  else delete detailFlyerBtn.dataset.flyerOpen;
  detailFlyerBtn.dataset.flyerAlt = `Flyer for ${event.title}`;
  detailFlyerBtn.classList.toggle('hidden', !event.flyer_url);
  detailFlyerBtn.classList.toggle('inline-flex', Boolean(event.flyer_url));

  if (event.location) {
    detailLocation.href = locationHref(event.location);
    // Only the location name is underlined, not the pin.
    const pin = document.createElement('span');
    pin.setAttribute('aria-hidden', 'true');
    pin.innerHTML = PIN_SVG;
    const label = document.createElement('span');
    label.className = 'underline';
    label.textContent = event.location;
    detailLocation.replaceChildren(pin, label);
    detailLocation.classList.remove('hidden');
  } else {
    detailLocation.classList.add('hidden');
  }

  detailDeleteSeriesBtn.classList.toggle('hidden', !event.google_recurring_event_id);

  if (shared.adminModeActive) {
    detailAdminActions.classList.remove('hidden');
    detailAdminActions.classList.add('flex');
  }
}
