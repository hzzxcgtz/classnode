import type { WorksheetQuestionNode } from './types';
import { defaultInkBox, inkFormatOf, isInkNode, readInkValue } from './worksheet-ink.ts';
import type { InkCanvas, InkPoint, InkStroke, InkValue } from './worksheet-ink.ts';

/**
 * 学习单的**作答值形状**与**它到界面输入态的双向转换** —— 9 个题型，全项目唯一一份。
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
 *   · `import type` 是**唯一**的 import 形态 —— ★ M4b 的唯一例外是 `./worksheet-ink.ts`
 *     那一条**值 import**（`isInkNode` / `inkFormatOf` / `readInkValue` / `defaultInkBox`
 *     是函数，擦不掉）。它同样是**相对路径 + `.ts` 后缀**、不引任何联名路径（`@/…`），
 *     所以 `node --test` 那一条路照旧成立；`worksheet-ink.ts` 自己**没有任何 import**，
 *     不存在环。
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
 * ★ M4b：笔迹（`ink/v1` / `drawing/v1`）加进来了，而且**是同一个成员** `InkValue`
 *（裁定 6：一个实现、两个 format 名 —— 差别只在题型默认的画布尺寸与提示语，
 * 存储与渲染逐字相同）。所以上面那张表里没有它的行：笔迹的「协议」是
 * `format` / `canvas` / `strokes` 这三个键（`InkValue`），而它的**读者不是判分器** ——
 * 手写与绘图不参与自动判分（规格 §12 裁定 3），服务端的 `JUDGES` 里没有它。
 * 🔴 这三个键名**都在 `ANSWER_KEYS` 之外**（Global Constraint 17：作答值里不许出现答案键名，
 * 否则本仓那些「响应里不得出现答案键」的扫描会分不出「学生画了东西」与「答案泄漏了」）。
 * `ANSWER_KEYS` 是 `['correctKeys', 'answers', 'explanation', 'correctOrder', 'pairs', 'placement']`
 *（`server/src/services/worksheet-questions.ts:333`）。M4b 实测（2026-09-24）：
 * ```
 * $ /usr/bin/grep -c "correctKeys\|answers\|explanation\|correctOrder\|pairs\|placement" src/lib/worksheet-ink.ts
 * 0
 * ```
 * ⇒ 六个笔迹键名（`format` / `canvas` / `strokes` / `color` / `width` / `points`）逐条与上面那张表
 * 做整行精确匹配，**全部零命中**。
 */
export type WorksheetAnswerValue =
  | { format: 'choice/v1'; selected: string[] }
  | { format: 'fill/v1'; text: string }
  | { format: 'fill-multi/v1'; texts: string[] }
  | { format: 'text/v1'; text: string }
  | { format: 'order/v1'; order: string[] }
  | { format: 'match/v1'; links: Array<{ leftId: string; rightId: string }> }
  | { format: 'categorize/v1'; assignment: Record<string, string> }
  | InkValue;

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
 *
 * ★ M4b：`ink` 这一支带 `box` —— 它是**学生作答那一刻量出来的框**（`InkCanvas` 的单位规则
 * 写在 `worksheet-ink.ts` 的 `InkStroke` 上），**不是**题型的默认框。`emptyDraftFor` 给的
 * 起点里那个 `box` 是 `defaultInkBox(node)`，只在「还没量过」时当占位（C1 的画布挂载后
 * 第一件事就是量它）。⇒ `buildAnswerValue` 交出去的是 `draft.box`，别在那里换成默认框：
 * 换掉之后教师抽屉里那幅图的宽高比与学生画的那一版不同，而两边都「看起来正常」。
 */
export type AnswerDraft =
  | { kind: 'choice'; selected: string[] }
  | { kind: 'fill'; texts: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'order'; order: string[] }
  | { kind: 'match'; links: Array<{ leftId: string; rightId: string }> }
  | { kind: 'categorize'; assignment: Record<string, string> }
  | { kind: 'ink'; box: InkCanvas; strokes: InkStroke[] };

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

/**
 * 读**按位的**一串文本（多空填空的 `texts`）。
 *
 * 🔴 它与 `readStringList` **刻意不同**，而且这个区别是致命的：
 * `readStringList` 把**空串**也丢掉 —— 对 `selected` / `order` 无害（空 key 本来就不是
 * 一个选项），但对 `texts` 是**按下标错位**：`['', 'H2O']`（学生只填了第 2 空）被读成
 * `['H2O']`，再补位成 `['H2O', '']` ⇒ 屏幕上第 1 空显示 H2O、第 2 空是空的。
 * 学生照屏幕改一个字 ⇒ `PUT` 把**错位的那一份**写回库 ⇒ 第 2 空的答案真的没了。
 * 全程无异常、无日志。
 *
 * ⚠️ **实测（2026-09-24，审查者的探针，修之前）**：
 * ```
 * 只填第 2 空（两空）: 落库 ["","H2O"] → 刷新后显示 ["H2O",""]     ❌
 * 填 1、3（三空）:      落库 ["甲","","丙"] → 刷新后显示 ["甲","丙",""] ❌
 * 只填第 1 空 / 全填:  不变                                        ✅
 * ```
 * ⇒ 判据是「**位置**」：非字符串元素落成空串（**占住位子**），长度因此不变；
 * 只有整份不是数组才是空。
 *
 * ⚠️ 两条读取函数都留着是刻意的：把 `selected` 也改成保空串会让一个 `['']` 成为
 * 「选了一个空 key」的作答；把 `texts` 改成丢空串就是上面那个缺陷。**用哪一条由语义决定**，
 * 不要「统一」它们。
 */
function readTextList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => (typeof item === 'string' ? item : ''));
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

/**
 * 题型 → 输入态的 `kind`。未知题型回 `null`（调用方落回可安全渲染的默认值）。
 *
 * ★ M4b：签名从 `(type: string)` 变成 `(node)` —— 判据是**节点级**的一个函数
 * （`isInkNode`），不是在这里再写一遍「`type === 'drawing' || inputMode === 'handwriting'`」。
 * 那份判据同时被 `emptyDraftFor` / `valueFromDraft` / 编辑器（D1）用，三处各写一遍必然漂移，
 * 而漂移的表现是「屏幕上给的是画布、提交上去的是 `text/v1`」（判分器读不到那个键
 * ⇒ 恒判错，全程无报错）。
 * ⚠️ `isInkNode` 那一条必须排在**所有** `node.type` 判断之前：手写的**问答题**同时满足
 * 「`type === 'short-answer'`」与「`inputMode === 'handwriting'`」两条，而**这台机器上**
 * 要的是 `inputMode` 那一条赢（它决定屏幕上给不给画布，见 `isInkNode` 自己的注释）。
 */
function draftKindOf(node: WorksheetQuestionNode): AnswerDraft['kind'] | null {
  if (isInkNode(node)) return 'ink';
  const type = node.type;
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
 *   · 问答 ⇒ 空文本（⚠️ **键盘的**问答；作答方式 = 手写的那种走下面那一条 `ink`）；
 *   · 画布（绘图题 / 手写作答）⇒ 空画布：**一笔都没有** + 题型默认的框。
 *     ★ M4b：起点里**带非空字段的不止一种** —— 这里那个 `box`（`{ w: 320, h: 240 }` /
 *     `{ w: 320, h: 160 }`）与下面排序那一列 id（`['i1','i2','i3']` 这种）；`fill` 的 `texts`
 *     不算，那个数组里**装的全是空串**（它表示「有那几个空位」，不是「空位里有内容」）。
 *     两者的区别是**会不会被覆盖**：排序那一列 id 是**一份合法作答**（`isDraftEmpty` 判它非空、
 *     `valueFromDraft` 也**永远**为它产出作答值 —— 见那两处各自的注释），而画布这个 `box` 是
 *     **占位** —— 画布挂载后第一件事就是量出真实框并覆盖它，所以它不会留下来、
 *     `isDraftEmpty` 也**刻意不看它**；
 *     但「一笔都没有」这一半是硬的：`strokes: []` ⇒ `isDraftEmpty` 为真 ⇒
 *     学生按不动「提交本题」（服务端对空作答回 400）；
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
  const kind = draftKindOf(node);
  if (kind === 'ink') return { kind: 'ink', box: defaultInkBox(node), strokes: [] };
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
  // ★ M4b：「一笔都没有」才算空 —— 与选择 / 连线 / 归类同一条口径（只有 `text` 那两支
  // 才看 trim）。⚠️ 不看 `box`：起点那个默认框是占位，把它当内容会让一道**没画过**的
  // 画布题变成「有内容可提交」。
  if (draft.kind === 'ink') return draft.strokes.length === 0;
  if (draft.kind === 'order') return draft.order.length === 0;
  if (draft.kind === 'match') return draft.links.length === 0;
  if (draft.kind === 'categorize') return Object.keys(draft.assignment).length === 0;
  return !draft.text.trim();
}

/** 输入态 → 作答值。`null` = 「这一题没有内容可提交」（面板据此把按钮按死）。 */
function valueFromDraft(node: WorksheetQuestionNode, draft: AnswerDraft): WorksheetAnswerValue | null {
  const type = node.type;
  // ★ M4b：手写 / 绘图**不参与判分**（规格 §12 裁定 3），但**照样要交** ——
  // 它是学生的作答，教师要人眼看。`null` 只表示「一笔都没画」。
  //
  // 🔴 **这一支必须排在下面那批题型分支之前**，判据是 `valueFromDraft` 的**函数体顺序**，
  // 而不是 `draftKindOf` 里那一条 `isInkNode` ——「手写的**问答题**」同时满足
  // 「`isInkNode(node)`」与「`type === 'short-answer'`」，放到下面去就会先命中
  // `if (type === 'short-answer')`、在那里读到 `draft.kind !== 'text'` ⇒ 回 `null`：
  // 学生**画完了却按不动「提交本题」**，而屏幕上没有任何报错。
  // ⇒ 反证用例逐字钉着它（`worksheet-answer-value.test.ts` 那条
  //   「手写问答的 ink 输入态能提交」）；把这一支挪到下面去，它必红。
  if (isInkNode(node)) {
    if (draft.kind !== 'ink' || draft.strokes.length === 0) return null;
    return {
      format: inkFormatOf(node),
      // 🔴 `canvas` 用的是**学生作答那一刻量出来的框**（`worksheet-ink.ts` 的单位规则），
      // 不是 `defaultInkBox(node)` —— 后者只在「还没量过」时当占位（`emptyDraftFor`）。
      // 记错这一个字段的后果是教师在抽屉里看到的宽高比与学生画的那一版不同，
      // 而两处都「看起来正常」。
      canvas: { w: draft.box.w, h: draft.box.h },
      strokes: draft.strokes.map((stroke) => ({
        color: stroke.color,
        width: stroke.width,
        points: stroke.points.map((point): InkPoint => [point[0], point[1]]),
      })),
    };
  }
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
 *
 * ★ M4b 复核：**ink 不裁** —— 笔迹的渲染依据是**笔画自己**（`draft.strokes` / `draft.box`），
 * 不是题目的条目表，所以它和选择 / 填空 / 问答一样走最后那条 `return draft`。
 * 它不需要在这里加一支，加了反而会引入一条凭空「裁剪」学生笔迹的路径。
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
  // ★ M4b：先读 ink —— 读得出东西就一定是笔迹（只认形状，不看题型：教师把一道题
  //   从手写改回键盘之后，学生**之前交的**那幅画仍然要读得回来）。
  //   ⚠️ 这一条与下面那句「`format` 是第一判据」**不冲突**：`readInkValue` 自己也先过
  //   `format`（`isInkFormat`），它只是把那两行的判据收在 `worksheet-ink.ts` 里一份。
  //   读回来之后 `draft.kind` 与题型家族**可以**对不上（`short-answer` 的键盘节点 + `ink/v1`
  //   值），这是**有意的**，三个读者各管一件事、互不代替：
  //     · **提交**那一侧由 `valueFromDraft` 的 `isInkNode(node)` 闸拦着 —— 非 ink 节点上的
  //       ink 输入态交不出去；
  //     · **屏幕上出不出画布**由**分派器**决定（`src/app/classroom/worksheet/questions/index.tsx`
  //       按 `node.type` 分支；它的 ink 支是 C1 加的）；
  //     · **那幅画本身不会丢**：值照样躺在 `WorksheetAnswer.value` 那个 Json 列里，教师抽屉
  //       由 **E1** 按 `format` 把它读出来渲染（`worksheet-ink.ts` 的 `strokePath` 就是给它用的）。
  //   ⚠️ **A2 这一刻抽屉还读不出它**：`formatAnswer`（`src/app/teacher/classroom/
  //   worksheet-drawer-state.ts:238`）只抽 `text` / `fill` 两族 —— 它里面那条三元链
  //   （`:248`）只认 `draft.kind === 'text'` 与 `'fill'`，ink 输入态落进最后的 `''`
  //   ⇒ 那一格返回 `null`（实测：`/usr/bin/grep -rn "strokePath\|InkPreview\|readInkValue"
  //   src/app` ⇒ 零命中）。⇒ 这是**渲染还没接上**，不是「那幅画丢了」——学生的笔迹
  //   一个字节都没少，接上的是 E1。别在这里把它读成「读回来没意义」。
  const ink = readInkValue(row);
  if (ink) return { kind: 'ink', box: ink.canvas, strokes: ink.strokes };
  // 画布题的值读不成笔迹（手改过的行 / 上一个版本）⇒ 回**空画布**：
  // 屏幕上恒是画布，不回落到别的形状（回落到别的形状会让一道画布题出现一个
  // 学生无法撤销、也无法提交的控件）。非 ink 节点不在这里拦 —— 它们由分派器按题型渲染。
  if (isInkNode(node)) return empty;
  // `format` 是**第一判据**（它就是这个字段存在的理由，见 `WorksheetAnswerValue` 的注释）；
  // 它缺席 / 不认识时（手改过的行、第一批之前的老形状）再按 `node.type` 落回本文件的默认值。
  const kind = format === 'choice/v1' ? 'choice'
    : format === 'fill/v1' || format === 'fill-multi/v1' ? 'fill'
    : format === 'text/v1' ? 'text'
    : format === 'order/v1' ? 'order'
    : format === 'match/v1' ? 'match'
    : format === 'categorize/v1' ? 'categorize'
    : draftKindOf(node);

  if (kind === 'choice') return { kind: 'choice', selected: readStringList(row.selected) };
  if (kind === 'fill') {
    // 单空（`fill/v1`）与多空（`fill-multi/v1`）在输入态里是**同一个形状**：
    // 一列文本。短的补空串、长的截掉，长度恒等于题目当下的空数 ——
    // 那是 `fill-body.tsx` 画几个输入框的依据。
    //
    // 🔴 `texts` 走 `readTextList`（**保住空串、位置不变**），不是 `readStringList` ——
    // 后者会把 `['', 'H2O']` 读成 `['H2O']`，补位之后每个空往前挪一格。理由与实测输出
    // 写在 `readTextList` 上；那是一条「学生刷新后答案错位、再一碰就被写坏」的缺陷。
    //
    // ⚠️ 判据是「`texts` **在不在**」，不是「它是不是非空数组」：`texts: []` 是一份
    // 合法（只是没填）的多空作答，落到下面补位成与空数等长的一列；而拿 `length > 0`
    // 当判据会让它去读 `text`（多空值里根本没有那个键）⇒ 整列变空。
    //
    // ⊘ 2026-09-24（控制器裁定）**上面那段因果是反事实的，判据已退回 `length > 0`**：
    //   ① 「`texts: []` 回落去读 `text` ⇒ 整列变空」**不会发生** —— 多空值里没有 `text`
    //      键 ⇒ 得到 `[]` ⇒ 下面那个**按 `count` 补位**的循环照样补出与空数等长的一列
    //      空框（「连框都不见了」是推演出来的，不是观测到的）；
    //   ② 两种判据**唯一**可观测的差异在另一个方向，而且是**丢数据**：
    //      `{ format: 'fill/v1', text: 'H2O', texts: [] }`（单空值上多挂一个空数组 ——
    //      手改过的行 / 上一个版本可能留下）旧判据读 `text` ⇒ 显示 `H2O`；
    //      `Array.isArray` 判据读 `texts: []` ⇒ 整列空 ⇒ **学生写过的字不见了**；
    //   ③ 复查者实测：只退回判据 ⇒ `worksheet-answer-value.test.ts` **23/23 全绿**
    //      —— 没有任何用例钉着这两种判据的差异（也就是说那句理由从未被验证过）。
    //   ⇒ 一句「看起来更稳」的判据改动，唯一的可观测方向是丢数据 ⇒ 退回。
    //   （这也是本仓那条纪律的由来：**「因此不会…」的结论必须附一条命令或一段实测输出**。）
    const texts = Array.isArray(row.texts) && row.texts.length > 0
      ? readTextList(row.texts)
      : (typeof row.text === 'string' ? [row.text] : []);
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
