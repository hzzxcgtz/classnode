/** Normalize pixel/line/page deltas and keep wheel zoom deliberately slow. */
export function imageWheelZoomChange(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1);
  return -Math.sign(pixels) * Math.min(Math.abs(pixels) * .0003, .03);
}
