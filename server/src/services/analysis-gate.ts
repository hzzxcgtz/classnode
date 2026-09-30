/**
 * ★ M7a：**「这道题可以被分析」的闸门**。
 *
 * 🔴 **本文件一个 import 都没有，这是硬要求，不是风格。**
 * `src/lib/analysis-gate-parity.test.ts` 要把它加载进**前端**的 runner（那条用例由
 * `node --test` 直接跑 TS 源文件）去和前端全部可作答题型对拍。
 * 而 Node **不会**把 `./x.js` 解析成 `./x.ts` ⇒ 只要这里 import 了任何东西，
 * 那条用例就 `ERR_MODULE_NOT_FOUND`。（同 `question-type-labels.ts` / `ink-path.ts`；
 * M6a 为此返工过两次。）
 *
 * 🔴 **为什么仍保留显式名单**：智能体分析与本地判分是两条能力轴。
 * 客观题既能本地判分，也能把结构化作答交给 AI 解释认知模式；问答、绘图则不本地判分，
 * 但同样能分析。因此这里列的是「所有可作答题型」，只排除没有作答值的 `task` 容器。
 * 两条用例分别与服务端和前端题型注册表对拍，避免以后新增题型只接通一端。
 *
 * ⚠️ **不要**把这里改成从 `QUESTION_TYPES` / `JUDGES` 派生 —— 那样会引入 import，
 * 上面那条硬要求（零 import）就破了。
 */
// 本地判分回答“对了多少”，智能体继续解释“这些答案反映了怎样的理解方式”。
// 所有可作答题型都放行；`task` 是容器，没有作答值，明确不在此列。
export const ANALYZABLE_TYPES: readonly string[] = [
  'single-choice', 'true-false', 'multi-choice', 'fill-blank', 'short-answer',
  'order', 'match', 'categorize', 'drawing', 'choice-blank',
];

/**
 * 入参 `unknown`：`Worksheet.content` 可能被手改过，`node.type` 未必是字符串。
 * 回 `false` 而不是抛 —— 一道题的类型坏掉不该让整条链路 500，它只是没有「分析」入口。
 */
export function isAnalyzableType(type: unknown): boolean {
  return typeof type === 'string' && ANALYZABLE_TYPES.includes(type);
}
