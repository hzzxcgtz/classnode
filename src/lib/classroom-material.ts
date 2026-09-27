// ⚠️ 这两个是**运行期** import（`visibleModules` 真的要调它们）⇒ 必须带 `.ts` 后缀：
// 本文件被 `node --test` 直接执行（Node 的 ESM 解析不做扩展名补全），而 webpack 两边都认。
import { MODULE_KEYS, moduleStateOf } from './classroom-modules.ts';
import type {
  AgentSummary,
  ClassroomModuleKey,
  ClassroomModuleSetting,
  ClassroomModuleState,
  ClassroomWebappSummary,
  WorksheetMaterialSummary,
} from './types';

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

/** 组材料的**入参**形状：只声明本文件真正读的项，`StudentClassroom.groups` 结构上满足它。 */
interface GroupMaterials {
  id: string;
  /** 高级模式下卡片 / 弹窗要按组说明「这一份是谁的」，所以组名要读得到。 */
  name?: string | null;
  agent?: AgentSummary | null;
  webapp?: ClassroomWebappSummary | null;
  /** 该组的学习单（`resolveGroupMaterialViews` 下发；高级模式下「本组没配」是 `null`）。 */
  worksheet?: WorksheetMaterialSummary | null;
}

/**
 * 课堂材料的**入参**形状。
 *
 * ⚠️ 字段名以 `GET /code/:code` **实际**下发的为准（`server/src/routes/classroom.ts` 的
 * `res.json`：顶层 `agents` / `webapps` / `groups` 三个数组）—— 计划草稿里写的
 * `groups[].materials.{agent,webapp}` 那种嵌套形状**没有落地**，服务端下发的是扁平的
 * `{ id, name, agent, webapp }`。这里按实测的形状写。
 *
 * ⚠️ `GET /api/classroom/active`（教师端管理页读的那条）也是这个形状，只是课堂级那两项叫
 * `classroomAgents`（不是 `agents`）—— 调用方拼一下即可，`classroomMaterialsInUse` 只认这里的名字。
 */
interface ClassroomMaterials {
  mode?: string;
  groups?: GroupMaterials[];
  agents?: AgentSummary[];
  /** 课堂级网页（**标准 / 分组模式**的权威来源）。 */
  webapps?: ClassroomWebappSummary[];
  /** 课堂级学习单（`loadClassroomWorksheets` 下发；标准 / 分组模式的权威来源）。 */
  worksheets?: WorksheetMaterialSummary[];
  /** 各模块的三态。`visibleModules` 要用它，其余函数不读。 */
  modules?: readonly ClassroomModuleSetting[];
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

/**
 * 「这个学生此刻该作答哪一份学习单」。语义与上面两个**逐字相同**。
 *
 * 🔴 高级模式下 `null` 的含义是**「本组未配置学习单」**，不是「老师还没布置」——
 * 后者会让学生以为整间课堂都没有，而实际上可能是别的组有。调用方
 * （`worksheet-panel.tsx`）的文案必须照着这个区分写，**不拿课堂级那份顶上**
 * （规格 §8.4：与探究空间同口径）。
 *
 * ⚠️ 这个值是 `GET /api/worksheets/:id/student-view` 的 `:id` 来源。取错一份时
 * **服务端会拦住**（`requireOwnWorksheet` 的 ③：目标不是这一份就 403）—— 也就是说
 * 这里错了的表现是「学习单打不开」，而不是「学生答到了别人的单子上」。
 * 那层兜底在服务端，但它只说明错误可见，不说明这里可以随便写。
 */
export function effectiveGroupWorksheet(
  classroom: ClassroomMaterials | null | undefined,
  selectedStudent: { groupId?: string | null } | null | undefined,
): WorksheetMaterialSummary | null {
  if (!classroom) return null;
  if (classroom.mode === 'advanced') return ownGroup(classroom, selectedStudent)?.worksheet ?? null;
  return classroom.worksheets?.[0] ?? null;
}

/* ————————————— 教师端：「这间课堂在用什么材料」（按类型） ————————————— */

/** 一条材料引用：材料本身 + 高级模式下它属于哪个（或哪些）组。 */
export interface ClassroomMaterialItem<T> {
  material: T;
  /**
   * 用了这份材料的小组名。**标准 / 分组模式恒为空数组**（材料是课堂级的，不属于任何组）；
   * 高级模式下为空数组则意味着「服务端没给组名」，界面不该因此少显示一份材料。
   */
  groupNames: string[];
}

export interface ClassroomMaterialsInUse {
  agents: ClassroomMaterialItem<AgentSummary>[];
  webapps: ClassroomMaterialItem<ClassroomWebappSummary>[];
  worksheets: ClassroomMaterialItem<WorksheetMaterialSummary>[];
}

/**
 * 「**这间课堂**在用什么材料」—— 教师端（课堂卡片 / 课堂设置弹窗）的读口径。
 *
 * 与 `effectiveGroupAgent` / `effectiveGroupWebapp` 是同一枚硬币的两面：那两个问的是
 * 「**某个学生**用哪一份」，本函数问的是「**这间课堂**在用什么」—— 而权威来源的那条规矩
 * 是同一句（spec §4.4 / §4.3）：
 *   · `advanced`         → **只认各组**（课堂级那两个数组在该模式下服务端根本不写，
 *                           是幽灵行）；每组一份 ⇒ 同类会有多份，全部列出
 *   · `group` / `standard` → 课堂级那几个数组
 *
 * 🔴 **抽出来的理由是它已经错过一次**：课堂卡片的材料行与「课堂设置」弹窗都只读课堂级，
 * 于是高级模式那些课堂显示成「未关联」而其实每个组都配了 —— 与 2026-09-23 修掉的那个
 * 快照 bug 是同一个根因家族（材料的权威来源变了，读的地方没跟着变）。
 * 之后凡是要回答「这间课堂在用什么材料」的地方都走这里，别各读各的。
 *
 * ⚠️ 按 `id` 去重：同一个智能体/网页被多个组选中是合法的（高级模式里很常见），
 * 但列三遍同一个名字只会让人以为配置错了。组名合并进同一条。
 * ⚠️ 列表顺序 = 组顺序 / 数组顺序，**不排序** —— 调用方要「第一个」时（例如课堂级网页
 * 的单选语义）那个顺序就是服务端的权威顺序（`loadClassroomWebapps` 的
 * `orderBy createdAt asc, id asc`）。
 */
export function classroomMaterialsInUse(
  classroom: ClassroomMaterials | null | undefined,
): ClassroomMaterialsInUse {
  if (!classroom) return { agents: [], webapps: [], worksheets: [] };

  /** 去重 + 合并组名。`id` 是三种材料都有的唯一键。 */
  function collect<T extends { id: string }>(
    rows: Array<{ material: T | null | undefined; groupName: string | null }>,
  ): ClassroomMaterialItem<T>[] {
    const byId = new Map<string, ClassroomMaterialItem<T>>();
    for (const row of rows) {
      const material = row.material;
      if (!material) continue;
      const seen = byId.get(material.id);
      if (seen) {
        if (row.groupName && !seen.groupNames.includes(row.groupName)) seen.groupNames.push(row.groupName);
        continue;
      }
      byId.set(material.id, { material, groupNames: row.groupName ? [row.groupName] : [] });
    }
    return [...byId.values()];
  }

  if (classroom.mode === 'advanced') {
    const groups = classroom.groups ?? [];
    return {
      agents: collect(groups.map((group) => ({ material: group.agent, groupName: group.name ?? null }))),
      webapps: collect(groups.map((group) => ({ material: group.webapp, groupName: group.name ?? null }))),
      worksheets: collect(groups.map((group) => ({ material: group.worksheet, groupName: group.name ?? null }))),
    };
  }

  const classroomLevel = <T extends { id: string }>(items: T[] | undefined) =>
    collect((items ?? []).map((material) => ({ material, groupName: null })));
  return {
    agents: classroomLevel(classroom.agents),
    webapps: classroomLevel(classroom.webapps),
    worksheets: classroomLevel(classroom.worksheets),
  };
}

/* ————————————— 学生端：「他此刻该看见哪几个模块」 ————————————— */

/** 顶栏 Tab 与首页卡片共用的一项：模块键 + 此刻的三态。 */
export interface VisibleModule {
  moduleKey: ClassroomModuleKey;
  state: ClassroomModuleState;
}

/**
 * ★ 2026-09-27（教师）：「学生页面顶部的导航栏，如果三件套中有没有关联的内容，
 * 则相应图标也不要显示出来。」
 *
 * 学生此刻该看见哪几个模块 —— **顶栏 Tab 与首页卡片共用这一条**。
 *
 * 🔴 **抽出来的理由：这两处本来就各写了一份拷贝**（`use-module-tabs.ts` 的 `tabs` 与
 * `student-home.tsx` 的 `cards`，两处都是 `MODULE_KEYS.map(…).filter(state !== 'hidden')`）。
 * 拷贝本身还没出过错，但**这条判据现在要加第二个条件了** —— 再抄一遍，就是让
 * 「顶栏藏了、首页还摆着一张点进去什么都没有的卡」这种自相矛盾有地方可长。
 *
 * 「有没有东西可看」逐模块：
 *   · **学习单** → 这个学生**实际生效**的那一份（`effectiveGroupWorksheet`）
 *   · **探究空间** → 同上，网页（`effectiveGroupWebapp`）
 *   · **学伴**     → **恒为真**。它没有「材料」这回事：这节课没有配智能体时界面用兜底名，
 *                    学生照样能聊（`student-home.tsx` 的 `agentName`）。把它也按材料藏起来，
 *                    会让学生在「老师没配智能体」的课堂里连聊天入口都找不到。
 *
 * 🔴 **两个解析函数不许换成自己 `groups.find`**：高级模式下材料是按**组**分的，
 * 而「本组没配」与「这间课堂没有」是**两件事**（`effectiveGroupWorksheet` 的注释写了完整
 * 理由，也是本文件存在的理由）。正因为如此，判据必须收 `selectedStudent` —— 同一个课堂里
 * 不同组的学生看到的 Tab 可以不一样。
 *
 * ⚠️ `hidden` 优先于一切：教师明确关掉的模块，哪怕材料配了也不出现。
 * ⚠️ 顺序恒为 `MODULE_KEYS`（后端定的展示顺序），不按 `classroom.modules` 的数组顺序 ——
 *    与两个调用方原来的写法一致（§4.11 B6：数组下标会漂移）。
 * ⚠️ `classroom` 为 `null`（还没拿到会话）⇒ 空数组。**不是**「三个都给」：那会让 Tab 栏
 *    先闪一下三个、再收成一个。
 */
export function visibleModules(
  classroom: ClassroomMaterials | null | undefined,
  selectedStudent: { groupId?: string | null } | null | undefined,
): VisibleModule[] {
  if (!classroom) return [];
  return MODULE_KEYS
    .map((moduleKey) => ({ moduleKey, state: moduleStateOf(classroom.modules, moduleKey) }))
    .filter((entry) => entry.state !== 'hidden'
      && moduleHasContent(entry.moduleKey, classroom, selectedStudent));
}

/** 见 `visibleModules` 的注释。「学伴」那一支的 `true` 与它上面那段理由是一体的。 */
function moduleHasContent(
  moduleKey: ClassroomModuleKey,
  classroom: ClassroomMaterials,
  selectedStudent: { groupId?: string | null } | null | undefined,
): boolean {
  if (moduleKey === 'learning-sheet') return effectiveGroupWorksheet(classroom, selectedStudent) !== null;
  if (moduleKey === 'explorer') return effectiveGroupWebapp(classroom, selectedStudent) !== null;
  return true;
}
