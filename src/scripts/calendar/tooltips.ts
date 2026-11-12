// The hover card on each calendar banner.

// Calendar hover card: opens below the banner, or above it when there's
// more room there, and slides sideways to stay inside the window. A long
// description is cut to a few lines, with a hint to click for the rest.
const TOOLTIP_MARGIN = 8;
function placeTooltip(banner: HTMLElement) {
  const tip = banner.querySelector<HTMLElement>('.event-tooltip');
  if (!tip) return;
  tip.classList.remove('bottom-full', 'mb-2');
  tip.classList.add('top-full', 'mt-2');
  tip.style.marginLeft = '';
  const desc = tip.querySelector<HTMLElement>('.tooltip-desc');
  tip.querySelector('.tooltip-more')?.classList.toggle('hidden', !desc || desc.scrollHeight <= desc.clientHeight + 1);

  const rect = tip.getBoundingClientRect();
  const bannerRect = banner.getBoundingClientRect();
  const roomBelow = window.innerHeight - bannerRect.bottom;
  const roomAbove = bannerRect.top;
  if (rect.bottom > window.innerHeight - TOOLTIP_MARGIN && roomAbove > roomBelow) {
    tip.classList.remove('top-full', 'mt-2');
    tip.classList.add('bottom-full', 'mb-2');
  }
  if (rect.left < TOOLTIP_MARGIN) tip.style.marginLeft = `${TOOLTIP_MARGIN - rect.left}px`;
  else if (rect.right > window.innerWidth - TOOLTIP_MARGIN) tip.style.marginLeft = `${window.innerWidth - TOOLTIP_MARGIN - rect.right}px`;
}

// The tooltip only repeats the details panel, so it stays out of the tab
// order and the accessibility tree: tabbing into its links would hide it
// (focus leaves the banner) with the focus still inside.
export function keepTooltipsOutOfTabOrder() {
  document.querySelectorAll<HTMLElement>('.event-tooltip a').forEach((a) => (a.tabIndex = -1));
}

export function initTooltips() {
  // Delegated so it keeps working after client-side re-rendering.
  document.addEventListener('mouseover', (e) => {
    const banner = (e.target as HTMLElement).closest<HTMLElement>('.event-banner');
    if (banner && !banner.contains(e.relatedTarget as Node | null)) placeTooltip(banner);
  });
  // A banner reached with Tab shows its tooltip too (group-focus-visible).
  document.addEventListener('focusin', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList?.contains('event-banner')) placeTooltip(target);
  });
  keepTooltipsOutOfTabOrder();
}
