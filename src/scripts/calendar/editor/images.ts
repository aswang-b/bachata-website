// The editor's homepage image: cropped, then uploaded.
import { openImageCropper } from '../../../lib/imageCropper';
import { withAuthHeader } from './api';
import { imageError, imageFileInput, imagePreview, imageRemoveBtn, imageUploadLabel, imageUrlInput } from './dom';

export function updateImagePreview() {
  const url = imageUrlInput.value;
  if (url) {
    imagePreview.src = url;
    imagePreview.classList.remove('hidden');
    imageRemoveBtn.classList.remove('hidden');
    imageUploadLabel.textContent = 'Replace Image';
  } else {
    imagePreview.classList.add('hidden');
    imagePreview.removeAttribute('src');
    imageRemoveBtn.classList.add('hidden');
    imageUploadLabel.textContent = 'Upload Image';
  }
}

export function initImageUpload() {
  imageFileInput.addEventListener('change', async () => {
    const picked = imageFileInput.files?.[0];
    imageFileInput.value = '';
    if (!picked) return;

    imageError.classList.add('hidden');

    // The admin chooses which region of the photo shows on the homepage before
    // anything uploads; only the cropped result is stored.
    let cropped: Blob | null;
    try {
      cropped = await openImageCropper(picked);
    } catch (err) {
      imageError.textContent = err instanceof Error ? err.message : "That file couldn't be read as an image.";
      imageError.classList.remove('hidden');
      return;
    }
    if (!cropped) return;

    imageUploadLabel.textContent = 'Uploading…';

    const headers = await withAuthHeader();
    if (!headers) {
      updateImagePreview();
      return;
    }

    const baseName = picked.name.replace(/\.[^.]+$/, '') || 'event';
    const body = new FormData();
    body.append('file', new File([cropped], `${baseName}-banner.jpg`, { type: 'image/jpeg' }));

    try {
      const res = await fetch('/api/admin/upload-event-image', { method: 'POST', headers, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Failed to upload image.');
      imageUrlInput.value = data.url;
    } catch (err) {
      imageError.textContent = err instanceof Error ? err.message : 'Failed to upload image.';
      imageError.classList.remove('hidden');
    } finally {
      imageFileInput.value = '';
      updateImagePreview();
    }
  });

  imageRemoveBtn.addEventListener('click', () => {
    imageUrlInput.value = '';
    updateImagePreview();
  });
}
