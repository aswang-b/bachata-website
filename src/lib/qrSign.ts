import QRCode from 'qrcode';

// Browser-only drawing for the door sign (/admin/qr): plain QR codes (the
// Venmo one with Venmo's logo in the middle) and the sign as a PNG.

export interface SignContent {
  heading: string;
  checkin: { branded: HTMLImageElement | null; text: string; classes: string } | null;
  venmo: { text: string; label: string; username: string; logo: HTMLImageElement | null } | null;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${src}`));
    img.src = src;
  });
}

// Quiet zone, in modules, around every code.
const MARGIN = 2;
// Share of the code's width the Venmo logo covers (level H recovers 30%).
const LOGO_SHARE = 0.22;

// Draws a plain code into a square at (x, y). With a logo, error correction
// is at its highest so the covered middle still scans.
export function drawCode(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, logo: HTMLImageElement | null = null): void {
  const qr = QRCode.create(text, { errorCorrectionLevel: logo ? 'H' : 'M' });
  const n = qr.modules.size;
  const cell = size / (n + MARGIN * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#111111';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!qr.modules.get(row, col)) continue;
      // Whole pixels, slightly overlapped, so no hairlines show between modules.
      const left = Math.floor(x + (col + MARGIN) * cell);
      const top = Math.floor(y + (row + MARGIN) * cell);
      ctx.fillRect(left, top, Math.ceil(cell) + 1, Math.ceil(cell) + 1);
    }
  }
  if (!logo) return;
  const side = size * LOGO_SHARE;
  const pad = cell;
  const lx = x + (size - side) / 2;
  const ly = y + (size - side) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(lx - pad, ly - pad, side + pad * 2, side + pad * 2, pad * 1.5);
  ctx.fill();
  ctx.drawImage(logo, lx, ly, side, side);
}

export function codeCanvas(text: string, size: number, logo: HTMLImageElement | null = null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  drawCode(canvas.getContext('2d')!, text, 0, 0, size, logo);
  return canvas;
}

const W = 1920;
const H = 1080;
const INK = '#1c1114';
const MUTED = '#6b5a5e';
const ACCENT = '#b3264c';
const VENMO_BLUE = '#008cff';
const DISPLAY = '800 64px Poppins, "Segoe UI", system-ui, sans-serif';

function centered(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string, maxWidth: number) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y, maxWidth);
}

// The sign at 1920×1080 (16:9, a TV or a landscape print), as a PNG. With a
// branded check-in code, its simple version sits small beside it for older phones.
export async function signPng(content: SignContent): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  await document.fonts?.ready;
  ctx.fillStyle = '#fffdfb';
  ctx.fillRect(0, 0, W, H);

  const halves = [content.checkin, content.venmo].filter(Boolean).length;
  const half = W / Math.max(halves, 1);
  const code = 500;
  const top = 250;
  if (content.heading) centered(ctx, content.heading, W / 2, 110, DISPLAY, INK, W - 160);

  let x = 0;
  if (content.checkin) {
    const cx = x + half / 2;
    centered(ctx, halves > 1 ? 'STEP 1' : 'CHECK IN', cx, top - 70, '700 26px Inter, system-ui, sans-serif', ACCENT, half - 80);
    centered(ctx, 'Check in for class', cx, top - 20, '800 48px Poppins, system-ui, sans-serif', INK, half - 80);
    if (content.checkin.branded) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - code / 2, top + 10, code, code);
      ctx.drawImage(content.checkin.branded, cx - code / 2, top + 10, code, code);
      // The simple code, for phones that struggle with the branded one, in a row below.
      const small = 150;
      ctx.font = '600 22px Inter, system-ui, sans-serif';
      const note = 'Older phone? Scan this one';
      const rowWidth = ctx.measureText(note).width + 20 + small;
      const rowX = cx - rowWidth / 2;
      drawCode(ctx, content.checkin.text, rowX + rowWidth - small, H - small - 30, small);
      ctx.textAlign = 'left';
      ctx.fillStyle = MUTED;
      ctx.fillText(note, rowX, H - 30 - small / 2 + 8);
    } else {
      drawCode(ctx, content.checkin.text, cx - code / 2, top + 10, code);
    }
    if (content.checkin.classes) centered(ctx, content.checkin.classes, cx, top + code + 60, '500 28px Inter, system-ui, sans-serif', MUTED, half - 120);
    x += half;
  }
  if (content.venmo) {
    const cx = x + half / 2;
    if (halves > 1) {
      ctx.strokeStyle = '#ecdfe2';
      ctx.setLineDash([14, 12]);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, 200);
      ctx.lineTo(x, H - 80);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    centered(ctx, halves > 1 ? 'STEP 2' : 'PAY', cx, top - 70, '700 26px Inter, system-ui, sans-serif', ACCENT, half - 80);
    ctx.font = '800 48px Poppins, system-ui, sans-serif';
    const lead = 'Pay on ';
    const full = ctx.measureText(lead + 'Venmo').width;
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.fillText(lead, cx - full / 2, top - 20);
    ctx.fillStyle = VENMO_BLUE;
    ctx.fillText('Venmo', cx - full / 2 + ctx.measureText(lead).width, top - 20);
    drawCode(ctx, content.venmo.text, cx - code / 2, top + 10, code, content.venmo.logo);
    centered(ctx, `@${content.venmo.username}${content.venmo.label ? ` · ${content.venmo.label}` : ''}`, cx, top + code + 60, '500 28px Inter, system-ui, sans-serif', MUTED, half - 120);
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the image."))), 'image/png'));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
