# 修复报告：文档修复那一轮**自己引入的** 6 处新假话

> 分支 `feat/p1-worksheet` · 2026-09-23
> 起因：用户问「所有任务里还有没有矛盾」→ 一个审计报 14 条 → 一个任务逐条修文档。
> 本次的角色是**独立审查**：核那次修复本身。结论是它**用新的散文替换了旧的散文**，
> 有 6 处新假话。**本报告只修这 6 处**，每处附一条证明新说法为真的命令。
>
> 🔴 铁律（本项目）：**散文不许声称一个不存在的机制。**
> 因此下面每一处都先给命令、再给改后的说法，而不是反过来。

---

## 0. 门禁基线（动手前现测，不是引用历史数字）

```
$ pnpm test:client
ℹ tests 117 · ℹ pass 117 · ℹ fail 0

$ pnpm test        （= test:client + test:server；服务端在 server/ 里跑 pnpm build + node --test）
ℹ tests 117 · ℹ pass 117 · ℹ fail 0
ℹ tests 390 · ℹ pass 390 · ℹ fail 0
```

✅ 与任务书给的「前端 117/117 + 服务端 390/390」一致 ——
**这两个数字本次是在干净树上现测的**（任务书提示上一轮那两个数是在**混合树**上跑的）。

改完之后复测：**前端 117/117 · 服务端 390/390，与基线逐字相同**（见 §7）。

---

## 1 🔴 最关键：`specs/2026-09-23-p1-worksheet.md` §1.1 的更正块

### 假话

> 「`routes/classroom.ts` 的**两条创建路径都在写它**（**标准/分组一次**、高级模式逐组一次，
> 写入口是那个 `for (const [kind, targetId] of …)` 循环）」

### 证明（命令 + 原始输出）

**C1a —— 全文件只有两处 `classroomGroupMaterial.create`：**

```
$ grep -an "classroomGroupMaterial" server/src/routes/classroom.ts
592:        await tx.classroomGroupMaterial.create({ data: { groupId: classroomGroup.id, kind, targetId } });
770:            await tx.classroomGroupMaterial.create({
```

**C1b —— 这两处各自落在哪个路由里**（说的是 `create-advanced` 与 `sync-groups`，**都不是标准/分组那一支**）：

```
$ awk '/^router\.(post|get|put|delete)\(/{route=$0; ln=NR} /classroomGroupMaterial\.create/{printf "  line %d -> 最近的路由 line %d: %s\n", NR, ln, route}' server/src/routes/classroom.ts
  line 592 -> 最近的路由 line 462: router.post('/create-advanced', async (req, res) => {
  line 770 -> 最近的路由 line 711: router.post('/:id/sync-groups', async (req, res) => {
```

**C1c —— `:770` 那一处只写 `kind:'webapp'`，且非 `advanced` 模式恒短路：**

```
$ sed -n '740,742p' server/src/routes/classroom.ts
      const classroomWebappId = classroom.mode === 'advanced'
        ? (classroom.webapps[0]?.webappId ?? null)
        : null;
```

**C1d —— 标准 / 分组模式写的是另一张表 `ClassroomWorksheet`（没有 `kind` 列）：**

```
$ grep -an "classroomWorksheet\.\|worksheetLinkRows" server/src/routes/classroom.ts
181:function worksheetLinkRows(ids: readonly string[], now: number = Date.now()) {
215: * ⚠️ 排序 `[{createdAt:'asc'},{id:'asc'}]` **必须**与写入口（`worksheetLinkRows` /
226:    rows = await prisma.classroomWorksheet.findMany({
391:        // 单选 ⇒ 各自至多一行（`webappLinkRows` / `worksheetLinkRows` 仍按勾选顺序写
394:        worksheets: { create: worksheetLinkRows(worksheet.id ? [worksheet.id] : []) },
```

```
$ sed -n '444,455p' server/prisma/schema.prisma
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
```

⇒ **`kind='worksheet'` 只有高级模式的创建路径会写。**

**C1e —— 那个「对打」的服务端注释确实存在：**

```
$ grep -n "没有任何行" server/src/routes/classroom.ts
192: * 🔴 **为什么必须有它**：标准 / 分组模式下 `ClassroomGroupMaterial` 里**没有任何行**
```

### 改法

`specs/2026-09-23-p1-worksheet.md` §1.1 —— 把更正块里那句假话删掉，只留**仍然成立**的后半句；
紧接其后新增一个「二次更正」块，把 C1a–C1e 的原始输出贴进去，
并**逐字点出那条对打**（引 §5.1 更正块引用的 `classroom.ts:192`）。

> ⚠️ 那条对打本身就是本报告最该被记住的一句：同一份文件里两句话互相否证，
> 而**两句都曾以「已核过代码」的语气写下来**。所以本次每一处都挂命令，不挂语气。

---

## 2 `specs/2026-09-23-p1-worksheet.md` §7.2 理由块两句

### 假话

> ①「看板**没有拉取历史的端点**」
> ②「见 §5.3 的**占位**」

### 证明

**C2a —— 读端点已经落地：**

```
$ grep -an "router.get('/classroom/:classroomId/answers'" server/src/routes/worksheets.ts
605:router.get('/classroom/:classroomId/answers', async (req, res) => {
```

**C2c —— 看板确实在调它：**

```
$ grep -rn "getWorksheetBoard" src/lib/api.ts src/app/teacher/classroom/page.tsx
src/lib/api.ts:441:  getWorksheetBoard: (classroomId: string) =>
src/app/teacher/classroom/page.tsx:738:      const board = await api.getWorksheetBoard(id);
```

**C2f —— §5.3 已回填，不是占位：**

```
$ grep -n "回填（2026-09-23）" specs/2026-09-23-p1-worksheet.md
474:# ★ 教师端按课堂读**作答全貌**（逐题答案 / 对错 / 已查看）—— 回填（2026-09-23）

$ grep -n "教师端 API" specs/2026-09-23-p1-worksheet.md
1147:| §6.4 教师端 API | 补充（本文 §5.3） |
```

**真话 —— 缺的不是端点，是「格子没消费它」+ 端点缺两个字段：**

**C2d —— 格子的进度只有一个写入点，就在广播处理里：**

```
$ grep -c "setWorksheetProgress(" src/app/teacher/classroom/page.tsx
1
$ grep -n "setWorksheetProgress(" src/app/teacher/classroom/page.tsx
1066:      setWorksheetProgress((prev) => {
```

**C2e —— `worksheetBoard` 只流向抽屉，不流向格子：**

```
$ grep -n "worksheetBoard" src/app/teacher/classroom/page.tsx
531:  const [worksheetBoard, setWorksheetBoard] = useState<WorksheetBoard | null>(null);
532:  const [worksheetBoardLoading, setWorksheetBoardLoading] = useState(false);
744:      // 状态由 `worksheetBoard === null` + `loading === false` 表达，见抽屉里那一段文案。
2464:            board={worksheetBoard}
2466:            loading={worksheetBoardLoading}
```

（`:2464` 的收件人是 `<WorksheetDrawer`，它开在 `:2461`、props 到 `:2469` 收口。）

**C2b —— 那个读端点回的行里没有「哪题是最后保存的」也没有时间戳：**

```
$ grep -an "questionId: true, status: true" server/src/routes/worksheets.ts
677:          select: { questionId: true, status: true, isCorrect: true, reviewedAt: true, value: true },
```

⇒ 缺的正是 `lastQuestionId`（「正在做第 N 题」的唯一依据）与**最后保存时刻**
（「停住了」的 5 分钟阈值靠它）。

### 改法

`§7.2` 两处都改：①标题句改成「**理由是一条数据源事实**」并指明输入只有广播；
新增二次更正块，把 C2a/C2b/C2c/C2d 的输出写进去并说明「端点有了、格子没接、且缺两个字段」；
②把「见 §5.3 的**占位**」改成「（§5.3，**它已落地、不再是占位**）并让格子消费它」——
**悬空指针拆掉了**。

---

## 3 `specs/2026-09-23-p1-worksheet.md` §7.3 形态 A 图里那一行

### 假话

```
│ 4. 问答   ✓  [标记已查看]    │   ← 主观题只有「已查看」（§3-D）
```

左边画 `✓`、右边同一行注着「主观题只有『已查看』」—— 自相矛盾。

### 证明

**C3a —— 判分题型是白名单，只含单选 / 填空：**

```
$ grep -n "GRADED_QUESTION_TYPES" -A 1 src/app/teacher/classroom/worksheet-drawer-state.ts | head -8
52:export const GRADED_QUESTION_TYPES: readonly string[] = ['single-choice', 'fill-blank'];
53-
--
55:  return GRADED_QUESTION_TYPES.includes(type);
56:}
```

**C3b —— `✓/✗` 与 `◐/─` 是两支互斥的渲染，问答落后者：**

```
$ sed -n '433,454p' src/app/teacher/classroom/worksheet-drawer.tsx
function OutcomeMark({
  mark, status,
}: {
  mark: 'correct' | 'wrong' | 'none';
  status: WorksheetQuestionStatus;
}) {
  if (mark === 'correct') {
    return <span ...>✓ 答对</span>;
  }
  if (mark === 'wrong') {
    return <span ...>✗ 答错</span>;
  }
  if (status === 'unanswered') {
    return <span ...>─ 未作答</span>;
  }
  // 作答中 / 已提交但**没有对错**（主观题、关闭自动判分）。
  return (
    <span ...>
      ◐ {statusLabel(status)}
    </span>
  );
}
```

**C3c —— 已提交的标签就叫「已提交」：**

```
$ grep -n "function statusLabel" -A 6 src/app/teacher/classroom/worksheet-drawer-state.ts
126:export function statusLabel(status: WorksheetQuestionStatus): string {
127-  if (status === 'submitted') return '已提交';
128-  if (status === 'draft') return '作答中';
129-  return '未作答';
130-}
```

⇒ 已提交的问答画的是 **`◐ 已提交`**，永远不是 `✓`。

### 改法

图里那行改成 `│ 4. 问答   ◐  已提交          │`（**✓ 去掉了**，替换成实现真的会画的那个记号）；
新增二次更正块点明它是新的假话；**顺带**把紧跟其后的图例改成与实现一致 ——
原图例写「未开启自动判分时 `✓` 退化为「已提交」」，而实现里 `✓` 是**消失**、改画 `◐`，不是「退化」。

---

## 4 `specs/2026-09-23-p1-worksheet-progress.md` 的「10/15」

### 假话

进度条五个分子相加是 `2+4+3+3+0 = 12`，表里 ✅ 的条目也是 12 条，而总数写着 **10/15**。

### 证明

```
$ awk 'NR>=145 && NR<=159' specs/2026-09-23-p1-worksheet-progress.md | grep -c "✅"
12
```

（该区间就是进度表 A1…E1 那 15 行；逐行看：A1/A2、B1–B4、C1–C3、D1–D3 ✅，D4 🔄，D5/E1 ⬜。）

### 改法

总数改成 **12/15**；并在既有更正块里补一条**二次更正**，写明「上一版写的 10/15 它自己就是错的」，
附上面那条 `awk` 命令。**以表里 ✅ 的条目为准。**
（那是用户「一眼看」扫的头条数字，错得最显眼。）

---

## 5 `specs/2026-09-22-p2-group-materials.md`（约 `:207`）—— 第四处「嵌套形状」残影

### 假话

> 「`classroom.groups[].materials.webapp` 是学生端…**唯一**依据」

那种嵌套形状**没有落地**。

### 证明

**C5a —— 任务书要求的 `grep -rn "materials\.\(agent\|webapp\|worksheet\)" specs/`，
「改之前」（在 HEAD 版本上跑，避开本次自己的改动）：**

```
$ git show HEAD:specs/2026-09-22-p2-group-materials.md > /tmp/specs-head/2026-09-22-p2-group-materials.md
$ git show HEAD:specs/2026-09-23-p1-worksheet.md      > /tmp/specs-head/2026-09-23-p1-worksheet.md
$ grep -rn "materials\.\(agent\|webapp\|worksheet\)" /tmp/specs-head/
/tmp/specs-head/2026-09-22-p2-group-materials.md:207:- `classroom.groups[].materials.webapp` 是学生端「我该打开哪个网页」的**唯一**依据（高级模式）。
/tmp/specs-head/2026-09-23-p1-worksheet.md:469:> ⚠️ **2026-09-23 更正（实施 D2 时核出的）。** 本节原先只写了「随 `groups[].materials.worksheet`
/tmp/specs-head/2026-09-23-p1-worksheet.md:471:> `groups[].worksheet`，不是 `groups[].materials.worksheet`）。三条同时成立：
```

**「剩下的若确实成立，说明为什么」：**
`:469` / `:471` **确实成立、本次不改** —— 那两行**就是一份更正块**，
它必须**写出错误的形状名**才能否定它（`:471` 那半句字面就是「不是 `groups[].materials.worksheet`」）。
判据是**这句话在断言还是在否定**，不是「命中数归零」。
⇒ 所以本次**只**修 `:207` 那一条**断言型**的。

**C5b —— 扁平形状的权威记录：**

```
$ grep -n "没有落地" -B 1 src/lib/classroom-material.ts
33- * `res.json`：顶层 `agents` / `webapps` / `groups` 三个数组）—— 计划草稿里写的
34: * `groups[].materials.{agent,webapp}` 那种嵌套形状**没有落地**，服务端下发的是扁平的
```

**C5c —— 实际读的就是扁平 `.worksheet`（同一个口径的 `worksheet` 版）：**

```
$ sed -n '114,121p' src/lib/classroom-material.ts
export function effectiveGroupWorksheet(
  classroom: ClassroomMaterials | null | undefined,
  selectedStudent: { groupId?: string | null } | null | undefined,
): WorksheetMaterialSummary | null {
  if (!classroom) return null;
  if (classroom.mode === 'advanced') return ownGroup(classroom, selectedStudent)?.worksheet ?? null;
  return classroom.worksheets?.[0] ?? null;
}
```

### 改法

`:207` 那条**保留原文**（决策痕迹是信息），行首加 `⚠️ **过期（见下方的更正块）**`；
其下新增更正块（照同文件 §4.5 更正块的写法），说清：**形状名错、结论对**（只改形状名）；
并写明**它为什么会漏** —— 上一次的验证命令只扫了 `server/src`，**没扫 `specs/`**。

**C5d —— 改之后（含本节自己的引述型命中）：**

```
$ grep -rn "materials\.\(agent\|webapp\|worksheet\)" specs/
specs/2026-09-22-p2-group-materials.md:207:- ⚠️ **过期（见下方的更正块）** `classroom.groups[].materials.webapp` 是学生端「我该打开哪个网页」的**唯一**依据（高级模式）。
specs/2026-09-22-p2-group-materials.md:212:> 上面第一条里那个 `groups[].materials.webapp` **形状不存在**：服务端下发的是**扁平**的
specs/2026-09-22-p2-group-materials.md:217:> 那一份也走 `.worksheet` 而不是 `.materials.worksheet`）。⇒ 只改**形状名**，不改结论。
specs/2026-09-23-p1-worksheet.md:509:> ⚠️ **2026-09-23 更正（实施 D2 时核出的）。** 本节原先只写了「随 `groups[].materials.worksheet`
specs/2026-09-23-p1-worksheet.md:511:> `groups[].worksheet`，不是 `groups[].materials.worksheet`）。三条同时成立：

$ grep -rn "materials\.\(agent\|webapp\|worksheet\)" specs/ | grep -v ":> "
specs/2026-09-22-p2-group-materials.md:207:- ⚠️ **过期（见下方的更正块）** `classroom.groups[].materials.webapp` 是学生端「我该打开哪个网页」的**唯一**依据（高级模式）。
```

改后共 5 处命中，其中 **4 处在更正块里（引述并否定）**，1 处是保留的原文、已就地标 `⚠️ 过期`
并指向正下方的更正块。**没有剩下的「裸断言」了。**

---

## 6 `src/app/teacher/classroom/worksheet-tile-state.ts` 的注释

### 假话

> 「看板没有拉取历史的 REST 端点（`GET /api/worksheets/:id` 只给题目，不给答案行，
> 全文只有学生端那三个端点能读 `WorksheetAnswer`）」

**这句话在它自己那个提交之后就不成立了** —— 同批次新增的教师端读端点就在读 `WorksheetAnswer`。

### 证明

同 §2 的 **C2a / C2b / C2c / C2d / C2e**（端点存在 + 看板在调 + 格子没消费 + 端点缺两个字段）。
代码注释的问题与 §7.2 是**同一个**，所以证据也是同一条，不另跑。

### 改法

改成真话：这一态的唯一输入是广播攒出来的 `worksheetProgress`；
**格子没消费**那个读端点；缺的是 `lastQuestionId` 与「最后一次保存的时刻」两个字段。

**门禁（这里改的是代码注释，必须过）：**

```
$ npx tsc --noEmit
（零输出，退出 0）

$ npx eslint src/app/classroom/ src/lib/ src/app/teacher/
/Users/zxc/myprojects/classnode/src/app/classroom/identity/use-student-session.ts
  112:50  warning  'tokenData' is assigned a value but never used  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)
```

✅ 与文档记录的基线**逐字相同**（同文件同行同一条 warning，0 errors）—— 没有引入新问题。

---

## 7 收尾门禁

```
$ pnpm test
ℹ tests 117 · ℹ pass 117 · ℹ fail 0 · ℹ skipped 0
ℹ tests 390 · ℹ pass 390 · ℹ fail 0 · ℹ skipped 0
```

✅ 与 §0 的基线逐字相同。

> ⚠️ **这份报告不拿测试当文档改动的证据** —— 文档改动靠上面每一处的 `grep` 证明。
> 跑测试只是为了满足「既有测试必须继续全过」这条约束。

---

## 8 本次**没做**的事（如实记）

- **没有**实现「把历史回灌给格子」（那是另一个决定，缺 `lastQuestionId` 等字段）。
- **没有**碰 `src/app/teacher/classroom/page.tsx` 的逻辑（按任务书，只改 `worksheet-tile-state.ts`）。
- **没有**跑根目录 `pnpm build`（只改了文档 + 一条注释）。
- **没有**新增 npm 依赖；**没有** `prisma db push`；**没有**停 `./dev.sh`。
- **没有**碰 `CLAUDE.md` / `dev.sh` / `release.sh` / `package.json`。

### ⚠️ 顺带发现、**本次按范围未动**的两处同类假话（同一族、同样已被证伪）

这两处与第 6 条是**同一个假事实**的另外两份拷贝，本次按「只修这 6 处」的边界**没有改**，
在此列出以便决定是否追加一次：

1. `src/app/teacher/classroom/page.tsx:506-508`
   —— 「⚠️ 看板**没有**拉取历史的 REST 端点（教师端能读 `WorksheetAnswer` 的端点一个都不存在）」
   ```
   $ grep -n "教师端能读 \`WorksheetAnswer\` 的端点一个都不存在" src/app/teacher/classroom/page.tsx
   507:   * （教师端能读 `WorksheetAnswer` 的端点一个都不存在），所以刷新一次页面就会把这里清空 ——
   ```
2. `src/app/teacher/classroom/worksheet-tile-state.ts:210`
   —— 「也没有任何教师端读答案行的端点（`GET /api/worksheets/:id` 只给题目）」
   （在**同一个文件**里，但属于另一段注释：徽章文案「已交 N/M」的理由块）
   ```
   $ grep -n "没有任何教师端读答案行的端点" src/app/teacher/classroom/worksheet-tile-state.ts
   210: *   · 也没有任何教师端读答案行的端点（`GET /api/worksheets/:id` 只给题目）。
   ```

两处的**结论都仍然正确**（徽章确实该用「已交」而不是「已看」，因为格子不消费那个端点），
**错的是理由**：不是「没有端点」，是「格子没接它」。修法与第 6 条同形。
