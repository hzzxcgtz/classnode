export interface AnnotationPoint { x: number; y: number }
export interface AnnotationStroke { id: number; tool: 'pen' | 'highlight'; color: string; width: number; points: AnnotationPoint[] }
export function annotationPath(points: readonly AnnotationPoint[]): string {
  if (!points.length) return '';
  const first = points[0];
  if (points.length === 1) return `M ${first.x} ${first.y} l 0.01 0`;
  return `M ${first.x} ${first.y}` + points.slice(1).map(point => ` L ${point.x} ${point.y}`).join('');
}
export function annotationHit(stroke: AnnotationStroke, point: AnnotationPoint, tolerance = 10): boolean {
  const radius = tolerance + stroke.width / 2;
  for (let i = 0; i < stroke.points.length; i++) {
    const a = stroke.points[i], b = stroke.points[i + 1] ?? a;
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
    if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) <= radius) return true;
  }
  return false;
}

/** Convert a viewport point to coordinates relative to the fitted image centre. */
export function imageAnnotationPoint(point: AnnotationPoint, centre: AnnotationPoint, zoom: number, angle: number): AnnotationPoint {
  const x = (point.x - centre.x) / zoom, y = (point.y - centre.y) / zoom;
  const radians = angle * Math.PI / 180;
  return { x: x * Math.cos(radians) + y * Math.sin(radians), y: -x * Math.sin(radians) + y * Math.cos(radians) };
}
