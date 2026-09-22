# 分组可选智能体（`ClassroomGroup.agentId` 可空）

> 🔴 **本文件已被取代，不要照着它实施。**
> 用户 2026-09-22 追加要求「每个组也可以各自指定探究网页与（将来的）学习单」之后，
> 问题从「一个字段可空」变成了「**按组的课堂材料**」。权威文档是
> **`specs/2026-09-22-p2-group-materials.md`**，配套计划 `…-plan.md` 同样作废。
>
> 保留本文件的理由：它里面的三处既有缺陷分析（§1.1–1.3）已被新文档继承并逐条引用，
> 而「为什么不是把 agentId 改成可空」这个取舍记录在新文档 §5。

**Goal:** 让「分组模式」与「高级模式」的每一个小组都能**不指定智能体**——三件套（AI 智能体 / 探究网页 / 学习单）规则下智能体本身就不是必填项，按组指派时同样应该可选。

**Spec 依据：** `specs/2026-09-20-p2-explore-assistant.md` 的 **Global Constraints 1–11** 对本任务同样生效（尤其 2/7/7b/7c/7d/10/11）。P2.3 引入三件套时把标准模式的智能体改成了选填（`classroom-webapp-link.test.ts:236` 是它的守卫），本任务是那条规则在分组维度上的补齐。

---

## 一、背景与现状：三处已核实的缺陷

改这个字段会同时撞上三个**当前就存在**的问题。三条都由控制器逐行打开文件核对过，不是推断。

### 1.1 🔴 组没有智能体时，学生静默地跟**别的组**的智能体对话

`server/src/socket/index.ts:1562-1568`：

```ts
let agent;
if ((classroom.mode === 'group' || classroom.mode === 'advanced') && classroomStudent.group?.agentId) {
  const classroomGroup = classroom.groups.find(g => g.id === classroomStudent.groupId);
  agent = classroomGroup?.agent || null;
} else {
  agent = classroom.classroomAgents[0]?.agent;   // ← 回落
}
```

`classroomStudent.group?.agentId` 为假 ⇒ 掉进 `else` ⇒ 取 `classroomAgents[0]`。而高级模式的 `classroomAgents` 是 `routes/classroom.ts:437-438` 从**所有组**的 agentId 派生的并集。

⇒ 不指定智能体的那个组，学生发消息会拿到**另一个组的智能体**：名字、提示词、平台账号全是别人的。AI 正常回答、对话正常入库、教师完全看不出。**这是本任务最严重的一处。**

### 1.2 🔴 `GET /code/:code` 解引用 null 会让**整间课堂**打不开

`server/src/routes/classroom.ts:804-816`：

```ts
groups: (classroom.mode === 'advanced' || classroom.mode === 'group')
  ? classroom.groups.map(group => ({
      ...
      agent: {
        id: group.agent.id,        // ← 非空解引用
        name: group.agent.name,
```

`groups` 的 include 是 `{ agent: true }`（`:758`）。`agentId` 可空后这里是 `null.id` ⇒ TypeError ⇒ 被 `:819` 的 catch 吞成 `500 查询课堂失败`。

学生端首屏就调它（`use-classroom-session.ts:93`、`:316`）⇒ **该课堂所有学生都进不去**，不只那一组。

### 1.3 分组模式「不选智能体 + 选网页」现在是 500（现网可达）

`server/src/routes/classroom.ts:311`：

```ts
agentId: uniqueAgentIds[0],   // ← 空数组时是 undefined
```

前端 `new/page.tsx:278` 的「分组模式」是一等入口；`:129` 的校验走 `else if (!selectedAgentId && !selectedWebappId)`，注释白纸黑字写着「只选网页不选智能体是**合法**的，别在这里拦住提交」。所以「分组模式 + 选网页 + 不选智能体」能通过前端校验 ⇒ 服务端 `agentId: undefined` ⇒ Prisma 必填缺失 ⇒ 事务抛错 ⇒ `500 创建课堂失败`。

**`tsc` 对此一声不吭**：数组下标访问的类型是 `string`，不是 `string | undefined`。

---

## 二、目标与非目标

**目标**

1. `ClassroomGroup.agentId` 可为空；老的、列仍为 `NOT NULL` 的真实库能自动迁移。
2. 高级模式与分组模式都能不指定智能体，且**行为可预期**：不指定 ⇒ 该组没有 AI，而不是「借」别人的。
3. 上面 1.1 / 1.2 / 1.3 三个缺陷一并消除。
4. 界面不撒谎：学生端显示的智能体必须与服务端实际使用的一致。

**非目标**

- 不做「每个小组多个智能体」。
- 不做「运行时改组绑定」——创建后不可更改的既有产品决定不变。
- 不给标准模式加「按组」概念。
- 不动探究网页（webapp）那一侧。

---

## 三、Global Constraints（本任务附加）

1. **既有测试必须继续全过。** 动手前先测当前基线——**不要把 `specs/2026-09-20-p2-explore-assistant.md` 里写的「63 pass」当期望值**，那是 P2 之前的数字，本分支已加入 P2.2/P2.3 的测试。以实测为准。
2. **不得出现 regex lookbehind**，不得使用 `Object.hasOwn` / `structuredClone` / `Array.prototype.at` / `findLast` / `:has()` / `@container` / `content-visibility`（构建期闸门会 fail）。
3. **不新增任何 npm 依赖。**
4. **提交信息中文**，格式 `<type>(scope): <做了什么>`。报告、注释、过程旁白一律中文；引用的原始输出保持原样不翻译。
5. 🔴 **绝不 `prisma db push` 打在真实库上（`server/prisma/dev.db`）。** 本任务改的是列的可空性，**只能靠手写迁移**，`db push` 会把活库里 `schema.prisma` 中不存在的旧列静默删掉（P2 的 T5 已经真踩过一次，见约束 11 原文）。
6. **不要用 `reset-password` 造教师数据**（它会 `revokeAllTeacherSessions()`，把用户开着的教师标签页登出）。
7. **只允许一个 `pnpm build` / `pnpm test` 在跑。**
8. **跑 `pnpm build` 之前先 `./dev.sh stop`，跑完 `./dev.sh start`，最后 `./dev.sh status` 复核 4000/4001 都在。** 这条被踩过三次：`pnpm build` 覆盖 `.next` 会把正在跑的 dev server 打成 500，实施者因此拿到过假的绿灯。
9. **不碰** `CLAUDE.md` / `dev.sh` / `package.json`。
10. **测试若改数据库，必须逐表还原**，并给出还原证据。要造测试数据请用 `/tmp` 下的副本库，用完删掉。
11. 🔴 **任何「因此不扫 / 排除 / 安全 / 可以忽略」的结论，必须附一条命令或一段实测输出。** 没有命令的排除 = 未验证的排除。

---

## 四、设计

### 4.1 数据模型

`server/prisma/schema.prisma:149-162`：

```prisma
model ClassroomGroup {
  agentId    String?        // 原为 String
  agent      Agent?  @relation(fields: [agentId], references: [id], onDelete: Cascade)  // 原为 Agent
}
```

**`onDelete: Cascade` 保留。** 语义变成「agentId 非空时才参与级联」；`agentId` 为 null 的行不会被任何 Agent 删除影响。

预期生成的表结构 —— **这一份是实测出来的，不是照文档推的**。方法：把 `schema.prisma` 的 `agentId` 改成 `String?`、`agent` 改成 `Agent?` 复制到 `/tmp`，`DATABASE_URL="file:/tmp/probe.db" prisma db push`，再 `sqlite3 .schema ClassroomGroup`。与真实库（`server/prisma/dev.db`）逐行对比，**唯一差异**是 `"agentId" TEXT NOT NULL` → `"agentId" TEXT`；具名 CONSTRAINT、`ON DELETE CASCADE ON UPDATE CASCADE`、索引名逐字相同。全库 `pragma_table_info` 规范化对比同样只有这一处差异（另加真实库残留的 `_prisma_migrations` 表，与本改动无关）。

```sql
CREATE TABLE "ClassroomGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agentId" TEXT,
    "sourceClassGroupId" TEXT,
    CONSTRAINT "ClassroomGroup_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassroomGroup_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ClassroomGroup_classroomId_idx" ON "ClassroomGroup"("classroomId");
```

⚠️ **不要写成行内 `REFERENCES` 的形式**（例如 `"agentId" TEXT REFERENCES "Agent"("id") ON DELETE CASCADE`），那是 `participant-migration.ts:87-98` 的手写风格。**实测证据表明那种写法与 Prisma 的输出不一致**：真实库里 `ClassroomStudent` 是具名 CONSTRAINT、且带 `ON UPDATE CASCADE`，而 `participant-migration.ts` 手写的那份两样都没有 —— 说明它写出来的表后来被某次 `db push` 重建过。教训是：**手写 DDL 与 Prisma 输出不一致时，下一次 db push 会重建表，而按 `table_info` 探测的同步块不会重跑，两边就此分叉。**

⚠️ **改完 `schema.prisma` 必须跑 `pnpm --filter classnode-server db:generate`。** 不跑的话 Prisma 客户端类型仍是 `Agent`（非空），`tsc` 不会提示 4.4 / 4.6 两处的解引用错误，它们会一直静默到运行期。

### 4.2 迁移

**落点：新建 `server/src/services/classroom-group-agent-migration.ts`。**

不塞进 `participant-migration.ts`：那个文件的职责是「参与者模型迁移」，再塞一条**改另一张表的列结构**的迁移进去，名字与内容就对不上了。代价是 `PRAGMA table_info('ClassroomGroup')` 会被读两次（两个模块各一次）—— 那是张几行的表，这次的读取成本可以忽略，而职责清晰是长期收益。

**调用顺序**：必须排在 `participant-migration.ts` **之后**（`index.ts:400` 之后）。那一步保证 `ClassroomGroup.sourceClassGroupId` 列已存在，而下面的重建会把它一起搬到新表；反过来会漏列。

**探测**（新模块内自己读一次）：

```ts
const columns = await prisma.$queryRawUnsafe<TableInfoRow[]>(`PRAGMA table_info('ClassroomGroup')`);
if (!needsNullableAgentColumn(columns)) { /* 写标记并跳过 */ }
```

`needsNullableAgentColumn(columns)` 抽成**导出的纯函数**，判据是 `agentId` 存在且 `notnull === 1`。

⚠️ `agentId` **列不存在时不触发重建**。两种情况要区分：
- **全新安装**：`ClassroomGroup` 表由安装时的 `prisma db push` 按新 schema 建出，列本来就是可空的 ⇒ 表存在、`notnull === 0` ⇒ 不重建。正确。
- **表根本不对**：不在本任务范围内。静默重建会掩盖它，所以宁可不动。

这条判断必须有测试守着，否则「读不到列」会被当成「已经是可空的」。

**重建**（顺序与 `participant-migration.ts:107-108` 一致，理由见那里的注释：先 RENAME 旧表会被 SQLite ≥3.25 改写其它表里指向它的 REFERENCES 子句）：

```sql
PRAGMA foreign_keys = OFF
CREATE TABLE "new_ClassroomGroup" (...);          -- 见 4.1，逐字抄实测出来的那一份
INSERT INTO "new_ClassroomGroup" ("id","classroomId","name","agentId","sourceClassGroupId")
  SELECT "id","classroomId","name","agentId","sourceClassGroupId" FROM "ClassroomGroup";
DROP TABLE "ClassroomGroup";
ALTER TABLE "new_ClassroomGroup" RENAME TO "ClassroomGroup";
CREATE INDEX "ClassroomGroup_classroomId_idx" ON "ClassroomGroup"("classroomId");
PRAGMA foreign_keys = ON
```

🔴 **`ClassroomGroup` 被两张子表外键引用，而且这两条外键的删除动作是「会改数据」的那种**（真实库实测）：

| 子表 | 列 | 动作 |
|---|---|---|
| `ClassroomStudent` | `groupId` | `ON DELETE SET NULL` —— 全班学生的分组会被清空 |
| `ClassroomGroupMember` | `groupId` | `ON DELETE CASCADE` —— 成员快照会被整批删除 |

⇒ 若 `foreign_keys` 没被关掉，`DROP TABLE "ClassroomGroup"` 会执行一次隐式 `DELETE FROM` 父表，**触发上面两条动作，静默毁掉子表数据**。

🔴 **`PRAGMA foreign_keys` 是按连接生效的，而 Prisma 有连接池。** 这是本任务最隐蔽的运行期风险：pragma 一旦落在与 `DROP TABLE` 不同的连接上就不生效，而失败表现得像「什么都没发生」——表结构改对了，子表数据没了。

🔴 **`PRAGMA foreign_keys` 同时在事务内无效**，所以**不得**把整段包进 `$transaction`：那会让这条 pragma 变成空操作，正好触发上面那个数据销毁路径。`participant-migration.ts` 现在也没包事务，照抄。

⇒ **唯一的裁判是测试**：迁移用例必须带**两张子表与子表数据**，并在迁移后断言「学生的 `groupId` 没被置空、成员行还在」。**没有子表数据的迁移测试测不到这个坑**，而且是静默的数据销毁。若该断言红了，不要绕过——见计划里给出的退路（`node:sqlite` 单连接，不引入新依赖）。

**备份**：把 `index.ts:39-53` 的 `backupDatabaseBeforeParticipantMigration()` 泛化成 `backupDatabase(label: string): string | null`，两条迁移各用一个 label。**既有那条迁移产生的文件名保持 `before-participant-migration-<stamp>.db` 不变**（即 `label = 'participant-migration'`），避免与历史上已有的备份文件混淆。

**编排**（探测 → 备份 → 中止判据 → 重建 → 写标记）收在新模块的一个导出函数里，**备份函数由 `index.ts` 以回调传入**（它依赖 `process.env.DATABASE_URL`，不适合放进服务模块）：

```
Setting 标记：classroom-group-nullable-agent-migration-v1
```

> 这一处与本节早前的写法（「标记与调用放 `index.ts`」）**有意不同**：验收清单要求验证「备份失败时中止」，写在 `index.ts` 里的编排没法被测试。收进模块、只把备份作为回调传入，这条验收项才可测。

🔴 **备份只在「探测到确实需要重建」时才做**（`needsNullableAgentColumn` 为真 **且** 标记未置位）。不加这个前提的话，每次启动都会拷一份库文件出来。

🔴 **备份失败且确实需要重建时，必须中止这条迁移并打印明确错误**，不得照常改表。既有那条迁移是「备份失败也继续」（`index.ts:389-391` 的 `if (backupPath)` 只是不打日志），**本任务不沿用这个宽松度**：改的是列结构，没有备份就没有回滚依据。`backupDatabase()` 返回 null 的两种情形——`DATABASE_URL` 不是 `file:` 前缀，或库文件不存在——在「确实需要重建」的前提下两者都应当中止。


### 4.3 写入路径（`POST /api/classroom/create-advanced`）

`server/src/routes/classroom.ts:373-379` 的窄化：

```ts
agentId: typeof input.agentId === 'string' && input.agentId ? input.agentId : null,
```

**把 `''` 归一到 `null`。** 不做归一的话 `''` 会成为**第三种状态**落库；`''` 与 `null` 在所有 `?.` 判空里表现一致（都 falsy），**看起来是对的**，直到有人写 `where: { agentId: null }` 的统计——那种查询一条都匹配不到 `''`。

`:380` 的校验只留名称：

```ts
if (normalizedGroups.some(group => !group.name)) return res.status(400).json({ error: '分组名称不能为空' });
```

`:389-394` 的三件套判据改成按**有智能体的组数**计，而不是组的数量：

```ts
agent: normalizedGroups.filter(group => group.agentId).length,
```

不改的话「所有组都不指定 + 没有网页」会通过校验，建出一间三件套全空的教室——而 `routes/classroom.ts:151-152` 的注释写明这正是这条规则要防的事。

`:437-438` 删掉 `as string[]` 断言并先过滤：

```ts
const uniqueAgentIds = [...new Set(normalizedGroups.map(group => group.agentId).filter((id): id is string => id !== null))];
```

🔴 **那个 `as string[]` 正是让 `tsc` 闭嘴的东西。** `db:generate` 之后 `uniqueAgentIds` 是 `(string | null)[]`，断言一删，编译器就会把真正的问题指出来；留着它，错误只会推迟到运行期的事务里炸成 500。

### 4.4 运行期选智能体（`server/src/socket/index.ts:1562-1568`）

🔴 **本节是最严重的一处，必须显式分支，不得保留任何形式的回落。** 并且要把「选哪个智能体」抽成一个**导出的纯函数**（`resolveAgentSlot<T>(mode, groups, classroomAgents, studentGroupId): T | null`）再在处理器里调用：

```ts
// 高级/分组模式：智能体**只能**来自学生自己的组。
// ⚠️ 这里不得回落到 classroomAgents[0] —— 高级模式的那个数组是**各组智能体的并集**，
//    回落到它等于让「不指定智能体」的组静默地用另一个组的智能体对话
//    （错名字、错提示词、错平台账号），且全程零报错。见 §1.1。
if (mode === 'group' || mode === 'advanced') {
  const group = groups.find(g => g.id === studentGroupId);
  return group?.agent ?? null;
}
return classroomAgents[0]?.agent ?? null;
```

**为什么必须抽出来**：这三行内联在 `send-message` 处理器里，只能靠端到端手测；抽成纯函数之后才能对「自己的组有 / 自己的组无 / 找不到组 / 标准模式」四种组合逐条断言，其中「自己的组无」那条还要带**反证**（`classroomAgents` 里故意放一个别组的智能体，断言学生没拿到它）。泛型 `T` 是必需的：调用点随后要读 `agent.enabled` 与 `agent.name`，收窄成手写窄类型会逼出一处丢类型的断言。

**「不指定智能体」的既定语义 = 标准模式「没选智能体」今天已有的行为**（`classroom.ts:171-176` 的三件套口径，`classroom-webapp-link.test.ts:236` 是它的守卫）：该组照常存在、成员快照照常、消息照常落库并广播给教师，只有 AI 那一步回「未配置AI智能体」。**不隐藏学伴模块**——那是另一个决策，见 §六。

### 4.5 读路径（`GET /api/classroom/code/:code`）

`server/src/routes/classroom.ts:809-816` 改成条件构造：

```ts
agent: group.agent ? {
  id: group.agent.id,
  name: group.agent.name,
  logo: group.agent.logo,
  platform: group.agent.platform,
  enabled: group.agent.enabled,
  greeting: group.agent.greeting,
} : null,
```

### 4.6 前端创建页（`src/app/teacher/classroom/new/page.tsx`）

**状态模型**

`groupAgentIds` 从 `Record<string, string>` 改为 `Record<string, string | null>`：

| 值 | 含义 |
|---|---|
| 键不存在（`undefined`） | **还没选** |
| `string` | 选了某个智能体 |
| `null` | **显式选了「不指定」** |

🔴 **「不指定」不能用 `''` 表达。** `:125` 的 `every(g => groupAgentIds[g.id])` 会把 `''` 判成未配置而拦住提交——功能等于没做，且不报错，只是按钮永远不可用。

**校验**（`:125`）：改成「每组都必须**做出决定**」

```ts
const allDecided = classGroups.every(g => g.id in groupAgentIds);
```

`in` 对 `null` 值为真、对缺失键为假，正好是需要的判据。

**连带必须一起改的地方**（漏任一处，进度条或摘要就会撒谎）：

| 位置 | 现在 | 改成 |
|---|---|---|
| `:200` `configuredGroupCount` | `filter(g => groupAgentIds[g.id])` | `filter(g => g.id in groupAgentIds)` |
| `:213-215` 步骤③完成度 | `configuredGroupCount === classGroups.length` | 不变（计数口径已改） |
| `:411` | `必填` 标记 | 保留（「必须做出决定」仍然是必填） |
| `:442` 触发器 | 空值渲染灰字「选择AI智能体」 | 空值 = 「选择AI智能体」；`null` = 「不指定」 |
| `:465-493` 选项列表 | `agents.map` | 顶部加一项「不指定」，点击写 `null` |
| `:651-653` 摘要 | `{configuredGroupCount}/{classGroups.length} 个小组已配置` | 文案不变，另加「N 个未指定」 |

**类型**：`src/lib/types.ts:394-398` 的 `AdvancedClassroomGroupInput.agentId` 改为 `string | null`（该类型只存在于前端，服务端 `routes/classroom.ts:373-379` 是手写窄化）。

### 4.7 前端展示层回落（第二个静默错误）

`chat-panel.tsx:296-302` 与 `student-home.tsx:147-154` 都在组里找不到 agent 时回落到 `classroom.agents?.[0]`。高级模式下那个数组是**各组智能体的并集**，所以回落会显示**别人组的名字和头像**——**即使 §4.4 改对了，界面仍然在撒谎**。

抽一个共用的解析函数（例如 `src/lib/classroom-agent.ts`）：

```
effectiveAgentFor(classroom, selectedStudent):
  group 模式 / advanced 模式：
    由 selectedStudent.groupId 找到组 → 返回 group.agent ?? null   （不回落）
  standard 模式：
    group?.agent ?? classroom.agents?.[0] ?? null                  （保留回落）
```

三处消费点统一改用它：`chat-panel.tsx`（头像与欢迎卡片）、`student-home.tsx`（学伴卡名称）。`use-classroom-session.ts:97-109` / `:325-332` 判断「智能体停用」时 `null` ⇒ 不认为停用、不显示横幅——这个行为**保持**（没有智能体不是「被停用」），但要在代码里写明这是有意的。

**类型**：`src/lib/types.ts:302/322/355` 与 `src/lib/socket-events.ts:9` 里 `agent` 由必填改为 `AgentSummary | null`。

### 4.8 分组模式的 500

`routes/classroom.ts:311` 改成 `agentId: uniqueAgentIds[0] ?? null`。

列可空之后，分组模式也一并允许不选智能体——与「三件套下智能体可以不选」的既定规则一致，**不需要为它单独加一条限制**。前端 `:129` 的校验不用动。

---

## 五、测试要求

### 5.1 🔴 迁移测试必须**自己造旧表**，不得用 `prisma db push` 建的临时库

本任务最隐蔽的假绿来源：现有测试的临时库是 `prisma db push` 造的（`classroom-webapp-link.test.ts:21-30`），那种库里 `agentId` **天生就是可空的**（因为 schema.prisma 已经改过）。拿它测迁移 ⇒ **永远绿**，而真实老库仍然 500。错误文案还会是「创建课堂失败」，与「参数不合法」长得一模一样，排查方向会被带偏。

⇒ 迁移用例必须显式 `CREATE TABLE "ClassroomGroup" (... "agentId" TEXT NOT NULL ...)` 造一张旧形状的表，插几行数据，再调 `ensureClassroomGroupAgentNullable()`，然后断言：

- `PRAGMA table_info('ClassroomGroup')` 里 `agentId` 的 `notnull === 0`
- 原有行的 `id`/`classroomId`/`name`/`agentId`/`sourceClassGroupId` 与迁移前**逐行相等**（不是比行数——行数验不出列被删）
- 索引 `ClassroomGroup_classroomId_idx` 存在

🔴 **并且必须带上两张子表与子表数据**，迁移后断言「学生的 `groupId` 没被置空、成员行还在」。理由见 §4.2：`PRAGMA foreign_keys` 是按连接生效的，Prisma 有连接池，pragma 一旦没落在执行 `DROP TABLE` 的那条连接上，隐式 `DELETE FROM` 就会触发 `ON DELETE SET NULL` / `ON DELETE CASCADE`，**静默毁掉子表数据**。没有子表数据的迁移测试**测不到这个坑**。

**反证（阴性对照）**：把探测条件反过来（例如断言「`notnull === 1` 时不重建」）必须失败——用来证明这个用例真的在区分「重建了」与「没重建」，而不是断言恒真。同理，「备份失败必须中止」那条用例断言的是**表结构原样未动**，不是只看有没有抛错。

### 5.2 其余用例（真库临时库，走 `db push` 建的新形状）

- 高级模式：**某一组不指定智能体** ⇒ 200；该组 `agentId` 为 null；`classroomAgents` **不含** null 且不含其它组的重复项。
- `GET /code/:code` 对含空智能体组的课堂 ⇒ **200**（不是 500），且该组 `agent` 为 `null`、其它组照常有 agent。
- 🔴 **socket 选智能体：该组学生发消息，拿到的是「无智能体」而不是别组的智能体。** 这条要有反证——把 `classroomAgents` 里塞一个别的组的智能体，断言学生**没有**拿到它。
- 高级模式：所有组都不指定 + 没有网页 ⇒ **400**（三件套判据），文案把三项念出来。
- 分组模式：不选智能体 + 选网页 ⇒ **200**（回归 §1.3 的 500）。
- `create-advanced` 的 `agentId: ''` ⇒ 落库为 `null`，不是 `''`。
- 既有 `classroom-webapp-link.test.ts:236`（标准模式只选网页）**必须仍然通过**——它走默认 `mode='standard'`（`routes/classroom.ts:245`）。

### 5.3 需要同步更新的既有测试

- `group-participant-flow.test.ts:14,19`：那个 mock 对未知 SQL 直接 `throw`，且对 `table_info('ClassroomGroup')` 现在回的是 `[{name:'sourceClassGroupId'}]`（**没有 `notnull` 字段**）。加了探测之后 mock 必须回**完整形状**（含 `name` 与 `notnull` 的每一列），否则 `notnull` 是 `undefined`、`undefined === 1` 为假 ⇒ 探测静默判定「不需要重建」⇒ 测试绿而迁移没跑。**这正是本任务要防的那类假绿，mock 的形状本身就是被测对象的一部分。**
- 若新增的探测函数被单独导出，为它补一条小的纯函数用例（输入两种列形状，断言判定结果），这比只靠集成测试更能定位问题。

---

## 六、非目标与待用户确认

1. **不隐藏学伴模块。** 没配智能体的组，学生仍然看得到「智能学伴」tab，发消息会得到「未配置AI智能体」。**这是已确认的决定**（用户 2026-09-22 明确：三件套下智能体可以不选 ⇒「不指定」是合法状态，不是错误态）。若将来要改成「该组直接隐藏学伴模块」，那是**另一项**——它要动课堂模块三态的下发与校验。
2. **不加「进门常驻提示」。** 学生端在发消息前不会看到「本组未配置智能体」的提示。要做的话是叠在上面语义之上的一层 UX 增强。
3. **教师端可见性不动。** 仪表盘设置弹窗已经能显示「未配置」（`teacher/page.tsx:1676` 的 `agent?.name || "未配置"`），教师看板本来就不按组显示智能体（`classroom/page.tsx:656-661` 只解析一个课堂级 agent）。
4. **真实库迁移需要用户参与。** 合并前用库副本验证；合并后需要在用户自己的真实库上确认一次勾选流程。

---

## 七、验收清单

**A. 迁移**

- [ ] 用一张**旧形状**（`agentId TEXT NOT NULL`）的库文件跑服务，启动后列变为可空，且**数据逐行不变**
- [ ] 备份文件真的产生在 `backups/` 下，文件名可区分于既有的 `before-participant-migration-*`
- [ ] 备份失败时迁移**中止**并打印明确错误（造一个 DATABASE_URL 指向不存在文件的场景验证）
- [ ] 第二次启动**不重复重建、不重复备份**（Setting 标记生效）
- [ ] **全程没有跑过 `prisma db push` 打真实库**（给出命令历史作为证据）

**B. 创建与运行**

- [ ] 高级模式：某组选「不指定」⇒ 建得出来，进度条与摘要显示一致
- [ ] 高级模式：某组选「不指定」⇒ 该组学生发消息得到「未配置AI智能体」
- [ ] 🔴 高级模式：某组选「不指定」⇒ 该组学生**没有**用上任何其它组的智能体（反证：看服务端日志/装饰性断言）
- [ ] 高级模式：所有组都不指定 + 无网页 ⇒ 400
- [ ] 分组模式：不选智能体 + 选网页 ⇒ **200**（不是 500）
- [ ] `GET /code/:code` 对含空智能体组的课堂返回 **200**
- [ ] 「不指定」与「还没选」在 UI 上**可区分**，且「还没选」时提交被拦住

**C. 回归**

- [ ] 标准模式「只选网页不选智能体」照旧 200
- [ ] 高级模式各组都指定智能体时，行为与改动前**逐字一致**
- [ ] 学生端学伴头像/名称在标准模式下照旧
- [ ] 删除智能体的守卫照旧（不能删掉被任何组引用的智能体）

**D. 门禁**

- [ ] `npx tsc --noEmit` 退出 0、零输出
- [ ] `npx eslint src/app/classroom/ src/lib/` 退出 0
- [ ] `./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status` 通过，且 **4000/4001 都在**
- [ ] `cd server && pnpm test` 全过（与动手前实测的基线比对，不引用旧数字）
