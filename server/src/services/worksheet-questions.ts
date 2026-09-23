/** 学习单的题型注册表。**纯函数，全部在服务端** —— 本项目不引入前端测试框架（规格 §11）。 */

/**
 * 题型注册表。**导出的是运行时列表**，`QuestionType` 由它派生 —— 这样「有哪些题型」
 * 只有一处定义，测试可以**遍历**它（而不是在测试里把类型名抄一遍）。
 *
 * ⚠️ 它**不是**校验用的那张表：`routes/worksheets.ts` 的 `normalizeNode` 另有一份
 * `QUESTION_TYPES`。两份不一致的后果是「新增题型被 400 拒绝」（响亮失败），
 * 不是静默放行，所以第一批没有合并它们。
 */
export const QUESTION_TYPES = ['single-choice', 'fill-blank', 'short-answer'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface QuestionNode {
  id: string;
  type: QuestionType;
  prompt: string;
  inputMode: 'keyboard' | 'handwriting';
  data: Record<string, unknown>;
  children: QuestionNode[];
}
export interface WorksheetContent { schemaVersion: number; nodes: QuestionNode[] }

/**
 * 填空题的文本归一化。
 *
 * 🔴 **刻意不做大小写不敏感**（规格 §3-T）：化学式 / 英文填空的大小写是语义的一部分，
 * 把 `CO2` 判成 `co2` 正确比不判更糟。英文题请教师在 `answers` 里多列几个写法。
 */
export function normalizeFillText(raw: string): string {
  return raw
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))  // 全角→半角
    .replace(/\s+/g, ' ')
    .trim();
}

/** 深度优先展开题目（第一批没有容器节点，但 content 是树，遍历写成递归不会过时）。 */
export function flattenQuestions(content: WorksheetContent): QuestionNode[] {
  const out: QuestionNode[] = [];
  const walk = (nodes: QuestionNode[]) => {
    for (const node of nodes) { out.push(node); walk(node.children ?? []); }
  };
  walk(content.nodes ?? []);
  return out;
}

/**
 * 答案字段的键名。**唯一来源** —— stripAnswers 与各题型共用，防止漏剥一个。
 *
 * 🔴 这是一张**黑名单**：`normalizeNode` 把 `data` 原样透传，所以没被列在这里的键
 * 会**原样下发到 `student-view`**（即泄漏给学生）。规格 §5.4 自己的措辞是单数的
 * `answer`，而这里的键是复数的 `answers` —— 一个字的差别就是一次静默泄漏，
 * 且没有任何编译期检查会红。防线是 `worksheet-grade.test.ts` 里的
 * 「每个题型的答案键都必须 ∈ ANSWER_KEYS」那条用例：**加题型时先看它**。
 */
export const ANSWER_KEYS = ['correctKeys', 'answers', 'explanation'] as const;

/**
 * 剥离答案 —— 学生端 `student-view` 的唯一过滤点（规格 §5.4）。
 *
 * 🔴 **必须在服务端做，且必须返回新对象**：前端过滤等同于未过滤；就地改动会让
 * 后续复用同一份 content 的代码拿到已经被破坏的数据。
 */
export function stripAnswers(content: WorksheetContent): WorksheetContent {
  const stripNode = (node: QuestionNode): QuestionNode => {
    const data: Record<string, unknown> = { ...node.data };
    for (const key of ANSWER_KEYS) delete data[key];
    return { ...node, data, children: (node.children ?? []).map(stripNode) };
  };
  return { ...content, nodes: (content.nodes ?? []).map(stripNode) };
}

/** 判分。返回 `null` 表示该题型不参与判分（主观题）。 */
export function grade(node: QuestionNode, value: unknown): boolean | null {
  if (node.type === 'short-answer') return null;
  const v = (value ?? {}) as { selected?: unknown; text?: unknown };
  if (node.type === 'single-choice') {
    const correct = Array.isArray(node.data.correctKeys) ? (node.data.correctKeys as string[]) : [];
    const selected = Array.isArray(v.selected) ? (v.selected as string[]) : [];
    return selected.length === 1 && correct.length === 1 && selected[0] === correct[0];
  }
  if (node.type === 'fill-blank') {
    // ⚠️ `Array.isArray` 只保证「是数组」，不保证元素是字符串 —— `data` 是
    // `Record<string, unknown>`，内容来自库里的 JSON，任何手工改过的行都可能有
    // 非字符串元素。逐个元素判类型而不是整体断言成 `string[]`：少了这一步，
    // `answers: [42, '光合作用']` 会在 `normalizeFillText` 里抛 `raw.replace is not a function`，
    // 而学生提交路径上的一次抛错就是 500。非字符串元素直接跳过（当作不匹配）。
    const answers = Array.isArray(node.data.answers) ? node.data.answers : [];
    if (typeof v.text !== 'string') return false;
    const normalized = normalizeFillText(v.text);
    return answers.some((answer) => typeof answer === 'string' && normalizeFillText(answer) === normalized);
  }
  return null;
}

/** 编辑期校验。返回中文错误列表，空数组表示通过。 */
export function validateQuestion(node: QuestionNode): string[] {
  const errors: string[] = [];
  if (!node.prompt.trim()) errors.push('题干不能为空');
  if (node.type === 'single-choice') {
    const options = Array.isArray(node.data.options) ? (node.data.options as unknown[]) : [];
    const correct = Array.isArray(node.data.correctKeys) ? (node.data.correctKeys as string[]) : [];
    if (options.length < 2) errors.push('单选题至少需要两个选项');
    if (correct.length !== 1) errors.push('单选题必须且只能指定一个正确答案');
  }
  if (node.type === 'fill-blank') {
    const answers = Array.isArray(node.data.answers) ? (node.data.answers as string[]) : [];
    if (!answers.some((a) => typeof a === 'string' && a.trim())) errors.push('填空题至少要有一个可接受的答案');
  }
  return errors;
}
