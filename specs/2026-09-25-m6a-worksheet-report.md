# M6a · 学习单与探究空间报告 · 设计规格

> 日期：2026-09-25 · 分支 `main`（M5b 已并入，HEAD `cf3adee`）· 状态：**待用户复核**
> 权威规格：`specs/2026-09-19-classnode-learning-suite-design.md` §P3（收口的三件内容）
> 里程碑：`specs/2026-09-23-milestones.md`（M6 = 收口：导出 · 课堂历史 · 视觉打磨）
> **本文件只是 M6 的第一件（导出扩展）。**「课堂历史的三件套痕迹」与「视觉打磨」**各是独立的一批**。
> ⚠️ 本文件里每一个 `file:line` 都是**写这份文件时实跑过的**（本仓行号会漂；动手前请自己再 grep 一遍）。

---

## 一、范围与依据

设计文档 §P3 把「收口」写成三件事：**导出**（Word 报告加入学习单作答明细与探究空间使用汇总）·
**课堂历史**（`/teacher/history/` 呈现三件套使用痕迹）· **视觉打磨**。三件互不依赖 ——
本轮**只做导出**，其余两件各走自己的规格。

**裁定来源（2026-09-25，用户逐条选择）**：

| # | 问题 | 用户的选择 |
|---|---|---|
| 1 | M6 先做哪一件 | **导出扩展** |
| 2 | 手写笔迹在 Word 里怎么呈现 | **服务端渲染成图片嵌进去** |
| 3 | 明细加进哪一份报告 | **新开一份**（对话报告一字不动） |
| 4 | 新报告的主轴 | **按参与者** |

**两处控制器替用户定的（已在设计评审时逐条说明并获「可以」）**：

- 🔴 **不印正确答案**。设计文档写的是「逐题答案 + 对错」，按字面理解成**学生写的那个答案 + 判分结果**；
  `correctKeys` / `answers` / `explanation` **不进报告** —— 免得教师把报告发给学生时把答案一起发了。
- 🔴 **不做 CSV**。笔迹图进不了 CSV，而既有的那几条 CSV / stats 路径 `src/` 下**零调用点**（§2.1）。

---

## 二、事实基线（**全部实跑过**；命令与逐字输出）

> 本仓的 `grep` 是一个转发给 `claude -G`（ugrep）的 wrapper ⇒ 下面一律用 `/usr/bin/grep`。

### 2.1 导出面今天**只有一个活的入口**（这是本批最要紧的一条事实）

```bash
/usr/bin/grep -rnw --include='*.tsx' --include='*.ts' --exclude='api.ts' \
  exportConversations src/
#   src/app/teacher/history/page.tsx:63:      const data = await api.exportConversations(classroomId);
for f in exportStatsDocx exportConversationsCsv exportStatsCsv; do
  /usr/bin/grep -rnw --include='*.tsx' --include='*.ts' "$f" src/; done
#   （三次都零命中）
```

| 路径 | 状态 |
|---|---|
| `GET  /api/export/:id/conversations`（预览）· `POST /api/export/:id/conversations/docx`（下载） | ✅ **活的**，只从历史页进（`history/page.tsx:63` / `:114`） |
| `GET  /api/export/:id/stats` · `POST …/stats/docx` · `POST …/stats/csv` · `POST …/conversations/csv` | ❌ `src/` 下**零调用点**（服务端不会请求自己） |
| `src/lib/export-doc.ts` 的 `exportConversationsDoc` / `exportStatsDoc`（`647`–`962` 行，**316 行**） | ❌ 定义了、**没人调**（见 §2.2） |

🔴 **对实施者的直接后果**：新报告**必须**照活的这一条路做（`export-service.ts` + 历史页按钮）。
往那份死代码上添加「学习单明细」会产出一份**永远打不开**的报告，而**没有任何东西会报错**。

### 2.2 前端那份导出里有**两个死函数**

```bash
/usr/bin/grep -rlnw --include='*.tsx' --include='*.ts' exportConversationsDoc src/app src/lib
#   src/lib/export-doc.ts          ← 只有定义它的那个文件
/usr/bin/grep -rn --include='*.tsx' --include='*.ts' "export-doc" src/ | /usr/bin/grep -v tsbuildinfo
#   src/app/classroom/chat/message-item.tsx:46:  const { exportMessageToWord } = await import('@/lib/export-doc');
```
⇒ `export-doc.ts` 里**唯一还活着的是 `exportMessageToWord`**（第 `963` 行起；学生端导单条 AI 消息，
`message-item.tsx:46` 动态 import）。另外两个是客户端版的整份报告构建器，已被服务端那份取代。

### 2.3 探究空间汇总**少了两列数据** —— 「交互次数」今天不存在

```bash
/usr/bin/grep -n "interface WebappUsageRow" -A 5 server/src/socket/index.ts
#   558:export interface WebappUsageRow {
#   559:  studentId: string;
#   560:  webappId: string;
#   561:  durationMs: number;
#   562:  frameCount: number;
#   563:}
sed -n '1036,1044p' server/src/socket/index.ts
#   export async function recordWebappSummary(...) {
#     const data = rows.map(row => ({ classroomId, webappId: row.studentId, ... }));
#     ↑ 实际写入的只有 classroomId / webappId / studentId / durationMs / frameCount
```

🔴 `WebappUsage` 表里**仍然有** `clicks` / `inputs` / `maxDepth` / `reports` 四列，而
`recordWebappSummary` 的注释逐字写着「**写入的列变少了**（clicks / inputs / maxDepth / reports 不再产出）：
那四列留在表里（不动 schema、不跑 db push），落库时走它们各自的 `@default(0)` ⇒ **值恒为 0**」。

⇒ **设计文档要的「交互次数」今天拿不到。** 报告里印那两列就是印两列 0 —— 一句**印在纸上的假话**。
本轮的取法见 §3.3：**只印有数据的（时长 + 帧数）**，并把缺的那两样如实写成一句话。

### 2.4 `WebappUsage.studentId` 就是**参与者 id**（与全项目同一个键空间）

```bash
sed -n '1145,1146p' server/src/socket/index.ts
#   socket.data.classroomId = classroom.id;
#   socket.data.studentId = classroomStudent.id;
```
⇒ 报告里换名字走 `ClassroomStudent`，与看板、学习单作答端点、矩阵**同一个 id 空间**。

### 2.5 笔迹的渲染器**只在前端**，服务端那份只做体积校验

```bash
/usr/bin/grep -n "^export function strokePath\|^export function strokeWidthPx" src/lib/worksheet-ink.ts
#   287:export function strokeWidthPx(stroke: InkStroke, box: InkCanvas): number {
#   307:export function strokePath(points: readonly InkPoint[], box: InkCanvas): string {
/usr/bin/grep -n "^export function\|^export type" server/src/services/worksheet-ink.ts
#   isInkFormat / findInkValueError      ← 只有校验，没有渲染
```
值形状：`InkValue = { format, canvas: { w, h }, strokes }`，`InkStroke = { color, width, points }`。
⇒ 服务端要渲染就**必须新写一份「笔画 → path」**，而**同一件事两份实现**正是本项目反复被咬的那类分叉
（§3.4 给了它的护栏）。

### 2.6 `sharp` 是服务端依赖，但**它有一条降级分支**

```bash
/usr/bin/grep -n '"sharp"' server/package.json          # 31:    "sharp": "^0.35.1",
sed -n '17,26p' server/src/services/export-service.ts
#   try { _sharp = (await import('sharp')).default; }
#   catch (e) { console.warn('[export] sharp not available, WebP image conversion disabled:', e); _sharp = null; }
```
今天 sharp 只用于 WebP 转换（**可有可无**）。本批之后它**承重**（没有它就没有笔迹图）
⇒ §3.4 必须规定「拿不到 sharp 时报告长什么样」，而不是让它悄悄少一块。

### 2.7 既有导出已经会往 docx 里嵌图片

```bash
/usr/bin/grep -n "ImageRun" server/src/services/export-service.ts   # 9: PageNumber, PageBreak, ImageRun,
/usr/bin/grep -n "function scaleImageSize" server/src/services/export-service.ts
#   314:function scaleImageSize(imgWidth: number, imgHeight: number, maxPx = 400, maxHeightPx = 400)
```
⇒ 「嵌图」这条路已经有先例与现成的缩放工具，**不需要新依赖**。

### 2.8 学习单的两条关联路径（与全项目同一口径）

`ClassroomWorksheet`（课堂级）+ `ClassroomGroupMaterial(kind='worksheet')`（组级），
解析口径是 `resolveMaterialTargetId`：**高级模式下按组解析、不回落**（`server/src/services/group-material-resolve.ts:27-33`）。
⇒ 高级模式下不同的组可以是**不同的**学习单，报告必须按解析结果分组（与看板的读端点同一条口径）。

---

## 三、设计

### 3.1 产出与落点

- **新端点**：`POST /api/export/:classroomId/worksheet-report/docx`（教师鉴权，与既有的 docx 端点同一条）。
- **新入口**：历史页课堂行上，与「导出对话」并列一个「导出学习单与探究空间」按钮。
- 🔴 **对话报告一字不动**（用户裁定 3）。既有端点、既有按钮、既有文档结构都不变。

### 3.2 文档结构（主轴 = 参与者）

```
封面（沿用现成的 renderCover 那一套）
课堂信息：标题 / 互动码 / 模式 / 起止时间
总览：参与者数 · 学习单份数 · 用过探究空间的人数
──────────────────────────────────────────────
一、学习单作答
   《光合作用实验》
     ▸ 张三
         1. 单选  他的答案：B           ✓ 对
         2. 填空  他的答案：光合作用    ✗ 错
         3. 问答  他的答案：……          ─ 未判分（主观题）
         4. 绘图  （笔迹图）            ─ 未判分
     ▸ 李四 …
   《凸透镜成像》（高级模式下另一组的那一份）
     ▸ 第 3 组 …
──────────────────────────────────────────────
二、探究空间使用
   网页名        参与者   时长      帧数
   《凸透镜》    张三     3 分 20 秒 12
```

- **题号 / 题型 / 题干**走 `Worksheet.content` 的题目树（**服务端读**；看板那条读端点刻意不读 content，
  那是**读端点**的纪律，导出这一侧需要它来标注题号）。
- **对错**走 `isCorrect`（语义已收窄为「全对」）+ `gradeState`（三态）：
  `correct ⇒ ✓ 对` · `partial ⇒ ½ 半对` · `incorrect ⇒ ✗ 错` · `null ⇒ ─ 未判分`。
  ⚠️ 三态**必须**读 `gradeState`：`isCorrect: false` 同时覆盖「错」与「半对」（规格 §12），只读它会把半对印成错。
- **参与者名**取 `ClassroomStudent.name`（分组 / 高级模式下那是**组名**）。
- 🔴 **不印正确答案**（§1 的裁定）。

### 3.3 探究空间那一节：只印**有数据**的列

| 列 | 来源 | 说明 |
|---|---|---|
| 网页名 | `Webapp.name` | |
| 参与者 | `ClassroomStudent.name`（经 `WebappUsage.studentId`） | |
| **时长** | `durationMs` | 表注释：它是「首帧 → 末帧」的墙上时钟跨度 |
| **帧数** | `frameCount` | 表注释：`durationMs` 是推导出来的，**这个数字是那条推导的证据**（只采到 1 帧时时长为 0） |

🔴 **不印「点击 / 输入 / 滚动深度」**：那四列**恒为 0**（§2.3）。印它们是印假话。
报告里在表下写一句实话：**「交互次数与滚动深度本轮暂不可得（该项统计已停采）」** ——
让读到的人知道**是我们没有**，不是**学生没做**。

### 3.4 笔迹渲染：服务端新写一份，但有**一条可跑的护栏**

- 新增 `server/src/services/ink-render.ts`：`InkValue` → SVG 字符串 → PNG（`sharp`）。
- 🔴 **护栏**：它产出的 path 必须与前端 `src/lib/worksheet-ink.ts` 的 `strokePath` / `strokeWidthPx`
  **对同一批笔画逐字相同**。两边都是纯函数 ⇒ **写一条用例**：同一批笔画喂给两个实现，比 `d` 字符串。
  分叉当场变红，而不是等教师在报告里看到一张画歪的图。
  ⚠️ 服务端不能直接 import `src/lib/worksheet-ink.ts`（那是前端模块），所以要「两份实现 + 一条对拍用例」——
  这正是本仓 `worksheet-questions` 已经接受过的形状（前后端各一份 + 用例盯着）。
- **尺寸**：走现成的 `scaleImageSize(w, h, 400, 400)`。画布比例取自 `InkValue.canvas`。
- 🔴 **`sharp` 拿不到时**（§2.6）：那一格印 **「（手写作答，本机无法渲染成图片）」**，
  **不是**留空、也**不是**静默少一行 —— 「少一块」与「这一题没答」在报告里长得一样。

### 3.5 空数据与边界（每条一句实话）

| 情形 | 报告里写什么 |
|---|---|
| 这间课堂没配学习单 | 「本次课堂未使用学习单」 |
| 配了但没有任何作答 | 列出学习单与题号，每人格子里写「未作答」 |
| 没人用过探究空间 | 「本次课堂未使用探究空间」 |
| 某人的某题是空的 | 「未作答」（与「答了但内容是空」区分：后者按实际值渲染） |
| 高级模式下某组没配学习单 | 那一组不出现在「一、」里，但在一句附注里点名（与 M5b 的矩阵同一条纪律） |

### 3.6 文件名

文件名**不在服务端定** —— 服务端只回 `Content-Disposition`，而前端是**自己拼** `a.download` 的
（实测 `src/app/teacher/history/page.tsx:123-125`）。既有约定逐字是：

```
`${titleSafe}-对话记录-${YYYY-MM-DD_HH-mm-ss}.docx`
```

⇒ 新报告照抄同一条，只把中间那段换掉：

```
`${titleSafe}-学习单与探究空间-${YYYY-MM-DD_HH-mm-ss}.docx`
```

⚠️ `titleSafe` 的 `replace(/[\\/:*?"<>|]/g, '_')` 与那个时间戳格式**逐字照抄**，
不要自己发明第二种写法。

---

## 四、非目标（本轮明确不做）

- **对话报告的任何改动**（用户裁定 3）。
- **CSV**（§1 的裁定）。
- **导出正确答案**（§1 的裁定）。
- **恢复探究空间的点击 / 输入 / 滚动深度统计**（那是 P2 的一项改动，不在本批）。
- **删掉 §2.1 / §2.2 里那些死代码**（`export-doc.ts` 的 `647`–`962` 行 + 三条端点的客户端包装）。⚠️ 它是一个**真实的隐患**（往死路径加功能 = 无人报错），
  但删它要动 `export-doc.ts` 与学生端那条动态 import 的边界 —— **留给「视觉打磨 / 收口」那一批**，
  本轮只在计划里把它标清楚。
- **课堂历史的三件套痕迹** · **视觉打磨**（各是独立的一批）。

## 五、代价与风险（如实记）

1. 🔴 **文档体积**。40 人 × 若干手写题 = 几十上百张图，一份报告可能到几十 MB。
   缓解：单图上限走现成的 `scaleImageSize`（400×400）。**超出上限时会发生什么，实施时必须实测并写进验收清单**。
2. 🔴 **「笔画 → path」两份实现**。护栏是 §3.4 那条对拍用例，但它只保证**路径字符串一致**，
   不保证**光栅化之后一致**（线宽、圆角、抗锯齿都在 sharp 那一侧）。真机开 Word 看仍然必要。
3. 🔴 **本机验不了「图长得像不像那幅画」**：能验的是「路径与前端逐字一致」+「PNG 非空且尺寸对」。
   **画得像不像，只能真机**。
4. **`sharp` 变成承重依赖**。今天缺了它只少一个 WebP 转换；本批之后缺了它笔迹就是一行说明文字。
   §3.4 规定了降级文案，但那条路**本机不容易复现**（要假装 sharp 加载失败）。
5. **导出含学生真名与作答**：与现有的对话导出**同一条现状**（教师主动导出的文件本来就有名字），
   不是新开口子。⚠️ 但它**多带了一类数据**（学习单的逐题作答）—— 如实记在这里。
6. **报告变厚之后「一次导出」的等待时间**：服务端要渲染 N 张图。实施时实测一次 40 人班级的耗时并写进验收清单。

## 六、验收

**能自动验的**（本仓的 `node --test`）：

- 🔴 **对拍用例**（§3.4）：同一批笔画 ⇒ 服务端 `strokePath` 与前端 `strokePath` 产出**逐字相同**的 `d`。
  含反证：把服务端的取整方式改一格 ⇒ 必红。
- 判分三态的映射（`gradeState` → 对 / 半对 / 错 / 未判分），含**只读 `isCorrect` 会把半对印成错**的反证。
- 探究空间那一节的取列：**恒为 0 的四列不许出现在报告里**（反证：把它们加回去 ⇒ 必红）。
- 空数据五种情形各自的文案（§3.5）。

**只能真机验的**（一律标「未验证」，进 `specs/2026-09-25-m6a-acceptance.md`）：

- 打开导出的 .docx：笔迹图**真的画出来了**、比例对、不变形；
- 40 人班的导出耗时与文件大小；
- 高级模式下两份学习单分成两节、组名对得上；
- `sharp` 缺失时的降级文案真的出现（要手工造那个环境）。

## 七、未采纳的路（各一句代价）

1. **加进对话报告**：一份看完，但 40 人班的那份文档会从「能读」变成「翻不动」。
2. **只标「（手写作答）」不渲染**：省一份实现，但绘图题的答案**就是那幅画** —— 报告里那道题等于没有答案。
3. **扩充统计表**：`StatsExportReport` 天生是表、最省，但表里放不下逐题原答案与笔迹图，而那是本批的正文。
4. **恢复点击 / 输入统计再导出**：能兑现设计文档的原话，但那要动 P2 的采集链路（`socket/index.ts` 的
   `WebappUsageRow` 与客户端的上报），**不在本批**；本轮选择如实说「暂不可得」。
