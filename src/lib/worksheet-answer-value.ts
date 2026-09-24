import type { WorksheetQuestionNode } from './types';

/**
 * 学习单的**作答值形状**与**它到界面输入态的双向转换** —— 8 个题型，全项目唯一一份。
 *
 * 🔴 它从 `worksheet-questions.ts` 里**搬出来**（M4a/D1），不是新起的一份：那个文件是
 * 「题型词汇表」，而这个文件是「作答的形状」。分开的理由只有一个，但它是硬的 ——
 * 这里要读题目 `data` 里的条目（`items` / `left` / `right` / `zones` / `blanks`），
 * 而 `worksheet-questions.ts` 要**转出**本文件（学生端面板与教师端预览都从那个路径取）。
 * 放在同一个文件里就会变成一个自我引用，所以依赖是**单向**的：
 * `worksheet-questions.ts` → 本文件 → `./types`（只读类型，类型擦除会整段删掉）。
 *
 * 与 `worksheet-questions.ts` 同一条纪律：
 *   · **不引任何 React / DOM，也不引任何联名路径（`@/…`）** —— 它要能被 `node --test`
 *     直接执行（Node 24 的类型擦除），所以两个测试文件（`worksheet-answer-value.test.ts`、
 *     `worksheet-drag.test.ts`）能真的跑到这些判据；
 *   · `import type` 是**唯一**的 import 形态；
 *   · 本文件在 `scripts/check-classroom-browser-compat.mjs` 的扫描根（`src/lib`）内：
 *     不得出现 `Object.hasOwn` / `structuredClone` / `findLast` / `.at(` / `:has(` /
 *     `@container` / `content-visibility` / `color-mix(`（学生端跑在 Safari 15 的老 iPad 上）。
 *
 * ⚠️ 本文件里每一个函数都是**渲染路径**上的东西：一次 TypeError 会让整个学生端面板白屏，
 * 而白屏的学生会以为「老师没布置」。所以「坏形状」一律收成空态 / `null`，**不抛**。
 */

/**
 * 提交给服务端的**作答值**（规格 §4.3）。
 *
 * 🔴 **协议是「判分器读哪些字段名」，不是 `format` 串。** 服务端的 `grade()` 按
 * **`node.type`** 分派（`server/src/services/worksheet-questions.ts` 的 `JUDGES`），
 * 再从**作答值里按字段名**取值 —— 各题型读的是：
 *
 * | 作答值的键 | 谁读 |
 * |---|---|
 * | `selected: string[]` | 单选 / 判断 / 多选 |
 * | `text: string` | 单空填空（`data.blanks` 不存在的那一种） |
 * | `texts: string[]` | 多空填空（与教师的 `data.blanks` 逐位对应） |
 * | `order: string[]` | 排序 |
 * | `links: Array<{leftId, rightId}>` | 连线（教师那侧的配对叫 `pairs`，**刻意不同名**） |
 * | `assignment: Record<string, string>` | 归类（教师那侧叫 `placement`） |
 *
 * ⚠️ **`format` 服务端一个字节都不读。** 实测（2026-09-24）：
 * `grep -c format server/src/services/worksheet-questions.ts` ⇒ `0`；
 * `grep -rn "\.format\b\|'format'\|\"format\"" server/src`（排除 tests）⇒ 无输出。
 * 它只随作答值一起存进 `WorksheetAnswer.value`，读者是**前端**的 `draftFromValue`
 * （把作答值读回输入态：学生端队列回填、教师端抽屉的「原答案」都走它）。
 *
 * ⇒ 两个方向不要写反：
 *   · 改**上表里那些字段名**才是改协议，而且**错了不报错** —— 那道题永远判错/判不了分；
 *   · 改 `format` 串只影响 `draftFromValue` 读不读得回输入态（读不回的后果是画成空白作答）。
 * 🔴 **不得**为了「让 `format` 名副其实」去给服务端补一条格式校验：那会让库里已有的行
 * 与旧客户端**静默不判分**（判分器本来只认字段名，多一道校验就多一道拒绝的理由）。
 *
 * 🔴 **`links` / `assignment` 这两个键名是已下的裁定（2026-09-23），不是命名口味。**
 * `ANSWER_KEYS`（`server/src/services/worksheet-questions.ts:245`）里也有 `pairs` /
 * `placement`，但那指的是**教师的正确答案**（在题目 `data` 里，必须被 `stripAnswers` 剥掉、
 * 绝不能下发）；而这里同名的那两个键是**学生自己写的作答**（必须原样保留、要回显给教师看）。
 * 同一个键名承担两个相反的判据 ⇒ 任何「响应里不得出现答案键」的扫描会把「学生连线答对了」
 * 读成「答案泄漏」，而且**方向是漏判与误判都有**：误判会拦下合法数据，漏判会放走真泄漏。
 * ⇒ 学生这一侧改名，教师那侧的 `data` 键名不动（两条红线用例逐字钉着它）。
 *
 * ⚠️ 手写与绘图（`ink/v1` / `drawing/v1`）**第一批不产生**，所以这个联合里没有它们 ——
 * 第一批的 UI 也不提供产生它们的路径（`buildAnswerValue` 对未知题型回 `null`）。
 */
export type WorksheetAnswerValue =
  | { format: 'choice/v1'; selected: string[] }
  | { format: 'fill/v1'; text: string }
  | { format: 'fill-multi/v1'; texts: string[] }
  | { format: 'text/v1'; text: string }
  | { format: 'order/v1'; order: string[] }
  | { format: 'match/v1'; links: Array<{ leftId: string; rightId: string }> }
  | { format: 'categorize/v1'; assignment: Record<string, string> };

/**
 * 界面上**一道题的输入态**（还没变成作答值）。
 *
 * 判别属性是 `kind`（题型家族），**不是 `node.type`** —— 判断题与单选共用 `choice`
 * （作答值与判分逐字相同，规格 §12）、单空填空与多空填空共用 `fill`（区别只在 `texts` 的
 * 长度，由题目的 `data.blanks` 决定）。合成一份的理由与「两种题型互斥」有关：
 * 一道题是哪一种由 `node.type` 决定，拆成两个状态容器只会让「哪道题现在是哪种」多一处
 * 需要同步的地方。
 *
 * ⚠️ 与 `WorksheetAnswerValue` **刻意不同形**：输入态是**屏幕上此刻的东西**（单选是
 * 一个 key、多空填空是一列框、排序是一列 id），而作答值是**判分器读得懂的东西**。
 * 两者之间只有 `buildAnswerValue` / `draftFromValue` 这一对转换函数，别在组件里各写一遍。
 */
export type AnswerDraft =
  | { kind: 'choice'; selected: string[] }
  | { kind: 'fill'; texts: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'order'; order: string[] }
  | { kind: 'match'; links: Array<{ leftId: string; rightId: string }> }
  | { kind: 'categorize'; assignment: Record<string, string> };

/**
 * 条目文本的键名：`items` / `left` / `right` 用 `text`，`zones` 用 `label`。
 *
 * ⚠️ 服务端的 `readItemIds`（只读 id）与编辑器内核的 `EntryTextField` 读的是**同一对键名**。
 * 三处各写一份就会出现「教师填的字在学生端画不出来」，而它不报错 —— 所以这里写死一份，
 * 由测试逐条钉住（`worksheet-answer-value.test.ts`）。
 */
export type EntryTextField = 'text' | 'label';

/** 一道题里的一个可作答条目（排序的条目 / 连线的一栏 / 归类的一个条目或一个框）。 */
export interface WorksheetEntry {
  id: string;
  text: string;
}

/**
 * 读一串条目（`{ id, text }` / `{ id, label }`）。
 *
 * **容错**：`data` 来自库里的 JSON，任何手改过的行都可能不是数组、元素也可能缺 id。
 * 缺 id 的条目**丢掉**而不是补一个下标 id —— 学生的作答值按 id 索引，补出来的 id
 * 与服务端 `correctOrder` / `pairs` / `placement` 里那个 id 对不上，那道题就永远判错，
 * 而屏幕上看起来一切正常。（服务端那一侧由 `validateQuestion` 在保存时拦下，这里是读的一侧。）
 */
export function readEntries(raw: unknown, field: EntryTextField): WorksheetEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: WorksheetEntry[] = [];
  raw.forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const row = item as Record<string, unknown>;
    const id = row.id;
    if (typeof id !== 'string' || !id) return;
    const text = row[field];
    entries.push({ id, text: typeof text === 'string' ? text : '' });
  });
  return entries;
}

/** 排序题的条目（`data.items`）—— **这是学生看到的顺序**，不是正确顺序。 */
export function readOrderItems(node: WorksheetQuestionNode): WorksheetEntry[] {
  return readEntries(node.data.items, 'text');
}

/** 连线题的左栏（`data.left`）。 */
export function readMatchLeft(node: WorksheetQuestionNode): WorksheetEntry[] {
  return readEntries(node.data.left, 'text');
}

/** 连线题的右栏（`data.right`）。 */
export function readMatchRight(node: WorksheetQuestionNode): WorksheetEntry[] {
  return readEntries(node.data.right, 'text');
}

/** 归类题的条目池（`data.items`）。 */
export function readCategorizeItems(node: WorksheetQuestionNode): WorksheetEntry[] {
  return readEntries(node.data.items, 'text');
}

/** 归类题的框（`data.zones`）。⚠️ 文本键名是 `label`。 */
export function readCategorizeZones(node: WorksheetQuestionNode): WorksheetEntry[] {
  return readEntries(node.data.zones, 'label');
}

/**
 * 这道填空题是**多空**形状吗。
 *
 * 🔴 判据与服务端 `judgeFillBlank` / `VALIDATORS` 逐字相同：**`Array.isArray(data.blanks)`
 * 在不在**。两处用不同的判据会让一道题「校验时按多空、判分时按单空」，而它只表现为
 * 分数不对 —— 没有异常、没有日志。第一批落库的填空题一个 `blanks` 都没有，
 * 所以那个分支**不是**历史包袱，它是「单空」这个形状本身。
 */
export function isMultiBlank(node: WorksheetQuestionNode): boolean {
  return Array.isArray(node.data.blanks);
}

/**
 * 这道填空题有几个空。单空（没有 `blanks`）恒为 **1**。
 *
 * ⚠️ 多空形状下 `blanks: []`（教师建了题但一个空都没填）返回 **0** —— 界面上一行都没有，
 * 与服务端判分（空数组 ⇒ `incorrect`）对齐。别在这里「至少给一个」：那会画出一个
 * 服务端根本不看的输入框，学生填了也不会有分。
 */
export function readBlankCount(node: WorksheetQuestionNode): number {
  if (!isMultiBlank(node)) return 1;
  const blanks = node.data.blanks;
  return Array.isArray(blanks) ? blanks.length : 0;
}

/** 一串非空字符串（丢别的元素）。用于从作答值里读 `selected` / `order`。 */
function readStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && !!item);
}

/** `id → 非空字符串` 的映射（归类题的作答）。坏值丢掉。 */
function readStringMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  Object.keys(raw).forEach((key) => {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'string' && value) out[key] = value;
  });
  return out;
}

/** 读作答值里的连线（`Array<{leftId, rightId}>`），形状不全的条目丢掉。 */
function readLinks(raw: unknown): Array<{ leftId: string; rightId: string }> {
  if (!Array.isArray(raw)) return [];
  const links: Array<{ leftId: string; rightId: string }> = [];
  raw.forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const row = item as Record<string, unknown>;
    if (typeof row.leftId === 'string' && row.leftId && typeof row.rightId === 'string' && row.rightId) {
      links.push({ leftId: row.leftId, rightId: row.rightId });
    }
  });
  return links;
}

/** 题型家族 → 输入态的 `kind`。未知题型回 `null`（调用方落回可安全渲染的默认值）。 */
function draftKindOf(type: string): AnswerDraft['kind'] | null {
  if (type === 'single-choice' || type === 'true-false' || type === 'multi-choice') return 'choice';
  if (type === 'fill-blank') return 'fill';
  if (type === 'short-answer') return 'text';
  if (type === 'order') return 'order';
  if (type === 'match') return 'match';
  if (type === 'categorize') return 'categorize';
  return null;
}

/**
 * 这一题的输入态**起点**。
 *
 * 逐题型的「起点」都是**学生屏幕上第一眼看到的东西**，所以它们不是同一个形状：
 *   · 选择 / 判断 / 多选 ⇒ 一个都没选；
 *   · 填空 ⇒ 与空数等长的空串数组（单空是 `['']`）—— 少一个框，学生就填不了那个空；
 *   · 问答 ⇒ 空文本；
 *   · 排序 ⇒ **`data.items` 的存储顺序**（学生看到的打乱顺序）。⚠️ 它**不是空的**，
 *     这正是「排序题永远可以提交」的由来；防「什么都不做就满分」的那一条在服务端的
 *     `validateQuestion`（它拒绝「条目顺序与正确顺序相同」），不在前端；
 *   · 连线 / 归类 ⇒ 一条都没有。
 *
 * 🔴 **未知题型必须给一个能安全渲染的默认值，不能 `undefined`。** 面板今天写死
 * `?? { selected: '', text: '' }`，那个回落点换成本函数时不许漏 —— 漏了的表现是
 * 库里一行手改过的题型让整个面板**白屏**（`drafts[node.id].selected` 抛 TypeError），
 * 而白屏的学生会以为「老师没布置」。回落到 `text` 这一支是因为它在三种未知情形下
 * 都不撒谎：不认识的题型本来就不产生作答值（`buildAnswerValue` 回 `null`），
 * 屏幕上也不会因此多出任何控件。
 */
export function emptyDraftFor(node: WorksheetQuestionNode): AnswerDraft {
  const kind = draftKindOf(node.type);
  if (kind === 'choice') return { kind: 'choice', selected: [] };
  if (kind === 'fill') {
    const count = readBlankCount(node);
    const texts: string[] = [];
    for (let index = 0; index < count; index += 1) texts.push('');
    return { kind: 'fill', texts };
  }
  if (kind === 'order') return { kind: 'order', order: readOrderItems(node).map((entry) => entry.id) };
  if (kind === 'match') return { kind: 'match', links: [] };
  if (kind === 'categorize') return { kind: 'categorize', assignment: {} };
  return { kind: 'text', text: '' };
}

/**
 * 这一题的输入态里**有没有东西**。
 *
 * ⚠️ 判据是**形状级**的，不看题目：它只回答「这份输入态是空的吗」。一个问题两个题型
 * 答案不同的地方**不在这里**，在调用点 —— 排序题的起点（`data.items` 的顺序）本身
 * 就是一份合法作答，所以「学生一个指头都没动」这件事只有面板知道（`drafts[node.id]`
 * 还是 `undefined`），请看 `worksheet-panel.tsx` 那条 `untouched` 判据。
 *
 * 空白字符不算（填空 / 问答）。多空填空里**只要有**一个空填了就不算空 —— 只填一半
 * 是可以提交的，服务端会判半对。
 */
export function isDraftEmpty(draft: AnswerDraft): boolean {
  if (draft.kind === 'choice') return draft.selected.length === 0;
  if (draft.kind === 'fill') return !draft.texts.some((text) => text.trim() !== '');
  if (draft.kind === 'order') return draft.order.length === 0;
  if (draft.kind === 'match') return draft.links.length === 0;
  if (draft.kind === 'categorize') return Object.keys(draft.assignment).length === 0;
  return !draft.text.trim();
}

/** 输入态 → 作答值。`null` = 「这一题没有内容可提交」（面板据此把按钮按死）。 */
function valueFromDraft(node: WorksheetQuestionNode, draft: AnswerDraft): WorksheetAnswerValue | null {
  const type = node.type;
  if (type === 'single-choice' || type === 'true-false' || type === 'multi-choice') {
    if (draft.kind !== 'choice' || draft.selected.length === 0) return null;
    return { format: 'choice/v1', selected: [...draft.selected] };
  }
  if (type === 'fill-blank') {
    if (draft.kind !== 'fill') return null;
    // ⚠️ **逐位对齐 `data.blanks`**（服务端按位取 `texts[index]`）：
    // 多填的空会被服务端忽略，少填的空按「没作答」算。
    if (!draft.texts.some((text) => text.trim() !== '')) return null;
    if (!isMultiBlank(node)) return { format: 'fill/v1', text: draft.texts[0] ?? '' };
    return { format: 'fill-multi/v1', texts: draft.texts.slice(0, readBlankCount(node)) };
  }
  if (type === 'short-answer') {
    if (draft.kind !== 'text') return null;
    return draft.text.trim() ? { format: 'text/v1', text: draft.text } : null;
  }
  if (type === 'order') {
    if (draft.kind !== 'order') return null;
    // 🔴 **永远不为 `null`**（规格 §12）：初始顺序本身就是一份合法作答。
    // 「什么都不做就满分」由服务端的 `validateQuestion` 挡（它拒绝「条目顺序 = 正确顺序」），
    // 不在这里挡 —— 这里一旦回 `null`，学生**连提交都点不了**，而他那份顺序是合法的。
    return { format: 'order/v1', order: [...draft.order] };
  }
  if (type === 'match') {
    if (draft.kind !== 'match' || draft.links.length === 0) return null;
    return { format: 'match/v1', links: draft.links.map((link) => ({ leftId: link.leftId, rightId: link.rightId })) };
  }
  if (type === 'categorize') {
    if (draft.kind !== 'categorize' || Object.keys(draft.assignment).length === 0) return null;
    return { format: 'categorize/v1', assignment: { ...draft.assignment } };
  }
  // 未知题型：**不产生作答**。给它编一种格式会让服务端收到一个它判不了的形状，
  // 而那份作答会以「已提交」的样子出现在教师看板上。
  return null;
}

/**
 * 把界面上的输入态变成**作答值**；`null` = 「这一题没有内容可提交」。
 *
 * ⚠️ 判「有没有内容」的是**这里**，别在调用点再写一遍 —— 服务端对「没作答就提交」回 400，
 * 而那条 400 的文案是「请先作答再提交本题」；前端如果自己算错了「有没有内容」，
 * 学生就会点到一个必然失败的按钮。
 *
 * ⚠️ 输入态的 `kind` 与题型的家族**对不上**时（题被改过 / 状态来自上一个版本）
 * 一律回 `null`，不「尽力读一读」：读出来的东西会被当成学生的作答存进库，
 * 而屏幕上根本没有那个控件。
 */
export function buildAnswerValue(
  node: WorksheetQuestionNode,
  draft: AnswerDraft,
): WorksheetAnswerValue | null {
  return valueFromDraft(node, draft);
}

/**
 * 把作答值里的**条目 / 框 id**收成「当下这道题还认得的那些」。
 *
 * 🔴 为什么必须裁：三个「条目型」题型的输入态**就是渲染依据**（排序按 `order` 画一列、
 * 连线按 `links` 画线、归类按 `assignment` 把条目放进框）。教师删掉一个条目之后，
 * 一份旧作答里那个 id 会画出一个**没有文字的条目**（或一条画不出来的线），
 * 而它还能被原样提交回去。裁掉之后学生看到的是「那一条不在了」，这是真话。
 *
 * ⚠️ 选择 / 填空 / 问答**不裁**：那三种的渲染依据是**题目**（选项表、空数），
 * 一份旧 key 在屏幕上本来就不显示任何东西，裁不裁都一样 —— 但它们**必须原样保留**，
 * 因为教师端抽屉的「原答案」要靠它把学生当初写的那个 key 显示出来
 * （`worksheet-drawer-state.ts` 的 `formatAnswer` 明写「选项对不上时退回 key 本身，
 * 不显示空白」）。这两件事方向相反，所以裁剪只发生在**渲染吃它**的那三个题型上。
 */
function reconcileWithNode(node: WorksheetQuestionNode, draft: AnswerDraft): AnswerDraft {
  if (draft.kind === 'order') {
    const known = readOrderItems(node).map((entry) => entry.id);
    // ⚠️ 先**去重**再对齐：`order` 里的重复 id（手改过的行 / 上一个版本）会让 React 的
    // `key` 撞车（同一条渲染两次），而它同时也是服务端判「长度相等」时的一个必然错误。
    const unique = draft.order.filter((id, index) => draft.order.indexOf(id) === index);
    // 先按学生排的顺序保留还在的项，再把**新加进来的**项按显示顺序补在后面 ——
    // 少了后半句，教师加一个条目之后学生那一列里永远看不到它、也就永远交不出满分的排序。
    const kept = unique.filter((id) => known.includes(id));
    const missing = known.filter((id) => !kept.includes(id));
    return { kind: 'order', order: [...kept, ...missing] };
  }
  if (draft.kind === 'match') {
    const left = readMatchLeft(node).map((entry) => entry.id);
    const right = readMatchRight(node).map((entry) => entry.id);
    const links: Array<{ leftId: string; rightId: string }> = [];
    draft.links.forEach((link) => {
      if (!left.includes(link.leftId) || !right.includes(link.rightId)) return;
      // 同一个左项 / 右项出现两次时只留第一条：服务端把「重复使用端点」整条判错
      // （`judgeMatch` 的 `leftUse` / `rightUse`），留着重复的只会让学生看着两条线拿 0 分。
      if (links.some((kept) => kept.leftId === link.leftId || kept.rightId === link.rightId)) return;
      links.push({ leftId: link.leftId, rightId: link.rightId });
    });
    return { kind: 'match', links };
  }
  if (draft.kind === 'categorize') {
    const items = readCategorizeItems(node).map((entry) => entry.id);
    const zones = readCategorizeZones(node).map((entry) => entry.id);
    const assignment: Record<string, string> = {};
    Object.keys(draft.assignment).forEach((itemId) => {
      const zoneId = draft.assignment[itemId];
      if (!items.includes(itemId) || !zones.includes(zoneId)) return;
      assignment[itemId] = zoneId;
    });
    return { kind: 'categorize', assignment };
  }
  return draft;
}

/**
 * `buildAnswerValue` 的**反向**：把一个作答值读回界面上的输入态。
 *
 * 用在两处，都是「屏幕上的东西必须和学生写过的一致」：
 *   · 学生端面板挂载时，把服务端已有的作答 / `localStorage` 队列里**还没发出去**的作答
 *     填回输入框（刷新一下不该让答案从屏幕上消失）；
 *   · 教师端抽屉显示「原答案」（`worksheet-drawer-state.ts` 的 `formatAnswer`）。
 *
 * ── 为什么需要 `node`（签名从 `(value)` 变成 `(node, value)`）────────────────
 * 两个理由，缺一不可：
 *   ① **单空 / 多空要分派**：`fill/v1` 的 `text` 与 `fill-multi/v1` 的 `texts` 是同一族
 *      的两个形状，读回时要与题目当下的空数**对齐**（教师加了一个空 ⇒ 那一格必须是空的，
 *      而不是让整列输入框少一个）；
 *   ② **条目型要裁剪**（见 `reconcileWithNode`）：排序 / 连线 / 归类的输入态是渲染依据，
 *      旧作答里指向已删条目的那些 id 必须先裁掉。
 *
 * ⚠️ 容错：值可能来自手改过的行或上一个版本，读不出来就返回 `emptyDraftFor(node)`，
 * **不抛**。它是渲染路径上的东西，一次 TypeError 会让整个面板白屏。
 */
export function draftFromValue(node: WorksheetQuestionNode, value: unknown): AnswerDraft {
  const empty = emptyDraftFor(node);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
  const row = value as Record<string, unknown>;
  const format = typeof row.format === 'string' ? row.format : '';
  // `format` 是**第一判据**（它就是这个字段存在的理由，见 `WorksheetAnswerValue` 的注释）；
  // 它缺席 / 不认识时（手改过的行、第一批之前的老形状）再按 `node.type` 落回本文件的默认值。
  const kind = format === 'choice/v1' ? 'choice'
    : format === 'fill/v1' || format === 'fill-multi/v1' ? 'fill'
    : format === 'text/v1' ? 'text'
    : format === 'order/v1' ? 'order'
    : format === 'match/v1' ? 'match'
    : format === 'categorize/v1' ? 'categorize'
    : draftKindOf(node.type);

  if (kind === 'choice') return { kind: 'choice', selected: readStringList(row.selected) };
  if (kind === 'fill') {
    // 单空（`fill/v1`）与多空（`fill-multi/v1`）在输入态里是**同一个形状**：
    // 一列文本。短的补空串、长的截掉，长度恒等于题目当下的空数 ——
    // 那是 `fill-body.tsx` 画几个输入框的依据。
    const raw = Array.isArray(row.texts) ? readStringList(row.texts) : [];
    const single = typeof row.text === 'string' ? [row.text] : [];
    const texts = raw.length > 0 ? raw : single;
    const count = readBlankCount(node);
    const aligned: string[] = [];
    for (let index = 0; index < count; index += 1) aligned.push(texts[index] ?? '');
    return { kind: 'fill', texts: aligned };
  }
  if (kind === 'order') return reconcileWithNode(node, { kind: 'order', order: readStringList(row.order) });
  if (kind === 'match') return reconcileWithNode(node, { kind: 'match', links: readLinks(row.links) });
  if (kind === 'categorize') {
    return reconcileWithNode(node, { kind: 'categorize', assignment: readStringMap(row.assignment) });
  }
  if (kind === 'text') return { kind: 'text', text: typeof row.text === 'string' ? row.text : '' };
  return empty;
}
