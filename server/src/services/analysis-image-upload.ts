/** Compress the uploaded image for transport while keeping the original on disk. */
export async function prepareAnalysisImageUpload(image: Buffer): Promise<{ buffer: Buffer; extension: 'webp' | 'png' | 'jpg' }> {
  try {
    const { default: sharp } = await import('sharp');
    const webp = await sharp(image).rotate().webp({ quality: 70 }).toBuffer();
    if (webp.length < image.length * 0.95) return { buffer: webp, extension: 'webp' };
  } catch {
    // Encoding must not prevent an otherwise usable original from being evaluated.
  }
  const extension = image[0] === 0xff && image[1] === 0xd8 ? 'jpg'
    : image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : 'png';
  return { buffer: image, extension };
}
