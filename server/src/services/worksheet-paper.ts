import {
  FILL_BLANK_TEXT,
  PAPER_BLANK_TEXT,
  TABLE_MARK_TEXT,
  acceptableAnswersFor,
  answerSlotCount,
  readPairs,
  readStringMap,
  readStrings,
  resolvePoints,
  tableRowList,
  type QuestionNode,
  type QuestionPoints,
} from './worksheet-questions.js';
// ★ 2026-09-30：公式切分的**服务端孪生**（与 `src/lib/worksheet-math.ts` 逐字一致，
// 由 `src/lib/worksheet-math-parity.test.ts` 对拍钉住）。
import { mathText, splitMath, type MathPiece } from './worksheet-math.js';
import { TASK_TYPE, flattenAnswerable } from './worksheet-heading.js';
import { questionTypeNickname } from './question-type-labels.js';

/**
 * 「教师用卷」的**判据层**（★ 2026-09-30，教师）。
 *
 * 教师原话：「接下来需要增加教师端学习单导出功能，格式为 pdf/docx 可选，内容包括
 * **任务、题目和答案**，注意特殊题型，例如归类题、连线题、排序题的呈现方式，
 * 这导出的文档是给教师看的，所以排版上一定要精美，但不能花哨」。
 *
 * ── 🔴 与 `worksheet-report.ts` 的红线**正好相反**，所以必须是两个文件 ──────────
 * 那一份（按学生的作答报告）**明令不许印正确答案**（文件头写着不许出现 `ANSWER_KEYS`
 * 里任何一个键）。**这一份的全部意义就是印答案** —— 把两者合并、或者让这一份去
 * import 那一份，等于把「不许印答案」那条红线拆掉，而它守的是**发给学生的纸**。
 * ⇒ 两个文件互不 import，各自的文件头都写着这句话。
 *
 * ── 为什么判据要单独成文件（与 report 同一条理由）──────────────────────────
 * docx 渲染（`worksheet-paper-docx.ts`）本机**验不了**（没有 Word），而纸上的每一句话
 * 都来自这里 ⇒ 判据住在这里，`node --test` 跑得到；渲染层只剩「把模型画成段落」。
 *
 * ── 纸上的形状 ────────────────────────────────────────────────────────────
 * ```
 * ① 选择题 · 2 分                        ← heading + meta
 *    下列词语中，书写完全正确的一项是（  ）。   ← prompt（含 `{填空域}` → 下划线）
 *    A 慈祥   B 爱幕   C 攀登   D 疲备      ← body（每题型的作答区）
 *    答案：C 攀登                            ← answer
 * ```
 * ⚠️ `heading` 走 `flattenAnswerable`（与看板列头、抽屉、学生端**同一个**函数）——
 *    纸上的题号必须与学生看到的一模一样，否则教师念「第 3 题」时全班找不着。
 */

/**
 * 纸上的一段**行内内容**：文字或公式。
 *
 * ★ 2026-09-30：题面里可以写数学公式（`$x^2$`），而切分在**判据层**做（`splitMath`），
 *    **不在渲染层现切** —— 这个仓的规矩是「纸上的每一个字都由判据层决定」，而渲染层
 *    **本机验不了**（没有 Word）。放渲染层的话，「纸上有没有公式」就没有任何用例盯着。
 *
 * 🔴 它是 `MathPiece` 的**别名**，不是把那个联合类型重写一遍：同一个形状两个名字可以，
 *    两份定义不行 —— 两份迟早会漂，而漂了之后两边都不报错。
 */
export type PaperInline = MathPiece;

/**
 * `string` → 行内部件。**构造侧唯一的入口**（题干、作答区、答案、表格单元格都走它）。
 *
 * ⚠️ 不要在别处手写 `[{ kind: 'text', text }]` —— 那样公式就漏了，而漏了之后
 *    纸上印的是 `$x^2$` 源码：**看得见，但没人会以为它是错的**。
 */
function inlineOf(text: string): PaperInline[] {
  return splitMath(text);
}

/**
 * 行内部件 → 纯文本（**剥掉定界符**）。
 *
 * ⚠️ 只给「需要纯文本的消费者」与既有用例用 —— **渲染层别用它**（那边要画公式）。
 * 🔴 它**复用 `mathText`**，不是把那段 map/join 再写一遍：两处实现逐字相同就是本仓
 *    最防的「同一个事实两份拷贝」。
 */
export function inlineText(parts: readonly PaperInline[]): string {
  return mathText(parts as PaperInline[]);
}

/**
 * 题面的部件：行内内容，外加**块级**的表格。
 *
 * ★ 2026-09-30 教师：「下方的表格要用 Word 里的真表格」。
 * 🔴 表格**必须留在它在题干里的位置**上（`{表格域}` 那个标记处），不能挪到题末：
 *    学生屏幕上就是就地替换的（2026-09-28 那条裁定），纸上换个位置会让教师念题时对不上。
 *    ⇒ 题面从「一个字符串」变成「一串部件」，`text` / `math` 与 `table` 交替出现。
 */
export type PaperPromptPart =
  | PaperInline
  | { kind: 'table'; rows: PaperTableCell[][] };

/** 表格里的一格。`blank` = 学生要填的那一格（与库里 `cell.blank` 那个 id 对应）。 */
export interface PaperTableCell {
  /** ★ 2026-09-30：原来是 `string` —— 单元格里也能写公式。 */
  text: PaperInline[];
  blank: boolean;
}

/** 纸上一道题。 */
export interface PaperQuestion {
  /** 两级题号（`任务一 · 1`；散题没有前缀）。 */
  heading: string;
  /** 题号后面那一小段（`选择题 · 2 分`）。 */
  meta: string;
  /**
   * 题面（`{填空域}` 已换成 `PAPER_BLANK_TEXT`；表格是**独立的部件**、画成真表格）。
   * ⚠️ 它与 `questionTextFor` 那条纯文本投影**不是一回事**：那条把表格折成 `|` 分隔的文字，
   *    只适合给 AI / 纯文本消费者；纸上要的是**表格对象**。
   */
  prompt: PaperPromptPart[];
  /**
   * 作答区，一行一条（选项 / 条目 / 左右栏 / 组块），**每行一串行内部件**。
   * 空数组 = 纸面上没有作答区。
   */
  body: PaperInline[][];
  /** 「答案：」后面那一段。`answerNote` 非空时它是**空数组**。 */
  answer: PaperInline[];
  /**
   * 整句的答案说明（绘图题那种「没有文字答案」的情形）。
   * ⚠️ 与 `answer` **互斥**：有它就没有 `answer` —— 两个都写的话纸上会出现
   * 「答案：（绘图题…）」，那是把两句话串成了一句假的。
   */
  answerNote: string | null;
}

export type PaperBlock =
  | { kind: 'task'; title: string; description: string | null }
  | { kind: 'question'; question: PaperQuestion };

export interface WorksheetPaper {
  title: string;
  description: string | null;
  blocks: PaperBlock[];
  /** 可作答的题数（与 `flattenAnswerable` 同一个口径）。 */
  questionCount: number;
}

/** ① ② ③ …（多空填空、归类条目用它编号）。超过 20 个就退回 `1.` 那种写法。 */
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
function marker(index: number): string {
  return index < CIRCLED.length ? CIRCLED[index] : `${index + 1}.`;
}

/** 选项字母：用条目自己的 `key`（教师改过就用他的），没有 key 才回落到 A/B/C。 */
function optionRows(raw: unknown): Array<{ key: string; text: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ key: string; text: string }> = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const row = item as Record<string, unknown>;
    const key = typeof row.key === 'string' && row.key ? row.key : String.fromCharCode(65 + index);
    const text = typeof row.text === 'string' ? row.text : '';
    out.push({ key, text });
  });
  return out;
}

/**
 * 条目表（`items` / `left` / `right` / `zones`）读成 `{ id, text }`。
 * ⚠️ 文本的键名**不统一**：`items` / `left` / `right` 用 `text`，而**归类题的框用 `label`**
 *（客户端 `readCategorizeZones` 的注释写着这件事）。读错的表现只是「框名是空的」。
 */
function entryRows(raw: unknown, textKey: 'text' | 'label'): Array<{ id: string; text: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; text: string }> = [];
  raw.forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) return;
    const text = typeof row[textKey] === 'string' ? row[textKey] as string : '';
    out.push({ id, text });
  });
  return out;
}

/**
 * 表格的行列（`data.table.rows`）读成纸上的格子。
 * ⚠️ 只认 `cell.blank` 是**非空字符串**的那种（与 `tableBlankCount` 同一把尺子）：
 *    库里那个字段是空的 id 串，`true` / `1` 之类的坏值不算空。
 */
function tableCells(raw: unknown): PaperTableCell[][] {
  return tableRowList(raw).map((row) => row.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { text: inlineOf(''), blank: false };
    }
    const cell = entry as Record<string, unknown>;
    const text = typeof cell.text === 'string' ? cell.text.replace(/[\r\n]+/g, ' ').trim() : '';
    const blank = typeof cell.blank === 'string' && cell.blank !== '';
    // ★ 2026-09-30：单元格里也能写公式 ⇒ 文字过 `inlineOf`。
    return { text: inlineOf(text), blank };
  }));
}

/**
 * 题面切成部件：`{表格域}` 那个标记处**就地**嵌入一张表格。
 *
 * 🔴 判据是**标记在不在**，不是「data 里有没有 table」—— 与渲染、与 `questionTextFor` 的
 *    投影**同一条**：库里有一张表但题干里没标记 ⇒ 学生屏幕上根本没有这张表（服务端的校验器
 *    会把这种题**拒掉**，但老数据/手改过的行仍可能这样）⇒ 纸上也不画它。
 * ⚠️ 没有标记时，即便 `data.table` 有内容也只剩一段纯文本（那条规则见上）。
 * ⚠️ 空段落会被丢掉（`text: ''`）：留着它只会在纸上多出一个空行。
 */
function promptParts(node: QuestionNode): PaperPromptPart[] {
  const prompt = typeof node.prompt === 'string' ? node.prompt : '';
  const data = node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {};
  const toPaper = (text: string) => text.split(FILL_BLANK_TEXT).join(PAPER_BLANK_TEXT);
  const at = prompt.indexOf(TABLE_MARK_TEXT);
  // ★ 2026-09-30：`toPaper` 只换填空域，**公式还要再切一次** ⇒ 文本一律过 `inlineOf`。
  if (at < 0) return prompt.trim() === '' ? [] : inlineOf(toPaper(prompt));
  const rows = tableCells(data.table);
  const before = toPaper(prompt.slice(0, at));
  const after = toPaper(prompt.slice(at + TABLE_MARK_TEXT.length));
  const parts: PaperPromptPart[] = [];
  if (before.trim() !== '') parts.push(...inlineOf(before));
  // 一行都没有的表**不画**（画一个空表格在纸上只是一个莫名其妙的方框）。
  if (rows.length > 0) parts.push({ kind: 'table', rows });
  if (after.trim() !== '') parts.push(...inlineOf(after));
  return parts;
}

/** 卷面上一行的文字：题干/选项里可能有换行（题干是多行的），行内换行原样留着。 */
function oneLine(raw: string): string {
  return raw.replace(/\s*\n\s*/g, ' ').trim();
}

/** 答案区：把一串可接受答案并成一行（多个之间用「/」—— 那是「都对」的意思）。 */
function joinAcceptable(answers: readonly string[]): string {
  const kept = answers.map((answer) => answer.trim()).filter(Boolean);
  return kept.length === 0 ? '' : kept.join(' / ');
}

/**
 * 填空题/表格题的答案：**逐空编号**（单空不编号 —— 「答案：高兴」比「答案：①高兴」干净）。
 * ⚠️ 空序 = `data.answers` 的下标序（服务端的 `answers` 就是这个序；
 *    题干那些 `{填空域}` 的先后由 `blankLayout` 决定，而**答案侧不重算它**）。
 */
function blankAnswer(data: Record<string, unknown>): string {
  const total = answerSlotCount(data);
  if (total === 0) return '';
  if (total === 1) return joinAcceptable(acceptableAnswersFor(data, 0));
  const parts: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const text = joinAcceptable(acceptableAnswersFor(data, index));
    // 没配答案的空照样占一个号 —— 少了号，后面每一个空的编号都会错位。
    parts.push(`${marker(index)}${text || '—'}`);
  }
  return parts.join('　');
}

/** 本题的作答区 + 答案。**逐题型**，这是这个文件的主体。 */
function renderQuestion(node: QuestionNode): { body: PaperInline[][]; answer: PaperInline[]; answerNote: string | null } {
  const data = node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {};

  if (node.type === 'single-choice' || node.type === 'multi-choice') {
    const options = optionRows(data.options);
    const correct = readStrings(data.correctKeys);
    // 🔴 答案带上**选项原文**（`C 攀登`）：教师对着念时不用回头数选项。
    //    这**有意**与客户端那句 `correctAnswerLabel`（只印 key）不同 —— 那是给学生看的。
    const answer = correct
      .map((key) => {
        const option = options.filter((row) => row.key === key)[0];
        return option && option.text ? `${key} ${oneLine(option.text)}` : key;
      })
      .join('、');
    return { body: options.map((row) => inlineOf(`${row.key} ${oneLine(row.text)}`)), answer: inlineOf(answer), answerNote: null };
  }

  if (node.type === 'true-false') {
    // 判断题不印作答区：题干里的「（  ）」就是答题位（印一行「对 错」反而像多了一道题）。
    const correct = readStrings(data.correctKeys);
    const answer = correct.map((key) => (key === 'T' ? '对' : key === 'F' ? '错' : key)).join('、');
    return { body: [], answer: inlineOf(answer), answerNote: null };
  }

  if (node.type === 'fill-blank' || node.type === 'choice-blank') {
    // 选词填空的**词库**印在作答区（学生要在这些词里挑）——它住在题目顶层的 `fillChoicePool`。
    const pool = readStrings(data.fillChoicePool);
    return { body: pool.length > 0 ? [inlineOf(`待选词：${pool.join('　')}`)] : [], answer: inlineOf(blankAnswer(data)), answerNote: null };
  }

  if (node.type === 'short-answer') {
    return { body: [], answer: inlineOf(joinAcceptable(acceptableAnswersFor(data, 0))), answerNote: null };
  }

  if (node.type === 'order') {
    // 学生看到的顺序就是 `data.items` 的顺序（服务端注释：「那是学生看到的**显示顺序**」）。
    const items = entryRows(data.items, 'text');
    const correct = readStrings(data.correctOrder);
    // 答案用**学生看到的序号**表达（`3 → 1 → 4 → 2`）：教师念的就是这张纸上的号。
    const answer = correct
      .map((id) => {
        const index = items.map((row) => row.id).indexOf(id);
        return index < 0 ? '？' : String(index + 1);
      })
      .join(' → ');
    const body = items.map((row, index) => inlineOf(`${index + 1} ${oneLine(row.text) || '（这一条还没写）'}`));
    return { body, answer: inlineOf(answer), answerNote: null };
  }

  if (node.type === 'match') {
    const left = entryRows(data.left, 'text');
    const right = entryRows(data.right, 'text');
    const pairs = readPairs(data.pairs);
    const body: PaperInline[][] = [];
    if (left.length > 0) body.push(inlineOf(`左：${left.map((row, index) => `${index + 1} ${oneLine(row.text) || '（空）'}`).join('　')}`));
    if (right.length > 0) body.push(inlineOf(`右：${right.map((row, index) => `${String.fromCharCode(65 + index)} ${oneLine(row.text) || '（空）'}`).join('　')}`));
    // 一个左项可以连多个右项（裁定甲）⇒ 按左项分组再用「、」并列。
    const answer = left.map((row, index) => {
      const linked = pairs.filter((pair) => pair.leftId === row.id)
        .map((pair) => {
          const at = right.map((item) => item.id).indexOf(pair.rightId);
          return at < 0 ? '？' : String.fromCharCode(65 + at);
        });
      // 没连线的左项是**留空项**（学生不需要连它）—— 印出来，别让人以为漏了一行。
      return linked.length === 0 ? `${index + 1}–（不连）` : `${index + 1}–${linked.join('、')}`;
    }).join('　');
    return { body, answer: inlineOf(answer), answerNote: null };
  }

  if (node.type === 'categorize') {
    const items = entryRows(data.items, 'text');
    const zones = entryRows(data.zones, 'label');
    const placement = readStringMap(data.placement);
    const body: PaperInline[][] = [];
    if (items.length > 0) body.push(inlineOf(`条目：${items.map((row, index) => `${marker(index)}${oneLine(row.text) || '（空）'}`).join('　')}`));
    if (zones.length > 0) body.push(inlineOf(`框：${zones.map((row, index) => `${String.fromCharCode(65 + index)} ${oneLine(row.text) || '（空）'}`).join('　')}`));
    // 答案**按框归并**（「A 动物：①③」）—— 逐条列的话教师得自己在脑子里分组。
    const answer = zones.map((zone, zoneIndex) => {
      const inside = items.map((row, index) => ({ row, index }))
        .filter(({ row }) => placement[row.id] === zone.id)
        .map(({ index }) => marker(index));
      return `${String.fromCharCode(65 + zoneIndex)} ${oneLine(zone.text) || '（空框）'}：${inside.length > 0 ? inside.join('') : '—'}`;
    }).join('　');
    return { body, answer: inlineOf(answer), answerNote: null };
  }

  if (node.type === 'drawing') {
    // 绘图题**没有文字答案** —— 印一行说明，别让纸上出现一个空荡荡的「答案：」。
    return { body: [], answer: [], answerNote: '（绘图题：答案在学生画的那张图上，请在教师端查看）' };
  }

  // 认不出的题型（老数据、手工改过的行）：题面照印，答案如实说「没有」。
  return { body: [], answer: [], answerNote: '（这道题的答案读不出来）' };
}

/** 一道题的完整纸面。 */
export function paperQuestion(node: QuestionNode, heading: string, fallbackPoints: QuestionPoints): PaperQuestion {
  const points = resolvePoints(node, fallbackPoints);
  const rendered = renderQuestion(node);
  return {
    heading,
    // ★ 2026-09-30 教师：「题型使用别名，例如开心填空」——纸上印**别名**（学生端屏幕上
    // 那几个名字），教师念「开心填空」时与学生的屏幕对得上。
    meta: `${questionTypeNickname(node.type)} · ${points.full} 分`,
    prompt: promptParts(node),
    body: rendered.body,
    answer: rendered.answer,
    answerNote: rendered.answerNote,
  };
}

/**
 * 一份学习单 → 纸上的块序列。
 *
 * ⚠️ **段的结构**与 `groupAnswerable`（客户端）是同一条：一个任务一段（带标题与说明），
 * **连续**的散题合成一段（无标题）。这里不去 import 那边的分组函数（服务端没有它），
 * 但用的是同一条推理：拍平是 DFS ⇒ **一个顶层节点的全部可作答后代在结果里必然连续**，
 * 于是按顶层节点顺序切就行（`groupAnswerable` 的注释里写着同一句话）。
 */
export function buildWorksheetPaper(input: {
  title: string;
  description: string | null;
  content: unknown;
  /** 没写分值时用的默认档（来自学习单设置，与服务端判分同一个来源）。 */
  fallbackPoints: QuestionPoints;
}): WorksheetPaper {
  const content = input.content && typeof input.content === 'object' && !Array.isArray(input.content)
    ? input.content as Record<string, unknown>
    : {};
  const nodes = Array.isArray(content.nodes) ? content.nodes as QuestionNode[] : [];
  // 🔴 题号**只有一处**：`flattenAnswerable`（与看板列头 / 抽屉 / 学生端同一个函数）。
  const numbered = flattenAnswerable(nodes);
  const blocks: PaperBlock[] = [];
  let cursor = 0;

  for (const top of nodes) {
    const isTask = top.type === TASK_TYPE;
    // 这个顶层节点占了拍平结果的几项 —— 用同一个函数的产物数，不另写一份遍历规则。
    const own = flattenAnswerable([top]).length;
    const slice = numbered.slice(cursor, cursor + own);
    cursor += own;
    if (isTask) {
      blocks.push({
        kind: 'task',
        title: typeof top.prompt === 'string' ? top.prompt.trim() : '',
        description: typeof (top.data as Record<string, unknown> | undefined)?.description === 'string'
          ? ((top.data as Record<string, unknown>).description as string).trim() || null
          : null,
      });
    }
    slice.forEach((item) => {
      blocks.push({ kind: 'question', question: paperQuestion(item.node, item.heading, input.fallbackPoints) });
    });
  }

  return {
    title: input.title,
    description: input.description,
    blocks,
    questionCount: numbered.length,
  };
}

/** 上面几个内部读取器的再导出 —— 只给用例用（生产代码不必再读一遍原始 data）。 */
export const __paperInternals = { optionRows, entryRows, blankAnswer, marker };
