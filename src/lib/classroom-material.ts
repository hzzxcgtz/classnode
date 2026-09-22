import type { AgentSummary, ClassroomWebappSummary } from './types';

/**
 * 「这个学生此刻实际生效的材料」——**学生端唯一**的解析口径（P2 / spec §4.4、§4.6）。
 *
 * 🔴 **抽出来的理由不是「去重」，是原来那两份各写一份的回落本身就是错的。**
 * 改动前 `chat-panel.tsx` 与 `student-home.tsx` 各写了一遍「先找自己组的 agent，找不到就
 * 回落到 `classroom.agents[0]`」，而 `classroom.agents` 在高级模式下曾是**各组智能体的并集**
 * （旧 `routes/classroom.ts` 从各组 `agentId` 派生）⇒ 组里没配智能体的学生会看到**别的组的
 * 名字和头像**，AI 照常回答、教师完全看不出（spec §1.2 ①）。服务端改对之后，界面这一侧
 * 仍然在撒谎 —— 这两处就是剩下的那半边。
 *
 * ⚠️ **本文件不引任何 React / DOM**：这两个函数要能被单独跑（`node --test
 * src/lib/classroom-material.test.ts`，Node 24 的 TS 类型擦除直接执行），逐组合断言
 * 「高级模式到底回没回落」。把它们写成组件里的内联函数就只能靠端到端手测。
 */

/** 组材料的**入参**形状：只声明本文件真正读的两项，`StudentClassroom.groups` 结构上满足它。 */
interface GroupMaterials {
  id: string;
  agent?: AgentSummary | null;
  webapp?: ClassroomWebappSummary | null;
}

/**
 * 课堂材料的**入参**形状。
 *
 * ⚠️ 字段名以 `GET /code/:code` **实际**下发的为准（`server/src/routes/classroom.ts` 的
 * `res.json`：顶层 `agents` / `webapps` / `groups` 三个数组）—— 计划草稿里写的
 * `groups[].materials.{agent,webapp}` 那种嵌套形状**没有落地**，服务端下发的是扁平的
 * `{ id, name, agent, webapp }`。这里按实测的形状写。
 */
interface ClassroomMaterials {
  mode?: string;
  groups?: GroupMaterials[];
  agents?: AgentSummary[];
  /** 课堂级网页（**标准 / 分组模式**的权威来源）。 */
  webapps?: ClassroomWebappSummary[];
}

/**
 * 学生**自己那个组**；没有组、或组不在 `groups[]` 里就返回 `undefined`。
 *
 * `undefined` 与「找到了但那个材料是 null」在上面的调用点都被 `?? null` 收成同一个结果，
 * 所以不必区分两种「没有」。
 */
function ownGroup(
  classroom: ClassroomMaterials,
  selectedStudent: { groupId?: string | null } | null | undefined,
): GroupMaterials | undefined {
  if (!selectedStudent?.groupId) return undefined;
  return classroom.groups?.find((group) => group.id === selectedStudent.groupId);
}

/**
 * 「这个学生此刻实际生效的智能体」。
 *
 * 🔴 **高级模式一律不回落**（spec §4.4）：只认学生自己的组，该组没配就是 `null` ——
 * 调用方照「没有智能体」的样子显示（模块身份名之类的兜底），**不许**拿课堂级数组顶上。
 *
 * 标准 / 分组模式：权威来源仍是**课堂级**那一个（分组模式全班共用一套材料，spec §1.3）。
 */
export function effectiveGroupAgent(
  classroom: ClassroomMaterials | null | undefined,
  selectedStudent: { groupId?: string | null } | null | undefined,
): AgentSummary | null {
  if (!classroom) return null;
  if (classroom.mode === 'advanced') return ownGroup(classroom, selectedStudent)?.agent ?? null;
  return classroom.agents?.[0] ?? null;
}

/**
 * 「这个学生此刻该打开哪一个探究网页」。语义与 `effectiveGroupAgent` 逐字相同。
 *
 * 🔴 高级模式下 `null` 的含义是**「本组未配置探究网页」**，不是「老师还没添加网页」——
 * 后者会让学生以为整间课堂都没有，而实际上可能是别的组有。调用方（`explore-panel.tsx`）
 * 的文案必须照着这个区分写，并且**不渲染 iframe**、**不拿课堂级那个顶上**。
 *
 * ⚠️ 这个值是学生端上报缩略图 / 事件用的 `webappId` 的来源（`webapp-event` /
 * `webapp-frame` / `webapp-diag`）—— 取错网页时教师看板上看到的画面与事件都属于那个错的
 * 网页，而两者都不会报错。
 */
export function effectiveGroupWebapp(
  classroom: ClassroomMaterials | null | undefined,
  selectedStudent: { groupId?: string | null } | null | undefined,
): ClassroomWebappSummary | null {
  if (!classroom) return null;
  if (classroom.mode === 'advanced') return ownGroup(classroom, selectedStudent)?.webapp ?? null;
  return classroom.webapps?.[0] ?? null;
}
