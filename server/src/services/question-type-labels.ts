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
 * 题型的**别名**（★ 2026-09-28 教师给的对照表；★ 2026-09-30 教师用卷也用它）。
 *
 * 🔴 它是**给学生看的**名字（「开心填空」而不是「填空题」）——教师原话：
 * 「题型使用别名，例如开心填空」（那是他在导出结果上提的第二批要求）。
 * ⚠️ 与 `QUESTION_TYPE_LABELS` 一样，**必须与前端那张表逐条相同**：
 *    `src/lib/worksheet-ink-parity.test.ts` 一条用例把两张表对拍（漂了会红）。
 * ⚠️ 表里没有的题型（`task` 是任务容器、不是题）**回落到正式题型名** ——
 *    回落成空串会让纸上那一行只剩一个分号。
 */
export const QUESTION_TYPE_NICKNAMES: Readonly<Record<string, string>> = {
  'single-choice': '慧眼选择',
  'true-false': '真假侦探',
  'multi-choice': '慧眼选择',
  'choice-blank': '开心填空',
  'fill-blank': '开心填空',
  'order': '顺序高手',
  'match': '巧手连线',
  'categorize': '分类达人',
  'short-answer': '妙语问答',
  'drawing': '创意画板',
};

/**
 * 题型的**别名**（学生端那几个好玩的名字）。认不出的**回落到正式题型名** ——
 * 与前端 `questionTypeNickname` 同一条规矩（那份是学生端渲染读的，这份给报告/教师用卷读）。
 */
export function questionTypeNickname(type: unknown): string {
  if (typeof type !== 'string' || !type) return '（未知题型）';
  return QUESTION_TYPE_NICKNAMES[type] ?? questionTypeLabel(type);
}

/**
 * ⚠️ 入参是 `unknown`：`Worksheet.content` 可能被手改过，`node.type` 未必是字符串。
 * 回落到「（未知题型）」而不是 `undefined` —— 后者会**把 `undefined` 印在纸上**当题型名。
 */
export function questionTypeLabel(type: unknown): string {
  if (typeof type !== 'string' || !type) return '（未知题型）';
  return QUESTION_TYPE_LABELS[type] ?? type;
}
