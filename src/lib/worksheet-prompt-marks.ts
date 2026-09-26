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

/** 一条分段：`[start, end)` 上的一整份样式。 */
export interface PromptRun extends PromptTextStyle {
  start: number;
  end: number;
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

function sameRuns(a: PromptRun[], b: PromptRun[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item.start === b[index].start && item.end === b[index].end && sameStyle(item, b[index]));
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
  if (last && last.end === next.start && sameStyle(last, next)) {
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
  const pieces: { start: number; end: number; style: PromptTextStyle }[] = [];
  source.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const item = entry as Record<string, unknown>;
    const start = clampIndex(item.start, length);
    const end = clampIndex(item.end, length);
    if (end <= start) return;
    pieces.push({ start, end, style: readStyle(item) });
  });
  // ⚠️ `Array.prototype.sort` 在现代引擎里是**稳定**的 ⇒ 同 `start` 时保持库里原来的先后，
  // 那正是「左边那条赢」这条规则要的东西。
  pieces.sort((a, b) => a.start - b.start);

  const out: PromptRun[] = [];
  let cursor = 0;
  pieces.forEach((piece) => {
    if (piece.end <= cursor) return;               // 整条都被前面那条吃掉了
    const start = Math.max(piece.start, cursor);   // 重叠 ⇒ 从游标处开始（前面那条赢）
    if (start > cursor) pushRun(out, { start: cursor, end: start, ...DEFAULT_PROMPT_STYLE });
    pushRun(out, { start, end: piece.end, ...piece.style });
    cursor = piece.end;
  });
  if (cursor < length) pushRun(out, { start: cursor, end: length, ...DEFAULT_PROMPT_STYLE });
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

  const out: PromptRun[] = [];
  runs.forEach((item) => {
    // 一条分段最多被选区切成三段：左边原样 / 中间打补丁 / 右边原样。
    const leftEnd = Math.min(item.end, start);
    if (leftEnd > item.start) pushRun(out, { ...item, end: leftEnd });
    const midStart = Math.max(item.start, start);
    const midEnd = Math.min(item.end, end);
    if (midEnd > midStart) pushRun(out, { ...item, start: midStart, end: midEnd, ...clean });
    const rightStart = Math.max(item.start, end);
    if (item.end > rightStart) pushRun(out, { ...item, start: rightStart });
  });
  return sameRuns(out, runs) ? runs : out;
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
  pushRun(out, { start: from, end: from + inserted.length, ...insertedStyle });
  const delta = inserted.length - (oldTo - from);
  runs.forEach((item) => {
    const start = Math.max(item.start, oldTo);
    if (item.end > start) pushRun(out, { start: start + delta, end: item.end + delta, ...styleOf(item) });
  });
  return out.length === 0 ? readPromptRuns(undefined, next) : out;
}

/** 一份分段是不是**全是默认样式**（= 没有格式）。写库时用它决定那个键要不要留。 */
export function isPlainRuns(runs: PromptRun[]): boolean {
  if (!Array.isArray(runs)) return true;
  return runs.every(item => sameStyle(item, DEFAULT_PROMPT_STYLE));
}
