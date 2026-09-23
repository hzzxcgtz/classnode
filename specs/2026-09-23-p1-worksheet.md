# P1 学习单 · 第一批实现规格

> 日期：2026-09-23
> 状态：**待用户通读**
> 本文是 P1（学习单）的**新依据**，取代 `specs/2026-09-19-classnode-learning-suite-design.md` 的
> **§6 / §7.7 / §8 / §9 / §14**。原文档其余章节继续有效，尤其是 §2（分解与顺序）、
> §3（YAGNI）、§5（P2 已落地）、§10（安全）、§11（兼容性）、§13（测试策略）。

---

## 〇、一句话

学生端加第三个真模块；**教师先做一份学习单 → 课堂关联 → 学生逐题作答并逐题提交 → 教师看板实时看到谁做到哪、哪道题错得多**。
第一批只做 3 种题型，但**整条链路一次打通**。

---

## 一、为什么需要这份文档：09-19 设计文档里已经过期的前提

P0（外壳）与 P2（探究空间）都已落地 —— 当前分支 `feat/p2-explore-assistant` 领先 `main` 92 个 commit。
它们的落地改变了 P1 的四条前提。以下每一条都**核过代码**，不是推断。

### 1.1 分组材料机制已经存在，`kind='worksheet'` 是预留位

> 🔴 **本节下面三条「今天……」的事实，2026-09-23 当天就不再成立了** —— 写作时它们都是真的，
> 但它们描述的是**动手前的状态**，而 P1 自己把其中两条改掉了。原文保留在下面（决策痕迹是信息），
> 每条的当前状态以**引用块**为准。**不要照着旧那一句去推断现在的代码。**

- `ClassroomGroupMaterial(groupId, kind, targetId)` 已是既有表，`schema.prisma` 注释写着「将来 Worksheet.id」
- 今天**没有任何地方**写 `kind='worksheet'`；`Classroom.worksheetId` 这个列**不存在**

  > **2026-09-23 过期（写作当天的 B2 落地后即失效）**：前半句已不成立 ——
  > `routes/classroom.ts` 的两条创建路径都在写它（标准/分组一次、高级模式逐组一次，
  > 写入口是那个 `for (const [kind, targetId] of …)` 循环）。
  > 后半句**仍然成立**：`Classroom.worksheetId` 这个列**至今不存在**，权威来源是
  > **关联表 `ClassroomWorksheet`**（课堂级）+ **`ClassroomGroupMaterial(kind='worksheet')`**（组级）。

- `server/src/services/group-material-resolve.ts` 的 `resolveMaterialTargetId({..., kind })` 是纯函数、
  已有单测，`kind` 联合类型今天是 `'agent' | 'webapp'` —— **加一个 `'worksheet'` 是一处改动**

  > **2026-09-23 过期（B2 落地后即失效）**：联合类型**已经扩成**
  > `'agent' | 'webapp' | 'worksheet'`（`group-material-resolve.ts` 的函数签名）。
  > 当时那句「是一处改动」的**估计是对的** —— 真要动的确实只有这一处枚举。

- 同文件的 `resolveGroupMaterialViews()` 多一条 `in` 查询 —— **已完成**：它今天查三条
  （`agent` / `webapp` / `worksheet`），`GroupMaterialView` 也已有 `worksheet: { id, title } | null`。

> **09-19 §6.2 写死的「P1 全班一张、分层教学 P1 不做」前提已失效** —— 那套机制就在那儿，注释点名等着学习单。

### 1.2 课堂有三档模式，材料的权威来源不同

`mode ∈ standard | group | advanced`（`routes/classroom.ts:256` 校验的是前两档，`advanced` 走独立端点）。

| 模式 | 谁登录 | 一块设备 = | 材料权威来源 |
|---|---|---|---|
| `standard` | 每个学生 | 一个学生 | **课堂级**（`ClassroomAgent` / `ClassroomWebapp`） |
| `group` | **每个组** | 一个小组（组员共用） | **课堂级** |
| `advanced` | **每个组** | 一个小组（组员共用） | **每组一份**，不回落 |

🔴 **关键事实**（`routes/classroom.ts:304` 的注释逐字）：

```
if (mode === 'group') {
// 分组模式：小组本身就是课堂参与者，不再创建虚拟 Student。
```

⇒ 分组与高级模式下 `ClassroomStudent.type === 'group'`，**一个组一行参与者**。
`ClassroomGroupMember` 只是创建课堂时**冻结的名单快照**（姓名 + 学号，供显示与点名），**名单上的人不登录**。

⇒ 因此分组/高级模式下**不存在个人作答数据**。这是模式的固有含义，不是缺陷。

### 1.3 教师看板已经改过一轮，学习单这一格已留位

P2.3 之后看板有了：「跟随 / 指定」两种模式（`BoardMode`）、按模块分支的 `renderTileContent`、
小组格子、`student-module-focus` 回显。而 `src/app/teacher/classroom/page.tsx` 里已经有：

```tsx
// 三件套的布局一次定形：学习单这一格**留位**、标明尚未支持，
// 以后接上学习单时不用重排（用户裁定）。
case 'worksheet':
  return placeholder('学习单 · 尚未支持', '这个模块还没接进看板');
```

⇒ **09-19 §9 整节描述的是另一套接口，必须按现在的代码重写**（本文 §7）。

### 1.4 学生端接线已在，占位面板的类型门要一起拆

`src/lib/classroom-modules.ts` 的 `ModuleId = 'worksheet'` ⇄ 后端 `'learning-sheet'` 映射、
三态、惰性挂载、切换动画全是现成的真机制。学习单现在是 `shell/module-placeholder.tsx`，
它的 `PlaceholderModuleId = Exclude<ModuleId, 'companion' | 'explore'>` —— 探究空间接真面板时已收窄过一次，
**接上学习单后这个类型会变成 `never`**，那道编译期门要跟着处理。

### 1.5 其余两处小的事实

- 三件套判据 `classroomMaterialError` 的 `worksheet: 0` 是**硬编码**的，两处调用点：
  `routes/classroom.ts:278`（标准/分组）与 `:425`（高级）。代码注释已写明「将来做学习单时只改那一行」。

  > **2026-09-23 过期（B2 落地后即失效）**：那两处**已经是真数字**，不再硬编码 0 ——
  > 标准/分组数课堂级那一份（`worksheet: worksheet.id ? 1 : 0`），
  > 高级模式数**真的配了的组级学习单数**（`normalizedGroups.filter(g => g.worksheetId).length`）。
  > ⚠️ 行号是写作时的，已经漂了（B2 之后不在 278 / 425），按符号名找而不是按行号找。
  > 那条「将来做学习单时只改那一行」的注释也已兑现。
- 构建期兼容检查 `scripts/check-classroom-browser-compat.mjs` 的 Part A 扫的是
  `out/classroom/index.html` 及其 chunk；被排除的 `teacher/help` 路径走「边界提示」**只提示不失败**。
  ⇒ **编辑器不受 Safari 15 约束**，但用它写 `:has()` 时构建日志会出现边界提示 —— 那不是报错。

---

## 二、目标与非目标

### 目标（第一批）

1. 教师能做出含单选 / 填空 / 问答的学习单，能预览、能复制复用。
2. 学习单能关联到课堂：标准与分组模式全班一份；**高级模式每组各选一份**。
3. 学生能逐题作答、逐题提交；答案**绝不静默丢失**（离线队列）。
4. 教师看板**实时**看到：谁做到哪、谁停住了、哪道题错得多、某个学生具体写了什么。
5. 客观题**服务端判分**，答案字段**不下发学生端**。

### 非目标（第一批）

| 不做 | 归属 |
|---|---|
| 手写笔迹 / 绘图 / 符号键盘 | 后续批次 |
| 判断 / 多选 / 连线 / 排序题 | 后续批次 |
| 材料题组（容器 UI） | P4 或按需 |
| 学生 × 题目矩阵总览 | 后续批次 |
| 课堂级「锁定作答」 | 后续批次 |
| 逐题投放（教师控制发放节奏） | 后续批次（见 §12） |
| 分值体系 | **不做**，见 §3-S |
| 导出（Word 报告） | P3 |
| 分层教学之外的候选题型 | 09-19 §3 已撤下路线图 |

---

## 三、决策记录

> 每条给出「依据」与「若判断有误的代价」。标 **【用户裁定】** 的是本次会话中用户明确选择的；
> 标 **【本次提案】** 的是控制器提出、用户未反对但**未逐条表态**的 —— 通读时应重点看这些。

| # | 决定 | 依据 | 若判断有误的代价 |
|---|---|---|---|
| **A** | 学习单**按组同构** | 【用户裁定】高级模式每组各选一份，与智能体/网页一致；机制已在（§1.1） | 创建页少一个下拉；数据模型不用改（`kind` 是自由字符串） |
| **B** | 第一批**纵向切**：全链路 + 3 种题型 | 【用户裁定】P2 的经验是坑都在链路层；横向切在打通链路前拿不到真实教学反馈 | 8 种题型的编辑 UI 不能一次定型，后续每加一个题型可能发现共用组件要改 |
| **C** | 第一批含：高级模式第三个下拉 · 服务端判分 · 「复制一份」 | 【用户裁定】 | 三项各自独立，任一推迟只影响对应能力 |
| **D** | 主观题只做**「已查看」标记** | 【用户裁定】教师课上问的是「还剩几个我没看」；逐题打分是课后工作量，且那套 UI 本身是另一个里程碑 | 主观题无法量化；将来加手动批改时要引入 `gradedBy` 区分来源 |
| **E** | **逐题提交** | 【用户裁定】支持课上「第 3 题做完的提交一下，我们来看第 3 题」 | 学生在 iPad 上要做 N 次精确点击 |
| **F** | 「按题看」走**抽屉入口** | 【用户裁定】不与图墙骨架打架；复用「点一下 → 右边滑出 420」 | 单屏能看到的信息量少于独立视图 |
| **G** | **整张发**题目 | 【用户裁定】教师课上多一次必须的操作就多一个忘记的可能；逐题投放的唯一收益是「强制同步」 | 低年级无法强制全班同步（靠口头） |
| **H** | 格子以**「正在做哪题」为纲** | 【用户裁定】实时看板的锐度优先 | 全班整体进度不如进度环直观；依赖「每次保存带题目 id」 |
| **I** | 徽章行「N 轮」→**「已交 N/M」**（学习单模块下） | 【用户裁定】「N 轮」是学伴指标，在非学伴模块下是噪音。⚠️ 2026-09-23 实施 D3 时更正：本节原写「已看 N/M」，而 `reviewedAt` 当时**既无广播也无读端点** ⇒ 按它算 N 恒为 0，**那是假话**。改为「已交 N/M」——**真实的标签胜过照抄规格**。⚠️ **2026-09-23 晚：读端点已落地**（`de38dab` 的 `GET /api/worksheets/classroom/:id/answers` 会回 `reviewedAt`）⇒ 「已看」现在**在数据上算得出来**，换不换是一次**产品决定**（教师课上问的是「还剩几个我没看」），未定 | 徽章行变成模块相关，实现与测试都要覆盖三种模块 |
| **J** | 改正在被使用的学习单：**只警告，不拦** | 【用户裁定】教师课上想改个字不必先下课 | **前提是 §3-P 成立**。⚠️ 2026-09-23 实施 D2 时更正：服务端对学习单**内容变更没有广播** ⇒ **「学生端会当场变化」这句话今天不成立**，学生要刷新才看得到。见 §13-7 |
| **K** | 编辑器**方案乙**（单列 + 「＋ 添加题目」+ ▲▼ 调序） | 【用户裁定】第一批只有 3 种题型 + 无内容块，左侧面板会很空 | 题型变多后要多一步「把左侧面板加回来」的布局改动 |
| **L** | 「是否自动判分」做在**学习单级** | 【用户裁定】「这堂课判不判分」是整张单的事，不是逐题的事 | 无法「单选判分、填空不判分」 |
| **M** | 第一批**不做**题目导航 | 【用户裁定】5–10 题在 iPad 上滚两下就到 | 题多时学生要一路滚 |
| **N** | 奖励形式做在**全局设置**，四选一 | 【用户裁定】一个老师带的学段固定，不必每张单选 | 同一老师跨学段时要来回改 |
| **O** | **步长可配**（每答对一题 +1 / +2 / +N） | 【用户裁定】 | 改步长会**追溯性**改变已显示的累计值 |
| **P** | `WorksheetAnswer` 按 **`questionId`** 关联，**绝不按下标** | 【本次提案】这是 J「只警告不拦」成立的前提 | 改成按下标 ⇒ 改单会静默错位，J 变成假的安全 |
| **Q** | `WorksheetResponse` 用**参与者 id**，不用 `studentId` | 【本次提案】§1.2 —— 分组/高级模式的参与者是组 | 用 `studentId` 会写一列永远为 null（小组没有 `studentId`） |
| **R** | 填空题第一批**一个空**，可配多个可接受答案（一行一个） | 【本次提案】多空要整套占位符 + 逐空判分，第一批是验链路 | 教师做不了多空填空题，只能拆成多题 |
| **S** | 第一批**不做分值**：`WorksheetAnswer.score` **不建**，只留 `isCorrect` | 【本次提案】奖励是 `isCorrect` 的呈现（§9）；分值一旦落库就有人拿它做统计，而它可推导 | 将来做「第 5 题 2 分」时要加字段；那时它是真信息，不是重复 |
| **T** | 判分归一化：去首尾空格 + 全角→半角 + 连续空格折叠；**不做大小写不敏感** | 【本次提案】大小写不敏感会让化学式（`CO2` / `co2`）被判错，那比不判更糟 | 英文填空题大小写写错会判错，教师需在答案里多列几个写法 |
| **U** | 奖励**只给学生看**；教师端保持对错与正确率口径 | 【本次提案】教师在那些地方问的是「哪道题错得多」，星星不提供信息 | 学生与教师看到的口径不同，需在文档里说明 |
| **V** | `inputMode` 字段一次建好，第一批 UI 不出现 | 【本次提案】避免 `schemaVersion` 迁移；不给一个只有一个选项的下拉 | 字段先空着；手写批次要加编辑器 UI |
| **W** | 学习单元数据只留 `title` + `description` | 【本次提案】`subject`/`gradeLevel`/`theme` 都是纯增量 | 列表页无法按学科筛选 |
| **X** | `/teacher/worksheets/` 列表页 + `?id=` 独立编辑页 | 【本次提案】静态导出**没有任何动态路由**（`find src/app -name '[*]'` 为空） | 无 |
| **Y** | 自动保存草稿**只存 localStorage** | 【本次提案】原设计的目标是「浏览器崩溃不丢备课」 | 换设备/换浏览器会丢草稿 |
| **Z** | 撤销重做**保留**（`Cmd+Z` + 顶栏按钮） | 【本次提案】09-19 原话：「教师必然误操作，属刚需而非加分项」 | 无 |
| **AA** | 「已查看」按**参与者 × 题**存（`WorksheetAnswer.reviewedAt`） | 【本次提案】「这题看了几人」与「这人看了几题」两个方向都能算出来 | 无 |
| **AB** | 抽一个共用的 **iOS 键盘 / viewport hook** | 【本次提案】不抽就必须把 `chat-panel.tsx:146-200` 那一坨复制一遍，两个模块必然分叉 | 两个模块各写一套，其中一个修了 bug 另一个没修 |
| **AC** | 「提交本题」**内联在每题下方**，不做固定底栏 | 【本次提案】固定底栏要先回答「当前是哪题」，学生滚回去看时是歧义源 | 提交按钮分散，学生可能漏点 |
| **AD** | 格子里的警示用**文字 + 琥珀底**，不用 ⚠ 图标 | 【本次提案】徽章行已有 ⚠ = 屏蔽词警告次数，同一位置两种含义会混淆 | 无 |
| **AE** | 格子**不带学习单标题** | 【本次提案】214px 放不下；「这份是哪张单」在抽屉里说得很清楚 | 高级模式下教师无法从格子分辨某组在做哪一份 |
| **AF** | 「按题看」**不做按需推流** | 【本次提案】推送由自动保存触发，本来就是低频；探究空间要按需是因为截图是高频的 | 无（学习单的推送量级本来就小） |
| **AG** | 顺手修：顶部「此刻各模块人数」在分组/高级模式下其实是**组数** | 【本次提案】标签现在会说谎；学习单的「已提交 12 人」会放大它 | 不修则继续误导；**修法见 §13-2**（⚠️ 2026-09-23：那张卡已被撤走，数字搬进了模块筛选行，本条**未复验**） |

### 明确不做（YAGNI，本次新增）

- **分值体系** —— 见 S
- **学段（小学/初中）这个中间概念** —— 它不产生任何行为差异，只是奖励形式的第二个入口
- **答错扣减** —— 见 §13 待定项

---

## 四、数据模型

### 4.1 新增表

```prisma
/// 学习单（模板，可复用）。题目结构存 JSON 树，见 09-19 §6.1 的三条决策。
model Worksheet {
  id            String   @id @default(uuid())
  title         String
  description   String?
  schemaVersion Int      @default(1)   // ★ 题型演进时迁移的依据
  content       Json                    // 题目结构（嵌套树；见 4.3）
  settings      Json                    // { allowResubmit, autoGrade } —— 见 4.4
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  classrooms    ClassroomWorksheet[]
  responses     WorksheetResponse[]
}

/// 学习单 ↔ 课堂的**课堂级**关联（standard / group 模式的权威来源）。
/// ⚠️ 与 ClassroomWebapp 同构：进 advanced 模式后权威来源变成「每组一份」。
model ClassroomWorksheet {
  id          String   @id @default(uuid())
  classroomId String
  worksheetId String
  createdAt   DateTime @default(now())   // ★ 排序键。理由与 ClassroomWebapp 逐字同源

  classroom Classroom @relation(fields: [classroomId], references: [id], onDelete: Cascade)
  worksheet Worksheet @relation(fields: [worksheetId], references: [id])

  @@unique([classroomId, worksheetId])
  @@index([worksheetId])
}

/// 参与者在某个课堂里对某份学习单的作答会话。
/// 🔴 participantId 指向 ClassroomStudent.id —— 那个 id **既可能是学生、也可能是小组**（§1.2）。
model WorksheetResponse {
  id            String   @id @default(uuid())
  classroomId   String
  worksheetId   String
  participantId String
  status        String   @default("not-started")  // not-started | in-progress | submitted
  startedAt     DateTime?
  submittedAt   DateTime?
  updatedAt     DateTime @updatedAt

  classroom   Classroom        @relation(fields: [classroomId], references: [id], onDelete: Cascade)
  worksheet   Worksheet        @relation(fields: [worksheetId], references: [id])
  participant ClassroomStudent @relation(fields: [participantId], references: [id], onDelete: Cascade)
  answers     WorksheetAnswer[]

  @@unique([classroomId, worksheetId, participantId])
  @@index([classroomId])
}

/// 逐题一行 —— 实时看板的**唯一**数据源（09-19 §6.1 决策 2：40 人 × 20 题 = 800 行/课，SQLite 无压力）。
model WorksheetAnswer {
  id           String   @id @default(uuid())
  responseId   String
  questionId   String    // ★ content 树里的稳定 id，**不是下标**（§3-P）
  value        Json?     // 答案（格式见 4.3）
  status       String   @default("unanswered")  // unanswered | draft | submitted
  isCorrect    Boolean?  // 仅 autoGrade 开启且已提交时有值
  reviewedAt   DateTime? // ★ 教师的「已查看」标记（§3-AA）
  submittedAt  DateTime? // 定稿时间戳（供 P4 智能体分析）

  response WorksheetResponse @relation(fields: [responseId], references: [id], onDelete: Cascade)

  @@unique([responseId, questionId])
  @@index([responseId])
}
```

> **`WorksheetAnswer.score` 刻意不建** —— 见 §3-S。

**关于 `ClassroomWorksheet` 的基数**：表结构允许一个课堂关联多份（`@@unique` 是
`[classroomId, worksheetId]`），但**第一批的创建页与读路径都按「单选」收窄** ——
与 `ClassroomWebapp` 完全同构（那张表也允许多行，而 `resolveSingleWebappId` 把它收成一份）。
这样将来真要做「一个课堂多份学习单」时不用改表。

### 4.1.1 ⚠️ 现有模型要补四条反向关系字段

上面那几个 `@relation` 都是**双向的**，Prisma 要求对面也有字段。所以
`schema.prisma` 里 `Classroom` 与 `ClassroomStudent` 各要加：

```prisma
model Classroom {
  // …（现有字段不动）…
  worksheets         ClassroomWorksheet[]
  worksheetResponses WorksheetResponse[]
}

model ClassroomStudent {
  // …（现有字段不动）…
  worksheetResponses WorksheetResponse[]
}
```

> 这不是可选的写法偏好 —— 缺了它们 `prisma db push` 直接 `P1012` 报错。
> 已用 `/tmp` 探针库实测过（补上之前报三处 missing opposite relation，补上之后通过）。

### 4.1.2 权威 DDL（`/tmp` 探针库 `db push` 后 dump，逐字照抄）

> 规格要求手写 DDL 与 Prisma 的输出**逐字一致**（否则桌面版下次 `db push` 会重建，
> 而按 `table_info` 探测的同步块不会重跑，两边分叉）。
> 取法：把改好的 schema 复制到 `/tmp`，`DATABASE_URL="file:/tmp/x.db" prisma db push`，
> 再 `sqlite3 <db> ".schema"`。**不碰真实库。**

```sql
CREATE TABLE "Worksheet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "ClassroomWorksheet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassroomWorksheet_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassroomWorksheet_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ClassroomWorksheet_worksheetId_idx" ON "ClassroomWorksheet"("worksheetId");
CREATE UNIQUE INDEX "ClassroomWorksheet_classroomId_worksheetId_key" ON "ClassroomWorksheet"("classroomId", "worksheetId");
CREATE TABLE "WorksheetResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not-started',
    "startedAt" DATETIME,
    "submittedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorksheetResponse_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorksheetResponse_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorksheetResponse_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ClassroomStudent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WorksheetResponse_classroomId_idx" ON "WorksheetResponse"("classroomId");
CREATE UNIQUE INDEX "WorksheetResponse_classroomId_worksheetId_participantId_key" ON "WorksheetResponse"("classroomId", "worksheetId", "participantId");
CREATE TABLE "WorksheetAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" JSONB,
    "status" TEXT NOT NULL DEFAULT 'unanswered',
    "isCorrect" BOOLEAN,
    "reviewedAt" DATETIME,
    "submittedAt" DATETIME,
    CONSTRAINT "WorksheetAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "WorksheetResponse" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WorksheetAnswer_responseId_idx" ON "WorksheetAnswer"("responseId");
CREATE UNIQUE INDEX "WorksheetAnswer_responseId_questionId_key" ON "WorksheetAnswer"("responseId", "questionId");
```

**建表顺序**（外键依赖）：`Worksheet` → `ClassroomWorksheet` → `WorksheetResponse` → `WorksheetAnswer`。

### 4.2 `ClassroomGroupMaterial` 的新 `kind` 值

不新增表，只新增一个取值 `'worksheet'`（`kind` 是自由字符串，schema 不用改）。
写入口沿用现有那一条（`routes/classroom.ts` 高级模式创建路径的 `for (const [kind, targetId] of ...)` 循环）。

### 4.3 `content` 结构与答案格式

**`content` 是嵌套树**（09-19 §6.1 决策 3）：每个节点有 `children` 数组，为将来的材料题组预留。
第一批**不实现任何容器编辑 UI**。

```jsonc
{
  "schemaVersion": 1,
  "nodes": [
    {
      "id": "q_3f2a…",            // ★ 稳定 id。生成一次，此后不随位置变化（§3-P）
      "type": "single-choice",
      "prompt": "光合作用需要哪些条件？",
      "inputMode": "keyboard",     // ★ 第一批恒为 keyboard，字段先建好（§3-V）
      "data": { "options": [{ "key": "A", "text": "…" }, …], "correctKeys": ["B"] },
      "children": []
    }
  ]
}
```

**答案格式**（09-19 §6.3 保留，第一批只用得到这三种）：

```jsonc
{ "format": "choice/v1",  "selected": ["B"] }
{ "format": "fill/v1",    "text": "光合作用" }
{ "format": "text/v1",    "text": "……" }        // 问答题
```

> 手写与绘图那两种格式（`ink/v1` / `drawing/v1`）**第一批不产生**，但 09-19 §6.3 的四条架构要求
> （矢量点集、格式版本号、识别结果独立字段、`submittedAt` 标记定稿）**继续有效**，实施时不得违背。

### 4.4 `settings` 结构

```ts
interface WorksheetSettings {
  allowResubmit: boolean;   // 提交后可否修改，默认 true（09-19 §8.4）
  autoGrade: boolean;       // 客观题是否自动判分，默认 true（§3-L）
  defaultInputMode: 'keyboard' | 'handwriting';  // ★ 建好但第一批恒为 keyboard（§3-V）
}
```

---

## 五、服务端

### 5.1 材料解析

`resolveMaterialTargetId` 的 `kind` 联合类型加 `'worksheet'`（**一处改动**）。
`resolveGroupMaterialViews` 加一条 `worksheet` 的 `in` 查询，`GroupMaterialView` 加一个
`worksheet: { id, title } | null` 字段。

⚠️ **每一条下发 `groups[]` 的路径都必须走这里**（该文件注释已写明）：
`GET /code/:code`、`GET /:id`、`GET /all`、`GET /active`，以及 `join-classroom`。

### 5.2 三件套判据

两处 `classroomMaterialError` 调用点的 `worksheet: 0` 改成真数字：

- `routes/classroom.ts:278`（standard / group）：教师的课堂级关联数（0 或 1）
- `routes/classroom.ts:425`（advanced）：**数真的配了的组级学习单数**

### 5.3 接口

```
# 教师端（全部 requireTeacher）
GET    /api/worksheets                     列表（分页；第一批不做学科/年级筛选，见 §3-W）
GET    /api/worksheets/:id                 详情（含完整 content）
POST   /api/worksheets                     新建
PUT    /api/worksheets/:id                 更新
DELETE /api/worksheets/:id                 删除（usage 守卫，见 5.5）
POST   /api/worksheets/:id/duplicate       ★ 复制一份（深拷贝 content）
GET    /api/worksheets/:id/usage           被哪些课堂引用

# 学生端（需学生 token，且只能读自己那一份）
GET    /api/worksheets/:id/student-view    ★ 服务端剥离答案字段（§5.4）

# 作答（`PUT` / `POST .../submit` 需学生 token；`review` 教师专用）
PUT    /api/worksheets/:id/answers              单题保存（幂等，学生端防抖 1.5s 调用）
POST   /api/worksheets/:id/answers/submit       单题提交
POST   /api/worksheets/:id/review               教师的「已查看」（教师 token）

# ★ 教师端按课堂读**作答全貌**（逐题答案 / 对错 / 已查看）—— 回填（2026-09-23）
GET    /api/worksheets/classroom/:classroomId/answers
#   形状按**课堂**而不是按学习单（高级模式每组可以是不同的单，「全班共有的第 3 题」不存在）：
#   { classroomId, worksheets: [ { id, title,
#       participants: [ { participantId, name, kind, groupName,
#                         answerRows: [ { questionId, status, isCorrect, reviewedAt, value } ] } ] } ] }
#   · 三层都按 `resolveMaterialTargetId`（全项目唯一解析口径）分组；标准/分组模式下
#     `worksheets[]` 只有一个元素，「退化成一层」由前端负责（§7.3）。
#   · **不泄漏答案**（§5.4 红线）：只读 `WorksheetAnswer` 行，学习单那边只 select `{id, title}`，
#     `Worksheet.content` 一个字节都不取 ⇒ 响应里没有 `correctKeys` / `answers` / `explanation`。
#     逐题行里的 `value` 是**学生自己写的**那个，与「正确答案」是两件事（§7.3 形态 A 要它）。
#   · **教师专用**：路径是**三段**，刻意不落进 `worksheetAccessGate` 放行的那三种学生形状
#     （最宽的一条只匹配恰好两段）⇒ 学生 token 回 **403**（不是 401）。
#   · 没作答的参与者回**空数组而不是缺字段** ——「已交 N/M」的分母是参与者数。
#
#   ⚠️ 上面这份形状是**照已落地的实现**（`de38dab`）写的，不是设计的形状；该实现尚未过审查门。
#   理由是它解决的问题正是 §7.2 / §7.3 的前提（没有它，看板刷新即失忆、抽屉的 §7.4 四样数据全都读不到），
#   所以把它写进规格比留一个「待回填」的占位更有用。**若审查门改了形状，回填这里。**

# ⚠️ 上面三条原本写的是 `/api/classroom/:id/answers…`，2026-09-23 实施 B1 时裁定改为 `/api/worksheets/:id/…`。
# 理由：学习单的全部端点（教师 CRUD + 学生 student-view + 作答 + 已查看）落在**同一个 router、
# 同一段混装鉴权中间件**里，整个安全面只有一处、可一次审完。若按原写法，学生会话的放行规则会
# 分散在 `/api/worksheets`（student-view）与 `/api/classroom`（作答）两段中间件里 —— 而后者本来就
# 已经很微妙（它自己那句「只有三种形状绕过 teacher 认证」的注释就是为此而写）。
# `:id` 是**学习单 id**；课堂与参与者由 token 解析得出，所以路径上不需要课堂 id。
```

**学生从哪知道自己是哪一份**：**随模式走两条路，来源不同、形状相同**（两边都是 `{ id, title }`）。
唯一的解析口径是 `src/lib/classroom-material.ts` 的 `effectiveGroupWorksheet()`，
按 `classroom.mode` 分支：

| 模式 | 学生端读哪里 | 服务端在哪拼 |
|---|---|---|
| `advanced` | `groups[].worksheet`（**本组那一份**；本组没配就是 `null`，**不回落**） | `resolveGroupMaterialViews()` |
| `standard` / `group` | 课堂级 `worksheets[]` 的**第 0 个** | `loadClassroomWorksheets()`（`routes/classroom.ts`） |

> ⚠️ **2026-09-23 更正（实施 D2 时核出的）。** 本节原先只写了「随 `groups[].materials.worksheet`
> 一起下发」——**那句话对标准 / 分组模式不成立**，而且形状名也是错的（服务端下发的是**扁平**的
> `groups[].worksheet`，不是 `groups[].materials.worksheet`）。三条同时成立：
>   1. `groups[]` 在 `standard` 模式下**根本不下发**（`GET /code/:code` 里它是 `undefined`）；
>   2. `group` 模式下 `groups[]` 会下发，但每组的 `worksheet` **恒为 `null`**
>      （分组模式的材料权威来源是课堂级，`resolveMaterialTargetId` 对它直接返回 `classroomLevelId`）；
>   3. **`join-classroom` 的 `joined` 载荷里只有 `groups[]`，没有课堂级 `worksheets[]`**
>      （当时的 `join-classroom` 没有 `loadClassroomWorksheets`）。
> ⇒ 少了课堂级那一条，标准/分组模式的学生端**完全没有**「老师布置了哪一份」的来源，
> 而界面上只会显示「还没有布置」——**一次没有任何报错的静默差异**。
> 这正是 `loadClassroomWorksheets()` 存在的理由（那段注释逐字写着这三条）。

🔴 **学生端不得只依赖 `joined`。** 学生端今天**根本不监听** `joined`（它只活在
`socket-events.ts` 的类型声明里）；面板读的 `classroom` 来自 `GET /code/:code`
（`use-classroom-session.ts` 的 `setClassroom(cr)`，那条路径**有**课堂级 `worksheets`）。
后续若要改成从 socket 拿首屏，必须先把课堂级 `worksheets` 加进 `joined` 载荷 —— 否则标准/分组
模式会静默退回「还没有布置」。

**每一条学生端路径都必须校验**：该学生所属的参与者，其学习单解析结果**就是**这个 `worksheetId`。
不能只校验 `classroomId` —— 高级模式下不同组拿的是不同的学习单。

**「已查看」端点的鉴权归属**：`/api/worksheets` 是**混装**路由（教师端 CRUD 与学生端三种形状同挂一处），
所以放行正则是安全的关键。`POST /:id/review` **不在**那三种形状里 ⇒ 必须回落到 `requireTeacher`。
⚠️ 改动那段正则时必须重新核对它仍然不匹配 `review` —— 这是 B4 第一条用例的前提。

**学生 token 打到教师端端点应返回 403（不是 401）**：401 是「未认证」（无凭据），
403 是「已认证但无权」。学生 token 是有效的凭据，只是无权 —— 用 401 会谎称未认证。

### 5.4 答卷安全（09-19 §10.1，两条定死）

1. **服务端剥离答案字段**：`student-view` 返回前摘除 `correctKeys` / `answer` / `explanation` 等。
   **过滤在服务端执行，不在前端** —— 前端过滤等同于未过滤。
2. **判分在服务端**：提交某题 → 服务端以注册表 `grade()` 计算 → 只返回 `{ isCorrect }`。
   按 §3-S，**不返回 `score`**。

### 5.5 删除守卫（**三处，漏一处就删出悬空引用**）

| 位置 | 现在数什么 | 加上 |
|---|---|---|
| `routes/agents.ts` 的 `/usage` 与 DELETE 守卫 | `classroomAgent` + `classroomGroupMaterial(kind='agent')` | 不变 |
| `routes/webapps.ts` 的 `/usage` 与 DELETE 守卫 | `classroomWebapp` + `classroomGroupMaterial(kind='webapp')` | 不变 |
| **新增** `routes/worksheets.ts` 的 `/usage` 与 DELETE 守卫 | —— | `classroomWorksheet` + **`classroomGroupMaterial(kind='worksheet')`** + **历史 `worksheetResponse`** |

⚠️ 学习单与网页一样有**课堂级与组级两条路径**。两处都要有**真库测试**。

🔴 **第三项「历史 `worksheetResponse`」不是可选的，理由是一条实测出来的数据库行为**：

Prisma 对必填关系默认是 **`ON DELETE RESTRICT`**（见 §4.1.2 的权威 DDL ——
`ClassroomWorksheet_worksheetId_fkey` 与 `WorksheetResponse_worksheetId_fkey` 都是 `RESTRICT`）。
⇒ **删一张有历史作答的学习单会被数据库直接拒绝。**

于是守卫若只数「未结束的课堂」，就会给教师一个 400 说「没在用」，然后数据库拒绝 ——
**一个说谎的 400 文案**，正是本项目修过的那类缺陷（`p2-group-materials.md` §1.2 ③ 的兄弟）。

所以 `/usage` 要如实回报三件事，DELETE 守卫据此拦截：

```
被 N 个课堂引用（其中 M 个已结束）· 已有 K 份作答
```

**文案要给出出路**：不是「不能删除」，而是「已收到 5 份作答，删除后这些数据会一起消失。
若只是想改内容，请直接编辑；若想要一份新的，请用「复制一份」。」

### 5.6 判分（`grade()`）与归一化

题型注册表**放在服务端**（09-19 §13：「不引入前端测试框架，重逻辑全部放服务端」）。
`grade()` 是纯函数，最值得测。

**填空题归一化**（§3-T）：去首尾空格 → 全角转半角 → 连续空格折叠。
**不做大小写不敏感、不做同义词、不做近似匹配** —— 判错比不判更糟。

### 5.7 实时回传

```
学生改动 ─▶ ① 本地 state + localStorage 队列（零延迟，断网不丢）
          └▶ ② 防抖 1.5s ──HTTP PUT──▶ 落库（status: draft）
                                          └▶ ③ socket 广播 **teacher:<id>** ──▶ 教师看板

> 🔴 **房间名修正（2026-09-23 实施 B4 时实测）**：本节原写 `classroom:<id>`，**那是学生房间**
> （`socket/index.ts` 的 `join-classroom` 加入的就是它）。
> 本广播的载荷含**每名学生的作答状态与对错**，发到学生房间等于把全班情况广播给全班 —— 一次数据泄露。
> 教师看板订阅的是 **`teacher:<id>`**（由 `join-teacher-board` 加入，已实测前缀为 `teacher:`）。
> 实施时把关这段代码的人**已把这条写死进测试**：用例不硬编码房间名，而是先跑真实
> `join-teacher-board` 量出房间再比对，并正面断言 `!== classroom:<id>`。
> 改动房间名会让那条用例立刻变红。
```

**写库走 HTTP 而非 socket**：`PUT` 天然幂等、重试安全、成功/失败语义明确（09-19 §8.3）。
socket 只承担「服务端 → 教师看板」的单向广播。

**广播载荷必须含 `questionId`** —— 看板格子的「正在做第 N 题」（§3-H）靠它。

---

## 六、教师端：编辑器

### 6.1 页面结构

- **列表页** `/teacher/worksheets/`：卡片网格 + 表单弹窗，沿用 `webapps/page.tsx` 的形状
  （`page.tsx` 薄 + `use-*-controller.ts`），含**使用量守卫**（删除前拦截）。
- **编辑页** `/teacher/worksheets/edit/?id=xxx`（**查询参数，不是路径段** —— 静态导出没有动态路由，§3-X）。
  新建时 `?id=` 缺省即空白编辑器。

### 6.2 编辑页布局（§3-K 方案乙）

```
┌─────────────────────────────────────────────────┐
│ ← [ 光合作用实验 ]  已保存 14:32   [设置][预览]  │
├─────────────────────────────────────────────────┤
│ ① 单选题                                ▲▼ 🗑    │
│   题干 [                                  ]     │
│   ○ A    ○ B    ○ C                             │
│   ─────────────────────────────────────────     │
│ ② 填空题                                ▲▼ 🗑    │
│   题干 [              ]  答案 [              ]   │
│   ─────────────────────────────────────────     │
│ ③ 问答题                                ▲▼ 🗑    │
│   题干 [                                  ]     │
├─────────────────────────────────────────────────┤
│                  ＋ 添加题目                     │
└─────────────────────────────────────────────────┘
```

- **题目流里直接编辑全部内容**（题干、选项、正确答案）。**第一批没有 `⚙`** ——
  原设计里的两个候选（输入方式、是否自动判分）都已上移：前者不做 UI（§3-V），
  后者是学习单级开关（§3-L）。
- **加题 = 点底部「＋ 添加题目」**，弹出题型选择后追加到末尾。
- **调序用 ▲▼**，不做拖拽（第一批题目少，且箭头的语义比拖拽手势更明确）。
- **字段「答案」多可接受答案时一行一个**（§3-R）。

### 6.3 顶栏

| 元素 | 行为 |
|---|---|
| ← 返回 | 有未保存改动时确认 |
| 标题 | 直接编辑，改得最勤所以留在顶栏 |
| 保存状态 | `已保存 14:32` / `保存中…` |
| **设置** | 抽屉/弹窗：描述、**自动判分**、**提交后可否修改** |
| **预览** | **按 iPad 宽度渲染的弹窗**（不是整页跳转）—— 价值正在于「教师看到的就是学生看到的那个宽度」 |
| 复制一份 | 深拷贝后跳到新副本 |

### 6.4 必须实现的三件

1. **撤销 / 重做** —— reducer 管理 `content` 树 + undo 栈。`Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z`，
   顶栏也给按钮（教师不一定知道快捷键）。
2. **自动保存草稿** —— 每 10 秒或失焦，**只写 localStorage**（§3-Y）。
3. **被使用时警告**（§3-J）：

   ```
   顶栏：⚠ 本单正在被 2 堂课使用 · 学生需刷新或重新进入学习单才能看到新内容
   删题：「已收到 31 份第 3 题的作答，删除后这些作答将在看板与导出里
          变成孤立数据。确定删除？」
   ```

   > 🔴 **2026-09-23 更正（实施 D2 / D3 时核出的）。** 本节原先写的是「保存后学生端会**立即**
   > 看到变化」——**那是一句假话**，已改。服务端对学习单**内容**（`Worksheet.content`）变更
   > **没有任何广播**：`routes/worksheets.ts` 里唯一的 `emit` 是作答变化
   > （`worksheet-answer-updated`，发给 `teacher:<id>`），而 `PUT /api/worksheets/:id`
   > **一个 socket 事件都不发**；学生端面板也只在**挂载时**拉一次 `student-view`。
   > ⇒ 学生**刷新或重新进入**学习单才会看到新内容。
   >
   > ⚠️ **警告本身要保留** —— 「你正在改一张在用的单」这件事仍然成立（`/usage` 数的是
   > `ClassroomWorksheet` + `ClassroomGroupMaterial(kind='worksheet')` + 历史 `WorksheetResponse`），
   > 假的只是「立即」那半句。不要因为改掉后半句就把整条横幅删掉。
   >
   > 待定项见 §13-7。

### 6.5 兼容性

编辑器只跑在教师桌面浏览器上，**不受 Safari 15 约束**（§1.5）。用现代 API 时构建日志会出现
「边界提示」，那不是报错。

---

## 七、教师端：看板

### 7.1 四层可见范围

| 层 | 内容 | 第一批 |
|---|---|---|
| 顶栏入口 | 一个**与「跟随/指定」模式无关**的「学习单」入口，点开按题抽屉 | ✅ |
| 格子内容区 | 见 7.2 | ✅ |
| 抽屉（两种形态） | 见 7.3 | ✅ |
| 顶部「各模块人数」 | 学习单计入 | ✅（文案问题见 §13） |

### 7.2 格子内容区（实测 **214 × 150 px**）

卡片固定 `height: 260`（`page.tsx:1698`），内容区约 214×150。
**标准模式与分组/高级模式共用同一套渲染** —— 因为那里的一格本来就是一个参与者（§1.2）。

```
┌─────────────────────────────┐
│ (◉) 张三 #12    ⛔ ✉ ⭐ 🗑   │
│ ● 在线   已交 2/3            │   ← 徽章行：「N 轮」→「已交 N/M」（§3-I，仅学习单模块下）
│ ┌──────────────────────────┐ │
│ │ 正在做  第 3 题 · 填空题  │ │
│ │ ▣ ▣ ◐ ▢ ▢ ▢ ▢            │ │   ← 方格阵：逐题状态
│ └──────────────────────────┘ │
└─────────────────────────────┘
```

> 徽章的文字是 **「已交 N/M」**（已**提交**的题数 / 总题数），**不是**「已看 N/M」——
> 见 §3-I 的更正与 §7.4（`N` = `status === 'submitted'` 的行数，**不是** `reviewedAt`）。

**四种状态**（§3-H，「正在做」与「停住了」是同一件事的两面，中间只隔一个无操作阈值）：

| 状态 | 显示 |
|---|---|
| 还没收到作答 | `还没收到作答` + 第二行「打开看板后的新作答会实时显示」。**不画方格阵**（理由见下） |
| 正在做 | `正在做 第 3 题 · 填空题` |
| **停住了** | `停在第 3 题 · 8 分钟` + **琥珀底 + 文字，不用 ⚠ 图标**（§3-AD） |
| 全部提交 | `✓ 8 题已全部提交` |

> 🔴 **第一态是「还没收到作答」，不是「还没有开始作答」；而且不画方格阵。代码是对的。**
> （2026-09-23 实施 D3 时裁定；本节原先写的是「`还没有开始作答` + 全灰方格阵」。）
>
> **理由是一条端点事实**：看板**没有拉取历史的端点** —— 它拿不到「打开这一页之前」的作答行，
> 只知道「打开之后收到的广播」。⇒ 教师**每次刷新看板**，一个早就做完的学生也会落到这一态。
> 写成「还没有开始作答」就是**编了一个假事实**（它把「我不知道」说成了「他没开始」）；
> 画全灰方格阵更糟 —— 那是**逐题**宣称「未答」，而逐题恰恰是我们最不知道的那一层。
>
> 所以这一态说的是**能确证的那一句**（`还没收到作答`），第二行同时解释了「这个格子为什么不动」。
>
> ⚠️ **不要把它「改回去」。** 回到「还没开始 + 全灰方格阵」需要的是**新的数据源**
> （教师端按课堂读作答全貌的读端点，见 §5.3 的占位），**不是改文案**。
> 只改文案而不补端点，那是一次**引入假话的回归** —— 看上去更锐利，实际是把「不知道」
> 渲染成了「知道」。
>
> 四态的**判据**在数据到手后是逐条实现的；差别只在这一态**画不画**格子。
> 代价（如实记）：它比「还没开始」少了一点锐度。

**判据**：「正在做哪题」= **最后一次保存的题**，**不引入滚动位置上报**（滚动位置不等于在做哪题，
且整卷滚动会产生大量滚动事件）。
**「停住了」** = 在线 且 距最后一次保存 > 5 分钟 且 未全部提交。

**方格阵着色 = 状态**（未答灰 / 作答中琥珀 / 已提交蓝），**不编码对错**。
理由：教师拿到「哪道题错得多」会去讲那道题（按题聚合，7.3）；「哪个学生第 3 题错了」不是课上
能当场处理的信息。而五档颜色在 28px 方块上难分辨，红绿对色觉障碍教师尤其不友好。

> **对错在抽屉里**（7.3），不在格子里。

### 7.3 抽屉（同一块 420px 位置，两种形态）

**形态 A — 点某个学生/组**：逐题作答详情

```
┌─ 张三 · 学习单 ─────────────┐
│ 1. 单选   ✓  (已看)          │
│ 2. 填空   ✗  (已看)          │
│ 3. 问答   ◐  作答中          │   ← 主观题没有 ✓/✗（无 isCorrect）
│ 4. 问答   ✓  [标记已查看]    │   ← 主观题只有「已查看」（§3-D）
│ 5. 单选   ─  未作答          │
└─────────────────────────────┘
```

> 用词说明：`✓` = 答对，`◐` = 作答中，`─` = 未作答（与 09-19 §9.5 的图例一致）。
> 未开启自动判分时 `✓` 退化为「已提交」（09-19 §9.5）。

**形态 B — 点顶栏「学习单」**：先按学习单分组，再按题

```
┌─ 学习单 ─────────────────────┐
│ 《光合作用实验》   5 个组在用  → │
│ 《凸透镜成像》     3 个组在用  → │
└──────────────────────────────┘
        ↓ 点第一份
┌─ 光合作用实验 · 按题 ─────────┐
│ 1. 单选   正确 92%   已交 5/5  │
│ 2. 填空   正确 65%   已交 5/5  │
│ 3. 问答    —        已交 4/5  │   ← 主观题没有正确率
└──────────────────────────────┘
        ↓ 点第 2 题
┌─ 2. 填空 · 全部作答 ──────────┐
│ 第 1 组  「光合作用」   ✗      │
│ 第 2 组  「光合作用」   ✓      │
└──────────────────────────────┘
```

> 标题写「全部作答」而不是「全班答案」：分组/高级模式下这里列的是**参与者**（是组不是人），
> 而且答案本来就不下发给学生端 —— 「答案」这个词在本项目里已被 §5.4 占用为「正确答案」。

🔴 **「先按学习单分组」不是可选的多余一层** —— 高级模式下每个组可能是**不同的学习单**（§3-A），
「全班共有的第 3 题」并不存在。标准/分组模式下只有一份，它会自动退化成一层。
「已交 N/M」在标准/分组模式下 N 是学生数、在高级模式下是组数（§3-AG）。

### 7.4 数据来源

| 数据 | 来源 |
|---|---|
| 「正在做第 N 题」 | 每次保存的 socket 广播（含 `questionId`，§5.7） |
| 逐题状态 / 对错 | `WorksheetAnswer` 的 `status` / `isCorrect` |
| **历史作答（刷新后补读）** | `GET /api/worksheets/classroom/:classroomId/answers`（§5.3）—— **只看广播会失忆**：广播只在「学生刚保存/提交」那一刻发一次，教师刷新一次页面，早做完的学生就掉回「还没收到作答」态，且不报任何错 |
| 徽章「**已交 N/M**」 | `WorksheetAnswer` 里 `status === 'submitted'` 的行数 / `content` 的题数（**不是** `reviewedAt`，见 §3-I） |
| 按题聚合（正确率 / 已交） | `WorksheetAnswer` 按 `questionId` 分组统计 |
| 逐题「已查看」标记（`reviewedAt`） | 同一个课堂读端点（`POST /:id/review` 只写，读要靠它）。⇒ **读数今天已经拿得到了**，「已看 N/M」在数据上已可算 —— 但徽章**仍用「已交 N/M」**：教师课上问的是「还剩几个我没看」而不是「交了几题」，换成「已看」是一次**产品决定**，不是数据可用性问题（§3-I 的口径）。 |

**不做按需推流**（§3-AF）。

---

## 八、学生端：作答

### 8.1 外壳契约：层内滚动

`shell.module.css:503-508` 的 `.stage` 是 `overflow: hidden`，注释写明
「每一层自己管自己的滚动（主页层滚动、面板层内部滚动）」。
⇒ **学习单面板必须是 `height:100%` + 内部滚动容器**，**不是**滚页面。这条没得选。

### 8.2 布局

```
┌─ 外壳顶栏（不动）─────────────────────────────────────┐
│ 首页  学习单  探究空间  智能学伴   ●已连接 👤张三 ⋯  │
├───────────────────────────────────────────────────────┤
│ 《光合作用实验》   ▓▓▓▓▓░░░ 3/8   已保存 ✓   ⭐×3     │
├───────────────────────────────────────────────────────┤
│  ①  判断题                                ✓ 已提交    │
│     题干……                                            │
│     ○ 对   ○ 错                                       │
│                                                       │
│  ②  填空题                                ◐ 作答中    │
│     题干…… [                    ]                     │
│                                    [ 提交本题 ]        │
│                                                       │
│  ③  问答题                                            │
│     题干……                                            │
│     [                                     ]           │
└───────────────────────────────────────────────────────┘
```

- **整卷滚动**（09-19 §8.2，不做「一次一题」的分步模式）
- **不做题目导航**（§3-M）。进度条已经告诉学生还有几题。
- **「提交本题」内联在每题下方**（§3-AC）
- **状态挂在题号旁**：`✓ 已提交` / `◐ 作答中` / 空白 = 未作答
- **保存状态只在顶部那一条**：`已保存 ✓` / `保存中…` / `⚠ 离线 · 3 条待同步`（断网整条变琥珀）

### 8.3 离线队列

断网时本地队列持续累积，`online` 事件恢复后自动重放。
**绝不静默丢数据** —— 这是 09-19 §8.3 的硬要求，也是本模块最不能出错的地方。

### 8.4 边界情况

| 情况 | 行为 |
|---|---|
| 答到一半被教师切成「预告 / 隐藏」 | 提示 + 送回首页，**已作答内容不丢**（09-19 §4.4，学习单不特殊） |
| 高级模式下本组没配学习单，而模块被开放 | 显示「本组未配置学习单」，**不拿别组的顶上**（与探究空间同口径） |
| 设置 `allowResubmit` 为真，学生改已提交的题 | 状态回到 `draft`，再次提交时重新判分并更新 `submittedAt` |
| 设置 `allowResubmit` 为**假**，学生改已提交的题 | 🔴 **服务端回 `409`**，且**库里那行一个字节都不动**（见下） |
| 提交后想再改 | 按钮文案变成「重新提交」 |

> 🔴 **`allowResubmit: false` 的契约 —— 这是跨端契约，不是某一侧的实现细节。**
>
> 1. **服务端**：`PUT /api/worksheets/:id/answers` 与 `POST …/answers/submit` 在
>    「该题已 `submitted` 且 `allowResubmit === false`」时回 **`409`**
>    （`routes/worksheets.ts` 里 `res.status(409).json({ error: '老师已设置本题提交后不可修改' })`）。
>    ⚠️ 用 **409** 而**不是 400**：本文件里 400 表示「请求本身有问题」，两者混用会让学生端的
>    离线队列把「重试就好」与「这条永远不可能成功」判成同一类。
>    ⚠️ 这道闸门**排在 `ensureResponse` 之前** ⇒ 被拒的保存**不留痕迹**
>    （不会凭空建出一行作答会话，教师看板上不会把拒绝显示成「已开始作答」）。
> 2. **学生端**：`src/app/classroom/worksheet/worksheet-queue.ts` 的
>    `isPermanentFailure(status)` 按 **`4xx`（含 `409`）⇒ 永久失败 ⇒ 丢弃 + 向学生报明；
>    `5xx` 与网络错误（`status === null`）⇒ 暂时失败 ⇒ 保留重试** 分流。
>    ⇒ 409 走的正是「丢弃」那一支。这条判据与服务端那条约定是**一对**，
>    **改一边就要看另一边**：只改一边的两个后果都是静默的 ——
>    要么队列永远重放一条被拒的请求（顶栏永远挂着「⚠ 离线」），
>    要么学生的作答被悄悄扔掉（§8.3 明令禁止的那件事）。
> 3. **界面**：`allowResubmit` 为假时，已提交那题的控件**收起**、按钮换成一句
>    「老师已设置本题提交后不可修改」。只靠服务端 409 是不够的 —— 学生仍会敲字、看见自己在改，
>    然后那次改动被丢掉。

---

## 九、奖励形式

### 9.1 分层（这一层是硬边界）

```
数据层     isCorrect: true | false         ← 永远只有这一种，永远落库的只有它
              │
呈现层        ├─ 对错    ✓ / ✗
              ├─ 星星    ⭐ ×N
              ├─ 花朵    🌸 ×N
              └─ 分数    +N
```

**四者是同一个布尔值的四种画法。** 显示值 = `isCorrect ? N : 0`；累计 = 答对题数 × N。

🔴 **绝不把星星/花朵/分数存进数据库。** 一旦落库，教师端「哪道题错得多」、导出、
P4 的分析型智能体都要面对一个「⭐ 是什么数」的问题。

### 9.2 配置

**全局设置，四选一 + 步长 N**，放在 `/teacher/` 首页现有设置区里新开的「作答反馈」分组
（今天项目**没有独立设置页**：教师端能改的全局设置只有「局域网访问」一个开关，
`bind-ip` 连前端 UI 都没有）。

```
┌─ 作答反馈 ─────────────────────┐
│ 奖励形式  ○ 对错                │
│           ● 星星 ⭐             │
│           ○ 花朵 🌸             │
│           ○ 分数 ＋              │
│                                │
│ 每答对一题  得 [ 1 ▾] 个         │   ← 1 / 2 / 3 / 5
└──────────────────────────────┘
```

**步长的量词随形式变**：星星/花朵是「个」、分数是「分」、对错没有步长（选了「对错」时这一行不出现）。

- **不做「学段（小学/初中）」这个中间概念** —— 见 §3「明确不做」
- **改步长会追溯性改变已显示的累计值** —— 全局设置设一次就不动，可以接受，但要知道

### 9.3 出现的地方

- **学生端每题旁**（交完立刻）+ **顶部累计**（`⭐×3`）
- **教师端不出现**（§3-U）—— 看板、抽屉、按题看全部保持对错与正确率口径
- 主观题没有奖励（没有 `isCorrect`）
- **关掉自动判分 = 没有 `isCorrect` = 没有奖励** —— 不需要第二个开关
- 动画（星星飞入）属 P3 视觉打磨，第一批是静态图标 + 出现即显示

---

## 十、第一批的范围与验收

### 10.1 范围

```
数据模型（Worksheet / ClassroomWorksheet / WorksheetResponse / WorksheetAnswer）
题型注册表（服务端）+ 3 种题型（单选 / 填空 / 问答）
教师编辑器（单列 + ＋添加 + ▲▼ + 撤销重做 + 自动保存草稿）
教师列表页（卡片网格 + 使用量守卫 + 复制一份）
课堂关联（课堂级容器 + 高级模式第三个下拉 + 三件套判据 + 删除守卫）
学生作答（整卷滚动 + 离线队列 + 逐题提交 + 输入框键盘处理）
实时回传（保存 → socket → 看板，含 questionId）
教师看板（格子四态 + 徽章行 + 两种抽屉形态 + 按题聚合）
奖励形式（全局设置 + 学生端呈现）
公共 hook（iOS 键盘 / viewport，chat 与学习单共用）
```

> ⚠️ **2026-09-23 更正**：上面「教师列表页」那一行**去掉了「预览」**。
> 本节原先写着「卡片网格 + 使用量守卫 + 复制一份 + **预览**」，但实现只在**编辑器**里做了预览
> （`/teacher/worksheets/edit/` 顶栏的「预览」按钮 → 按 iPad 宽度渲染的弹窗，§6.3），
> 列表页那张卡的主动作是**跳转到编辑器**（`worksheet-card.tsx` 的注释逐字写明）。
> 列表页**没有**预览，别照着本节加回来 —— 「教师看到的就是学生看到的那个宽度」这件事
> 只有编辑器那个弹窗保证，列表页再加一个就是第二份实现。

### 10.2 验收标准

**端到端（这一条是第一批存在的理由）：**

> 教师做出一张 3 题的学习单 → 建一堂课并关联它 → **真学生在一台老 iPad 上做完并逐题提交**
> → 教师看板实时显示「正在做第 N 题」、进度、与按题正确率 → 断网重连后答案一条不丢。

**其余必过项：**

- [ ] 高级模式下，某组配了学习单而另一组没配 ⇒ 两组学生各自看到正确的内容 / 「本组未配置学习单」
- [ ] 学生端 `student-view` 返回的 JSON **不含任何答案字段**（自动化用例）
- [ ] 学生 token **不得**访问教师端 worksheet 端点；也不得读**别组**那一份的 `student-view`
- [ ] 删除一张被组级引用的学习单 ⇒ 被守卫拦下（真库测试）
- [ ] 教师改一张正在被使用的学习单 ⇒ 顶栏出现警告；已作答数据不错位（改题干、加题两种情形）
- [ ] 断网期间作答 → 恢复后全部落库，界面状态从「离线 · N 条待同步」回到「已保存」
- [ ] `npx tsc --noEmit` 退出 0；`npx eslint` 不新增 warning；`./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status` 复核 4000/4001 都在
- [ ] `cd server && pnpm test` 全过（**基线以动手前实测为准，不要引用更早的数字**）

---

## 十一、测试要求

现有测试在 `server/src/tests/`，`node --test` 运行。本次新增（09-19 §13 的清单继续有效）：

| 测试项 | 说明 |
|---|---|
| **题型注册表 `grade()`** | 纯函数，最值得测。第一批覆盖：单选（含多选答案的编辑期校验）、填空的**多个可接受答案**、填空的**归一化**（首尾空格 / 全角 / 连续空格 / **大小写必须不归一**） |
| **答案 value 序列化往返** | `choice/v1` / `fill/v1` / `text/v1` 均可存可取 |
| **学生端 content 过滤** | ★ 安全测试：断言 `student-view` 的 JSON **不含任何答案字段**。必须自动化 |
| **提交状态机** | `unanswered → draft → submitted → draft`（允许重提交时）与 `submittedAt` 更新 |
| **材料解析** | `kind='worksheet'` 的逐组合断言：advanced + 自己组有 / 自己组无 / 找不到组 / group / standard。**「自己组无」必须带反证**：课堂级容器里故意放一份别的组的，断言学生**没拿到它** |
| **越权读取** | 学生 A 不能读 B 组那一份的 `student-view`、不能提交到 B 组的 response |
| **删除守卫** | 只被**组级**引用的学习单 ⇒ `/usage` 为真且删除被拦下（与网页同构，**这一条是新的**） |
| **API 鉴权** | 学生 token 不得访问教师端 worksheet 端点，也不得调用模块控制端点 |

**不引入前端测试框架**（09-19 §13）。前端逻辑保持薄，重逻辑全部在服务端。

---

## 十二、里程碑与后续批次

> 🔴 **编号已于 2026-09-23 统一，单一来源是 `specs/2026-09-23-milestones.md`。**
> 本节下面的表沿用当时的编号，**不再作为编号依据** —— 要查编号去那份总表。
> 起因：之前三套编号混用（P0 的 M0/M1a/M1b-1/M1b-2/M1b-3、P2 的 T0–T8、本节的 M3/M4/M6/M7），
> 用户明确表示「看不明白」。历史文档里的旧编号不改（改了会与新文档打架）。

| | 内容 |
|---|---|
| **M3** | 本文 §10.1 的全部内容（第一批） |
| **M4** | 题型扩充 —— **8 个**，见下方「M4 的范围（2026-09-23 用户裁定）」 |
| ~~**M5**~~ | **已并入 M4**（手写与绘图原本在这里）—— 所以 M5 空掉，M6/M7 顺次上移 |
| **M6** | 学生 × 题目矩阵 · 课堂级「锁定作答」· 顶部文案修复 · **逐题投放（若届时决定要做，见 §13-1）** |
| **M7** | P3 收口（导出、课堂历史、视觉打磨） |

### M4 的范围（2026-09-23 用户裁定）

第一批只做了 3 种题型（单选 / 填空 / 问答），用户认为太少，**M4 一次扩到 8 种**：

| 新增 | 成本 | 备注 |
|---|---|---|
| 判断题 | **几乎免费** | 单选题的特例（选项固定为对/错）—— 注册表设计兑现的地方 |
| 多选题 | **很便宜** | 与单选题同构，只差「可多选」 |
| 填空题**多个空** | 中 | ⚠️ **不是新题型，是把现有填空题从「一题一个空」扩到「一题干多个空」**（§3-R 当时裁掉了它） |
| 排序题 | 中 | 纯叶节点 |
| 连线题 | 中 | |
| **归类题**（用户本次新增） | 中 | 把若干条目拖到对应的框/圈里。**不需要容器结构** —— `data: { items, zones }` + 答案 `placement: { itemId: zoneId }`，`content` 树不用动 |
| 手写笔迹（输入方式，非题型） | **高** | 从零建 Canvas 层 |
| 绘图题 | **高** | 与手写共用 Canvas 层 |

🔴 **它们不是八件独立的事，而是两个新能力层 + 一批题型**：

- **触屏拖拽**（项目里**至今为零** —— 全仓只有教师端 `classes/page.tsx` 两处 HTML5 `draggable`，
  桌面可用、**iOS Safari 根本不触发**）⇒ 排序 / 连线 / **归类** 三题共用
- **Canvas 手写层**（项目里没有任何画布库）⇒ 手写 / 绘图 共用

### 🔴 M4 重开了 §3-S（分值）

**多选判分口径：用户裁定「教师逐题选：全对才算 / 漏选算半对」。**

⇒ 「半对」= **部分得分**，而 §3-S 明确写着「不建 `score`，只留 `isCorrect`，理由是可推导」。
**那个前提被打破了**：`isCorrect: boolean` 表达不了「一半对」。
同一件事还牵涉**排序题与连线题的部分正确**（09-19 §13 早就把这两条列为「必须定口径」）。

⇒ **M4 需要一个新的得分模型**（0/0.5/1 或 0..N），并在 `WorksheetAnswer` 上落一个字段。
**M4 的计划必须先定这个，再定判分。**

**连带**：奖励形式要**由得分驱动、而非对错布尔**，且教师可配**两档步长**
（用户原话：「全对给两朵小花，半对半错给一朵」）。
第一批的 D5 **已按此写**（今天得分只可能是 0 或 1，行为逐字不变），M4 只需多一行配置。

### M4 另两条（2026-09-23 用户裁定）—— 都**推翻**了第一批的既有决定

**① 「得分制 / 小花五角星制」由教师在编辑器里逐单选择 —— 推翻第一批的「全局设置」**

用户原话：「教师在编辑学习单时，可以选择得分制还是奖励小花、五角星的制度」。
- 第一批的 §9.2 是**全局设置**放在 `/teacher/` 首页（裁定 N，理由是「一个老师带的学段固定」）。
  **该决定作废**：配置搬到**学习单级**（`Worksheet.settings`）。
- 全局那一份**不保留** —— 有学习单级的就不需要两层（第一批已经因为同样理由砍掉过「学段」这个中间概念）。

**② 逐题赋分 / 逐题赋花数 —— 也归 M4，不进第一批**

用户原话：「然后给每一道题目赋分，或者赋一定数量的小红花或五角星」。
⇒ `content` 的每个题目节点要加一个「分值 / 数量」字段。

**控制器裁定：归 M4，不回头改第一批。** 理由：
- 「逐题赋分」若进第一批，要**返工已完成的编辑器（C2）与题型注册表**，且第一批的判分、
  奖励显示、看板统计都要跟着改
- 它与「部分得分」「两档步长」本来就是**同一件事的三个面**，一起做才不会互相打架
- 代价（如实记）：**第一批上线后，教师还不能逐题赋分**，全单统一

---

## 十三、待定项

| # | 事项 | 现状 |
|---|---|---|
| 1 | **逐题投放**（教师逐题解锁、强制全班同步） | 机制清晰：题级可见性 + 教师端控件 + 学生端「未投放」占位；数据结构改动小（`content` 每题加字段），**加的时候不用迁移**。等真在课上用过整张发之后再定 |
| 2 | **「各模块人数」在分组/高级模式下其实是组数** | 已确认为既有缺陷，但**界面元素已经换了、缺陷本身未复验**。⚠️ 2026-09-23：原写作时指的**那张「此刻各模块人数」卡已被撤走** —— 那些数字**搬进了看板上方的「模块筛选行」**（`page.tsx` 的 `aria-label="按模块筛选"` 那一行，六个胶囊；卡片位置的注释逐字写着「那些数字搬到了看板上方的模块筛选行…此刻这张卡已经没有别的内容可显示」）。⇒ 本条的引用从 `page.tsx:1454` / `:1146` **改指向模块筛选行**。**「组数 / 人数」这个缺陷在新位置上还成不成立，本次没有复查**（要实际开一个分组/高级模式的课堂看那一行的数字与标签才判得了）。修法不变：按 `classroom.mode` 切换文案，或改成中性的「N 个参与者」。**本次不擅自决定** |
| 3 | **`ExploreMemberStrip` 可能只会画出一条成员条** | 分组/高级模式下 `ClassroomStudent` 一组只有一行（§1.2），而 `groupCards` 按 `groupId` 聚合 `students` ⇒ `item.members` 只可能有一个元素。**未核实完**（需要实际打开一个分组模式的课堂看）。与学习单无关，但属于同一块代码 |
| 4 | **「N 轮」在其他模块下要不要一起处理** | 本次只决定了学习单模块下换成「已交 N/M」（§3-I）。探究空间 / 首页下要不要也去掉，未定 |
| 5 | **答错是否扣减** | 本次不做。有扣减时显示值 = f(答对数, 答错数, N) 仍可推导，但会多出「下限 / 负分」一套策略 |
| 6 | **第一批与手写批次之间的间隔** | 见 §14 |
| 7 | **改单后学生端没有通知**（§3-J / §6.4 的「立即看到变化」为什么改成「刷新或重新进入」） | 服务端对学习单**内容**变更**没有任何广播**：`routes/worksheets.ts` 里唯一的 `emit` 是作答变化（`worksheet-answer-updated` → `teacher:<id>`），`PUT /api/worksheets/:id` 一个 socket 事件都不发；学生端面板也只在**挂载时**拉一次 `student-view`。⇒ 「教师改单、学生当场看到」今天不成立。**第一批不做**（判定：课上改单是低频动作，刷新一次的成本远低于为它加一条广播 + 学生端热更新的复杂度）。**要真做**的话有两处要一起动：`PUT /:id` 发一条 `worksheet-content-updated` 到 `classroom:<id>`，学生端收到后重拉 `student-view` —— 而**`student-view` 的返回里题目 id 是稳定的**（§3-P），所以重拉不会打乱学生已有的作答。⚠️ 在那之前，§6.4 的横幅文案**不得**写回「立即」 |

---

## 十四、已知代价与风险（如实记，不粉饰）

### 14.1 🔴 第一批低年级用不了

第一批**只有键盘输入**。二年级学生打不出「光合作用」。
⇒ 要么第一批只找高年级试，要么**第一批到 M4（手写）之间不要拖太久**。
这是一个**知情的取舍**，不是遗漏。

> ⚠️ **2026-09-23 更正**：本节原先写的是「第一批到 **M5**（手写）」。手写已**并入 M4**
> （见 `specs/2026-09-23-milestones.md`：M4 = 题型与得分，含手写笔迹 / 绘图题；
> **现在的 M5 是「看板与课堂控制」**，与手写无关）。编号的单一来源是那份总表。

### 14.2 ⚠️ 软键盘遮挡是这个代码库里踩过坑的区域

`chat-panel.tsx:146-200` 里有：用 `visualViewport` 算可用高度写进 CSS 变量
（iPadOS 的 `100vh` **不随键盘变化**）、120ms settle 补偿老 WebKit 首次 resize 的 `offsetTop=0`、
`readOnly → focus → 去掉 readOnly` 强制弹键盘且保证 `readOnly` 不会被永久留在 `true`。

第一批每一个填空/问答都会走这条路径。**必须抽成共用 hook（§3-AB），不得复制。**

### 14.3 ⚠️ 「只警告不拦」依赖 §3-P

J（改单只警告）成立的前提是 `WorksheetAnswer` 按 `questionId` 关联。
哪天有人改成按下标，这个警告就变成假的 —— **实施时必须在代码里写死这条理由**。

### 14.4 判分错误教师会发现但难以定位

09-19 §13 原话。所以 `grade()` 必须有自动化用例，尤其是填空的归一化边界。

---

## 十五、原设计文档需要改写的章节

`specs/2026-09-19-classnode-learning-suite-design.md`：

| 章节 | 处理 |
|---|---|
| §6.2 分层教学「P1 不做」 | **作废**（§1.1），改为指向本文 §4 |
| §6.1 表结构 | **修正**：`WorksheetResponse` 用参与者 id（§3-Q）；`score` 不建（§3-S） |
| §6.4 教师端 API | 补充（本文 §5.3） |
| §7.7 分批交付 | **作废**（§3-B 改成纵向切），改为指向本文 §12 |
| §8.1 编辑器 | **取代**（§3-K 方案乙），改为指向本文 §6 |
| §8.4 提交语义 | 补充「已查看」与批改口径（§3-D） |
| **§9 教师看板** | **整节取代**（§1.3），改为指向本文 §7 |
| §13 测试策略 | 补充本文 §11 的用例 |
| §14 里程碑 | **取代**，改为指向本文 §12 |
| §3 YAGNI 里「分层教学 P1 不做」 | **划掉**（按组同构已经做了） |
| §15.4 的「分层教学」 | **划掉** |

**处理方式（2026-09-23 已完成）**：原文**不删除**，而是在该文档开头加了一段
「部分章节已被取代」的横幅，逐节列出状态表并指向本文 —— 保留决策痕迹。
之所以不逐节改写：那是 11 处散落的编辑，而横幅把同一件事说了一遍且不会与原文打架。
