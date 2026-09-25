/**
 * ★ M7b：**「这个智能体学生能不能看见」这门闸**。
 *
 * 🔴 **本文件一个 import 都没有** —— 与 `analysis-gate.ts` / `question-type-labels.ts` 同一条理由：
 * 前端用例用 `node --test` **直接跑 TS 源**，而 Node 不把 `./x.js` 解析成 `./x.ts`
 * ⇒ 只要这里 import 了任何东西，跨工程加载就 `ERR_MODULE_NOT_FOUND`（M6a 为此返工过两次）。
 * ⇒ **不要**在这里 import Prisma 的类型，用结构化的入参类型。
 *
 * 🔴 为什么 `purpose` 是**一门闸**而不是标签：学生端的智能体列表来自 `ClassroomAgent`，
 * 而服务端今天只读 `agent.enabled`（`routes/classroom.ts:1090`）⇒ 加了分析型之后，
 * 教师可以把它选成学伴，**它就会出现在小学生的聊天列表里** —— 一个「会收到全班作业」的 bot。
 * 设计文档 §15.1 那条配套调整（「学生端只关联 `purpose = 'tutoring'` 的智能体」）正是为此。
 */

export const AGENT_PURPOSES = ['tutoring', 'analysis'] as const;
export type AgentPurpose = (typeof AGENT_PURPOSES)[number];

/** 学生端那一份视图的形状（两处调用点共用）。 */
export interface StudentAgentView {
  id: string;
  name: string;
  logo: string | null;
  platform: string;
  enabled: boolean;
  greeting: string | null;
}

/**
 * 归一化。**坏值一律回落 `'tutoring'`**（与 `normalizePointValue` / `normalizeAnalysisKnobs`
 * 同一条纪律：一个手改坏的值不该让教师存不进去）。
 *
 * ⚠️ 回落方向是**保守的**：`tutoring` 会被学生看见，而 `analysis` 是**加了闸**的那一侧。
 * 反过来的话，一个坏值会让一个本该当学伴的 bot 从学生眼前消失 —— 而那是**静默**的。
 */
export function normalizeAgentPurpose(raw: unknown): AgentPurpose {
  return raw === 'analysis' ? 'analysis' : 'tutoring';
}

/**
 * 学生端那一份视图的**核心**：给一个 agent 行，回视图或 `null`（分析型）。
 *
 * 🔴 **两条来源都要走它**（独立审查 C2 抓到的漏点）：
 *   ① `classroomAgents[].agent`（课堂级）—— `studentAgentView`；
 *   ② **组级材料**（`resolveGroupMaterialViews` 的 `groups[].agent`）—— 同样是发给学生的，
 *      而它最初**没有任何 purpose 判断** ⇒ 高级模式下一组的「AI 智能体」若选了分析型，
 *      那组学生打开聊天面板看到的就是那个「会收到全班作业」的 bot。
 * 两者的视图形状逐字相同（`id/name/logo/platform/enabled/greeting`），那正是为了共用。
 */
export function studentAgentViewOf(agent: {
  id: string; name: string; logo: string | null; platform: string;
  enabled: boolean; greeting?: string | null; purpose?: unknown;
}): StudentAgentView | null {
  if (agent.purpose === 'analysis') return null;
  return {
    id: agent.id,
    name: agent.name,
    logo: agent.logo,
    platform: agent.platform,
    enabled: agent.enabled,
    greeting: agent.greeting ?? null,
  };
}

/** 学生可见的那几个（**路由**那一侧要用：见 `socket/index.ts` 的 `classroomLevelId`）。 */
export function studentVisibleAgents<T extends { agent: { purpose?: unknown } }>(rows: T[]): T[] {
  return rows.filter((row) => row.agent.purpose !== 'analysis');
}

/**
 * 学生端那一份视图。**两处调用点必须共用同一个构造**（否则学生**首屏**与**连接后**
 * 看到的列表会分叉）：`routes/classroom.ts` 的 HTTP 首屏、`socket/index.ts` 的 `joined` 载荷。
 * 分析型回 `null`（调用方 `.filter()` 掉）。
 *
 * ⚠️ 判据是「**不是** `analysis`」而不是「`=== 'tutoring'`」：后者会把**缺字段的行**
 * （`purpose` 列刚加上的旧行、或手改过的行）整个吞掉 —— 那些 bot 本来就是学伴，
 * 让学生看不见它们是**静默的功能损失**。
 *
 * ⚠️ 上面那段最初写的是「这里**刻意没有**一个 `studentVisibleAgents(rows)` 的过滤助手 ——
 * 多一个只被用例调用的导出就是装饰品」。那句话在 C2 之后**不成立了**：
 * **路由**那一侧需要「筛过之后的第一个」（`socket/index.ts` 的 `classroomLevelId` 原先取的是
 * 未筛过的 `classroomAgents[0]` ⇒ 学生**看得见的**与**真正回答的**分叉了），
 * 所以它现在有一个**真的**生产调用者。
 */
export function studentAgentView(row: {
  agent: {
    id: string;
    name: string;
    logo: string | null;
    platform: string;
    enabled: boolean;
    greeting?: string | null;
    purpose?: unknown;
  };
}): StudentAgentView | null {
  return studentAgentViewOf(row.agent);
}
