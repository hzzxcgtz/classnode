/**
 * 题干的行内格式（粗 / 斜 / 下划线 / 着重号 / 颜色）—— **纯逻辑，零 import**。
 *
 * ★ 2026-09-26（教师）：「需增加下划线和着重号，并且可以**只选择下面的部分文字**来设置。」
 *
 * ── 为什么这个文件是本次交付的重心 ──────────────────────────────────────────
 * 编辑面换成了 contenteditable（教师裁定 ①），而**本仓没有 jsdom、没有浏览器** ——
 * 输入法、光标、DOM 重建在自动化上一片空白。所以「设格式这件事到底改了什么」
 * 全部下沉到这里，由 `node --test` 逐条钉住（`worksheet-prompt-marks.test.ts`），
 * 组件只负责把选区接上来。⚠️ 零 import 是**纪律**（不是巧合）：镜像文件与测试要能在
 * Node 里直接加载，任何 `./x.js` 的解析都会在这里出问题（先例：`worksheet-heading.ts`）。
 *
 * ── 形状只有一种：**分段** ──────────────────────────────────────────────────
 * `runs` 是一份**分段**：`start` 递增、两两不重叠、**正好拼满** `[0, text.length)`。
 *
 * 🔴 为什么不是「可选标记列表」（几条各自带 `bold?: true` 的区间、允许叠在一起）：
 * 那样「同一个字段的两条区间压在一起时听谁的」会变成一个**没有正确答案**的问题 ——
 * 而这种问题在这个仓里的典型结局是「屏幕上画的和判据算的不一样，且两边都不报错」。
 * 分段形状里这个问题**不存在**：任一位置**恰好**属于一条。
 *
 * 🔴 本文件的所有函数都**不改入参**，需要改就返回新数组；
 * **什么都没变时返回入参本身**（同一个身份）—— 调用方靠身份决定要不要写库，
 * 而白写一次是一条无意义的上传（先例：`worksheet-drag.ts` 的同一条纪律）。
 *
 * ⚠️ 本文件在 `scripts/check-classroom-browser-compat.mjs` 的扫描根（`src/lib`）内：
 * 不得出现 `Object.hasOwn` / `structuredClone` / `findLast` / `.at(` / `:has(` /
 * `@container` / `content-visibility` / `color-mix(`（学生端跑在 Safari 15 的老 iPad 上）。
 */

/** 一段文字的完整样式。**五个字段全都有值** —— 「缺字段 = 默认」那种写法会让
 * 「这个字段没设」与「这个字段设成了默认值」变成两种长得一样的状态。 */
export interface PromptTextStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  emphasis: boolean;
  color: string;
}

/** 一条分段：`[start, end)` 上的**一整份样式**，外加「它是不是一个填空域」。 */
export interface PromptRun extends PromptTextStyle {
  start: number;
  end: number;
  /**
   * ★ 2026-09-26：这一段属于哪个**填空域** —— **每题一个标识**（空串 = 不是空）。
   *
   * ── 🔴 为什么是「标识」而不是「是/否」，也不是「第几个空」────────────────────
   * 我第一版写的是 `boolean`，理由是「**顺序即编号**，存编号会多出一种编号与顺序
   * 不一致的坏数据」。**那个理由是错的**，施工时被一次探针抓到：
   * 三个空**连着**排在题干末尾（**迁移的输出正是 `'________'.repeat(3)`**）读出来是
   * **1 个空**。因为「是不是空」这一个布尔量**分不开**这两件事：
   *   · 三个空挨着排（三条分段，三个空）；
   *   · 一个空被加粗切成三截（三条分段，**一个**空）。
   * 两者在数据上都是「三条挨着的、都带 `blank` 的分段」—— 任何规则都分不开。
   * ⇒ 标识一进来两件事立刻分开：**挨着但标识不同 = 两个空；挨着且标识相同 = 同一个空**。
   *
   * ⚠️ **标识不是答案序号。** 答案序号是「它在题干里从左到右排第几」
   *（`blankRuns` 的顺序），而标识只回答「这几条是不是同一个空」。
   * 让标识兼职序号的话，教师在中间插一个空就会把后面所有答案整体错位。
   * ⇒ 插入一个空时，`data.answers` 要在**插入位置**上同步 splice —— 那是编辑器的事。
   *
   * ⚠️ 它与另外五个字段**不是一类东西**：那五个是样式（`promptRunStyle` 只管它们），
   * 这个说的是「这一段属于谁」。所以它不在 `PromptTextStyle` 上，而在 `PromptRun` 上。
   */
  blank: string;
}

/** 没设过任何格式时的样子。`color` 的默认值与 `.prompt` 的颜色一致。 */
export const DEFAULT_PROMPT_STYLE: PromptTextStyle = {
  bold: false,
  italic: false,
  underline: false,
  emphasis: false,
  color: '#1e293b',
};

/**
 * 可选的文字颜色。
 *
 * ⚠️ **本表从 `worksheet-presentation.ts` 搬到这里**（2026-09-26）：那边要 import
 * `./api-base`，而本文件必须零 import 才能在 `node --test` 下直接跑。
 * `worksheet-presentation.ts` 原样再导出一次，调用方一行不用改。
 */
export const WORKSHEET_TEXT_COLORS = [
  { value: '#1e293b', label: '深灰' },
  { value: '#1d4ed8', label: '蓝色' },
  { value: '#b91c1c', label: '红色' },
  { value: '#15803d', label: '绿色' },
  { value: '#7e22ce', label: '紫色' },
] as const;

/** 四个布尔字段的名字。工具栏与归一化都靠它遍历，**别在别处再抄一遍**。 */
export const PROMPT_BOOLEAN_KEYS = ['bold', 'italic', 'underline', 'emphasis'] as const;
export type PromptBooleanKey = typeof PROMPT_BOOLEAN_KEYS[number];

/** 一次设置要改的字段。`color` 省略 = 不动颜色（不是「恢复默认色」）。 */
export interface PromptStylePatch {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  emphasis?: boolean;
  color?: string;
}

function isKnownColor(value: unknown): boolean {
  return WORKSHEET_TEXT_COLORS.some(item => item.value === value);
}

function styleOf(run: PromptRun): PromptTextStyle {
  return {
    bold: run.bold,
    italic: run.italic,
    underline: run.underline,
    emphasis: run.emphasis,
    color: run.color,
  };
}

function sameStyle(a: PromptTextStyle, b: PromptTextStyle): boolean {
  return a.bold === b.bold
    && a.italic === b.italic
    && a.underline === b.underline
    && a.emphasis === b.emphasis
    && a.color === b.color;
}

/**
 * 两条分段是不是**同一条**（合并相邻分段用的唯一判据）。
 * 🔴 **必须算上 `blank`**：样式完全一样、但一条是空、一条不是 —— 合并的话那个空
 * **当场消失**，而屏幕上看只是「空短了一点」，直到学生端再也画不出那个框。
 */
function sameRun(a: PromptRun, b: PromptRun): boolean {
  return a.blank === b.blank && sameStyle(a, b);
}

/** 这一条分段属于一个填空域吗。 */
export function isBlankRun(run: PromptRun): boolean {
  return typeof run.blank === 'string' && run.blank !== '';
}

function sameRuns(a: PromptRun[], b: PromptRun[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => (
    item.start === b[index].start && item.end === b[index].end && sameRun(item, b[index])
  ));
}

/** 把下标夹进 `[0, length]`。**不是数字就当成 0**（`'3'` / `NaN` / `null` 一律不认）。 */
function clampIndex(value: unknown, length: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > length) return length;
  return Math.floor(value);
}

/** 追加一条，**能与上一条合并就合并**（否则退一次格就多出一条，越用越碎）。 */
function pushRun(out: PromptRun[], next: PromptRun): void {
  if (next.end <= next.start) return;
  const last = out[out.length - 1];
  // 🔴🔴 **这里曾经有一条「两条挨着的空 = 一个空」的规则 —— 它是错的，已撤掉。**
  //
  // 它想防的是「在空的内部打字 / 只给空的一半设样式，把一个空切成两个」。
  // 但它**分不开**这两件事：
  //   · 三个空**连着**排在题干末尾（**迁移的输出正好长这样**：`'________'.repeat(3)`）；
  //   · 一个空被加粗切成了三段。
  // 两者在数据上都只是「三条挨着的、都带 `blank` 的分段」——
  // 于是那条规则把**三个空并成了一个**，学生只剩一格可填，而屏幕上只是下划线长一点。
  // （2026-09-26 施工第 3 步时被 `readPromptRuns` 的一次探针抓到：三个空读出来是 1 个。）
  //
  // ⇒ **要真正解决它，空必须自带一个标识**（「这几条属于同一个空」），而那是
  //   spec 里「顺序即编号」那个决定的**反面** —— 见
  //   `.superpowers/sdd/2026-09-26-填空题-题干内作答与选择填空/progress.md` 里那条 ruling。
  //   在那之前：**挨着的空各算一个**（迁移要的就是这个），而「在空内部打字 / 半加粗」
  //   会把它切成两个 —— 由编辑器拦住那两条路径（spec 第 4 步）。
  // ★ 标识一进来，两件事终于分得开了（**同一个空只许是一条分段**）：
  //    · 两条的**标识相同**（非空）⇒ 同一个空被切开 ⇒ **并回一条，样式取左边那一条的**。
  //      ⚠️ 这一支**不看样式**：给空的一半加粗仍然是**一个**空，而它只能有一条分段
  //      ⇒ 整个空取左边的样式（一个空的样式是**统一**的，这是模型的一部分）。
  //    · 标识不同 / 没有标识 ⇒ 走下面「同款才并」那一支（迁移追加的多个空就靠它各自留着）。
  const sameBlank = !!last && isBlankRun(last) && last.blank === next.blank;
  if (last && last.end === next.start && (sameBlank || sameRun(last, next))) {
    out[out.length - 1] = { ...last, end: next.end };
    return;
  }
  out.push(next);
}

function readStyle(item: Record<string, unknown>): PromptTextStyle {
  return {
    bold: item.bold === true,
    italic: item.italic === true,
    underline: item.underline === true,
    emphasis: item.emphasis === true,
    color: isKnownColor(item.color) ? item.color as string : DEFAULT_PROMPT_STYLE.color,
  };
}

/** 库里那一条读出来的**完整样子**（样式 + 是不是空）。 */
function readRun(item: Record<string, unknown>): Omit<PromptRun, 'start' | 'end'> {
  return {
    ...readStyle(item),
    // ⚠️ 只认**非空字符串**：认不出的值（`true` / `1`）一律当**不是空**。
    // 猜成空会让一道普通的题在学生端长出一个输入框 —— 那是「猜」的代价里最响的一种。
    // （`true` 也不再认：标识是**字符串**，改形状之前的库里没有这种值。）
    blank: typeof item.blank === 'string' ? item.blank : '',
  };
}

/** 一段没有任何东西的普通分段（填空隙用）。 */
function plainRun(start: number, end: number): PromptRun {
  return { start, end, ...DEFAULT_PROMPT_STYLE, blank: '' };
}

/**
 * 把库里读到的东西归一化成**那一种形状**：有序、不重叠、拼满 `[0, text.length)`。
 *
 * 🔴 读的一侧**不信任库里的东西**：越界 / 反序 / 空段 / 不是对象 / 认不出的颜色 ——
 * 一律丢掉，空隙补默认。抛出去是整块作答面板白屏，而这里丢一条的代价只是那一段没格式。
 *
 * ⚠️ **重叠时左边那条赢**（按 `start` 稳定排序后先到先得）：这个选择是任意的，但
 * **必须定死一条** —— 「谁赢说不清」正是本文件存在的理由。写的一侧（`setStyleOnRange`）
 * 总是先切开再写，永远不会造出重叠，所以这条规则只在读脏数据时用得上。
 */
export function readPromptRuns(raw: unknown, text: string): PromptRun[] {
  const length = typeof text === 'string' ? text.length : 0;
  if (length === 0) return [];
  const source = Array.isArray(raw) ? raw : [];
  const pieces: { start: number; end: number; run: Omit<PromptRun, 'start' | 'end'> }[] = [];
  source.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const item = entry as Record<string, unknown>;
    const start = clampIndex(item.start, length);
    const end = clampIndex(item.end, length);
    if (end <= start) return;
    pieces.push({ start, end, run: readRun(item) });
  });
  // ⚠️ `Array.prototype.sort` 在现代引擎里是**稳定**的 ⇒ 同 `start` 时保持库里原来的先后，
  // 那正是「左边那条赢」这条规则要的东西。
  pieces.sort((a, b) => a.start - b.start);

  const out: PromptRun[] = [];
  let cursor = 0;
  pieces.forEach((piece) => {
    if (piece.end <= cursor) return;               // 整条都被前面那条吃掉了
    const start = Math.max(piece.start, cursor);   // 重叠 ⇒ 从游标处开始（前面那条赢）
    if (start > cursor) pushRun(out, plainRun(cursor, start));
    pushRun(out, { start, end: piece.end, ...piece.run });
    cursor = piece.end;
  });
  if (cursor < length) pushRun(out, plainRun(cursor, length));
  return out;
}

/**
 * `index` 处那一条的样式。
 *
 * ⚠️ `index` 落在**最后一个字符之后**（= 文本末尾，也就是「刚打完字还想接着打」那个位置）
 * 时返回**最后一条**的样式 —— 不是默认。少了这一条，「刚加粗完接着打字」会掉格式。
 */
export function styleAt(runs: PromptRun[], index: number): PromptTextStyle {
  if (!Array.isArray(runs) || runs.length === 0) return DEFAULT_PROMPT_STYLE;
  const last = runs[runs.length - 1];
  const at = typeof index === 'number' && Number.isFinite(index) && index > 0
    ? Math.min(Math.floor(index), last.end)
    : 0;
  const found = runs.filter(item => at >= item.start && at < item.end)[0];
  return styleOf(found || last);
}

/** 与选区 `[from, to)` 相交的那些分段。 */
function runsInRange(runs: PromptRun[], from: number, to: number): PromptRun[] {
  if (!Array.isArray(runs) || runs.length === 0) return [];
  if (!(to > from)) return [];
  return runs.filter(item => item.end > from && item.start < to);
}

/**
 * 选区**整段**都有这个布尔标记吗。
 *
 * 🔴 判据是「整段都有」而不是「有一部分」：工具栏靠它决定按下去是**设上**还是**取消**。
 * 用「有一部分」的话，选一段半粗半不粗的文字点一下 B ⇒ 它会把整段都加粗（而不是取消），
 * 而教师看到的是「我明明想取消」。
 * ⚠️ 空选区（`to <= from`）⇒ `false` —— 裁定 ②：没选中就什么都不做，按钮也不该亮。
 */
export function rangeHasKey(runs: PromptRun[], from: number, to: number, key: PromptBooleanKey): boolean {
  const covered = runsInRange(runs, from, to);
  if (covered.length === 0) return false;
  return covered.every(item => item[key] === true);
}

/** 选区上颜色**一致**时返回那个颜色，不一致（或没选）返回 `null` —— 工具栏的色块据此显示。 */
export function rangeColor(runs: PromptRun[], from: number, to: number): string | null {
  const covered = runsInRange(runs, from, to);
  if (covered.length === 0) return null;
  const first = covered[0].color;
  return covered.every(item => item.color === first) ? first : null;
}

/**
 * 给选区 `[from, to)` 设样式：**先切开、再写、最后合并**。
 *
 * 🔴 空选区 / 反序 / 空补丁 一律返回**入参本身**（裁定 ②：没选中就什么都不做 ——
 * 而「什么都不做」必须是**同一个身份**，否则调用方会白写一次库）。
 * ⚠️ 越界的选区**夹紧**（不是丢弃）：`-5..999` 是一次合法的「整段」意思。
 */
export function setStyleOnRange(
  runs: PromptRun[],
  text: string,
  from: number,
  to: number,
  patch: PromptStylePatch,
): PromptRun[] {
  const length = typeof text === 'string' ? text.length : 0;
  if (length === 0 || !Array.isArray(runs) || runs.length === 0) return runs;
  const start = clampIndex(from, length);
  const end = clampIndex(to, length);
  if (end <= start) return runs;

  const clean: Partial<PromptTextStyle> = {};
  PROMPT_BOOLEAN_KEYS.forEach((key) => {
    const value = patch ? patch[key] : undefined;
    if (typeof value === 'boolean') clean[key] = value;
  });
  if (patch && typeof patch.color === 'string' && isKnownColor(patch.color)) clean.color = patch.color;
  if (Object.keys(clean).length === 0) return runs;

  const out = rewriteRange(runs, start, end, clean);
  return sameRuns(out, runs) ? runs : out;
}

/**
 * 把分段在 `[from, to)` 上切开、把 `patch` 盖在中间那一段上，其余原样。
 *
 * 🔴 **一条分段最多被切成三段**（左边原样 / 中间打补丁 / 右边原样）。
 * 抽出来共用是因为它有两个调用方（设样式、插空），而**两份实现漂移的症状是
 * 「设样式对、插空不对」**这种一半好一半坏的东西（本仓最烦的那一类）。
 * ⚠️ `patch` 只盖它点名的字段：左边与右边那两段**带着原样**（含 `blank`）搬过去，
 * 所以「给一个空加粗」不会把它变成普通文字。
 */
function rewriteRange(runs: PromptRun[], from: number, to: number, patch: Partial<PromptRun>): PromptRun[] {
  const out: PromptRun[] = [];
  runs.forEach((item) => {
    const leftEnd = Math.min(item.end, from);
    if (leftEnd > item.start) pushRun(out, { ...item, end: leftEnd });
    const midStart = Math.max(item.start, from);
    const midEnd = Math.min(item.end, to);
    if (midEnd > midStart) pushRun(out, { ...item, start: midStart, end: midEnd, ...patch });
    const rightStart = Math.max(item.start, to);
    if (item.end > rightStart) pushRun(out, { ...item, start: rightStart });
  });
  return out;
}

/** 题干里那些空，**按在题干里出现的先后**（它们的位置就是「第几个空」）。 */
export function blankRuns(runs: PromptRun[]): PromptRun[] {
  if (!Array.isArray(runs)) return [];
  return runs.filter(isBlankRun);
}

/** 这道题有几个空（= 学生要填几个格）。 */
export function blankCount(runs: PromptRun[]): number {
  return blankRuns(runs).length;
}

/**
 * 在 `[from, to)` 处插入一个**填空域**（工具栏那个按钮走的唯一一条路）。
 *
 * ⚠️ **返回文本与分段两样**：插空同时改了文字（多出那段占位下划线），
 * 只返回分段的话调用方得自己再拼一遍文本 —— 那是第二处会算错的地方。
 *
 * ⚠️ 占位的文字由调用方给（今天是 `prompt-editor.tsx` 里那个常量）：它的**长度**就是
 * 这个空在题干里有多宽，而那是**外观**，不该焊死在这一层。
 */
export function insertBlank(
  runs: PromptRun[],
  text: string,
  from: number,
  to: number,
  placeholder: string,
  /** 这个空的身份 —— **由调用方给**（编辑器按题的 id 造，与 `optionKey` / `q_…` 同源）。 */
  id: string,
): { text: string; runs: PromptRun[] } {
  const length = typeof text === 'string' ? text.length : 0;
  const start = clampIndex(from, length);
  const end = Math.max(start, clampIndex(to, length));
  const nextText = text.slice(0, start) + placeholder + text.slice(end);
  // 先按「打字」那条路挪区间（新插入的一段会跟随**前一个字符**的样式），
  // 再把那一段标成空 —— **造空只有这一条路**，`remapRuns` 永远不造空。
  const moved = remapRuns(runs, text, nextText);
  const nextRuns = rewriteRange(moved, start, start + placeholder.length, { blank: id });
  return { text: nextText, runs: nextRuns };
}

/**
 * 按题干文本**重新识别**填空域（★ 2026-09-27 教师裁定）。
 *
 * 🔴 判据（教师原话，两条）：
 *   ① 5 个字符全、且中间无空格 ⇒ 是一个真正的占位符，灰色底，**计入**个数；
 *   ② 5 个字符不全、或中间夹了其它字符 ⇒ 当**普通字符**处理，无底色，**不计入**个数。
 * ⇒ 「是不是空」**完全由文本决定**。这条裁定把这件事从 DOM 那层（`contenteditable=false`
 *    + 光标/删除接管）搬到了这里 —— 而这一层有用例、能做变异检验，那一层**本机一行都跑不到**。
 *
 * ⚠️ **身份（`blank`）要尽量继承**：同一个位置（区间逐字相同）上的空沿用旧身份，
 *    `answers[]` 才跟着走（`blankRuns` 的顺序就是「第几个空」）。
 *    改坏再改好 ⇒ 新身份、旧答案作废 —— 那是规则②的定义，不是缺陷。
 * ⚠️ `placeholder` 由**调用方**给（与 `insertBlank` 同一规矩）：它的内容是外观，
 *    不该焊死在纯逻辑这一层。
 * ⚠️ **随机性也只许由调用方给**（`mintId`）：这里自己造标识的话，用例就不确定了。
 *
 * ⚠️ 找的是**不重叠**的出现（`indexOf` 一路往前推）。所以 `{{填空域}` 里那 5 个字符
 *    仍然是连续的 ⇒ 算一个空（前面那个 `{` 是普通文字）—— 规则②排的是「缺字符」与
 *    「中间夹了别的字符」，多一个前置字符不在其中。
 */
export function recognizeBlanks(
  runs: PromptRun[],
  text: string,
  placeholder: string,
  mintId: () => string,
): PromptRun[] {
  const source = typeof text === 'string' ? text : '';
  if (!Array.isArray(runs)) return [];
  if (typeof placeholder !== 'string' || placeholder.length === 0) return runs;

  // 旧身份，按**区间**记 —— 「同一个位置」的判据就是区间逐字相同。
  const previous = new Map<string, string>();
  runs.forEach((item) => {
    if (isBlankRun(item)) previous.set(`${item.start}:${item.end}`, item.blank);
  });

  // ① 先把**所有**旧的空标记清掉。规则②要求「文本变了就不再是空」，
  //    留着旧的会让一个被改坏的占位串还算成空 —— 那是静默的（个数不降、答案还挂着）。
  let next = rewriteRange(runs, 0, source.length, { blank: '' });

  // ② 再按文本把**精确出现**的地方标回来。
  let from = 0;
  for (;;) {
    const at = source.indexOf(placeholder, from);
    if (at < 0) break;
    const end = at + placeholder.length;
    const inherited = previous.get(`${at}:${end}`);
    next = rewriteRange(next, at, end, { blank: inherited ?? mintId() });
    from = end;
  }
  return next;
}

/**
 * 删除题干中的一个明确区间，并让分段按同一坐标同步收缩。
 *
 * 这条路径主要服务「填空域」这种原子对象：浏览器自己的 contenteditable 删除行为
 * 在不同内核里并不一致，有的删整段、有的只删一个字符。编辑器先确定准确区间，再走这里，
 * 因而一次 Backspace / Delete 永远只产生一次、完整的删除。
 */
export function removePromptRange(
  runs: PromptRun[],
  text: string,
  from: number,
  to: number,
): { text: string; runs: PromptRun[] } {
  const length = typeof text === 'string' ? text.length : 0;
  const start = clampIndex(from, length);
  const end = Math.max(start, clampIndex(to, length));
  if (end <= start) return { text, runs };

  const nextText = text.slice(0, start) + text.slice(end);
  if (!nextText) return { text: '', runs: [] };
  const delta = end - start;
  const out: PromptRun[] = [];
  runs.forEach((run) => {
    if (run.end <= start) {
      pushRun(out, { ...run });
      return;
    }
    if (run.start >= end) {
      pushRun(out, { ...run, start: run.start - delta, end: run.end - delta });
      return;
    }
    if (run.start < start) pushRun(out, { ...run, end: start });
    if (run.end > end) pushRun(out, { ...run, start, end: run.end - delta });
  });
  return { text: nextText, runs: out.length > 0 ? out : readPromptRuns(undefined, nextText) };
}

/**
 * 接着打字要用的样式：**替换点前一个字符**的那一份。
 *
 * 🔴 为什么是「前一个」而不是「替换点那一条」（= 后一个字符的样式）：
 * 教师在加粗段的**右边界**处接着打字，意图是「把这段加粗的话继续写下去」——
 * 取后一个字符的样式会让新字**掉出**加粗段，而屏幕上看起来像是「加粗被吃掉了」。
 * ⚠️ 替换点在段首（没有前一个字符）⇒ 用第一份样式（那儿是「整段都这个格式」的常见情形）。
 */
function styleBefore(runs: PromptRun[], index: number): PromptTextStyle {
  return styleAt(runs, index > 0 ? index - 1 : 0);
}

/**
 * 文字被编辑之后，把分段**挪到新文本上**。
 *
 * ── 归属规则（唯一一处需要产品判断的地方）──────────────────────────────────
 * 用「公共前缀 / 公共后缀」找出被替换的区间 `[from, oldTo)`，然后：
 *   · 左边原样搬（裁到 `from`）；
 *   · **新插入的那段文字取「替换点前一个字符」的样式**（见 `styleBefore`）；
 *   · 右边剩下的整体平移。
 *
 * ⚠️ **已知的边界**：前缀/后缀法在「改出来的文本和原来长得一样」时分不清编辑发生在哪
 *（例如 `aa` → `aaa`，实际可能是在**开头**插的，这里一律归到**靠后**的那个位置）。
 * 代价是那一段的格式归属可能和教师的直觉差一格 —— **纯外观，不丢字**。
 * 要消掉它得从 DOM 拿真实的光标位置，而 contenteditable **不给** `selectionStart`。
 *
 * 🔴 空文本 ⇒ 空数组；文本没变 ⇒ **入参本身**。
 */
export function remapRuns(runs: PromptRun[], prevText: string, nextText: string): PromptRun[] {
  const prev = typeof prevText === 'string' ? prevText : '';
  const next = typeof nextText === 'string' ? nextText : '';
  if (prev === next) return runs;
  if (next.length === 0) return [];
  if (!Array.isArray(runs) || runs.length === 0) return readPromptRuns(undefined, next);

  let head = 0;
  const maxHead = Math.min(prev.length, next.length);
  while (head < maxHead && prev[head] === next[head]) head += 1;
  let tail = 0;
  const maxTail = Math.min(prev.length - head, next.length - head);
  while (tail < maxTail && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) tail += 1;

  const from = head;
  const oldTo = prev.length - tail;
  const inserted = next.slice(head, next.length - tail);

  const out: PromptRun[] = [];
  runs.forEach((item) => {
    const end = Math.min(item.end, from);
    if (end > item.start) pushRun(out, { ...item, end });
  });
  const insertedStyle = styleBefore(runs, from);
  // ⚠️ 新插入的文字**永远不是空**：造空只有一条路 —— `insertBlank`（工具栏那个按钮）。
  // （这里曾经还有一条「插在空内部就归属于那个空」的规则，已随上面那条一起撤掉：
  //   它与「挨着的空各算一个」互斥，见 `pushRun` 上那一段。）
  // ★ 标识一进来，「在空内部打字」终于能**正确地**处理了：
  //   插在某个空**内部**（严格内部）的字属于那个空（沿用它的标识）⇒ 那几条会并回一条，
  //   那个空**不会被切开**。紧贴边界打字则是一个普通的新文字（`blank: ''`）。
  //   ⚠️ 这一条在「只有布尔量」的时候是**做不到**的：那时它与「两个空挨着排」同形。
  const owner = runs.filter(item => isBlankRun(item) && item.start < from && from < item.end)[0];
  pushRun(out, { start: from, end: from + inserted.length, ...insertedStyle, blank: owner ? owner.blank : '' });
  const delta = inserted.length - (oldTo - from);
  runs.forEach((item) => {
    const start = Math.max(item.start, oldTo);
    // ⚠️ 这里必须带上**整条**（含 `blank`）：只用 `styleOf` 会把空降级成普通文字。
    if (item.end > start) pushRun(out, { ...item, start: start + delta, end: item.end + delta });
  });
  return out.length === 0 ? readPromptRuns(undefined, next) : out;
}

/**
 * 一条分段该写上去的**行内样式**（渲染端唯一的样式来源）。
 *
 * ⚠️ 返回的是**普通键值对**（不是 `CSSProperties`）—— 这是刻意的：本模块必须零 import，
 * 而 `CSSProperties` 是 react 的类型。调用方一次 `as CSSProperties`（见 `PromptText`）。
 *
 * 🔴 **那两个 `-webkit-` 前缀不是历史包袱，是唯一能用的写法。**
 * 着重号（`text-emphasis`）在老 iPad 的 Safari 15 上只认 `-webkit-text-emphasis`
 * 与 `-webkit-text-emphasis-position`，而**位置必须是 `under`** —— `over`（默认）
 * 是给拉丁文基线设计的，中文的着重号会挂在字上方、被行高裁掉。
 * 少了任何一条，教师设了着重号而学生端**什么都不显示**，且**全程无一处报错**。
 * ⇒ `worksheet-prompt-marks.test.ts` 里有一条专门的用例钉着这两行。
 *
 * ⚠️ `fontWeight` 写的是 **400**（不是省略）：两处调用方的类里各有一个基线
 *（学生端 `.prompt` 无声明、编辑页预览那一行 `font-weight: 600`），而今天两边
 * **实际渲染的都是 400**（编辑页那个 600 一直被这里的内联样式盖着）。
 * 省略它会把这个死值放出来 ⇒ 编辑页的观感变了。要改成 600 是**另一个**外观决定。
 */
export function promptRunStyle(run: PromptTextStyle): Record<string, string | number> {
  const style: Record<string, string | number> = {
    color: run.color,
    fontWeight: run.bold ? 700 : 400,
    fontStyle: run.italic ? 'italic' : 'normal',
  };
  if (run.underline) style.textDecoration = 'underline';
  if (run.emphasis) {
    // ── 着重号的形状：为什么是**一个字符**，而不是 `dot` / `circle` ──────────────
    // CSS 一共只给这几个：`dot`（**小**点）/ `circle`（**大**圈）/ `double-circle` /
    // `triangle` / `sesame`，外加 `<string>`（任意字符）。`dot` 与 `circle` 之间
    // **没有第三个关键词**，而教师两个都试过：dot 太小、circle 太大
    //（2026-09-26 两轮反馈）。⇒ 走 `<string>`，字符自己决定视觉重量。
    // ⚠️ 挑的是 `•`（U+2022 BULLET）：它就是按「正文里的小强调点」设计的，
    // 重量正好落在 dot 与 circle 中间。可换的还有 `·`（更小）、`●`（更大，
    // 约等于 circle）、`◦`（空心）。
    // 🔴 值里那对**引号是语法的一部分**（`<string>` 形式），不是修饰。
    // ⚠️ 这是**取悦眼睛**的那一半，改它不需要理由；下面那两个**属性名**与 `under`
    // 是「显不显示」的那一半，别动。
    style.WebkitTextEmphasis = "'•'";
    style.WebkitTextEmphasisPosition = 'under';
    // 无前缀那一份也写上：今天的 Safari 只认前缀版，但不必等它改。
    style.textEmphasis = "'•'";
    style.textEmphasisPosition = 'under';
  }
  return style;
}

/**
 * 一行文本大约占几个 `ch`（★ 2026-09-26）。
 *
 * 教师：「在输入的长度较长时，这个区域的宽度要**自适应增大**。」
 * 而 `<input>` 不会自己长 —— 得把宽度算出来给它。`ch` 是**数字 0 的宽度**（半角），
 * 一个汉字大约占**两格**，所以不能拿 `text.length` 当宽度：那样中文一长就被截在框里。
 *
 * ⚠️ 这是个**近似**（真值要看字体），而它只需要「够宽」——宽一点看不出来，窄了就截字。
 * 判据取「码点 ≥ 0x1100」：谚文、CJK、全角形式、中文标点都在那一侧
 *（西文与半角标点在下）。刻意不引 `Intl` / 正则的 Unicode 属性转义 ——
 * 学生端要过 Safari 15 那道门禁，而这行算术越笨越安全。
 */
export function inputWidthCh(text: string): number {
  if (typeof text !== 'string') return 0;
  let width = 0;
  for (const char of text) {
    width += char.codePointAt(0)! >= 0x1100 ? 2 : 1;
  }
  return width;
}

/** 一份分段是不是**全是默认样式**（= 没有格式）。写库时用它决定那个键要不要留。 */
export function isPlainRuns(runs: PromptRun[]): boolean {
  if (!Array.isArray(runs)) return true;
  // 🔴 **一个空也不算「没有格式」**：调用方（编辑器）拿它为真时**不写 `promptRuns` 这个键**
  // ⇒ 空与格式一起没。这一条与 `sameRun` 那条是两个不同的入口，都会让空消失。
  return runs.every(item => !isBlankRun(item) && sameStyle(item, DEFAULT_PROMPT_STYLE));
}
