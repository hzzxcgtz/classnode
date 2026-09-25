# M6c · 课堂历史的三件套痕迹 · 设计规格

> 日期：2026-09-25 · 分支 `main`（M6a 已并入，HEAD `7c55c78`）· 状态：**待用户复核**
> 权威依据：`specs/2026-09-19-classnode-learning-suite-design.md` §P3（「**课堂历史**：`/teacher/history/` 呈现三件套使用痕迹」）
> 里程碑：`specs/2026-09-23-milestones.md`（M6 = 收口）
> ⚠️ 本文件里每一个 `file:line` 都是**调研时实跑取证过的**（本仓行号会漂；动手前请自己再 grep 一遍）。

---

## 一、范围与依据

「三件套」= **智能学伴（对话）/ 探究空间（网页）/ 学习单**。本轮只做**历史页的呈现**。

**裁定来源（2026-09-25，用户选择）**：**形态 = 在现有的「课堂记录」表里加三列**（每格一个数），
不做展开行、不做单独详情页、不做「合成一列」。

---

## 二、事实基线（**全部实跑过**；命令与逐字输出）

### 2.1 历史页今天**只有对话**，三件套一格都没有

```bash
sed -n '263,385p' src/app/teacher/history/page.tsx
```
九列表头逐字：`课堂名称` · `模式` · `创建时间` · `结束时间` · `时长` · `参与人数` · `交互量` · `文字量` · `操作`。
单元格取值全部来自对话：`{cr.totalRounds || 0} 轮`、`{cr.totalChars …} 字`、
`{cr.participantCount || 0}/…`。**没有任何一格是探究空间或学习单的痕迹。**
（同页的四个统计摘要块与 `dashboard/page.tsx` 同样只用对话字段 —— 后者实跑 `grep` **零命中**。）

### 2.2 那份数据的类型里**没有** webapp / worksheet 字段

```bash
/usr/bin/grep -n "getHistory" src/lib/api.ts
#   206:  getHistory: () => request<ClassroomHistoryItem[]>('/api/classroom/history/all'),
sed -n '662,671p' src/lib/types.ts
```
`ClassroomHistoryItem extends ClassroomSummary`，自有的 8 个字段是
`createdAt` / `endedAt` / `totalChars` / `totalRounds` / `participantCount` / `realStudentCount` /
`_count{students,interactions}` / `classes[]`。**没有任何学习单 / 探究空间的标量。**

### 2.3 🔴 服务端那个端点**不读**探究空间与学习单

```bash
sed -n '1545,1585p' server/src/routes/classroom.ts
awk 'NR>=1545 && NR<=1588' server/src/routes/classroom.ts \
  | /usr/bin/grep -c "webappUsage\|worksheetResponse\|worksheetAnswer"
#   0
```
它只读四样：`Classroom`（`status='ended'`）· `ClassroomStudent`/`Interaction` 的 `_count` ·
`ClassroomClass`/`Class` · `ClassroomGroup`/`GroupMember`，外加一条对 `Message` 的**原生 SQL 聚合**
（`COUNT(DISTINCT studentId)` / `SUM(LENGTH(content))` / `SUM(role='user')`）。
⇒ 学伴那一半**已经有数**（轮数 + 字数）；**探究空间与学习单是零**。

### 2.4 🔴 课堂结束后**数据都还在**（这是本设计能成立的前提）

```bash
sed -n '1136,1160p' server/src/routes/classroom.ts      # 结束 handler
/usr/bin/grep -rn "classroomStudent\.delete\|message\.delete\|webappUsage\.delete\|worksheetResponse\.delete\|worksheetAnswer\.delete\|interaction\.delete" server/src --include="*.ts" | /usr/bin/grep -v tests
#   server/src/routes/classroom.ts:1514:  tx.message.deleteMany({ where: { studentId: classroomStudent.id } })   ← 教师清单个学生对话，不是结束路径
#   server/src/socket/index.ts:1046:      prisma.webappUsage.deleteMany({ where: { classroomId } })              ← 落盘自身的一部分
```
`POST /:id/end` **只改 `Classroom` 一行**（`status` / `endedAt` / `code=null`），不删任何子表。
生产代码里**没有** `WorksheetResponse` / `WorksheetAnswer` 的删除语句。

⚠️ **`WebappUsage` 的落盘恰好发生在「结束」那一刻**，而且它**没有任何代码删它**（落盘后）。
两条必须写进设计的性质：

1. **一个「参与者 × 网页」只有一行**（`recordWebappSummary` 是 `deleteMany({classroomId})` + `createMany`）
   ⇒ 历史页看到的是**最后一次结束时**的快照，**不累加**。
2. **空 drain 时连删都不做**（`data.length === 0 ⇒ return 0`）—— 那段注释逐字写着两种成因
   （这节课确实没人用 / 这节课没有教师打开过看板 ⇒ 学生按需推流根本没推）**不可区分**，
   保守方向是**不删**。⇒ 历史页上「探究空间 = 0 行」**有两种成因**，呈现时不许断言「没用过」。

### 2.5 现成的聚合口径可以借用（M6a 刚写的）

```bash
sed -n '1243,1256p;1315,1320p' server/src/services/export-service.ts
```
那份报告同时读了 `worksheetResponse`（含 answers）与 `webappUsage`，**列口径已经定死**：
`webappUsageLineKeys()` / `webappUsageColumnLabels()` = 网页 / 参与者 / 时长 / 帧数，
而 `clicks` / `inputs` / `maxDepth` / `reports` **恒为 0 且明令不印**（`worksheet-report.ts` 的 GC 31）。
⇒ 历史页**必须沿用同一条口径**，不许自己另算一套。

---

## 三、设计

### 3.1 端点：`/history/all` 多三样聚合

在现有那条原生 SQL 旁边**再加两条**（照它的形状：一条 `$queryRawUnsafe` 按 `classroomId IN (…)` 聚合，
一次查完 50 个课堂，**不要 N+1**）：

| 新字段 | 口径 | 出处 |
|---|---|---|
| `webappUsageCount` | 该课堂 `WebappUsage` 里 **`COUNT(DISTINCT studentId)`** | 「几个参与者用过网页」 |
| ⚠️ **不是 `COUNT(*)`** | 该表有唯一约束 `(classroomId, studentId, webappId)` ⇒ **行数是「参与者 × 网页」** | 一节 3 网页 × 5 人 = 15 行，而人是 5 —— 用行数就是把「N 人」写成假的（**跑用例时才发现**，见 ledger R2） |
| `webappDurationMs` | `SUM(durationMs)` | 总时长。⚠️ 与 M6a 报告同源 |
| `worksheetSubmitted` | 该课堂 `WorksheetAnswer` 里 `status='submitted'` 的行数 | |
| `worksheetTotal` | 该课堂 `WorksheetAnswer` 的**总行数** | |

`ClassroomHistoryItem`（`src/lib/types.ts:662`）同步加这四个字段。

⚠️ **`worksheetTotal` 的分母要说清**：它是「已经产生过的作答行数」，**不是**「参与者 × 题数」——
后者要解析每份学习单的题目树，那是 M6a 报告那条重路径，**历史页不做**。
⇒ 列上呈现的是「交了 N 题 / 共 M 条作答」，**不许写成「已交 N/M 人」**（那是另一个口径，而这里拿不到分母）。

### 3.2 呈现：表格加三列

紧跟现有「文字量」之后加三列（「操作」仍在最后）：

```
| 学伴        | 探究空间              | 学习单            |
| 12 轮       | 3 人 · 1 小时 6 分    | 已交 18 / 24 题   |
```

- **学伴**：复用现成的 `totalRounds`（**不新增字段**）—— 那一列**已经存在**，本轮只是把
  三列**放在一起**，让「三件套」在表上成一个整体。
- **探究空间**：`{webappUsageCount} 人 · {formatDuration(webappDurationMs)}`；
  为 0 时写 **「无记录」**，**不许**写「未使用」—— 成因有两种不可区分（§2.4 的第 2 条）。
- **学习单**：`已交 {worksheetSubmitted} / {worksheetTotal} 题`；`worksheetTotal === 0` 时写「无作答」。
- 时长文案**复用 M6a 的 `formatDuration`**（`server/src/services/worksheet-report.ts`）——
  服务端算、前端只管显示，**不要在历史页再写一份**。

### 3.3 表宽

现在已经有 9 列、且第 6/7/8 列各有颜色分档（`page.tsx` 的轮数三档配色）。
再加三列会**明显变宽** ⇒ 外层容器补 `overflow-x: auto`（若还没有），
**不许**为了塞下去而缩字号（教师屏幕上的可读性优先于不横向滚动）。

---

## 四、非目标

- **展开行 / 单独详情页**（用户选了「加三列」）。
- **逐题正确率、逐人明细** —— 那是 M6a 那份 DOCX 报告的事，历史页只给总数。
- **改 `WebappUsage` 的采集**（`clicks` / `inputs` / `maxDepth` / `reports` 仍然恒为 0，不印）。
- **恢复课堂后累加** —— 它按 `classroomId` 替换（§2.4），本轮不改这个语义。
- **学生端**：只改教师端历史页。

## 五、代价与风险（如实记）

1. **「无记录」有两种成因**（§2.4）—— 文案必须避开「未使用」这个断言。这是本设计里最容易被写错的一句。
2. **快照语义**：恢复课堂再结束 ⇒ 探究空间汇总被替换，历史页看到的是最后一次的快照。
   教师若拿它当「整节课累计」会低估 —— 但那就是库里的真相，呈现时如实说。
3. **`worksheetTotal` 的分母口径**（§3.1 末尾）—— 写成「已交 N/M 人」会是一句假话。
4. **本机验不了**：历史页长什么样、三列挤不挤得下、颜色分档还看不看得出 ——
   只能真机（无浏览器驱动，实测零命中）。进验收清单。

## 六、验收

**能自动验的**：服务端那条聚合的三个数（真建库 + 真调 `/history/all`）——
含**空表**（没有 `WebappUsage` / 没有 `WorksheetAnswer` ⇒ 0，而不是报错）、
含**多课堂**（一次查完，不是 N+1 的语义正确性）。

**只能真机验的**（一律标「未验证」）：三列在教师屏幕上挤不挤、横向滚动顺不顺手、
「无记录」与「已交 0 / 0 题」两句在纸上读起来会不会被误读。
