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

/** 教师为主观题提供的评分依据。图片路径只接受本站学习单上传端点生成的资源。 */
export function analysisRubric(node: QuestionNode): { text: string; imageUrl: string | null } {
  if (node.type !== 'short-answer' && node.type !== 'drawing') return { text: '', imageUrl: null };
  const imageUrl = textOf(node.data.rubricImageUrl);
  return {
    text: textOf(node.data.rubricText) ?? '',
    imageUrl: imageUrl && WORKSHEET_IMAGE_URL.test(imageUrl) ? imageUrl : null,
  };
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
