/** Compress the rendered PNG for transport; retain the original preview and dimensions. */
export async function prepareAnalysisImageUpload(png: Buffer): Promise<{ buffer: Buffer; extension: 'webp' | 'png' }> {
  try {
    const { default: sharp } = await import('sharp');
    const webp = await sharp(png).webp({ quality: 70 }).toBuffer();
    if (webp.length < png.length * 0.95) return { buffer: webp, extension: 'webp' };
  } catch {
    // Encoding must not prevent an otherwise usable PNG from being evaluated.
  }
  return { buffer: png, extension: 'png' };
}
