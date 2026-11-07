import QRCode from 'qrcode';

// A plain QR code as an SVG, drawn on the server: sharp at any size, with no
// script on the page. With a logo (an image's address on this site), the code
// uses its highest error correction and leaves a white square in the middle for
// it, as the door sign's Venmo code does (lib/qrSign.ts draws that one).

const MARGIN = 2;
const LOGO_SHARE = 0.22;

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function qrSvg(text: string, opts: { logo?: string; label: string }): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: opts.logo ? 'H' : 'M' });
  const n = qr.modules.size;
  const size = n + MARGIN * 2;
  // One path of 1x1 squares, in module units (the viewBox scales it).
  let d = '';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) if (qr.modules.get(row, col)) d += `M${col + MARGIN} ${row + MARGIN}h1v1h-1z`;
  }
  let logo = '';
  if (opts.logo) {
    const side = size * LOGO_SHARE;
    const at = (size - side) / 2;
    logo = `<rect x="${at - 1}" y="${at - 1}" width="${side + 2}" height="${side + 2}" rx="1.5" fill="#fff"/><image href="${escapeAttr(opts.logo)}" x="${at}" y="${at}" width="${side}" height="${side}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeAttr(opts.label)}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path fill="#111" d="${d}"/>${logo}</svg>`;
}
