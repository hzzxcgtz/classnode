/** Classroom photos: bounded 1600px WebP, with a JPEG fallback for older browsers. */
const MIN_PHOTO_BYTES = 100 * 1024;
const MAX_CANVAS_PIXELS = 2_560_000;
const MAX_LONG_EDGE = 1600;
const PROCESS_TIMEOUT_MS = 8_000;

export function worksheetPhotoCompressionPlan(bytes: number, width: number, height: number) {
  if (bytes <= MIN_PHOTO_BYTES || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(width, height), Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 0.7 };
}

/** Best effort: unreadable/unsupported photos and failed compression use the original file. */
export async function prepareWorksheetPhoto(file: File, targetBytes?: number): Promise<File> {
  if (file.size <= (targetBytes ?? MIN_PHOTO_BYTES)) return file;
  if (!targetBytes && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file;
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
    const context = canvas.getContext('2d');
    if (!context) return file;
    const target = canvas;
    const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), PROCESS_TIMEOUT_MS);
      target.toBlob(result => { window.clearTimeout(timer); resolve(result); }, type, quality);
    });
    let blob: Blob | null = null;
    let supportsWebp = true;
    const initialScale = targetBytes ? Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight)) : 1;
    const width = targetBytes ? image.naturalWidth * initialScale : plan.width;
    const height = targetBytes ? image.naturalHeight * initialScale : plan.height;
    const scales = targetBytes ? [1, 0.8, 0.62, 0.46, 0.32, 0.2] : [1];
    for (const scale of scales) {
      target.width = Math.max(1, Math.round(width * scale));
      target.height = Math.max(1, Math.round(height * scale));
      // Flatten transparency onto white paper before either output format.
      context.fillStyle = '#fff';
      context.fillRect(0, 0, target.width, target.height);
      context.drawImage(image, 0, 0, target.width, target.height);
      for (const quality of targetBytes ? [0.88, 0.74, 0.58] : [plan.quality]) {
        if (supportsWebp) {
          blob = await encode('image/webp', quality);
          supportsWebp = Boolean(blob?.size && blob.type === 'image/webp');
        }
        if (!supportsWebp) blob = await encode('image/jpeg', quality);
        if (!blob?.size || !['image/webp', 'image/jpeg'].includes(blob.type)) return file;
        if (!targetBytes || blob.size <= targetBytes) break;
      }
      if (!targetBytes || (blob && blob.size <= targetBytes)) break;
    }
    if (!blob || (targetBytes ? blob.size > targetBytes : blob.size >= file.size * 0.95)) return file;
    const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';
    return new File([blob], `${file.name.replace(/\.[^.]*$/, '') || 'photo'}.${extension}`, { type: blob.type, lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    if (image) { image.onload = image.onerror = null; image.src = ''; }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
