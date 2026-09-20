# M1b-2：学生端首页与三件套外壳 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学生进入课堂先看到**常驻首页**（课堂门户），从首页进入三个模块（学习单 / 探究助手 / 智能学伴）之一；顶部三个按钮可随时切换，**切换时各模块内容完整保留**；模块的可用性由教师的三态实时控制。

**Architecture:** 新增 `home/`（门户）与 `shell/`（Tab 容器 + 挂载管理 + 动画）两层，把已有的 `chat-panel` 收敛为一个符合 `ModulePanelProps` 契约的面板。**学习单与探究助手在 M1b-2 里是占位面板**（M3/M2 才实现），但外壳、三态、挂载、动画必须完整可用且经真机验证。

**Tech Stack:** Next.js 15 静态导出 + React 18 + TypeScript strict + CSS Modules；Safari 15（老 iPad）为硬约束。

**Spec:** `specs/2026-09-19-classnode-learning-suite-design.md`（§4.1 结构、§4.2 首页、§4.3 模块契约、§4.4 三态、§4.5 挂载管理、§4.6 动画、§4.7 Safari 约束、§4.8 性能门槛、**§4.10 M1a 前置项、§4.11 M1b-1 前置项**）

---

## 🔴 Step 0：分支

分支 `feat/m1b2-student-shell` 已从 `main` 的 `3b025a2` 创建。

**用户的明确要求（本次与之前不同）**：
- **中途不找用户确认合并** —— 任务之间自行完成审查与修复，继续下一项
- **浏览器走查合并到最后一次性做**（Task 10），不再每个任务打断
- **全部完成后**才向用户汇报，同意后才合并

```bash
git branch --show-current   # 必须是 feat/m1b2-student-shell
```

---

## Global Constraints

1. **这是新功能**（不是重构）——允许改行为，但既有 `workspace test` 53 项必须继续全过。
2. **不得出现 regex lookbehind**（构建期检查会 fail）。
3. **不得使用 Safari 15 不支持的语法**：`:has()`、`content-visibility`、`@container`、`Object.hasOwn`、`structuredClone`、`Array.prototype.at`/`findLast`、`dvh`、`:focus-visible`。
4. **动画只用 `transform` / `opacity`**，并遵循 `prefers-reduced-motion`。
5. 提交信息中文，格式 `feat(classroom): <做了什么>`。
6. **不碰** `CLAUDE.md` / `dev.sh` / `package.json`。

### 基线

```bash
npx tsc --noEmit                              # 退出 0、零输出
npx eslint src/app/classroom/ src/lib/        # 退出 0、恰好 1 条 tokenData warning
pnpm build                                    # 退出 0 + Safari 检查通过（10 个脚本）
cd server && pnpm test                        # 53 pass / 0 fail
```

⚠️ **只允许一个 `pnpm build` / `pnpm test` 在跑。**

### 四条用血换来的教训（M0/M1a/M1b-1）

1. **实施者必须用 `grep` 自行枚举依赖，不得信任任何清单（含本计划）。** 该条生效过四次。
2. **同一时刻只允许一个 `pnpm build` / `pnpm test`。**
3. **机械主张要用命令证明，不要用眼睛看**（抽取 + `diff`、md5、`sed` 核对行号、`comm` 比集合）。
4. **简报不含 Global Constraints** —— 控制器每次调度要自带。

---

## Rulings（控制器已裁定，实施者按此执行）

**Ruling 1（§4.11 A 的产品决策）：老课堂升级后三模块全锁定 —— 接受，并加教师可见提示。**
理由：尊重 §4.4 的设计意图（三态默认 `preview` 是教学上最保守的起点），同时不让教师在升级当天困惑。**实现方式**：教师端课堂看板的「模块状态」菜单里，当三个模块**都**是 `preview` 且该课堂**无任何 `ClassroomModule` 行**时，显示一句提示（如「本课堂尚未设置过模块状态，三个模块当前均对学生可见但锁定」）。
**若判断有误的代价**：教师可能在升级当天发现学生进不去智能学伴；改动很小（换成「零行时 `companion` 视为 `open`」只需改读路径一处）。

**Ruling 2：M1b-2 里学习单与探究助手是占位面板。**
外壳、三态、挂载、动画完整可用；两个未实现模块显示「敬请期待」式占位。理由：M1b-2 的验收是真机性能门槛，而性能风险来自「三个模块同时挂载」——占位面板同样能压出这个问题，且不必等待 M2/M3。

**Ruling 3（§4.11 B7）：学生侧订阅保持在 `use-chat-socket.ts`，不搬进外壳。**
M1b-1 已论证它属于那里（socket 的唯一创建者、三条同族权限订阅的邻居）。搬进外壳会反转 §4.10 B 的划分。

---

## Rulings 追加（Task 1 执行后裁定，后序任务按此执行）

**Ruling 4（即 §4.10 A 的二选一，之前一直悬置）：采用路线 A —— 给面板加 `key={selectedStudent?.id}`。**
理由：(a) 最省；(b) **完整保留今天的 ref/清理语义**（换身份即重挂 ⇒ 清理照跑 ⇒ `streamingRafRef`/`streamingBufferRef` 被复位、草稿不跨学生泄漏）；(c) 不动 M1a 刚确立的状态归属边界。路线 B（在外壳提 `resetSessionState()`）要在三处调用点重复同一份复位清单，而清单已经漏过一次（M1a 的 6 个状态补偿就是补漏）。
**注意**：`key` 用 `selectedStudent?.id`，**不是** tab id —— 切 tab 时它不变，所以**切 tab 仍保留内容**；只有换身份才重挂，那正是我们要的。
**若判断有误的代价**：换身份时面板内所有状态重置（M1a 的 Ruling 4 已把这个方向裁定为**修复**而非回归）。

**Ruling 5：Task 2 的 portal 必须同时解决可见性继承。**
把查看器/模态/Toast 提到 `document.body` 后，它们**不再继承面板的 `visibility:hidden`** —— 会浮在首页之上。**所以 Task 2 不能只做 portal**：被 portal 的元素必须**显式读取所属模块的 `active`** 并据此设置自身可见性（或在该模块非 active 时不渲染）。
**约束**：不要用「非 active 就卸载」来解决 —— 那会丢掉查看器的缩放/位置状态（§4.5 要求保留）。用「保持挂载 + 受 `active` 控制的可见性」。

**Ruling 6：模块转为非 `active` 时必须停掉语音输入。**
`useVoiceInput` 当前在模块隐藏后**不停麦克风**。面向未成年人的产品里，让学生在被隐藏的模块中持续被录音不可接受 —— 与 Task 6「送回首页」的语义也矛盾。
**做法**：`useVoiceInput` 增加 `active` 入参，`active` 转 false 时中止识别并复位 `voiceListening`（保留已转写的文本，不丢学生已说的内容）。

---

## Task 1: 前置项 —— 五处页面级副作用加 `active` 门（**最高风险，先做**）

**Files:**
- Modify: `src/app/classroom/chat/chat-panel.tsx`
- Modify: `src/app/classroom/chat/use-chat-socket.ts`（如需）
- Modify: `src/app/classroom/use-classroom-session.ts`（如需）

**为什么先做**：这五处是 §4.10 C 与 §4.11 B 列出的、**今天正确只因为「面板挂载区间 ≡ 会话区间」**的东西。M1b-2 一旦让面板常驻（§4.5），它们会立刻失效。

**五处（行号以当前 `chat-panel.tsx` = 1252 行为准，实施者须自行 `grep` 核实）**：

1. **锁 body 滚动 + visualViewport 监听** —— `if (step !== 'chat') return;` 的门。上移后 `step` 不再等于「面板可见」
2. **AI 完成后自动聚焦输入框**（deps 含 `step`）
3. **`<textarea autoFocus>`** —— 改为「`active` 首次变 true 时程序化 focus」
4. **全屏图片查看器的 `window` 监听**（`keydown` / **`wheel` 带 `preventDefault`** / `mousedown` / `mousemove` / `mouseup`）—— 无门控。学生打开图后切 tab，**整个外壳的滚轮会被吃掉**
5. **挂载时会话恢复 effect** —— 面板不再卸载后不再重复触发，但须确认语义

**⚠️ `overflow` effect 的幂等性（§4.10 A）**：它先快照 `document.body.style.overflow` 再还原。**只加 `active` 门而不重新设计，第一次切走后 `<body>` 会永久停在 `overflow:hidden`** —— 整个外壳再也滚不动。**必须先设计再动手。**

- [ ] **Step 1: grep 出五处的真实现状**（不得凭本计划的行号）
- [ ] **Step 2: 先设计 `overflow` 的幂等方案**，在报告里写明，再实现
- [ ] **Step 3: 实现五处门控**
- [ ] **Step 4: 门禁（三项）+ 走查**：切 tab 后页面**仍能正常滚动**、键盘不误弹、图片查看器关掉后滚轮恢复正常
- [ ] **Step 5: 提交**

---

## Task 2: 前置项 —— `position: fixed` 元素逃出动画容器

**Files:** Modify `src/app/classroom/chat/chat-panel.tsx`（或新建 `chat/chat-overlays.tsx`）

§4.10 C3 与 §4.11 指出：**四个** `position: fixed` 元素嵌在 `composerArea` 内 —— 标记条（z-index 20）、标记 tooltip（30）、avatar 模态（100）、**全屏图片查看器（9999）**、**Toast（99999）**。§4.6 的切换动画让面板成为 `transform` 容器 ⇒ 它们被重新锚定到面板盒子、被裁切、遮罩跟着平移。

**做法**：用 `createPortal` 提到 `document.body`（Next.js 静态导出下安全；须确保 SSR 期不执行 —— 用 `useEffect` 置一个 mounted 标志，或 `typeof document !== 'undefined'` 守卫）。

- [ ] **Step 1: `grep -n "position: 'fixed'\|position:fixed" ` 找出全部，确认是五个而非两个**
- [ ] **Step 2: 逐个改为 portal，**保持 DOM 顺序与 z-index 不变**
- [ ] **Step 3: 门禁 + 走查**：图片全屏仍正常、ESC 关闭、缩放拖拽可用；标记条位置正确；Toast 在最上层
- [ ] **Step 4: 提交**

---

## Task 3: 定义模块契约与三态词汇

**Files:** Modify `src/app/classroom/classroom-types.ts`

```ts
export type ModuleId = 'worksheet' | 'explore' | 'companion';
export type ModuleState = 'open' | 'preview' | 'hidden';

export interface ModulePanelProps {
  active: boolean;              // 此刻是否可见
  state: ModuleState;           // 教师设定的三态
  classroom: ClassroomInfo | null;
  session: StudentSession | null;
}
```

**注意**：`ModuleId` 用前端语义名（`worksheet`/`explore`/`companion`），与后端的 `moduleKey`（`learning-sheet`/`explorer`/`companion`）之间需要一处映射。**映射必须单源**，放在 `src/lib/classroom-modules.ts`（M1b-1 已建，含 `MODULE_KEYS`/`MODULE_STATES`/`DEFAULT_MODULE_STATE`/`applyModuleState`）。

- [ ] **Step 1: 实现类型 + 映射，并加一条测试或断言确保映射覆盖 `MODULE_KEYS` 全集（漏一个 key 会让某个模块永远读不到态）**
- [ ] **Step 2: 门禁；Step 3: 提交**

---

## Task 4: 学生端首页（常驻门户）

**Files:** Create `src/app/classroom/home/student-home.tsx` + `home.module.css`；Modify `page.tsx`

§4.2 规定：班级名 + 互动码、学生本人头像与姓名（可点换头像）、**三件套入口卡片**（模块名、图标、内容摘要、三态呈现）、从模块返回首页的入口。

- **三态呈现**：`open` 可点 / `preview` 灰掉 + 🔒 角标 + 点击提示「老师还没开放」/ `hidden` 完全不显示
- **卡片主内容**：学习单→标题与进度（M3 才有真实数据，当前显示占位）；探究助手→网页数量（M2 才有）；学伴→智能体名 + 最近一轮对话摘要
- **`step` 增加 `'home'`**：`'loading' | 'identity' | 'home' | 'shell'`
- **这是「美观、吸引学生」的主阵地** —— 实现时调用 `frontend-design` 技能

⚠️ **§4.11 B6**：从 `MODULE_KEYS` 渲染，**不要按 `classroom.modules` 的数组下标**渲染（`applyModuleState` 会在键缺失时追加，下标会漂移）。

- [ ] **Step 1: 实现首页**；**Step 2: 门禁 + 走查**（三态三种呈现都对；点开/关闭正常）；**Step 3: 提交**

---

## Task 5: 外壳与 Tab 容器

**Files:** Create `src/app/classroom/shell/classroom-shell.tsx` / `module-tab-bar.tsx` / `use-module-tabs.ts` / `shell.module.css`；Modify `page.tsx`

- **`use-module-tabs`**：惰性挂载 + **一旦挂载永不卸载**（直到课堂结束）+ 被教师关闭时**隐藏并挂起**而非销毁（§4.5）
- **Tab 栏**：只渲染已启用（非 `hidden`）的模块；`preview` 显示但灰掉；**只启用一个模块时不显示 Tab 栏**（§4.7）
- **首页入口**放在 Tab 栏最左

⚠️ **§4.11 B3：外壳必须是单页**，不得给 tab 独立路由（`useClassroomSession` 在 `page.tsx` 无条件调用；独立路由会让页面重挂、`restoreSessionFromUrl` 重跑、socket 与 session 全部重建）。

- [ ] **Step 0（T4 审查补入，必做）**：**删除 `page.tsx` 的 `handleOpenModule` 垫脚石**。它是 T4 为了让首页可点而加的中转，模块一旦真的能打开就必须由外壳接管 —— 不删的话 `open` 的学习单/探究助手会**永远弹「这个模块还在准备中」**，而 `preview`/`hidden` 都表现正常，症状极难归因。（`page.tsx` 那处有 6 行 ⚠️ 注释点名 Task 5，但注释不是保证会被读的载体，计划才是。）
- [ ] **Step 1-3: 实现 + 门禁 + 走查**（切换保留内容：在学伴里打字 → 切走 → 切回，草稿还在）；**Step 4: 提交**

---

## Task 6: 接入真实的三态与实时

**Files:** Modify 外壳、`home/student-home.tsx`、`use-classroom-session.ts`

- 三态来源：`classroom.modules`（M1b-1 已下发），经 `MODULE_KEYS` 映射
- **实时**：M1b-1 已在 `use-chat-socket.ts` 订阅 `module-state-changed`
- **§4.11 B4：模块从 `open` 变为非 `open` 时** —— 若学生正在该模块，必须**提示 + 送回首页，不丢已作答内容**；并**显式决定流式中隐藏是否停掉生成**（服务端不会中断，`activeStreams` 是 per-socket 的）
- **§4.11 B2：`handleIdentityConfirm` 从不刷新 `classroom`** —— 在教师改态之后才选身份的学生会用旧态。修法：身份确认后补一次读，或复用 M1b-1 在 `connect` 回调里的补读

- [ ] **Step 1: 实现；Step 2: 门禁 + 走查**（教师切态 → 学生端首页卡片即时变化）；**Step 3: 提交**

---

## Task 7: 切换动画

**Files:** `shell/shell.module.css`

§4.6：`transform: translateX()` + `opacity` 横向滑动；两面板动画期共存，**结束后**才给非活动面板加 `visibility:hidden`。Tab 指示器滑块随选中项平移。模块配色：学习单=蓝 / 探究助手=紫 / 学伴=青。

- 只用 `transform` / `opacity`；遵循 `prefers-reduced-motion`
- **§4.11 B6**：标记条等 `fixed` 元素已在 Task 2 portal 化，确认动画期不偏移

- [ ] **Step 1-2: 实现 + 走查**（切换流畅、无闪烁、reduced-motion 下降级为直接切换）；**Step 3: 提交**

> **⚠️ Task 1 审查提出的跨任务约束（Task 7 必查）**：§4.10 C2 警告 `visibility:hidden` 下元素**不可聚焦**、`focus()` 静默 no-op。若动画让**入场**面板在过渡期仍带 `visibility:hidden`（而不是「动画结束才给**离场**面板加」），**切回学伴时键盘将永不弹出** —— 静默退回比基线更差的体验。
> **验收必须包含**：切回学伴后键盘自动弹出。

---

## Task 8: 教师端提示（Ruling 1）+ 认领 §4.11 B5

> **⚠️ T6 审查裁定：§4.11 B5 指派给本任务**（它本来就要改 `teacher/classroom/page.tsx`）。
>
> **B5 是什么**：教师端的 socket 是**模块级单例**（`src/lib/socket.ts:8`），而服务端 `join-teacher-board`（`server/src/socket/index.ts:395`）**只 join 不 leave**。于是**打开课堂 X 的看板、再导航到 Y 的看板，Y 会收到 X 的 `module-state-changed`**（载荷只有 `{ moduleKey, state }`，**没有 `classroomId`**），并在 `teacher/classroom/page.tsx:572-575` 无条件 `applyModuleState` —— **表现为单选按钮选错**。
>
> **⚠️ 但要注意它不污染学生端**（T6 审查澄清）：学生 socket 每次 `startChatSession` 都是**新建并先断开旧连接**（`use-chat-socket.ts:54`），只 join 自己的 `classroom:<id>`。所以这是**教师端独有**的问题。
>
> **修法方向**（实施者自行判断并在报告里说明）：让 `join-teacher-board` 在加入新课堂前离开旧房间，或给载荷加 `classroomId` 并在教师端按 id 过滤。**注意 B5 是既有缺陷、不由 M1b-2 引入**，所以不要为它扩大改动面。

**Files:**

**Files:** Modify `src/app/teacher/classroom/page.tsx`

当三个模块**都**是 `preview` 且该课堂无 `ClassroomModule` 行时，在「模块状态」菜单里显示提示。

⚠️ 教师端目前拿不到「该课堂有没有行」这个信息 —— `GET /:id` 返回的是**补齐后**的三项。**实施者须判断**：是加一个字段（如 `hasModuleRows: boolean`），还是用别的信号。**在报告里说明选法与理由。**

- [ ] **Step 1-2: 实现 + 门禁；Step 3: 提交**

---

## Task 9: 收尾清理

**Files:** `page.tsx` 等

- 删 `page.tsx` 已成摆饰的 `Suspense`（§4.9 ③）
- 删两个死 keyframe（`blink` / `teacherBubbleIn`，已核实全树零引用）
- 核实 `<style>` 块剩余 3 个 keyframe 仍有消费者

**T4 审查补入的清理项：**
- **换头像编排的重复比自报的更大** —— 除编排外，**整个模态外壳的 HTML 与内联样式**（`.modal-overlay` / `.modal-content` / 关闭按钮 / 标题 / 两段提示文案，约 15 行）也是从 `chat-panel.tsx` 逐字复制的
- **双 Toast 重复**
- **锁住卡片的「按下回弹」被层叠顺序吃掉**：`home.module.css` 的 `.card:active` 与 `.cardLocked:hover` **特异性相同**、后者在后 → 指针按下必然同时命中 `:hover`，所以注释承诺的「按下有回弹作为『我收到了』的反馈」**实际完全不生效**。修法：`.cardLocked:not(:active):hover`，或删掉那句承诺
- **零智能体课堂的兜底文案不一致**：首页用 `'智能学伴'`、学伴面板用 `'AI 学习助手'`，且卡片 label 已是「智能学伴」→ 会出现同名两行

**T6 审查补入的清理项：**
- **陈旧轮询响应可盖掉更新的广播**（`use-classroom-session.ts:275-283`）。现有的对象身份守卫**只避免每 15 秒换对象导致整树重渲染**，**不比较新旧**——广播刚把 X 改成 `hidden`、随后到达的旧快照轮询说 `open`，照样写回旧值。概率约每次改态 0.1%（`/api` 全量 `no-store`，所以响应必为读时刻的新值），15 秒内自愈，且**同形状已存在于 M1b-1 的 connect 补读**。**修法 3 行**：发起请求前把 `classroom.modules` 的对象身份存进 ref，响应落地时若 `prev.modules !== 发起时的引用` 就跳过本次合并
- **守卫比较的是硬编码的两个键**（`:280-281`）。今天等价于整元素比较（该类型只有两个字段），但将来加第三个被 UI 读取的字段时，守卫会**静默压掉**合法更新。改为比较整元素，或加注释点名这个耦合
- **「面板里不得再有定时器」缺永久闸门**。实质边界已由编译器把守（面板拿不到生命期能力），残余风险只是「将来有人用面板里仍在的 `api` + `code` 重新长一条定时器」。建议在 `eslint.config.mjs` 加一个 scoped block（`files: ["src/app/classroom/chat/**/*.{ts,tsx}"]` + `no-restricted-syntax` 禁 `setInterval`），约 5 行

- [ ] **Step 1-2: 实现 + 门禁；Step 3: 提交**

---

## Task 10: 全量人工走查 + 真机性能门槛（**验收关卡，需要用户**）

**这是唯一的验收关卡**，之前所有任务的走查都已合并到这里。

### 10.1 功能走查（任意浏览器）

> **⚠️ 以下 8 条由 Task 1 审查补入（原先遗漏）。** Task 1 的五处门控是本里程碑风险最高的一步，而 `active` 直到 Task 5 才接真实值 —— **不把这些步骤并入验收，Task 1 的载荷在 Task 10 之前完全不被执行**。逐条按 Task 1 报告 §2.6 的原文执行：
>
> 1. 切到别的 tab 再切回**三次**，在控制台确认 `document.body.style.overflow` 仍是切走前的值（不是 `hidden`）
> 2. 上述操作后**整个外壳仍能正常滚动**（这是「永久锁死」的直接判据）
> 3. 打开一张消息里的图片 → 切走 → **滚轮仍能滚动外壳**（预览器的 `preventDefault` 未泄漏）
> 4. 在学伴里点开输入框 → 切走 → **键盘不应弹出**（`autoFocus` 已删）
> 5. 切回学伴 → **键盘应自动弹出**（`active` 上升沿聚焦生效）
> 6. 打开教师消息弹层 → 切走 → 点页面其他位置 → 弹层不应被隐藏状态下的残留监听关闭
> 7. 打开全屏图片 → 切走 → 切回 → **ESC 仍能关闭**、缩放拖拽正常
> 8. 拖拽图片过程中切走 → 切回 → **图片不应跳到原点**（Task 2 一并修的 Minor 3）
>
> **另外，Task 5 的验收必须断言**：外壳确实传入了**会变化的** `active`。`active?` 是 fail-open 的可选 prop —— Task 5 一旦忘传，五处门静默退回空操作，**且无任何编译期信号**。
>
> **并且断言 `active` 的语义边界**：只要当前可见画面**不是**该模块（首页、身份页、课堂已结束等），`active` 必须是 `false`。否则五个浮层会压住首页**与身份页**（§4.10 C.7 点名担心的正是这两处）。

> **⚠️ Task 2 审查补入：五个浮层的可见性走查（原计划遗漏）**
> Task 2 的核心新行为是「非 `active` 时五个浮层不得出现在首页/其它 tab 之上」，而上面 8 条**一条都没覆盖它**。逐条按 Task 2 报告 §5.2 执行，**但注意第 3 条会假通过**：
>
> - **主判据用长寿命浮层**（全屏查看器、头像模态）：打开 → 切走 → **不得出现在首页之上**（走查 §5.2 第 1–2 条）
> - **Toast 那条只作补充**：它有 3 秒自动关闭定时器且隐藏期间照跑 —— 走查者慢过 3 秒就会看到「什么都没有」并误判通过。**要么用 devtools 直接改 `visibility` 验证，要么跳过这条**
> - **`backdrop-filter` 推断的判据（一眼可辨）**：打开全屏查看器，遮罩**是否铺满整个视口**。若今天就没铺满，那是 2026-07-16 `03e7355` 引入的**既有缺陷**，非本里程碑引入 —— portal 后应当修好
> - **独立佐证（同一次走查可顺手确认）**：开着全屏查看器时把鼠标移到右侧标记点上 —— tooltip **不应**画在「全屏」遮罩之上

> **⚠️ Task 4 审查补入：首页新 UI 面的四条走查（原计划遗漏）**
> 它们覆盖的是 T4 新写的代码路径，不是已有面：
> - **三张卡全 `hidden` 时的空状态**（`cards.length === 0` 是独立的代码路径，不是「三张卡都灰」）
> - **首页的换头像模态 + token 门禁**（头像可点与「机会由老师奖励」的文案切换）
> - **「退出课堂」入口**（T4 新加，§4.2 未画）
> - **窄屏 860px / 640px 下卡片转横排且无横向滚动** —— 这是 T4 新写的响应式分支，**也正是老 iPad 的主场景**

> **⚠️ T6 审查补入：一条负向断言（上面全是正向的）**
> T6 新加了「只在 `step === 'chat'` 时才轮询」的行为边界。**必须验证它不跑**：停在**身份选择页**时，Network 面板里**不应出现** `classroom/code/...` 请求。这条一旦被放宽，身份页会与「课堂结束就地提示」的设计打架。**一次就能看，且是唯一能守住该边界的走查。**

> **⚠️ T7 审查补入：切换动画的已知行为与一条「不许走的修法」（原计划遗漏）**
>
> **一、上面第 5 条（切回学伴 → 键盘应自动弹出）现在是唯一的高风险验收项，且它的失败症状会误导人。**
> T7 把聚焦时机从点击后 ~16ms 推迟到 **~280ms**（因为要等滑动就位才聚焦——这是约束 ② 的正确代价）。T7 没有浏览器，**无法确认 iOS 在 280ms 延迟下是否仍接受 `focus()` + readOnly 技巧**。所以：
> - 若键盘**不弹**，先按下面第二点的处置走，**不要**当成「聚焦逻辑写错了」去改。
> - **绝对禁止**的修法：把入场层改成 `visibility:hidden` 来「让聚焦更早」。那会直接牺牲硬约束 ①（入场层过渡期必须可见），代价远大过它解决的问题。
>
> **二、失败时的处置（T7 报告 §5.1 原文，这里提升为验收清单的一部分）**：
> 回退到「`active` 立即翻真 + 面板侧 `animationend` 重测」。**但要注意它有两个坑，所以不要盲目回退**：
> - (a) 它需要新的跨界管线——`animationend` 只在层的 `<section>` 上触发，**面板拿不到该元素的 ref**（只能监听自己 root 上冒泡的事件，那是新的隐式耦合，而 §4.10 B 把「呈现」判给了外壳）；
> - (b) **`animation: none` 下根本不触发 `animationend`**——reduced-motion 用户会**永久**拿不到重测。
> **结论：现方案在 (b) 这点上严格优于备选方案**（读计算时长对降级天然免疫）。回退前先想清楚 reduced-motion 路径怎么补。
>
> **三、指示器药丸是本次交付的核心新 UI，第一眼看这里**：切换时药丸应**贴着栏内垂直居中**（T7 审查判定原先的 `top: 8px` 偏低 8px，已修）；选中文字的对比度应 ≥4.5:1（原先是 #2563eb/#7c3aed/#0e7490 落在 16% 模块色药丸上，约 4.13/4.48/4.29，**未达标**，已修）。若这两条里任一在真机上仍不对劲，是 T7 收口的回归。
>
> **四、两条已知行为，不是缺陷，别误报**：
> - **快速连点 Tab 会跳变**：CSS 动画不保留中断时刻位置，被重挂动画的层会跳回 `translateX(0)`。T7 审查确认机理成立，**本里程碑不修**。
> - **`.stage{overflow:hidden}` 是为了挡住 `transform` 溢出导致的页面级横向滚动**（T7 加的，不在原计划里）。顺带确认：**外壳不应出现被残留的横向滚动偏移**（即左右滑动 stage 内容不应让它停在偏移位置）。

- [ ] 输码 → 身份选择 → **进入首页**（不再是直接进聊天）
- [ ] 首页三张卡片：三态三种呈现都对（开放可点 / 预告灰掉带锁 / 隐藏不显示）
- [ ] 点「智能学伴」→ 进入聊天；点「首页」→ 回门户；**再进聊天，之前的草稿与消息都还在**
- [ ] 顶部 Tab 栏切换三个模块，**动画流畅、内容保留**
- [ ] 只启用一个模块时 Tab 栏不显示
- [ ] 教师改态 → 学生端**即时**变化（首页卡片 + Tab 栏同步）
- [ ] 学生在某模块时教师把它设为 `hidden` → **提示 + 回首页，内容不丢**
- [ ] 刷新页面 → 仍能恢复、首页三态正确

### 10.2 真机性能门槛（**硬门槛，必须真机**）

| 指标 | 阈值 |
|---|---|
| 首屏可交互 | ≤ 3s |
| 首页 ↔ 模块、模块互切 | ≤ 300ms |
| 三模块全挂载后内存 | ≤ 150MB |
| 探究助手 iframe 空闲 CPU | ≈ 0%（本任务无 iframe，此项留到 M2） |

**不达标就回头改外壳架构**，不带着问题进入 M2/M3。

### 10.3 汇报

走查与真机数据一并写入报告，向用户汇报，**征得同意后才合并**。

---

## 完成后

M1b-2 交付后，三件套外壳完整可用：首页 + 三 Tab + 三态 + 挂载管理 + 动画，且经真机性能验证。

**后续**：M2（探究助手：上传托管 + 源隔离 + SDK + 监控链路）、M3（学习单：数据模型 + 题型注册表 + 编辑器 + 作答端）、P3 收口。届时把占位面板换成真实模块即可 —— 外壳契约不变。
