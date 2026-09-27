import type { WorksheetSurfaceOpacity } from './types';

/**
 * ★ 2026-09-27（教师）：「学生页面的学习单区域是否可以增加一些透明度，可以让漂亮的背景图片
 * 更明显一些，也可以在学习单设置中增加几档透明度供选择。」
 *
 * 本文件是**卡片透度**的唯一真源：几档、每档叫什么、每档对应哪两个透明度数值。
 * 与 `worksheet-backgrounds.ts` 同一个形状（取值域 + 选项表 + 归一化 + 解析），
 * 所以教师端的设置面板与学生端的面板读的是同一份，不可能漂移。
 *
 * ── 它管的是哪两个面 ──────────────────────────────────────────────────────
 * 教师选的是「题目卡片 + 任务容器」（2026-09-27 的三选一）—— 那正是盖住背景图的主力：
 *   · 题目卡片 `.question`              今天 `rgba(255,255,255,.96)`
 *   · 任务容器 `.group[data-container]`  今天 `rgba(246,249,253,.9)`
 * ⚠️ **顶栏与那层白色蒙版刻意不跟着透**：顶栏上有进度条、保存状态、奖励数 ——
 *    那是学生**一直要看**的东西，压在花背景上会难读。蒙版只有 .22，本来就没挡多少。
 *
 * ── 为什么不加磨砂（`backdrop-filter: blur`）────────────────────────────────
 * 它能让半透明卡片上的字清楚很多，但**代价在旧 iPad 上**（本仓的学生端就跑在那上面，
 * 见 `worksheet.module.css` 文件头那条硬约束），而那是**本机量不出来**的东西。
 * ⇒ 这一版只调 alpha。要加磨砂得先在真机上量帧率，别顺手加。
 *
 * ⚠️ 这一层只是「数值」，**不碰 CSS**：两个面的具体声明在 `worksheet.module.css`，
 *    由面板把这两个数写成 CSS 变量传下去（`--ws-card-alpha` / `--ws-surface-alpha`）。
 *    把 `rgba()` 写在这里就等于让样式分家到 JS 里，那正是这一页一直在防的事。
 */
export interface WorksheetSurfaceOption {
  id: WorksheetSurfaceOpacity;
  name: string;
  description: string;
}

/**
 * 三档，按**透明度递增**排（清晰 → 通透 → 极透）。顺序不是默认值的顺序 ——
 * 默认档是 `soft`（通透），见 `DEFAULT_WORKSHEET_SURFACE`。
 */
export const WORKSHEET_SURFACE_OPTIONS: readonly WorksheetSurfaceOption[] = [
  { id: 'opaque', name: '清晰', description: '卡片不透明，题干最清楚' },
  { id: 'soft', name: '通透', description: '背景透出来一点' },
  { id: 'clear', name: '极透', description: '背景最明显，文字的对比度会低一些' },
] as const;

/**
 * ★ 2026-09-27（教师）：**默认档是「通透」**，不是「清晰」。
 *
 * 教师原话：「卡片透明度默认选『通透』模式。」
 *
 * 🔴 **这会改变历史学习单的外观**（那些 `settings` 里没有这一格的行）
 * —— 那正是他的意思：他看过「通透」那一档、要的就是它当默认。
 * ⚠️ 所以下面 `normalizeWorksheetSurfaceOpacity` 里那条「认不出就回默认档」
 *    现在**不再**等于「屏幕一个像素都不变」（改版前它是这么写的）。
 *    两件事别再混为一谈：**「通透」是产品默认，「清晰」只是其中一档。**
 */
export const DEFAULT_WORKSHEET_SURFACE: WorksheetSurfaceOpacity = 'soft';

const VALID_SURFACES = new Set<string>(WORKSHEET_SURFACE_OPTIONS.map(option => option.id));

/**
 * 认不出的值（老数据、手工改过的行、拼错的串）一律回**默认档**（= 通透）。
 *
 * ⚠️ 「最透」（`clear`）**刻意不是**默认：那一档在花背景上的文字对比度是三个里最低的，
 * 让它当默认等于把每一份没配过的学习单都推到那一档上。默认取中间那一档。
 * ⚠️ 与「清晰」也不一样：那是**最保守**的一档（今天之前的样子），留作教师手动选。
 *    ⊘ 本节原来写的是「默认档是 `.96`（今天的样子），一份没有这个字段的老学习单必须与
 *      升级前逐像素相同」—— 那条在 2026-09-27 被教师明确否掉了（他要通透当默认）。
 */
export function normalizeWorksheetSurfaceOpacity(value: unknown): WorksheetSurfaceOpacity {
  return typeof value === 'string' && VALID_SURFACES.has(value)
    ? value as WorksheetSurfaceOpacity
    : DEFAULT_WORKSHEET_SURFACE;
}

/**
 * 这一档对应的三个 alpha（0–1，直接喂给 `rgba(…, <alpha>)`）。
 *
 * ⚠️ 两个面的**差值刻意保持**（今天 .96 / .90 差 .06）：任务容器比卡片再淡一档是这一页的
 * 层次规矩（题目装在任务里，容器是「内嵌块」那一档）。让两档各自随便取值的后果是
 * 「卡片比容器还透明」，那时题目看起来是浮在任务外面的。
 *
 * `cardActive` 是**「正在写」那一档**（学生点进去的卡片）—— 它比常态再亮一点点。
 * 🔴 它必须**由这里算**、不能在 CSS 里写 `calc(var(--ws-card-alpha) + .02)`：
 *    `rgba()` 的 alpha 收 `calc()` 在旧 Safari 上不保险，而学生端就跑在那上面
 *    （`worksheet.module.css` 文件头那条硬约束）。⚠️ 写死 `.98` 也不行 ——
 *    最透那一档上「正在写」的卡片会比旁边的**更不透明**，层次就反了。
 */
export interface SurfaceAlphas {
  /** 题目卡片。 */
  card: number;
  /** 任务容器（比卡片更淡一档）。 */
  container: number;
  /** 卡片**正在写**那一档（比 `card` 更亮一点点）。 */
  cardActive: number;
}

export function surfaceAlphas(option: WorksheetSurfaceOpacity): SurfaceAlphas {
  if (option === 'soft') return { card: 0.82, container: 0.74, cardActive: 0.84 };
  if (option === 'clear') return { card: 0.64, container: 0.54, cardActive: 0.66 };
  // 「清晰」= 本次改动之前的三个字面量（.96 / .90 / .98），**逐字**保留 ——
  // 它是「老师想要以前那个样子」的出口。⚠️ 它**已经不是默认档了**（默认是 `soft`）。
  return { card: 0.96, container: 0.9, cardActive: 0.98 };
}
