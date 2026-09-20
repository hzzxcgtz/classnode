import { getApiBaseUrl } from '@/lib/api-base';

export const API_BASE_URL = getApiBaseUrl();
export function fixSvgUrl(svg: string) { return svg ? svg.replace(/href="\/uploads\//g, `href="${API_BASE_URL}/uploads/`) : svg; }
export function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fixSvgUrl(svg))}`;
}

/** 上传图片头像会保存为包含相对 image href 的 SVG；作为 data URL 渲染时浏览器不会加载其外部图片。 */
export function getEmbeddedAvatarImageUrl(svg: string): string | null {
  const match = svg.match(/<image\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1/i);
  if (!match) return null;
  const href = match[2];
  if (href.startsWith('/uploads/')) return `${API_BASE_URL}${href}`;
  if (href.startsWith(`${API_BASE_URL}/uploads/`)) return href;
  return null;
}
