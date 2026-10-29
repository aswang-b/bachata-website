// The red pin before a location. Drawn rather than the 📍 emoji: each emoji
// font leaves a different blank margin on its left (Android's more than
// Windows'), so the emoji never lined up with the text above it. This one
// starts flush with its line on every device. Decorative (the location's
// name follows it), so screen readers skip it.
export const PIN_SVG =
  '<svg aria-hidden="true" focusable="false" viewBox="0 0 10 16" style="display:inline-block;width:0.625em;height:1em;vertical-align:-0.15em;margin-right:0.15em">' +
  '<line x1="5" y1="9" x2="5" y2="15.5" stroke="#9aa5b1" stroke-width="1.6" stroke-linecap="round"/>' +
  '<circle cx="5" cy="5" r="5" fill="#dd2e44"/>' +
  '<circle cx="3.4" cy="3.4" r="1.4" fill="#fff" fill-opacity="0.45"/>' +
  '</svg>';
