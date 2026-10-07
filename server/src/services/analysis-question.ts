import {
  acceptableAnswersFor,
  answerSlotCount,
  readPairs,
  readStringMap,
  readStrings,
  type QuestionNode,
} from './worksheet-questions.js';

/**
 * 把题目与作答的内部 JSON 形状投影成第三方智能体能直接理解的文字。
 *
 * 🔴 这里是分析链路唯一的「题型语义适配层」。数据库里的 key/id 只用于关联，
 * 不应该直接发给模型让它猜；新增题型时必须在这里明确回答三件事：
 * 题面还需要哪些材料、参考答案是什么、一个学生的作答怎样读。
 */

function recordOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function fieldOf(raw: unknown, key: string): unknown {
  return recordOf(raw)[key];
}

function textOf(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

const WORKSHEET_IMAGE_URL = /^\/uploads\/chat\/chat-[0-9a-f-]+\.(?:png|jpe?g|webp)$/i;

/**
 * 主观题的评分标准文字 —— **唯一读取点**。
 *
 * ★ 2026-10-05（教师裁定）：「评分标准与下面的评分要求重复了，你把『评分标准』替换
 * 下面的『评分要求』，带图片上传。」⇒ 编辑器里原本并排的两个输入框（上面的「评分标准」、
 * 下面的「评分要求」）合并成**一个**，数据以 `rubricText` 为准；旧字段
 * `aiScoringCriteria` **降级为回退读取** —— 老学习单只填过「评分要求」的，
 * 这里照旧读得出来（一编辑就写回 `rubricText`，见 `question-card.tsx` 那一块）。
 *
 * 🔴 这条回退**只许写在这一处**：分析载荷与判据层（`analysis-scoring.ts`）都从这里取。
 * 在第二个地方再抄一遍 `rubricText || aiScoringCriteria` 就是本仓最防的那种分叉 ——
 * 两份口径会慢慢不一样，而两边都不报错。
 */
export function rubricTextOf(node: QuestionNode): string {
  return textOf(node.data.rubricText) ?? textOf(node.data.aiScoringCriteria) ?? '';
}

/** 教师为主观题提供的评分依据。手工填空 = 关闭本地自动判分的普通填空。 */
export function analysisRubric(node: QuestionNode): { text: string; imageUrl: string | null } {
  const supported = node.type === 'short-answer' || node.type === 'drawing'
    || (node.type === 'fill-blank' && node.autoGrade === false);
  if (!supported) return { text: '', imageUrl: null };
  const imageUrl = textOf(node.data.rubricImageUrl);
  return {
    text: rubricTextOf(node),
    imageUrl: imageUrl && WORKSHEET_IMAGE_URL.test(imageUrl) ? imageUrl : null,
  };
}

/**
 * 绘图题的**画板工具枚举** —— 与前端 `src/lib/worksheet-drawing.ts` 的 `DRAWING_TOOLS` 逐字相同。
 *
 * 🔴 这里必须与前端**同一把尺子**：认不出的 `tool`（手改过的数据、将来新增的工具）在教师端
 *    `readDrawingStarter` 那里就**不是**初始图；服务端若认它，提示词会对一道实际上没有初始图的题
 *    说「图里有教师的初始图」，模型于是去找一段不存在的内容。
 */
const DRAWING_STARTER_TOOLS: readonly string[] = ['flowchart', 'mind-map', 'math', 'free'];

/**
 * ★ 2026-10-06：这道题有没有教师预先给出的**初始图**（`data.drawingStarter`，形状 `{ tool, data }`）。
 *
 * 🔴 判据与前端 `src/lib/worksheet-drawing-starter.ts` 的 `readDrawingStarter` **逐条对齐**
 *    （它是「教师给的底稿」的权威读入口，见那个文件顶部的产品语义）：
 *      ① 只有 `drawing` 题型才有初始图 —— 别的题型上挂着同名字段不算；
 *      ② `drawingStarter` 得是个**非数组对象**；
 *      ③ `tool` 得是认得出的画板工具；④ `data` 得是个对象。
 *    ⇒ 任何一条不满足都回 `false`。方向是**宁可漏说**：多说的后果是模型去找不存在的初始图、
 *      并把学生的作答当成初始图而少评，两种都不报错。
 *
 * ⚠️ 为什么服务端要知道这件事：作图题提交时**只保留学生自己画的部分**（按 id 剔除了初始图），
 *    而位图快照（`drawing.image`）是**完整那张图**（含教师的框与连线）⇒ 发给 AI 的图里混着
 *    教师画的内容。那句说明在 `analysis-agent.ts` 的 `DRAWING_STARTER_NOTE`（唯一一份文字）。
 */
export function hasDrawingStarter(node: QuestionNode): boolean {
  if (node.type !== 'drawing') return false;
  const raw = node.data.drawingStarter;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const row = raw as Record<string, unknown>;
  if (!DRAWING_STARTER_TOOLS.includes(row.tool as string)) return false;
  /*
   * 🔴 ★ 2026-10-07（审计抓到）：**底稿的画板工具必须与题目当前的画板一致。**
   *
   * 真事：教师端那个「初始图」开关对**所有**绘图题都渲染，打开时**无条件**写一份
   * **流程图**底稿（`bodies/drawing-settings.tsx` 的 `selectTool` 也不清它）⇒
   * 在思维导图题上翻一下开关，题目数据里就留下一份流程图的底稿标记。
   * 而学生端的思维导图画板**根本不接底稿** ⇒ 快照里不可能有底稿 ⇒
   * 那句「本题的图里有教师预先给出的初始图……不要把初始图当作学生的成果」
   * 会让模型把学生自己搭的**整张**导图当成教师给的 —— **分给低了，而两边都不报错**。
   *
   * ⚠️ **刻意不抄**前端 `readDrawingTool` 那条 `drawingExtensions` 历史回落：
   *    初始图是 2026-10-06 才有的功能，而 `drawingExtensions` 那套格式更早就没人写了
   *   （全仓只有 `selectTool` 在**清**它、加一个读取函数在读它）⇒
   *    **任何带着 `drawingStarter` 的题目一定来自新版编辑器，也就一定有 `drawingTool`**。
   *    抄一份回落等于在服务端再养一份会漂的拷贝 —— 本仓反复防的就是那个。
   * ⚠️ 题目没写 `drawingTool` ⇒ 画布是默认那一档（`free`），它也不接底稿 ⇒ 不许说。
   *    这是**宁可漏说**的一侧（与这个函数一贯的方向一致）：漏说 = 模型把底稿算成学生的成果；
   *    多说 = 模型把**学生的成果**算成底稿 —— 后者更坏。
   */
  if (node.data.drawingTool !== row.tool) return false;
  return !!row.data && typeof row.data === 'object';
}

function entriesOf(raw: unknown, labelKey = 'text'): Array<{ id: string; text: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; text: string }> = [];
  for (const item of raw) {
    const row = recordOf(item);
    if (typeof row.id !== 'string' || row.id === '') continue;
    const label = typeof row[labelKey] === 'string' && row[labelKey] !== '' ? row[labelKey] as string : row.id;
    out.push({ id: row.id, text: label });
  }
  return out;
}

function entryMap(raw: unknown, labelKey = 'text'): Map<string, string> {
  return new Map(entriesOf(raw, labelKey).map((entry) => [entry.id, entry.text]));
}

function optionMap(node: QuestionNode): Map<string, string> {
  if (node.type === 'true-false') return new Map([['T', '正确'], ['F', '错误']]);
  const out = new Map<string, string>();
  if (!Array.isArray(node.data.options)) return out;
  for (const item of node.data.options) {
    const row = recordOf(item);
    if (typeof row.key !== 'string' || row.key === '') continue;
    out.set(row.key, typeof row.text === 'string' && row.text !== '' ? row.text : row.key);
  }
  return out;
}

function labeled(id: string, map: Map<string, string>): string {
  const text = map.get(id);
  return text && text !== id ? `${id}. ${text}` : id;
}

function appendExplanation(reference: string, node: QuestionNode): string {
  const explanation = textOf(node.data.explanation);
  if (!explanation) return reference;
  return reference === '（未提供参考答案）' ? `参考说明：${explanation}` : `${reference}\n参考说明：${explanation}`;
}

function fillReference(node: QuestionNode): string {
  const count = answerSlotCount(node.data);
  if (count === 0) return '（未提供参考答案）';
  const slots = Array.from({ length: count }, (_, index) => {
    const answers = acceptableAnswersFor(node.data, index);
    return `第${index + 1}空：${answers.length > 0 ? answers.join(' / ') : '（未提供）'}`;
  });
  return slots.join('；');
}

/** 题干之外、模型理解题目所必需的题面材料。 */
export function analysisQuestionDetails(node: QuestionNode): string {
  switch (node.type) {
    case 'single-choice':
    case 'multi-choice':
    case 'true-false': {
      const options = [...optionMap(node)].map(([key, text]) => `${key}. ${text}`);
      return options.length > 0 ? `选项：${options.join('；')}` : '（没有额外题面材料）';
    }
    case 'choice-blank': {
      const choices = readStrings(node.data.fillChoicePool ?? node.data.choices);
      return choices.length > 0 ? `待选词：${choices.join('、')}` : '（没有额外题面材料）';
    }
    case 'order': {
      const items = entriesOf(node.data.items);
      return items.length > 0 ? `可排序条目：${items.map((item) => item.text).join('；')}` : '（没有额外题面材料）';
    }
    case 'match': {
      const left = entriesOf(node.data.left);
      const right = entriesOf(node.data.right);
      return `左栏：${left.map((item) => item.text).join('；') || '（空）'}\n右栏：${right.map((item) => item.text).join('；') || '（空）'}`;
    }
    case 'categorize': {
      const items = entriesOf(node.data.items);
      const zones = entriesOf(node.data.zones, 'label');
      return `待归类条目：${items.map((item) => item.text).join('；') || '（空）'}\n分类框：${zones.map((item) => item.text).join('；') || '（空）'}`;
    }
    default:
      return '（没有额外题面材料）';
  }
}

/** 按题型把答案键转换成可读的参考答案/评价依据。 */
export function analysisReferenceAnswer(node: QuestionNode): string {
  let reference = '（未提供参考答案）';
  switch (node.type) {
    case 'single-choice':
    case 'multi-choice':
    case 'true-false': {
      const options = optionMap(node);
      const correct = readStrings(node.data.correctKeys);
      if (correct.length > 0) reference = correct.map((key) => labeled(key, options)).join('、');
      break;
    }
    case 'fill-blank':
    case 'choice-blank':
    case 'short-answer':
    case 'drawing':
      reference = fillReference(node);
      break;
    case 'order': {
      const items = entryMap(node.data.items);
      const correct = readStrings(node.data.correctOrder);
      if (correct.length > 0) reference = correct.map((id) => items.get(id) ?? id).join(' → ');
      break;
    }
    case 'match': {
      const left = entryMap(node.data.left);
      const right = entryMap(node.data.right);
      const pairs = readPairs(node.data.pairs);
      if (pairs.length > 0) {
        reference = pairs.map((pair) => `${left.get(pair.leftId) ?? pair.leftId} → ${right.get(pair.rightId) ?? pair.rightId}`).join('；');
      }
      break;
    }
    case 'categorize': {
      const items = entryMap(node.data.items);
      const zones = entryMap(node.data.zones, 'label');
      const placement = readStringMap(node.data.placement);
      const groups = new Map<string, string[]>();
      for (const [itemId, zoneId] of Object.entries(placement)) {
        const list = groups.get(zoneId) ?? [];
        list.push(items.get(itemId) ?? itemId);
        groups.set(zoneId, list);
      }
      if (groups.size > 0) {
        reference = [...groups].map(([zoneId, itemTexts]) => `${zones.get(zoneId) ?? zoneId}：${itemTexts.join('、')}`).join('；');
      }
      break;
    }
    default:
      break;
  }
  return appendExplanation(reference, node);
}

/**
 * 一份学生作答的可读投影。`null` 表示形状无法识别；空白作答返回空串，调用方会明确标成空白。
 */
export function analysisAnswerText(node: QuestionNode, value: unknown): string | null {
  const raw = recordOf(value);
  switch (node.type) {
    case 'single-choice':
    case 'multi-choice':
    case 'true-false': {
      if (!Array.isArray(raw.selected)) return null;
      const selected = readStrings(raw.selected);
      if (selected.length === 0) return '';
      const options = optionMap(node);
      return `选择：${selected.map((key) => labeled(key, options)).join('、')}`;
    }
    case 'fill-blank':
    case 'choice-blank': {
      const texts = Array.isArray(raw.texts)
        ? raw.texts.map((item) => typeof item === 'string' ? item : '（无法识别）')
        : typeof raw.text === 'string' ? [raw.text] : null;
      if (!texts) return null;
      if (texts.every((item) => item.trim() === '')) return '';
      return texts.map((text, index) => `第${index + 1}空：${text.trim() === '' ? '（空白）' : text}`).join('；');
    }
    case 'order': {
      if (!Array.isArray(raw.order)) return null;
      const order = readStrings(raw.order);
      if (order.length === 0) return '';
      const items = entryMap(node.data.items);
      return `顺序：${order.map((id) => items.get(id) ?? id).join(' → ')}`;
    }
    case 'match': {
      if (!Array.isArray(raw.links)) return null;
      const left = entryMap(node.data.left);
      const right = entryMap(node.data.right);
      const links = readPairs(raw.links);
      if (links.length === 0) return '';
      return links.map((pair) => `${left.get(pair.leftId) ?? pair.leftId} → ${right.get(pair.rightId) ?? pair.rightId}`).join('；');
    }
    case 'categorize': {
      if (!raw.assignment || typeof raw.assignment !== 'object' || Array.isArray(raw.assignment)) return null;
      const assignment = readStringMap(raw.assignment);
      if (Object.keys(assignment).length === 0) return '';
      const items = entryMap(node.data.items);
      const zones = entryMap(node.data.zones, 'label');
      const groups = new Map<string, string[]>();
      for (const [itemId, zoneId] of Object.entries(assignment)) {
        const list = groups.get(zoneId) ?? [];
        list.push(items.get(itemId) ?? itemId);
        groups.set(zoneId, list);
      }
      return [...groups].map(([zoneId, itemTexts]) => `${zones.get(zoneId) ?? zoneId}：${itemTexts.join('、')}`).join('；');
    }
    case 'short-answer':
      return raw.format === 'text/v1' && typeof raw.text === 'string' ? raw.text : null;
    default:
      return null;
  }
}
