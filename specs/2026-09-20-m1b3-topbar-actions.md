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

**Ruling 10（在 Ruling 9 之后作出，**推翻 Ruling 4 的禁令**）：顶栏恢复单行，右侧操作**必须右对齐**。**

用户在 T2b 之后再次修改布局：「学生用 iPad 不管横屏竖屏，顶栏宽度我感觉应该是够的；真的不够可以左右滑动。**再加上第二行，高度就太大了，会占用下面的主要空间。**」
⇒ **不再拆两行**（T5 首版方案作废），`--shell-topbar-height` 保持 52px。
⇒ **Ruling 4 那条「本次不做『操作钉死在右侧』」的禁令解除，改为要求**：用户指定「连接状态 · 学生头像+姓名 · 切换用户 · 退出课堂」**靠右对齐，且都要有文字**。
⇒ **T1 的「操作收成图标」决定被彻底推翻。**

**控制器评估：用户的高度理由站得住。** 学伴面板按 `100vh` 算、栏高从内容高度里扣。**再加一行 44–48px 是整堂课持续付出的代价，而宽度不够只是极端情况下横滑一下** —— 两者代价不对等。
**若判断有误的代价**：768px 下若因长姓名溢出，学生要横向滑动才够得到「退出课堂」。**用户已明确接受这一点**（原话：「如果真的不够，可以左右滑动来显示」）。

**⚠️ 词汇不一致（实施者按代码库既有词汇处理）**：用户口述「**退出教室**」「切换用户」，而代码库现有文案是「**退出课堂**」。⇒ T5 用「退出课堂」，并在报告里说明。若要全局改成「教室」，那是词汇统一问题，单开一项。

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

## T2 审查的遗留项（**控制器已裁定**）

T2 审查结论 **Approved with fixes**（0 Critical / 1 Important / 5 Minor），实测确认：唯一入口、四个 tab 都能开模态、模态完整可见（768/400/375 三档 `fullyInViewport`）、**三处头像同步更新（SVG 逐字节相同）**、**无机会时四个 tab 都有「由老师奖励」反馈**、两种关闭方式；`useOverlayPortal(true)` 的**死锁论证成立且绕过正当**（教师关掉学伴会让 `activate('companion')` 恒假；「外壳挂载 ⟺ 顶栏可见」成立，因为切换身份与课堂结束都是**整壳卸载**）；C1 的偏离有可复现数据、**接受**；范围纪律干净；四道门禁全绿。

### C6（Important，**必修**）：奖励提示指向一个刚被删掉的 ⭐

`src/app/classroom/chat/use-chat-socket.ts:207`：
```js
setToast({ msg: '🎉 老师奖励了你一次更换头像的机会！点击姓名旁的⭐即可更换', type: 'success' })
```
那枚 ⭐ 是 `chat-panel.tsx` 原先 `:721-730` 的面板头星标，**被 `b500c86` 删掉了**。审查者实测（学伴 tab、薛宝钗）：`starPolygons: 0`、`bodyHasStarGlyph: false`。
⇒ 老师刚奖励一次机会 → 学生读到「点击姓名旁的⭐」→ **屏幕上没有任何 ⭐**。**在「机会刚到手、最想用」的那一刻，这是一句无法执行的指令。** Ruling 1 专门要保的就是这条路径。
**修法（一行文案）**：改成指向真实入口，例如「点击**顶栏**自己的头像即可更换」。
**验证**：实测触发一次 `avatar-rewarded`，确认提示里提到的入口**存在且可点**。

### C7（Minor，顺手修）：两处小错

- `shell.module.css:560` 的注释写「三处按下反馈」，后面却列了**四个**选择器（T2 追加的 `.studentChipButton:active` 没改数字）。
- `module-tab-bar.tsx:324-325` 的 `title` 与 `aria-label` 不一致：`aria-label="薛宝钗，更换头像"` 带姓名、`title="更换头像"` 不带 ⇒ 窄屏姓名 `display:none` 时，鼠标用户的 tooltip 不再告诉他这是谁的身份。

### C8（Minor，**排进 T5**）：剩余机会数在学生端不再可见

首页的「换头像 N」按钮、面板的「⭐ N」角标都随 T2 撤除，只剩弹窗里的「剩余 N 次更换机会」。⇒ **有 0 次与 ≥1 次的 chip 外观与交互完全一致**，学生拿到奖励后除了那条提示没有别的线索。
**裁定**：T5 正在重做这一行，**在那枚 chip 上加一个剩余次数的角标**（`avatarTokenCount > 0` 时才显示）。这不是新增需求 —— 它恢复的是 T2 顺带抹掉的一个既有信号，且与 Ruling 1「保住换头像的反馈路径」同源。

### C9（**登记为后续小修，不进本里程碑**）：弹窗没有焦点陷阱

`avatar-changer.tsx:199-236`（一行未改，**继承项**）。实测模态打开后焦点仍停在 chip 上，Tab 可达遮罩背后的「切换身份 / 退出课堂」并**真的执行**。
T2 没让它变坏，但入口上移后「遮罩背后」变成了整个应用。**不阻塞**。⚠️ 不能指望 `inert`（Safari 15.5 才支持，本项目的硬约束是 15）⇒ 得手写焦点陷阱。**交用户决定是否单开一轮。**

### C10（流程，**继续往下带**）：`./dev.sh start` 在交付状态里没生效

审查者接手时 `:4000` 是 500（`ENOENT .next/routes-manifest.json`，正是 C5 那个症状）。⇒ C5 的「跑 `pnpm build` 前先 `./dev.sh stop`、跑完 `./dev.sh start`」提醒**继续往下带**，且交付前应 `./dev.sh status` 复核一次。

---

## T2b 审查的遗留项（**控制器已裁定，随 T3 一并收口**）

T2b 审查结论 **Approved with fixes**（0 Critical / 1 Important / 3 Minor）。实测确认（**含反事实验证**）：
- **三条卡片图标陷阱逐条真的避开了**：`background`/`border-radius` 计算值归零；`position: relative` 保留 —— **反事实实测**把它临时改成 `static`，锁定角标从 (+39,−7) 跳到 (+267,−23)（**横飞 228px**），证明陷阱真实且被避开；锁定态 `grayscale(1)` **只落在图片上**（角标不褪色）。
- **锁定态比旧实现更清楚**：色块对卡片底 **1.23:1 → 2.06:1**。判据是**色度不是亮度**（饱和度 0.545 → 0.0195，**28 倍**），所以**暗屏不影响**（模拟 `brightness(.72)` 后色差反拉到 57 倍）。
- 52×52 达标（可见色块 48.75px ≥ 48 下限），**六个视口零破版零横滚**，`iconSrc` 单一来源，`alt=""` 处理正确。
- **`5c76584`（控制器代提那笔）经独立取像素判定可以收下**：路径合法（无越界、无自交填充异常）、与卡片图标主题一一对上、旧图形零残留、开放/锁定仍分得开。
- 滑块链路完好（`offsetParent` 未变，`translateX(217px)/103px` 与 `offsetLeft/offsetWidth` 逐值相等）；范围纪律干净；四道门禁全绿；**DB 逐表 diff 已还原**。

### C11（Important，**必修**）：C6 的新文案仍指向一个会误导人的东西

新文案「点击**屏幕上方你的头像**即可更换」有两处问题：
1. **不排他**：同一屏上还有**第二枚「你的头像」** —— 首页白卡里那枚 **70×70**、紧挨学生姓名的大头像，实测是 `<span>` / `cursor:auto` / **点下去毫无反应**，而且比顶栏那枚（36px 圆）更显眼。**在 1280px 下同样成立**，不是窄屏专属。
2. **窄屏下不可执行**：375/400px 时顶栏 chip 是 `x=405..441`，**完全在视口外**（可见比例 0；`scrollWidth 521 > clientWidth 400`）。

⇒ 这与 C6 当初被立为 Important 是**同一类失败**（指令指向不存在／不可用的入口）。
**修法**：把文案改成**排他**的描述，让学生一眼知道是**顶栏那一枚**。实施者不用「顶栏」二字的理由（学生端从没出现过这个词）审查者认可，所以**别用行话**，要用学生看得懂的空间描述并验证它确实排他。
**验证要求**：渲染出「首页 + 顶栏」同屏的状态，确认文案能唯一指向可点的那一枚。
⚠️ **375/400 那条是宽度问题**，归 T5 的实测档位（T5 会重排这一行），**不在本项解决**。

### C12（Minor，**必修**）：注释把「chip 是不是按钮」的开关写错了

`src/app/classroom/chat/use-chat-socket.ts:209-211` 断言它是 `avatarTokenCount > 0` 才变成 `<button>`，**真实开关是 `module-tab-bar.tsx:144` 的 `selectedStudent?.studentId`** —— 真实学生**永远**是按钮；`avatarTokenCount` 只决定点下去开弹窗还是说「由老师奖励」。
**这是本项目第七次「散文声称了一个不存在的机制」**，而这条注释的全部用途就是让下一个改文案的人按**正确的机制**去复核入口。⇒ 按事实改写。

### C13（Minor，**必修，渲染结果不变**）：学伴图标的三枚圆点依赖继承的 linecap

`module-meta.tsx` 里 `M8.5 10h.01M11.5 10h.01M14.5 10h.01` + `strokeWidth="2.6"`：**`getBBox()` 实测高度为 0** —— 三枚点靠父 `<svg>` 的 `stroke-linecap="round"` 才成形。父级 linecap 一改、或这段被复制到别处，**三枚点会整体消失**（不是变细）。
⇒ 改写为**显式 `<circle>`**（圆心/半径保持现值 ⇒ **渲染逐像素一致**，只是不再依赖继承）。这是健壮性修复，**不是改设计**。

### C14（Minor，**控制器不擅自改，交用户定**）：新 Tab 线稿墨量偏重

逐像素实测（`solidPct` = 与背景差 >85% 的像素）：学习单 39.2%→43.1%、**探究助手 24.7%→45.6%（近乎翻倍）**、学伴 26.3%→37.9%。
`fill="currentColor"` 的光标（5×5 单位 ≈ 21px 下 4.4px 实心块）与折线末端糊成一块深色斜块，**认不出是光标**；学习单的夹子与表单 `rect` 顶边描边合成一根粗黑条。
**判定：Minor 不阻塞**（未糊成整团 —— `solidPct` ≤2.3%，形状与 bbox 完整；且 Tab 上永远紧挨文字标签，辨形不承担可用性）。
⚠️ **这是用户自己的图形，控制器不擅自改动** ⇒ 已把像素数据报给用户，等其决定是否收细描边。

### C15（流程）：gitStatus 快照不可信

T2b 实施者指出它拿到的快照（只列 3 个文件、最近提交 `7284e29`）与**真实 HEAD** 不一致，因而**漏报了 `module-meta.tsx` 的既有脏改动**。
⇒ 快照是**会话开始时**的、不会更新。**派发前必须自己 `git status` / `git rev-parse HEAD` 现查**，不得依赖快照。

---

## Task 2b: 首页三张卡片换用新模块图标（**用户要求提前，从 T6 拆出**）

> **为什么单独成任务**：它与 T3/T4/T5 零依赖，单独走能更早交付；留在 T6 会把「撤除首页头部」那个**纯删除**任务搅成混合任务，审查面变糊。

**Files:** Modify `src/app/classroom/home/student-home.tsx`、`src/app/classroom/home/home.module.css`、`src/app/classroom/module-meta.tsx`

**图标文件已经在正确位置且已被 git 跟踪**（控制器已实测 + 已提交 `01fd535`）：

```
public/images/module-icons/worksheet.svg    1221B   → /images/module-icons/worksheet.svg
public/images/module-icons/explore.svg      1163B
public/images/module-icons/companion.svg    1164B
```

`public/` 就是 Next.js 的 Web 根，三个 URL 已 HTTP 200（`image/svg+xml`）。**同目录的 PNG 已按用户要求删除，不要再引入。**

**用 SVG。** 三个 SVG 自包含（无外部引用），自带的渐变底色**正好是各模块的强调色**：`#1D4ED8` / `#6D28D9` / `#155E75` —— 与 `module-meta.tsx` 的 `accentStrong` **同值**。

**关键：这批图标是「自带渐变圆角底的整块图标」（`rect rx=32` + 白色线稿），不是线稿。** 所以：
- 现在 `.cardIcon` 的 `background: var(--card-accent)` 与 `border-radius: 12px`（`home.module.css:218-228`）**必须去掉**，否则变成「色块套色块」。
- **保留 `.cardIcon` 的 `position: relative`** —— 锁定角标 `<LockBadge />` 是挂在它里面的绝对定位元素（`student-home.tsx:211-214`），去掉定位上下文会让角标跑位。
- `<img>` 加 `alt=""`：卡片正文已有模块名文字，图标是**装饰性**的，重复朗读反而啰嗦。

**尺寸：用户明确要求「图标不要太小」。** 现在是 **40×40**，放大到 **52×52** 起步（可上下微调，但**不得小于 48**），并**实测**卡片在既有的 860px / 640px 响应式分支下不破版、不产生横向滚动。

**锁定态必须仍然「一眼看出灰掉」**（§4.4 的三态要求）：现在靠 `.cardLocked .cardIcon { background: #e2e8f0; color: #94a3b8 }`（`:294-297`）—— 换成 `<img>` 后这两个属性**不再有效**（SVG 自带颜色、也改不了色）。
⇒ 改用 **`filter: grayscale(1)` + 降低 `opacity`**（或用遮罩），**并实测锁定态与开放态在视觉上确实区分得开**。
⚠️ `--card-accent` 还被卡片的**左侧粗边（`:183`）、模块名颜色（`:240`）、CTA 按钮底色（`:262`）**用着，**不要动那三处**。

**图标路径写进 `module-meta.tsx`**（模块元数据的单一来源），**不要**在 `student-home.tsx` 里散落三个字面量。既有的 `icon`（白色线稿，给 Tab 栏用）**保留不动** —— 顶栏 tab 的图标只有 16px，全彩整块图标会糊成一团。**两个字段并存是刻意的**，请在 `module-meta.tsx` 里用注释写明这个分工。

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

## Task 5: 顶栏保持**单行** —— 左侧 4 个入口、右侧 4 个操作，全部带文字

> **⚠️ 用户在 T2b 之后再次修改了布局要求，本任务以本节为准（此前的「拆两行」方案作废）。**
>
> **用户的原话与理由**：「学生如果使用 iPad，不管横屏还是竖屏，顶栏宽度我感觉应该是够的；如果真的不够，可以左右滑动。**如果再加上第二行，高度就太大了，会占用下面的主要空间。**」
> **控制器评估：这个理由站得住。** 学伴面板按 `100vh` 算、栏高从内容高度里扣（`--shell-topbar-height` 被三处读）。**再加一行 44–48px 是整堂课持续付出的代价，而宽度不够只是在极端情况下横滑一下** —— 两者代价不对等。⇒ **恢复单行。**
>
> **布局**（用户指定）：
> - **左侧对齐**：`首页` · `学习单` · `探究助手` · `智能学伴`（四个按钮）
> - **右侧对齐**：`连接状态` · `学生头像 + 姓名` · `切换用户` · `退出课堂` —— **这几个都要有文字**
>
> 澄清问题的历史答案仍然有效：**班级名与互动码两个都不要**（Ruling 9）；**首页自己的整行撤除**（T6）。
> ⇒ **T1 的「操作收成图标」决定被彻底推翻**（本就已被 T5 首版推翻，现在连「图标化」本身也不要了）。

**Files:** Modify `src/app/classroom/shell/module-tab-bar.tsx`、`src/app/classroom/shell/shell.module.css`、`src/app/classroom/shell/classroom-shell.tsx`

### 必须做对的三件事

1. **`.actions` 改为右对齐** —— 用 `margin-left: auto` 之类把右侧那组推到最右。
   ⚠️ **Ruling 4 已作废**：T1 时控制器明确要求**不做**「操作钉死在右侧」，理由是用户当时选了「图标化」而非「tab 组滚动、操作固定右侧」。**现在用户明确要求右对齐 ⇒ 那条禁令解除，改为要求。**
2. **`--shell-topbar-height` 保持 52px 不动**，三处读它的地方（`.bar` 高度、`.homeLayer` 上内边距、`.chatShell` 上内边距）也随之不动。**本任务不得改栏高**（这正是用户要单行的理由）。
3. **指示器滑块的链路不能坏**。T1 审查实测过：滑块位置是 `el.offsetLeft`（相对 `.tabs`）量出来的，ΔX/ΔW 全为 0 才成立。**改完必须实测**：多档视口 × 三个 tab，滑块相对 `.tabs` 左缘的 ΔX = 0，且三个 tab 的 `offsetParent` 仍是 `.tabs`。
   ⚠️ 右对齐会让 `.tabs` 的**位置**在宽度变化时移动，但 `.tabs` 内部的相对几何不变 ⇒ 滑块仍然对。**但这一点必须实测确认，不要推理。**

### 宽度（用户明确接受横滑）

控制器按 CSS 声明值粗估：左侧 ≈381px（首页 72 + 学习单 90 + 探究助手 104 + 智能学伴 103 + 间隙），右侧 ≈330px（连接状态含文字 + chip + 切换用户 + 退出课堂 + 间隙），加两侧内边距 ⇒ **合计 ≈727px**。
⇒ **iPad 竖屏 768px 勉强够（余量约 40px），横屏 1024px 宽裕**；长姓名或更窄视口会溢出，**用户已明确接受「左右滑动」**。
**实施者必须实测** 1024 / 768 / 640 / 400 四档，给出 `scrollWidth` / `clientWidth` 与真实余量，并**明确回答**：① 768px 下溢不溢出；② 溢出时**顶栏内部横向滚动是否可用**（`overflow-x: auto` 仍在、且**整页不产生横向滚动条** —— 即 `documentElement.scrollWidth === clientWidth`）。
**估算不是验证。**（T1 的教训：估 608 / 实测 610。）

### 另需一并做（T2 审查的 C8）

在那枚学生 chip 上**加一个剩余换头像次数的角标**，`avatarTokenCount > 0` 时才显示。理由：T2 撤掉了首页的「换头像 N」按钮与面板的「⭐ N」角标后，**有 0 次与 ≥1 次的 chip 外观与交互完全一致**，学生拿到奖励后没有任何线索。这不是新增需求 —— 恢复的是 T2 顺带抹掉的既有信号，与 Ruling 1「保住换头像的反馈路径」同源。
⚠️ 加了角标**会改变 chip 的宽度** ⇒ 上面四档实测**必须在加了角标之后跑**（含长姓名的溢出对照）。

### 文案

`切换用户` / `退出课堂` —— ⚠️ 用户口述的是「切换用户」与「**退出教室**」，但代码库现有文案是「**退出课堂**」（首页原来那个入口）。**以代码库既有词汇为准用「退出课堂」**，并在报告里说明这一处对齐（若用户要改成「教室」，那是全局词汇问题，单开一项）。

- [ ] **Step 1-2: 实现 + 门禁；Step 3: 提交**

---

## Task 6: 首页头部行撤除

**Files:** Modify `src/app/classroom/home/student-home.tsx`、`src/app/classroom/home/home.module.css`

用户钦定「全部上提，首页只剩三张卡」。撤掉首页**整行头部**：
- 班级名（`student-home.tsx:171` 附近）
- 互动码（`:172-174`）
- 退出课堂（`:177`）

（**换头像**的入口与模态已由 **T2** 删除；**三张卡片的模块图标**已由 **T2b** 替换 —— 本任务都不要重复动。）

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
