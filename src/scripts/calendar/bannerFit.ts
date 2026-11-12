// One font size for every banner title, the largest at which they all fit.

// Banner titles wrap at word boundaries only (no mid-word breaks) — if a
// word is still too wide for the banner at the current font size (a
// narrow cell, a long word, or a high browser zoom level), shrink the
// font size until it fits, rather than breaking the word. The smallest
// size is in rem, so it grows with the visitor's own font-size setting
// instead of overriding it.
const BANNER_MIN_FONT_REM = 0.625;
const bannerMinFontPx = () => BANNER_MIN_FONT_REM * parseFloat(getComputedStyle(document.documentElement).fontSize);
// True when any line of the label's text reaches into its right padding.
// (scrollWidth only notices text that spills past the padding too, so a
// word squeezed against the edge used to count as fitting.)
function labelOverflows(label: HTMLElement): boolean {
  const style = getComputedStyle(label);
  const limit = label.getBoundingClientRect().right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
  const range = document.createRange();
  range.selectNodeContents(label);
  return Array.from(range.getClientRects()).some((r) => r.right > limit + 0.5);
}

// Every banner uses the same font size, so one long title doesn't leave
// its banner in smaller text than the rest: find the size each one needs
// to fit, then give them all the smallest.
export function fitBannerLabels() {
  const labels = Array.from(document.querySelectorAll<HTMLElement>('.event-banner-label'));
  for (const label of labels) {
    label.style.fontSize = '';
    label.style.overflowWrap = '';
    label.style.hyphens = '';
  }
  // Hidden banners (e.g. the phone layout's) have no width to measure.
  const visible = labels.filter((label) => label.offsetParent !== null);
  if (visible.length === 0) return;
  const minPx = bannerMinFontPx();
  let sharedPx = parseFloat(getComputedStyle(visible[0]).fontSize);
  for (const label of visible) {
    label.style.fontSize = `${sharedPx}px`;
    if (sharedPx <= minPx || !labelOverflows(label)) continue;
    // Binary search in half-pixel steps for the largest size that fits:
    // a handful of measurements rather than one per step.
    let lo = Math.ceil(minPx * 2);
    let hi = Math.floor(sharedPx * 2) - 1;
    let best = lo;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      label.style.fontSize = `${mid / 2}px`;
      if (labelOverflows(label)) {
        hi = mid - 1;
      } else {
        best = mid;
        lo = mid + 1;
      }
    }
    sharedPx = Math.max(minPx, best / 2);
  }
  for (const label of labels) {
    label.style.fontSize = `${sharedPx}px`;
    // Still too wide at the smallest readable size (one long word in a narrow
    // cell): break it rather than shrink further or spill past the edge.
    if (label.offsetParent !== null && labelOverflows(label)) {
      label.style.hyphens = 'auto';
      label.style.overflowWrap = 'anywhere';
    }
  }
}

export function initBannerFit() {
  let fitBannerLabelsResizeTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('resize', () => {
    if (fitBannerLabelsResizeTimer) clearTimeout(fitBannerLabelsResizeTimer);
    fitBannerLabelsResizeTimer = setTimeout(fitBannerLabels, 150);
  });
}
