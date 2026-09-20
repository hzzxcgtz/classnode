# M1b-3：顶栏承载共用操作，学伴面板头整行撤除 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学生端顶部**只剩一行导航栏**。学伴面板自己的那一整行头部（智能体头像+名、课堂名、互动码、右侧操作簇）撤除；其中的操作**上移进顶栏**，成为首页/学习单/探究助手/智能学伴**四个 tab 共用**的功能。

**Architecture:** 顶栏（`ModuleTabBar`）从「只有 tab」扩成「tab + 操作组」。两处**状态归属搬家**：换头像与教师消息下拉从面板/首页收进外壳一处（外壳本来就是这两个数据的持有者）。学伴面板退回纯粹的内容区。

**Tech Stack:** Next.js 15 静态导出 + React 18 + TypeScript strict + CSS Modules；Safari 15（老 iPad）为硬约束。

**Spec:** `specs/2026-09-19-classnode-learning-suite-design.md`（§4.1 结构、§4.2 首页、§4.3 模块契约、§4.5 挂载、§4.6 动画、§4.7 Safari、§4.10/§4.11 前置项）

---

## 🔴 Step 0：分支

分支 `feat/m1b3-topbar-actions` 已从 `feat/m1b2-student-shell` 的 `0da2417` 创建（**M1b-2 尚未合并**，所以 M1b-3 必然带着它）。

```bash
git branch --show-current   # 必须是 feat/m1b3-topbar-actions
```

**用户的明确要求**：中途不找用户确认合并；全部完成后才汇报，同意后才合并。

---

## Global Constraints

1. **这是新功能**（改行为），但既有 `workspace test` **63 项必须继续全过**。
2. **不得出现 regex lookbehind**（构建期检查会 fail）。
3. **不得使用 Safari 15 不支持的语法**：`:has()`、`content-visibility`、`@container`、`Object.hasOwn`、`structuredClone`、`Array.prototype.at`/`findLast`、`dvh`、`:focus-visible`。
4. **动画只用 `transform` / `opacity`**，并遵循 `prefers-reduced-motion`。
5. 提交信息中文，格式 `<type>(classroom): <做了什么>`。
6. **不碰** `CLAUDE.md` / `dev.sh` / `package.json`（工作区里是用户自己的未提交改动）。
7. **只允许一个 `pnpm build` / `pnpm test` 在跑。**
8. **实施者必须用 `grep` 自行枚举依赖，不得信任任何清单（含本计划）。** 该条已生效过五次。

### 基线

```bash
npx tsc --noEmit                              # 退出 0、零输出
npx eslint src/app/classroom/ src/lib/        # 退出 0、恰好 1 条 tokenData warning
pnpm build                                    # 退出 0 + Safari 检查通过
cd server && pnpm test                        # 63 pass / 0 fail
```

---

## Rulings（控制器已裁定）

**Ruling 1：换头像的入口改为顶栏的学生头像本身。**
用户钦定「面板头整行撤除」+「首页瘦身，入口交给顶栏」，而换头像**今天只有两个入口**——首页（`student-home.tsx:187` 头像、`:209` 按钮）与学伴面板头部（`chat-panel.tsx:725` 头像+机会角标）。两个都删就**没有任何入口**了。所以顶栏那个头像必须可点，并保留「机会由老师奖励」的提示路径。
**若判断有误的代价**：学生无法换头像，属功能消失。

**Ruling 2：教师消息下拉搬进外壳后必须 portal。**
`.bar`（`shell.module.css:48-49`）是 `overflow-x: auto; overflow-y: hidden` —— 下拉直接放进栏里会被**纵向裁掉**。外壳已有 `useOverlayPortal(active)`（`layer-overlays.tsx`），与 M1b-2 Task 2 修五个浮层是同一手法。
**若判断有误的代价**：下拉不可见或被裁一半。

**Ruling 3：顶栏操作**图标化**，但触控目标不缩。**
用户选定「操作收成图标」。每个操作 `min-width/min-height: 36px`（与 tab 同高），并保留 `aria-label` + `title` —— 图标化**只减视觉宽度，不减无障碍信息**。
**若判断有误的代价**：老 iPad 上点不中；读屏用户丢失按钮含义。

**Ruling 4（⚠️ 已被 Ruling 9 取代 —— 保留原文以存档当时的推理）**：本次不做「操作钉死在右侧」。
用户在上一个问题的三个选项里选了「图标化」，**没有选**「tab 组滚动、操作固定右侧」。按估算图标化后 768px 够用（约 590px），但**手机宽度（400px）仍会横向滚动**。

**Ruling 9（在 Ruling 4 之后作出，取代它）：第一行的宽度压力被拆行 + 去信息解开，Ruling 4 的残留预期消失。**
用户先定「顶栏拆成两行、第二行只放居中的 tab、切换/退出恢复文字」，再定「**班级名与互动码两个都不要**」。控制器按 CSS 声明值重算第一行：

| 方案 | 第一行估算 | 400px 手机 |
|---|---|---|
| 班级名 + 互动码 都放 | ~554px | 横向滚动 |
| **两个都不要（已选定）** | **~382px** | **几乎放得下** |

⇒ 第一行只剩 `首页 · ●连接 · 头像姓名 · 切换 · 退出` 五项。**Ruling 4 那条「手机宽度仍会滚」的残留预期随之消失。**
**但这是估算，不是实测** —— T5 **必须实测 400px**：若 `scrollWidth === clientWidth`，则在验收清单里把那条残留**标记为已解决**；若仍溢出，如实记为残留。T1 的教训（估 608 / 实测 610）说明估算可信但**不能当验证**。
**若判断有误的代价**：手机宽度下仍要滑动才够得到「退出」。

**⚠️ 用户已确认这条的产品代价**：班级名与互动码从学生端**完全消失** ⇒ **学生在应用里看不到自己在哪堂课**（二维码/链接里仍带着互动码，但那是进课堂之前的事）。控制器已把这一点明确告知用户，用户选择接受。

**Ruling 5：`teacherNotifBubble` 不动。**
它是教师消息到达时的**瞬时气泡**，现在也只长在学伴面板里（`chat-panel.tsx:1012`）——即学生不在学伴 tab 时看不到它。这是**既有行为**，与本次要改的「那一行头部」无关。**不扩大改动面。**
**若判断有误的代价**：学生在别的 tab 时错过一次瞬时提示（本来就如此）。

---

## 派发前冲突扫描的裁定（控制器已逐对核对，实施者按此执行）

扫描覆盖：**每一对共享文件或接口的任务**，以及**每个任务自身文本是否自洽**。

### Ruling 6：T4 **不得信任** `691-795` 这组行号

T2 与 T3 都会**在 `topBar` 块内部改东西**（T2 摘掉头像的 `onClick` 与机会角标、T3 摘掉消息按钮），所以块的行号会漂。
⇒ **T4 必须自己重新求块的边界**（`grep` 定位 `{/* === 顶部栏 === */}` 与 `styles.topBar`，再做括号配对），**绝不照抄本计划里的 691-795**。
⇒ 反过来，**T2/T3 允许在块内做最小编辑**（不必等 T4）——每个 commit 都必须能编译，这是硬要求。
**若判断有误的代价**：删错范围，可能连带删掉正文或留下半截 JSX。

### Ruling 7：首页的「换头像」归 **T2**，「退出课堂」归 **T5**

两者都想动 `student-home.tsx`，而换头像入口在 `:187` 与 `:209`、退出课堂在 `:177`——**都在同一块 `.headerActions` 里**，两个任务各删一半必然互踩。
⇒ **T2 独占「换头像」两处的删除**（连同首页的 `showAvatarChanger` 状态与模态渲染）；**T5 只删「退出课堂」那一处**（`:177`），且**动手前必须重新 `grep`** 确认还剩什么。
**若判断有误的代价**：重复删除同一段 → 补丁冲突或误删。

### Ruling 8：T2 与 T3 各自在**外壳**里加 portal，不得互相覆盖

预检确认：**外壳目前完全没有用过 `useOverlayPortal`**（`classroom-shell.tsx` 里零命中），所以 T2 是**第一个**在外壳里引入它的任务。
⇒ 两者**各加各的调用**（两个独立的 portal 包装），谁也不要去「复用」或「合并」对方那一个 —— 它们的 `active` 语义可能不同（见 T2 的「实施者须判断」）。
⇒ T3 动手时应先确认 T2 的 portal 已存在且完好，**不要顺手重构**。
**若判断有误的代价**：一个 portal 的可见性被另一个的 `active` 决定，浮层在错误的时机显隐。

### 预检确认的两条事实（省实施者一次 `grep`）

- 外壳**已经**持有 `avatarSvgs`（`use-classroom-session.ts:42`）与 `avatarTokenCount`（`:43`），并在 `:514-515` 导出 —— T1 渲染学生头像、T2 传 `avatarTokenCount` 都**不需要新增状态**。
- `chat-panel.tsx` 的 `topBar` 块当前是 `691-795`（105 行），但见 Ruling 6。

---

## Task 1: 顶栏加上操作组（图标化）—— 先接已经在外壳的四项

**Files:** Modify `src/app/classroom/shell/module-tab-bar.tsx`、`src/app/classroom/shell/shell.module.css`、`src/app/classroom/shell/classroom-shell.tsx`

顶栏右侧新增操作组，**本任务只接已经在外壳里的四项**：连接状态点、学生头像+姓名、切换身份、退出课堂。

- `connected`、`selectedStudent`、`handleSwitchIdentity`、`handleExit` **全部已在外壳**（`use-classroom-session.ts`），无需搬家。
- 连接点：`已连接` = 绿点；`连接断开` = 红点。`title` / `aria-label` 用原本文案（`已连接` / `连接断开`），**颜色不能是唯一信息载体**。
- 学生头像：圆形，`selectedStudent` 有 `avatarId` 且 `avatarSvgs` 里有就渲染 `SvgAvatar`，否则用姓名首字（**照抄面板里的降级写法**，见 `chat-panel.tsx` 的 `studentBadgeAvatar`）。
- 姓名：**窄屏隐藏**（用媒体查询），头像本身保留。
- 切换 / 退出：内联 SVG 图标 + `aria-label` + `title`。

**每个操作 `min-width/min-height: 36px`**（Ruling 3）。

- [ ] **Step 1-2: 实现 + 门禁；Step 3: 提交**

---

## T1 审查的遗留项（**由 T2 一并收口**，控制器已裁定）

T1 审查结论 **Approved with fixes**（0 Critical / 1 Important / 4 Minor），实测确认：768px 下栏内容宽 **610px**、余量 **158px**、零溢出（实施者估 608，误差 2px）；指示器滑块 ΔX/ΔW 全为 0、`offsetParent` 未变（最大回归风险**不存在**）；Ruling 3 的无障碍逐条达标（含杀掉后端验证连接点 0.7s 内翻文案）；范围纪律干净。

### C1（Important，**必修**）：641~703px 区间长姓名会把操作推出视野

`.studentChip` 的 `max-width: 180px` 只把损害**封顶在 704px**，并不能阻止溢出。实测「需要的最小栏宽 = 524 + chip 宽」：

| 姓名长度 | chip 宽 | 需要视口 |
|---|---|---|
| 3 字（贾宝玉） | 86 | 610 |
| 7 字（司马相如字长卿） | 134 | **658** |
| 撞满 180 上限 | 180 | **704** |

⇒ 姓名可见（>640px）且较长时，641~703px 区间**顶栏横向滚动，「切换身份」「退出课堂」被推出视野**。
**不是 Critical**：栏自身 `overflow-x: auto` 消化了溢出（整页不产生横向滚动条），滑动即可触达，功能不丢。

**修法（三选一，控制器选 ③）**：给 `.studentChip` / `.actions` 加 `flex-shrink: 1; min-width: 0`，让**已有的** `.studentName` 省略号真正参与收缩。
**为什么选 ③**：现在 chip 是 `flex: 0 0 auto` —— **永远不会缩，只会在 180px 处硬截**（连省略号都不给）。③ 同时修好这两件事，且不影响 768px 的观感。
**若判断有误的代价**：长姓名学生的操作仍要滑动才够得到。

### C2（Minor，**顺手修**）：同一个文件里三个互相矛盾的宽度数字

`shell.module.css:225` 写「合计约 **598px**」、`:542` 写「约 **602px** / 不带姓名 **560px**」、报告写「608 / 560」，而**实测是 610 / 562**（chip 的 `border: 1px` 双侧让无姓名态是 38 而非 36）。
⇒ 以**实测值 610 / 562** 为准统一。不修不影响功能，只影响 T4 重算时的信任成本。

### C3（Minor，**必须在 T2 里做对**）：chip 的 `role="img"` 会在 T2 变成坑

`module-tab-bar.tsx` 的 `.studentChip` 现在是 `role="img"` + `aria-label`（T1 为「窄屏 `display:none` 后无障碍树变空」而加，审查者用 `ariaSnapshot()` 验证过**合理且不冗余**）。
但 **Ruling 1 要求 T2 把它变成可点的换头像入口** —— 届时 `<button role="img">` 会**丢掉 button 角色**。
⇒ **T2 改成 `<button>` 时必须摘掉 `role="img"`**，`aria-label` 平移到 button 上。**T1 内不构成问题**（它现在确实不可点）。

### C4（Minor，不改代码）：连接点画法与面板不逐像素一致

新顶栏是 10px 实心点，面板是 7px 点 + 4px 环。**判定为 cosmetic**：面板那一行 T4 就删了，「与面板一致」很快失去意义；配色（`#079669`/`#ecfdf5`、`#dc2626`/`#fef2f2`）逐值抄准，学生读到的仍是同一个信号。

### C5（流程，**T2~T5 每个派发都要带上**）：跑 `pnpm build` 前先 `./dev.sh stop`

T1 期间 `pnpm build` 覆盖了 `.next`，**把正在跑的 dev server 打成了 500**（`Cannot find module './129.js'`）。这是流程问题不是代码问题，但会让开发环境每个任务坏一次。
⇒ **T2~T5 的派发说明里加一条**：跑 `pnpm build` 之前先 `./dev.sh stop`，跑完再 `./dev.sh start`。

---

## Task 2: 换头像收进外壳（两处 → 一处）

**Files:** Modify `src/app/classroom/shell/classroom-shell.tsx`、`src/app/classroom/shell/module-tab-bar.tsx`、`src/app/classroom/chat/chat-panel.tsx`、`src/app/classroom/home/student-home.tsx`

**共享实现已经存在**，不用重写：`src/app/classroom/chat/avatar-changer.tsx` 已导出
`AvatarChangerModal`（props：`titleId` / `avatarTokenCount` / `studentId` / `avatars` / `setToast` / `onChanged` / `onClose`）与
`finishAvatarChange(host, result, onDone)`（`host` 要 `classroom` / `selectedStudent` / `setAvatarSvgs` / `setSelectedStudent` / `setAllStudentAvatars` / `fetchStudentTokens` —— **全都在外壳手里**）。

- 外壳持有 `showAvatarChanger`，用 `useOverlayPortal(active)` 渲染模态（**哪个 `active`？** 换头像现在从顶栏触发，而顶栏是**所有 tab 共用**的 —— 见下方「实施者须判断」）。
- 顶栏的学生头像成为**唯一入口**（Ruling 1），并保留「机会由老师奖励」的提示路径（无机会时点击要有反馈，照抄现有文案）。
- **删掉**：面板的 `showAvatarChanger`（`chat-panel.tsx:70`）、头部那个可点头像（`:725`）、模态渲染（`:1235-1250`）；首页的 `showAvatarChanger`（`student-home.tsx:103`）、外部点击关闭（`:163`）、两个入口（`:187`、`:209`）、模态渲染（`:270-280`）。

⚠️ **实施者须判断并在报告里说明**：顶栏是四个 tab 共用且**始终可见**的，所以它的 `active` 语义与模块层的 `active`（`front && settled`）**不同** —— 顶栏在切换动画期间也应可用。换头像模态该挂在**哪个** `active` 上？
- 若挂在某个模块层的 `active` 上，切 tab 会让模态跟着隐藏（可能不是你要的）。
- 若挂在一个恒为真的 `active` 上，则模态在**任何 tab** 上都能开 —— 更符合「共用功能」。
**选一个并给出理由。** 注意 `useOverlayPortal` 的语义（见 `layer-overlays.tsx`），别绕过它自己写 portal。

- [ ] **Step 1-2: 实现 + 门禁；Step 3: 提交**

---

## Task 3: 教师消息下拉搬进外壳 + portal

**Files:** Modify `src/app/classroom/shell/classroom-shell.tsx`、`src/app/classroom/shell/module-tab-bar.tsx`、`src/app/classroom/chat/chat-panel.tsx`

- 搬 `showTeacherPanel` 状态、下拉 JSX（`chat-panel.tsx:742-...`）、以及**点击外部关闭的 document 监听**（`:138-153`）。
  ⚠️ 那个监听有两条**必须一并带走**的细节（原文注释写明了理由）：① 要 `clearTimeout`，否则清理先于定时器执行时会把 handler **永久**留在 document 上；② 它按 `active` 挂载/摘除。
- **必须 portal**（Ruling 2）—— 顶栏的 `overflow-y: hidden` 会裁掉下拉。
- 顶栏加「消息 N」图标按钮；`teacherMsgs` 已在**外壳**手里（面板只是接 prop），所以不需要搬数据。
- 面板侧删掉这一个按钮与弹层；`teacherMsgs` 若面板再无消费者就一并从面板契约去掉。

- [ ] **Step 1-2: 实现 + 门禁；Step 3: 提交**

---

## Task 4: 删学伴面板整行头部 + 清死 prop / 死 CSS + 契约核对

**Files:** Modify `src/app/classroom/chat/chat-panel.tsx`、`src/app/classroom/chat/chat.module.css`、`src/app/classroom/classroom-types.ts`、`src/app/classroom/shell/classroom-shell.tsx`

- 删 `chat-panel.tsx:691-795`（`{/* === 顶部栏 === */}` 到该 `<div className={styles.topBar}>` 的闭合）——**105 行**。删后面板正文直接顶到栏下（检查 `chatShell` 的 `padding-top` 预算是否仍正确）。
- **必须重新核对每一条 CSS 是否真的成了死规则**（用 `grep -c "styles.<name>"`）：`topBar` / `agentIdentity` / `agentIdentityText` / `agentTitle` / `headerAgentAvatar` / `classroomMeta` / `headerActions` / `connectionBadge` / `studentBadge` / `studentBadgeAvatar` / `headerButton` / `headerButtonActive`。
  ⚠️ `connectionOnline` / `connectionOffline` 会**被顶栏复用**（连接点配色）—— 它们要**搬到** `shell.module.css`，不是删掉。别在 `chat.module.css` 里留一份、再在 `shell.module.css` 里抄一份。
- `exitButton` 在 `chat.module.css` 里**没有独立规则**（`grep` 确认过），删用法即可。
- **契约核对**：`classroom-types.ts` 的 `_ContractCheck`（`AssertTrue<ChatPanelProps extends Omit<ModulePanelProps,'state'|'session'>>`）必须继续通过。`onSwitchIdentity` / `onExit` / 可能的 `teacherMsgs` / `avatarTokenCount` 失去消费者 → 从 `ChatPanelProps` 去掉，并同步改外壳的传参（`classroom-shell.tsx` 的 `chat` 对象）。
  ⚠️ 注意 `_ContractCheck` **抓不住「把契约改宽」**（见 `classroom-types.ts` 的注释）—— 所以「去掉一个 prop」这件事**只能靠 tsc 的调用点报错**来发现漏改，别指望那个锚点。

- [ ] **Step 1-2: 实现 + 门禁；Step 3: 提交**

---

## Task 5: 顶栏拆成两行（**范围变更后新增，取代原「首页瘦身」的一半**）

> **⚠️ 用户在 T2 期间追加了新的布局要求**，本任务实现它。五个澄清问题的答案：
> 1. **第二行只放居中的三个 tab**，左右留空
> 2. **切换 / 退出 从图标恢复成带文字**（⇒ **T1 的「操作收成图标」决定被推翻**）
> 3. **首页自己的整行撤除**，首页只剩三张卡（见 T6）
> 4. **班级名与互动码都进第一行** —— ⚠️ **这条已被第 5 条推翻**
> 5. **班级名与互动码两个都不要**（见 Ruling 9）⇒ 第一行只剩五项

**Files:** Modify `src/app/classroom/shell/module-tab-bar.tsx`、`src/app/classroom/shell/shell.module.css`、`src/app/classroom/shell/classroom-shell.tsx`

**第一行**：`首页` · `●连接` · `头像+姓名` · `切换` · `退出`（后两者恢复文字标签）
**第二行**：居中的三个模块 tab；`tabs.length < 2` 时**不渲染 tab 组**（既有规则保留），但两行栏本身仍在。

⚠️ **拆行时必须守住的三件事**：
1. **`--shell-topbar-height` 是栏高的唯一事实来源**（`shell.module.css` 文件头写明），**三处读它**：`.bar` 的 height、`.homeLayer` 的上内边距、`.chatShell` 的上内边距。拆成两行后这个常量与三处都要跟着改。**实施者必须 grep 确认没有第四处读者**——漏一处会让面板内容被两行栏盖住。
2. **指示器滑块的 `offsetParent` 必须是第二行里的 `.tabs`**。T1 审查实测过这条链（ΔX/ΔW 全为 0 才成立）；拆行时若把 `.tabs` 的定位祖先弄丢或改变，滑块会量歪。**改完必须实测**：三档视口 × 三个 tab，滑块相对 `.tabs` 左缘的 ΔX = 0。
3. **第二行居中的实现不能引入左右抖动的布局属性**。宽度自适应、居中，但**不许用会随内容变宽而改变 tab 组位置的写法**（滑块是量出来的，位置一变就要重量）。

**窄屏**：第一行估算 ≈**382px**，**预期 400px 手机也能放下**（Ruling 9）。**实施者必须实测** 768 / 640 / 400 三档的 `scrollWidth` / `clientWidth` 并**明确回答：400px 下还溢不溢出**。这条是 Ruling 4 那条残留能否标记为「已解决」的唯一判据。（T1 的教训：估算 608 vs 实测 610，误差 2px —— 估算可信，但**不能当验证**。）

- [ ] **Step 1-2: 实现 + 门禁；Step 3: 提交**

---

## Task 6: 首页头部行撤除（原「首页瘦身」的另一半）

**Files:** Modify `src/app/classroom/home/student-home.tsx`、`src/app/classroom/home/home.module.css`

用户钦定「全部上提，首页只剩三张卡」。撤掉首页**整行头部**：
- 班级名（`student-home.tsx:171` 附近）
- 互动码（`:172-174`）
- 退出课堂（`:177`）

（**换头像**的入口与模态已由 **T2** 删除，本任务不要重复动。）

**保留**：三张卡片；首页的 `Toast` 与 `useOverlayPortal`（Toast 仍然需要）。
**必须核对**：撤掉头部后 `.page` 的渐变背景与上内边距是否仍正确给**两行** chrome 让位（T5 改了栏高）；`onExit` 若在 `StudentHomeProps` 里再无消费者就去掉（⚠️ 注意 `_ContractCheck` **抓不住「把契约改宽」**，靠 tsc 的调用点报错发现漏改）。
**验证**：首页不应剩下任何指向已移走能力的死按钮或空占位。

- [ ] **Step 1-2: 实现 + 门禁；Step 3: 提交**

---

## Task 7: 更新走查清单（**控制器自己做**）

M1b-2 的 §10.1 里有**若干步因本次改动而失效**（学伴面板头部的走查项、首页的「退出课堂」入口那条、以及 `§10.1` 里所有提到面板头部元素的判据）。这一步由控制器改，**不派实施者**。

---

## 验收清单（全量人工走查，**合并到一次**）

> 本次改动**使 M1b-2 §10.1 的部分步骤失效**，走查者必须以本节为准，配合 M1b-2 §10.1 中仍然有效的部分。

### A. 顶栏（四种 tab 配置下都要看）

- [ ] 顶部**只有一行**导航栏；学伴面板**没有**自己的头部行
- [ ] 智能体名、课堂名、互动码在**学伴面板里不再出现**
- [ ] 顶栏右侧五个操作在**首页 / 学习单 / 探究助手 / 智能学伴**四个 tab 上**都在**且都可用
- [ ] 连接点是绿点（已连接）/ 红点（断开），**鼠标悬停有文字**（颜色不是唯一信息载体）
- [ ] 点顶栏头像 → **换头像模态打开**；没有机会时给出「由老师奖励」的反馈
- [ ] 换头像成功后：**顶栏头像、首页头像、学伴里的头像**三处**同时**更新
- [ ] 点「消息 N」→ 下拉**完整可见、没有被顶栏裁掉**（Ruling 2 的判据）
- [ ] 点下拉外部 → 关闭
- [ ] 点「切换」→ 回身份选择页；点「退出」→ 退出课堂
- [ ] **切 Tab 时五个操作不应闪断/重挂**（尤其连接点不能在切 tab 时变红）
- [ ] 悬停/按下：只用 `transform`/`opacity` 的动作，无布局跳动

### B. 首页瘦身

- [ ] 首页**不再有**「退出课堂」「换头像」入口
- [ ] 首页仍有 班级名 + 互动码 + 三张卡片；三者各自的原有行为不变
- [ ] 首页的 Toast 仍然工作（教师消息 / 提示条）

### C. 老 iPad 真机

- [ ] **竖屏 768px**：顶栏一行放得下，不需要横向滚动
- [ ] **每个操作都点得中**（36px 触控目标）
- [ ] 姓名在窄屏隐藏后，头像**仍可点**且仍能开换头像
- [ ] **已知残留（不是缺陷）**：400px 手机宽度下顶栏仍会横向滚动，操作可能被滚出视野（Ruling 4）

### D. 回归（这些是 M1b-2 的成果，别被本次改动打坏）

- [ ] 学伴面板**内容不再被栏遮挡**（`padding-top` 预算仍对）
- [ ] 切 Tab 保留内容；首页 ↔ 模块动画照旧
- [ ] 五处页面级副作用的 `active` 门仍成立（切走再切回三次，`document.body.style.overflow` 不变）
- [ ] 换身份后**不串状态**（草稿、消息、滚动位置）
- [ ] 连接徽章在**开发模式**下不应再出现「明明连上了却显示断开」（M1b-2 收尾修 `0da2417`）
