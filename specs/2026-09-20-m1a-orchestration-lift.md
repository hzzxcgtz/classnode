# M1a：学生端编排上移 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `src/app/classroom/chat/chat-panel.tsx`（1500 行）里的**页面编排职责**上移到 `page.tsx`，使它收敛为一个**接收 props、不含整页导航、不含 identity/loading 分支**的模块面板 —— 为 M1b 的三件套外壳提供可挂载的容器。

**Architecture:** 纯重构，**零行为变更**。沿用 M0 的纪律：先搬叶子与状态、再抽 hook、每步机械可验证。不同的地方在于：这次动的是**状态所有权**（谁持有 `step`/`code`/`classroom`），比 M0 的搬家更容易引入看不见的时序问题，所以每个任务都要跑完整门禁 + 人工走查。

**Tech Stack:** Next.js 15（Webpack，`output: 'export'` 静态导出）、React 18、TypeScript strict、CSS Modules、socket.io-client（动态 import）。

**Spec:** `specs/2026-09-19-classnode-learning-suite-design.md`（§4.1 目标结构、§4.2 首页、§4.5 挂载管理、§4.7 Safari 15 约束、**§4.9 M0 交付后的实况核对**）

---

## 🔴 Step 0（门禁）：必须先新开分支

**用户明确要求：开始写代码前一定要新开分支。** M0 是在 `feat/classroom-suite` 上做的（已合并入 `main` 并删除），M1a **不得**直接在 `main` 上实施。

执行任何代码改动之前，先确认：

```bash
cd /Users/zxc/myprojects/classnode
git branch --show-current          # 必须是 main（干净起点）
git status --short                 # 应只有用户的 CLAUDE.md / dev.sh / package.json 三个未提交改动
git checkout -b feat/m1a-orchestration-lift
git branch --show-current          # 必须显示 feat/m1a-orchestration-lift
```

**未确认在特性分支上时，不得开始 Task 1。** 这条不是提醒，是门禁。

---

## Global Constraints

以下约束适用于**每一个**任务：

1. **零行为变更。** 不改任何 UI、文案、样式、事件时序、DOM 层级、请求时机。
2. **不得出现 regex lookbehind**（`(?<=` / `(?<!`）。
3. **不得使用 Safari 15 不支持的语法**：`:has()`、`content-visibility`、`@container`、`Object.hasOwn`、`structuredClone`、`Array.prototype.at` / `findLast`、`dvh` 单位、`:focus-visible`。
4. **动画只用 `transform` / `opacity`**，遵循 `prefers-reduced-motion`。（M1a 不新增动画，此条为 M1b 预置。）
5. 提交信息用中文，格式 `refactor(classroom): <做了什么>`。
6. **不动 `main` 之外的任何分支**；**不碰用户的 `CLAUDE.md` / `dev.sh` / `package.json`**（它们会一直处于未提交状态，属用户自己的工作）。

### 基线（M1a 开始前实测）

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | 退出码 0，**0 行输出** |
| `npx eslint src/app/classroom/` | 退出码 0，**恰好 1 条 warning** |
| `pnpm build` | 退出码 0，`[browser-compat] 学生端首屏 9 个脚本通过 Safari 15 语法检查` |
| `pnpm test` | 32 项全过 |

那条 warning 是 `'tokenData' is assigned a value but never used`，位于 `src/app/classroom/identity/use-student-session.ts:110:50`。**它必须依然存在且仍只有这一条**，不算新增告警。

### 每个任务的验证循环

```bash
npx tsc --noEmit; echo "tsc 退出码: $?"
npx eslint src/app/classroom/; echo "eslint 退出码: $?"
pnpm build; echo "build 退出码: $?"
```

**`pnpm build` 是必做项**（抓 Server/Client 边界与 Safari 兼容）。

⚠️ **`pnpm build` 有 `prebuild` 钩子会跑 `sync-version.mjs`**，它会改写被跟踪文件（幂等，当前版本已同步所以是空操作）。**任何时刻只允许一个 `pnpm build` 在跑** —— 并发构建会互相破坏 `.next/` 与 `out/`。控制器在派发实施者期间**不得**并行跑构建。

**这套检查抓不到的**：DOM 层级变化、effect 依赖变化、闭包捕获过期值、状态所有权转移后的时序问题。**只能靠运行时走查**——见每任务的走查步骤与 Task 5。

---

## 目标结构（M1a 结束时）

```
src/app/classroom/
├── page.tsx                       # ★ 编排者：step 状态机 + loading/identity 分支 + 挂载 ChatPanel
├── use-classroom-session.ts       # ★ 会话/课堂状态与加载逻辑（新 hook）
├── classroom-types.ts             # + 新增外壳类型（ClassroomInfo / StudentSession / ChatPanelProps）
├── avatar-utils.ts                # 不变
├── use-is-mobile.ts               # 不变
├── identity/
│   ├── identity-picker.tsx        # 不变（已完全 prop 驱动）
│   └── use-student-session.ts     # 不变（M1a 只改它的调用方）
└── chat/
    ├── chat-panel.tsx             # ★ 收敛为接收 props 的面板
    └── …（其余 9 个文件不变）
```

**M1a 明确不做**（留给 M1b）：`home/`、`shell/`、`ModuleState` 三态、`active` prop、Tab 栏、切换动画、DOM 保留策略、首屏性能门槛。

---

## 三个来自代码地图的关键事实（写计划前必须先读）

这三条决定了任务怎么切，写在这里以免实施者重新发现：

**① `useChatSocket` 不上移（Ruling A）。** 它是**学伴模块自己的 socket**，且 `messages` 的全部 16 处写入都在它内部。硬上移到外壳会让 `messages` 无处安放。正确做法是**把外壳关心的部分换成回调**：去掉 options 里的 `router`(:15) 与 `setStep`(:37)，换成外壳提供的 `onSessionInvalid` / `onClassroomEnded`。**其余 8 个 ref 继续按 `{ current: T }` 透传**（M0 的 Ruling 8 已证明搬到 hook 里会让 `page.tsx` 拿到另一个 ref 对象而静默失效）。

**② `step` 的取值 M1a 保持 `'loading' | 'identity' | 'chat'` 不变。** §4.9 提到的 `'home' | 'shell'` 是 M1b 的事；M1a 是纯重构，不改状态机语义。

**③ `overflow` effect 的还原不是幂等的。** `chat-panel.tsx:152-153` 快照 `document.body.style.overflow` / `documentElement.style.overflow`，`:195-196` 还原。**M1a 不碰它**（它是 M1b 的 `active` 门要处理的对象），但实施者要理解：任何"先快照后还原"的 effect 在依赖变化重跑时，第二次快照到的值可能是上一次改过的——M1b 必须为此重新设计。

---

## Task 1: 定义外壳类型与面板契约

**Files:**
- Modify: `src/app/classroom/classroom-types.ts`（追加，不改动已有 16 个导出）
- Test: 无（纯类型，靠 `tsc` 验证）

**Interfaces:**
- Consumes: 已有的 `StudentChatMessage`、`ChatAgent`；`@/lib/types` 的 `StudentClassroom`、`ClassroomStudentSummary`、`AvatarSummary`
- Produces:
  - `ClassroomInfo` — 外壳持有的课堂信息（`StudentClassroom` 的别名，或按需收窄）
  - `StudentSession` — 外壳持有的学生身份（`ClassroomStudentSummary`）
  - `ChatPanelProps` — 面板契约（见下）

**为什么先做这个：** `ClassroomInfo` / `StudentSession` / `ModulePanelProps` **在整个 `src/` 中不存在**（只写在做设计文档里）。先落类型、后改实现，可以让后续每个任务都有编译器兜底。

- [ ] **Step 1: 确认要用的既有类型**

```bash
cd /Users/zxc/myprojects/classnode
grep -n "export interface StudentClassroom\|export interface ClassroomStudentSummary\|export interface AvatarSummary" src/lib/types.ts
grep -n "^export" src/app/classroom/classroom-types.ts
```

- [ ] **Step 2: 在 `classroom-types.ts` 末尾追加三个类型**

（具体字段以 Step 1 的 grep 结果为准；下面是形状，实施者按实际类型补齐）

```ts
/** 外壳持有的课堂信息。M1a 先用 StudentClassroom 的别名，M1b 需要时再收窄。 */
export type ClassroomInfo = StudentClassroom;

/** 外壳持有的学生身份。 */
export type StudentSession = ClassroomStudentSummary;

/** 学伴模块面板的契约。M1b 会在此基础上加 active / state 两个字段。 */
export interface ChatPanelProps {
  code: string;
  classroom: ClassroomInfo | null;
  selectedStudent: StudentSession | null;
  avatarSvgs: Record<number, string>;
  avatarTokenCount: number;
  teacherMsgs: { message: string; time: string }[];
  setClassroom: (value: ClassroomInfo | null) => void;
  setAvatarTokenCount: (value: number) => void;
  setTeacherMsgs: (value: { message: string; time: string }[]) => void;
  /** 会话失效（student-auth-error）—— 外壳负责清会话并回到身份选择。 */
  onSessionInvalid: () => void;
  /** 课堂结束 —— 外壳负责收尾与导航。 */
  onClassroomEnded: () => void;
}
```

**注意**：`chat-panel.tsx` 仍需要 `loadClassroom` / `loadMessages` / `startChatSession` 等逻辑。**这些先不进契约** —— 它们要么随 Task 2 上移，要么在 Task 2/3 中确定为面板内部实现。**Task 1 只落最小契约，Task 2 会按实际需要补齐。** 不要提前设计。

- [ ] **Step 3: 验证**

```bash
npx tsc --noEmit; echo "tsc 退出码: $?"
npx eslint src/app/classroom/; echo "eslint 退出码: $?"
```

`tsc` 必须退出 0 零输出；`eslint` 必须仍是恰好 1 条 warning。**若 `ClassroomInfo` 报 `StudentClassroom` 未定义，说明忘了在文件顶部加 `import type`。**

- [ ] **Step 4: 提交**

```bash
git add src/app/classroom/classroom-types.ts
git commit -m "refactor(classroom): 新增外壳类型与面板契约"
```

---

## Task 2: 抽出 `useClassroomSession`，把 `step` 状态机与 loading/identity 分支上移到 `page.tsx`

**Files:**
- Create: `src/app/classroom/use-classroom-session.ts`
- Modify: `src/app/classroom/page.tsx`（26 行 → 编排者）
- Modify: `src/app/classroom/chat/chat-panel.tsx`（收敛为面板）

**Interfaces:**
- Consumes: Task 1 的 `ClassroomInfo` / `StudentSession` / `ChatPanelProps`
- Produces: `useClassroomSession(options)` → `{ step, code, classroom, selectedStudent, students, identitySearch, onlineStudentIds, joiningClassroom, loadError, avatarSvgs, allStudentAvatars, avatarTokenCount, teacherMsgs, …setters, loadClassroom, loadMessages, handleIdentityConfirm, handleSwitchIdentity, handleExit, fetchStudentTokens }`

**这是 M1a 的核心任务，也是最大的一个。** 它重构的是**状态所有权**，不是搬家。

### 要上移的东西（行号以当前 `chat-panel.tsx` 为准）

**状态**（`chat-panel.tsx:24-80` 区间）：`code`(26)、`step`(28)、`joiningClassroom`(29)、`classroom`(30)、`students`(31)、`avatarSvgs`(32)、`avatarTokenCount`(33)、`allStudentAvatars`(35)、`selectedStudent`(36)、`identitySearch`(37)、`loadError`(51)、`teacherMsgs`(54)、`onlineStudentIds`(79)

**Refs**（按 `{ current: T }` 透传，不搬声明）：`seenNotifIdsRef`(95)、`statusSocketRef`(80)

**逻辑**：`loadClassroom`(395-419)、`loadMessages`(428-451)、`handleIdentityConfirm`(602-636)、`handleSwitchIdentity`(538-552)、`handleExit`(583-591)、`fetchStudentTokens`(594-600)

**Effect**：`loadError → step`(422-426，deps `[loadError, step]`）、identity 状态 socket(495-523，deps `[step, classroom?.id, SOCKET_URL]`）、挂载恢复(531-536，deps `[]`)

**分支**：`step === 'loading'`(777-786)、`step === 'identity'`(788-805)

**留在面板的**：`messages`(38)、`loadingMessages`(39)、`input`/`waitingAI`/`streamingContent`/`thinkingContent`(40-43)、`connected`(44)、`uploading`/`attachedFiles`(45-46)、`paused`(47)、`agentDisabled`(48)、`shieldWarning`(49)、`blacklisted`(50)、`connectionError`(52)、`toast`(53)、`showTeacherPanel`/`teacherNotifBubble`/`fullscreenImg`/`zoomLevel`/`imgOffset`(55-59)、markers 组(65-68)、`showScrollBtn`(78)、`showAvatarChanger`(34)，以及 `useChatSocket`(120-131) 与 `useVoiceInput`(142)。

- [ ] **Step 1: 用命令核实现状，不要凭记忆**

```bash
cd /Users/zxc/myprojects/classnode
wc -l src/app/classroom/chat/chat-panel.tsx src/app/classroom/page.tsx
echo "=== chat-panel 的 useState ==="
grep -nE "^\s+const \[[a-zA-Z]+," src/app/classroom/chat/chat-panel.tsx | head -60
echo "=== chat-panel 的全部 useEffect 与依赖数组 ==="
grep -nE "^\s+\}, \[|^\s+\}, \[\]\)" src/app/classroom/chat/chat-panel.tsx
echo "=== 组件级 early return ==="
grep -nE "^  (if \(step ===|return \()" src/app/classroom/chat/chat-panel.tsx
echo "=== page.tsx 全文 ==="
cat src/app/classroom/page.tsx
```

**行号与上面的清单不一致时，以命令输出为准。** 计划的行号来自一次代码地图，可能已漂移。

- [ ] **Step 2: 创建 `use-classroom-session.ts`**

按项目既有 hook 惯用法（见 `identity/use-student-session.ts:24-25`、`chat/use-chat-socket.ts:47-48`）：

```ts
import { useEffect, useRef } from 'react';

export interface ClassroomSessionOptions {
  router: { push: (href: string) => void };
  // …其余按 Step 1 的实测结果补齐
}

export function useClassroomSession(options: ClassroomSessionOptions) {
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  // 上移的状态在这里声明；上移的逻辑在这里定义
  // 面板仍需要的部分通过返回值暴露

  return { /* … */ };
}
```

**关键约束**：
- `optionsRef` 惯用法必须与既有两处**完全一致**（无依赖数组的裸 effect）。
- **hook 调用顺序**：`useChatSocket` 目前要求在 `useStudentSession` 之前（`chat-panel.tsx:117-119` 有注释说明）。上移后这个约束转移到 `page.tsx` —— **必须同样满足**，且实施者要指出用什么行号证明。
- **`IdentityPicker` 是完全 prop 驱动的**（`identity/identity-picker.tsx:6-19`，12 个 props），上移后调用点在 `page.tsx`，props 来源改为外壳状态。它内部的 `useRouter()`(:35) 与 `useIsMobile()`(:36) **不动**。

- [ ] **Step 3: 改写 `page.tsx` 为编排者**

`page.tsx` 变成：调 `useClassroomSession` → 按 `step` 渲染 loading / `<IdentityPicker>` / `<ChatPanel>`。

**必须保留**：`page.tsx:9-20` 的 `<style>` 块**逐字不动**（`blink`/`thinkingWave`/`teacherBubbleIn`/`notifSlideUp`/`spin` 五个 keyframe，其中 `thinkingWave`/`notifSlideUp`/`spin` 被 `chat/` 下的组件引用）。**`page.tsx:21-23` 的 `Suspense` 包装保留**（§4.9 说它已成摆设，但删它是 M1b 的事，M1a 零行为变更）。

- [ ] **Step 4: 改写 `chat-panel.tsx` 为面板**

`export function StudentChatContent(props: ChatPanelProps)`，删除已上移的状态/逻辑/分支，只保留 `'chat'` 分支的渲染与模块自身状态。

- [ ] **Step 5: 验证（三项门禁）**

```bash
npx tsc --noEmit; echo "tsc 退出码: $?"
npx eslint src/app/classroom/; echo "eslint 退出码: $?"
pnpm build; echo "build 退出码: $?"
```

- [ ] **Step 6: 人工走查（本任务必做，最重）**

`./dev.sh start`，然后**逐项确认**：

- [ ] `/` 输 4 位码 → 跳转、loading 态正常显示「正在连接课堂...」与互动码
- [ ] 身份选择页：列表、头像、在线置灰、搜索（>8 人时）、选中高亮、确认进入
- [ ] 身份页「退出」回 `/`；错误态的「返回首页」回 `/`
- [ ] **刷新页面**（带着 localStorage 会话）→ 自动恢复并直接进入聊天页
- [ ] **带 `?code=` 直接访问** → 正常加载
- [ ] **不带任何参数访问 `/classroom`** → 跳回 `/`
- [ ] 聊天页：连接徽章「已连接」、发消息、流式回复、停止生成
- [ ] 顶部栏「切换用户」回身份页；「退出」回 `/`
- [ ] 聊天页错误态的重试卡片仍可用

**任何一项不通过就先修复，不得进入 Task 3。**

- [ ] **Step 7: 提交**

```bash
git add src/app/classroom/
git commit -m "refactor(classroom): 上移编排职责，chat-panel 收敛为面板

- 新建 use-classroom-session.ts 承载会话/课堂状态与加载逻辑
- page.tsx 成为 step 状态机与 loading/identity 分支的编排者
- chat-panel 改为接收 ChatPanelProps 的面板
- <style> 块与 Suspense 保留在页面级"
```

---

## Task 3: `useChatSocket` 回调化（Ruling A）

**Files:**
- Modify: `src/app/classroom/chat/use-chat-socket.ts`
- Modify: `src/app/classroom/chat/chat-panel.tsx`（调用点）
- Modify: `src/app/classroom/page.tsx`（提供回调）

**Interfaces:**
- Consumes: Task 2 的外壳
- Produces: `ChatSocketOptions` 去掉 `router` / `setStep`，新增 `onSessionInvalid: () => void` 与 `onClassroomEnded: () => void`

**为什么这么做：** M0 的最终审查指出 `useChatSocket` 的 options 里 `router`(:15) 与 `setStep`(:37) 是**外壳职责**（模块不该决定整页导航与流程状态）。但整体上移该 hook 会让 `messages`（16 处写入都在 hook 内）无处安放。回调化是两者之间的正确切法。

- [ ] **Step 1: 定位这两个字段的全部使用点**

```bash
cd /Users/zxc/myprojects/classnode
echo "=== router 的使用点 ==="
grep -n "router\|optionsRef.current.router" src/app/classroom/chat/use-chat-socket.ts
echo "=== setStep 的使用点 ==="
grep -n "setStep" src/app/classroom/chat/use-chat-socket.ts
echo "=== 对应用户可见行为 ==="
grep -n "student-auth-error\|classroom-ended" src/app/classroom/chat/use-chat-socket.ts
```

**以输出为准。** 已知：`router` 用于 `classroom-ended` 的整页跳转；`setStep` 用于 `student-auth-error`（回到身份页）与 `identity-conflict`（死代码，见下）。

- [ ] **Step 2: 替换为回调**

把 `optionsRef.current.router.push('/')` 改为 `optionsRef.current.onClassroomEnded()`；把 `setStep('identity')` 改为 `optionsRef.current.onSessionInvalid()`。**回调体内的逻辑原样搬进 `page.tsx` 提供的实现**（那里已有等价的处理：断 socket、清 localStorage、`setStudentSessionToken()`、`setStep('identity')`）。

**`identity-conflict` handler（`use-chat-socket.ts:157-172`）是死代码** —— 服务端自 v1.3.5 起改发 `ai-error`（`grep -rn "identity-conflict" server/src/` 零命中）。**M1a 不删它**（删就是行为变更，虽然不可达），只把它的 `setStep` 一并换成回调。删它记入 M1b。

- [ ] **Step 3: 验证 + 走查**

跑三项门禁，然后走查：

- [ ] 正常发消息、收回复、停止生成
- [ ] **教师端结束课堂** → 学生端应跳回 `/`（这条验证 `onClassroomEnded`）
- [ ] **构造会话失效**：在另一个标签页用同一学生身份进入（或手动清掉服务端 token）→ 学生端应回到身份选择页（这条验证 `onSessionInvalid`）。**若不便构造，在报告中注明未验证，不要声称验证过。**

- [ ] **Step 4: 提交**

```bash
git add src/app/classroom/
git commit -m "refactor(classroom): useChatSocket 的整页导航与流程状态改为外壳回调"
```

---

## Task 4: 上移 top bar、retry card 与相关 handler

**Files:**
- Modify: `src/app/classroom/chat/chat-panel.tsx`
- Modify: `src/app/classroom/page.tsx`

**Interfaces:**
- Consumes: Task 2/3 的产物
- Produces: 面板不再包含任何整页导航的 UI

**要上移的三块**（行号以 Task 2 后的实测为准）：

1. **top bar**（原 `810-914`）—— 含「切换用户」(→`handleSwitchIdentity`，`setStep('identity')`) 与「退出」(→`handleExit`，`router.push('/')`)。两者都是整页导航。
2. **retry card**（原 `922-975`）—— 「重试」按钮读 `window.location.search`、调 `loadClassroom`/`loadMessages`/`startChatSession`、`setStep('identity')`；「返回首页」调 `handleExit`。**这是渲染在模块 DOM 里的页面编排。**
3. **`handleRevise` 等不导航但跨界面的 handler** —— 逐个判断：只写模块状态（`input`/`attachedFiles`）的留下，读写会话状态的随之上移。

**注意：top bar 上移后，消息区的可用高度会变。** 原 `.chatShell` 是 `display:flex; flex-direction:column`，top bar 是它的第一个子元素。上移后要么把它们放进同一个 flex 容器（`page.tsx` 的编排层），要么把 top bar 留在面板内但把导航 handler 换成 props 回调。

**推荐后者**（改动小、DOM 层级不变、零视觉风险）：**top bar 的 JSX 留在面板内，只把 `handleSwitchIdentity` / `handleExit` 换成 props 回调**。只有当某个 UI 块完全不属于模块时才上移 DOM。

**实施者须在报告中说明每块采用了哪种处理及理由。** 若判断 DOM 层级变化不可避免，先报 NEEDS_CONTEXT。

- [ ] **Step 1: 逐块判断并实施**

- [ ] **Step 2: 验证 + 走查**

三项门禁 + 走查：顶部栏显示正常、智能体名与头像正确、学生名牌可点开换头像、「切换用户」回身份页、「退出」回 `/`、聊天页错误态重试可用。

- [ ] **Step 3: 提交**

```bash
git add src/app/classroom/
git commit -m "refactor(classroom): top bar 与 retry card 的整页导航职责外移"
```

---

## Task 5: 全量人工回归走查（M1a 验收关卡）

**Files:** 无（纯验证）

`tsc` / `eslint` / `pnpm build` 全程会过，但它们**抓不到**状态所有权转移引入的时序问题。只有这一关能抓。

- [ ] **Step 1: 干净启动**

```bash
./dev.sh stop
./dev.sh start
./dev.sh status
```

- [ ] **Step 2: 逐项走查（对照 M0 验收时的行为）**

**进入课堂**
- [ ] `/` 输 4 位码 → 跳转、loading 正常
- [ ] 身份页：列表、头像、在线置灰、搜索、选中高亮、确认、退出、错误态的「返回首页」
- [ ] 确认后进入聊天页

**会话恢复（状态所有权转移风险最高的地方）**
- [ ] 走路身份确认后**刷新页面** → 自动恢复进聊天页
- [ ] 清掉 localStorage 后带 `?code=` 访问 → 进身份选择页
- [ ] 不带参数访问 `/classroom` → 跳回 `/`
- [ ] 手动把 localStorage 里的 `timestamp` 改成 3 小时前 → 刷新后回身份选择页（2 小时 TTL）

**聊天主链路**
- [ ] 连接徽章「已连接」；发消息 → 气泡 → 流式回复 → 落入列表
- [ ] 流式中「停止」能中止；深度思考块可展开/收起
- [ ] 追问建议可点；「修改」把内容放回输入框

**顶部栏与导航**
- [ ] 智能体头像与名称；学生名牌 + 换头像次数；换头像后顶部与消息列表同步
- [ ] 教师消息按钮：有消息时显示，点击展开，点外关闭
- [ ] 「切换用户」回身份页；「退出」回 `/`

**消息区**
- [ ] 滚动标记条出现、可跳转、悬停 tooltip
- [ ] 「回到底部」按钮出现且生效
- [ ] 图片点击全屏，可缩放、拖拽、ESC 关闭

**输入区**
- [ ] 上传附件（含 WebP）；超 5 个被拒；可删除
- [ ] 语音按钮在有支持的浏览器里出现并能用
- [ ] Enter 发送 / Shift+Enter 换行；**中文输入法组合态按 Enter 不误发送**

**状态提示**
- [ ] 屏蔽词警告、课堂暂停提示、智能体停用提示

**跨端（需同时开教师端）**
- [ ] 教师暂停/恢复 → 学生端提示正确且输入被禁用
- [ ] 教师结束课堂 → 学生端跳回 `/`
- [ ] 教师发通知 → 学生端气泡出现

- [ ] **Step 3: 记录结果并提交**

```bash
npx tsc --noEmit; echo "tsc: $?"
npx eslint src/app/classroom/; echo "eslint: $?"
pnpm test 2>&1 | tail -5
git log --oneline main..HEAD
```

预期：`tsc` 退出 0 零输出；`eslint` 恰好 1 条 warning；`pnpm test` 32 项全过。

**任何一项走查不通过都必须先修复，不得带着问题进入 M1b。**

---

## 完成后

M1a 交付：`page.tsx` 成为编排者（约 200-300 行），`use-classroom-session.ts` 承载会话逻辑，`chat-panel.tsx` 从 1500 行降到约 **1100-1200 行**（`messages`、composer、消息渲染仍是它的主体 —— 这是有意为之，M1b 会把它们切成更小的子组件）。

**M1b 接手的事**（不在本计划内）：
- 三态后端（`ClassroomModule` 表 + `PUT /:id/modules/:moduleKey` + 双发广播 + schema 同步 + 老课堂默认态兜底）
- 教师端三态控制 UI
- 学生端首页（常驻门户）
- `shell/` 容器 + `active` prop + 挂载管理 + 切换动画
- **§4.9 列出的五处页面级副作用加 `active` 门**（注意：地图实际找到**五**处，§4.9 只列了三处 —— 遗漏的第四处是全屏图片查看器的 `wheel` 监听用了 `preventDefault`，第五处是挂载时会话恢复 effect 会重跑）
- **`overflow` effect 的幂等性重设计**（当前先快照后还原，加 `active` 门而不重新设计会永久锁死 `<body>` 滚动）
- `position: fixed` 子元素（标记条、tooltip）在 `transform` 容器内的定位重算
- `.chatShell` 的 `height: 100vh/100dvh/var(...)` 改为容器相对
- 删 `page.tsx` 的 `Suspense` 与两个死 keyframe（`blink` / `teacherBubbleIn`）
