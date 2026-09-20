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
 *
 * ── `accent` 与 `accentStrong` 的分工 ────────────────────────────────────────
 * `accent`（身份色）**是模块的身份**，§4.6 要求学生在卡片上认到的颜色和进到模块里是同一个，
 * 所以它只出现在「大块、白底、正文大小」的地方，那些组合都过 AA：首页卡片、占位面板、
 * 实心药丸上的白字。**不要改它。**
 *
 * `accentStrong` 是同色系压深一档的**强调色**，只在 Tab 栏选中态这一处用：那里的文字是
 * 0.813rem / 650 字重，够不到 WCAG「大字号」门槛，需要 4.5:1，而它的底是「16% 身份色 +
 * 84% 栏底」的淡药丸，不是白底 —— 身份色落上去只有 4.11 / 4.46 / 4.26，全部跌破。
 * 压深一档之后是 5.33 / 5.56 / 5.78（把 16% 叠在 `.bar` 的 rgba(255,255,255,0.94) 之上的
 * 合成底色算进去的实测值）。学伴当初正是为了同一把尺子把 `#0891b2` 压到 `#0e7490`，
 * 这里是同一个标准对选中态补课。
 *
 * 色相保持不变（同一色系的深一档，Tailwind 的 600→700/700→800），学生仍能一眼认出是同一个
 * 模块；颜色仍然只有这一个来源，通过 CSS 自定义属性传下去，CSS 里不另抄十六进制。
 *
 * ── `iconSrc` 与 `icon` 的分工（两个字段并存是刻意的，别合并）────────────────
 * `iconSrc` 是 `/public/images/module-icons/*.svg` 的路径，**首页卡片专用**。这批图标是
 * 「自带渐变圆角底的整块图标」（`rect rx=32` + 白色线稿），底色正好是各模块的
 * `accentStrong`，所以卡片上不需要再铺 `--card-accent`，否则就是色块套色块。
 *
 * `icon` 是内联的**白色线稿**（`stroke="currentColor"`，跟着文字颜色走），**Tab 栏专用**。
 * 两者不能互换：Tab 的图标位只有 21px 画布、视觉上更小，整块渐变压进去会糊成一团、
 * 也认不出形状；反过来，线稿放进卡片则缺少「一眼分辨三个模块」的那块底色。
 *
 * 单个模块图标只在这两处出现，所以两个字段都挂在同一张表上 —— 新增模块时
 * `Record<ModuleId, …>` 会同时逼着两份都补齐，不会出现「卡片有图、Tab 空着」。
 */
export const MODULE_META: Record<ModuleId, { label: string; accent: string; accentStrong: string; cta: string; icon: ReactNode; iconSrc: string }> = {
  worksheet: {
    label: '学习单',
    accent: '#2563eb',
    accentStrong: '#1d4ed8',
    cta: '继续作答',
    iconSrc: '/images/module-icons/worksheet.svg',
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
    accentStrong: '#6d28d9',
    cta: '去探究',
    iconSrc: '/images/module-icons/explore.svg',
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
    // 强调色（Tab 选中态用）再压一档：青 700 → 青 800。见文件头。
    accentStrong: '#155e75',
    cta: '开始对话',
    iconSrc: '/images/module-icons/companion.svg',
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
      </svg>
    ),
  },
};
