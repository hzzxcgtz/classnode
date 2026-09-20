import type { ReactNode } from 'react';
import type { ModuleId } from './classroom-types';

/**
 * 三个模块的**展示身份**：名字、主色、按钮动作词、图标。
 *
 * 为什么是一张共享表而不是各自写一份：§4.6 把颜色定成模块身份的一部分 ——
 * 「学生在卡片上认到的颜色，进到模块里还是同一个颜色」。首页卡片、外壳的 Tab 栏、
 * 占位面板三处都要读它，各写一份必然漂移（改了一处颜色，另一处还是旧的，
 * 而且没有任何编译期信号）。
 *
 * `Record<ModuleId, …>` 不是装饰：模块词汇表（`ModuleId`）扩项时这里**必须**报错，
 * 否则新模块会在首页与 Tab 栏上凭空少一项。
 */
export const MODULE_META: Record<ModuleId, { label: string; accent: string; cta: string; icon: ReactNode }> = {
  worksheet: {
    label: '学习单',
    accent: '#2563eb',
    cta: '继续作答',
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  explore: {
    label: '探究助手',
    accent: '#7c3aed',
    cta: '去探究',
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9.5 2v6.2L4.6 17.4A1.8 1.8 0 0 0 6.2 20h11.6a1.8 1.8 0 0 0 1.6-2.6L14.5 8.2V2" />
        <path d="M8 2h8" />
        <path d="M7.4 14h9.2" />
      </svg>
    ),
  },
  companion: {
    label: '智能学伴',
    // §4.6 的「青」压深了一档（#0891b2 → #0e7490）：白字落在 #0891b2 上只有 4.0:1，
    // 按钮文字是 0.875rem 正文大小，够不到 AA 的 4.5:1。Task 4 定下的取值，此处未改。
    accent: '#0e7490',
    cta: '开始对话',
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
      </svg>
    ),
  },
};
