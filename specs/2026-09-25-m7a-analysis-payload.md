# M7a · 分析型智能体的「一次性聚合载荷」· 设计规格

> 日期：2026-09-25 · 分支 `main`（M6b 已并入，HEAD `b1f9f1f`）· 状态：**已复核**（用户 2026-09-25 裁定三条，见 §七）
> 权威依据：`specs/2026-09-19-classnode-learning-suite-design.md`
> §15.1（分析型智能体）· §8.4（逐题提交的**理由**就是按题聚合，`:742`）· §6.3（结果写独立字段、**永不覆盖原始数据**，`:558`）
> 里程碑：`specs/2026-09-23-milestones.md`（M7+ = 原 P4「后续演进」）
> **本文件只是 M7 的第一小块**：载荷与缝。语音（§15.3）、笔迹识别（§15.2）、材料题组、分层教学**都不在本轮**。
> ⚠️ 本文件里每一个 `file:line` 都是**写这份文件时实跑取证过的**（本仓行号会漂；动手前请自己再 grep 一遍）。
> ⚠️ 本仓的 `grep` 是转发给 ugrep 的 wrapper ⇒ 下面一律用 `/usr/bin/grep`。

---

## 一、范围与依据

### 1.1 用户在 2026-09-25 设计对话里的四条裁定

| # | 裁定 | 本规格里的落点 |
|---|---|---|
| 1 | **本版不接第三方 AI**，先把**接口留出来** | §3.1 的 `narrative`/`perStudent`/`agentId`/`model` 四格恒 `null`；§3.7 单一外发点 |
| 2 | 教师**按题手动发** | §3.6 入口在矩阵题行上，点一下算一题 |
| 3 | **只发主观题**（文字类 + 绘图类） | §3.2 的 `analysisEntryGate`；⚠️ 见 §2.1 的漂移风险 |
| 4 | 绘图走**一张联系表**；文字类**汇总成一份文档** | §3.3 统一成「一张作答清单，N 格」 |

**裁定 1 的含义要说准**：这不只是「少写一段代码」，而是**本版零外发** ——
分析产物全部留在本机，网络上一个字节都不出去。见 §3.7。

### 1.2 本版建什么

1. **数据结构**：`WorksheetQuestionAnalysis`（§3.1）
2. **一道缝**：`buildAnalysisPayload(worksheetId, questionId)` → 聚合载荷（**纯函数部分可测**，§3.2）
3. **教师端**：矩阵题行上的「分析」入口 + 载荷预览浮层（§3.6）
4. **一个存在但未接线的「发给 AI 分析」按钮**，界面上写明尚未接入

### 1.3 本版**不**建什么

- **任何第三方 AI 调用**（零外发）
- **笔迹识别（HTR）** —— 设计文档 §15.2，另一件事。**不占用 `WorksheetAnswer.value` 里那个 `recognized` 字段**，理由见 §3.1
- **语音**（§15.3）
- **按人的建议** —— 结构预留（`perStudent`），本版不产
- **逐题投放** —— 里程碑总表把「逐题投放（教师控制发放节奏）」写进了 M5 的描述，但**全仓不存在**（§2.7 取证）。与本轮无关，只是记一笔

### 1.4 为什么这一版不叫「智能体」

里程碑 M7 的名字是「分析型智能体」，而**本版一次 AI 都不调**。沿用那个名字会让后来的人
（包括我自己）以为哪里已经接了模型 —— 那正是本项目反复出现的失败形态。
⇒ 文件与模型一律用**载荷（payload）**这个词，`narrative` 那一格空着就是「还没接」的证据。

---

## 二、事实基线（**全部实跑过**）

### 2.1 🔴 「主观题」在仓里有两个推导，**目前恰好等价但没有任何东西守着**

前端**声明式**：

```
$ /usr/bin/grep -n "value: 'short-answer'" src/lib/worksheet-questions.ts
101:  { value: 'short-answer', label: '问答题', hint: '主观题，不自动判分', graded: false },
$ /usr/bin/grep -n "value: 'drawing'" src/lib/worksheet-questions.ts
110:  { value: 'drawing', label: '绘图题', hint: '学生在画布上画图，不自动判分', graded: false },
```

服务端**行为式**（`JUDGES` 那张 `Record<QuestionType, …>` 里，两格恒回 `null`）：

```
$ /usr/bin/grep -n "': () => null\|^  drawing: () => null" server/src/services/worksheet-questions.ts
870:  'short-answer': () => null,
878:  drawing: () => null,
$ /usr/bin/grep -n "^const JUDGES" server/src/services/worksheet-questions.ts
864:const JUDGES: Record<QuestionType, (data: Record<string, unknown>, value: unknown) => GradeState | null> = {
```

**今天两边是同一个集合**（`{short-answer, drawing}`），但一边是**声明的标志**、一边是**行为的结果**。
⇒ 谁哪天加一个「有 `graded: false` 却有真判分器」的题型（或反过来），两边**静默分叉**：
- 看板抽屉按 `GRADED_QUESTION_TYPES` 决定画不画 ✓/✗（`src/app/teacher/classroom/worksheet-drawer-state.ts:108`）
- 本设计按服务端口径决定**哪道题有「分析」入口**

分叉的后果具体是：**教师对一道会自动判分的客观题也能点「分析」**，或者**一道主观题没有入口**。
两个方向都**不报错、没有测试红**。⇒ 设计里必须有**一条跨工程对拍用例**把它钉死（§3.2）。

### 2.2 光栅化那一半**已经存在**（M6a 建的）

```
$ /usr/bin/grep -n "export async function inkToPng" server/src/services/ink-render.ts
68:export async function inkToPng(ink: InkValue): Promise<Buffer | null> {
$ /usr/bin/grep -n "export const INK_PNG_MAX" server/src/services/ink-render.ts
21:export const INK_PNG_MAX = 400;
```

`inkToPng` 把一份笔迹画成 PNG（SVG → sharp），**渲染不出来回 `null`、绝不抛**，
已有 `server/src/tests/ink-render.test.ts`（5 条）守着。

🔴 **更关键的是另一半**：`strokePath(points, box)` 把归一化点映射进**任意指定的框**：

```
$ /usr/bin/grep -n "export function strokePath" server/src/services/ink-path.ts
99:export function strokePath(points: readonly InkPoint[], box: InkCanvas): string {
```

⇒ **「把 N 幅画拼进一张图的 N 个格子」不需要发明新东西**：每格就是一个不同的 `box`（配一个 `translate`），
路径字符串由同一个函数产出。这是选路 A 的技术依据。

### 2.3 sharp 能渲染 SVG `<text>` 与中文 —— **但只在开发机上验过**

实测（`server/` 目录内跑 —— `sharp` 装在这里；**一条命令同时产出下面全部四行**）：

```
$ node ./label-probe.mjs          # 探针脚本跑完即删，内容见本节末
空白对照         非白   0.000%     279 bytes
User_001     非白   4.720%    2309 bytes
张三           非白   2.382%    1208 bytes
第三组          非白   4.365%    1786 bytes
```

⇒ 三组标签的非白像素都**远高于空白对照的 0.000%**，且**彼此不同**（字数不同的字符串不该同值）
⇒ `<text>` 确实被渲染成了字形，不是被丢掉、也不是画成同一个豆腐块。
⇒ 标签（伪名）**可以**用 SVG `<text>` 画进联系表。`composite` 也实测可用（另一条命令，返回 `true`）。

🔴 **但这是我这台开发机**（macOS / arm64）。打包后的应用（`src-tauri`，含 Windows）可能带着
**没有 fontconfig 的 sharp 构建**，那时 `<text>` 会**无声地画不出来** ——
图上每个格子都在，就是没有标签，而 AI 因此认不出哪幅是谁的。**构建不报错、产物是真 PNG、图看着也正常。**
⇒ 必须有运行期探针（§3.5）。

### 2.4 🔴 一道题的作答值格式**可以混**

`judge()` 的注释逐字记着这个场景（`server/src/services/worksheet-questions.ts:889`）：

> 教师在 D1 才拿到「作答方式」那个开关，所以一道问答题可能「之前是键盘作答（`text/v1`），
> 之后改成手写」，学生那份**已经交上来**的 `text` 值仍然该被正常处置

⇒ 同一道题的在库作答里，**文字条目与笔迹条目可以并存**。
所以载荷形态不能是「一道题一种」，必须允许 `mixed`（§3.3）。
**这条不写进设计就会在实现时才撞上**，而那时通常会被「按题型决定」的漂亮假设压过去。

### 2.5 🔴 参与者可以是**组**，不是人

```
$ /usr/bin/grep -n "export function moduleCountUnit" -A2 src/app/teacher/classroom/worksheet-tile-state.ts
263:export function moduleCountUnit(mode: string): '人' | '组' {
264:  return mode === 'group' || mode === 'advanced' ? '组' : '人';
```

分组 / 高级模式下 `ClassroomStudent` 一行是**组**。⇒ 「已交 N/M」的**单位**必须走
`moduleCountUnit(mode)`，**不许硬写「人」**。本项目在这件事上已经被咬过两次（M5a 与 M6c）。

### 2.6 矩阵浮层与题行的挂载点

```
$ /usr/bin/grep -n "const tally = rowTally" src/app/teacher/classroom/matrix-overlay.tsx
179:  const tally = rowTally(row);
$ /usr/bin/grep -n "zIndex: 250" src/app/teacher/classroom/matrix-overlay.tsx
21: * 🔴 **层级**：本覆盖层 `zIndex: 250`（与 `gridFullscreen` 同档），而学习单抽屉是 `290/291`
```

题行渲染就在 `matrix-overlay.tsx:179` 一带（`rowTally(row)` + `promptLabel(row.prompt)`，`:192`）。
新入口加在这里；浮层层级要排在 250 之上但**不与学习单抽屉（290/291）打架**（§3.6）。

### 2.7 「逐题投放」不存在（记一笔，与本轮无关）

```
$ /usr/bin/grep -rn "releasedQuestions\|releaseQuestion\|visibleQuestions\|投放" server/src/ src/app/teacher/ src/app/classroom/
（零命中）
```

里程碑总表把「逐题投放（教师控制发放节奏）」写进了 M5 的描述，而**它从来没被实现**。
⇒ 里程碑总表需要一并更正（见 §六）。

### 2.8 学习单答案**从来没出过这台机器**

```
$ /usr/bin/grep -rn "from './ai-proxy\|from '../services/ai-proxy" server/src/ --include='*.ts' | /usr/bin/grep -v tests
server/src/routes/agents.ts:8:    （连通性测试 / 开场白 / bot 发现）
server/src/services/agent-checker.ts:9: （周期性连通性检查）
server/src/socket/index.ts:3-4:      （聊天流）
```

AI 只从这三处被调用，**全部是聊天与智能体管理**。`anonymizer` 也只在 `ai-proxy.ts` 里被调用
（`:119`、`:153`），把学生**真名**换成 `User_NNN`，回程再换回。

⇒ 本设计**新增的是一类数据外发**（学习单作答），不是新增一条通道。
公平地说：聊天功能今天就在把学生自己打的字发给 Coze/文心/智谱 —— 红线已经为「学生的文字」开过一次。
新增的是：① 学习单答案是**被批改的作业**，性质不同；② §15.2 想发**笔迹图像**（行为生物特征），那是新的一层。
**这两点本版都不触发**（零外发），但它们决定了 §3.7 的设计。

`anonymizer` 的一个**不稳定**性质必须记住：`MAX_ENTRIES = 500`，满了或换课堂就重置
（`server/src/services/anonymizer.ts:7`）⇒ `User_007` **跨会话不稳定**（§3.1 决定 2）。

---

## 三、设计

### 3.1 数据结构

新增 `WorksheetQuestionAnalysis`，按 **`(worksheetId, questionId)` 唯一**：

| 字段 | 本版 | 含义 |
|---|---|---|
| `worksheetId` / `questionId` | ✅ | `questionId` 是 **content 树里的稳定 id，不是下标**（与 `WorksheetAnswer.questionId` 同一口径） |
| `payloadKind` | ✅ | `'text'` \| `'image'` \| `'mixed'`（§3.3） |
| `aggregate` | ✅ | **本地聚合的结构化描述** —— 唯一的事实来源 |
| `coveredCount` | ✅ | 已提交该题的**参与者**数 |
| `totalCount` | ✅ | **该题应作答的参与者**数 |
| `computedAt` | ✅ | 算出来的时刻（陈旧判定靠它，见决定 3） |
| `narrative` | `null` | 以后：AI 写的解读 ← **「留的接口」** |
| `perStudent` | `null` | 以后：按人的建议 ← **「留的接口」** |
| `agentId` / `model` | `null` | 以后：用了哪个分析型智能体、哪个平台 |

**决定 1 · 不存渲染好的 PNG，只存结构化 `aggregate`，图是按需渲染的派生物。**
理由三条：① 原始笔迹才是事实来源，图随时可重渲；② 三个旋钮（§3.4）调过之后，
存下来的旧图会变成「看着对、其实是按旧参数画的」；③ 40 幅画的 PNG 不该进库。
代价：每次打开都要重渲（M6a 导出时就是这么做的，可接受）。

**决定 2 · 按 `studentId` 存，伪名只在渲染那一刻生成。**
`User_007` 跨会话不稳定（§2.8）⇒ 把伪名落盘，下次打开就**指错人**。
⇒ `aggregate` 里存 `studentId`；伪名是**渲染期的临时产物**，不进库。

**决定 3 · 不存 `stale` 字段。**
分析是**按需重算**的（裁定 2：教师手动触发），所以「有没有更新」由
`computedAt` 与「该题最后一次 `submittedAt` 的比较」**派生**即可。
存一个能派生的状态 = 多一处会不同步的地方。
界面判据：`computedAt < 该题最新 submittedAt` ⇒ 显示「有新的作答，结果可能已过期」。

**决定 4 · 不占用 `WorksheetAnswer.value` 里那个 `recognized`。**
设计文档 §6.3（`:558`）逐字写着 `"recognized": null // ★ P4 智能体识别结果写此处，不覆盖 strokes` ——
那是**单个学生的笔迹识别结果（HTR）**，与「按题的班级聚合」**不是同一个对象**。
两者以后都要，但这一版是后者。现在占了那个名字，以后两个概念会打架。

**决定 5 · `totalCount` 复用 M5b 已有的口径，不另算一把尺子。**
高级模式下**每个组可以是不同的学习单**（M5b 规格 §2.2）⇒ 「应作答的参与者数」不是「全部参与者数」，
而是「**有这份学习单的**参与者数」。`worksheet-matrix.ts` 已有现成的 `uncoveredCount(participantCount, sheets)`
处理这件事。**先找它，别再造一把尺子**（本项目在这上面被咬过两次）。

### 3.2 那道缝：两个文件，分界线是「有没有碰 sharp」

与 `ink-path.ts` / `ink-render.ts` **同一条纪律**（M6a 立的，见 `ink-render.ts:8-14` 的注释）：

| 文件 | 内容 | 可测 |
|---|---|---|
| `server/src/services/analysis-payload.ts` | 纯函数，**不碰 sharp、不碰网络** | ✅ `node --test` |
| `server/src/services/analysis-render.ts` | **唯一**碰 sharp 的：载荷 → PNG | ❌ 本机验不了 |

`analysis-payload.ts` 导出的东西（**全是纯函数**）：

```ts
/** 闸门：这道题进不进「可分析」集合。只放 !graded 的两类。 */
export function isAnalyzableType(type: unknown): boolean

/** 谁进载荷：status === 'submitted'、按 studentId 确定性排序（§3.3 的「顺序必须可复现」）。 */
export function selectAnalyzeEntries(answers: RawAnswer[], participants: Participant[]): AnalyzeEntry[]

/** 载荷形态：由**实际作答值的格式**决定，不由题型决定（§2.4）。 */
export function payloadKindOf(entries: AnalyzeEntry[]): 'text' | 'image' | 'mixed'

/** 文字类：聚合文档的**文本**（纯字符串拼装）。 */
export function buildTextDocument(question: QuestionMeta, entries: AnalyzeEntry[]): string

/** 绘图类：算出每张联系表里每一格的坐标与标签（纯算术）。 */
export function layoutSheets(entries: AnalyzeEntry[], knobs: SheetKnobs): SheetLayout[]

/** §1.2 说的那个入口 = 上面五个的组合（薄编排层，不写判断逻辑）。 */
export function buildAnalysisPayload(
  question: QuestionMeta, answers: RawAnswer[], participants: Participant[], knobs: SheetKnobs,
): AnalysisPayload
```

⚠️ `buildAnalysisPayload` **只做组合、不写判断** —— 判断全在它调的那五个里。
理由是本仓的既有纪律：判断逻辑必须在可被 `node --test` 测的纯模块里，
编排层薄到一眼能看完（`analysis-render.ts` 才是那个碰 sharp 的边界）。

🔴 **一条跨工程对拍用例**（对应 §2.1 的漂移风险）：
`src/lib/analysis-gate-parity.test.ts` —— 断言 **服务端 `isAnalyzableType` 放行的集合**
== **前端 `QUESTION_TYPE_OPTIONS` 里 `graded: false` 的集合**，且遍历全部 9 个题型
（不是只测那 2 个 —— 只测 2 个的话，**新加的第 10 个题型两边分叉时它不红**）。
写法照抄 `src/lib/worksheet-ink-parity.test.ts`（它已经在做跨工程 import，验证可行）。

⚠️ **反证**：往任一张表里塞一个只有一边有的题型，这条用例必须能发现（用例里要真的构造这个输入，
不是嘴上说）。本项目在 M6b 刚栽过「反证的夹具区分不开它要对比的两种口径」。

### 3.3 载荷的形状：统一成「一张作答清单，N 格」

三种形态，由 `payloadKindOf` 决定：

| `payloadKind` | 何时 | 产物 |
|---|---|---|
| `'text'` | 全部条目都是文字 | **一份聚合文档**（文本，教师可直接读） |
| `'image'` | 全部条目都是笔迹 | **一张或多张联系表**（PNG） |
| `'mixed'` | 两种都有（§2.4） | **两者都产**，且界面必须说清「本题有两种作答方式」 |

**为什么 `mixed` 是必须的而不是过度设计**：§2.4 那个场景是**真实存在**的（教师中途改作答方式），
而它是**静默**的 —— 如果不处理，笔迹条目会在纯文本载荷里**消失**，教师看到的「已交 12 人」
与文档里只有 8 段文字对不上，而**没有任何地方报错**。

**顺序必须确定性**：按 `studentId` 升序。理由：模型会说「第 3 幅画……」「上面第 5 条……」，
顺序不确定 ⇒ 映射不回去。

**空条目不进载荷，但要在元信息里报数**：没作答的人不进清单，但
`covered / total` 必须随载荷一起给出去 —— 让模型（和教师）知道这是 12/40 而不是全部。

### 3.4 三个旋钮**就是**「留的接口」

```ts
export interface SheetKnobs {
  cellWidth: number;       // 默认 320 —— 绘图题的原生画布宽
  cellHeight: number;      // 默认 240 —— 绘图题的原生画布高
  columns: number;         // 默认 3
  maxCellsPerSheet: number;// 默认 12
}
```

默认值取绘图题的原生画布尺寸（`ink-render.ts:31-33` 的 `FALLBACK_BOX` 注释逐字写着
「绘图题的默认框就是 `320 × 240`」）。40 人 ⇒ 3 列 × 4 行 = 12 格 ⇒ **4 张**。

⚠️ **这三个数我猜不出正确答案**：本机看不见图、也没有视觉模型 ⇒
「每格 320×240 够不够模型看清」**只能拿真模型调**。
⇒ 它们必须是**可配置的**（先从设置读、有默认值），这样接口留出来的第一版就能调参，
而不用改代码。**这是「先留接口」这四个字里最该留的东西。**

### 3.5 标签的静默失效与运行期探针

联系表的每一格上方要画一格标签（伪名，如 `User_001`），否则模型认不出哪幅是谁的。

**探针**：渲染联系表之前，先渲染一张**极小的探针图**（含一个已知标签的 `<text>`），
比对非白像素比例与一张不含 `<text>` 的对照图：
- **两者不同** ⇒ `<text>` 能渲染 ⇒ 正常走带标签的联系表
- **两者相同** ⇒ `<text>` 被无声丢弃（打包环境缺 fontconfig，§2.3）⇒ **退化为「编号网格 + 附一份编号对照文本」**，并在界面上说明

理由：这个失效是**静默**的（图是真的、格子都在、构建不报错），
而后果是**分析结果整体错位**（模型把 A 的画认成 B 的）—— 那比「没有分析」坏得多。
本项目在 M6b 刚栽过一次同形的（`.spinner` 的悬空 `animation-name`：圈不转、构建不报错）。

### 3.6 教师端

**入口**：`matrix-overlay.tsx:179` 那一带的**题行**上，只对 `isAnalyzableType` 为真的题出现「分析」。
客观题（单选/判断/多选/填空/排序/连线/归类）**不出现入口** —— 它们本来就判分，看板的 ✓/✗ 已经回答了问题。

**点击** → 打开一个载荷预览浮层：

```
┌─ 第 3 题 · 问答题 · 已交 12/40 人 ──────────────────── [×] ┐
│                                                            │
│  （文字类）                （绘图类）                       │
│  那份聚合文档，直接可读     那张联系表，直接可看            │
│  每段前面是伪名             3×4 格，每格上方有伪名           │
│                                                            │
│  ⚠️ 有 2 份作答是在改作答方式之前交的（文档 + 图各一部分）   │
│                                                            │
│  [ 重新生成 ]   [ 发给 AI 分析 ] ← 本版禁用                 │
│                 按钮下方：尚未接入第三方 AI                  │
└────────────────────────────────────────────────────────────┘
```

**三条呈现纪律**：

1. **`covered / total` 必须显眼**。载荷只覆盖 12/40 人 —— 教师必须看得见，
   否则会把「12 人的情况」读成「全班的情况」。这是本设计的**防假绿**要点。
2. **单位走 `moduleCountUnit(mode)`**（§2.5）：分组 / 高级模式下写「组」。
3. **层级**：新浮层排在 `matrix-overlay`（250）**之上**、学习单抽屉（290/291）**之下** ——
   或者干脆做成矩阵浮层**内部**的一个视图（同一个 250 层里切换），避开层级问题。**倾向前者**。

⚠️ 这个设计的一个**额外好处**：**缝的产物本身就是功能，不是占位**。
一份「全班这题都答了什么」的文档、一张「全班的画排在一起」的图 —— 教师**现在就**用得上。
这避开了本项目反复出现的失败形态：造了护栏函数却没人调用
（M6a 的 `unmappedParticipantsNotice` 有定义、有用例、还进了计划的 `Produces`，
而**渲染层一次都没调它**，于是高级模式下一个缺陷被整批门禁放行）。

### 3.7 外发点**只有一个**

本版零外发。但设计的义务是**为将来那一次外发留好唯一的闸门**：

- 全仓**只有** `analysis-render.ts` 之外的那一个调用点（将来调用 AI 的那个函数）会碰网络
- 它接收的入参就是本载荷 —— 所以「发出去的是什么」在**代码里一眼可见**
- 将来加任何闸门（教师逐次确认、按平台黑名单、只发聚合不发原文）都**只改那一处**

理由：如果外发散在几处，将来的合规审查就得满仓找。**一处**是可以被审查的，
**几处**不能。（设计文档 §15.1 只说了「扩展现有 `Agent` 加 `purpose` 字段」，
没说外发点该有几处 —— 这条是本设计补的。）

---

## 四、非目标

- 不接第三方 AI（裁定 1）
- 不做笔迹识别（§15.2）、不做语音（§15.3）
- 不产按人的建议（只留 `perStudent` 那一格）
- 不做「逐题投放」（§2.7，它本来就不存在）
- **不为「客观题也能分析」留口子** —— 客观题不进载荷是**设计**，不是暂时没做

---

## 五、代价与风险（如实记）

| # | 风险 | 本机能验吗 | 缓解 |
|---|---|---|---|
| 1 | **每格 320×240 够不够模型看清** | ❌ 没有视觉模型 | 三个旋钮可配置（§3.4）—— 用真模型调 |
| 2 | **联系表长什么样、字清不清楚** | ❌ 本机看不见图 | 只能真机看（§六） |
| 3 | **打包环境 sharp 缺 fontconfig ⇒ 标签静默消失** | ❌ 打包环境本机造不出 | 运行期探针（§3.5）+ 退化路径 |
| 4 | **前后端「主观题」口径分叉**（§2.1） | ✅ 对拍用例能守 | `analysis-gate-parity.test.ts` |
| 5 | 重渲 40 幅画的耗时 | ⚠️ 能测时间，测不了「够不够快」 | 按需渲染 + 结果不落盘 |
| 6 | 教师把「12/40 人的情况」读成「全班的情况」 | ❌ 界面的事 | `covered/total` 显眼（§3.6 纪律 1） |
| 7 | `mixed` 场景下笔迹条目在文本载荷里消失 | ✅ 纯函数能测 | `payloadKindOf` 返回 `'mixed'`（§3.3） |

**本版零外发** ⇒ 隐私面**没有变化**。但 §3.7 那道唯一外发点是为将来准备的，
它接上 AI 的那一天，发出去的就是**学生的作业内容**（含笔迹图像）——
那是一次**新的数据外发类别**，届时需要单独征求同意（与聊天不同：作业是被批改的材料）。

---

## 六、验收

### 6.1 本机能做的（`node --test`）

- `isAnalyzableType`：只放 `{short-answer, drawing}`；**且与前端 `graded: false` 的集合相等**（遍历全部题型）
- `selectAnalyzeEntries`：只收 `status === 'submitted'`；按 `studentId` 确定性排序；空答案不入
- `payloadKindOf`：全文字 ⇒ `text` · 全笔迹 ⇒ `image` · 混杂 ⇒ `mixed`（**这条要有真夹具**，
  夹具必须能让「按题型决定」那种错实现红 —— 见 §2.4）
- `buildTextDocument`：N 段、顺序稳定、伪名由入参给定（不由本函数生成）
- `layoutSheets`：格子数、行列、每格坐标、分张数（40 人 / 12 格 ⇒ 4 张）
- `analysis-render.ts`：产物是**真 PNG**（magic number）、尺寸在探针约束内、渲染不出回 `null` **不抛**
- 🔴 **反证**：每条判据都要有一个**会红**的输入（本项目在 M6b 刚栽过「反证夹具区分不开两种口径」）

### 6.2 真机（**本机一条都验不了，已填 0**）

- [ ] **未验证** —— 联系表上**每格的标签看得清**、格子里的画看得清
- [ ] **未验证** —— 一份 40 人 × 12 格的载荷，打开时**不卡**
- [ ] **未验证** —— 那份聚合文档**教师读起来顺**（伪名 + 答案分段）
- [ ] **未验证** —— 「已交 12/40」在分组模式下写的是「**组**」而不是「人」
- [ ] **未验证** —— 「发给 AI 分析」按钮**明确写着未接入**，教师不会以为它坏了
- [ ] **未验证** —— 打包后的应用里**标签真的画出来了**（探针没有退化）

### 6.3 顺带要改的（**与本设计同批**）

里程碑总表 `specs/2026-09-23-milestones.md` 已严重过期（写「M3 🔄 进行中 · M4/M5/M6 ⬜ 待做」，
而 M4/M5/M6 都已完成）。另外它把「逐题投放」写进了 M5 的描述，而**它从来没被实现**（§2.7）。
⇒ 一并更正，并把 M7 标成进行中、注明每一项的**验收状态**（已完成 / 已做但真机未验）。
这份文件自称「唯一的编号来源」，它错着的话下一个人会拿它当依据。

---

## 七、复核裁定（用户 2026-09-25）

三条都已裁定。**裁定即实现要求**，写实现计划时按它们写，不要再当成开放问题。

### 裁定 1 · 只存结构化 `aggregate`、图按需重渲 —— **认可**

⇒ §3.1 决定 1 照写。**不存渲染好的 PNG。**
**如果这条错了，代价是**：每次打开载荷要重渲 N 幅画，40 人可能明显卡；
那时再加一层缓存（按 `computedAt` + 旋钮值做键），**不改数据结构** —— 所以这个方向是**可逆**的。
反过来（存了 PNG 再想改成不存）要清库，那才不可逆。这也是选它的理由之一。

### 裁定 2 · 载荷预览用**独立浮层** —— **独立浮层**

⇒ §3.6 按「独立浮层」写：层级在 `matrix-overlay`（250）**之上**、学习单抽屉（290/291）**之下**。
建议取 **270**，给以后可能的插队留出 250–270 与 270–290 两段。
⚠️ **实现时必须保住那条不变量**：「非前台层的浮层不得浮在上面」（`layer-overlays.tsx`）——
不过那是**学生端外壳**的机制，本浮层在教师端，**不该复用它**，要按教师端既有浮层（`matrix-overlay`）的写法来。
**如果这条错了，代价是**：浮层与抽屉打架时看得出来（视觉问题，真机能发现），不是静默失效。

### 裁定 3 · 三个默认值`320×240 / 3 列 / 12 格`**先按推测试** —— **照此实现**

⇒ §3.4 的默认值就是这三个数。
⚠️ **这是全设计里唯一一条我自己标注「我猜不出正确答案」的地方**，用户已知情并选择先试。
**它必然要调**（用真模型试几轮），所以：
- 三个数**必须从设置读**（有默认值），**不许硬编在渲染函数里**
- 调参**不该改代码** —— 这是「先留接口」的验收标准之一
- **如果这条错了，代价是**：联系表上的画模型看不清 ⇒ 分析质量差。
  那时**只改配置**即可，不改结构、不改 UI。
