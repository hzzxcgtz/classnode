'use client';

import { useEffect, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { Toast } from '@/lib/components';
import type { ChatToast } from './classroom-types';

/**
 * 浮层逃生舱（M1b-2 Task 2 / Ruling 5）—— 首页与学伴面板此前各写了一份，这里只留一份。
 *
 * 两个层里各有若干 `position: fixed` 浮层（头像更换模态、全屏图片查看器、Toast…）。
 * §4.6 的切换动画会给层加 `transform`，层随即成为它们的**包含块** —— 它们会被重新锚定到
 * 层盒子、被 `.stage` 的 `overflow: hidden` 裁切、暗色遮罩跟着平移。提到 `document.body`
 * 才能逃出去。
 *
 * **portal 本身不够**：提到 body 之后它们不再继承层的 `visibility: hidden`，会浮在别的层
 * 之上。所以必须**显式按所属层的 `active` 决定可见性**：
 *   · 不能「非 active 就卸载」：那会丢掉查看器的缩放/位置与模态的展开状态，而 §4.5 要求
 *     层挂载后状态完整保留（切回来查看器还开着、还停在原缩放）；
 *   · 所以保持挂载，只把 `active` 翻译成 `visibility`（与层自身被隐藏的方式一致，顺带获得
 *     「隐藏时不可聚焦/不可点」的语义，见 §4.10 C2）。
 *
 * SSR 守卫：Next.js 静态导出会在构建期预渲染本页，那时没有 `document`。用 mounted 标志而不是
 * `typeof document !== 'undefined'` 内联判断 —— 后者会让服务端输出与首次客户端渲染不一致
 * （hydration 不匹配）。浮层的初始状态全是关闭，所以只晚一帧，肉眼不可见。
 */
export function useOverlayPortal(active: boolean): (node: ReactNode) => ReactNode {
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);
  return (node: ReactNode) => {
    if (!portalReady || !node) return null;
    return createPortal(
      <div style={{ visibility: active ? 'visible' : 'hidden' }}>{node}</div>,
      document.body,
    );
  };
}

/**
 * 学生端的浮动提示（`ChatToast` 的统一渲染点）。
 *
 * 首页与学伴面板都要渲染它，契约只有一条：**关闭即清空会话级的 `toast`**。写两遍就是会漂移
 * 的重复（改了一处的 onClose，另一处还连着旧的写入点）。
 */
export function ClassroomToast({ toast, setToast }: {
  toast: ChatToast | null;
  setToast: Dispatch<SetStateAction<ChatToast | null>>;
}) {
  if (!toast) return null;
  return <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />;
}
