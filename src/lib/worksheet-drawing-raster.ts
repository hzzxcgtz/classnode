'use client';

import { useCallback, useEffect, useRef } from 'react';

import { api } from './api';
import { CHAT_IMAGE_URL } from './worksheet-drawing.ts';

/**
 * 第三方画板的**位图快照**（★ 2026-10-06）。
 *
 * 为什么要有这一层：四种新画板把内容放在 `drawing.data` 里（流程图是 nodes/edges、
 * 思维导图是 nodeData、数学作图是 elements、基础绘图是 paths），而**服务端渲染不了它们**
 * —— 于是 AI 分析的联系表里那一格是空的、Word 报告里印「（这一题没有笔画）」，
 * 两者都不报错。这里在改动停下来之后抓一张 PNG 传上去，服务端拿它当**照片**用。
 *
 * 🔴 它**只是快照**，不是作答的真源：真源永远是 `data`（学生能继续编辑）。
 *    所以抓图失败**不影响作答**，只影响「教师/AI 看到的那张图」——
 *    ⚠️ 也因此这里刻意**不弹提示**：学生什么也没做错，为一张教师侧的快照弹红字是错的。
 *    代价说清楚：抓图失败时 `image` 会是**上一张**（或没有），教师看到的可能是旧一版。
 */

/** `data:image/png;base64,…` → `Blob`（react-sketch 的 `exportImage` 就是吐这个）。 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] });
  } catch {
    return null;
  }
}

/**
 * SVG 字符串 → PNG Blob（流程图那条路用它）。
 *
 * 🔴 **不用 `foreignObject`**（那正是 `html-to-image` 的做法）：老 iPad 上它对
 *    「HTML 里嵌 SVG 再嵌 HTML」这套支持得很勉强，出来的图可能是**空白**（而且不报错）。
 *    我们自己吐一份纯 SVG（形状 + 文字），走 `<img>` + canvas —— 这条路 Safari 15 稳。
 * ⚠️ 失败回 `null`（调用方跳过这次快照），绝不抛：抓图炸掉不该把作答那一步带走。
 */
export function svgToPngBlob(svg: string, width: number, height: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve(null); return; }
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    const done = (value: Blob | null) => { URL.revokeObjectURL(url); resolve(value); };
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        const ctx = canvas.getContext('2d');
        if (!ctx) { done(null); return; }
        // 白底：PNG 透明底在 Word 报告里会变成黑块（docx 不会给图片垫白）。
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => done(blob), 'image/png');
      } catch {
        done(null);
      }
    };
    image.onerror = () => done(null);
    image.src = url;
  });
}

/** 上传一张位图，拿回 `/uploads/chat/chat-*.png`。失败回 `null`。 */
export async function uploadDrawingRaster(blob: Blob): Promise<string | null> {
  try {
    const file = new File([blob], 'drawing.png', { type: 'image/png' });
    const result = await api.uploadWorksheetImage(file);
    // ⚠️ 形状不对就当失败：这个 URL 会进作答值，而服务端把它当**文件读取的入口**。
    return typeof result?.url === 'string' && CHAT_IMAGE_URL.test(result.url) ? result.url : null;
  } catch {
    return null;
  }
}

export interface DrawingRasterOptions {
  /** 抓一张 PNG。回 `null` = 这次抓不到（跳过，不动 `image`）。 */
  capture: () => Promise<Blob | null>;
  /** 拿到新 URL 时回调（画板把它写进 `drawing.image`，随后走既有的保存链路）。 */
  /** ⚠️ **可选**：教师端编辑「底稿」时没有学生作答，也就没有快照要交。 */
  onUrl?: (url: string) => void;
  /** 改动停下来多久抓一次。太短会在学生连笔时反复抓图（老 iPad 上是卡顿），太长会漏掉最后一笔。 */
  delayMs?: number;
}

/**
 * 把「学生改一下」节流成「停下来之后抓一张、传上去、写回 URL」。
 *
 * ⚠️ 返回的调度函数可以在渲染里随便调（内部只碰 ref）；**卸载后自动作废**
 *    （迟到的上传结果不会再回调 —— 那会在已经换走的题上写一笔）。
 * ⚠️ 反复抓同一内容会重复上传：`pending` 记号保证「学生连续改三下」只传最后一张。
 */
export function useDrawingRaster({ capture, onUrl, delayMs = 800 }: DrawingRasterOptions): () => void {
  const captureRef = useRef(capture);
  const onUrlRef = useRef(onUrl);
  const timerRef = useRef<number | null>(null);
  const tokenRef = useRef(0);
  const aliveRef = useRef(true);
  captureRef.current = capture;
  onUrlRef.current = onUrl;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  return useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void (async () => {
        const blob = await captureRef.current();
        if (!blob || !aliveRef.current) return;
        const url = await uploadDrawingRaster(blob);
        if (!url || !aliveRef.current || tokenRef.current !== token) return;
        onUrlRef.current?.(url);
      })();
    }, delayMs);
  }, [delayMs]);
}
