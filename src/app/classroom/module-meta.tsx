import type { ReactNode } from 'react';
import type { ModuleId } from './classroom-types';
import { ExploreSpaceNavigationIcon, WorksheetNavigationIcon } from '@/lib/navigation-icons';

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
    icon: <WorksheetNavigationIcon size={21} strokeWidth={1.9} />,
  },
  explore: {
    label: '探究空间',
    accent: '#7c3aed',
    accentStrong: '#6d28d9',
    cta: '去探究',
    iconSrc: '/images/module-icons/explore.svg',
    icon: <ExploreSpaceNavigationIcon size={21} strokeWidth={1.9} />,
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
        <path d="M11.5 3C6.8 3 3 6.2 3 10.1c0 1.7.7 3.2 2 4.4L4 18l3.8-2c1.1.7 2.4 1 3.7 1 4.7 0 8.5-3.1 8.5-6.9S16.2 3 11.5 3Z" />
        <path d="M17.6 8.2c2 .8 3.4 2.5 3.4 4.6 0 2.8-2.5 5.1-5.7 5.1h-1.7L10 21l.9-3.4" />
        {/* 三枚「眼睛」点。⚠️ 这里**必须**是显式 `<circle>`，不能写成
            `M8.5 10h.01M11.5 10h.01M14.5 10h.01` + `strokeWidth="2.6"` 那种端点圈写法：
            那种写法下这三枚点**在几何上是不存在的**（`getBBox()` 实测高度为 0 —— 它只是一条
            没有长度的线），成形完全依赖父 `<svg>` 上**继承来的** `stroke-linecap="round"`。
            父级 linecap 一改、或这段被复制到别处，三枚点会整体消失（不是变细）。
            取值按原状推算：round 端点圈的半径 = strokeWidth / 2 = 2.6 / 2 = **1.3**，
            圆心就是三个 MoveTo 的落点 (8.5,10) / (11.5,10) / (14.5,10)。
            `fill` / `stroke` 必须写在每个 circle 上：父 svg 给的是 `fill="none"` +
            `stroke="currentColor"`，不覆盖就成了空心圆环（形状会变）。 */}
        <circle cx="8.5" cy="10" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="11.5" cy="10" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="10" r="1.3" fill="currentColor" stroke="none" />
        <path d="M20 2v3M18.5 3.5h3" />
      </svg>
    ),
  },
};
