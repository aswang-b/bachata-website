// The editor's flyer: scaled down and uploaded, one flyer shared by linked classes.
import { withAuthHeader } from './api';
import { linkedEditor } from './linked';
import { editor, seriesKeyOfEvent } from './state';

export const flyerUrlInput = document.getElementById('event-flyer-url') as HTMLInputElement;
const flyerFileInput = document.getElementById('event-flyer-file') as HTMLInputElement;
const flyerPreview = document.getElementById('event-flyer-preview') as HTMLImageElement;
const flyerUploadLabel = document.getElementById('event-flyer-upload-label')!;
const flyerRemoveBtn = document.getElementById('event-flyer-remove') as HTMLButtonElement;
export const flyerError = document.getElementById('event-flyer-error')!;
const flyerShared = document.getElementById('event-flyer-shared')!;

export function updateFlyerPreview() {
  const url = flyerUrlInput.value;
  const own = editor.editingEvent ? seriesKeyOfEvent(editor.editingEvent) : null;
  const others = own ? linkedEditor.groupKeys(own).filter((k) => k !== own).map((k) => linkedEditor.occurrenceFor(k, null)?.title ?? '') : [];
  flyerShared.textContent = others.length ? `Also used by ${others.filter(Boolean).join(', ')}.` : '';
  flyerShared.classList.toggle('hidden', others.length === 0);
  flyerPreview.classList.toggle('hidden', !url);
  flyerRemoveBtn.classList.toggle('hidden', !url);
  if (url) flyerPreview.src = url;
  else flyerPreview.removeAttribute('src');
  flyerUploadLabel.textContent = url ? 'Replace Flyer' : 'Upload Flyer';
}

// Flyers upload uncropped, scaled down so the long side is at most 2000px,
// with their final pixel size (the homepage reserves their space with it).
// A PNG or WebP may be see-through, so it's re-encoded as WebP, which keeps
// that (JPEG would turn it black); a JPEG stays a JPEG.
async function shrinkFlyer(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  if (scale === 1 && file.size <= 2 * 1024 * 1024) return { blob: file, width, height };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("That file couldn't be read as an image."))), type, 0.9)
  );
  return { blob, width, height };
}

const FLYER_EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function initFlyerUpload() {
  flyerFileInput.addEventListener('change', async () => {
    const picked = flyerFileInput.files?.[0];
    flyerFileInput.value = '';
    if (!picked) return;
    flyerError.classList.add('hidden');
    flyerUploadLabel.textContent = 'Uploading…';
    try {
      const { blob, width, height } = await shrinkFlyer(picked);
      const headers = await withAuthHeader();
      if (!headers) return;
      const body = new FormData();
      const baseName = picked.name.replace(/\.[^.]+$/, '') || 'flyer';
      // A browser that can't write WebP hands back a PNG, which is named as one.
      body.append('file', blob === picked ? picked : new File([blob], `${baseName}-flyer.${FLYER_EXTENSIONS[blob.type] ?? 'png'}`, { type: blob.type }));
      body.append('width', String(width));
      body.append('height', String(height));
      const res = await fetch('/api/admin/upload-event-image', { method: 'POST', headers, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Failed to upload flyer.');
      flyerUrlInput.value = data.url;
      editor.pendingFlyer = data.url;
    } catch (err) {
      flyerError.textContent = err instanceof Error ? err.message : 'Failed to upload flyer.';
      flyerError.classList.remove('hidden');
    } finally {
      updateFlyerPreview();
    }
  });

  flyerRemoveBtn.addEventListener('click', () => {
    flyerUrlInput.value = '';
    editor.pendingFlyer = '';
    updateFlyerPreview();
  });
}
