# 按组的课堂材料（`ClassroomGroupMaterial`）

> ⚠️ **本文取代 `specs/2026-09-22-p2-group-optional-agent.md`（及其计划 `.…-plan.md`）。**
> 那一份把问题定成「`ClassroomGroup.agentId` 改成可空」。用户 2026-09-22 追加要求后，
> 问题变成「**每个小组可以各自指定 AI 智能体 / 探究网页 / 学习单**」——
> 「agentId 可空」只是它在智能体这一种材料上的特例，而且是**更差的解法**
> （见 §5「为什么不是把 agentId 改成可空」）。旧文档两份都已在开头标注被取代。

**Goal:** 高级模式下，每个小组各自指定 AI 智能体、探究网页（学习单将来同样）。

**Tech Stack:** Prisma + SQLite（`server/`，ESM + TypeScript）；Next.js 15 静态导出 + React 18（`src/`）；Node 内置测试运行器。

**Spec 依据：** `specs/2026-09-20-p2-explore-assistant.md` 的 Global Constraints 对本任务同样生效（尤其 2 / 7 / 7b / 7c / 7d / 10 / 11）。

---

## 一、背景与现状

### 1.1 三件材料的现状（逐处核过代码）

| 材料 | 现有模型 | 能不能按组不同 |
|---|---|---|
| AI 智能体 | `ClassroomGroup.agentId`（`schema.prisma:153`）**一列**，必填 | ✅ **可以**（这是要保留的能力） |
| 探究网页 | `ClassroomWebapp`（`schema.prisma:235-248`），**课堂级** | ❌ 而且**单选**（创建页 `selectedWebappId`） |
| 学习单 | 无模型（`classroomMaterialError` 里固定传 `worksheet: 0`） | ❌ 尚未实现 |

> 🔴 **2026-09-23 过期（P1 学习单的第一批服务端落地后即失效）**：上表第三行**整行都不再成立** ——
> `Worksheet` / `ClassroomWorksheet` / `WorksheetResponse` / `WorksheetAnswer` 四张表已建，
> `ClassroomGroupMaterial` 的 `kind` 已在写 `'worksheet'`，
> `classroomMaterialError` 那两处 `worksheet` 也**已经是真数字**（不再是固定 0）：
> 标准/分组数课堂级那一份，高级模式数**真的配了的组级学习单数**。
> 本节余下的分析（推广「按组指定」到三种材料）**结论仍然有效**，
> 只是第三行描述的那个「尚未实现」的空白已经被填上 —— 见 `specs/2026-09-23-p1-worksheet.md` §4 / §5。
> 写作时（09-22）这句话是真的，保留原文是为了留下「当时以为学习单要零成本接入、结果确实只差一个枚举」这个判断痕迹。

⇒ 本任务把「按组指定」从智能体一种**推广到三种**，并让学习单将来零成本接入。

### 1.2 顺带修掉的三处既有缺陷（都逐行核过，不是推断）

**① 🔴 组没有智能体时，学生静默地跟别的组的智能体对话**
`server/src/socket/index.ts:1816-1823`：`classroomStudent.group?.agentId` 为假时**回落到 `classroomAgents[0]`**，而高级模式下那个数组是**各组智能体的并集** ⇒ 学生静默地拿到另一组的智能体（错名字、错提示词、错平台账号），AI 正常回答、教师完全看不出。

**② 🔴 `GET /code/:code` 解引用 null 会让整间课堂打不开**
`server/src/routes/classroom.ts:809-816`：`agent: { id: group.agent.id, … }` 是非空解引用。`groups` 的 include 是 `{ agent: true }` ⇒ 组无智能体时 `null.id` → TypeError → 被 catch 吞成 500 ⇒ **该课堂所有学生都进不去**。（这一处今天还没触发，只因为「组无智能体」目前根本建不出来。）

**③ 分组模式「不选智能体 + 选网页」是 500（现网可达）**
`server/src/routes/classroom.ts:313`：`agentId: uniqueAgentIds[0]` 在空数组时是 `undefined`，而 TS 认为它是 `string` ⇒ `tsc` 一声不吭，Prisma 在事务里抛必填缺失 → 500「创建课堂失败」。前端 `new/page.tsx:278` 的「分组模式」是一等入口，`:129` 明确允许这个组合。

### 1.3 分组模式与高级模式的分工（用户裁定，2026-09-22）

- **高级模式（`advanced`）**：按组指定材料 —— **本次要做**。
- **分组模式（`group`）**：保持现状 —— 全班同一套材料，只是学生分小组讨论。所有组共用一个智能体。
  ⚠️ 分组模式的组是**从班级分组自动生成**的（`classroom.ts:305-316` 遍历 `classGroup`），不是教师逐个建的；给它们各配一份材料要多出一整套配置界面。

---

## 二、目标与非目标

**目标**

1. 高级模式每个小组可各自指定：AI 智能体、探究网页。
2. 机制**统一**：三种材料共用一张关联表，用 `kind` 区分；学习单落地时只需加一个 `kind` 值。
3. 「某组不指定」是**合法状态**，且语义与智能体已定的口径一致：**该组没有那种材料，全程不回落**。
4. §1.2 的三处缺陷一并消除。
5. 删除守卫跟着扩到新表（**漏了会删出悬空引用**）。

**非目标**

- **不做学习单本体**（只留位置）。
- **不做分组模式按组**（见 §1.3）。
- **不做运行时改组绑定** —— 创建后不可更改的既有产品决定不变。
- 不引入任何新依赖。

---

## 三、Global Constraints（本任务附加）

1. **既有测试必须继续全过。** 基线以动手前实测为准（**2026-09-22 实测：272 pass / 0 fail**），不要引用更早的数字。
2. 不得出现 regex lookbehind；不得使用 `Object.hasOwn` / `structuredClone` / `Array.prototype.at` / `findLast` / `:has()` / `@container` / `content-visibility`。
3. **不新增任何 npm 依赖。**
4. 提交信息中文；报告、注释、过程旁白一律中文（引用的原始输出保持原样）。
5. 🔴 **绝不 `prisma db push` 打在真实库上（`server/prisma/dev.db`）。** 本任务要在临时库上跑 `db push` 只为**导出权威 DDL** —— 必须 `DATABASE_URL="file:/tmp/…"`，用完删掉。这条真踩过（删掉了活库一整列）。
6. 不要用 `reset-password` 造教师数据（它会 `revokeAllTeacherSessions()`）。
7. **只允许一个 `pnpm build` / `pnpm test` 在跑。**
8. **跑 `pnpm build` 之前先 `./dev.sh stop`，跑完 `./dev.sh start`，最后 `./dev.sh status` 复核 4000/4001 都在。** 被踩过三次。
9. 不碰 `CLAUDE.md` / `dev.sh` / `package.json`。
10. 测试若改数据库，必须逐表还原并给出证据；造测试数据一律用 `/tmp` 下的副本库。
11. 🔴 **任何「因此不扫 / 排除 / 安全 / 可以忽略」的结论，必须附一条命令或一段实测输出。**

---

## 四、设计

### 4.1 数据模型

```prisma
/// 小组级课堂材料：高级模式下每个小组各自指定的智能体 / 探究网页 /（将来）学习单。
model ClassroomGroupMaterial {
  id        String   @id @default(uuid())
  groupId   String
  kind      String   // 'agent' | 'webapp' | 'worksheet'
  targetId  String   // Agent.id / Webapp.id /（将来）Worksheet.id
  createdAt DateTime @default(now())

  group ClassroomGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)

  /// 每组每种材料**至多一个** ⇒ 「单选」是数据库层面的约束，不是 UI 约定。
  @@unique([groupId, kind])
  /// 反查「这个材料被哪些组用了」—— 删除守卫与 `/usage` 走这条。
  @@index([kind, targetId])
}
```

**`ClassroomGroup.agentId` 随之删除**（详见 §4.2 的迁移）。

### 4.2 迁移

**⚠️ 这是一次 SQLite 表重建 + 数据搬迁，比「改一列可空」大。**

步骤（**按此顺序**）：

1. **备份**：复用 `index.ts:39-53` 泛化出来的 `backupDatabase(label)`；**备份失败必须中止**（改的是结构，没有备份就没有回滚依据）。标记：`Setting` 键 `classroom-group-materials-migration-v1`。
2. **建新表** `ClassroomGroupMaterial`（DDL 逐字取自「在临时库上 `db push` 后 dump 出来的权威输出」，见 §4.2 的方法说明）。
3. **搬数据**：`INSERT INTO ClassroomGroupMaterial (id, groupId, kind, targetId) SELECT <uuid>, id, 'agent', agentId FROM ClassroomGroup WHERE agentId IS NOT NULL`。
   ⚠️ 逐行生成 uuid（Prisma 的 `@default(uuid())` 是**客户端**生成的，手写 SQL 必须自己给）。可以用 `lower(hex(randomblob(4))) || '-' || …` 那种 SQLite 表达式，**但更稳的是先读出行、再在 JS 里 `crypto.randomUUID()` 逐条插入** —— 搬的是「每节课每组的智能体」，量级是几十行，逐条没有性能问题，而 uuid 的格式差异会带来难查的后续问题。
4. **重建 `ClassroomGroup` 去掉 `agentId`**：照 `participant-migration.ts:84-114` 的既有范式（`PRAGMA foreign_keys = OFF` → CREATE new → INSERT SELECT → DROP → RENAME → 重建索引 → `foreign_keys = ON`）。
   - 🔴 `ClassroomGroup` 被两张子表外键引用：`ClassroomStudent.groupId`（真实库实测 **ON DELETE SET NULL**）与 `ClassroomGroupMember.groupId`（**ON DELETE CASCADE**）。pragma 没生效就会**静默毁掉子表数据**。
   - 🔴 `PRAGMA foreign_keys` **按连接生效**（Prisma 有连接池）**且在事务内无效**。所以不得包进 `$transaction`，且**必须有带子表数据的测试**当裁判（见 §6.1）。
5. 🔴 **把课堂级网页「实体化」成每组一份**（这一步不能省，否则是**行为回归**）。
   今天**高级模式也会写一条课堂级的 `ClassroomWebapp`**（`routes/classroom.ts:405`），所有组共用它。改成按组之后，那些组每组的「没配网页」都会触发 §4.4 的「不回落」⇒ **已存在的课堂会突然什么都看不到**。
   ⇒ 迁移时对**每一个高级模式、且有一条课堂级网页关联**的课堂：给它的**每个组**写一行 `kind='webapp'`、`targetId = 该课堂级网页`。
   - 判据是 `Classroom.mode = 'advanced'`；标准/分组模式不动（它们继续用课堂级网页）。
   - 这一步放在第 3 步之后、第 4 步之前都行，但**必须在标记置位之前**完成。
   - ⚠️ 它同样是「改数据」，所以**备份要先于它**（备份在第 1 步）。
6. **DDL 必须与 Prisma 的输出逐字一致** —— 否则桌面版下次 `db push` 会再重建一次，而按 `table_info` 探测的同步块不会重跑，两边分叉。

**迁移后仍然存在、但变成惰性的东西（如实记）**：今天高级模式从各组 agentId 派生出 `ClassroomAgent` 行（`routes/classroom.ts:437-438`）。派生被删掉之后**新课堂不再产生它们**，但**老课堂里已有的那些行还在**。它们是惰性的（§4.4 规定高级模式不回落，读不到它们），**本次不删** —— 删历史行属于另一个决定，而且删错了不可逆。

**方法说明（怎么拿到权威 DDL）**：把改动写到 `schema.prisma`，复制到 `/tmp`，`DATABASE_URL="file:/tmp/probe.db" prisma db push`，再 `sqlite3 .schema`。**不碰真实库。**

### 4.3 写入路径（`POST /api/classroom/create-advanced`）

`routes/classroom.ts:373-379` 的窄化扩成三种材料，每组的载荷形态：

```ts
groups: [{ name, agentId: string | null, webappIds: string[] | null, studentIds }]
```

- **空串与缺字段一律归一成 `null`**（否则 `''` 会成为第三种状态落库；它与 `null` 在 `?.` 判空里表现一致，看起来是对的，直到有人写 `where: { targetId: null }` 的统计）。
- 落库：对每个非 null 的材料写一行 `ClassroomGroupMaterial`。
- 🔴 **高级模式不再写课堂级网页**（`routes/classroom.ts:405` 那一行删掉）：网页在高级模式下的权威来源变成「每组一份」。留着它会长出「这个课堂级网页到底谁在用」的第二套解释，而 §4.4 又规定了不回落 ⇒ 它会变成一个**永远看不见、但删不掉**（会挡住删除守卫）的幽灵。
  ⚠️ 已存在的课堂由 §4.2 第 5 步实体化保证不回归。
- **三件套判据**（`:389-394`）改成按**真的配了的材料数**计：`agent` / `webapp` 都改成数非空项，`worksheet` 仍为 0。用组的数量冒充会让「所有组都不配 + 没有课堂级材料」的空课堂建出来（而 `:151-152` 的注释写明这正是这条规则要防的）。

  > 🔴 **2026-09-23 过期（P1 落地后即失效）**：上面这句里的「`worksheet` 仍为 0」**已不成立** ——
  > P1 把第三项也改成了真数字：标准/分组数课堂级那份（`worksheet: worksheet.id ? 1 : 0`），
  > 高级模式数真的配了的组级学习单数（`normalizedGroups.filter(g => g.worksheetId).length`）。
  > 本行其余部分（`agent` / `webapp` 数非空项、以及「不能用组的数量冒充」的理由）**继续有效**。
- `:437-438` 从各组 agentId 派生 `classroomAgents` 的那段**删掉**：迁移后组不再有 agentId，而且高级模式下这个数组本就是「各组并集」，语义可疑（§1.2 ① 正是它造成的）。⇒ 高级模式下 `classroomAgents` **不再派生**，学生端的智能体一律来自自己的组。

### 4.4 运行期：学生用哪一份材料

抽取两个**纯函数**（可逐组合断言，不靠端到端手测）：

```ts
// server/src/socket/index.ts（或独立模块）
export function resolveGroupTarget<T>(mode, groupsWithMaterials, studentGroupId, kind: 'agent' | 'webapp'): T | null
```

语义（**用户 2026-09-22 裁定**）：

- **`advanced`**：只认**学生自己的组**。该组没有那种材料 ⇒ **`null`，不回落**。
  🔴 **不得回落到课堂级数组** —— 那是「静默用错别人的材料」，正是 §1.2 ① 的形态。
- **`group` / `standard`**：材料的权威来源是**课堂级**（`ClassroomAgent` / `ClassroomWebapp`），与今天一致。
  ⇒ 分组模式那个 500（§1.2 ③）随之消失：它不再写 `agentId: uniqueAgentIds[0]`，而是继续用课堂级的智能体。

### 4.5 读路径（`GET /api/classroom/code/:code`）

`routes/classroom.ts:804-818` 的 `groups[]` 从「带 agent」改成「带三种材料」：

```ts
groups: groups.map(group => ({
  id: group.id,
  name: group.name,
  materials: { agent: <条件构造，可能为 null>, webapp: <同上>, worksheet: null },
}))
```

- 🔴 **`agent` 必须是条件构造**：`group.agent ? {…} : null`。今天那处非空解引用就是 §1.2 ②，会让整间课堂 500。
- ⚠️ 形状变化是**破坏性**的（`agentId`/`agent` 两个字段被 `materials` 取代）⇒ 客户端与 `socket-events.ts` 的契约、以及 `classroom-webapp-link.test.ts` 里断言该形状的用例都要一起改。

> 🔴 **2026-09-23 更正（P1 落地后回溯）**：上面那段形状**两处与实现不符**，都已在代码里定形：
>   1. **不是嵌套的 `materials`，是扁平的**。服务端下发的是
>      `groups[].{ id, name, agent, webapp, worksheet }` —— `classroom-material.ts` 的注释
>      逐字记着这件事：「计划草稿里写的 `groups[].materials.{agent,webapp}` 那种嵌套形状
>      **没有落地**，服务端下发的是扁平的 `{ id, name, agent, webapp }`」。
>      （09-22 时 `webapp` 确实先落成了扁平，P1 又照同一个形状加了 `worksheet`。）
>   2. **`worksheet: null` 已过期** —— 它就是「学习单尚未实现」那句话的残影（见 §1.1 的更正）。
>      今天这里是真的三态：`worksheet: { id, title } | null`，由
>      `resolveGroupMaterialViews()` 拼出（三条 `in` 查询，不是逐组 `findUnique`）。
>
> ⚠️ 顺带一句仍然有效的提醒：**`targetId` 是多态的**，三种 `kind` 共用一列 ⇒
> 解析时绝不能「有材料行就用它的 targetId」（那会让「这一组只配了网页」变成「它有学习单」）。

### 4.6 学生端

- `classroom.groups[].materials.webapp` 是学生端「我该打开哪个网页」的**唯一**依据（高级模式）。
- 该组没有网页 ⇒ 探究空间模块显示**「本组未配置探究网页」**，**不拿课堂级那个顶上**。
- 同样地，智能体解析抽成一个纯函数（`effectiveAgentFor` 那一类），**高级模式不回落**，与今天的口径一致。

### 4.7 删除守卫（两处，漏了会删出悬空引用）

| 位置 | 现在数什么 | 改成 |
|---|---|---|
| `routes/agents.ts:375-380`（`/usage`）与 `:431-432`（DELETE 守卫） | `classroomAgent` + `classroomGroup.agentId` | `classroomAgent` + `classroomGroupMaterial(kind='agent')` |
| `routes/webapps.ts:692`（DELETE 守卫，`:445-453` 的 `/usage` 同理） | `classroomWebapp` | 加上 `classroomGroupMaterial(kind='webapp')` |

⚠️ 网页那一侧**今天是课堂级一条路径**，加了组级之后变两条 —— 这正是「漏一处就删出悬空」的地方。两处都要有**真库测试**。

### 4.8 创建页 UI（高级模式）

每组的行从「1 个下拉」变成「2 个下拉」（学习单落地后 3 个）。要点：

- 每个下拉都要有**「不指定」这一项**，且必须与「还没选」**在视觉上可区分**（用 `null` 表示已选不指定、键不存在表示未选 —— 写回 `''` 会让 `every(g => g[kind][g.id])` 把「不指定」判成「没配置」而拦住提交，功能等于没做）。
- 「每组都必须做出决定」的校验照今天的 `allDecided`（`g.id in groupMaterials`）逐 kind 各做一次。
- 进度条 / 摘要 / 底部计数都要跟着改，否则它们会说谎。
- ⚠️ 这一格会明显变挤 —— **排布要重新设计**，不是把两个下拉并排塞进去了事。

---

## 五、为什么不是把 `agentId` 改成可空（旧方案）

旧 spec 的解法是「`agentId` 改可空 + 迁移表」。它在**只考虑智能体一种材料**时是对的，但：

1. 网页与学习单**没有对应的列**可以改可空 —— 它们要么各加一列、要么各加一张表，于是**三套平行机制**。
2. 更重要的是 `schema.prisma:158` 的 `onDelete: Cascade`：**删掉一个智能体会把整行小组级联删除**（连带 `ClassroomStudent` 参与者与成员快照）。改成可空只是把这个风险留在原地；换成关联表之后，最坏结果是**一条悬空引用**（读不到目标 ⇒ 显示成「未配置」），**不会丢数据**。这是本设计的一条实质收益，不只是「统一好看」。

**代价（必须明说）**：`ClassroomGroupMaterial.targetId` 是**多态**的，**没有真外键**。补偿是 §4.7 的两处守卫 + 运行时容忍悬空 id（读不到 ⇒ 当未配置）。

---

## 六、测试要求

### 6.1 🔴 迁移测试必须**自己造旧表**，不得用 `db push` 建的临时库

现有测试的临时库由 `prisma db push` 生成（`classroom-webapp-link.test.ts:21-30`），那种库里表**天生就是新形状** ⇒ 拿它测迁移会**永远绿**，而真实老库仍然坏。这是本项目反复出现的假绿形态。

⇒ 迁移用例必须手工 `CREATE TABLE` 出**旧形状**（含 `agentId NOT NULL` 与两张子表），插几行数据，再调迁移，断言：

- `ClassroomGroup` 不再有 `agentId` 列；`ClassroomGroupMaterial` 存在且**每个非空 agentId 恰好对应一行** `kind='agent'`
- 原 `ClassroomGroup` 各行的 `id`/`classroomId`/`name`/`sourceClassGroupId` **逐行不变**
- 🔴 **两张子表的数据原样幸存**（`ClassroomStudent.groupId` 没被 SET NULL、`ClassroomGroupMember` 行没被级联删除）—— `PRAGMA foreign_keys` 按连接生效，pragma 没落到执行 `DROP TABLE` 的那条连接上就会**静默毁数据**。没有子表数据的迁移测试**测不到**这个坑。
- 索引 `ClassroomGroup_classroomId_idx` 仍在
- **反证（阴性对照）**：把探测条件反过来必须失败，用来证明这条用例真的在区分「迁了」与「没迁」，而不是断言恒真

### 6.2 其余

- **运行期纯函数**：`advanced` + 自己组有 / 自己组无 / 找不到组 / `group` 模式 / `standard` 模式 逐组合断言。**「自己组无」那条必须带反证**：课堂级数组里**故意放一个别的组的材料**，断言学生**没拿到它**。
- `GET /code/:code`：含「某组没配」的课堂返回 **200**、该组材料为 null（不是 500）。
- 删除守卫：**只被组级引用**的智能体 ⇒ `/usage` 的 `used` 为真且删除被 400 拦下；网页同理。**「组级引用」这一条是新的，必须有独立用例** —— 它正是最容易漏的那一处。
- 分组模式：不选智能体 + 选网页 ⇒ **200**（回归 §1.2 ③ 的 500）。
- 三件套：所有组都不配 + 无课堂级材料 ⇒ 400。
- 契约形状变更：`classroom-webapp-link.test.ts` 里断言 `groups[].agent` 的用例要改成新形状。

---

## 七、验收清单

**A. 迁移**
- [ ] 旧形状的库跑一次服务：列没了、材料表有数据、**子表数据逐行幸存**、具名约束与索引逐字保留
- [ ] 备份文件真的产生在 `backups/` 下；备份失败时迁移**中止**（造 `DATABASE_URL` 指向不存在文件的场景验证）
- [ ] 第二次启动不重复迁移、不重复备份（Setting 标记生效）
- [ ] **全程没有跑过 `prisma db push` 打真实库**（给出命令历史作为证据）

**B. 创建与运行**
- [ ] 高级模式：某组只配网页不配智能体 ⇒ 建得出来；该组学生发消息得到「未配置AI智能体」（**不借用别组的**）
- [ ] 高级模式：某组配了网页 ⇒ 该组学生打开探究空间看到的是**那个**网页
- [ ] 高级模式：某组没配网页 ⇒ 该组学生看到「本组未配置探究网页」（**不是课堂级那个**）
- [ ] `GET /code/:code` 对含空材料的组返回 **200**
- [ ] 分组模式：不选智能体 + 选网页 ⇒ 200
- [ ] 「不指定」与「还没选」在 UI 上可区分；「还没选」被拦住提交

**C. 回归**
- [ ] 标准模式照旧；分组模式照旧（全班共用课堂级材料）
- [ ] 高级模式各组都配齐时，学生端行为与改动前一致
- [ ] 删除守卫照旧拦得住课堂级引用

**D. 门禁**
- [ ] `npx tsc --noEmit` 退出 0、零输出
- [ ] `npx eslint src/app/classroom/ src/lib/` 退出 0
- [ ] `./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status`，**4000/4001 都在**
- [ ] `cd server && pnpm test` 全过（与动手前实测基线比对）

---

## 八、悬而未决

1. **学习单的 `kind` 值先占位还是等到真做时再加** —— 本设计两种都行（`kind` 是自由字符串）。倾向：**现在不写**，避免一个永远为空的分支；加的时候只加一个值 + 一处 UI。
2. **创建页每组两个下拉的排布** —— §4.8 说要重新设计，具体形态留给实施时定，但**必须先出效果再改代码**（这一格会明显变挤）。
3. **真实库迁移需要用户参与** —— 合并前用库副本验证；合并后需在用户自己的真实库上确认一次。
