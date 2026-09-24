# M5a · 课堂级「锁定作答」+ 看板数字口径 · 设计规格

> 日期：2026-09-25 · 分支 `main`（M4b 已并入，HEAD `2ad9c80`）· 状态：**待用户复核**
> 权威规格：`specs/2026-09-23-p1-worksheet.md`（§13 待定项、§8.4 三层控制、§7 看板）
> 里程碑：`specs/2026-09-23-milestones.md`（M5 = 学习单 · 看板与课堂控制）
> **本文件只是 M5a 的设计。**「学生×题目矩阵总览」与「逐题投放」**不在本轮**（理由见 §1）。
> ⚠️ 本文件里每一个 `file:line` 都是**写这份文件时实跑过的**（本仓行号会漂；动手前请自己再 grep 一遍）。

---

## 一、范围与依据

M5 在里程碑里是四件事。逐件的**当前状态**（依据逐条见 §2）：

| 子项 | 当前状态 | 本轮 |
|---|---|---|
| **课堂级「锁定作答」** | 设计只有一句话（`classnode-learning-suite-design.md:759`：课堂级按钮、默认未锁定、可解锁）；**服务端零落点** —— 今天暂停课堂**只禁提问、不禁作答**（见 §2.4）⇒ 这是一个**真洞**，不是一个新概念 | ✅ **做** |
| **顶部「人数 / 组数」** | 模块筛选行的数字在分组/高级模式下是**组数**，而代码里有一句注释断言「单位是**人数**」（在分组模式下为假，见 §2.6） | ✅ **做** |
| **学生×题目矩阵总览** | 生效形态**不存在**：旧设计（`classnode-learning-suite-design.md:834-847`）所在的 §9 已被 p1 §7 **整节取代**；且旧形态让每格画 ✓/✗，与 M3 的裁定「方格阵着色 = 状态、**不编码对错**」（`p1-worksheet.md:760`）**冲突** | ❌ 下一轮 |
| **逐题投放** | 文档自己把它挂在「等真在课上**用过整张发**之后再定」（`p1-worksheet.md:1304`），而那个前提**至今没发生**（第一次真机验收还没做） | ❌ 下一轮 |

**裁定来源（2026-09-24，用户逐条选择）**：① 范围 = 锁定 + 文案；② 锁 = **新开一个课堂级布尔列**（不动现有的「暂停学生提问」）；
③ 语义 = **停笔，但还能交卷**；④ 文案 = 模块行**按 `mode` 加量词**（人 / 组），页头不动。

---

## 二、事实基线（**全部实跑过**；命令与逐字输出）

> 本仓的 `grep` 是一个转发给 `claude -G`（ugrep）的 wrapper ⇒ 下面一律用 `/usr/bin/grep`。

### 2.1 课堂级布尔列的现有形状

```bash
/usr/bin/grep -n "model Classroom" -A 12 server/prisma/schema.prisma
#   108:  mode      String   @default("standard") // standard / advanced
#   109:  status    String   @default("active") // active / paused / ended
#   110:  allowStudentStop Boolean @default(true)
#   111:  allowStudentExport Boolean @default(true)
#   112:  allowFollowUps Boolean @default(true)
//   115:  webappCaptureEnabled Boolean @default(true)
```
⇒ 新列 `answersLocked Boolean @default(false)` 与它们是**同一形状**。

### 2.2 DDL 在本仓要**两处一起改**（这是既有做法，不是新规矩）

```bash
/usr/bin/grep -n 'ALTER TABLE "Classroom"' server/src/index.ts
#   399:  ... ADD COLUMN "allowStudentExport" BOOLEAN NOT NULL DEFAULT 1
#   404:  ... ADD COLUMN "webappCaptureEnabled" BOOLEAN NOT NULL DEFAULT 1
#   408:  ... ADD COLUMN "webappThumbnailWidth" INTEGER NOT NULL DEFAULT 320
#   412:  ... ADD COLUMN "webappFrameIntervalMs" INTEGER NOT NULL DEFAULT 10000
sed -n '394,400p' server/src/index.ts
#   const classroomCols = await prisma.$queryRawUnsafe(`PRAGMA table_info('Classroom')`);
#   const classroomColNames = classroomCols.map(c => c.name);
#   if (!classroomColNames.includes('allowStudentExport')) {
#     await prisma.$executeRawUnsafe(`ALTER TABLE "Classroom" ADD COLUMN "allowStudentExport" BOOLEAN NOT NULL DEFAULT 1`);
```
⇒ 新列照抄这段形状（探测用 `PRAGMA table_info`、`DEFAULT 0`）。
🔴 **按 GC 4：DDL 只在 `/tmp` 库上验，绝不打在 `server/prisma/dev.db` 上。**

### 2.3 「暂停」与「结束」的端点与广播（新锁照它们做）

```bash
/usr/bin/grep -n "pauseClassroom\|resumeClassroom" src/lib/api.ts
#   187:  pauseClassroom:  (id) => request(`/api/classroom/${id}/pause`,  { method: 'POST' }),
#   188:  resumeClassroom: (id) => request(`/api/classroom/${id}/resume`, { method: 'POST' }),
/usr/bin/grep -n "classroom-paused\|classroom-resumed" server/src/routes/classroom.ts
#   1240-1241:  io.to(`classroom:${id}`).emit('classroom-paused'); io.to(`teacher:${id}`).emit('classroom-paused');
#   1259-1260:  io.to(`classroom:${id}`).emit('classroom-resumed'); io.to(`teacher:${id}`).emit('classroom-resumed');
```
⇒ **两个房间都发**（学生房间 + 教师房间）。

### 2.4 🔴 学习单的写路径**今天完全不看课堂状态**

```bash
/usr/bin/grep -n "paused\|ended" server/src/socket/index.ts | /usr/bin/grep -E "return|reason"
#   1103:  if (!classroom || classroom.status === 'ended') {      ← 聊天：结束即拒
#   1354:  if (classroom?.status === 'ended') return { ok: false, reason: '课堂已结束' };
#   1736:  if (!classroom || classroom.status === 'ended') {
#   1745:  if (classroom.status === 'paused') {                    ← 聊天：暂停即拒
/usr/bin/grep -n "paused" server/src/routes/worksheets.ts
#   （零命中 —— 学习单的三条写路径一个都不读 status）
```
⇒ **暂停课堂时：聊天被拒、学习单照写不误、而且照广播。** 这是本轮要补的洞。

### 2.5 门控点：两条写路径的锚点

```bash
/usr/bin/grep -n "function requireOwnWorksheet\|function findQuestion\|function ensureResponse\|router.put('/:id/answers'\|router.post('/:id/answers/submit'\|allowResubmit" server/src/routes/worksheets.ts
#   927: async function requireOwnWorksheet(...)
#  1042: function findQuestion(content, questionId)
#  1181: function ensureResponse(ctx, now)
#  1347: router.put('/:id/answers', ...)
#  1389-1390: const { allowResubmit } = readStudentSettings(...); if (!allowResubmit) {   ← 既有 409
#  1454: router.post('/:id/answers/submit', ...)
```
🔴 **判据必须排在 `ensureResponse` 之前** —— 那个函数的 `update` 支是**无条件**的：

```bash
sed -n '1189,1191p' server/src/routes/worksheets.ts
#     create: { ...key, status: 'in-progress', startedAt: now },
#     update: { status: 'in-progress', submittedAt: null },      ← 无条件
```
被拒的保存若在它之后判，就会「先把那次交卷拨回去、再拒」⇒ 教师看板上那次交卷**凭空消失**。
这条纪律本仓已为 M4b 的体积校验写过一次（`GC 4` 那一批）。

### 2.5b 🔴 现有的 409 **没有机器可读的字段**（决定了新拒绝的形状）

```bash
sed -n '1404,1405p' server/src/routes/worksheets.ts
#     return res.status(409).json({ error: '老师已设置本题提交后不可修改' });
```
⇒ 今天唯一的 409 只有一句中文 `error`。**客户端不能靠状态码区分「锁定」与「本题不许重交」**
（两者都是 409），靠中文文案区分则会在改文案时静默失效。⇒ 新拒绝**必须自带一个稳定的机器可读字段**（见 §3.2）。

### 2.6 模块筛选行的数字：**是「参与者数」，分组模式下即「组数」**

```bash
sed -n '1541,1545p' src/app/teacher/classroom/page.tsx
#   const moduleDistribution: Record<TileModule, number> = (() => {
#     for (const student of students) counts[resolveStudentFocus(student.id)] += 1;
```
```bash
sed -n '2177,2184p' src/app/teacher/classroom/page.tsx
#   🔴 单位是**人数**，与下面那几个模块项同一把尺子（`moduleDistribution` 逐 `students` 计数）
#      —— 所以这里必须是 `students.length`，**不是** `allDisplayCards.length`。
```
```bash
sed -n '664,666p' src/app/teacher/classroom/page.tsx     # 页头那个数
#   const classroomStudentCount = groupCards
#     ? groupCards.reduce((t, g) => t + (g.group?.id ? (groupMembersMap[g.group.id]?.length ?? 0) : 0), 0)
#     : students.length;
sed -n '626,630p' src/app/teacher/classroom/page.tsx     # groupCards 只在分组/高级模式存在
#   if (!classroom || (classroom.mode !== 'advanced' && classroom.mode !== 'group')) return null;
/usr/bin/grep -n "ClassroomStudent.type === 'group'" specs/2026-09-23-p1-worksheet.md
#   108: ⇒ 分组与高级模式下 `ClassroomStudent.type === 'group'`，**一个组一行参与者**。
```
⇒ **结论（与那句注释相反）**：`students` 的每一行是**参与者**；分组/高级模式下参与者**就是组**
（§1.2），所以模块行在那些模式下数的是**组数**，而句注释断言「单位是人数」**在该模式下为假**。
页头那一个数在分组模式下按**成员**求和（真·人数）⇒ 同一屏**两个不同单位**，其中一个**不带标签**。
⚠️ 这正是 §13-2 记的那个缺陷，但它比文档描述的更具体：**缺陷不在算法，在一个假断言 + 缺单位**。

### 2.7 学生端：锁态怎么送达（**比我上一版设计更省**）

```bash
/usr/bin/grep -n "cr.status" src/app/classroom/use-classroom-session.ts
#    96:  if (cr.status === 'paused') setPaused(true);        ← 快照来自 api.getClassroomByCode(code)
sed -n '258,262p' src/app/classroom/use-classroom-session.ts
#   （`status` / `agents` / `modules` 都来自 `api.getClassroomByCode(code)`），陈旧窗口也是同一个
#   ... 最长到下一轮（15 秒）。`paused` 同理（`classroom-paused` 广播被旧快照压掉）
sed -n '620,622p' src/app/classroom/shell/classroom-shell.tsx
#   <WorksheetPanel ... classroom={chat.classroom} ... />
```
⇒ 学生端**已经**有一条「快照 + 15 秒轮询 + socket 广播」的三重通道，而且 `WorksheetPanel`
**已经收着 `classroom` 对象**。⇒ 锁态加进那个快照即可，**不需要新的 props 管线**。

### 2.8 队列：4xx 会被**丢弃**（这条决定了拒绝的形状）

```bash
/usr/bin/grep -n "classifyFailure\|permanent" src/app/classroom/worksheet/use-worksheet-answers.ts
#   344-352:  const kind = classifyFailure(outcome.status); if (kind === 'permanent') { ...丢弃... }
/usr/bin/grep -n "4xx" src/app/classroom/worksheet/use-worksheet-answers.ts | head -2
#    38: 3. **永久失败要说话**：4xx（含 `allowResubmit: false` 的 409）从队列里丢弃，
```
⇒ 🔴 若「锁定」按普通 4xx 处置，学生在锁定**之前**写的、还没发出去的作答会被**静默丢掉**。

### 2.9 面板上「先别做」的现成版式

```bash
sed -n '230,234p;277,278p' src/app/classroom/worksheet/worksheet-panel.tsx
#   230:  const locked = submitted && !allowResubmit;
#   234:  const controlsDisabled = !interactive || locked;
#   277-278:  locked ? (<p className={styles.lockedNote}>老师已设置本题提交后不可修改</p>)
```
⇒ 锁定态复用这套版式（禁用 + 一句说明），但**判据不同**（课堂级 vs 本题已交）。

---

## 三、设计

### 3.1 状态与接口

| 件 | 形状 | 依据 |
|---|---|---|
| 新列 | `Classroom.answersLocked Boolean @default(false)` | §2.1 |
| DDL | `schema.prisma` + `index.ts` 的同步块（`PRAGMA table_info` 探测 + `ALTER … BOOLEAN NOT NULL DEFAULT 0`） | §2.2 |
| 端点 | `POST /api/classroom/:id/lock-answers` / `unlock-answers`（照 `pause`/`resume` 的形状） | §2.3 |
| 广播 | `answers-locked` / `answers-unlocked`，**发 `classroom:<id>` 与 `teacher:<id>` 两个房间** | §2.3 |
| 学生读 | 加进 `getClassroomByCode` 的快照（学生会话已经在读它）+ 那条 15 秒轮询 | §2.7 |

**不放进 `Worksheet.settings`**：那是**学习单级**（跨课堂复用），而锁是「这一节课这组学生」的事；
且 `PUT /api/worksheets/:id` 是**整份替换** settings，少认一个键就静默抹掉（本仓有前科）。
**不放进题目节点**：那是题级，不是课堂级。

### 3.2 服务端门控（核心）

- **位置**：`PUT /:id/answers` 与 `POST /:id/answers/submit` 两处，**紧跟 `findQuestion` 之后、
  `ensureResponse` 之前**（§2.5）。两处共用一个助手（与 `findQuestion` 同处定义），一处判据、两条路径，不分叉。
- **PUT（保存）⇒ 拒**：`409` + **一个稳定的机器可读字段**：`{ error: '老师已锁定作答', code: 'answers-locked' }`。
  ⚠️ 状态码本身**不足以**区分（`allowResubmit` 那条也是 409，且它今天**只有中文文案**，见 §2.5b）
  ⇒ 客户端一律**按 `code` 判**，不看状态码、更不看中文。这是本次新增的字段，**对老客户端是纯增量**（多一个键）。
- **POST（交卷）⇒ 放行**（裁定 ③：停笔但可交卷）。
- 🔴 **拒绝的形状必须让队列保留而不是丢弃**（§2.8）：客户端把 `code === 'answers-locked'` 从
  `classifyFailure` 的 `permanent` 一档里**摘出来**（**保留条目、等解锁后重发**），
  只有真正的永久失败才丢弃。**这一条是本设计里最容易被做漏、代价最大的一条** ——
  做漏的后果是：学生在锁定**之前**写的、还没发出去的作答被**静默丢掉**。
- ⚠️ 「放行交卷」有一个**前提**要一起做：学生端提交前会先 `flush()`（把队列里的改动 PUT 上去）。
  锁定期那一步**必须跳过**，只交服务端**已存住**的那份；否则 flush 被 409 拒会让提交整个失败。

### 3.3 学生端

- **锁态**：`worksheet-panel.tsx` 加一个与 `locked` **分开**的判据（课堂级锁），复用同一套禁用/说明版式（§2.9）。
  锁定时：编辑控件禁用；**「提交本题」保留**；题面显示一句
  **「老师已锁定作答 —— 只能提交已保存的内容」**。
- **队列**：锁态**到达的那一瞬**（socket 广播，或那条 15 秒轮询把快照翻成锁定）若队列非空，
  **立即尝试 flush 一次**（不等 1.5 秒防抖），之后停止 flush；队列条目留在 `localStorage`，
  解锁后继续重发（§2.8 的客户端一半）。
  ⚠️ 这一次 flush 会**大概率**被服务端拒（锁已经在服务端生效），那不是 bug —— 它的意义是
  「万一锁在路上、队列先到」的那一档能救回来。
- ⚠️ **一句必须写进文案的副作用**：屏幕上若还有未同步的改动（1.5 秒防抖没到），
  学生交上去的是**已保存的那份**，与屏幕不完全一致 ⇒ 上面那句提示必须提到这件事，
  否则学生会以为自己交的是刚写的。

### 3.4 教师端

- **一个按钮**：课堂控制条上「**锁定作答** / **解锁作答**」，文案**必须带「作答」二字** ——
  已有的那个是「暂停学生提问」（`page.tsx:2034`），不带单位会混淆。
- **状态同步**：本地乐观更新 + 收自己的 socket 事件校正（照 `page.tsx:1196-1203` 的 `toggleQuestions` 形状）。
- **裁定：「恢复课堂」（`ended → active`）时自动解锁。** 理由：锁的目的是停笔，而恢复课堂是**重新开始上课**
  —— 仍停笔是自相矛盾的；且按钮会**可见地**翻回未锁（不是静默改状态）。
  **代价**：教师若真想「恢复后仍锁着」，得多按一次。
  （`classroom-state.ts:5-10` 的 `restore: ['ended']` 是这条的落点。）

### 3.5 文案（第二半范围）

- 模块筛选行（`page.tsx:2175`）按 `classroom.mode` 加量词：个人模式「全部 **12 人**」、
  分组/高级模式「全部 **4 组**」。**数字算法一个字不动** —— 它数的是参与者（= 卡片张数），
  那正是这个**筛选控件**应有的口径（点它会出现几张卡片）。
- **页头「N 名学生」不动**（它是真·人数）。
- 🔴 **同轮要修掉那句假注释**（`page.tsx:2177-2179`）：它断言「单位是人」，
  在分组模式下为假。改成说真话的版本（「单位是**参与者数**；分组/高级模式下参与者是组」）。
  **不修它的话**，下一个读代码的人会照着它把这一行再改错一次。

---

## 四、非目标（本轮明确不做）

- **矩阵总览**、**逐题投放**（§1 的两条理由）。
- **不改** `paused` 的任何行为，「暂停学生提问」按钮一字不动。
- **不改** `allowResubmit`（学习单级三层控制里的第一条，M3 已交付）。
- **不做**「锁定后服务端自动批量收卷」（用户已排除：那会替学生做「交卷」这个决定）。
- **不改** 看板格子的编码（M3 的「只编码状态」继续成立）。

## 五、代价与风险（如实记）

1. **DDL 面**：本仓要求 `schema.prisma` 与 `index.ts` 两处一致（有测试盯着，见 `worksheet-schema.ts` 一带），
   且验证只能在 `/tmp` 库上做。
2. **学生端的 1.5 秒窗口**：锁定的那一刻，学生屏幕上可能有未同步的改动；本设计选择「先尽力 flush 一次」，
   但**这个窗口不能消除**（网络慢时那一次 flush 可能仍被拒）。⇒ 文案要如实说。
3. **真机未验**：与 M4b 同理 —— 本机**没有任何浏览器驱动**（实测 `ls node_modules/.bin | grep -iE 'playwright|puppeteer|chrom'` 零命中），
   锁定瞬间学生屏幕的表现、键盘收不收、提交按钮的实际可达性**一律只能真机验**。
4. **一个未核实的相邻缺陷**：§13-3 的 `ExploreMemberStrip` 可能只画一条成员条（要开分组模式课堂看），
   与 §2.6 是同一块代码 ⇒ 顺手看到就记，**本轮不修**。

## 六、验收

**能自动验的**（本仓的 `node --test`）：

- 服务端：锁定时 PUT ⇒ 409 且**库里那一行没变**（照 `worksheet-routes.test.ts` 既有的「先断言前置条件、再断言没被改坏」写法）；
  锁定时 submit ⇒ **通过**；解锁后 PUT ⇒ 通过；`answersLocked` 默认 `false`。
- 客户端纯逻辑：队列在「锁定」下**保留条目**。落点已核实在纯函数层：
  `classifyFailure`（`src/app/classroom/worksheet/worksheet-queue.ts:157`，导出）与它既有的测试
  `src/app/classroom/worksheet/worksheet-queue.test.ts` ⇒ **这条判据有现成的家**，不需要新开文件。
  ⚠️ 但 `classifyFailure(status)` 今天**只收状态码**；要按 `code` 区分就得改它的签名（收 `{status, code}`）
  ⇒ 那是一次**签名变更**，既有断言会一起动（实施时留意：这是有意的，不是补测试）。
- **两条反证**：① 拿掉服务端门控 ⇒ 对应用例必红；② 把「锁定」重新归进 `permanent` ⇒ 队列保留那条用例必红。

**只能真机验的**（一律标「未验证」）：

- 锁定瞬间学生屏幕上发生什么、正在输入的键盘会不会被收起、提交按钮还能不能按；
- 多个学生同时在线时广播的到达顺序；
- 教师端按钮的乐观更新在弱网下会不会显示错。

## 七、未采纳的两条路（各一句代价）

1. **复用 `paused`**：零 DDL，但会改掉「暂停学生提问」这个**已在用**功能的意思，并把「只禁提问、不禁答题」这个能力抹掉。
2. **锁存进学习单 `settings`**：语义不对（学习单跨课堂复用），且会**影响别的课堂**用同一张单的学生；
   外加 `PUT /:id` 整份替换 settings 的前科。
