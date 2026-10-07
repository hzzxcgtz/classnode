import { useState } from 'react';
import { getEmbeddedAvatarImageUrl, svgDataUrl } from '@/app/classroom/avatar-utils';

export interface SvgAvatarProps {
  svg: string;
  size: number;
  fallback?: string;
}

/**
 * 一个头像 SVG → 一张 `<img>`。
 *
 * 🔴 **为什么不能直接把 SVG 内联进 DOM**（`dangerouslySetInnerHTML`）：**自定义头像**
 *    （学生上传的图）存的是一个**外面套着 `<image href="/uploads/...">` 的 SVG** ——
 *    内联渲染时那张外链图要靠浏览器**解码**；而看板这类界面**每隔一两秒就重绘一次**
 *    （学生那边每 300ms 推一次实时预览），重绘会把它**重新解码**一遍 ⇒
 *    **自定义头像会隔几秒闪一下**（矢量头像没有外链图，所以看不出来 ——
 *    教师 2026-10-07 报的正是「用自定义头像时会闪」）。
 * ✅ 拆成两种都稳的画法：有内嵌图 ⇒ 直接当 `<img>`（浏览器会复用**解码后**的位图）；
 *    纯矢量 ⇒ data URL（不进网络，也就没有加载这一说）。
 * ⚠️ 这是学生端聊天头像的老做法，教师看板 2026-10-07 起也走这一份 ——
 *    **同一个头像在同一个应用里只该有一种画法**。
 */
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
