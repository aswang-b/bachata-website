// Browser-only crop dialog for event images. The crop is locked to the shape the
// homepage offering card actually shows on desktop (768x144 = 16:3), exported at
// 2x so it stays sharp on high-density screens.
//
// Phones show the same image at ~2.9:1 with object-cover, which trims the sides,
// so the dialog draws a dashed "phone view" guide over the middle of the frame.

export const CROP_ASPECT = 16 / 3;
export const CROP_OUTPUT_WIDTH = 1536;
export const CROP_OUTPUT_HEIGHT = 288;

// Narrowest phones show roughly the middle 55% of the banner's width.
const PHONE_VISIBLE_FRACTION = 0.55;
const MAX_ZOOM = 5;
const LOW_RES_WIDTH = CROP_OUTPUT_WIDTH / 2;

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}

async function decodeImage(file: File): Promise<DecodedImage> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
  } catch {
    // Fall back to an <img> element for browsers without createImageBitmap options.
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, dispose: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("That file couldn't be read as an image.");
  }
}

// Resolves with the cropped JPEG, or null if the admin cancels.
export async function openImageCropper(file: File): Promise<Blob | null> {
  const image = await decodeImage(file);

  // The largest crop box that fits inside the image at the locked aspect ratio.
  const maxBoxWidth = Math.min(image.width, image.height * CROP_ASPECT);
  let boxWidth = maxBoxWidth;
  let boxX = (image.width - boxWidth) / 2;
  let boxY = (image.height - boxWidth / CROP_ASPECT) / 2;

  const viewWidth = Math.max(240, Math.min(632, window.innerWidth - 72));
  const viewMaxHeight = Math.max(160, Math.min(420, window.innerHeight * 0.5));
  const displayScale = Math.min(viewWidth / image.width, viewMaxHeight / image.height);
  const cssWidth = Math.round(image.width * displayScale);
  const cssHeight = Math.round(image.height * displayScale);
  const pixelRatio = window.devicePixelRatio || 1;

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Crop image');
  overlay.innerHTML = `
    <div class="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-y-auto overflow-x-hidden rounded-2xl bg-bg p-5 shadow-2xl">
      <div>
        <h3 class="font-display text-lg font-bold text-ink">Crop image</h3>
        <p class="mt-1 text-xs text-muted">
          Drag the box (or click) to choose what shows on the homepage. Use the slider or scroll to zoom. The whole box is the desktop banner;
          the dashed lines mark the area phones show.
        </p>
      </div>
      <div class="flex justify-center rounded-xl bg-black/80 p-2">
        <canvas data-crop-canvas class="touch-none select-none rounded-md" style="width:${cssWidth}px;height:${cssHeight}px"></canvas>
      </div>
      <label class="flex items-center gap-3 text-xs font-semibold text-muted">
        Zoom
        <input data-crop-zoom type="range" min="1" max="${MAX_ZOOM}" step="0.01" value="1" class="flex-1" />
      </label>
      <p data-crop-warning class="hidden text-xs font-semibold text-amber-600"></p>
      <div class="flex justify-end gap-2">
        <button type="button" data-crop-cancel class="rounded-full border border-border px-4 py-2 text-sm font-semibold text-ink/70 transition-colors hover:bg-surface">Cancel</button>
        <button type="button" data-crop-confirm class="gradient-accent rounded-full px-5 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90">Use this crop</button>
      </div>
    </div>
  `;

  const canvas = overlay.querySelector<HTMLCanvasElement>('[data-crop-canvas]')!;
  const zoomInput = overlay.querySelector<HTMLInputElement>('[data-crop-zoom]')!;
  const warning = overlay.querySelector<HTMLElement>('[data-crop-warning]')!;
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  const ctx = canvas.getContext('2d')!;

  const boxHeight = () => boxWidth / CROP_ASPECT;

  function clampBox() {
    boxX = Math.min(Math.max(boxX, 0), image.width - boxWidth);
    boxY = Math.min(Math.max(boxY, 0), image.height - boxHeight());
  }

  function render() {
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.drawImage(image.source, 0, 0, cssWidth, cssHeight);

    // Dim everything, then redraw the image inside the box at full brightness.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const x = boxX * displayScale;
    const y = boxY * displayScale;
    const w = boxWidth * displayScale;
    const h = boxHeight() * displayScale;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(image.source, 0, 0, cssWidth, cssHeight);
    ctx.restore();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    const phoneLeft = x + (w * (1 - PHONE_VISIBLE_FRACTION)) / 2;
    const phoneRight = phoneLeft + w * PHONE_VISIBLE_FRACTION;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(phoneLeft, y);
    ctx.lineTo(phoneLeft, y + h);
    ctx.moveTo(phoneRight, y);
    ctx.lineTo(phoneRight, y + h);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '600 10px sans-serif';
    ctx.textBaseline = 'top';
    const label = 'PHONE VIEW';
    const labelWidth = ctx.measureText(label).width + 10;
    if (phoneRight - phoneLeft > labelWidth + 4 && h > 22) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(phoneLeft + 4, y + 4, labelWidth, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, phoneLeft + 9, y + 8);
    }

    const lowRes = boxWidth < LOW_RES_WIDTH;
    warning.classList.toggle('hidden', !lowRes);
    if (lowRes) {
      warning.textContent = `This crop is only ${Math.round(boxWidth)}px wide, so it may look soft on the homepage. Zoom out or use a larger photo.`;
    }
  }

  function pointerToSource(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * image.width,
      y: ((event.clientY - rect.top) / rect.height) * image.height,
    };
  }

  let grab: { dx: number; dy: number } | null = null;

  canvas.addEventListener('pointerdown', (event) => {
    const p = pointerToSource(event);
    const inside = p.x >= boxX && p.x <= boxX + boxWidth && p.y >= boxY && p.y <= boxY + boxHeight();
    grab = inside ? { dx: p.x - boxX, dy: p.y - boxY } : { dx: boxWidth / 2, dy: boxHeight() / 2 };
    boxX = p.x - grab.dx;
    boxY = p.y - grab.dy;
    clampBox();
    canvas.setPointerCapture(event.pointerId);
    render();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!grab) return;
    const p = pointerToSource(event);
    boxX = p.x - grab.dx;
    boxY = p.y - grab.dy;
    clampBox();
    render();
  });

  const endDrag = () => {
    grab = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Zoom keeps the box centered on the same point.
  function setZoom(zoom: number) {
    const clamped = Math.min(Math.max(zoom, 1), MAX_ZOOM);
    const centerX = boxX + boxWidth / 2;
    const centerY = boxY + boxHeight() / 2;
    boxWidth = maxBoxWidth / clamped;
    boxX = centerX - boxWidth / 2;
    boxY = centerY - boxHeight() / 2;
    clampBox();
    zoomInput.value = String(clamped);
    render();
  }

  zoomInput.addEventListener('input', () => setZoom(Number(zoomInput.value)));
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      setZoom(Number(zoomInput.value) * (event.deltaY < 0 ? 1.08 : 1 / 1.08));
    },
    { passive: false }
  );

  return new Promise<Blob | null>((resolve) => {
    function close(result: Blob | null) {
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      image.dispose();
      resolve(result);
    }

    function onKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(null);
      }
    }

    overlay.querySelector('[data-crop-cancel]')!.addEventListener('click', () => close(null));
    overlay.querySelector('[data-crop-confirm]')!.addEventListener('click', () => {
      const out = document.createElement('canvas');
      out.width = CROP_OUTPUT_WIDTH;
      out.height = CROP_OUTPUT_HEIGHT;
      const outCtx = out.getContext('2d')!;
      // JPEG has no transparency, so flatten onto white (matters for PNG/WebP uploads).
      outCtx.fillStyle = '#ffffff';
      outCtx.fillRect(0, 0, out.width, out.height);
      outCtx.drawImage(image.source, boxX, boxY, boxWidth, boxHeight(), 0, 0, out.width, out.height);
      out.toBlob((blob) => close(blob), 'image/jpeg', 0.9);
    });

    document.addEventListener('keydown', onKeydown, true);
    document.body.appendChild(overlay);
    render();
  });
}
