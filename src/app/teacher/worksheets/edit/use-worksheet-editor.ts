'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type {
  WorksheetContent,
  WorksheetDetail,
  WorksheetQuestionNode,
  WorksheetSettings,
  WorksheetUsage,
} from '@/lib/types';

/* ═══════════════════════════════════════════════════════════════════════
 * 下面这一段是**纯函数**：不碰 React、不碰 DOM、不碰网络，只依赖类型。
 * 之所以在这里划一条界线，是因为它是本页唯一值得逐条断言的东西（题目 id 的稳定性、
 * 选项重编号后正确答案的去向、`undo` 的栈语义），而本项目**不引入前端测试框架**
 * （规格 §11）。包围它的那两行 `// >>> … >>>` 形式的标记之间就是它的全文：
 * 整段抽成一个 `.mts`、配一段断言用 `node --test` 就能单跑，抽出来的是
 * **同一份字节**，不是照抄的第二份。
 * ═══════════════════════════════════════════════════════════════════════ */

// >>> WSEDIT-PURE-CORE >>>

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

// <<< WSEDIT-PURE-CORE <<<

/** 编辑器地址。`id` 走查询参数（静态导出没有动态路由，规格 §3-X）—— 与 C1 的 `editorHref` 同形。 */
function editorHref(id: string): string {
  return `/teacher/worksheets/edit/?id=${encodeURIComponent(id)}`;
}

export interface EditorNotice {
  message: string;
  type: 'success' | 'error';
}

export interface SaveStatus {
  kind: 'idle' | 'saving' | 'saved' | 'error';
  /** `kind === 'saved'` 时刻，用于顶栏的「已保存 14:32」。 */
  at: number | null;
  /** `kind === 'error'` 时的原因（服务端原话，例如逐题的校验明细）。 */
  message: string | null;
}

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // 隐私模式 / 站点数据被禁：草稿是尽力而为，不能因此打断编辑。
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 同上 */
  }
}

function removeLocalStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 同上 */
  }
}

/**
 * 学习单编辑器的数据层。
 *
 * 分工：本文件管**内容状态、历史、草稿、网络**；`page.tsx` 管版式与确认弹窗；
 * `question-card.tsx` 管一道题的输入控件。这样 `window.confirm` 的文案与
 * 「删题要说清已收到多少份作答」这类**界面判断**都留在页面里，
 * 而不是埋在状态机里。
 *
 * `id` 为 `null` ⇒ 空白编辑器（「新建」与「编辑」是同一个页面）。
 */
export function useWorksheetEditor({ id, onNotice }: {
  id: string | null;
  onNotice: (notice: EditorNotice) => void;
}) {
  const router = useRouter();

  const [worksheetId, setWorksheetId] = useState<string | null>(id);
  const [history, dispatch] = useReducer(contentReducer, undefined, () => createHistory(createEmptyContent()));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [settings, setSettings] = useState<WorksheetSettings>(DEFAULT_SETTINGS);
  /**
   * 已保存状态的快照。`null` = **还没加载完**，此时 `dirty` 一律为假 ——
   * 加载中途不能报「有未保存改动」，也不能把一份空学习单写进草稿。
   */
  const [baseline, setBaseline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'idle', at: null, message: null });
  const [usage, setUsage] = useState<WorksheetUsage | null>(null);
  const [draftFound, setDraftFound] = useState<{ key: string; draft: WorksheetDraft } | null>(null);
  const [duplicating, setDuplicating] = useState(false);

  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const duplicatingRef = useRef(false);
  /**
   * 已经加载过的学习单 id。`undefined` 是「一次都没加载」的哨兵值 ——
   * 与 `null`（「加载空白编辑器」）必须分得开，否则首次进入 `?id=` 缺省的页面时
   * 加载会被自己那道防重入判据挡掉。
   */
  const loadedIdRef = useRef<string | null | undefined>(undefined);
  /** 最新的 `worksheetId`，给那些不该因 id 变化而重建的回调读。 */
  const worksheetIdRef = useRef<string | null>(id);
  const callbacksRef = useRef({ onNotice });

  useEffect(() => { callbacksRef.current = { onNotice }; }, [onNotice]);
  useEffect(() => { worksheetIdRef.current = worksheetId; }, [worksheetId]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const payload = useMemo(
    () => buildPayload(title, description, settings, history.present),
    [title, description, settings, history.present],
  );
  const snapshot = useMemo(() => JSON.stringify(payload), [payload]);
  const dirty = baseline !== null && snapshot !== baseline;

  // —— 引用情况（规格 §6.4 的顶栏警告）────────────────────────────────

  const refreshUsage = useCallback(async (targetId: string): Promise<WorksheetUsage | null> => {
    try {
      const next = await api.getWorksheetUsage(targetId);
      if (mountedRef.current && loadedIdRef.current === targetId) setUsage(next);
      return next;
    } catch {
      // 读不到就保持原值（通常是 null）。**不要**清成「没人用」——
      // 那是把「没读到」说成「确实没有」，顶栏会安静地少掉那句该有的警告。
      return null;
    }
  }, []);

  const usageRef = useRef<WorksheetUsage | null>(null);
  useEffect(() => { usageRef.current = usage; }, [usage]);

  /** 删题确认要用「已收到多少份作答」。有缓存就用缓存，没有才补一次请求。 */
  const ensureUsage = useCallback(async (): Promise<WorksheetUsage | null> => {
    const targetId = worksheetIdRef.current;
    if (!targetId) return null;
    if (usageRef.current) return usageRef.current;
    return refreshUsage(targetId);
  }, [refreshUsage]);

  // —— 加载 ──────────────────────────────────────────────────────────

  const offerDraft = useCallback((key: string, serverUpdatedAt: string | null) => {
    const raw = readLocalStorage(key);
    const draft = parseDraft(raw);
    if (!draft) {
      // 形状不对的残留直接清掉，否则每次打开编辑页都要白解析一遍。
      if (raw !== null) removeLocalStorage(key);
      return;
    }
    if (serverUpdatedAt) {
      const serverAt = Date.parse(serverUpdatedAt);
      // 服务端上的版本不比草稿旧 ⇒ 草稿已经被覆盖进去了（例如上次保存成功但清理失败）。
      // ⚠️ 这条比较依赖「服务端与本机是同一台机器上的同一个时钟」—— 本应用是本地部署的
      // 桌面应用，成立；若将来服务端能跑在别处，这里要改成带偏移量的比较。
      if (Number.isFinite(serverAt) && draft.savedAt <= serverAt) {
        removeLocalStorage(key);
        return;
      }
    }
    setDraftFound({ key, draft });
  }, []);

  const load = useCallback(async (targetId: string | null) => {
    loadedIdRef.current = targetId;
    setLoading(true);
    setLoadError(null);
    setDraftFound(null);
    setUsage(null);

    if (!targetId) {
      const content = createEmptyContent();
      dispatch({ kind: 'reset', content });
      setTitle('');
      setDescription('');
      setSettings(DEFAULT_SETTINGS);
      setBaseline(JSON.stringify(buildPayload('', '', DEFAULT_SETTINGS, content)));
      setWorksheetId(null);
      setSaveStatus({ kind: 'idle', at: null, message: null });
      setLoading(false);
      offerDraft(draftKeyFor(null), null);
      return;
    }

    try {
      const detail = await api.getWorksheet(targetId);
      if (!mountedRef.current || loadedIdRef.current !== targetId) return;
      const content = normalizeLoadedContent(detail.content);
      const loadedTitle = typeof detail.title === 'string' ? detail.title : '';
      const loadedDescription = typeof detail.description === 'string' ? detail.description : '';
      const loadedSettings = normalizeLoadedSettings(detail.settings);
      dispatch({ kind: 'reset', content });
      setTitle(loadedTitle);
      setDescription(loadedDescription);
      setSettings(loadedSettings);
      setBaseline(JSON.stringify(buildPayload(loadedTitle, loadedDescription, loadedSettings, content)));
      setWorksheetId(targetId);
      setSaveStatus({ kind: 'idle', at: null, message: null });
      setLoading(false);
      void refreshUsage(targetId);
      offerDraft(draftKeyFor(targetId), typeof detail.updatedAt === 'string' ? detail.updatedAt : null);
    } catch (error) {
      if (!mountedRef.current || loadedIdRef.current !== targetId) return;
      setLoadError(error instanceof Error ? error.message : '请求异常');
      setLoading(false);
    }
  }, [offerDraft, refreshUsage]);

  useEffect(() => {
    // 防重入：新建 / 复制之后本页会自己把 URL 换掉，那次 prop 变化不该再拉一遍。
    if (loadedIdRef.current === id) return;
    void load(id);
  }, [id, load]);

  /** 新建 / 复制之后把地址换成真实 id —— 用 `replace`，这样「返回」仍然回到列表。 */
  useEffect(() => {
    if (worksheetId && worksheetId !== id) router.replace(editorHref(worksheetId));
  }, [worksheetId, id, router]);

  const retryLoad = useCallback(() => { void load(worksheetIdRef.current); }, [load]);

  // —— 保存 ──────────────────────────────────────────────────────────

  const payloadRef = useRef(payload);
  useEffect(() => { payloadRef.current = payload; }, [payload]);

  const save = useCallback(async (): Promise<WorksheetDetail | null> => {
    if (savingRef.current) return null;
    const next = payloadRef.current;
    if (!next.title) {
      setSaveStatus({ kind: 'error', at: null, message: '学习单标题不能为空' });
      return null;
    }
    savingRef.current = true;
    setSaveStatus({ kind: 'saving', at: null, message: null });
    const currentId = worksheetIdRef.current;
    // 保存成功后这份草稿就多余了。⚠️ 键要在 id 变化**之前**取，
    // 否则新建那一支会去删一个不存在的键，把 `new` 那份留在本机。
    const keyBefore = draftKeyFor(currentId);
    // 保存前再读一次 `/usage`（规格 §6.4）：顶栏那句警告说的是「保存会立刻传到学生端」，
    // 读到的是几秒前的数字就可能少报一间课堂。**不 await** —— 它是给横幅用的，
    // 不该挡在保存前面；失败也只是这句警告晚一步。
    if (currentId) void refreshUsage(currentId);
    try {
      const saved = currentId
        ? await api.updateWorksheet(currentId, next)
        : await api.createWorksheet(next);
      if (!mountedRef.current) return saved;
      removeLocalStorage(keyBefore);
      // ⚠️ 那份草稿已经过期了（保存的就是当前屏幕上的内容），横幅必须一起收掉：
      // 留着它，教师在保存之后再点一次「恢复」就会用旧草稿盖掉刚保存的东西。
      setDraftFound(null);
      // 基线取**刚发出去的那份载荷**，不是服务端的回包：回包会把
      // 「保存期间教师继续打的字」覆盖掉。载荷已经与本地状态同构
      // （见 `buildPayload` 的 trim），所以拿它当基线是准的。
      setBaseline(JSON.stringify(next));
      setSaveStatus({ kind: 'saved', at: Date.now(), message: null });
      if (!currentId) {
        worksheetIdRef.current = saved.id;
        loadedIdRef.current = saved.id;
        setWorksheetId(saved.id);
      }
      // 引用计数不阻塞保存 —— 它只影响顶栏那句警告的新鲜度。
      void refreshUsage(saved.id);
      callbacksRef.current.onNotice({ message: '已保存', type: 'success' });
      return saved;
    } catch (error) {
      const message = error instanceof Error ? error.message : '请求失败';
      if (mountedRef.current) setSaveStatus({ kind: 'error', at: null, message });
      // ⚠️ 保存失败**不清草稿**：那份草稿现在是本机上唯一的一份，清掉就是丢数据。
      callbacksRef.current.onNotice({ message: `保存失败：${message}`, type: 'error' });
      return null;
    } finally {
      savingRef.current = false;
    }
  }, [refreshUsage]);

  // —— 草稿（只写 localStorage，规格 §3-Y）────────────────────────────

  const draftStateRef = useRef({ key: draftKeyFor(id), dirty: false, payload: { title: '', description: '', settings: DEFAULT_SETTINGS, content: createEmptyContent() } });
  const draftPayload = useMemo(
    () => ({ title, description, settings, content: history.present }),
    [title, description, settings, history.present],
  );
  useEffect(() => {
    draftStateRef.current = { key: draftKeyFor(worksheetId), dirty, payload: draftPayload };
  }, [worksheetId, dirty, draftPayload]);

  const writeDraft = useCallback(() => {
    const state = draftStateRef.current;
    if (!state.dirty) return;
    writeLocalStorage(state.key, JSON.stringify({ savedAt: Date.now(), ...state.payload }));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(writeDraft, DRAFT_INTERVAL_MS);
    const onBlur = () => writeDraft();
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') writeDraft(); };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // 卸载前再写一次（点「返回」、点卡片跳走都会走到这里）——
      // 不然最后 10 秒的改动会静悄悄地没了。
      writeDraft();
    };
  }, [writeDraft]);

  const acceptDraft = useCallback(() => {
    const found = draftFound;
    if (!found) return;
    setTitle(found.draft.title);
    setDescription(found.draft.description);
    setSettings(found.draft.settings);
    // `reset`：恢复草稿是**换一个基线**，不是可撤销的一步。
    // 恢复之后 `dirty` 自然为真（基线仍是服务端那份），所以保存按钮会亮起来。
    dispatch({ kind: 'reset', content: found.draft.content });
    setDraftFound(null);
  }, [draftFound]);

  const discardDraft = useCallback(() => {
    if (!draftFound) return;
    removeLocalStorage(draftFound.key);
    setDraftFound(null);
  }, [draftFound]);

  // —— 离开 / 复制 ───────────────────────────────────────────────────

  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  const goBack = useCallback(() => {
    if (dirtyRef.current) {
      const confirmed = window.confirm(
        '这份学习单有未保存的改动。返回列表后它不会出现在学习单里，改动会留在本机草稿中，下次打开编辑页时会提示恢复。确定返回吗？',
      );
      if (!confirmed) return;
      // 先把当前状态落成草稿再说「改动会留在草稿里」—— 否则那句是假的（最多差 10 秒）。
      writeDraft();
    }
    router.push('/teacher/worksheets/');
  }, [router, writeDraft]);

  const duplicate = useCallback(async (): Promise<void> => {
    if (duplicatingRef.current) return;
    duplicatingRef.current = true;
    setDuplicating(true);
    try {
      let sourceId = worksheetIdRef.current;
      // 复制的是**服务端上的版本**。有未保存的改动就先存一次，
      // 否则教师会拿到一份缺了刚才那些改动的副本（而且他多半不会发现）。
      if (!sourceId || dirtyRef.current) {
        const saved = await save();
        if (!saved) return;
        sourceId = saved.id;
      }
      const copy = await api.duplicateWorksheet(sourceId);
      if (!mountedRef.current) return;
      // 显式加载副本，而不是等 URL 变化触发加载：路由软跳转是否重跑 effect
      // 不该成为「页面显示的是不是副本」的判据（显示旧内容而地址是新的，就是一种撒谎）。
      await load(copy.id);
      callbacksRef.current.onNotice({ message: `已复制为「${copy.title}」，已切到副本`, type: 'success' });
    } catch (error) {
      if (mountedRef.current) {
        callbacksRef.current.onNotice({
          message: `复制失败：${error instanceof Error ? error.message : '请求失败'}`,
          type: 'error',
        });
      }
    } finally {
      duplicatingRef.current = false;
      if (mountedRef.current) setDuplicating(false);
    }
  }, [load, save]);

  // —— 快捷键 ────────────────────────────────────────────────────────

  /**
   * `Cmd/Ctrl+Z` 撤销、`Cmd/Ctrl+Shift+Z`（Windows 上还有 `Ctrl+Y`）重做、`Cmd/Ctrl+S` 保存。
   *
   * ⚠️ 焦点在题干 / 选项输入框里时**也拦**（不按 `event.target` 放行）。看起来像是
   * 抢了浏览器的文本框撤销，其实不是：历史栈是**每次改动一条**（见 `contentReducer`），
   * 所以在这里按 `Cmd+Z` 退掉的正是上一个字符，与原生文本撤销的行为一致 ——
   * 而放行的后果是两种撤销各退各的、数值与光标错位。顶栏那两个按钮是给
   * 不知道快捷键的教师的，与这里走同一个 reducer。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void save();
        return;
      }
      if (key !== 'z' && key !== 'y') return;
      // `Ctrl+Y` 是 Windows 的重做习惯；macOS 上的 `Cmd+Y` 不是，别抢。
      const redo = (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.metaKey);
      if (key === 'y' && !redo) return;
      event.preventDefault();
      dispatch({ kind: redo ? 'redo' : 'undo' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  /** 有未保存改动时拦一下关标签页 / 刷新。文案由浏览器给，这里只需要拦。 */
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // —— 暴露给页面的动作 ───────────────────────────────────────────────

  const addQuestion = useCallback((questionType: QuestionType) => {
    dispatch({ kind: 'add', questionType });
  }, []);

  const updatePrompt = useCallback((questionId: string, prompt: string) => {
    dispatch({ kind: 'updatePrompt', id: questionId, prompt });
  }, []);

  const updateData = useCallback((questionId: string, patch: Record<string, unknown>) => {
    dispatch({ kind: 'updateData', id: questionId, patch });
  }, []);

  const moveQuestion = useCallback((questionId: string, delta: -1 | 1) => {
    dispatch({ kind: 'move', id: questionId, delta });
  }, []);

  const removeQuestion = useCallback((questionId: string) => {
    dispatch({ kind: 'remove', id: questionId });
  }, []);

  const undo = useCallback(() => dispatch({ kind: 'undo' }), []);
  const redo = useCallback(() => dispatch({ kind: 'redo' }), []);

  const updateSettings = useCallback((patch: Partial<WorksheetSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  return {
    worksheetId,
    title, setTitle,
    description, setDescription,
    settings, updateSettings,
    content: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo, redo,
    loading, loadError, retryLoad,
    dirty,
    saveStatus,
    usage,
    draftFound, acceptDraft, discardDraft,
    duplicating,
    addQuestion, updatePrompt, updateData, moveQuestion, removeQuestion,
    save, duplicate, goBack, ensureUsage,
  };
}

/**
 * 服务端 `normalizeNode` 保证了下发形状，这里只兜一层「整棵树不可用」的情况：
 * 手改过的库行不该让整个编辑页白屏。
 */
function normalizeLoadedContent(content: unknown): WorksheetContent {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return createEmptyContent();
  const nodes = (content as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) return createEmptyContent();
  const schemaVersion = (content as Record<string, unknown>).schemaVersion;
  return {
    schemaVersion: typeof schemaVersion === 'number' ? schemaVersion : SCHEMA_VERSION,
    nodes: nodes.filter((node): node is WorksheetQuestionNode => Boolean(node) && typeof node === 'object' && !Array.isArray(node)),
  };
}

function normalizeLoadedSettings(raw: unknown): WorksheetSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_SETTINGS;
  const settings = raw as Record<string, unknown>;
  return {
    allowResubmit: settings.allowResubmit !== false,
    autoGrade: settings.autoGrade !== false,
    defaultInputMode: settings.defaultInputMode === 'handwriting' ? 'handwriting' : 'keyboard',
  };
}
