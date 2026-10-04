// ⚠️ **相对路径 + `.ts` 后缀**：本文件要被 `node --test` 直接跑（与 `worksheet-table.ts` /
// `worksheet-drawer-state.ts` 同一条写法）。加一行 `@/…` 的运行时 import 就会让
// `worksheet-answer-view.test.ts` 整个跑不起来。
import {
  draftFromValue,
  isDraftEmpty,
  readCategorizeItems,
  readCategorizeZones,
  readMatchLeft,
  readMatchRight,
  readOptions,
  readOrderItems,
  TRUE_FALSE_OPTIONS,
  type WorksheetEntry,
} from './worksheet-questions.ts';
import { readInkValue, type InkValue } from './worksheet-ink.ts';
// `blankLayout` 给表格渲染器要的那个「表内第 0 个空在全局第几位」（`tableBase`）。
import { blankLayout } from './worksheet-table.ts';
// ⚠️ **`import type` 会被 Node 的类型擦除整段删掉** —— 所以它不影响「本文件能被
// `node --test` 直接跑」，而用它换掉了满篇的 `as never`（那是一种把类型检查关掉的写法）。
import type { WorksheetQuestionNode } from './types.ts';

/**
 * ★ 2026-09-28（教师）：「这些题在展开后，看到的答题信息过于简单，我希望能使用更详细、
 * 更直观的方式真实呈现学生的答题结果，比如连线题就应该左右框加上中间的线。」
 *
 * ── 这一层是什么 ──────────────────────────────────────────────────────
 * 把「一道题 + 学生的作答值」变成一份**逐题型、结构化的呈现模型**。
 * 在此之前，教师抽屉里用的是 `formatAnswer` —— 它把一切**压成一行文字**
 * （连线的 `水 — H2O；二氧化碳 — CO2`、排序的 `吸收光能 → 合成有机物`），
 * 于是「他连错的是哪一条」「他排成了什么顺序」在屏幕上根本看不出来。
 *
 * 🔴 **判据全在这一层**（纯函数、被 `node --test` 跑），`answer-view.tsx` 只负责画。
 * 本仓没有前端测试框架，画进 JSX 的判据没有任何回归网 —— 与
 * `worksheet-drawer-state.ts` / `worksheet-tile-state.ts` 同一条铁律。
 *
 * ── 数据从哪来（**不需要动服务端**）────────────────────────────────────
 *   · 学生答案 —— `draftFromValue(node, value)`（`WorksheetAnswer.value` 那一个 Json 列）；
 *   · 正确答案 —— `node.data` 里的 `correctKeys` / `answers` / `correctOrder` /
 *     `pairs` / `placement`。⚠️ **教师端本来就加载了整份 `content`（含答案）**，这是
 *     它自己的那一份，从不外发（规格 §5.4）。
 *     ⇒ 「正确答案」这一侧在**客户端此前没有读取器**（那五个字段只在服务端被读），
 *       所以本文件是它的第一份 —— 读法必须与服务端 `validateQuestion` 的存法逐字对齐。
 *
 * ── 🔴 逐元素对错：只在「比较是纯集合」的题型上标 ────────────────────────
 * 教师裁定（2026-09-28）：**连线 / 归类 / 单选 / 判断 标逐元素对错；填空 / 排序不标。**
 *
 * 理由不是「哪一类更重要」，而是**哪一类的比较没有规则**：
 *   · 连线的「这一对对不对」= 那对在不在 `pairs` 里 —— **纯集合成员判定**，没有规则可写错；
 *     归类同理（`placement[itemId] === zoneId`）、单选/判断同理（在不在 `correctKeys` 里）；
 *   · 而**填空**有「多个可接受答案」、**排序**有容差（服务端 `judgeOrder(…, tolerance)`）
 *     —— 那些规则住在服务端。在客户端复刻一份就是**第二份判分实现**：服务端改了规则
 *     它不会跟着变，而两边都不报错。本仓被这个形状咬过不止一次。
 * ⇒ 那两类**只画「学生答案 + 正确答案」两栏**，让教师一眼比 —— 不猜一个可能错的结论。
 */

/** 一个选项在呈现里的样子。 */
export interface ChoiceOptionView {
  key: string;
  text: string;
  /** 学生勾了它。 */
  picked: boolean;
  /** 它是正确答案之一（`correctKeys` 里）。 */
  correct: boolean;
}

/** 一个空的呈现。 */
export interface FillBlankView {
  /** 给人看的格号（`第 3 空`）。 */
  label: string;
  /** 学生写的字。空串 = 他留空了（**不是**「读不出来」）。 */
  text: string;
  /**
   * 这一空的**可接受答案**。
   * 🔴 它可能为空数组 —— 教师没填标准答案（关掉自动评分时这是合法的）。
   * ⇒ 界面那时**不画**「正确答案」那一栏，而不是画一个空的（看起来像「答案是空的」）。
   */
  accepted: string[];
}

/** 一对连线的呈现。 */
export interface MatchLinkView {
  leftId: string;
  rightId: string;
  /** 🔴 纯集合判定：这一对在不在 `pairs` 里。**没有规则**，所以可以在这一侧算。 */
  ok: boolean;
}

/** 归类里落在某个框中的一条。 */
export interface CategorizeItemView {
  text: string;
  ok: boolean;
}

export type AnswerView =
  /** 没有可显示的东西（未作答 / 读不出来的值）。 */
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'ink'; ink: InkValue | null }
  | { kind: 'photo'; url: string }
  | { kind: 'choice'; options: ChoiceOptionView[] }
  | {
      kind: 'fill';
      blanks: FillBlankView[];
      /**
       * 全局空序上的原始值（题干里的空在前、表格里的空在后 —— 规格 §「空位顺序」）。
       * ⚠️ 给**表格渲染器**用的：它要的是「一列值 + 一个基准」，不是逐空的标签。
       */
      texts: string[];
      /** 表格里第 0 个空在 `texts` 里的下标。没表格时是 `texts.length`。 */
      tableBase: number;
      /** 题目带表格（`data.table`）⇒ 界面画表格。 */
      hasTable: boolean;
    }
  | { kind: 'order'; student: string[]; correct: string[] }
  | { kind: 'match'; left: WorksheetEntry[]; right: WorksheetEntry[]; links: MatchLinkView[]; /** 正确答案里、学生没连的那几对。 */ missed: Array<{ leftId: string; rightId: string }> }
  | { kind: 'categorize'; zones: Array<{ id: string; label: string; items: CategorizeItemView[] }>; /** 没归到任何框里的条目。 */ loose: string[] };

/** 条目按 id 取文本；查不到就**退回 id 本身**（与抽屉其余各处同一条纪律）。 */
function textOf(entries: readonly WorksheetEntry[], id: string): string {
  return entries.filter((entry) => entry.id === id)[0]?.text || id;
}

/** 读一串字符串（容错到底：非数组 / 非字符串元素一律丢掉）。 */
function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string' && item !== '') : [];
}

/**
 * 读填空的标准答案 —— `data.answers` 是**每空一份可接受答案**（`string[][]`）。
 *
 * ⚠️ **两种形状都要认**，而它们都真实存在：
 *   · `[['H2O'], ['O2', '氧气']]` —— 多空（编辑器今天写的）；
 *   · `['H2O']` —— **单空的老值**（`answers` 一开始就是 `string[]`）。
 * 只认前者的话，单空题的标准答案会整栏消失，而屏幕上看起来只是「老师没填答案」。
 */
export function readAnswerSets(raw: unknown): string[][] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => (typeof item === 'string' ? [item] : strings(item)));
}

/** 读连线题的正确答案（`data.pairs`）。 */
export function readPairs(node: WorksheetQuestionNode): Array<{ leftId: string; rightId: string }> {
  const raw = node.data?.pairs;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (item && typeof item === 'object' ? item as Record<string, unknown> : null))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      leftId: typeof item.leftId === 'string' ? item.leftId : '',
      rightId: typeof item.rightId === 'string' ? item.rightId : '',
    }))
    .filter((pair) => pair.leftId !== '' && pair.rightId !== '');
}

/** 读归类题的正确答案（`data.placement`：条目 id → 框 id）。 */
export function readPlacement(node: WorksheetQuestionNode): Record<string, string> {
  const raw = node.data?.placement;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [itemId, zoneId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof zoneId === 'string' && zoneId !== '') out[itemId] = zoneId;
  }
  return out;
}

/**
 * ★ 2026-09-28（教师）：「连线题左框和右框中的顺序不能变，要按照原题中的顺序」。
 *
 * ── 为什么这里要算几何（而不是在 JSX 里量 DOM）────────────────────────
 * 上一版我把每一对画成**一行**（左框 ── 线 ── 右框），好处是零测量；代价是
 * **右框的顺序被连线打乱了** —— 而教师要看的是「左栏按原题顺序、右栏按原题顺序、
 * 线在中间连」。⇒ 回到两栏布局。
 *
 * 🔴 而两栏布局**不一定非要测量**：把两栏的每一行做成**固定行高**，每个盒子的
 * 纵向位置就能从**下标**算出来。于是：
 *   · 「量完 setState → 重渲染 → 再量」那条回路**结构上不存在**
 *     （这一晚把学生端搞成假死的就是那类回路，见 `worksheet-drawer.tsx` 里那条注释）；
 *   · 这段几何是**纯函数**，能被 `node --test` 直接钉住。
 *
 * ⚠️ 代价（写在这里免得下一个人以为是 bug）：**行高固定 ⇒ 太长的条目会被截断**
 *（界面用两行截断）。这是刻意的取舍：宁可截断，也不要一条会自己摆动的线。
 * 真要看全文，教师可以点开别处 / 横向比时看学生端。
 */
export interface MatchLine {
  /** 起止点都在**中间那条通道**的坐标系里（`x` 从 0 到 `gutter`）。 */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ok: boolean;
}

export interface MatchGeometry {
  rowHeight: number;
  gap: number;
  /** 中间那条通道的宽度 —— 线画在里面，所以它是**唯一**需要横坐标宽度的地方。 */
  gutter: number;
}

/**
 * 把连线题的每一对算成一条线段（坐标在中间那条通道里）。
 *
 * 🔴 **纵坐标一律取下标的**（`index * (rowHeight + gap) + rowHeight / 2`），
 * 两栏各按**原题顺序**排 —— 这正是教师这一条要求的内容。
 * 一条线连的两个盒子若不在同一行，线段就是**斜的**，那是对的（交叉线本来就该交叉）。
 */
export function matchLineGeometry(
  left: ReadonlyArray<{ id: string }>,
  right: ReadonlyArray<{ id: string }>,
  links: ReadonlyArray<{ leftId: string; rightId: string; ok: boolean }>,
  geometry: MatchGeometry,
): { lines: MatchLine[]; height: number } {
  const step = geometry.rowHeight + geometry.gap;
  const center = (index: number) => index * step + geometry.rowHeight / 2;
  const leftIndex = new Map(left.map((entry, index) => [entry.id, index]));
  const rightIndex = new Map(right.map((entry, index) => [entry.id, index]));
  const lines: MatchLine[] = [];
  for (const link of links) {
    const from = leftIndex.get(link.leftId);
    const to = rightIndex.get(link.rightId);
    // ⚠️ 两端都在栏里才有线段可画。缺一端（教师改题删了那个条目）时**不画** ——
    // 画一条指向空处的线会让教师去找一个屏幕上不存在的东西。
    if (from === undefined || to === undefined) continue;
    lines.push({ x1: 0, y1: center(from), x2: geometry.gutter, y2: center(to), ok: link.ok });
  }
  // 高度由**较长的那一栏**决定（两栏条目数可以不等）。
  const rows = Math.max(left.length, right.length);
  return { lines, height: rows === 0 ? 0 : rows * step - geometry.gap };
}

/**
 * 一道题 + 学生的作答值 → 呈现模型。
 *
 * 分派与 `draftFromValue` **同一把尺子**（`format` 是第一判据、题型是兜底）——
 * 教师把一道题从排序改成单选之后，学生**之前交的**那份排序仍然要按排序画出来
 * （库里那一行没变）。所以这里一律读 `draft.kind`，不读 `node.type`；
 * 只有**读不出形状**时（老值 / 手改过的行）才按 `node.type` 给一个空模型。
 */
export function answerView(node: WorksheetQuestionNode, value: unknown): AnswerView {
  const draft = draftFromValue(node, value);

  // ⚠️ 「未作答」的判据是 `isDraftEmpty`（与提交那一侧**同一个函数**）：它知道
  // 「填了一串空串」也算空。自己写一个 `text === ''` 会让填空题的空白作答画成
  // 一排空格子 —— 那看起来像「他填了空格」，而不是「他没做」。
  if (isDraftEmpty(draft)) return { kind: 'none' };

  if (draft.kind === 'ink') {
    return { kind: 'ink', ink: readInkValue(value) };
  }

  if (draft.kind === 'photo') {
    return draft.url ? { kind: 'photo', url: draft.url } : { kind: 'none' };
  }

  if (draft.kind === 'text') {
    return draft.text.trim() ? { kind: 'text', text: draft.text } : { kind: 'none' };
  }

  if (draft.kind === 'choice') {
    // 判断题**不存 options**（规格 §12：`data` 里只有 `correctKeys`）——读 `readOptions`
    // 会回空表，于是判断题一个选项都画不出来。服务端判分与教师端预览都走 `TRUE_FALSE_OPTIONS`。
    const options = node.type === 'true-false' ? TRUE_FALSE_OPTIONS : readOptions(node);
    const correctKeys = strings(node.data?.correctKeys);
    return {
      kind: 'choice',
      // ⚠️ 顺序取**选项表**的，不取学生点选的顺序 —— 后者逐人不同，教师横着比一串学生时
      // 会以为「每个人选的东西都不一样」（与 `formatAnswer` 的多选那一支同一条理由）。
      options: options.map((option) => ({
        key: option.key,
        text: option.text,
        picked: draft.selected.includes(option.key),
        correct: correctKeys.includes(option.key),
      })),
    };
  }

  if (draft.kind === 'fill') {
    const accepted = readAnswerSets(node.data?.answers);
    return {
      kind: 'fill',
      // ⚠️ `label` 用**全局空序**（`第 N 空`），与题干/表格里的空按同一顺序数 ——
      // 表格里那些空也在这条序列上（规格 §「空位顺序」：标记前文本 → 表格 → 标记后文本）。
      blanks: draft.texts.map((text, index) => ({
        label: `第 ${index + 1} 空`,
        text,
        accepted: accepted[index] ?? [],
      })),
      texts: draft.texts,
      tableBase: blankLayout(node).tableBase,
      hasTable: Boolean(node.data?.table && typeof node.data.table === 'object'),
    };
  }

  if (draft.kind === 'order') {
    const items = readOrderItems(node);
    return {
      kind: 'order',
      // 🔴 学生那一栏读的是**原始值**里的顺序（`draft.order`），不是 `items` ——
      // 后者是「学生看到的初始顺序」，人人相同（与 `formatAnswer` 的排序那一支同源）。
      student: draft.order.map((id) => textOf(items, id)),
      correct: strings(node.data?.correctOrder).map((id) => textOf(items, id)),
    };
  }

  if (draft.kind === 'match') {
    const left = readMatchLeft(node);
    const right = readMatchRight(node);
    const pairs = readPairs(node);
    // ⚠️ 分隔符是一个 **NUL 字符**（写成转义 `\u0000`）：它不可能出现在 id 里，
    //    所以拼接无歧义（换 `|` 之类可见字符，遇到一个含它的 id 就会串键，
    //    而那种错的表现是「两张卡片的数据混在一起」，不报错）。
    // 🔴 **写转义、不要写那个真字符**：真 NUL 会让 grep/rg 把整个文件当二进制
    //    （2026-09-29 实测：grep 在这个文件上一无所获），下一个人再也搜不到它。
    // 复合键：左 id + 右 id。
    const key = (pair: { leftId: string; rightId: string }) => `${pair.leftId}\u0000${pair.rightId}`;
    const correctSet = new Set(pairs.map(key));
    const linkedSet = new Set(draft.links.map(key));
    return {
      kind: 'match',
      left,
      right,
      // 🔴 顺序取**左栏**的（不是学生点击的顺序）：教师横着比一串学生时，
      // 「每个人连得都不一样」那种错觉就是这么来的（与 `formatAnswer` 同一条）。
      links: left
        .map((entry) => draft.links.filter((link) => link.leftId === entry.id)[0])
        .filter((link): link is { leftId: string; rightId: string } => Boolean(link))
        .map((link) => ({ leftId: link.leftId, rightId: link.rightId, ok: correctSet.has(key(link)) })),
      // 「正确答案里有、学生没连」的那几对 = 漏连。纯集合差，与上面同一个判据。
      missed: pairs.filter((pair) => !linkedSet.has(key(pair))),
    };
  }

  if (draft.kind === 'categorize') {
    const zones = readCategorizeZones(node);
    const items = readCategorizeItems(node);
    const placement = readPlacement(node);
    const zoneIds = new Set(zones.map((zone) => zone.id));
    const placed: string[] = [];
    const views = zones.map((zone) => ({
      id: zone.id,
      label: zone.text || zone.id,
      items: items
        .filter((item) => draft.assignment[item.id] === zone.id)
        .map((item) => {
          placed.push(item.id);
          return { text: textOf(items, item.id), ok: placement[item.id] === zone.id };
        }),
    }));
    return {
      kind: 'categorize',
      zones: views,
      // ⚠️ 「一条都没归」时**不列 loose**：那读起来像「他故意把它们留在外面」，
      // 而事实是他什么都没做 —— 那种情况上面 `isDraftEmpty` 已经落成 `none` 了
      // （与 `formatAnswer` 的归类那一支同一条纪律）。走到这里说明至少归了一条。
      loose: items
        .filter((item) => !placed.includes(item.id) || !zoneIds.has(draft.assignment[item.id] ?? ''))
        .map((item) => textOf(items, item.id)),
    };
  }

  // 兜底：`draftFromValue` 认不出的形状（老值 / 手改过的行）。
  // ⚠️ **不猜** —— 猜一个「大概是填空」会画出一排空格子，而那与「他没做」长得一样。
  return { kind: 'none' };
}
