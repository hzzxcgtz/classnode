/** Keep small photos untouched and preserve iPad 9's full 8 MP resolution. */
const MIN_PHOTO_BYTES = 2 * 1024 * 1024;
const MAX_CANVAS_PIXELS = 12_000_000;
const MAX_LONG_EDGE = 4096;
const PROCESS_TIMEOUT_MS = 8_000;

export function worksheetPhotoCompressionPlan(bytes: number, width: number, height: number) {
  if (bytes <= MIN_PHOTO_BYTES || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(width, height), Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 0.9 };
}

/** Best effort: unreadable/unsupported photos and failed compression use the original file. */
export async function prepareWorksheetPhoto(file: File): Promise<File> {
  if (file.size <= MIN_PHOTO_BYTES || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file;
  let objectUrl: string | undefined;
  let image: HTMLImageElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    objectUrl = URL.createObjectURL(file);
    image = new Image();
    const photo = image;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { photo.onload = photo.onerror = null; reject(new Error('Photo decode timed out')); }, PROCESS_TIMEOUT_MS);
      photo.onload = () => { window.clearTimeout(timer); photo.onload = photo.onerror = null; resolve(); };
      photo.onerror = () => { window.clearTimeout(timer); photo.onload = photo.onerror = null; reject(new Error('Photo decode failed')); };
      photo.src = objectUrl!;
    });
    const plan = worksheetPhotoCompressionPlan(file.size, image.naturalWidth, image.naturalHeight);
    if (!plan) return file;
    canvas = document.createElement('canvas');
    canvas.width = plan.width; canvas.height = plan.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    // White paper background; avoid black transparency when converting to JPEG.
    context.fillStyle = '#fff'; context.fillRect(0, 0, plan.width, plan.height);
    context.drawImage(image, 0, 0, plan.width, plan.height);
    const target = canvas;
    const blob = await new Promise<Blob | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), PROCESS_TIMEOUT_MS);
      target.toBlob(result => { window.clearTimeout(timer); resolve(result); }, 'image/jpeg', plan.quality);
    });
    if (!blob || blob.type !== 'image/jpeg' || blob.size === 0 || blob.size >= file.size * 0.95) return file;
    return new File([blob], `${file.name.replace(/\.[^.]*$/, '') || 'photo'}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    if (image) { image.onload = image.onerror = null; image.src = ''; }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
