import { useState } from 'react';
import { getEmbeddedAvatarImageUrl, svgDataUrl } from '../avatar-utils';

export interface SvgAvatarProps {
  svg: string;
  size: number;
  fallback?: string;
}

export function SvgAvatar({ svg, size, fallback = '?' }: SvgAvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const embeddedImageUrl = getEmbeddedAvatarImageUrl(svg);
  const src = embeddedImageUrl || svgDataUrl(svg);
  if (failedSrc === src) {
    return (
      <span style={{ display: 'flex', width: size, height: size, alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: '#f3f4f6', color: '#64748b', fontSize: Math.max(11, size * 0.4), fontWeight: 700 }}>
        {fallback}
      </span>
    );
  }
  return <img src={src} alt="" width={size} height={size} onError={() => setFailedSrc(src)} style={{ display: 'block', width: size, height: size, objectFit: embeddedImageUrl ? 'cover' : undefined }} />;
}
