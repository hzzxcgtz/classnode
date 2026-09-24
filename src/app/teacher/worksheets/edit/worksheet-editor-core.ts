/**
 * 学习单编辑器的**纯函数内核**：不碰 React、不碰 DOM、不碰网络，只依赖类型。
 *
 * 🔴 **本文件不得出现 `@/…` 联名路径的运行时 import，也不得引 React / DOM。**
 * 这不是风格要求，而是下面这件事的前提：本仓没有前端测试框架（规格 §11），但
 * `node --test` 能直接执行本文件 —— Node 24 的类型擦除会把 `import type` 整段删掉，
 * 而**剩下那几行运行时 import 必须是 Node 也能解析的相对路径**（带 `.ts` 后缀，
 * 见下面从 `lib/worksheet-questions.ts` 转出的那几行）。联名路径 Node 解析不了，
 * 加一行就会让本文件的唯一回归网整个跑不起来。
 *
 * ```bash
 * node --test src/app/teacher/worksheets/edit/worksheet-editor-core.test.ts
 * ```
 *
 * 之所以值得为它划一条界线、单独成文件且可执行，是因为这里的东西**错了不报错**：
 * 题目 id 的稳定性、选项重编号后正确答案的去向、`undo` 的栈语义、草稿形状校验 ——
 * 这几处的错法既不抛异常也不让编译失败，只会让已经收上来的作答安静地错位
 * （规格 §3-P：答案按 `questionId` 关联，改序不能让已答数据错位）。
 * 改动本文件时，`worksheet-editor-core.test.ts` 是唯一的回归网。
 *
 * ⚠️ 本文件的内容是**同一份字节**：原样搬自 `use-worksheet-editor.ts`，不是照抄的第二份。
 * 那个文件现在从这里 import，并把这些符号**重新导出**（所以页面侧的 import 路径不用改）；
 * 解释设计取舍的注释也跟着搬了过来。
 */

import type { QuestionPointsDraft, WorksheetContent, WorksheetQuestionNode, WorksheetSettings } from '@/lib/types';
// 题型词汇表与「选项怎么读出来」的唯一一份在 `src/lib/worksheet-questions.ts`：
// 学生端的作答面板直接引它，本文件**转出**同一份（不是抄一份）—— 理由见那个文件的文件头。
// ⚠️ 相对路径 + `.ts` 后缀是**必须的**（Node 解析不了 `@/…`），见上面的文件头。
import {
  optionKey,
  POINTS_MAX,
  QUESTION_TYPE_OPTIONS,
  readOptions,
} from '../../../../lib/worksheet-questions.ts';
// 奖励形式的取值域、默认档与归一化函数也只有一份，在 `src/lib/worksheet-reward.ts`
// （学生端的奖励徽章与这里读的是同一份）。⚠️ 同样必须是相对路径 + `.ts` 后缀。
import {
  DEFAULT_HALF_STEP,
  DEFAULT_REWARD_STEP,
  DEFAULT_REWARD_STYLE,
  normalizeHalfStep,
  normalizeRewardStep,
  normalizeRewardStyle,
} from '../../../../lib/worksheet-reward.ts';
import type { ChoiceOption, QuestionType } from '../../../../lib/worksheet-questions.ts';

export { optionKey, POINTS_MAX, QUESTION_TYPE_OPTIONS, readOptions };
export type { ChoiceOption, QuestionPointsDraft, QuestionType };


/**
 * 题型。⚠️ 定义在 `src/lib/worksheet-questions.ts`（学生端与教师端共用一份），
 * 上面已转出。它是**服务端注册表**（`server/src/services/worksheet-questions.ts` 的
 * `QUESTION_TYPES`）在前端的投影，不是第二份权威。
 */

export const SCHEMA_VERSION = 1;

/**
 * 撤销栈上限。**每次改动一条**（包括每一次击键，见 `contentReducer` 的说明），
 * 200 条 ≈ 一次正常编辑会话的深度；再深只会让「撤销」要按很多下才回到想回的地方。
 */
export const HISTORY_LIMIT = 200;

/**
 * 单选题**由界面新建**的选项数上限 —— 由 `optionKey` 的值域（A–Z）决定，不是随手定的数。
 *
 * ⚠️ 它是「加号按不动了」的那条线，**不是**读一份既有内容时的硬顶：服务端对选项数
 * 不设上限（`validateQuestion` 只要求 `>= 2`），所以库里可能存在 26 个以上的题。
 * `writeOptions` 对超出部分**不丢弃**（见那里的说明），否则一份 30 选项的单子会在
 * 教师改任意一处选项时被悄悄砍掉 4 个。
 */
export const MAX_OPTIONS = 26;

/** 自动保存草稿的间隔（规格 §6.4：每 10 秒**或失焦**）。 */
export const DRAFT_INTERVAL_MS = 10_000;

// `ChoiceOption` / `optionKey` 定义在 `src/lib/worksheet-questions.ts`，上面已转出。

/**
 * 内容树的**唯一写入口**。
 *
 * 🔴 所有改动都经 reducer，**撤销栈才可能正确** —— 散落的 `setState` 的第一处
 * 就是 undo 开始漏的地方。本页因此没有第二个能改 `content` 的地方：
 * `grep -n 'setContent\|setHistory' src/app/teacher/worksheets/edit/` 应当只剩 reducer。
 *
 * ⚠️ **每次改动都进栈**（含每一次击键），刻意不做「合并连续输入」：
 * 合并会让「撤销」的粒度随时长变化（同样一段文字，打得慢和打得快撤销的行为不同），
 * 而逐次入栈的行为恰好与浏览器原生文本撤销一致。代价是栈深 200 只覆盖 200 次击键，
 * 这一点写在 `HISTORY_LIMIT` 上。
 *
 * `reset` 是列表里唯一一个**不进栈**的改动：它表示「换了一份学习单 / 恢复了草稿」，
 * 那是新的基线，不是可撤销的一步。
 */
export type ContentAction =
  | { kind: 'add'; questionType: QuestionType }
  | { kind: 'updatePrompt'; id: string; prompt: string }
  | { kind: 'updateData'; id: string; patch: Record<string, unknown> }
  | { kind: 'updatePoints'; id: string; points: QuestionPointsDraft | undefined }
  | { kind: 'move'; id: string; delta: -1 | 1 }
  | { kind: 'remove'; id: string }
  | { kind: 'reset'; content: WorksheetContent }
  | { kind: 'undo' }
  | { kind: 'redo' };

export interface EditorHistory {
  past: WorksheetContent[];
  present: WorksheetContent;
  future: WorksheetContent[];
}

export function createEmptyContent(): WorksheetContent {
  return { schemaVersion: SCHEMA_VERSION, nodes: [] };
}

export function createHistory(content: WorksheetContent): EditorHistory {
  return { past: [], present: content, future: [] };
}

/**
 * `crypto.randomUUID()` 只在**安全上下文**（https / localhost）里存在。
 * 教师端通常走 localhost，但本应用会把局域网地址印给学生 —— 教师若照那个
 * `http://192.168.x.x:4001` 打开教师端，`crypto.randomUUID` 就是 `undefined`。
 * 这里的 id 只需要在**一份学习单内**唯一（它是答案行的外键，作用域就是这棵树），
 * 不参与任何安全判定，所以退回随机串可以接受。
 */
function randomIdSuffix(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 一道新题。
 *
 * 🔴 题目 id 用 `crypto.randomUUID()` 生成**一次**，此后不随位置变化
 * （规格 §3-P：答案按 `questionId` 关联，改序不能让已答数据错位）。
 * 前缀 `q_` 与服务端补 id 时的形状（`routes/worksheets.ts` 的 `` `q_${crypto.randomUUID()}` ``）
 * 一致，所以「前端漏给 id、服务端补一个」这条支路产出的行与这里长得一样。
 *
 * ⚠️ 单选题的 `correctKeys` 默认是**空的**，不是 `['A']`：默认选中 A 会安静地把
 * 一道没配答案的题变成「所有选 A 的学生都对」。空数组会让保存时被服务端拦下并说清原因。
 */
export function newQuestion(type: QuestionType): WorksheetQuestionNode {
  const question: WorksheetQuestionNode = {
    id: `q_${randomIdSuffix()}`,
    type,
    prompt: '',
    // 规格 §3-V：第一批恒为 keyboard，字段先建好（手写输入不做 UI）。
    inputMode: 'keyboard',
    data: {},
    children: [],
  };
  if (type === 'single-choice') {
    question.data = {
      options: [{ key: optionKey(0), text: '' }, { key: optionKey(1), text: '' }],
      correctKeys: [],
    };
  } else if (type === 'fill-blank') {
    question.data = { answers: [] };
  }
  return question;
}

// `readOptions` 定义在 `src/lib/worksheet-questions.ts`，上面已转出（学生端渲染同一份
// `content` 的题面，读法必须只有一份）。

/**
 * 写回选项：**重新按位置编号**，并让正确答案跟着那道选项走。
 *
 * 🔴 这是本页最容易做错的一处。选项的 `key` 是学生答案里的值
 * （`{ format: 'choice/v1', selected: ['B'] }`），所以删掉「A」之后，
 * 原来的「B」必须变成「A」—— 否则学生会答一个不存在的选项。而正确答案若只按字母跟着变，
 * 就会从「光合作用」跳到「呼吸作用」上，**判分从此全错且没有任何报错**。
 * 所以：先把旧 key 映射到新位置，再用它翻译 `correctKeys`。
 *
 * 🔴 **超出 A–Z 的选项原样保留，不截断。** 服务端对选项数不设上限，所以库里可能存在
 * 26 个以上的题；在这里 `slice(0, MAX_OPTIONS)` 会把它们悄悄砍掉，而被砍掉的选项让
 * `correctKeys` 找不到映射 —— 于是「改一处选项文字」这一步会顺手删掉几个选项、
 * 并把正确答案清空，**没有任何报错**。保留下来只是 key 不再是单字母（`optionKey`
 * 的值域到 Z 为止，第 27 个起沿用原来的 key），而教师把选项删回 26 个以内时会自然
 * 重新编号回 A–Z。
 */
export function writeOptions(rawOptions: ChoiceOption[], correctKeys: unknown): { options: ChoiceOption[]; correctKeys: string[] } {
  const remap = new Map<string, string>();
  const options = rawOptions.map((option, index) => {
    // A–Z 之内按位置重编号；之外原样保留（不重编号、也不丢弃）。
    if (index >= MAX_OPTIONS) return option;
    const key = optionKey(index);
    remap.set(option.key, key);
    return { key, text: option.text };
  });
  // 超上限那些选项的 key 没有新旧之分（上面原样返回），翻译 `correctKeys` 时按原值放行。
  const keptKeys = new Set(options.slice(MAX_OPTIONS).map((option) => option.key));

  const previous = Array.isArray(correctKeys)
    ? correctKeys.filter((key): key is string => typeof key === 'string')
    : [];
  const translated: string[] = [];
  for (const key of previous) {
    const next = remap.get(key) ?? (keptKeys.has(key) ? key : undefined);
    if (next && !translated.includes(next)) translated.push(next);
  }
  // 单选：最多一个正确答案。多出来的（例如两道选项被手工合并到同一位置）截掉。
  return { options, correctKeys: translated.slice(0, 1) };
}

/** 填空题的「答案」textarea 值 ⇄ `data.answers`（规格 §3-R：一行一个可接受答案）。 */
export function readFillAnswers(node: WorksheetQuestionNode): string {
  const raw = node.data.answers;
  if (!Array.isArray(raw)) return '';
  return raw.filter((answer): answer is string => typeof answer === 'string').join('\n');
}

/** 反向的 `readFillAnswers`。**刻意保留空行**：textarea 的换行要靠它，往返才是无损的。 */
export function writeFillAnswers(text: string): string[] {
  return text.split('\n');
}

/**
 * 去掉一组可接受答案里的空行（非字符串元素也一并丢掉）。
 * 返回 `null` = **一个都没去掉**（调用方据此判断要不要造新对象）。
 */
function withoutEmptyAnswers(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const answers = raw.filter((answer): answer is string => typeof answer === 'string' && answer.trim().length > 0);
  return answers.length === raw.length ? null : answers;
}

/**
 * 保存前的最后一道清理：填空题的 `answers` 去掉空行（**单空与多空两种形状都清**）。
 *
 * 🔴 不清理的后果是**安静的满分**：`grade()` 用 `normalizeFillText` 比较，
 * 空串归一化之后还是空串 —— `answers: ['']` 会把学生的**空作答**判成正确，
 * 而且看板上会显示为「全班都对」。编辑期允许空行存在（textarea 的换行需要它），
 * 但**出网之前必须去掉**，唯一出网点是 `buildPayload()`。
 *
 * 🔴 **多空（M4a）的答案在第二层**：`data.blanks = [{ answers: […] }, …]`。
 * 只清 `data.answers` 的话，M3 修过的那个毛病会在新形状上**原样重现** ——
 * 而这次连「有没有清」都不会有人发现（单空那条路看起来还好好的）。
 * 两个形状的清法**必须是同一段代码**（`withoutEmptyAnswers`）。
 */
export function sanitizeContentForSave(content: WorksheetContent): WorksheetContent {
  let touched = false;
  const nodes = content.nodes.map((node) => {
    // ★ M4a：`points` 为 `undefined` 时**把键删掉**，而不是留一个 `{ points: undefined }`。
    //
    // 两种形状在 `JSON.stringify` 之后长得一样（`undefined` 的属性会被丢掉），所以这不是
    // 在修一个能观察到的 bug —— 它让「**没有 = 键不存在**」这条约定在**内存里**也成立
    // （服务端 `normalizeNode` 那句 `...(points ? { points } : {})` 就是按这条约定的写法）。
    // 留着一个值为 `undefined` 的键，下游任何一处 `'points' in node` 式的判断都会被它骗到。
    //
    // ⚠️ 半填（只填了一个字段）**原样保留**：`buildPayload` 的产物同时也是**草稿**的内容，
    // 丢掉它等于教师恢复草稿时屏幕上刚打的字消失。拦住半填出网的是 `save()` 里的
    // `findPartialPoints`，不是这里 —— 一个纯清理函数不该承担「拒绝保存」这件事。
    let current = node;
    if (current.points === undefined && 'points' in current) {
      const dropped: WorksheetQuestionNode = { ...current };
      delete dropped.points;
      current = dropped;
      touched = true;
    }
    if (current.type !== 'fill-blank') return current;
    const next: Record<string, unknown> = { ...current.data };
    let changed = false;

    const flat = withoutEmptyAnswers(next.answers);
    if (flat) { next.answers = flat; changed = true; }

    if (Array.isArray(next.blanks)) {
      let blanksChanged = false;
      const blanks = next.blanks.map((blank) => {
        if (!blank || typeof blank !== 'object' || Array.isArray(blank)) return blank;
        const cleaned = withoutEmptyAnswers((blank as Record<string, unknown>).answers);
        if (!cleaned) return blank;
        blanksChanged = true;
        return { ...(blank as Record<string, unknown>), answers: cleaned };
      });
      if (blanksChanged) { next.blanks = blanks; changed = true; }
    }

    if (!changed) return current;
    touched = true;
    return { ...current, data: next };
  });
  return touched ? { ...content, nodes } : content;
}

// ── 逐题分值（M4a，规格 §12 裁定 4 / 5）────────────────────────────────
//
// 这一组是**编辑器这一侧**的判据，服务端那三个函数（`normalizePointValue` /
// `normalizePoints` / `resolvePoints`）**不是**它们的对应物 —— 两边回答的是不同的问题：
//   · 服务端回答「这题**判分时**用哪两个数」（`resolvePoints`，只认落库后的形状）；
//   · 这里回答「教师**在屏幕上填了什么**、那个状态能不能保存」。
// ⚠️ 所以不要把一个搬到另一边去：服务端拿到的是**已经归一化过的** `points`，
// 那里不存在「半填」这个状态（`normalizePoints` 会把缺的那一端补成 `DEFAULT_POINTS`）。

/**
 * 输入框文本 → 分值。**三种结果必须分开**（`''` 与「填错了」不是一回事）：
 *   · `empty`   —— 空框。**这是一个有意义的取值**：留空 = 继承学习单级（裁定 4）。
 *   · `invalid` —— 填了东西但不是 `0..POINTS_MAX` 的整数。界面要**当场**提示，
 *     不能等到保存时才报 —— 服务端的 `normalizePointValue` 对越界值**回落** `DEFAULT_POINTS`，
 *     保存照常成功，教师会以为自己填的数生效了。
 *   · `value`   —— 合法。
 *
 * ⚠️ **不用 `Number()`**（那个想法很容易顺手写下去）：`Number('')` 与 `Number('   ')` 是 `0`
 * （空框会变成一个合法的 0 分）、`Number('0x10')` 是 16、`Number('1e2')` 是 100、
 * `Number('7.5')` 是 7.5 —— 每一个都会把一个「不是分值」的输入变成一个合法分值，
 * 而教师在框里看到的明明是自己打的那串字。所以只认纯十进制数字串。
 */
export type ParsedPointInput = { kind: 'empty' } | { kind: 'invalid' } | { kind: 'value'; value: number };

export function parsePointInput(raw: string): ParsedPointInput {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };
  if (!/^\d+$/.test(text)) return { kind: 'invalid' };
  const value = Number(text);
  if (value > POINTS_MAX) return { kind: 'invalid' };
  return { kind: 'value', value };
}

/**
 * 这道题的逐题分值是不是**只填了一个**（`{ full: 7 }` / `{ half: 2 }`）。
 *
 * 两个字段都填 = 已单独配分；两个都没填 = 跟随学习单级；**只有一个**是编辑期的中间态，
 * 而它**不是一个能保存的状态** —— 理由见 `findPartialPoints`。
 */
export function isPartialPoints(points: QuestionPointsDraft | undefined): boolean {
  if (!points) return false;
  return (points.full === undefined) !== (points.half === undefined);
}

/**
 * 逐题分值那两格的**文本签名** —— 「这段输入还是不是当前这一题、这两个值的样子」。
 *
 * 🔴 它存在的唯一理由是：编辑器允许屏幕上存在**还没进 reducer** 的文本
 * （教师打了一半、或打了一个非法值，见 `PointsRow` 的 `rejected`）。那段文本要能
 * ① 在 `node.points` 变化时自动失效（撤销 / 恢复草稿 / 换题），② 被 `save()` 看见。
 * 两处用**同一个**签名算法是 ② 不落空的前提 —— 各写一份就会「组件认为它还有效、
 * 而 `save()` 认为它已经失效」（或反过来），而两者都不会报错。
 */
export function pointsSignature(node: WorksheetQuestionNode): string {
  const full = node.points?.full === undefined ? '' : String(node.points.full);
  const half = node.points?.half === undefined ? '' : String(node.points.half);
  return `${node.id}:${full}/${half}`;
}

/** `points` 里那一格的文本（`undefined` ⇒ 空串 = 没填）。半填靠它渲染出来。 */
export function pointText(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

/**
 * 教师动了某一格之后该做什么 —— `PointsRow` 的 `onChange` 整个逻辑都在这里。
 *
 * 🔴 **它必须在内核里**（而不是留在组件里）：这条路上有两个「错了不报错」的坑，
 * 而组件没有回归网：
 *   1. 非法文本只记**刚动的那一格** ⇒ 另一格里还没提交的文本被 `node.points` 顶掉，
 *      教师没碰那个框、字却没了（2026-09-24 审查实测的原始 bug）；
 *   2. 合法时忘了把另一格的值一起算进来 ⇒ 半填 / 覆盖的次序一错，落库的值就与屏幕不符。
 * ⇒ 两格一起算、非法时**两格都记**，这里一条路走完。
 */
export function planPointInputChange(
  node: WorksheetQuestionNode,
  which: 'full' | 'half',
  raw: string,
  currentInput: RejectedPointInput | undefined,
): { kind: 'rejected'; input: RejectedPointInput } | { kind: 'commit'; points: QuestionPointsDraft | undefined } {
  const signature = pointsSignature(node);
  // 签名不匹配 ⇒ 那段输入是上一份内容留下的，已经作废（撤销 / 恢复草稿 / 换题之后）。
  const shown = currentInput && currentInput.signature === signature ? currentInput : undefined;
  const nextFull = which === 'full' ? raw : (shown?.full ?? pointText(node.points?.full));
  const nextHalf = which === 'half' ? raw : (shown?.half ?? pointText(node.points?.half));

  const full = parsePointInput(nextFull);
  const half = parsePointInput(nextHalf);
  if (full.kind === 'invalid' || half.kind === 'invalid') {
    // 🔴 **两格都记**，不只是刚动的那一格 —— 见上面的坑 1。
    return { kind: 'rejected', input: { signature, full: nextFull, half: nextHalf } };
  }

  // ⚠️ 半填要**如实**交出去（不能因为「另一端还没填」就不提交）—— 否则教师刚打的那个字
  // 会被下一次渲染吞掉（输入框的值是从 `node.points` 算出来的）。
  const points: QuestionPointsDraft = {};
  if (full.kind === 'value') points.full = full.value;
  if (half.kind === 'value') points.half = half.value;
  return {
    kind: 'commit',
    points: points.full === undefined && points.half === undefined ? undefined : points,
  };
}

/** 屏幕上**还没进 reducer** 的那两格文本（按题 id 存）。`undefined` 的字段 = 那一格没被拒过。 */
export interface RejectedPointInput {
  /** `pointsSignature(node)` 在当时的值 —— 不匹配就整条失效。 */
  signature: string;
  full?: string;
  half?: string;
}

/** 哪一格。`both` 只在拼文案时用得上。 */
export type PointField = 'full' | 'half' | 'both';

export function describeWhich(which: PointField): string {
  if (which === 'both') return '全对与半对';
  return which === 'full' ? '全对' : '半对';
}

/** 把 `Array<{index, which}>` 拼成「第 2 题的全对、第 5 题的全对与半对」。 */
export function describePoints(items: Array<{ index: number; which: PointField }>): string {
  return items.map((item) => `第 ${item.index + 1} 题的${describeWhich(item.which)}`).join('、');
}

/**
 * 这个数**能不能当分值落库**（编辑期的判据）。
 *
 * 🔴 它比服务端的 `isUsablePointValue` **更严**，这个差异是**有意的**，别「统一」：
 *   · 服务端那个用 `Math.round`，所以 `7.5` 算有效（⇒ 8）—— 它的入参是**库里的 JSON**，
 *     可能来自手工改过的行或将来的批量工具；
 *   · 这里要求**整数**，因为输入框那一侧的判据（`parsePointInput`）就不接受小数 ——
 *     让一个屏幕上根本打不出来的值悄悄落库，等于界面与服务端两套规则。
 */
function isValidPointNumber(value: number | undefined): boolean {
  if (value === undefined) return true;
  return Number.isInteger(value) && value >= 0 && value <= POINTS_MAX;
}

/**
 * 🔴 **`points` 里已经有一个不是 0–99 整数的值**的题（顶层）—— 与 `findPartialPoints`
 * 并列，由 `save()` 拦下。
 *
 * 它拦的是**库里那一份**（`content`）。编辑器的输入路径产生不了这种值
 * （`parsePointInput` 会把小数 / 越界 / 十六进制都拒掉），所以命中它的只有**手工改过的库行**。
 *
 * ⚠️ 不拦的后果是**静默改写**：服务端的 `normalizePointValue` 对越界值**回落**
 * `DEFAULT_POINTS`（`full: 200` ⇒ `1`），保存照常 200，而卡片上还写着 200 ——
 * 教师没有任何办法知道他的分数已经变成了 1。
 *
 * ⚠️ 与 `findPartialPoints` 一样**只看顶层**（嵌套里的题教师看不见也改不了，
 * 拦了会让保存按钮废掉）。
 */
export function findInvalidPoints(content: WorksheetContent): Array<{ id: string; index: number; which: PointField }> {
  const found: Array<{ id: string; index: number; which: PointField }> = [];
  content.nodes.forEach((node, index) => {
    const points = node.points;
    if (!points) return;
    const fullBad = !isValidPointNumber(points.full);
    const halfBad = !isValidPointNumber(points.half);
    if (!fullBad && !halfBad) return;
    found.push({ id: node.id, index, which: fullBad && halfBad ? 'both' : fullBad ? 'full' : 'half' });
  });
  return found;
}

/**
 * 🔴 **屏幕上有一段还没进 reducer 的非法文本**的题 —— `save()` 的第三条拦阻。
 *
 * 为什么必须有它（2026-09-24 审查实机复现）：教师把全对填成 `7.5`，框里**明明白白写着
 * `7.5`**，那串字却因为非法而没进 reducer（`points` 只装整数）⇒ 点保存发出的是**上一次的
 * 合法值** `4` ⇒ 顶栏显示「已保存」，而框里还是 `7.5`。**界面在说假话，且没有任何报错。**
 *
 * ⇒ 只提示是不够的（brief Step 1 的「非整数即时提示」讲的是**不要拖到保存才报**，
 * 不是「不许拦」）。所以：**没提交的非法文本同样拦住保存。**
 *
 * ⚠️ 判据要连签名一起比：`rejected` 里那一段文本只有在 **`signature` 仍然等于当前节点**
 * 时才作数 —— 撤销 / 恢复草稿 / 换题之后 `node.points` 会变，那串文本就作废了
 * （否则教师撤销之后还会被一段早已不存在的文本拦住）。
 *
 * ⚠️ `rejected` 里**合法的**那一格不构成拦阻：教师可能在全对留着一格非法文本的同时
 * 把半对改成了合法值，而那一格只在整题提交时才有意义（见 `PointsRow` 的 `commit`）。
 */
export function findUncommittedPointInput(
  content: WorksheetContent,
  rejected: Record<string, RejectedPointInput>,
): Array<{ id: string; index: number; which: PointField }> {
  const found: Array<{ id: string; index: number; which: PointField }> = [];
  content.nodes.forEach((node, index) => {
    const entry = rejected[node.id];
    if (!entry || entry.signature !== pointsSignature(node)) return;
    const fullBad = entry.full !== undefined && parsePointInput(entry.full).kind === 'invalid';
    const halfBad = entry.half !== undefined && parsePointInput(entry.half).kind === 'invalid';
    if (!fullBad && !halfBad) return;
    found.push({ id: node.id, index, which: fullBad && halfBad ? 'both' : fullBad ? 'full' : 'half' });
  });
  return found;
}

/**
 * 🔴 **只填了一个框**的题（顶层，按题目顺序）—— `save()` 用它拦下保存。
 *
 * 为什么必须拦（2026-09-24 实测，A2 审查带出）：服务端的 `normalizePoints` 对
 * 「只填了一端」的处理是**用 `DEFAULT_POINTS` 补另一端**（全对 1 / 半对 0），
 * **不是**用学习单级的档。于是「学习单级 `{full:3, half:2}` + 这道题 `points:{full:7}`」
 * 在判分时半对得 **0 分**，而教师以为自己只是把全对调成了 7、半对还在跟随学习单。
 *
 * 实测（隔离库 + 真实 `POST /api/worksheets`，载荷 `points: {full: 7}`）：
 * 回包与库里的都是 `points: {full: 7, half: 0}` —— **`half` 被补齐成了 0，不是缺席**。
 * ⇒ 「改 `resolvePoints` 为逐字段回落」那条路**修不了这个**：库里那个 `half: 0` 是一个
 * 有效分值，逐字段回落会照用它。**这才是这里必须拦、而不是去改判分的原因。**
 *
 * ⚠️ **只看顶层 `nodes`**：编辑器的题流只渲染顶层（第一批没有容器编辑 UI，规格 §4.3），
 * 嵌套 `children` 里的题教师**看不见也改不了** —— 对它拦下保存会让教师卡死在一个
 * 无法修复的错误上。手工改过的库行若在嵌套里带了半填的 `points`，它的后果与「没配过」
 * 一致（服务端补 0），属于第一批的已知边界。
 *
 * 返回的下标是**数组下标（0-based）**；调用方要拼「第 N 题」时自己 +1（界面上的题号是 1-based）。
 */
export function findPartialPoints(content: WorksheetContent): Array<{ id: string; index: number }> {
  const found: Array<{ id: string; index: number }> = [];
  content.nodes.forEach((node, index) => {
    if (isPartialPoints(node.points)) found.push({ id: node.id, index });
  });
  return found;
}

/**
 * 这道题**实际会用到的半对档**；`null` = **说不准**（调用方据此不判断）。
 *
 * 只有两种情形说得准（能保存的状态下）：
 *   · 逐题填了（两端齐全）⇒ 用它那个数；
 *   · 逐题留空（或 `{}` —— 服务端 `normalizePoints({})` 也回 `undefined`，同义）⇒ 用学习单级的。
 */
function effectiveHalfStep(
  node: WorksheetQuestionNode,
  inherited: { full: number; half: number },
): number | null {
  const points = node.points;
  // ⚠️ **半填（只填了一个字段）⇒ 说不准**，`{ half: 0 }` 与 `{ full: 7 }` 都算。
  // 2026-09-24 修：这里原来只挡住了「半对为空」那一半（`points.half === undefined`），
  // 于是 `{ half: 0 }` 会走下面那一支算出 0 ⇒ 返回 true，与本函数文档说的「半填不判断」
  // 矛盾。今天够不着（编辑器还写不出多选），但 C2 补上多选编辑体之后，
  // 教师在多选卡上先填半对 0、还没填全对时，同一张卡会同时挂两条红字 ——
  // 正是 `shouldWarnZeroHalfCredit` 要避免的情形。
  if (points && isPartialPoints(points)) return null;
  if (!points || points.half === undefined) return inherited.half;
  return points.half;
}

/**
 * 🔴 规格 §12 裁定 3 的**连带要求**：教师给多选题选了「漏选算半对」、而半对档是 **0** 时，
 * 界面必须说一句 —— 否则他以为自己开了部分得分，而学生**一分都拿不到**，且没有任何报错。
 *
 * 判据是「**这题实际会用到的半对档**」（`effectiveHalfStep`）。
 *
 * ⚠️ **半填时返回 `false`（不提示）**，`{ full: 7 }` 与 `{ half: 0 }` **都是**：半填的题
 * 已经被 `findPartialPoints` 拦下、根本存不进去，而它自己那条「两个框要么都填」的提示
 * 更靠前 —— 一张卡片上同时挂两条红字只会让教师不知道先看哪条。（也正因为如此，这里
 * **不**去模拟服务端「半填补 0」的行为：那要再抄一份 `DEFAULT_POINTS`，而它在这条路上
 * 永远不会被用到。）
 */
export function shouldWarnZeroHalfCredit(
  node: WorksheetQuestionNode,
  inherited: { full: number; half: number },
): boolean {
  if (node.type !== 'multi-choice') return false;
  if (node.data.partialCredit !== 'allow-missing') return false;
  return effectiveHalfStep(node, inherited) === 0;
}

/** 顶层题目列表里替换一道题。没命中就**返回原对象**，免得制造一条空的历史。 */
function replaceNode(
  content: WorksheetContent,
  id: string,
  transform: (node: WorksheetQuestionNode) => WorksheetQuestionNode,
): WorksheetContent {
  let touched = false;
  const nodes = content.nodes.map((node) => {
    if (node.id !== id) return node;
    const next = transform(node);
    if (next !== node) touched = true;
    return next;
  });
  return touched ? { ...content, nodes } : content;
}

/**
 * 编辑动作的实际计算。
 *
 * ⚠️ 只动**顶层** `nodes`，递归的 `children` 原样保留（`{...node}` 会带上它）。
 * 第一批没有容器编辑 UI（规格 §4.3），所以不需要递归；将来加容器时，
 * 「改一道顶层题」仍然应当整棵子树照搬。
 */
function applyEdit(content: WorksheetContent, action: ContentAction): WorksheetContent {
  switch (action.kind) {
    case 'add':
      return { ...content, nodes: [...content.nodes, newQuestion(action.questionType)] };

    case 'updatePrompt':
      return replaceNode(content, action.id, (node) => (
        node.prompt === action.prompt ? node : { ...node, prompt: action.prompt }
      ));

    case 'updateData':
      // 与 `updatePrompt` 同一条规矩：补丁里每个键的值都与现值相同时返回原对象，
      // 否则 `replaceNode` 会无条件造一个新对象，于是一次「按下去什么也没发生」的
      // 动作也会占掉一格撤销栈 —— 教师按撤销时看到屏幕纹丝不动，只能再按一次。
      // 空补丁同理（`every` 对空数组为真）。
      //
      // ⚠️ 比较是**逐个键的 `===`**（与 `updatePrompt` 逐字同形），不递归比较内容：
      // 补丁里的 `options` / `correctKeys` 每次都是新造的数组，按引用比必然不同，
      // 所以它们照常进栈。刻意不做深比较 —— 深比较遇上「就地改了数组再交进来」
      // 会把**真的变化**判成没变，那比多一格撤销严重得多。
      return replaceNode(content, action.id, (node) => {
        const keys = Object.keys(action.patch);
        if (keys.every((key) => node.data[key] === action.patch[key])) return node;
        return { ...node, data: { ...node.data, ...action.patch } };
      });

    case 'updatePoints':
      // 与 `updatePrompt` / `updateData` 走**同一条**路（进撤销栈、同值去重）——
      // 散落的 `setState` 是 undo 开始漏的第一处，这条纪律在本文件头与
      // `ContentAction` 上各写了一遍，这里是它的第三个使用者。
      //
      // ⚠️ 比较是**逐字段的 `===`**：两个框各自的每一次击键都该进栈（与 `updatePrompt`
      // 逐字同形），但「重新赋成同一对值」（例如失焦时又提交了一次）不该占掉一格撤销 ——
      // 否则教师按撤销时屏幕纹丝不动，只能再按一次。
      //
      // ⚠️ `points` 允许**半填**（`{ full: 7 }`，另一个框还空着）：那是屏幕上真实存在的
      // 一瞬间状态，受控输入框要靠它渲染。拦住它出网的是 `save()` 里的 `findPartialPoints`，
      // 不是这里 —— reducer 只负责如实记录教师在屏幕上做了什么。
      return replaceNode(content, action.id, (node) => {
        const current = node.points;
        const next = action.points;
        if (current === undefined && next === undefined) return node;
        if (current && next && current.full === next.full && current.half === next.half) return node;
        return { ...node, points: next };
      });

    case 'move': {
      const index = content.nodes.findIndex((node) => node.id === action.id);
      const target = index + action.delta;
      // 越界 ⇒ 原样返回（不制造历史）：第一题按 ▲ 或最后一题按 ▼ 不该占掉一次撤销。
      if (index < 0 || target < 0 || target >= content.nodes.length) return content;
      const nodes = content.nodes.slice();
      const swapped = nodes[index];
      nodes[index] = nodes[target];
      nodes[target] = swapped;
      return { ...content, nodes };
    }

    case 'remove': {
      const nodes = content.nodes.filter((node) => node.id !== action.id);
      return nodes.length === content.nodes.length ? content : { ...content, nodes };
    }

    default:
      // undo / redo / reset 在 `contentReducer` 里各自处理，到不了这里。
      return content;
  }
}

export function contentReducer(state: EditorHistory, action: ContentAction): EditorHistory {
  switch (action.kind) {
    case 'undo': {
      if (state.past.length === 0) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
      };
    }

    case 'redo': {
      if (state.future.length === 0) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
      };
    }

    case 'reset':
      return createHistory(action.content);

    default: {
      const present = applyEdit(state.present, action);
      // 没有实际变化（例如题干被重新赋成同一个值）⇒ 状态原样返回，不进栈。
      if (present === state.present) return state;
      return {
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present,
        // 新的改动让「重做」这条线失效。
        future: [],
      };
    }
  }
}

/** 保存载荷。**这里就是 sanitize 的唯一调用点**（见 `sanitizeContentForSave`）。 */
export interface WorksheetPayload {
  title: string;
  description: string | null;
  settings: WorksheetSettings;
  content: WorksheetContent;
}

export function buildPayload(
  title: string,
  description: string,
  settings: WorksheetSettings,
  content: WorksheetContent,
): WorksheetPayload {
  return {
    // 与服务端 `readTitle` / `readDescription` 同一套归一化（trim + 空串归 null）。
    // 前端先做一遍，是为了让「保存后的本地状态」与「库里的状态」逐字相同 ——
    // 否则 `dirty` 判据会在保存成功后仍然为真（一个永远擦不掉的「未保存」标记）。
    title: title.trim(),
    description: description.trim() || null,
    settings,
    content: sanitizeContentForSave(content),
  };
}

export const DEFAULT_SETTINGS: WorksheetSettings = {
  allowResubmit: true,
  autoGrade: true,
  defaultInputMode: 'keyboard',
  // 奖励形式（规格 §9.2）：学习单级配置，默认「星星 ⭐、每答对一题 1 个」——
  // 依据（§9.2 的图里 ● 打在星星上、§8.2 的学生端版式图顶栏画着 `⭐×3`）写在
  // `worksheet-reward.ts` 的 `DEFAULT_REWARD_STYLE` 上。**两处必须是同一对默认值**：
  // 这里决定「新建的学习单长什么样」，服务端 `normalizeSettings` 决定「缺字段的行
  // 长什么样」，不一致的话新建出来与学生看到的就是两回事。
  rewardStyle: DEFAULT_REWARD_STYLE,
  rewardStep: DEFAULT_REWARD_STEP,
  // 半对档默认 **0**（规格 §12 裁定 3：新单默认「全对 1 / 半对 0」，与第一批行为逐字相同）。
  // ⚠️ 用 `DEFAULT_HALF_STEP` 而**不是** `DEFAULT_REWARD_STEP`：两者刚好是 0 与 1，
  // 写错了不会报错，只会让每一张新建的学习单都悄悄变成「半对也给 1」。
  halfStep: DEFAULT_HALF_STEP,
};

/**
 * 草稿（规格 §3-Y：**只写 localStorage，不写服务端**）。
 * `content` 存的是编辑期原样（含填空题的换行），恢复时才能一模一样地回到屏幕上。
 */
export interface WorksheetDraft {
  savedAt: number;
  title: string;
  description: string;
  settings: WorksheetSettings;
  content: WorksheetContent;
}

export function draftKeyFor(worksheetId: string | null): string {
  return `worksheet-draft:${worksheetId ?? 'new'}`;
}

/**
 * 一个节点**能不能当题目用**。这是 `parseDraft` 与 `normalizeLoadedContent` 共用的守卫。
 *
 * 🔴 `data` 必须一起查：`readOptions` 读 `node.data.options`、`readFillAnswers` 读
 * `node.data.answers`，两处都是**直接解引用**。只查 `id`/`type` 的话，一份缺 `data`
 * 的草稿会整份通过这道守卫，然后在第一次渲染时抛 TypeError —— 编辑页白屏，
 * 而那正是这两处的注释承诺过「形状不对就整份作废」要挡掉的结果。
 */
function isQuestionNode(value: unknown): value is WorksheetQuestionNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const node = value as Record<string, unknown>;
  if (typeof node.id !== 'string' || node.id.length === 0 || typeof node.type !== 'string') return false;
  return Boolean(node.data) && typeof node.data === 'object' && !Array.isArray(node.data);
}

/**
 * 解析草稿。**localStorage 里的东西是外部输入**：可能是上一个版本写的、可能被人手改过、
 * 也可能是别的应用写的。形状不对就整份作废 —— 半个草稿比没有草稿更危险。
 */
export function parseDraft(raw: string | null): WorksheetDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const draft = parsed as Record<string, unknown>;
  if (typeof draft.savedAt !== 'number' || !Number.isFinite(draft.savedAt)) return null;
  if (typeof draft.title !== 'string' || typeof draft.description !== 'string') return null;
  if (!draft.settings || typeof draft.settings !== 'object' || Array.isArray(draft.settings)) return null;
  if (!draft.content || typeof draft.content !== 'object' || Array.isArray(draft.content)) return null;
  const nodes = (draft.content as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes) || !nodes.every(isQuestionNode)) return null;

  const settings = draft.settings as Record<string, unknown>;
  const content = draft.content as WorksheetContent;
  return {
    savedAt: draft.savedAt,
    title: draft.title,
    description: draft.description,
    settings: {
      allowResubmit: settings.allowResubmit !== false,
      autoGrade: settings.autoGrade !== false,
      defaultInputMode: settings.defaultInputMode === 'handwriting' ? 'handwriting' : 'keyboard',
      // 奖励三项与 `normalizeLoadedSettings` 走的是**同一对**归一化函数（不是各写一遍：
      // 草稿来自 localStorage、详情来自服务端，两边的判据分叉会让「恢复草稿」与
      // 「打开已保存的单」给出不同的奖励档）。
      // ⚠️ 半对档用 `normalizeHalfStep` 而**不是** `normalizeRewardStep` —— 后者的域
      // 不含 0，会把「半对 0」变成 1（理由写在 `HALF_STEPS` 上）。
      rewardStyle: normalizeRewardStyle(settings.rewardStyle),
      rewardStep: normalizeRewardStep(settings.rewardStep),
      halfStep: normalizeHalfStep(settings.halfStep),
    },
    content: { schemaVersion: typeof content.schemaVersion === 'number' ? content.schemaVersion : SCHEMA_VERSION, nodes },
  };
}

/**
 * 服务端 `normalizeNode` 保证了下发形状，这里只兜一层「这棵树不可用」的情况：
 * 手改过的库行不该让整个编辑页白屏。
 *
 * ⚠️ 逐题过 `isQuestionNode`，用的是与 `parseDraft` **同一道**守卫 —— 两处各写一份
 * 「差不多」的判据，就是漏掉 `data` 那一处的地方（见 `isQuestionNode` 的说明）。
 */
export function normalizeLoadedContent(content: unknown): WorksheetContent {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return createEmptyContent();
  const nodes = (content as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) return createEmptyContent();
  const schemaVersion = (content as Record<string, unknown>).schemaVersion;
  return {
    schemaVersion: typeof schemaVersion === 'number' ? schemaVersion : SCHEMA_VERSION,
    nodes: nodes.filter(isQuestionNode),
  };
}

export function normalizeLoadedSettings(raw: unknown): WorksheetSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_SETTINGS;
  const settings = raw as Record<string, unknown>;
  return {
    allowResubmit: settings.allowResubmit !== false,
    autoGrade: settings.autoGrade !== false,
    defaultInputMode: settings.defaultInputMode === 'handwriting' ? 'handwriting' : 'keyboard',
    // ⚠️ 这三项**必须**原样带过来，哪怕是本编辑器没有 UI 的旧字段：编辑页保存时是把
    // `settings` 整份发回去的（`buildPayload`），漏掉一个键就等于用默认值覆盖了库里的设置
    // —— 一次「只改了个标题」的保存会把教师配好的奖励形式悄悄改回星星。
    // ★ M4a：`halfStep` 就是靠这条规则才活下来的那一类键 —— 服务端的 `normalizeSettings`
    // 认它、`readStudentSettings` 下发它，但**只要这里漏一层**，教师保存一次就没了。
    rewardStyle: normalizeRewardStyle(settings.rewardStyle),
    rewardStep: normalizeRewardStep(settings.rewardStep),
    halfStep: normalizeHalfStep(settings.halfStep),
  };
}
