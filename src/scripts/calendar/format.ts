// Text the calendar builds from an event: prices (with any early bird or
// flash sale running), spots left. Its date and times come from
// lib/eventClock.ts, in the event's own zone.
import { getActivePrice, priceTierLabel } from '../../lib/pricing';
import type { SiteEvent } from './types';

function formatPrice(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function priceTypeHtml(label: string, event: SiteEvent, field: 'whole' | 'dropIn' | 'student', suffix = ''): string {
  const base = field === 'whole' ? event.price_whole_series : field === 'dropIn' ? event.price_drop_in : event.price_student;
  if (base == null) return '';
  const earlyBird = field === 'whole' ? event.price_whole_series_early_bird : field === 'dropIn' ? event.price_drop_in_early_bird : event.price_student_early_bird;
  const flashSale = field === 'whole' ? event.price_whole_series_flash_sale : field === 'dropIn' ? event.price_drop_in_flash_sale : event.price_student_flash_sale;
  const result = getActivePrice(new Date(), {
    base,
    earlyBird,
    earlyBirdUntil: event.early_bird_until,
    flashSale,
    flashSaleUntil: event.flash_sale_until,
  });
  const prefix = label ? `${label}: ` : '';
  if (result.display === 'original') return `${prefix}${formatPrice(result.originalPrice!)}${suffix}`;
  return `${prefix}<s class="text-muted">${formatPrice(result.originalPrice!)}</s> ${formatPrice(result.activePrice!)}${suffix} <span class="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">${priceTierLabel(result.tag)}</span>`;
}

export function buildPriceLines(event: SiteEvent): { main: string; student: string } {
  // Events have a single ticket price (with its own early bird / flash sale).
  if (event.event_type === 'event') return { main: priceTypeHtml('Ticket', event, 'whole'), student: '' };
  // A workshop (a class that doesn't repeat) has one price: what registration
  // charges for it, its whole-series price, or its drop-in price without one.
  if (!event.weekNumber) {
    return { main: priceTypeHtml('Workshop', event, event.price_whole_series != null ? 'whole' : 'dropIn'), student: priceTypeHtml('Student Discount', event, 'student') };
  }
  const parts: string[] = [];
  // Events (not classes) just list the price, with no per-class unit.
  const perClass = event.event_type === 'event' ? '' : '/class';
  const whole = priceTypeHtml('Whole Series', event, 'whole');
  const dropIn = priceTypeHtml('Drop In', event, 'dropIn', perClass);
  if (whole) parts.push(whole);
  if (dropIn) parts.push(dropIn);
  const student = priceTypeHtml('Student Discount', event, 'student', perClass);
  return { main: parts.join(' &middot; '), student };
}

// "X spots remaining", noting when only admins can see it.
export function spotsText(event: SiteEvent): string {
  if (!event.spots_label) return '';
  return event.spots_admin_only ? `${event.spots_label} (admin only)` : event.spots_label;
}

export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
