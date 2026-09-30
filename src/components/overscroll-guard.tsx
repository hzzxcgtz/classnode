'use client';

import { useEffect } from 'react';

import { installOverscrollGuard } from '@/lib/overscroll-guard';

/**
 * 装上那个**全局唯一**的滚轮守卫（判据全在 `@/lib/overscroll-guard` 的文件头）。什么都不渲染。
 *
 * ⚠️ 挂在**根布局**（`src/app/layout.tsx`）上，而不是每个浮层各挂一个：浮层二十多处，
 * 而这件事的判据完全相同 —— 每处一份就是二十多个会各自漂移的地方。
 * ⚠️ 学生端也会装上。那里原本靠 `overscroll-behavior` 管，而 **Safari 15 不认那个属性**
 *（老 iPad 的门禁那一条），守卫是 JS，在那儿同样生效 —— 不是副作用，是顺带修好的那一半。
 */
export function OverscrollGuard() {
  useEffect(() => installOverscrollGuard(document), []);
  return null;
}
