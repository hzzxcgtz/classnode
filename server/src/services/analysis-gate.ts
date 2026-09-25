/**
 * ★ M7a：**「这道题可以被分析」的闸门**。
 *
 * 🔴 **本文件一个 import 都没有，这是硬要求，不是风格。**
 * `src/lib/analysis-gate-parity.test.ts` 要把它加载进**前端**的 runner（那条用例由
 * `node --test` 直接跑 TS 源文件）去和前端 `graded: false` 的集合对拍。
 * 而 Node **不会**把 `./x.js` 解析成 `./x.ts` ⇒ 只要这里 import 了任何东西，
 * 那条用例就 `ERR_MODULE_NOT_FOUND`。（同 `question-type-labels.ts` / `ink-path.ts`；
 * M6a 为此返工过两次。）
 *
 * 🔴 **为什么要有第三份「主观题」名单**：仓里已有两份，而它们恰好等价却没有东西守着 ——
 * 前端**声明式**（`src/lib/worksheet-questions.ts:101/:110` 的 `graded: false`）与
 * 服务端**行为式**（`worksheet-questions.ts:870/:878` 的 `JUDGES` 两格恒回 `null`）。
 * 本设计需要的是「能聚合的题型」，语义上就是那两类，所以**不新建口径**、
 * 只把已有的那两类**显式列出来并用两条用例钉住**：
 *   · `server/src/tests/analysis-gate.test.ts` —— 与注册表 + judge 行为三方对拍
 *   · `src/lib/analysis-gate-parity.test.ts` —— 与前端的 `graded: false` 对拍
 * ⇒ 谁哪天加一个新题型而只改了两处，必有一条红。
 *
 * ⚠️ **不要**把这里改成从 `QUESTION_TYPES` / `JUDGES` 派生 —— 那样会引入 import，
 * 上面那条硬要求（零 import）就破了。
 */
export const ANALYZABLE_TYPES: readonly string[] = ['short-answer', 'drawing'];

/**
 * 入参 `unknown`：`Worksheet.content` 可能被手改过，`node.type` 未必是字符串。
 * 回 `false` 而不是抛 —— 一道题的类型坏掉不该让整条链路 500，它只是没有「分析」入口。
 */
export function isAnalyzableType(type: unknown): boolean {
  return typeof type === 'string' && ANALYZABLE_TYPES.includes(type);
}
