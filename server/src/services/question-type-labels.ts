/**
 * 题型的中文名（M6a 的报告要用，而服务端原先没有这张表）。
 *
 * 🔴 **本文件不许 import 任何东西** —— 它被 `src/lib/worksheet-ink-parity.test.ts`
 * （跑在**前端 runner** 里）直接加载，用来与前端那张表逐条对拍。
 * Node 的类型擦除**不会**把 `./x.js` 解析到 `./x.ts`（实测 `ERR_MODULE_NOT_FOUND`）
 * ⇒ 一旦这里有 import，那条对拍就加载不起来。**同一个坑本批踩过两次**
 * （另一次是 `ink-path.ts`）—— 分界就是「能不能被前端 runner 直接加载」。
 *
 * ⚠️ 未知题型**回落成类型串本身**（与前端 `questionTypeLabel` 同一条规矩）：
 * 回落成「单选题」会让一道不认识的题在纸上谎称自己是单选。
 */
export const QUESTION_TYPE_LABELS: Readonly<Record<string, string>> = {
  'single-choice': '单选题',
  'true-false': '判断题',
  'multi-choice': '多选题',
  'choice-blank': '选择填空',
  'fill-blank': '填空题',
  'order': '排序题',
  'match': '连线题',
  'categorize': '归类题',
  'short-answer': '问答题',
  'drawing': '绘图题',
};

/**
 * ⚠️ 入参是 `unknown`：`Worksheet.content` 可能被手改过，`node.type` 未必是字符串。
 * 回落到「（未知题型）」而不是 `undefined` —— 后者会**把 `undefined` 印在纸上**当题型名。
 */
export function questionTypeLabel(type: unknown): string {
  if (typeof type !== 'string' || !type) return '（未知题型）';
  return QUESTION_TYPE_LABELS[type] ?? type;
}
