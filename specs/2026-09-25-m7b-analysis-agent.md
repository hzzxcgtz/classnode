# M7b · 分析型智能体（把 M7a 那道缝接活）· 设计规格

> 日期：2026-09-25 · 分支 `main`（M7a 已并入，HEAD `0509e33`）· 状态：**已复核**（用户 2026-09-25 裁定，见 §七）
> 权威依据：`specs/2026-09-19-classnode-learning-suite-design.md`
> §15.1（分析型智能体：扩展现有 `Agent` 加 `purpose`，**不新建模型**）·
> §15.2（智能体分析学生作答：本案只做「**分析**」那一半）·
> §6.3（识别/分析结果写**独立字段**、**永不覆盖原始数据**）
> 前置：M7a 的规格 `specs/2026-09-25-m7a-analysis-payload.md`（**那道缝就是为这里建的**）
> 里程碑：`specs/2026-09-23-milestones.md`（M7b = 原 P4 的其余部分）
> ⚠️ 本文件里每一个 `file:line` 都是**写这份文件时实跑取证过的**（本仓行号会漂；动手前请自己再 grep 一遍）。
> ⚠️ 本仓的 `grep` 是转发给 ugrep 的 wrapper ⇒ 下面一律用 `/usr/bin/grep`。

---

## 一、范围与依据

### 1.1 用户在 2026-09-25 的四条裁定

| # | 裁定 | 落点 |
|---|---|---|
| 1 | 做**输出侧**（§15.2 的「分析」那一半） | §3 —— 不做单份笔迹识别（`recognized` 仍留空） |
| 2 | **语音输入去掉** | §四 非目标（⚠️ **只在轮内去掉**；路线图上仍留着，见 §6.3） |
| 3 | 每次发前**预览 + 确认** | §3.4 |
| 4 | 分析型智能体**在学习单里指定** | §3.2 |

**裁定 1 之上还有一次更重的知情同意**：这是本项目**第一次把学生的作业内容发出去**。
M7a 的规格 §五 逐字写着「它接上 AI 的那一天，发出去的就是学生的作业内容（含笔迹图像）——
那是一次**新的数据外发类别**，届时需要单独征求同意」。用户读过那一行之后选定本方向
（两个选项的描述里都写着「🔴 跨越隐私红线，需要你明确同意」）⇒ **本规格的全部设计都服从那条红线的约束**。

### 1.2 本版建什么

1. `Agent.purpose`（`'tutoring' | 'analysis'`）+ **学生端只呈现 `tutoring`**（§3.1）
2. `Worksheet.settings.analysisAgentId`（学习单级指定，§3.2）
3. **外发那一次调用**（`ai-proxy.ts` 里新增的一个导出函数，§3.3）
4. `analysis-agent.ts` —— 编排层：载荷 → 消息 → 调用 → 结果处理（§3.3）
5. 预览 + 确认（§3.4）与解读写回 `narrative` / `agentId` / `model`（§3.5）

### 1.3 本版**不**建什么

- **语音输入**（§15.3。用户 2026-09-25 裁定「不做了，去掉」）
- **单份笔迹识别（HTR）** —— `WorksheetAnswer.value` 里那个 `recognized` 字段**仍然留空**。
  它是「把某一个学生的笔迹转成文字」，与本案的「按题的班级分析」**不是同一个对象**
  （M7a 的规格 §3.1 决定 4 已经把它们分开过）
- **按人的建议**（`perStudent` 仍留空）
- **材料题组 / 逐题投放**（本轮无关）

---

## 二、事实基线（**全部实跑过**）

### 2.1 🔴 四个平台里**只有 `coze` 收得了图**

```
$ /usr/bin/grep -n "有附件时提示不支持" server/src/services/ai-proxy.ts
499:  // 有附件时提示不支持（stream_run 自定义接口无统一上传标准）
$ /usr/bin/grep -n "文心 API 暂不支持图片" server/src/services/ai-proxy.ts
1039:    // 文心 API 暂不支持图片/文件识别，有附件时追加文字说明
$ /usr/bin/grep -rn "image_url" server/src/services/
server/src/services/zhipuai/types.ts:57:  image?: Array<{ image_url: string }>;
（只此一处 —— 类型里有，全仓没有一处填它）
```

| 平台 | 收图 | 依据 |
|---|---|---|
| `coze` | ✅ | `proxyCoze`（`:201`）走 `CozeMultimodalItem`（`:86`）+ `uploadFileToCoze`（`:185`） |
| `coze-agent` | ❌ | `:499` 逐字「有附件时提示不支持（stream_run 自定义接口无统一上传标准）」 |
| `wenxin` | ❌ | `:1039` 逐字「暂不支持图片/文件识别」 |
| `zhipuai` | ❌ | 类型有位置、**实现没有** |

⇒ **联系表（绘图题的全部内容）只有 `coze` 发得出去。** 这是本设计里最硬的一条约束（§3.3 的闸门）。

### 2.2 🔴 既有的图片通道**接不了内存里的 Buffer**

```
$ /usr/bin/grep -n "function resolveLocalPath" -A6 server/src/services/ai-proxy.ts
455:export function resolveLocalPath(fileUrl: string): string {
456:  if (!fileUrl.startsWith('/uploads/')) {
457:    throw new Error('仅允许读取应用上传目录中的文件');
```

`proxyAIRequest(agent, message, studentName, history?, fileUrls?: string[])`（`:112`）收的是
**URL 数组**，每个都过 `uploadFileToCoze` → `resolveLocalPath` ⇒ **必须是 `/uploads/` 下的文件**。

而 M7a 的联系表是**按需渲染的内存 Buffer**（规格 §3.1 决定 1）。⇒ 两条路：

- ❌ 落盘到 `/uploads/` 再传 —— `/uploads` 是 **`express.static` 公开目录**
  （`server/src/index.ts:97`）⇒ 全班的画会变成一个**能被 URL 取到**的地址
- ✅ **`coze-bot/file.ts:74` 有 `uploadBuffer(buffer, fileName)`** —— 直接传 Buffer，**一个字节都不落盘**

### 2.3 🔴 `proxyAIRequest` 会过 anonymizer，而这里**不该过**

```
$ /usr/bin/grep -n "anonName = anonymizer.anonymize" server/src/services/ai-proxy.ts
119:  const anonName = anonymizer.anonymize(studentName);
```

它的第三个参数是 `studentName`，进来第一件事就是换伪名。而**分析是班级级的、没有「那个学生」**
—— 传一个假名字的后果有两个，都不轻：
1. 往匿名映射表里塞一条**不是学生**的记录（M7a 规格 §3.1 决定 2 记过这个风险：
   `MAX_ENTRIES = 500`，塞满会**重置**，而重置会换掉**正在进行的一段聊天**里同一个学生的伪名）；
2. 而它是**多余的** —— M7a 的载荷**已经是伪名**了（`User_001`…，`payloadLabels`）。

⇒ 分析这条路**不经过 anonymizer**（§3.3）。

### 2.4 分析型智能体会漏进学生的学伴列表

```
$ /usr/bin/grep -n "enabled: ca.agent.enabled" server/src/routes/classroom.ts
1090:        enabled: ca.agent.enabled,
```

学生端的智能体列表来自 `ClassroomAgent`（服务端只读 `agent.enabled`），而教师端
课堂/组级的智能体选择器今天列的是**全部**智能体（`purpose` 这个字段还不存在）。
⇒ 加了分析型智能体之后，教师可以把它选成学伴，**它就会出现在学生的学伴列表里**——
一个「会收到全班作业」的 bot 出现在小学生的聊天列表里。

这正是 §15.1 那条配套调整的理由（「学生端 `ClassroomAgent` 只关联 `purpose = 'tutoring'` 的智能体」）。
⇒ **`purpose` 不是可选项，是一门闸**。

### 2.5 学习单设置的形状与写入口

```
$ /usr/bin/grep -n "export interface WorksheetSettings" src/lib/types.ts
318:export interface WorksheetSettings {
319:  allowResubmit: boolean;
320:  autoGrade: boolean;
321:  defaultInputMode: 'keyboard' | 'handwriting';
327:  rewardStyle: RewardStyle;
329:  rewardStep: number;
336:  halfStep: number;
```

- 类型注释（`types.ts:311`）：「设置。六件都**由服务端 `normalizeSettings` 补齐**」
- 写入口：`routes/worksheets.ts:544`（创建）与 `:584`（更新），两处都是 `normalizeSettings(body.settings)`

⇒ 新字段要同时进**这三处**（类型 · `normalizeSettings` · 编辑器 UI），否则会「存进去又读不出来」
或「读出来是 `undefined`」—— 而两者都不报错。

### 2.6 M7a 留下的三个空格，正好是本案要填的

```
$ /usr/bin/grep -n "narrative\|agentId\|model" server/prisma/schema.prisma | /usr/bin/grep -i 'analysis\|narrative\|agentId'
（WorksheetQuestionAnalysis 的 narrative / perStudent / agentId / model 四格，M7a 起恒为 null）
```

M7a 的规格 §1.1 裁定 1 把「接口留出来」落在**这四格恒为 `null`** 上。
⇒ 本案填其中**三格**（`narrative` / `agentId` / `model`），`perStudent` 仍留空（按人的建议不在本轮）。
**一行 DDL 都不用改** —— 这正是 M7a 那样设计的回报。

### 2.7 玩家已有的语音输入在老 iPad 上很可能是坏的（记一笔，与本轮无关）

```
$ /usr/bin/grep -n "SpeechRecognition\|请使用 Safari" src/app/classroom/chat/use-voice-input.ts
26:    setVoiceInputAvailable(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
49:      optionsRef.current.setToast({ msg: '当前浏览器不支持语音输入，请使用 Safari 或系统键盘听写', type: 'info' });
```

用的是 **Web Speech**，而它的兜底提示告诉学生「请使用 Safari」—— 学生用的**就是** Safari，
且设计文档 §655 把「iPad Safari 上 Web Speech 不可用」列为已知老问题。
⇒ 那条提示在目标设备上**自相矛盾**。**本轮不修**（语音已去掉），但记在这里，免得下次有人以为它好好的。

---

## 三、设计

### 3.1 `Agent.purpose`（一门闸，不是一个标签）

- `Agent.purpose: String @default("tutoring")`，取值域 `'tutoring' | 'analysis'`
- **学生端只呈现 `tutoring`**：课堂/组级的智能体选择器与学生端的查询都要过滤
- 教师端智能体管理页加一个「用途」选择（§15.1：管理页按 `purpose` 分组或加筛选）

⚠️ **过滤有两处，少一处就漏**：① 选择器列出的候选（教师端）② 学生端读到的列表。
第 ② 处是承重的那个 —— 漏了它，一个分析型 bot 会出现在小学生的聊天列表里。
（今天的实现里 ② 只读 `agent.enabled`，见 §2.4。）

### 3.2 `Worksheet.settings.analysisAgentId`（学习单级，按用户裁定 4）

```ts
// src/lib/types.ts 的 WorksheetSettings
/** ★ M7b：这道题的分析用哪个智能体。`null`/缺省 = 没指定（分析按钮禁用）。 */
analysisAgentId: string | null;
```

- `normalizeSettings`（`routes/worksheets.ts`）认它：非字符串或空串 ⇒ `null`
- 编辑器加一个下拉（候选 = `purpose === 'analysis'` 的智能体）
- **为什么放学习单级而不是全局**：提示词写在平台上的那个 bot 里，而**一份数学单与一份语文作文单
  该用不同的提示词** ⇒ 「用哪个分析 bot」天然是**学习单的属性**，不是全局偏好。

### 3.3 外发那一次调用（**全仓唯一一处**）

**分两个文件，边界是「谁拥有网络」：**

| 文件 | 职责 | 碰网络 |
|---|---|---|
| `server/src/services/ai-proxy.ts`（**改**） | 新增一个导出：`proxyAnalysisRequest(agent, message, images: Buffer[])` | ✅ **唯一** |
| `server/src/services/analysis-agent.ts`（**新**） | 编排：载荷 → 消息文本 → 调上面那个 → 结果处理 | ❌ |

**为什么不把平台适配复制一份到新文件**：§15.1 逐字写着「新建独立模型意味着把这套适配代码复制一遍」——
那是对 `Agent` 说的，同一条理由对「新建一套平台调用」也成立。⇒ 复用 `ai-proxy.ts` 的平台分支。

**`proxyAnalysisRequest` 与 `proxyAIRequest` 的三处不同（少一处都会出问题）：**

1. **不过 anonymizer**（§2.3）—— 载荷已经是伪名，且这里没有「那个学生」
2. **收 `images: Buffer[]`** 而不是 `fileUrls: string[]` —— 走 `uploadBuffer`，**不落盘**（§2.2）
3. **平台闸门**：有图而平台不是 `coze` ⇒ 立刻回 `{ success: false, error: '…' }`，
   **不发出去**（§3.4 的预览会在发之前就拦下，这里是第二道）

**结果处理**（`analysis-agent.ts`，纯函数部分可测）：

```ts
export const NARRATIVE_MAX = 4000;              // 与 M7a 的 ANSWER_TEXT_MAX 同一条纪律
export function normalizeNarrative(raw: string): string   // 去首尾空白 · 超长截断并标注 · 空串 → ''
```

### 3.4 闸门与流程（用户裁定 3）

```
点「发给 AI 分析」
  └→ 预览（**前端用载荷里已有的字段拼，不需要新端点**）
       · 发给：<智能体名>（<平台>）
       · 本次内容：一份聚合文档 / N 张联系表（3 列 × 4 行）
       · 已交 12/40 人        ← 复用 M7a 的 covered/total，单位走 moduleCountUnit(mode)
       · 以上均为伪名（User_001…），不含学生真实姓名
       · ⚠️ **第三方平台会留存这次对话**（如实说；见 §五 第 9 条）
       · ⚠️ 平台收不了图 ⇒ 确认按钮**禁用** + 说明为什么
  └→ 确认 → POST → 写回 narrative / agentId / model → 浮层显示解读
```

**预览为什么不报「多少字节」**：联系表是**按需渲染**的（M7a 决定 1），前端只知道**有几张、多大**。
⇒ 预览如实说**形态与张数，不说字节数**（要报字节就得先渲一遍 —— 为一句提示多渲 N 张图不划算）。

**三条判据都是纯函数**（放 `analysis-agent.ts`，可被 `node --test` 跑）：
- `analysisGateOf(payloadKind, platform): { ok: true } | { ok: false; reason: string }`
- `analysisPreviewLines(payload, agentName, platform, mode): string[]`（预览那几行）
- `normalizeNarrative(raw)`

### 3.5 结果写回

`POST /:id/analysis/:questionId/run?classroomId=…`（**教师端**，与 M7a 三条同段）：

```
读已存的载荷（M7a 的 aggregate）
  → parseAggregate → entries → buildAnalysisPayload（复用 M7a 的纯函数）
  → 组消息文本（文档 / 联系表的图）
  → proxyAnalysisRequest(agent, message, images)
  → normalizeNarrative
  → upsert：narrative / agentId / model / computedAt 不变
```

⚠️ **只写这四格里的三格**：`narrative` / `agentId` / `model`。
`aggregate` / `totalCount` / `computedAt` **一个都不动** —— 它们是「这份载荷是什么时候、按什么算的」，
与「AI 怎么解读它」是两件事。**在「重新生成」与「重新分析」之间，各自动自己那一半。**

### 3.6 失败与降级

| 情形 | 行为 |
|---|---|
| 平台收不了图 | **发之前**就拦（§3.4 预览禁用按钮）；`proxyAnalysisRequest` 是第二道 |
| 超时 / HTTP 错 | **不写库**，界面显示错误，**保留已有的解读**（不清空） |
| 模型返回空 / 只有空白 | 同上（`normalizeNarrative` 回 `''` ⇒ 不写） |
| 模型返回超长 | 截断并标注（同 M7a 的 `ANSWER_TEXT_MAX` 纪律） |
| 再点一次 | 按钮叫「重新分析」；**成功了才覆盖**（教师主动点的，覆盖是对的） |

### 3.7 提示词不由我们写

学习单指定的那个 bot 自己在平台上有提示词（§15.1 的模型：`Agent` 复用平台适配）。
**我们只发载荷 + 一句固定的引导语**。

**固定引导语**（进代码，很短，就一句）：`请分析下面这份全班作答，指出典型错误与共同困难。`
（它只是把模型的注意力引到「分析」这件事上；具体要什么口径由教师自己的提示词决定。）

**建议的提示词**（**给教师抄到平台上，不进代码**；用户 2026-09-25 裁定写进规格）：

> 你是一位帮助教师复盘的助教。下面是同一个班在**同一道题**上的作答汇总，
> 由系统按学生编号（`User_001` 这样的代号）拼成，**不含学生真实姓名**。
>
> 请分三段回答：
> 1. **整体情况**：这道题答得怎么样？用一句话说清。
> 2. **典型错误或典型思路**：把作答归成 2–4 类，每类说清「哪几号学生属于这一类」与「他们共同的做法/错法」。
> 3. **给教师的建议**：下一步讲评时最值得花时间讲哪一点？为什么？
>
> 注意：**不要编造汇总里没有的内容**；如果作答太少（比如只有一两份）不足以看出规律，就直接说「样本太少，看不出规律」。
> 只输出这三段，不要复述我的问题。

---

## 四、非目标

- **语音输入**（用户 2026-09-25 裁定；见 §6.3 —— 只在轮内去掉）
- **单份笔迹识别（HTR）** —— `recognized` 仍留空
- **按人的建议** —— `perStudent` 仍留空
- 材料题组 · 逐题投放 · 分层教学的其余部分
- **不把解读导出进 Word 报告**（M6a 的那份）—— 可以做，但不在本轮（多一处要跟着改的渲染）

---

## 五、代价与风险（如实记）

| # | 风险 | 本机能验吗 | 缓解 |
|---|---|---|---|
| 1 | 🔴 **这是第一次把学生作业发出去** | ❌ 只能是流程与闸门层面的 | 单一外发点 · 每次预览确认 · 伪名 · **不落盘** |
| 2 | 真模型返回的解读**质量** | ❌ **本机没有可调用的平台/密钥** | 提示词留给教师（§3.7）；规格附建议文本 |
| 3 | 截图/联系表里**仍可能有可识别信息**（学生的字迹本身） | ❌ | 伪名只解决「名字」；**这一条要在真机验收时由教师判断**（写进验收清单） |
| 4 | 预览确认的手感（多一步会不会太烦） | ❌ | 真机验（验收清单） |
| 5 | 只支持 `coze` 发图 ⇒ 教师配了文心/智谱时**绘图题用不了** | ✅ 闸门可测 | 预览里**明说**（不是静默失败） |
| 6 | 往匿名映射表里塞非学生记录 | ✅ 可测（不进 anonymizer） | §2.3；用例钉住「这条路一次都不调 anonymizer」 |
| 7 | 分析型 bot 漏进学生列表 | ✅ 可测（服务端查询） | §3.1；用例钉住「学生端读不到 analysis 类」 |
| 8 | 解读覆盖了「这份载荷是什么时候算的」 | ✅ 可测 | §3.5：两组字段各自动自己那一半 |
| 9 | 🔴 **第三方平台会留存这次对话**（`coze-bot/index.ts:122` 硬编 `auto_save_history: true`） | ❌ | **本章刻意不动它** —— 见下 |

**关于第 9 条（写下来比悄悄放过好）**：`coze.chat()` 构造请求时写死了
`auto_save_history: true`（`coze-bot/index.ts:122`），而紧接着的
`chats.getMessages(conversation_id, chat.id)`（`:133`）正是**靠那份历史取回回复**的。
⇒ 把那个开关关掉有可能让分析**返回空**，而本机没有平台/密钥，**验不了**。
**本版不动它**（不动一个承重开关、去换一个验不了的隐私收益），但如实记在这里：
**发出去的那份全班作业，在平台侧是有留存的。** 教师的那一屏预览里应当能看出这一点
（§3.4 的预览行里加一条：『第三方平台会留存这次对话』）。

---

## 六、验收

### 6.1 本机能做的（`node --test`）

- `analysisGateOf`：`coze` + 图 ⇒ ok；`wenxin`/`zhipuai`/`coze-agent` + 图 ⇒ **不 ok 且说明为什么**；纯文档 ⇒ 任何平台都 ok
- `analysisPreviewLines`：抬头那几行逐字（含「已交 N/M」与「均为伪名」）
- `normalizeNarrative`：空白 ⇒ `''`（⇒ 不写库）；超长 ⇒ 截断且标注；正常 ⇒ 去首尾空白
- **端点接线**：`run` 写 `narrative`/`agentId`/`model`，**不动** `aggregate`/`totalCount`/`computedAt`
- 🔴 **失败不写库**：打桩一个失败的平台 ⇒ `narrative` 保持原值（**不被清空**）
- 🔴 **一次都不调 anonymizer**：走一遍 `run` ⇒ `anonymizer.size` 不变
- 🔴 **学生端读不到 analysis 类**（§2.4 的那门闸）
- `normalizeSettings` 认 `analysisAgentId`：非字符串/空串 ⇒ `null`

### 6.2 真机（**本机一条都验不了，已填 0**）

- [ ] **未验证** —— 联系表里**学生的字迹本身**是否构成可识别信息（伪名只解决名字）—— **这一条要你判断**
- [ ] **未验证** —— 预览那一屏读起来清不清楚（教师是否真的知道「发出去的是什么」）
- [ ] **未验证** —— 真模型对一张 12 格联系表的解读**有没有用**（这是整个功能的价值所在）
- [ ] **未验证** —— 分析型 bot **没有**出现在学生的学伴列表里
- [ ] **未验证** —— 配了文心/智谱的课上，绘图题的分析按钮**明说平台收不了图**

### 6.3 顺带要改的

- 里程碑总表：M7b 从「未排期」改成「进行中」，并**注明语音被去掉**（只在轮内；路线图上仍留着，
  等用户明确要不要从 §15.3 与 M7b+ 行里划掉 —— 改设计文档是不可逆的那一侧）

---

## 七、复核裁定（用户 2026-09-25，「没有不同意的」= 四条全按提案）

1. **§3.1 的闸 —— 认可，两个过滤点都要。**
   ⚠️ 写计划时把「两处」找**全**了，实测**至少两处**（都不止一处是一处的同类风险）：
   `server/src/routes/classroom.ts:1085`（HTTP 首屏）与 **`server/src/socket/index.ts:1151`**
   （`join-classroom` 的 `joined` 载荷）。后者那里的注释逐字写着「学生端拿到的组材料必须与
   `GET /code/:code` **逐字一致**」—— 这正是「不能只改一处」的代码级理由。
   ⇒ 实施要求：抽一个**共用**的过滤助手，两处都走它；并有一条用例钉住「两处都不含 analysis 类」。
2. **§3.4 预览不报字节数 —— 认可。** 如实说形态与张数（「一份聚合文档」/「4 张联系表，
   3 列 × 4 行」）。**要报字节就得先渲一遍 N 张图**，为一句提示付那个代价不划算。
3. **§3.5 的分工 —— 认可。** 两组字段各自动自己那一半：
   「重新生成」动 `aggregate`/`totalCount`/`computedAt`；「重新分析」动 `narrative`/`agentId`/`model`。
   ⇒ 这是**两条独立的路**，`run` 端点**一个 `aggregate` 字段都不许碰**（用例钉住）。
   好处：教师只想重发一次时，不会连带把「这份载荷是什么时候、按什么算的」也改掉。
4. **§3.7 建议的提示词 —— 写进规格**（见 §3.7 末新增的那一段）。**不进代码**：
   它在平台上那个 bot 里，我们只给教师一段可以抄的文本。
