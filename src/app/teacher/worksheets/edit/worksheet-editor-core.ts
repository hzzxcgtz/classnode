/**
 * 学习单编辑器的**纯函数内核**：不碰 React、不碰 DOM、不碰网络，只依赖类型。
 *
 * 🔴 **本文件不得出现任何运行时 import。** 这不是风格要求，而是下面这件事的前提：
 * 本仓没有前端测试框架（规格 §11），但 `node --test` 能直接执行本文件 —— 因为
 * Node 24 的类型擦除会把 `import type` 整段删掉，运行时一行模块解析都不发生。
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

import type { WorksheetContent, WorksheetQuestionNode, WorksheetSettings } from '@/lib/types';


/**
 * 题型。⚠️ 这是**服务端注册表**（`server/src/services/worksheet-questions.ts` 的
 * `QUESTION_TYPES`）在教师端的投影，不是第二份权威：真正的校验在服务端
 * （`routes/worksheets.ts` 的 `parseContent`），多出来的题型会被 400 拒绝。
 * 这里窄一点只影响「能新建哪几种」，不会让非法题型落库。
 */
export type QuestionType = 'single-choice' | 'fill-blank' | 'short-answer';

/** 题型清单。**加题弹窗与每张卡片右上角的题型名共用这一份**，不要在两处各写一遍。 */
export const QUESTION_TYPE_OPTIONS: Array<{ value: QuestionType; label: string; hint: string }> = [
  { value: 'single-choice', label: '单选题', hint: '若干选项，只有一个正确答案' },
  { value: 'fill-blank', label: '填空题', hint: '学生填一段文字，答对任一可接受答案即算正确' },
  { value: 'short-answer', label: '问答题', hint: '主观题，不自动判分' },
];

export const SCHEMA_VERSION = 1;

/**
 * 撤销栈上限。**每次改动一条**（包括每一次击键，见 `contentReducer` 的说明），
 * 200 条 ≈ 一次正常编辑会话的深度；再深只会让「撤销」要按很多下才回到想回的地方。
 */
export const HISTORY_LIMIT = 200;

/** 单选题的选项数上限 —— 由 `optionKey` 的值域（A–Z）决定，不是随手定的数。 */
export const MAX_OPTIONS = 26;

/** 自动保存草稿的间隔（规格 §6.4：每 10 秒**或失焦**）。 */
export const DRAFT_INTERVAL_MS = 10_000;

export interface ChoiceOption {
  key: string;
  text: string;
}

/** 选项的 key 由**位置**派生（A、B、C…），与规格 §4.3 的示例一致。 */
export function optionKey(index: number): string {
  return String.fromCharCode(65 + index);
}

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

/** 读某道题的选项。**容错**：`data` 来自库里的 JSON，任何手改过的行都可能有别的形状。 */
export function readOptions(node: WorksheetQuestionNode): ChoiceOption[] {
  const raw = node.data.options;
  if (!Array.isArray(raw)) return [];
  const options: ChoiceOption[] = [];
  raw.forEach((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const option = item as Record<string, unknown>;
    // 缺 key 的正常行由 `newQuestion` 保证不会出现；这里按**已收下的条数**补一个，
    // 而不是按原始下标 —— 跳过垃圾条目之后下标会留下空洞（A、C、D…）。
    options.push({
      key: typeof option.key === 'string' && option.key ? option.key : optionKey(options.length),
      text: typeof option.text === 'string' ? option.text : '',
    });
  });
  return options;
}

/**
 * 写回选项：**重新按位置编号**，并让正确答案跟着那道选项走。
 *
 * 🔴 这是本页最容易做错的一处。选项的 `key` 是学生答案里的值
 * （`{ format: 'choice/v1', selected: ['B'] }`），所以删掉「A」之后，
 * 原来的「B」必须变成「A」—— 否则学生会答一个不存在的选项。而正确答案若只按字母跟着变，
 * 就会从「光合作用」跳到「呼吸作用」上，**判分从此全错且没有任何报错**。
 * 所以：先把旧 key 映射到新位置，再用它翻译 `correctKeys`。
 */
export function writeOptions(rawOptions: ChoiceOption[], correctKeys: unknown): { options: ChoiceOption[]; correctKeys: string[] } {
  const remap = new Map<string, string>();
  const options = rawOptions.slice(0, MAX_OPTIONS).map((option, index) => {
    const key = optionKey(index);
    remap.set(option.key, key);
    return { key, text: option.text };
  });

  const previous = Array.isArray(correctKeys)
    ? correctKeys.filter((key): key is string => typeof key === 'string')
    : [];
  const translated: string[] = [];
  for (const key of previous) {
    const next = remap.get(key);
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
 * 保存前的最后一道清理：填空题的 `answers` 去掉空行。
 *
 * 🔴 不清理的后果是**安静的满分**：`grade()` 用 `normalizeFillText` 比较，
 * 空串归一化之后还是空串 —— `answers: ['']` 会把学生的**空作答**判成正确，
 * 而且看板上会显示为「全班都对」。编辑期允许空行存在（textarea 的换行需要它），
 * 但**出网之前必须去掉**，唯一出网点是 `buildPayload()`。
 */
export function sanitizeContentForSave(content: WorksheetContent): WorksheetContent {
  let touched = false;
  const nodes = content.nodes.map((node) => {
    if (node.type !== 'fill-blank') return node;
    const raw = node.data.answers;
    if (!Array.isArray(raw)) return node;
    const answers = raw.filter((answer): answer is string => typeof answer === 'string' && answer.trim().length > 0);
    if (answers.length === raw.length) return node;
    touched = true;
    return { ...node, data: { ...node.data, answers } };
  });
  return touched ? { ...content, nodes } : content;
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
      return replaceNode(content, action.id, (node) => (
        { ...node, data: { ...node.data, ...action.patch } }
      ));

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

function isQuestionNode(value: unknown): value is WorksheetQuestionNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const node = value as Record<string, unknown>;
  return typeof node.id === 'string' && node.id.length > 0 && typeof node.type === 'string';
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
    },
    content: { schemaVersion: typeof content.schemaVersion === 'number' ? content.schemaVersion : SCHEMA_VERSION, nodes },
  };
}

/**
 * 服务端 `normalizeNode` 保证了下发形状，这里只兜一层「整棵树不可用」的情况：
 * 手改过的库行不该让整个编辑页白屏。
 */
export function normalizeLoadedContent(content: unknown): WorksheetContent {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return createEmptyContent();
  const nodes = (content as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) return createEmptyContent();
  const schemaVersion = (content as Record<string, unknown>).schemaVersion;
  return {
    schemaVersion: typeof schemaVersion === 'number' ? schemaVersion : SCHEMA_VERSION,
    nodes: nodes.filter((node): node is WorksheetQuestionNode => Boolean(node) && typeof node === 'object' && !Array.isArray(node)),
  };
}

export function normalizeLoadedSettings(raw: unknown): WorksheetSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_SETTINGS;
  const settings = raw as Record<string, unknown>;
  return {
    allowResubmit: settings.allowResubmit !== false,
    autoGrade: settings.autoGrade !== false,
    defaultInputMode: settings.defaultInputMode === 'handwriting' ? 'handwriting' : 'keyboard',
  };
}
