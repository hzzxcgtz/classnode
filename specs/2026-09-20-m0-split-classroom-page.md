# M0：拆分 `src/app/classroom/page.tsx` 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 2495 行的 `src/app/classroom/page.tsx` 拆成职责单一的多文件结构，**不改变任何行为**，为 M1 的三件套外壳提供可挂载的容器。

**Architecture:** 纯机械重构。先搬零风险的叶子组件（它们之间依赖清晰），再抽取需要重构 state 边界的部分（identity 分支、socket、语音、图片查看器）。每个任务结束都必须通过 `tsc --noEmit` 且不新增 ESLint 告警。**本里程碑不新增任何功能、不改任何 UI、不动任何交互逻辑。**

**Tech Stack:** Next.js 15（Webpack，`output: 'export'` 静态导出）、React 18、TypeScript strict、CSS Modules、socket.io-client（动态 import）、Node 内置测试运行器（仅服务端，本次不涉及）。

**Spec:** `specs/2026-09-19-classnode-learning-suite-design.md`（重点看 §4.1 目标结构、§4.7 Safari 15 约束）

---

## Global Constraints

以下约束适用于**每一个**任务，不再逐条重复：

1. **零行为变更。** 不改任何 UI、文案、样式、事件时序、DOM 层级、请求时机。搬家就是搬家。
2. **不得出现 regex lookbehind**（`(?<=` / `(?<!`）。`scripts/check-classroom-browser-compat.mjs` 会在 `pnpm build` 时失败。
3. **不得使用 Safari 15 不支持的语法**：`:has()`、`content-visibility`、`@container`、`Object.hasOwn`、`structuredClone`、`Array.prototype.at` / `findLast`、`dvh` 单位、`:focus-visible`。
4. **动画只用 `transform` / `opacity`**，并遵循 `prefers-reduced-motion`。
5. **不动 `docs/`**（该目录被 `.gitignore` 排除）。计划与设计文档在 `specs/`。
6. 每个任务**单独提交**，提交信息用中文，格式 `refactor(classroom): <做了什么>`。

### 基线（重构前实测，2026-09-20）

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | 退出码 0，**0 行输出** |
| `npx eslint src/app/classroom/` | 退出码 0，**0 error / 1 warning** |

**那条既有 warning 是 `page.tsx:432` 的 `'tokenData' is assigned a value but never used`。它必须在重构后依然存在（随文件移动即可），不算新增告警。**

### 每个任务的通用验证循环

本项目**没有前端测试框架**，且这是纯重构，经典的「先写失败测试」TDD 循环不适用。取而代之，每个任务的验证是：

```bash
# 1. 类型检查必须零错误（这是抓「搬漏了依赖」的主力）
npx tsc --noEmit; echo "退出码: $?"

# 2. ESLint 不得新增告警
npx eslint src/app/classroom/

# 3. 生产构建（Task 6 起为必做）
pnpm build
```

**`pnpm build` 从 Task 6 起升级为每个任务的必做项**（Task 1-5 是纯搬家，tsc 已足够）。它比 tsc 多抓到三类问题：

- Next.js 的 **Server/Client Component 边界错误**（例如把带 hooks 的组件挂到 Server 边界下）
- `scripts/check-classroom-browser-compat.mjs` 的 **Safari 15 兼容检查**
- 静态导出阶段的打包问题（如 `git mv` 后残留的错误导入路径）

构建比 tsc 慢，但它是项目自身的标准 gate，值得每个任务跑一次。

**这套检查抓不到的**：DOM 层级变化、effect 依赖变化、闭包捕获了过期值、CSS class 名打错。**这些只能靠运行时走查。**

### ⚠️ 关于「人工走查」步骤（计划缺陷修正）

Task 6-9 的原文各写了一段浏览器人工走查清单。**这些步骤无法由实施者执行**——实施者是子代理，不能开浏览器、不能看渲染结果、不能点按钮。这是计划撰写时的疏忽。

**修正后的做法**：

1. 实施者**跳过** brief 里的浏览器走查步骤，改为执行上面的通用验证循环（`tsc` + `eslint` + `pnpm build`），并在报告中说明「浏览器走查步骤按修正后的政策跳过」。
2. 各任务 brief 里的走查清单**不废弃**——它们被**汇总到 Task 11**，在那里一次性完整执行。一次性做完整走查，比拆成四次零散走查更能发现跨任务的交互问题。
3. 走查由**用户**在 Task 11 执行（需要真实浏览器与真实课堂数据）。

**为什么可以接受**：Task 6-9 都是**行为保持型重构**。`tsc` 抓结构性断裂，`pnpm build` 抓边界与打包错误。剩下的风险集中在 hook 抽取的闭包/时序问题——而这正是 Task 11 集中走查要覆盖的。真正的兜底是 M1 的真机性能门槛。

---

## File Structure

### 目标结构

```
src/app/classroom/
├── page.tsx                      # 瘦身后：<style> 块 + Suspense + 挂载 StudentChatContent
├── classroom-types.ts            # ★ 原 59-106 类型块（纯类型，零运行时依赖）
├── avatar-utils.ts               # ★ 原 13-27：API_BASE_URL + fixSvgUrl + svgDataUrl
│                                 #   + getEmbeddedAvatarImageUrl
├── use-is-mobile.ts              # ★ 原 42-58
├── identity/
│   ├── identity-picker.tsx       # ★ 原 1486-1614 身份选择分支
│   └── use-student-session.ts    # ★ 原 351-455 restoreSessionFromUrl + 会话管理
└── chat/
    ├── chat.module.css           # ← 从 classroom/chat.module.css 移入
    ├── chat-panel.tsx            # ★ 原 StudentChatContent 主体
    ├── svg-avatar.tsx            # ★ 原 29-41
    ├── agent-avatar.tsx          # ★ 原 111-133
    ├── message-item.tsx          # ★ 原 135-250
    ├── streaming-indicator.tsx   # ★ 原 252-287
    ├── thinking-content.tsx      # ★ 原 290-344
    ├── avatar-changer.tsx        # ★ 原 2312-2473
    ├── use-chat-socket.ts        # ★ 原 startChatSession 944-1155（抽取）
    └── use-voice-input.ts        # ★ 原 1163-1227 + effect 557-560 + refs 508-509（抽取）
```

### 本计划明确不做（留给 M1）

**`chat/image-viewer.tsx` 不在 M0 范围内。** Spec §4.1 列出了它，但它是一次需要重构 10 个 state（`fullscreenImg`/`zoomLevel`/`imgOffset` 等）+ 2 个 ref + 一个 44 行 effect（原 619-663）的抽取，而**它并不妨碍 M1 的外壳**——全屏图片查看器留在 `chat-panel.tsx` 里完全不影响三件套挂载。

M0 的原则是「能用机械搬家解决的，不做重构」。图片查看器留到 M1 与其他 UI 子组件一起切。

### 对 Spec §4.1 的一处补充

Spec 结构里没有列出 `classroom-types.ts` / `avatar-utils.ts` / `use-is-mobile.ts`。新增这三个**放在 `classroom/` 根目录**是必要的：它们被 `identity/` 和 `chat/` **两边共用**，放进任一子目录都会造成跨目录的反向依赖。Spec §4.1 的结构是给新功能文件画的位置，这三个是重构产物。

### ⚠️ 关于本文档中的行号

**本文档引用的所有行号都是「原始文件」（M0 开始前，2495 行版本）的行号。** 每完成一个任务，`page.tsx` 就会变短，行号随即失效——Task 1 抽走 48 行后，原 13 行变成第 18 行（顶部 import 增加 5 行），原 111 行变成第 68 行，中间存在断点。

**因此：永远按符号名定位，不要按行号定位。** 需要查阅原始代码时用：

```bash
git show 0713de41cb0c59220218cd8210cdfb4b58647d1d:src/app/classroom/page.tsx | sed -n '<原始行号>,<原始行号>p'
```

按名定位：

```bash
grep -nE "^(const|function) (API_BASE_URL|fixSvgUrl|svgDataUrl|getEmbeddedAvatarImageUrl|SvgAvatar|useIsMobile|AgentAvatar|MessageItem|StreamingIndicator|ThinkingContent|AvatarChangerContent)" src/app/classroom/page.tsx
```

### 三个必须记住的搬迁陷阱

1. **`API_BASE_URL`（原第 13 行）必须跟着 `avatar-utils.ts` 一起走并导出。** `SvgAvatar` 通过 `fixSvgUrl` / `getEmbeddedAvatarImageUrl` **间接**依赖它。漏搬不会报错，只会让头像 URL 变成 `undefined` 前缀。

2. **页面级 `<style>` 块（原 2478-2489）不能跟着任何组件走。** 它定义的 `thinkingWave`、`notifSlideUp`、`blink`、`spin`、`teacherBubbleIn` 等 keyframes 被 `StreamingIndicator`(275-281)、`MessageItem`(221)、教师通知气泡(1965)、历史加载指示(1861) 引用。它必须**留在 `page.tsx`**。

3. **头像弹窗（原 2184-2228）与全屏图片查看器（原 2232-2305）的 DOM 嵌在 `styles.composerArea` 内部**（该 div 到 2306 才闭合）。把它们提出来会改变 DOM 层级 → 属于行为改动。**M0 期间原样保留在 composerArea 内**，即使这意味着 `chat-panel.tsx` 里还留着它们。

---

## Task 1: 抽出纯类型块

**Files:**
- Create: `src/app/classroom/classroom-types.ts`
- Modify: `src/app/classroom/page.tsx`（删除原 59-106，改为 import）

**Interfaces:**
- Consumes: 无
- Produces: `ChatAgent`、`StudentChatMessage`、`SocketTextEvent`、`AiResponseEvent`、`SocketErrorEvent`、`StudentIdEvent`、`AvatarRewardEvent`、`TeacherNotificationEvent`、`ShieldWarnEvent`、`PermissionEvent`、`BrowserSpeechRecognitionResult`、`BrowserSpeechRecognitionEvent`、`BrowserSpeechRecognitionErrorEvent`、`BrowserSpeechRecognition`、`BrowserSpeechRecognitionConstructor`、`SpeechRecognitionWindow` —— 全部**具名导出**

**为什么先做这个：** 原 59-106 是一整块连续的类型声明，零运行时依赖，互不交错。它是所有其他文件的基础，先抽它可以让后续每个任务少写一段 import。

- [ ] **Step 1: 创建 `classroom-types.ts`，把原 59-106 行原样搬入**

把 `page.tsx` 第 59-106 行**逐字符复制**到新文件（包含 `ChatAgent` 到 `SpeechRecognitionWindow` 的全部类型）。在每个声明前加 `export`。

**文件开头需要一行 import**（执行时发现并修正，见台账 Ruling 4）：

```ts
import type { AgentSummary } from '@/lib/types';
```

因为 `ChatAgent` 依赖 `AgentSummary`。连带动作：`AgentSummary` 在 `page.tsx` 中原仅服务于 `ChatAgent`，搬走后成为孤儿导入，**必须一并从 `page.tsx` 的 import 中移除**，否则会多出一条 ESLint `no-unused-vars` 告警。

import 语句放在文件**顶部 import 区**，不要放在原 59 行的位置（那会触发 `import/first`）。

注意：`BrowserSpeechRecognition`（原 90-101）内部引用了 `BrowserSpeechRecognitionResult` 等，因为同文件所以无需 import。保持原样。

- [ ] **Step 2: 修改 `page.tsx`，删除原 59-106，改为具名导入**

```ts
import type {
  ChatAgent, StudentChatMessage, SocketTextEvent, AiResponseEvent, SocketErrorEvent,
  StudentIdEvent, AvatarRewardEvent, TeacherNotificationEvent, ShieldWarnEvent, PermissionEvent,
  BrowserSpeechRecognition,
} from './classroom-types';
```

注意：`SpeechRecognitionWindow` 和四个 `BrowserSpeechRecognition*` 子类型只在原文件内部被 `BrowserSpeechRecognition` 与 `SpeechRecognitionWindow` 使用，`page.tsx` 本身只直接用到 `BrowserSpeechRecognition`（原 508 行）和 `SpeechRecognitionWindow`（原 558、1180 行）。**导入清单以 `tsc` 报错为准补齐**——先写上面这行，跑 `tsc`，按提示增删。

- [ ] **Step 3: 验证**

```bash
cd /Users/zxc/myprojects/classnode
npx tsc --noEmit; echo "tsc 退出码: $?"
npx eslint src/app/classroom/; echo "eslint 退出码: $?"
wc -l src/app/classroom/page.tsx src/app/classroom/classroom-types.ts
```

预期：`tsc` 退出码 0 且无输出；`eslint` 退出码 0、仍是 1 条 warning（`tokenData`）；`classroom-types.ts` 约 48 行；`page.tsx` 减少约 48 行。

- [ ] **Step 4: 提交**

```bash
git add src/app/classroom/classroom-types.ts src/app/classroom/page.tsx
git commit -m "refactor(classroom): 抽出类型定义到 classroom-types.ts"
```

---

## Task 2: 抽出头像工具与两个小头像组件

**Files:**
- Create: `src/app/classroom/avatar-utils.ts`、`src/app/classroom/chat/svg-avatar.tsx`、`src/app/classroom/chat/agent-avatar.tsx`
- Modify: `src/app/classroom/page.tsx`

**Interfaces:**
- Consumes: `ChatAgent`（Task 1）
- Produces:
  - `avatar-utils.ts`：`API_BASE_URL: string`、`fixSvgUrl(svg: string): string`、`svgDataUrl(svg: string): string`、`getEmbeddedAvatarImageUrl(svg: string): string | null`
  - `svg-avatar.tsx`：`SvgAvatar`（具名导出）与 `SvgAvatarProps` 接口
  - `agent-avatar.tsx`：`AgentAvatar`（具名导出，`memo` 包装）与 `AgentAvatarProps` 接口

- [ ] **Step 1: 创建 `avatar-utils.ts`**

把原 13-27 行搬入并**全部具名导出**：

```ts
import { getApiBaseUrl } from '@/lib/api-base';

export const API_BASE_URL = getApiBaseUrl();

export function fixSvgUrl(svg: string): string { /* 原 14 行原样 */ }
export function svgDataUrl(svg: string): string { /* 原 15-17 原样 */ }
export function getEmbeddedAvatarImageUrl(svg: string): string | null { /* 原 20-27 原样 */ }
```

**陷阱提醒**：`API_BASE_URL` 必须 `export`。它被 `fixSvgUrl` 与 `getEmbeddedAvatarImageUrl` 在模块内使用，同时也是原 665 行 `SOCKET_URL` / 666 行 `apiBase` 的来源。

- [ ] **Step 2: 创建 `chat/svg-avatar.tsx`**

把原 29-41 行 `SvgAvatar` 搬入。原代码用的是**内联匿名 props 类型**，改为具名导出接口：

```tsx
import { useState } from 'react';
import { fixSvgUrl, getEmbeddedAvatarImageUrl, svgDataUrl } from '../avatar-utils';

export interface SvgAvatarProps {
  svg: string;
  size: number;
  fallback?: string;
}

export function SvgAvatar({ svg, size, fallback = '?' }: SvgAvatarProps) {
  // 原 30-41 行函数体原样
}
```

- [ ] **Step 3: 创建 `chat/agent-avatar.tsx`**

把原 111-133 行 `AgentAvatar` 搬入（保持 `memo` 包装），具名导出接口：

```tsx
import { memo } from 'react';
import type { ChatAgent } from '../classroom-types';

export interface AgentAvatarProps {
  size: number;
  borderRadius?: number;
  fontSize?: number;
  agent: ChatAgent;
  apiBase: string;
}

export const AgentAvatar = memo(function AgentAvatar({ size, borderRadius = 8, fontSize = 13, agent, apiBase }: AgentAvatarProps) {
  // 原 114-132 行函数体原样
});
```

- [ ] **Step 4: 修改 `page.tsx`**

删除原 13-27、29-41、111-133。在顶部加：

```ts
import { API_BASE_URL, fixSvgUrl } from './avatar-utils';
import { SvgAvatar } from './chat/svg-avatar';
import { AgentAvatar } from './chat/agent-avatar';
```

`svgDataUrl` 与 `getEmbeddedAvatarImageUrl` **不需要**在 `page.tsx` 导入（只有 `SvgAvatar` 用）。

- [ ] **Step 5: 验证**

```bash
npx tsc --noEmit; echo "tsc 退出码: $?"
npx eslint src/app/classroom/; echo "eslint 退出码: $?"
```

必须 tsc 退出码 0。**如果报 `API_BASE_URL is not exported` 或 `fixSvgUrl not found`，说明 Step 1 的 export 漏了。**

- [ ] **Step 6: 提交**

```bash
git add src/app/classroom/avatar-utils.ts src/app/classroom/chat/svg-avatar.tsx src/app/classroom/chat/agent-avatar.tsx src/app/classroom/page.tsx
git commit -m "refactor(classroom): 抽出头像工具函数与 SvgAvatar、AgentAvatar 组件"
```

---

## Task 3: 抽出三个消息展示组件

**Files:**
- Create: `src/app/classroom/chat/message-item.tsx`、`chat/streaming-indicator.tsx`、`chat/thinking-content.tsx`
- Modify: `src/app/classroom/page.tsx`

**Interfaces:**
- Consumes: `SvgAvatar`、`AgentAvatar`（Task 2）、`ChatAgent` / `StudentChatMessage`（Task 1）
- Produces:
  - `MessageItem`（`memo`）与 `MessageItemProps`
  - `StreamingIndicator`（`memo`）与 `StreamingIndicatorProps`
  - `ThinkingContent`（`memo`）与 `ThinkingContentProps`

**这三个组件原本就用内联匿名 props 类型，本次改为具名导出接口，字段与顺序不变。**

- [ ] **Step 1: 创建 `chat/message-item.tsx`，搬入原 135-250**

```tsx
import { memo, useCallback, useState } from 'react';
import { Markdown, stripImages } from '@/lib/markdown';
import { SvgAvatar } from './svg-avatar';
import { AgentAvatar } from './agent-avatar';
import type { ChatAgent, StudentChatMessage } from '../classroom-types';
import styles from '../chat.module.css';

export interface MessageItemProps {
  msg: StudentChatMessage;
  studentName: string;
  agent: ChatAgent;
  apiBase: string;
  avatarSvg?: string;
  onImageClick?: (url: string) => void;
  onRevise?: (content: string) => void;
  allowExport?: boolean;
  msgIndex?: number;
  onFollowUp?: (question: string) => void;
  allowFollowUps?: boolean;
  allowStudentStop?: boolean;
  isRespondingToThis?: boolean;
  aiResponding?: boolean;
}

export const MessageItem = memo(function MessageItem({ /* 原 props 解构 */ }: MessageItemProps) {
  // 原 141-249 行函数体原样，含内部 toast state 与两个 useCallback
});
```

**注意**：原 158 行有一个动态 `import('@/lib/export-doc')`，保持原样不动。

**注意**：`styles` 的导入路径此时仍是 `'../chat.module.css'`（css 文件在 Task 10 才迁移）。

- [ ] **Step 2: 创建 `chat/streaming-indicator.tsx`，搬入原 252-287**

```tsx
import { memo, useMemo } from 'react';
import { Markdown, stripImages } from '@/lib/markdown';
import { AgentAvatar } from './agent-avatar';
import type { ChatAgent } from '../classroom-types';
import styles from '../chat.module.css';

export interface StreamingIndicatorProps {
  streamingContent: string;
  agent: ChatAgent;
  apiBase: string;
}

export const StreamingIndicator = memo(function StreamingIndicator({ streamingContent, agent, apiBase }: StreamingIndicatorProps) {
  // 原 256-286 行函数体原样（含 useMemo）
});
```

- [ ] **Step 3: 创建 `chat/thinking-content.tsx`，搬入原 290-344**

```tsx
import { memo, useState } from 'react';
import { Markdown } from '@/lib/markdown';
import { AgentAvatar } from './agent-avatar';
import type { ChatAgent } from '../classroom-types';
import styles from '../chat.module.css';

export interface ThinkingContentProps {
  content: string;
  agent: ChatAgent;
  apiBase: string;
}

export const ThinkingContent = memo(function ThinkingContent({ content, agent, apiBase }: ThinkingContentProps) {
  // 原 294-343 行函数体原样（含 collapsed state）
});
```

- [ ] **Step 4: 修改 `page.tsx`**

删除原 135-250、252-287、290-344，加导入：

```ts
import { MessageItem } from './chat/message-item';
import { StreamingIndicator } from './chat/streaming-indicator';
import { ThinkingContent } from './chat/thinking-content';
```

- [ ] **Step 5: 验证**

```bash
npx tsc --noEmit; echo "tsc 退出码: $?"
npx eslint src/app/classroom/; echo "eslint 退出码: $?"
```

- [ ] **Step 6: 提交**

```bash
git add src/app/classroom/chat/ src/app/classroom/page.tsx
git commit -m "refactor(classroom): 抽出 MessageItem、StreamingIndicator、ThinkingContent"
```

---

## Task 4: 抽出 `useIsMobile`

**Files:**
- Create: `src/app/classroom/use-is-mobile.ts`
- Modify: `src/app/classroom/page.tsx`

**Interfaces:**
- Produces: `useIsMobile(): boolean`

- [ ] **Step 1: 创建 `use-is-mobile.ts`**

把原 42-58 行原样搬入：

```ts
import { useSyncExternalStore } from 'react';

export function useIsMobile(): boolean {
  // 原 43-57 行原样
}
```

该 hook 零外部依赖（只用 React 的 `useSyncExternalStore`）。

- [ ] **Step 2: 修改 `page.tsx`**

删除原 42-58，加 `import { useIsMobile } from './use-is-mobile';`

- [ ] **Step 3: 验证**

```bash
npx tsc --noEmit; echo "tsc 退出码: $?"
npx eslint src/app/classroom/; echo "eslint 退出码: $?"
```

- [ ] **Step 4: 提交**

```bash
git add src/app/classroom/use-is-mobile.ts src/app/classroom/page.tsx
git commit -m "refactor(classroom): 抽出 useIsMobile hook"
```

---

## Task 5: 抽出 `AvatarChangerContent`

**Files:**
- Create: `src/app/classroom/chat/avatar-changer.tsx`
- Modify: `src/app/classroom/page.tsx`

**Interfaces:**
- Consumes: `SvgAvatar`（Task 2）、`fixSvgUrl`（Task 2）
- Produces: `AvatarChangerContent` 与 `AvatarChangerContentProps`

`AvatarChangerContent` 已经是独立组件（原 2312-2473），**唯一需要改的是它引用了模块级的 `fixSvgUrl`**（调用点在 2406、2421 附近的 `onChanged` 回调里，以及 2202、2213 —— 注意后两处在 `page.tsx` 的调用侧，不在组件内）。

- [ ] **Step 1: 创建 `chat/avatar-changer.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { AvatarSummary } from '@/lib/types';
import { fixSvgUrl } from '../avatar-utils';
import { SvgAvatar } from './svg-avatar';

export interface AvatarChangerContentProps {
  studentId: string;
  avatars: AvatarSummary[];
  onChanged: (result: { avatarId: number; svgContent: string }) => void;
  setToast: (t: { msg: string; type: 'success' | 'error' | 'info' } | null) => void;
}

export function AvatarChangerContent({ studentId, avatars, onChanged, setToast }: AvatarChangerContentProps) {
  // 原 2317-2472 行函数体原样
  // 含 7 个 useState、2 个 useRef、1 个 useEffect(2333-2335)
}
```

- [ ] **Step 2: 修改 `page.tsx`**

删除原 2312-2473，加 `import { AvatarChangerContent } from './chat/avatar-changer';`

**保留原 2195-2225 的调用点位置不动**（它嵌在 composerArea 内，见「搬迁陷阱 3」）。调用侧用到的 `fixSvgUrl`（2202、2213）继续从 `./avatar-utils` 导入——**该 import 已存在于 Task 2**。

- [ ] **Step 3: 验证**

```bash
npx tsc --noEmit; echo "tsc 退出码: $?"
npx eslint src/app/classroom/; echo "eslint 退出码: $?"
wc -l src/app/classroom/chat/avatar-changer.tsx
```

预期 `avatar-changer.tsx` 约 162 行。

- [ ] **Step 4: 提交**

```bash
git add src/app/classroom/chat/avatar-changer.tsx src/app/classroom/page.tsx
git commit -m "refactor(classroom): 抽出 AvatarChangerContent 组件"
```

---

### ✅ 检查点 A：到这里为止都是纯搬家

Task 1-5 全部是**逐行搬运 + 加 import/export**，没有重构任何 state 边界。此时 `tsc` 零错误即高度可信。

**从这里开始是抽取（extraction），需要重构 state 归属，风险显著上升。** 每个后续任务结束后除 `tsc`/`eslint` 外，**必须人工走查受影响的功能**（Task 12 提供了走查清单，可按功能拆开单测）。

---

## Task 6: 抽出身份选择界面

**Files:**
- Create: `src/app/classroom/identity/identity-picker.tsx`
- Modify: `src/app/classroom/page.tsx`

**Interfaces:**
- Consumes: `SvgAvatar`（Task 2）、`useIsMobile`（Task 4）、`ClassroomStudentSummary` / `StudentClassroom`（`@/lib/types`）
- Produces: `IdentityPicker({ ... }): JSX.Element` 与 `IdentityPickerProps`

**这是本计划里第一个真正的抽取。** 原 1486-1614 是 `step === 'identity'` 的整个 return 分支，它读 7 个 state、调 2 个 handler、用 3 个局部派生变量。

- [ ] **Step 1: 创建 `identity/identity-picker.tsx`**

把原 1486-1614 的 JSX 搬进来，**JSX 内部一行不改**。把它用到的所有外部值变成 props：

```tsx
import type { ClassroomStudentSummary, StudentClassroom } from '@/lib/types';
import { SvgAvatar } from '../chat/svg-avatar';
import { useIsMobile } from '../use-is-mobile';

export interface IdentityPickerProps {
  classroom: StudentClassroom | null;
  students: ClassroomStudentSummary[];
  selectedStudent: ClassroomStudentSummary | null;
  identitySearch: string;
  onIdentitySearchChange: (value: string) => void;
  onlineStudentIds: Set<string>;
  avatarSvgs: Record<number, string>;
  joiningClassroom: boolean;
  loadError: string | null;
  onSelectStudent: (student: ClassroomStudentSummary) => void;
  onConfirm: () => void;
  onExit: () => void;
}

export function IdentityPicker(props: IdentityPickerProps) {
  // 原 1487-1491 的三个局部派生变量原样保留在函数体内：
  //   const isGroupMode = ...          (原 1487)
  //   const normalizedIdentitySearch = ... (原 1488)
  //   const visibleStudents = ...       (原 1489-1491)
  // 然后原样返回 1493-1613 的 JSX，把对 state/handler 的引用换成 props 同名变量
}
```

**关键**：`selectedStudent` 相关的 `setSelectedStudent(x)` 调用点，改为 `onSelectStudent(x)`。其余 state 引用（`identitySearch` → `onIdentitySearchChange`、`joiningClassroom`、`loadError`、`onlineStudentIds`、`avatarSvgs`、`students`、`classroom`）直接同名映射。`handleExit` → `onExit`、`handleIdentityConfirm` → `onConfirm`。

**`isMobile` 从 props 改成组件内部调用 `useIsMobile()`** —— 它在原代码里只用于 1508 行的 padding，没有跨组件共享。

- [ ] **Step 2: 修改 `page.tsx`**

把原 1486-1614 那个 `return (...)` 分支替换为：

```tsx
if (step === 'identity') {
  return (
    <IdentityPicker
      classroom={classroom}
      students={students}
      selectedStudent={selectedStudent}
      identitySearch={identitySearch}
      onIdentitySearchChange={setIdentitySearch}
      onlineStudentIds={onlineStudentIds}
      avatarSvgs={avatarSvgs}
      joiningClassroom={joiningClassroom}
      loadError={loadError}
      onSelectStudent={setSelectedStudent}
      onConfirm={handleIdentityConfirm}
      onExit={handleExit}
    />
  );
}
```

**注意**：原代码里 identity 分支是 `if (step === 'identity') return (...)`，chat 分支是 fall-through 的默认 return。改成显式 `if` 后，**默认 return 的行为完全不变**。

- [ ] **Step 3: 验证类型与 lint**

```bash
npx tsc --noEmit; echo "tsc 退出码: $?"
npx eslint src/app/classroom/; echo "eslint 退出码: $?"
```

- [ ] **Step 4: 人工走查身份选择**

启动开发环境：

```bash
./dev.sh start
```

然后在浏览器打开 `http://localhost:4000/`，走查以下各项（**必须逐条确认**）：

- [ ] 输入 4 位互动码 → 跳到 `/classroom?code=xxxx`
- [ ] loading 态正常显示后进入身份选择页
- [ ] 学生列表正常渲染，头像显示正确（**重点看头像，这是 `API_BASE_URL` 搬迁是否成功的直接验证**）
- [ ] 学生数 > 8 时出现搜索框，输入能过滤列表
- [ ] 已在线的学生呈灰色不可选
- [ ] 点击学生能选中（边框高亮变化）
- [ ] 点「确定」能进入聊天页
- [ ] 左上角「退出」能回到 `/`

- [ ] **Step 5: 提交**

```bash
git add src/app/classroom/identity/ src/app/classroom/page.tsx
git commit -m "refactor(classroom): 抽出 IdentityPicker 身份选择组件"
```

---

## Task 7: 抽出 `useStudentSession`

**Files:**
- Create: `src/app/classroom/identity/use-student-session.ts`
- Modify: `src/app/classroom/page.tsx`

**Interfaces:**
- Consumes: `api`、`setStudentSessionToken`（`@/lib/api`）、`fixSvgUrl`（Task 2）、`StudentClassroom` / `ClassroomStudentSummary` / `AvatarSummary`
- Produces: `useStudentSession(...)` 返回 `{ restoreSessionFromUrl }`

**说明：** 本任务**只抽 `restoreSessionFromUrl`（原 351-455）这一个函数**，不抽 token 的读取/设置逻辑（那些分散在 `handleIdentityConfirm`、`handleSwitchIdentity`、`handleExit` 里，属于 Task 9 的范畴）。这是一个保守的切入点。

`restoreSessionFromUrl` 写 7 个 state：`code`、`selectedStudent`、`step`、`teacherMsgs`、`avatarSvgs`、`allStudentAvatars`、`avatarTokenCount`。这些 setter 通过 options 传入。

- [ ] **Step 1: 创建 `identity/use-student-session.ts`**

按项目既有 hook 模式（参考 `src/app/teacher/agents/use-agent-form-actions.ts`）编写：

```ts
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { fixSvgUrl } from '../avatar-utils';
import type { StudentClassroom, ClassroomStudentSummary, AvatarSummary } from '@/lib/types';

interface StudentSessionOptions {
  code: string;
  router: { push: (href: string) => void };
  setCode: (v: string) => void;
  setSelectedStudent: (v: ClassroomStudentSummary | null) => void;
  setStep: (v: 'loading' | 'identity' | 'chat') => void;
  setTeacherMsgs: (v: { message: string; time: string }[]) => void;
  setAvatarSvgs: (v: Record<number, string>) => void;
  setAllStudentAvatars: (v: AvatarSummary[]) => void;
  setAvatarTokenCount: (v: number) => void;
}

export function useStudentSession(options: StudentSessionOptions) {
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  const restoreSessionFromUrl = async (now: number) => {
    const o = optionsRef.current;
    // 原 352-455 行函数体原样，把对 state 的写入换成 o.setXxx(...)
  };

  return { restoreSessionFromUrl };
}
```

**必须用 `optionsRef` 而不是直接闭包捕获 `options`。** 项目里 `use-agent-form-actions.ts:26-27` 就是这么做的，原因同样是这个 hook 的调用点会随渲染变化。

- [ ] **Step 2: 修改 `page.tsx`**

删除原 351-455 的函数定义，改为：

```ts
const { restoreSessionFromUrl } = useStudentSession({
  code, router,
  setCode, setSelectedStudent, setStep, setTeacherMsgs,
  setAvatarSvgs, setAllStudentAvatars, setAvatarTokenCount,
});
```

原 1229-1234 的挂载 effect 保持不变（它调用 `restoreSessionFromUrl(Date.now())`）。

- [ ] **Step 3: 验证类型与 lint**

```bash
npx tsc --noEmit; echo "tsc 退出码: $?"
npx eslint src/app/classroom/; echo "eslint 退出码: $?"
```

- [ ] **Step 4: 人工走查会话恢复（最重要的回归点）**

这是**最容易出问题时序 bug** 的地方。必须走查：

- [ ] 全新会话（清空 localStorage）打开 `/classroom?code=xxxx` → 正常进入身份选择
- [ ] 带 `?code=` 参数直接访问 → 正常加载课堂
- [ ] **不带任何参数访问 `/classroom`** → 应跳回 `/`（原 361 行的 `router.push('/')`）
- [ ] 走完身份确认进入聊天后**刷新页面** → 应自动恢复会话并回到聊天页（localStorage 2 小时 TTL 逻辑，原 369 行）
- [ ] 手动把 localStorage 里 `chat_session_<code>` 的 `timestamp` 改成 3 小时前 → 刷新后应回到身份选择页而不是自动进聊天

- [ ] **Step 5: 提交**

```bash
git add src/app/classroom/identity/use-student-session.ts src/app/classroom/page.tsx
git commit -m "refactor(classroom): 抽出 useStudentSession 会话恢复逻辑"
```

---

## Task 8: 抽出 `useVoiceInput`

**Files:**
- Create: `src/app/classroom/chat/use-voice-input.ts`
- Modify: `src/app/classroom/page.tsx`

**Interfaces:**
- Consumes: `BrowserSpeechRecognition` / `SpeechRecognitionWindow`（Task 1）
- Produces: `useVoiceInput(...)` 返回 `{ voiceInputAvailable, voiceListening, toggleVoiceInput }`

**要搬的东西（4 处，散落但内聚）：**
- 原 470-471：`voiceInputAvailable` / `voiceListening` 两个 state
- 原 508-509：`voiceRecognitionRef` / `voiceInputBaseRef` 两个 ref
- 原 557-560：检测 `SpeechRecognition` 可用性的 effect
- 原 1163-1171：`voiceErrorMessage` 纯函数
- 原 1173-1227：`toggleVoiceInput`

`toggleVoiceInput` 读 `input`、写 `input` / `voiceListening` / `toast` —— 这三个通过 options 传入。

- [ ] **Step 1: 创建 `chat/use-voice-input.ts`**

```ts
import { useEffect, useRef, useState } from 'react';
import type { BrowserSpeechRecognition, SpeechRecognitionWindow } from '../classroom-types';

interface VoiceInputOptions {
  input: string;
  setInput: (v: string) => void;
  setToast: (t: { msg: string; type: 'success' | 'error' | 'info' } | null) => void;
}

export function useVoiceInput(options: VoiceInputOptions) {
  const [voiceInputAvailable, setVoiceInputAvailable] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const voiceRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const voiceInputBaseRef = useRef('');
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  useEffect(() => {
    // 原 557-560 原样
  }, []);

  const voiceErrorMessage = (error: string): string => {
    // 原 1163-1171 原样（纯函数）
  };

  const toggleVoiceInput = () => {
    // 原 1173-1227 原样，state 读写换成 optionsRef.current.setInput / setToast
  };

  // 卸载时中止语音（原 515-526 的 effect 里有一部分是这个）
  useEffect(() => () => { voiceRecognitionRef.current?.abort?.(); }, []);

  return { voiceInputAvailable, voiceListening, toggleVoiceInput };
}
```

**注意**：原 515-526 的卸载清理 effect 里**既有 socket 断开也有语音 abort**。本任务把语音那一句（`voiceRecognitionRef.current?.abort?.()`）挪进本 hook 自己的卸载 effect，`page.tsx` 里那个 effect 保留 socket 与定时器的清理。**这一句的移动不改变卸载时的行为**（两个 effect 都在同一组件卸载时执行）。

- [ ] **Step 2: 修改 `page.tsx`**

删除原 470-471、508-509、557-560、1163-1171、1173-1227，改为：

```ts
const { voiceInputAvailable, voiceListening, toggleVoiceInput } = useVoiceInput({ input, setInput, setToast });
```

原 2130-2146 的语音按钮 JSX 与 2151-2181 的输入框引用保持不变（它们用的就是这三个返回值）。

- [ ] **Step 3: 验证类型与 lint**

```bash
npx tsc --noEmit; echo "tsc 退出码: $?"
npx eslint src/app/classroom/; echo "eslint 退出码: $?"
```

- [ ] **Step 4: 人工走查语音**

- [ ] 进入聊天页，工具条上的麦克风按钮显示状态正确（**在不支持 Web Speech 的浏览器里应当不显示该按钮**——这是原 557-560 effect 的作用）
- [ ] 在 Chrome 里点麦克风 → 进入聆听态（按钮变色 + 有脉冲点）
- [ ] 说话 → 文字进入输入框
- [ ] 再点一次麦克风 → 停止聆听
- [ ] 聆听中直接切走页面/刷新 → 不报错

- [ ] **Step 5: 提交**

```bash
git add src/app/classroom/chat/use-voice-input.ts src/app/classroom/page.tsx
git commit -m "refactor(classroom): 抽出 useVoiceInput 语音输入逻辑"
```

---

## Task 9: 抽出 `useChatSocket`

**Files:**
- Create: `src/app/classroom/chat/use-chat-socket.ts`
- Modify: `src/app/classroom/page.tsx`

**Interfaces:**
- Consumes: `BrowserSpeechRecognition`… 不需要；需要 `ChatAgent` / `StudentChatMessage`（Task 1）
- Produces: `useChatSocket(...)` 返回 `{ startChatSession }`

**这是整个 M0 风险最高的一个任务。** 原 944-1155 是 `startChatSession`，210 行，内部注册 **22 个 socket 事件监听**，读写大量 state。它同时依赖 `code`、`classroom`、`selectedStudent`、`router`。

**执行这个任务时请放慢，严格按下面的切分来做。**

- [ ] **Step 1: 用命令机械枚举出这个函数的全部依赖**

**不要靠肉眼通读**——210 行、22 个回调，漏一个 setter 就是一个静默失效。用命令枚举：

```bash
cd /Users/zxc/myprojects/classnode
echo "=== 该函数用到的全部 setter（去重） ==="
sed -n '944,1155p' src/app/classroom/page.tsx | grep -oE '\bset[A-Z][A-Za-z0-9]*' | sort -u
echo
echo "=== 该函数读取的 ref（去重） ==="
sed -n '944,1155p' src/app/classroom/page.tsx | grep -oE '\b(wsRef|sendingRef|chatConnectionGenerationRef|identityConflictTimerRef|teacherNotifTimerRef|streamingBufferRef|streamingRafRef|seenNotifIdsRef|userScrolledUpRef)\b' | sort -u
echo
echo "=== 该函数引用的外部标识符（去重） ==="
sed -n '944,1155p' src/app/classroom/page.tsx | grep -oE '\b(code|classroom|selectedStudent|router|API_BASE_URL|fixSvgUrl)\b' | sort -u
```

三条命令的输出**全文**就是 `ChatSocketOptions` 的依据：setter 以 `setXxx` 形式传入，ref 以 `RefObject` 形式传入。

**写完 hook 后必须核对一遍**，否则某个 setter 写错目标 state 时 tsc 不会报错：

```bash
grep -oE 'optionsRef\.current\.[A-Za-z0-9]+' src/app/classroom/chat/use-chat-socket.ts | sed 's/.*\.//' | sort -u
```

把这份清单与上面第一条命令的输出对比，**差集必须为空**。

- [ ] **Step 2: 创建 `chat/use-chat-socket.ts`**

```ts
import { useEffect, useRef } from 'react';
import type { ChatAgent, StudentChatMessage } from '../classroom-types';

interface ChatSocketOptions {
  code: string;
  classroom: StudentClassroom | null;
  selectedStudent: ClassroomStudentSummary | null;
  router: { push: (href: string) => void };
  // ...加上 Step 1 列出的全部 setter
}

export function useChatSocket(options: ChatSocketOptions) {
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  // 原 491-534 区间里属于 chat socket 的 ref 一并搬入：
  //   wsRef(501)、sendingRef(503)、chatConnectionGenerationRef(504)、
  //   identityConflictTimerRef(505)、teacherNotifTimerRef(506)、
  //   streamingBufferRef(529)、streamingRafRef(530)、seenNotifIdsRef(532)
  // 【注意】chatShellRef(493)、messagesEndRef(494)、chatContainerRef(495)、
  //   inputRef(507)、fileInputRef(510)、statusSocketRef(513)、
  //   teacherPanelRef(534)、userScrolledUpRef(500)、overlayRef(492)、dragRef(491)
  //   **不属于**本 hook，留在 page.tsx。以原代码实际使用位置为准核对。

  const startChatSession = async (/* 原 944 行的参数 */) => {
    // 原 945-1154 行函数体原样，state 写入换成 optionsRef.current.setXxx
  };

  return { startChatSession };
}
```

**关键约束：22 个事件监听器的回调体一个字都不改。** 只把里面 `setXxx(...)` 换成 `optionsRef.current.setXxx(...)`。因为 socket 回调是异步的，直接闭包捕获 setter 会拿到首次渲染的值 —— 用 `optionsRef` 正是为了避免这个。

**`flushStreaming`（原 957-960）是 `startChatSession` 内部的局部函数**，跟着一起搬，保持在函数内部定义。

- [ ] **Step 3: 修改 `page.tsx`**

删除原 944-1155，用 hook 调用替代。原 1300-1334 的 `handleIdentityConfirm` 会调用 `startChatSession(...)` —— 该调用点不变。

- [ ] **Step 4: 验证类型与 lint**

```bash
npx tsc --noEmit; echo "tsc 退出码: $?"
npx eslint src/app/classroom/; echo "eslint 退出码: $?"
```

**特别检查**：`eslint` 可能会报 hooks 规则相关的告警。如果出现 `react-hooks/exhaustive-deps` 的新告警，**不要用 `eslint-disable` 掩盖**——那说明某个依赖漏了。

- [ ] **Step 5: 人工走查聊天全链路（本任务必做，最重）**

- [ ] 进入聊天页 → 连接徽章显示「已连接」
- [ ] 发一条消息 → 出现用户气泡，AI 开始流式回复
- [ ] 流式回复过程中能点「停止」→ 生成中止
- [ ] AI 回复完成后消息落入列表
- [ ] 出现深度思考内容时，折叠块可展开/收起
- [ ] 上传一张图片附件 → 出现在附件条、发送后出现在消息里、点击能全屏查看
- [ ] 断网再恢复 → 连接徽章变化正确，能继续发消息
- [ ] 教师在另一端发通知 → 学生端气泡出现（这条需要同时开教师端，若不便验证可跳过并注明）

- [ ] **Step 6: 提交**

```bash
git add src/app/classroom/chat/use-chat-socket.ts src/app/classroom/page.tsx
git commit -m "refactor(classroom): 抽出 useChatSocket 实时通信逻辑"
```

---

## Task 10: 组装 `chat-panel.tsx`、迁移 CSS、瘦身 `page.tsx`

**Files:**
- Create: `src/app/classroom/chat/chat-panel.tsx`
- Move: `src/app/classroom/chat.module.css` → `src/app/classroom/chat/chat.module.css`
- Modify: `src/app/classroom/page.tsx`

**Interfaces:**
- Consumes: 前面所有任务的产物
- Produces: `StudentChatContent`（具名导出，来自 `chat/chat-panel.tsx`）

- [ ] **Step 1: 迁移 CSS 文件**

```bash
git mv src/app/classroom/chat.module.css src/app/classroom/chat/chat.module.css
```

**⚠️ 这里必须改 import 路径，不能保持不变。** 迁移前 `chat/xxx.tsx` 里的 `'../chat.module.css'` 指向 `classroom/chat.module.css`；文件移入 `chat/` 后该路径会指向**已不存在的**位置。

把 `chat/` 目录下**每一个**文件里的导入改成：

```ts
import styles from './chat.module.css';
```

核对（`chat/` 内的文件应当**全部**是 `'./chat.module.css'`，不得残留 `'../chat.module.css'`）：

```bash
grep -rn "chat.module.css" src/app/classroom/
```

预期输出中每一行的路径形式都必须是 `'./chat.module.css'`。**出现 `'../chat.module.css'` 即为错误**——这正是 Webpack 会报 `Module not found` 的地方。

- [ ] **Step 2: 把 `StudentChatContent` 整体移入 `chat/chat-panel.tsx`**

> **关于 `'use client'`（Task 3 审查提出）**：`chat/` 下由 Task 2/3 产出的五个文件（`svg-avatar.tsx`、`agent-avatar.tsx`、`message-item.tsx`、`streaming-indicator.tsx`、`thinking-content.tsx`）**都没有 `'use client'` 指令**，它们用了 hooks 却能工作，完全依赖「只被 `'use client'` 的 `page.tsx` 引用」。
>
> `chat-panel.tsx` 本身必须带 `'use client'`（它用 `useRouter` 和大量 hooks），且 `page.tsx` 保持 `'use client'`——这样五个子文件仍处于客户端图内，无需给它们逐个补指令。
>
> **不要**把这三个组件挂到任何 Server Component 边界下。若误挂，Next.js 会在**构建期**报错（`useState`/`useMemo` 在 Server Component 中不可用），属响亮失败而非静默失效——但仍应在构建后确认一遍。

把 `page.tsx` 里剩余的 `StudentChatContent`（原 346-2309 减去已抽出的部分）整体移入新文件，具名导出：

```tsx
'use client';

import { /* 原 3 行的全部 React import */ } from 'react';
import { useRouter } from 'next/navigation';
// ...其余 import 按原样，路径按新层级调整

export function StudentChatContent() {
  // 原函数体
}
```

- [ ] **Step 3: 瘦身 `page.tsx`**

`page.tsx` 最终只剩：

```tsx
'use client';

import { Suspense } from 'react';
import { StudentChatContent } from './chat/chat-panel';

export default function StudentChatPage() {
  return (
    <>
      {/* ★ 原 2478-2489 的 <style> 块，一个字都不许改，必须留在这里。
          注意：是普通 <style>{`...`}</style>，不是 styled-jsx 的 <style jsx global>。
          已核实原文件第 2478 行为 <style>{` —— 照抄，不要"顺手改成" jsx 形式。 */}
      <style>{`/* 原 2479-2488 的内容原样 */`}</style>
      <Suspense fallback={<div style={{ /* 原 2490 行的 fallback 原样 */ }}>加载中...</div>}>
        <StudentChatContent />
      </Suspense>
    </>
  );
}
```

**陷阱提醒 2 的最终校验**：`page.tsx` 必须仍然包含 `<style>` 块，且其中 `thinkingWave`、`notifSlideUp`、`blink`、`spin`、`teacherBubbleIn` 五个 keyframes 一个都不少。

```bash
grep -c "keyframes" src/app/classroom/page.tsx
```

预期输出 `5`。

- [ ] **Step 4: 验证**

```bash
npx tsc --noEmit; echo "tsc 退出码: $?"
npx eslint src/app/classroom/; echo "eslint 退出码: $?"
echo "--- 行数 ---"
wc -l src/app/classroom/page.tsx src/app/classroom/chat/chat-panel.tsx
```

预期 `page.tsx` **不超过 60 行**。

- [ ] **Step 5: 构建验证（含 Safari 兼容检查）**

```bash
pnpm build
```

必须成功。这一步会跑 `scripts/check-classroom-browser-compat.mjs`，它能抓到 lookbehind 之类的兼容性问题。**如果这里失败，说明重构引入了 Safari 15 不支持的东西。**

- [ ] **Step 6: 提交**

```bash
git add -A src/app/classroom/
git commit -m "refactor(classroom): 组装 chat-panel.tsx 并瘦身 page.tsx

page.tsx 从 2495 行降至约 60 行，拆出 14 个文件。
<style> 块保留在页面级（其 keyframes 被多个子组件引用）。
本提交不含任何行为变更。"
```

---

## Task 11: 全量人工回归走查

**Files:** 无（纯验证）

这是 M0 的**验收关卡**。`tsc` 与 `eslint` 已全程通过，但它们**抓不到** DOM 层级变化、effect 时序变化、闭包过期值。只有这一关能抓。

- [ ] **Step 1: 启动干净环境**

```bash
./dev.sh stop
./dev.sh start
./dev.sh status
```

- [ ] **Step 2: 逐项走查（对照重构前的行为）**

**进入课堂**
- [ ] `/` 输 4 位码 → 跳转 `/classroom?code=xxxx`，loading 态正常
- [ ] 身份选择页：列表、头像、在线置灰、搜索、选中高亮、确认、退出，全部正常
- [ ] 确认后进入聊天页

**聊天主链路**
- [ ] 连接徽章显示「已连接」
- [ ] 发消息 → 用户气泡 → AI 流式回复 → 落入列表
- [ ] 「停止」按钮能中止生成
- [ ] 深度思考内容可展开/收起
- [ ] 追问建议按钮能点击发送
- [ ] 「修改」按钮把内容放回输入框

**顶部栏**
- [ ] 智能体头像与名称正确
- [ ] 学生名牌显示头像 + 换头像次数
- [ ] 点学生名牌能打开换头像弹窗；换头像后顶部与消息列表里的头像同步更新
- [ ] 教师消息按钮：有消息时显示，点击展开面板，点面板外能关闭
- [ ] 「切换用户」能回到身份选择页
- [ ] 「退出」能回到 `/`

**消息区细节**
- [ ] 右侧滚动标记条出现，点击能跳转到对应消息
- [ ] 悬停标记显示 tooltip 预览
- [ ] 「回到底部」按钮在向上滚动后出现，点击能滚到底
- [ ] 消息内的图片点击能全屏，能缩放、能拖拽、ESC 能关闭

**输入区**
- [ ] 上传附件（含 WebP 图片）→ 转换并上传成功 → 出现在附件条
- [ ] 附件超过 5 个时被拒绝并提示
- [ ] 删除已添加的附件
- [ ] 语音按钮在有支持的浏览器里出现并能用
- [ ] Enter 发送、Shift+Enter 换行
- [ ] 中文输入法组合态下按 Enter **不会误发送**（IME 安全）

**状态提示**
- [ ] 屏蔽词警告出现时输入区上方有提示
- [ ] 课堂被教师暂停时显示暂停提示，输入被禁用
- [ ] 智能体被停用时显示对应提示

- [ ] **Step 3: 记录结果**

把走查结果写进提交信息或 PR 描述。**任何一项不通过都必须先修复再继续，不得带着问题进入 M1。**

- [ ] **Step 4: 最终确认**

```bash
npx tsc --noEmit; echo "tsc: $?"
npx eslint src/app/classroom/; echo "eslint: $?"
git log --oneline main..HEAD
```

预期：`tsc` 退出码 0；`eslint` 退出码 0 且只有 1 条 `tokenData` warning；`git log` 显示 10 个 refactor 提交。

---

## 完成后

M0 完成后，`page.tsx` 约 60 行，`chat/chat-panel.tsx` 承载剩余的聊天逻辑（约 1400-1600 行，取决于 Task 9 抽取的彻底程度）。

**注意**：`chat-panel.tsx` 仍然很大。这是**有意为之** —— M0 的目标是让它成为一个**边界清晰的独立组件**，而不是把它拆碎。进一步拆分（把 composer、滚动标记条、教师通知气泡等再拆成子组件）留给 M1，届时它们会作为三件套外壳的挂载点被自然切开。

**M0 验收后即可进入 M1**：学生端首页 + 三件套 Tab 容器 + 三态控制。
