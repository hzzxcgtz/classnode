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
 *
 * ── ★ 2026-09-27：首页三卡改版（设计稿 v6）────────────────────────────────
 * 首页卡片换成一版新的视觉（大插画 + 一句话说明 + 信息块 + 通栏按钮），于是卡片上多出
 * 三样**每个模块各一份**的文字/颜色，全部加在这张表上（理由同上面那段：`Record<ModuleId, …>`
 * 会逼着补齐，不会出现「某张卡少一句副标题」）：
 *
 *   · `subtitle`      —— 一句话说明这个模块是干什么的（设计稿的副标题行）。
 *   · `summaryLabel`  —— 信息块那枚药丸的字（「今天的任务」「本次探究」「上次聊到」）。
 *                        它说的是**下面那行数据是什么**，所以必须与 `student-home.tsx`
 *                        往那一格塞的数据对得上（塞了网页名、药丸却写「今天的任务」
 *                        就是一句假话）。
 *   · `iconTint` / `iconRim` —— 插画背后那个圆的浅色同色系底（从设计稿的合成图里
 *                        量出来的，见 `student-home.tsx` 里那段注释）。
 *   · `cardSurface` / `cardSurfaceDeep` / `cardPill` / `cardLine` —— 新版卡片那四层浅色：
 *                        卡片底、信息块底、药丸底、分隔线。设计稿给每个模块配了一整套
 *                        （蓝 / 紫 / 青各一套），**照抄在这里而不是写进 CSS** ——
 *                        本仓的规矩是「颜色只有这一个来源，通过 CSS 自定义属性传下去，
 *                        CSS 里不另抄十六进制」（见上面 `accent` 那一段）。
 *
 * ⚠️ `iconSrc` 从 v6 起指向 `/images/module-icons/v6/*.webp`（384px、透明底、**不带圆底**）——
 *    圆底改由 CSS 画（`home.module.css` 的 `.cardIcon`），因为设计稿附带的那版合成图只有
 *    192px，在 iPad 的 2x 屏上按 100px 以上显示会被放大发虚。旧的那三张
 *    `/images/module-icons/*.svg` **暂时留在仓库里**（没人再引用它们，删不删是另一个决定）。
 *
 * ⚠️ `cta` 的取值这一轮跟着设计稿改了两个（`继续作答`→`开始学习`、`去探究`→`开始探究`）。
 *    它只被首页卡片读（全仓 grep 过），所以改它不会波及别处。
 */
export const MODULE_META: Record<ModuleId, {
  label: string;
  accent: string;
  accentStrong: string;
  cta: string;
  subtitle: string;
  summaryLabel: string;
  iconTint: string;
  iconRim: string;
  cardSurface: string;
  cardSurfaceDeep: string;
  cardPill: string;
  cardLine: string;
  icon: ReactNode;
  iconSrc: string;
}> = {
  worksheet: {
    label: '学习单',
    accent: '#527198',
    accentStrong: '#466384',
    cta: '开始学习',
    subtitle: '完成课堂任务',
    summaryLabel: '今天的任务',
    iconTint: '#eaf3ff',
    iconRim: '#cfe4ff',
    cardSurface: '#f7fbff',
    cardSurfaceDeep: '#e6f3ff',
    cardPill: '#cde6ff',
    cardLine: '#d5eaff',
    iconSrc: '/images/module-icons/v6/worksheet.webp',
    icon: <WorksheetNavigationIcon size={21} strokeWidth={1.9} />,
  },
  explore: {
    label: '探究空间',
    accent: '#7c3aed',
    accentStrong: '#6d28d9',
    cta: '开始探究',
    subtitle: '动手体验原理',
    summaryLabel: '本次探究',
    iconTint: '#f0e9ff',
    iconRim: '#dccbfb',
    cardSurface: '#fbf9ff',
    cardSurfaceDeep: '#eee7ff',
    cardPill: '#ded0ff',
    cardLine: '#e5dcff',
    iconSrc: '/images/module-icons/v6/explore.webp',
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
    subtitle: '和 AI 一起思考',
    summaryLabel: '上次聊到',
    iconTint: '#e4f9f2',
    iconRim: '#c6efe3',
    cardSurface: '#f7fffd',
    cardSurfaceDeep: '#ddf5f0',
    cardPill: '#c0ece3',
    cardLine: '#d1f0eb',
    iconSrc: '/images/module-icons/v6/companion.webp',
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
