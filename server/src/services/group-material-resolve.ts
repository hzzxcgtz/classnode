import type { PrismaClient } from '@prisma/client';

/**
 * 「该学生此刻该用哪一份材料」——**唯一**的解析口径。
 *
 * 抽成纯函数是为了逐组合断言。这三行是本改动最危险的地方：内联在
 * send-message 处理器里只能靠端到端手测。
 *
 * 🔴 **高级模式下不得回落到课堂级**。实测过的一种形态：那个数组在高级模式下曾是
 * 「各组材料的并集」，回落到它等于让学生静默地用另一个组的智能体/网页，
 * 而 AI 正常回答、教师完全看不出（见 spec §1.2 ①）。
 */
export function resolveMaterialTargetId(input: {
  mode: string;
  studentGroupId: string | null | undefined;
  groupMaterials: { groupId: string; kind: string; targetId: string }[];
  classroomLevelId: string | null;
  /**
   * 三件套的第三项（学习单，P1）与另外两项**共用同一条判据** —— 加它只是扩一个枚举值。
   *
   * ⚠️ 匹配用的是 `m.kind === input.kind` 的**相等**比较，而 `targetId` 是**多态**的
   * （同一列既可能指向 Agent / Webapp，也可能指向 Worksheet）⇒ 绝不能写成
   * 「有材料行就用它的 targetId」：那会让「这一组只配了网页」变成「它有学习单」。
   */
  kind: 'agent' | 'webapp' | 'worksheet';
}): string | null {
  if (input.mode === 'advanced') {
    if (!input.studentGroupId) return null;
    const hit = input.groupMaterials.find(
      (m) => m.groupId === input.studentGroupId && m.kind === input.kind,
    );
    return hit ? hit.targetId : null;   // 没有就是没有，**不回落**
  }
  return input.classroomLevelId;
}

/**
 * 某个**参与者**（学生或小组）在本课堂里实际该用哪个探究网页。
 *
 * 与 `resolveMaterialTargetId` 的关系：那个函数是**唯一口径**，本函数只负责把它的入参
 * 查齐 ——「高级模式不回落」这类规则一条都不在这里重写。
 *
 * 抽出来的理由：这个判定原本内联在 `socket/index.ts` 的 `resolveWebappReporter` 里，
 * **测试够不着**，于是它按一个已经失效的假设（课堂级关联表是权威）跑了好几轮都没人发现：
 * 分组材料那一轮把高级模式的网页权威改成了「每组一份」，`ClassroomWebapp` 在该模式下
 * **恒为空** ⇒ 学生端每一帧都被拒，而学生端一直在正常上报
 * （2026-09-23 用户报「探究空间的快照完全不显示」，电脑端与 iPad 都一样）。
 *
 * @returns 该参与者该用的网页 id；没有（或课堂/参与者不存在）就是 `null`。
 */
export async function resolveParticipantWebappId(
  prisma: PrismaClient,
  input: { classroomId: string; participantId: string },
): Promise<string | null> {
  const { classroomId, participantId } = input;

  // 两条互不依赖的查询**并行**（帧虽然低频 —— ≤ 每 5 秒一条 / 人 —— 但没有理由串行）。
  const [classroom, participant] = await Promise.all([
    prisma.classroom.findUnique({
      where: { id: classroomId },
      select: { mode: true },
    }),
    prisma.classroomStudent.findFirst({
      // ⚠️ `classroomId` 必须留在 where 里：参与者 id 是全局唯一的，但少了这半边，
      //    一个「属于别的课堂」的 id 会拿到那个课堂的材料。
      where: { id: participantId, classroomId },
      select: { groupId: true },
    }),
  ]);
  if (!classroom || !participant) return null;

  // 再并行两条：本课堂各组配的网页 + 课堂级那一份。
  //
  // 🔴 `orderBy` 必须与读路径的 `loadClassroomWebapps`（`routes/webapps.ts`）**逐字一致**。
  //    学生端目前只加载 `webapps[0]`（P2 的已知收窄），读路径的「第一个」就是学生的
  //    「唯一那一个」；两处顺序一旦不同，就会出现「教师看到的」与「学生实际用的」
  //    不是同一个，而界面上**没有任何地方**能看出来。
  //    兜底的 `id` 那一级不是装饰：`ClassroomWebapp.createdAt` 在 SQLite 上只有秒精度，
  //    一次嵌套 create 写多行会拿到**逐字相同**的时间戳（见 `routes/classroom.ts`
  //    的 `webappLinkRows`），少了它就退化成「随机取一个」。
  const [groupMaterials, classroomLevel] = await Promise.all([
    prisma.classroomGroupMaterial.findMany({
      where: { kind: 'webapp', group: { classroomId } },
      select: { groupId: true, kind: true, targetId: true },
    }),
    prisma.classroomWebapp.findFirst({
      where: { classroomId },
      select: { webappId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);

  return resolveMaterialTargetId({
    mode: classroom.mode,
    studentGroupId: participant.groupId,
    groupMaterials,
    classroomLevelId: classroomLevel?.webappId ?? null,
    kind: 'webapp',
  });
}

/**
 * 读路径下发给客户端的「组」里的材料：三件套**都可能为 null**。
 * `agent` 的字段集合与 `classroomAgents[].agent` 一致，避免前端拿到两种 Agent 形状。
 *
 * ⚠️ 学习单只下发 `{ id, title }`：题目结构（`content`）**不在**引导载荷里 ——
 * 它由学生端单独按 id 拉取（服务端会先剥掉答案字段，见 B3 的 `student-view`）。
 */
export type GroupMaterialView = {
  agent: {
    id: string; name: string; logo: string | null; platform: string;
    enabled: boolean; greeting: string | null;
  } | null;
  webapp: { id: string; name: string; entryPath: string } | null;
  worksheet: { id: string; title: string } | null;
};

/**
 * 「这一组没有任何材料」——🔴 五条下发 `groups[]` 的路径**共用这一个常量**当兜底。
 *
 * 从前每条路径各写一遍对象字面量 `{ agent: null, webapp: null }`。那**不是**类型安全的：
 * 展开进对象里的字面量不会被 TS 按 `GroupMaterialView` 校验，所以给
 * `GroupMaterialView` 加一个字段时，漏改其中一条路径**编译通过、测试也全绿**，
 * 而那条路径下发的组会**少一个键**。本项目已经吃过一次同样的亏（见上面那段
 * 「形状在其中一条上分叉一次」）—— 提成一个常量之后，加字段而漏改兜底会**编译不过**。
 */
export const EMPTY_GROUP_MATERIAL_VIEW: GroupMaterialView = { agent: null, webapp: null, worksheet: null };

/**
 * 「组的材料」**读路径的唯一解析口径** —— 把若干组的 `ClassroomGroupMaterial` 行解析成
 * `{ agent, webapp, worksheet }`（各自可能为 null）。
 *
 * 🔴 **每一条下发 `groups[]` 的路径都必须走这里**：`GET /code/:code`、`GET /:id`、
 * `GET /all`、`GET /active`，以及 `join-classroom`。形状在其中一条上分叉一次，就会变成
 * 「教师管理页看到的」与「学生打开的那个」不是同一个，而那种不一致没有任何界面提示
 * （与 `loadClassroomWebapps` 同一条规矩）。
 *
 * ⚠️ 三个 null 都是**正常**状态，不是错误：
 *   · 组可以不配这种材料（高级模式每组独立决定）；
 *   · `targetId` 是**多态**的、没有真外键 ⇒ 目标可能已经被删（删除守卫是唯一防线，
 *     它拦不住「先建课堂、后删目标」以外的历史数据）。
 *   今天那处非空解引用（`group.agent.id`）在组无智能体时会抛 TypeError ⇒ **整间课堂 500**，
 *   所有学生都进不去。所以这里是条件构造，不是 `?.` 糊过去。
 *
 * 查询形态：一次性把材料指向的智能体 / 网页 / 学习单各查一条 `in` 查询（**三条**，与组数无关），
 * 不用逐组 `findUnique`（那是 N+1：`/all` 一次要下发十几个课堂的各组）。
 */
export async function resolveGroupMaterialViews(
  prisma: PrismaClient,
  groups: { id: string; materials: { kind: string; targetId: string }[] }[],
): Promise<Map<string, GroupMaterialView>> {
  const agentIds = new Set<string>();
  const webappIds = new Set<string>();
  const worksheetIds = new Set<string>();
  for (const group of groups) {
    for (const material of group.materials) {
      if (material.kind === 'agent') agentIds.add(material.targetId);
      else if (material.kind === 'webapp') webappIds.add(material.targetId);
      else if (material.kind === 'worksheet') worksheetIds.add(material.targetId);
    }
  }
  const [agents, webapps, worksheets] = await Promise.all([
    agentIds.size > 0 ? prisma.agent.findMany({ where: { id: { in: [...agentIds] } } }) : [],
    webappIds.size > 0 ? prisma.webapp.findMany({ where: { id: { in: [...webappIds] } } }) : [],
    worksheetIds.size > 0 ? prisma.worksheet.findMany({ where: { id: { in: [...worksheetIds] } } }) : [],
  ]);
  const agentById = new Map(agents.map(agent => [agent.id, agent]));
  const webappById = new Map(webapps.map(webapp => [webapp.id, webapp]));
  const worksheetById = new Map(worksheets.map(worksheet => [worksheet.id, worksheet]));

  const views = new Map<string, GroupMaterialView>();
  for (const group of groups) {
    const agentRow = group.materials.find(material => material.kind === 'agent');
    const webappRow = group.materials.find(material => material.kind === 'webapp');
    const worksheetRow = group.materials.find(material => material.kind === 'worksheet');
    const agent = agentRow ? agentById.get(agentRow.targetId) : undefined;
    const webapp = webappRow ? webappById.get(webappRow.targetId) : undefined;
    const worksheet = worksheetRow ? worksheetById.get(worksheetRow.targetId) : undefined;
    views.set(group.id, {
      agent: agent
        ? {
            id: agent.id, name: agent.name, logo: agent.logo, platform: agent.platform,
            enabled: agent.enabled, greeting: agent.greeting,
          }
        : null,
      webapp: webapp ? { id: webapp.id, name: webapp.name, entryPath: webapp.entryPath } : null,
      // `title` 而已 —— 题目结构不进引导载荷（见 `GroupMaterialView` 的注释）。
      worksheet: worksheet ? { id: worksheet.id, title: worksheet.title } : null,
    });
  }
  return views;
}
