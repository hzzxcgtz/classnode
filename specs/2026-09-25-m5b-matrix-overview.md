# M5b · 学生×题目矩阵总览 · 设计规格

> 日期：2026-09-25 · 分支 `main`（M5a 已并入，HEAD `6d7138d`）· 状态：**待用户复核**
> 权威规格：`specs/2026-09-23-p1-worksheet.md`（§7 看板、§7.2 方格阵着色、§7.3 抽屉、§7.4 数据来源、§13 待定项）
> 里程碑：`specs/2026-09-23-milestones.md`（M5 = 学习单 · 看板与课堂控制）
> **本文件只是 M5b 的设计。**「逐题投放」**不在本轮**（理由见 §1）。
> ⚠️ 本文件里每一个 `file:line` 都是**写这份文件时实跑过的**（本仓行号会漂；动手前请自己再 grep 一遍）。

---

## 一、范围与依据

M5 在里程碑里是四件事。逐件的**当前状态**：

| 子项 | 当前状态 | 本轮 |
|---|---|---|
| **课堂级「锁定作答」** | ✅ M5a 已交付（`457e789`..`1bda985`） | — |
| **顶部「人数 / 组数」文案** | ✅ M5a 已交付（`b74b34e`） | — |
| **学生×题目矩阵总览** | 设计**不存在**：旧形态在 `classnode-learning-suite-design.md` §9.5，而那个 §9 **已被 p1 §7 整节取代**（见 §2.8） | ✅ **做** |
| **逐题投放** | 文档自己把它挂在「等真在课上**用过整张发**之后再定」（`p1-worksheet.md:1304`），而那个前提**至今没发生**（M4a/M4b/M5a 的真机项合计 40 个槽位、已填 0） | ❌ 下一轮 |

**裁定来源（2026-09-25，用户逐条选择）**：

1. **范围** = 只做矩阵，不捎带逐题投放。
2. **使用时刻** = **课上实时**，用途是「**一眼看出此刻该讲哪一题、谁要过去看一眼**」。
3. **每格编码** = **只画状态，不编码对错**；卡住的那一题**单独突出**。
4. **朝向** = **题行 × 参与者列**。

---

## 二、事实基线（**全部实跑过**；命令与逐字输出）

> 本仓的 `grep` 是一个转发给 `claude -G`（ugrep）的 wrapper ⇒ 下面一律用 `/usr/bin/grep`。

### 2.1 参与者**可以是组**（一个组一行）

```bash
/usr/bin/grep -n 'type  *String   @default("student")' server/prisma/schema.prisma
#   322:  type        String   @default("student") // student / group
```
⇒ 矩阵的列**必须**按「参与者」而不是「学生」称呼；分组 / 高级模式下它就是组（p1 §1.2 逐字：「一个组一行参与者」）。
这与看板卡片同一把尺子（`WorksheetBoardParticipant.kind` 已经是 `'student' | 'group'`）。

### 2.2 🔴 高级模式下**每个组可以是不同的学习单**

```bash
sed -n '27,33p' server/src/services/group-material-resolve.ts
#   if (input.mode === 'advanced') {
#     if (!input.studentGroupId) return null;
#     const hit = input.groupMaterials.find(
#       (m) => m.groupId === input.studentGroupId && m.kind === input.kind,
#     );
#     return hit ? hit.targetId : null;   // 没有就是没有，**不回落**
#   }
```
⇒ 「全班共有的第 3 题」在高级模式下**并不存在**。矩阵必须**按学习单分块**（§3.2）。

### 2.3 🔴 作答行**没有 `updatedAt`** —— 这决定了「卡住」只能靠计数

```bash
sed -n '486,494p' server/prisma/schema.prisma
#   questionId   String    // ★ content 树里的稳定 id，**不是下标**（§3-P）
#   value        Json?     // 答案（格式见 4.3）
#   status       String   @default("unanswered")  // unanswered | draft | submitted
#   isCorrect    Boolean?  // …
#   gradeState   String?   // …
#   score        Float?    // …
#   reviewedAt   DateTime? // ★ 教师的「已查看」标记（§3-AA）
#   submittedAt  DateTime? // 定稿时间戳（供 P4 智能体分析）
```
⇒ 状态域是 **`unanswered | draft | submitted`** 三档；时间列**只有 `submittedAt`**，
**草稿行没有任何时间戳** ⇒ 想做「这一题多久没动静了」需要**加列**。本轮**不加**（§3.5 用的是纯计数判据）。

### 2.4 数据**已经有了**：课堂级读端点，本批**不新增端点**

```bash
/usr/bin/grep -n "router.get('/classroom/:classroomId/answers'" server/src/routes/worksheets.ts
#   769:router.get('/classroom/:classroomId/answers', async (req, res) => {
```
响应形状是 `worksheets[] → participants[] → answerRows[]`（`WorksheetBoard`，`src/lib/types.ts:445`），
**每一层都按解析结果分组** —— 高级模式下不同的组各归各的学习单，正好是 §3.2 要的那一层。
⚠️ 这个端点**从不读 `Worksheet.content`**（规格 §5.4 红线，`worksheets.ts:742-753` 逐字），
逐题作答行里的 `value` 是**学生自己写的**那一个。

### 2.5 看板今天的两路数据，各自缺一半

| 数据 | 来源 | 缺什么 |
|---|---|---|
| `worksheetProgress`（`page.tsx:525`） | **只由广播写入**（`worksheet-answer-updated`） | 教师**刷新一次页面就清空** ⇒ 早做完的学生掉回「还没收到作答」（`page.tsx:520-524` 逐字记着这件事） |
| `worksheetBoard`（`page.tsx:546`） | REST（`loadWorksheetBoard`，`page.tsx:749`） | **只在打开抽屉时拉**（`page.tsx:777`）⇒ 抽屉关着时它可能是一份陈旧快照 |

⇒ 矩阵必须**两路都用**：REST 当底、广播当增量（§3.6）。只用广播会画出「全班都没动」，只用 REST 会看不到实时。

### 2.6 抽屉的两种入口**已经存在**，下钻**零改动**

```bash
sed -n '52,56p' src/app/teacher/classroom/worksheet-drawer.tsx
#   | { kind: 'questions'; worksheetId: string }
#   | { kind: 'question'; worksheetId: string; questionId: string }
#   | { kind: 'participant'; participantId: string };
```
⚠️ **没有**「某个参与者的某一题」那一档 ⇒ 点某一格**无法**让抽屉停在那一道题上（§3.7、§4）。

### 2.7 全屏覆盖层是**现成的形状**，但它今天被绑在「指定模式」上

```bash
/usr/bin/grep -n "gridFullscreen" src/app/teacher/classroom/page.tsx
#   488:  const [gridFullscreen, setGridFullscreen] = useState(false);
#  2930:      {gridFullscreen && (
#  2964:            <button onClick={() => setGridFullscreen(false)}
```
它的挂载条件是 `boardMode === 'assign'`（`page.tsx:2161-2165`），理由逐字是
「跟随模式下每格显示的是**不同**的模块，铺满之后既不像投屏讲评、也不像图墙」。
⇒ **那条理由对矩阵不成立**（矩阵只显示学习单进度，与「此刻在看哪个模块」无关），所以矩阵**不受 `boardMode` 约束**（§3.1）。

### 2.8 M3 为看板定过的那条规矩，与本轮的取舍

`p1-worksheet.md:758-763` 逐字：

> **方格阵着色 = 状态**（未答灰 / 作答中琥珀 / 已提交蓝），**不编码对错**。
> 理由：教师拿到「哪道题错得多」会去讲那道题（按题聚合，7.3）；「哪个学生第 3 题错了」不是课上
> 能当场处理的信息。而五档颜色在 28px 方块上难分辨，红绿对色觉障碍教师尤其不友好。
> **对错在抽屉里**（7.3），不在格子里。

⇒ 本轮**沿用**这一条（用户裁定 3），且矩阵的格子**比 28px 更小**，那条「难分辨」的理由在这里**更强**。

### 2.9 本机**没有浏览器驱动，也没有能渲染组件的 DOM 环境**（实测）

```bash
ls node_modules | /usr/bin/grep -cE '^(jsdom|happy-dom|@testing-library)$'
#   0
```
（`node_modules/.bin` 下 `playwright|puppeteer|chrom` 同样零命中，命令与输出见 M5a 的验收清单 §13。）
⇒ **矩阵长什么样、粘性表头对不对、色块能不能分辨** —— 本机**一条都验不了**；能验的只有纯函数（§6）。

---

## 三、设计

### 3.1 落点与入口

- 教师看板**头部**（`!gridFullscreen` 的那一段）新增一个「**矩阵**」按钮。
- 点开一个**全屏覆盖层**，形状照 `gridFullscreen`（`position:fixed; inset:0; zIndex:250`，盖过左侧导航），
  右上角一个「退出」按钮，关掉即回到看板。
- 🔴 **与 `boardMode` 无关**（理由见 §2.7）⇒ 它是一份**独立的 state**（`matrixOpen`），
  **不复用** `gridFullscreen` 的 state、列数（`fsCols`）与任何筛选。

### 3.2 🔴 一块 = 一份学习单

按 `WorksheetBoard.worksheets[]` **逐份渲染一块**，纵向依次排列，每块一个标题（学习单名）。

- **标准 / 分组模式**：这个数组只有一个元素 ⇒ **自动退化成一块**、无额外 UI（与抽屉形态 B 同一条退化规矩，`worksheet-drawer.tsx:31-33`）。
- **高级模式**：每个组一份 ⇒ 有几份画几块。**这不是可选项**（§2.2）—— 不做的话「第 3 题」在高级模式下指的是谁的第 3 题都说不清，而界面上**不会有任何报错**。

### 3.3 朝向与布局

**行 = 题**（左侧固定），**列 = 参与者**（右侧横向滚动）。

```
┌─ 光合作用实验 ─────────────────────────────────┐
│ 题＼参与者   张  李  王  赵  陈  刘   已交  标记  │
│ ───────────────────────────────────────────── │
│ 1 单选      ■   ■   ■   ■   ■   ■    6/6       │
│ 2 填空      ■   ■   ■   ■   ■   ■    6/6       │
│ 3 问答      ▣   ▣   ▣   ▣   □   □    0/6   ⚠ 5 人在做 │
│ 4 问答      ▣   □   □   □   □   □    0/6       │
│ 5 单选      □   □   □   □   □   □    0/6       │
│ ───────────────────────────────────────────── │
│ ■ 已交   ▣ 作答中   □ 未答                        │
└───────────────────────────────────────────────┘
```

- **行首（粘性左列）**：`题号 + 题型 + 题干摘要 + 「已交 N/M」 + 卡住标记`。
  **题干摘要** = `node.prompt` **单行截断**（CSS `text-overflow: ellipsis`，不自己切字符串 ——
  切字符串会把「这道题的题干还没写」那个既有空态文案也一起吃掉）。题干为空的题沿用抽屉的写法：`（这道题的题干还没写）`。
  题号与题型走**现成的** `flattenQuestions` / `questionTypeLabel`（`worksheet-tile-state.ts` 与抽屉同一把尺子）
  —— 子题也算题这条口径必须与看板格子、抽屉**逐字一致**，否则三处题数会对不上。
- **列宽固定**（色块约 22–24px + 竖排姓名约 16px ⇒ **每列约 40px**）：45 人 ≈ 1800px ⇒ 横向滚动。
- **列头姓名竖排**（`writing-mode: vertical-rl`）。⚠️ 不用「只画首字」——45 人里「张伟 / 张敏」会撞。
  放不下的长名截断 + `title` 全文。
- 🔴 **水平滚动时行首必须粘住**（`position: sticky; left: 0`），否则滑到第 30 个人就不知道在看哪一题。

### 3.4 单元格编码

**三档，只编码状态**（用户裁定 3 + §2.8）：

| 格 | 判据 | 颜色 |
|---|---|---|
| 未答 | `status === 'unanswered'`（或这一行根本没有） | 灰 |
| 作答中 | `status === 'draft'` | 琥珀 |
| 已交 | `status === 'submitted'` | 蓝 |

**不编码对错** —— 一个格子只有一个含义。对错仍在抽屉里（p1 §7.3）。

### 3.5 「卡住的那一题」判据（纯计数）

$$
\begin{aligned}
\text{作答中}(i) &= |\{p : \text{status}(p,i) = \texttt{draft}\}| \\
\text{已交}(i)   &= |\{p : \text{status}(p,i) = \texttt{submitted}\}| \\
\text{已作答}(i) &= \text{作答中}(i) + \text{已交}(i)
\end{aligned}
$$

**卡住的那一题** = 在「**已交 < 参与者数**」的题里，**已作答最多**的那一道（并列取题号最小）。

🔴 **为什么不是最自然的那个「未交最多」**：一个班正在做第 2 题时，第 3–10 题全部「未交」= 100%，
那个判据会把**还没讲到的题**误报成卡住 —— 而它看起来完全合理。**已作答（草稿也算）**才分得开
「停在这里」与「还没到」，而这两件事在课上要做的事完全不同。

纯函数返回一个**四态**（照 `worksheetTileState` 的判别联合写法），因为 `null` 有三种成因、
它们在屏幕上是三句不同的话：

```ts
export type MatrixHeadline =
  | { kind: 'no-participants' }                                        // 还没有人加入
  | { kind: 'all-submitted' }                                          // 全部交齐（没有「还没交齐」的题）
  | { kind: 'not-started' }                                            // 每道题的已作答都是 0
  | { kind: 'stuck'; questionId: string; index: number; tally: number; total: number };
```
`index` 是 **0-based 的题序**（与 `worksheetTileState` 的 `index` 同源），屏幕上加 1 显示。

### 3.6 数据流与合并规则

1. 矩阵**打开时**调一次 `loadWorksheetBoard()`（复用现成的，§2.4）—— 拿到底。
2. 打开期间吃看板**已经在监听**的 `worksheet-answer-updated` 广播（载荷含 `participantId` / `questionId` / `status`，`socket-events.ts:109-115`）—— 拿到增量。
3. 合并落在一个**纯函数**里：

```ts
export function buildWorksheetMatrix(
  sheet: WorksheetBoardWorksheet,
  nodes: WorksheetQuestionNode[],
  live: Record<string, ParticipantWorksheetProgress>,
): MatrixRow[];
```

**合并规则：广播赢。** 一个格子 `(p, q)` 的值 = `live[p]?.cells[q] ?? REST 那一行的 status ?? 'unanswered'`。
理由与学伴端 `hydrateAnswers` 的「**队列赢**」逐字同源：广播里那一条是**本地更新的那次动作**，
而 REST 那份是**上一次拉取时**的快照，一定更旧。
⚠️ 只用广播 ⇒ 刷新后矩阵画成「全班都没动」（§2.5）；只用 REST ⇒ 看不到实时。

**行的轴是题目树，不是「有人答过的题」的并集** —— 走 `flattenQuestions(nodes)`，
否则「一道全班都没动的题」会**整行消失**，而那恰恰是最该被看见的一行。

🔴 **两个 id 空间必须对得上**（这是本设计里最容易**静默**出错的一处 —— 对不上时矩阵不会报错，
只会一片灰）。实测三处**同源**，都是课堂参与者 `ClassroomStudent.id`：

```bash
sed -n '1084,1090p' src/app/teacher/classroom/page.tsx     # 广播的写入侧
#   setWorksheetProgress((prev) => {
#     const current = prev[participantId];      ← 键 = 载荷里的 participantId
sed -n '1795,1795p' src/app/teacher/classroom/page.tsx      # 卡片的读取侧
#   progress: participant ? worksheetProgress[participant.id] : undefined,
/usr/bin/grep -n "participantId: string;" -B 1 src/lib/types.ts
#   419:  /** `ClassroomStudent.id` —— 与看板格子的 `cs.id` 同源，也是 `review` 端点要的 id。 */
#   420:  participantId: string;
```
⇒ 矩阵的列用 `WorksheetBoardParticipant.participantId`、合并时用它查 `live[participantId]`，
与看板卡片是**同一个键空间**。⚠️ 分组 / 高级模式下这个 id 指的是**组**，不是学生（§2.1）——
矩阵不需要为此写任何分支，但读代码的人要清楚。

### 3.7 下钻（两条都复用现成入口，**零抽屉改动**）

- 点**行首（题号/题干那一块）** ⇒ `openWorksheetDrawer({ kind: 'question', worksheetId, questionId })` —— 该题全部作答。
  这是教师扫矩阵时真正会点的那一处。
- 点**格子** ⇒ `openWorksheetDrawer({ kind: 'participant', participantId })` —— 那个人的逐题详情。
  ⚠️ **不会**停在那一道题上（抽屉没有那个入口，§2.6）—— 这是**已知代价**，如实记在 §5。

### 3.8 空态与失败态（逐条给一句人话，不留白屏）

| 情形 | 屏幕 |
|---|---|
| 这一堂课没配学习单 | 「这间课堂还没配学习单」 |
| 正在拉取，且没有旧数据 | 「正在读取作答…」 |
| 拉取失败，且没有旧数据 | 「还没读到这一堂课的作答」（**不是**「全班都没作答」） |
| 拉取失败，但有旧数据 | **保留旧的那一份**（照 `loadWorksheetBoard:753-758` 的规矩：失败不清空） |
| 参与者数为 0 | 「还没有人加入」 |
| 学习单一道题都没有 | 「这份学习单还没有题目」 |

### 3.9 刷新节拍

矩阵**挂载期间每 30 秒重拉一次** `loadWorksheetBoard()`（卸载时清掉）。

理由：抽屉那条「每次打开都重拉」的规矩在矩阵上**不成立** —— 矩阵是**开着不关**的，
而广播会漏（教师这台机器的 socket 断线重连期间的那些作答，一条都收不到）。
30 秒与看板既有那条「会走的表」（`page.tsx` 的 `nowMs`，30 秒一格）同频，不再引入第三个节拍。

🔴 **这条重拉同时负责「列的增减」**：列的轴来自 REST 的 `participants[]`（§3.6），
所以**课中途加入的学生**最多要等下一轮（≤30 秒）才会出现一列 ——
期间他的广播会到达（`live` 里有他），但**不许**据此凭空造一列：列的真实来源只有 REST 那一份，
两边各造一套「谁在班里」必然分叉。反过来，**已退出的人**也要等下一轮才消失。

---

## 四、非目标（本轮明确不做）

- **不编码对错**（用户裁定 3）。
- **不显示在线状态**。⚠️ 这是一个**知情的缺口**：若 5 个人「卡在」第 3 题而其中 4 个已经掉线，
  判据照样会指向第 3 题。要补它得把参与者映射到看板的 `getDisplayCardStatus`（`page.tsx:1375`），
  而那套判据吃的是 `ClassroomDisplayCard`，与矩阵的数据源不是同一个 —— **本轮不引这条耦合**。
  在线上不了课这件事，教师看板卡片上本来就看得见。
- **不做排序 / 导出 / 打印**（旧 §9.5 的「列头可排序」不做）。
- **不做逐格定位下钻**（§3.7 的已知代价）。
- **矩阵不联动看板的两组筛选**（模块筛选行 / 状态筛选）—— 它是另一个视图。
- **不改学生端任何东西**（矩阵纯教师端只读）。
- **不做逐题投放**（§1，另一批）。

## 五、代价与风险（如实记）

1. 🔴 **本机验不了矩阵的任何视觉**（§2.9）：粘性列对不对、竖排姓名能不能读、22px 色块在教师屏幕上分不分得清、
   45 列横向滚动顺不顺手 —— **一律只能真机验**。`node --test` 能覆盖的只有 §3.5 与 §3.6 那两个纯函数。
2. **30px 级的色块上「未答灰 / 作答中琥珀」的对比度**没量过（本机没有渲染环境）。若真机上分不清，
   修法是加形状差异（未答空心 / 作答中半实心），而那要**再动一次布局**。
3. **「卡住」判据在一种情形下会指向一道不太该讲的题**：若全班大部分人在第 3 题，但少数人**跳到了第 5 题**
   并且**作答数刚好更多**，判据会指向第 5 题。这是「按已作答最多」这个口径的固有性质，
   不是 bug —— 它衡量的是「全班此刻聚在哪」，而不是「哪道题最难」。
4. **高级模式下会有多块**，块数 = 组数。屏幕上纵向堆叠，块多了要滚 —— 本轮不做折叠。

## 六、验收

**能自动验的**（本仓的 `node --test`，全部落在新的纯函数文件 `src/app/teacher/classroom/worksheet-matrix.ts` 与它的用例上）：

- `questionTallies`：三档计数、分母是**参与者数**（不是作答过的人数）。
- `stuckQuestionId` / `MatrixHeadline` 四态各一条，含：
  · 🔴 **阴性对照**：全班在做第 3 题、第 4–10 题没人动 ⇒ 指向第 3 题（**不是**第 4 题，也不是并列）
  · 「未交最多」会把第 4 题误报 ⇒ 一条**反证用例**钉住这两种口径的差别
- `buildWorksheetMatrix` 的合并规则：广播赢、REST 兜底、两边都没有 ⇒ `unanswered`；
  一道**全班都没动**的题**仍在行里**（走题目树而不是并集）。
- 🔴 **反证**：把「卡住」判据换成「未交最多」⇒ 对应用例必红，其余仍绿。

**只能真机验的**（一律标「未验证」，进 `specs/2026-09-25-m5b-acceptance.md`，由实施阶段产出）：

- 全屏覆盖层真的盖住了导航栏吗、退出按钮真的能回去吗；
- 45 列时横向滚动顺不顺、行首**真的粘住了**吗；
- 竖排姓名读不读得出来、22px 色块的三档颜色在教师屏幕上分不分得清；
- 点行首 / 点格子真的打开了抽屉对应的那一层吗；
- 广播到达时格子**真的**当场变色吗（不刷新）；
- 30 秒重拉在真机上会不会让画面跳动。

**本机能做的那一半 ≠ 端到端走查** —— 措辞要分清。

## 七、未采纳的路（各一句代价）

1. **参与者行 × 题列**（旧 §9.5 的朝向）：40 人要纵向滚，而「卡住那题」的线索在**底部的汇总行**
   ⇒ 得先滑到底才看得到，恰好打破了「一眼」。用户已选另一向。
2. **不做矩阵，只把「按题」做成看板上的常驻汇总条**：更省，但教师答不了「**谁**卡在那题上」
   —— 而那正是「谁要过去看一眼」的答案。用户已选矩阵。
3. **格子加对错（✓/✗）**：能一格答两个问题，但要推翻 M3 的裁定，且同屏两类信息争同一格、
   在 22px 上更难分辨（§2.8）。用户已否。
4. **给 `WorksheetAnswer` 加 `updatedAt`，用「这一题多久没动静」判卡住**：语义更贴「卡住」二字，
   但要多一次 DDL + 回填无法回填（历史行没有那个时间），且**判据会随网络抖动乱跳**。本轮不加。
