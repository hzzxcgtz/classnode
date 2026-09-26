/**
 * ★「这个智能体是**学习类**还是**分析类**」—— **前端那一侧的唯一判据**。
 *
 * 🔴 判据只能有一份。写这个文件之前，前端这条规矩**已经有一份拷贝**住在 `agent-card.tsx`
 * （卡片名称后面那枚「学」/「析」）；「用途」筛选要再判一次 ⇒ 不加处理就是**两份**。
 * 两份分叉的症状全是静默的：卡片上画着「学」而筛选把它归到「分析类」，
 * 或者筛「学习类」之后**少了几张卡片**、不报错。
 * ⇒ 抽到这里，卡片与筛选共同调用。
 *
 * 🔴 **回落方向是保守的**（与服务端 `normalizeAgentPurpose` 逐字同源，由
 * `agent-purpose.test.ts` 对拍钉住）：`Agent.purpose` 是后加的列，**缺字段 / `null` 的旧行
 * 本来就是学伴**。判据写成 `=== 'tutoring'` 会把它们整个吞掉 —— 那是静默的功能损失。
 * 反过来的方向（认不出当分析型）同样不行，但代价更重：分析型是「**会收到全班作业**」的那一类，
 * 它不该出现在学生眼前，也不该在教师这里被错归成学伴。
 *
 * ⚠️ **本文件一个 import 都没有** —— 与 `analysis-gate.ts` / `question-type-labels.ts` 同一条理由：
 * `agent-purpose.test.ts` 用 `node --test` 直接跑 TS 源并**跨工程**加载服务端的同名模块，
 * 只要这里 import 了任何东西，那条对拍用例就会 `ERR_MODULE_NOT_FOUND`。
 */

export type AgentPurpose = 'tutoring' | 'analysis';

/**
 * 归一化。**坏值一律回落 `'tutoring'`**。
 *
 * ⚠️ 松到 `unknown` 是**故意的**：调用点的入参是 `AgentSummary.purpose?: string`，
 * 而老数据、手改过的数据都会走到这里。收窄成 `string` 会逼调用点先 `?? ''`，
 * 那只是把同一件事换个地方写而已。
 */
export function agentPurposeOf(purpose?: unknown): AgentPurpose {
  return purpose === 'analysis' ? 'analysis' : 'tutoring';
}
