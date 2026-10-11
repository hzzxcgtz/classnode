'use client';

import { createContext, useContext } from 'react';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';

/** 使用课堂现有大图预览，避免在学习单里另建一套缩放操作。 */
export const ClassroomImagePreviewContext = createContext<((url: string) => void) | null>(null);

export function AnswerPhoto({ url }: { url: string }) {
  const openImage = useContext(ClassroomImagePreviewContext);
  const src = worksheetAssetUrl(url);
  const image = <img src={src} alt="学生上传的作答照片"
    style={{ display: 'block', width: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 8, border: '1px solid #dbe5ef', background: '#f8fafc' }} />;
  return openImage ? <button type="button" onClick={() => openImage(src)} aria-label="放大学生作答照片" title="点击查看大图"
    style={{ display: 'block', width: '100%', padding: 0, border: 0, borderRadius: 8, background: 'transparent', cursor: 'zoom-in' }}>{image}</button> : image;
}
