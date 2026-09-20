# M1b-1：课堂模块三态控制（后端 + 教师端）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让教师在一堂课进行中实时把三个模块（学习单 / 探究助手 / 智能学伴）各自切为 `open`（可见可点）/ `preview`（可见但锁定）/ `hidden`（不显示），学生端通过既有 socket 通道实时收到。

**Architecture:** 新增一张 `ClassroomModule` 关联表（仿 `ClassroomAgent`），一个幂等的 `PUT` 端点（**不是 toggle** —— 三态不是布尔），一次**双发**广播。学生的初始三态走既有的 `GET /code/:code`（它已被 15 秒轮询兜底），**不走 `joined` 事件**（见下）。

**Tech Stack:** Express + Prisma(SQLite) + Socket.IO；教师端 Next.js 15 静态导出 + React 18 + TypeScript strict。

**Spec:** `specs/2026-09-19-classnode-learning-suite-design.md` §4.4（三态定义与数据模型）、§4.7（Safari 15 约束）

---

## 🔴 Step 0（门禁）：必须先新开分支

**用户明确要求：开始写代码前一定要新开分支。** 若尚未满足：

```bash
cd /Users/zxc/myprojects/classnode
git branch --show-current          # 必须是 main（干净起点）
git status --short                 # 应只有用户的 CLAUDE.md / dev.sh / package.json
git checkout -b feat/m1b1-module-tri-state
git branch --show-current          # 必须显示 feat/m1b1-module-tri-state
```

**未确认在特性分支上时，不得开始 Task 1。**

---

## Global Constraints

1. **这是新功能，不是重构。** 允许改行为，但**不得破坏既有功能** —— `pnpm test` 的 32 项必须继续全过。
2. **不得出现 regex lookbehind**（`(?<=` / `(?<!`）。
3. **不得使用 Safari 15 不支持的语法**：`:has()`、`content-visibility`、`@container`、`Object.hasOwn`、`structuredClone`、`Array.prototype.at` / `findLast`、`dvh` 单位、`:focus-visible`。
4. 提交信息用中文，格式 `feat(classroom): <做了什么>`（服务端可用 `feat(server):`）。
5. **不碰** `CLAUDE.md` / `dev.sh` / `package.json` —— 它们处于用户自己的未提交状态。

### 基线（开工前必须实测确认）

```bash
npx tsc --noEmit; echo "tsc: $?"
npx eslint src/app/classroom/; echo "eslint: $?"
pnpm test 2>&1 | tail -5
pnpm build; echo "build: $?"
```

预期：`tsc` 退出 0 零输出；`eslint` 退出 0、**恰好 1 条** warning（`'tokenData' is assigned a value but never used` @ `identity/use-student-session.ts:110:50`）；`pnpm test` **32 项全过**；`pnpm build` 退出 0 且 Safari 检查通过。

⚠️ **`pnpm test` 会先编译服务端**（`pnpm build && node --test dist/tests/*.test.js`）。**只允许一个 `pnpm build`/`pnpm test` 在跑** —— 并发会互相破坏 `.next/`、`out/`、`dist/`。控制器在派发实施者期间不得并行跑。

### 测试约定（本项目既有风格，照抄）

- 测试文件放 `server/src/tests/`，**以 `.test.ts` 结尾**，自动被 `dist/tests/*.test.js` 的 glob 收录，无需注册。
- **import 必须写 `.js` 后缀**（`'../routes/classroom.js'`）—— 因为跑的是 `tsc` 编译后的 `dist/`。
- 纯函数测试照 `classroom-state.test.ts` 的极简风格；路由测试照 `group-participant-flow.test.ts` 的风格：手写 mock `prisma` + `app.set('io', { to: () => ({ emit: () => undefined }) })` + 真实 `http` server 监听 0 端口。**广播断言靠收集 `emit` 调用**。
- 单跑一个文件（在 `server/` 下，先 `pnpm build:server`）：`node --test dist/tests/<name>.test.js`

---

## 后端现状（写完计划前必须知道的四件事）

这四条我已在代码里核实，写在这里以免实施者重新发现。

**① `joined` 事件是死的。** 服务端会发它（`server/src/socket/index.ts:342-352`），但**前端全仓没有任何地方监听** —— 只有 `src/lib/socket-events.ts:3` 一条过时的类型声明（它的 payload 也只声明了两个字段，与实现不符）。**学生的初始三态不要走它。**

**② 广播必须双发。** 教师 socket 只 join 了 `teacher:<id>`（`socket/index.ts:395`），**不在** `classroom:<id>` 房间里。所以每个事件都要 `io.to('classroom:${id}')` **和** `io.to('teacher:${id}')` 各发一次，否则有一边收不到。既有先例：`classroom.ts:662-663`、`:704-705`、`:723-724`、`:785-786`、`:808-809`、`:830-831`。

**③ 老课堂必须有默认态兜底。** schema 自动同步（`server/src/index.ts:117-193`）用手写 `CREATE TABLE` DDL 建表，但**已存在的课堂不会有任何行**。升级后老课堂不能变成「三个模块都不可用」。**读取路径必须兜底**（未找到该 module 记录时返回默认态），或在建课堂时初始化三行 —— 两者都做更稳。

**④ schema 同步块整段包在一个 `try/catch` 里**（`index.ts:117-193`），**单个 ALTER 失败会静默中断后续所有检查**。新增代码要插在合适位置或用自己的 try 块。

---

## Task 1: 数据模型与 schema 自动同步

**Files:**
- Modify: `server/prisma/schema.prisma`（新增 model + `Classroom` 反向关系）
- Modify: `server/src/index.ts`（schema 同步块）
- Test: 无（靠 `pnpm build:server` + 启动验证）

**Interfaces:**
- Produces: Prisma 模型 `ClassroomModule`，字段 `{ id, classroomId, moduleKey, state, createdAt, updatedAt }`，`@@unique([classroomId, moduleKey])`

- [ ] **Step 1: 读既有模式再动手**

```bash
cd /Users/zxc/myprojects/classnode
echo "=== ClassroomAgent（要模仿的模式）===" && sed -n '171,181p' server/prisma/schema.prisma
echo "=== Classroom 模型与关系块 ===" && sed -n '105,125p' server/prisma/schema.prisma
echo "=== schema 同步块里的两个建表先例 ===" && sed -n '123,140p' server/src/index.ts
echo "=== 加列先例（最贴近本场景）===" && sed -n '184,193p' server/src/index.ts
```

- [ ] **Step 2: 在 `schema.prisma` 新增模型**

```prisma
// 课堂模块三态（学习单 / 探究助手 / 智能学伴）
model ClassroomModule {
  id          String @id @default(uuid())
  classroomId String
  moduleKey   String // 'learning-sheet' | 'explorer' | 'companion'
  state       String @default("preview") // 'open' | 'preview' | 'hidden'

  classroom Classroom @relation(fields: [classroomId], references: [id], onDelete: Cascade)

  @@unique([classroomId, moduleKey])
  @@index([classroomId])
}
```

**并在 `Classroom` 模型的关系块加反向字段**：`modules ClassroomModule[]`。**漏了反向关系 `prisma generate` 会报错。**

- [ ] **Step 3: 在 `index.ts` 的同步块加建表逻辑**

仿 `Avatar` / `TeacherNotification` 的写法（探测 `sqlite_master` → 手写 `CREATE TABLE`），并**同时建唯一索引**（对应 `@@unique`）：

```ts
const moduleTable = await prisma.$queryRawUnsafe<{ name: string }[]>(
  `SELECT name FROM sqlite_master WHERE type='table' AND name='ClassroomModule'`
);
if (moduleTable.length === 0) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "ClassroomModule" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "classroomId" TEXT NOT NULL,
      "moduleKey" TEXT NOT NULL,
      "state" TEXT NOT NULL DEFAULT 'preview',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ClassroomModule_classroomId_fkey" FOREIGN KEY ("classroomId")
        REFERENCES "Classroom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX "ClassroomModule_classroomId_moduleKey_key" ON "ClassroomModule"("classroomId", "moduleKey")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX "ClassroomModule_classroomId_idx" ON "ClassroomModule"("classroomId")`
  );
}
```

**注意**：索引名必须与 Prisma 生成的约定一致（`<Model>_<field1>_<field2>_key`），否则将来 `prisma db push` 会试图重建。**实施者须核对 `prisma db push` 后 `schema.prisma` 与实际表结构是否一致** —— 这是本任务最容易出错的地方。

- [ ] **Step 4: 生成 Prisma client 并推送 schema**

```bash
pnpm --filter classnode-server db:generate
pnpm --filter classnode-server db:push
```

- [ ] **Step 5: 验证**

```bash
pnpm build:server; echo "build:server 退出码: $?"
pnpm test 2>&1 | tail -5
```

`pnpm test` 的 32 项必须仍全过（本任务不动任何既有逻辑）。

**另外启动一次服务端确认同步块不抛错**（`./dev.sh start` 后看日志有无 `Schema sync` 相关告警），然后 `./dev.sh stop`。

- [ ] **Step 6: 提交**

```bash
git add server/prisma/schema.prisma server/src/index.ts
git commit -m "feat(server): 新增 ClassroomModule 表与 schema 自动同步"
```

---

## Task 2: 服务端状态常量与校验

**Files:**
- Create: `server/src/services/classroom-module-state.ts`
- Test: `server/src/tests/classroom-module-state.test.ts`

**Interfaces:**
- Produces:
  - `type ModuleKey = 'learning-sheet' | 'explorer' | 'companion'`
  - `type ModuleState = 'open' | 'preview' | 'hidden'`
  - `const MODULE_KEYS: readonly ModuleKey[]`
  - `const MODULE_STATES: readonly ModuleState[]`
  - `const DEFAULT_MODULE_STATE: ModuleState`（值必须是 `'preview'`）
  - `function isValidModuleKey(v: unknown): v is ModuleKey`
  - `function isValidModuleState(v: unknown): v is ModuleState`

**为什么单独一个文件：** 项目已有 `services/classroom-state.ts`（13 行）作为「状态取值只有一处定义」的先例。三态也要这样，让路由、广播、学生端下发**共用同一个真值来源**。

- [ ] **Step 1: 先读既有先例**

```bash
cat server/src/services/classroom-state.ts
cat server/src/tests/classroom-state.test.ts
```

- [ ] **Step 2: 写失败的测试**

`server/src/tests/classroom-module-state.test.ts`：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODULE_KEYS, MODULE_STATES, DEFAULT_MODULE_STATE,
  isValidModuleKey, isValidModuleState,
} from '../services/classroom-module-state.js';

test('module keys and states are the expected closed sets', () => {
  assert.deepEqual([...MODULE_KEYS].sort(), ['companion', 'explorer', 'learning-sheet']);
  assert.deepEqual([...MODULE_STATES].sort(), ['hidden', 'open', 'preview']);
});

test('default module state is preview', () => {
  assert.equal(DEFAULT_MODULE_STATE, 'preview');
});

test('module key validation accepts only known keys', () => {
  assert.equal(isValidModuleKey('learning-sheet'), true);
  assert.equal(isValidModuleKey('explorer'), true);
  assert.equal(isValidModuleKey('companion'), true);
  assert.equal(isValidModuleKey('worksheet'), false); // 旧的候选名，必须被拒
  assert.equal(isValidModuleKey(''), false);
  assert.equal(isValidModuleKey(null), false);
  assert.equal(isValidModuleKey(undefined), false);
  assert.equal(isValidModuleKey(42), false);
});

test('module state validation accepts only known states', () => {
  assert.equal(isValidModuleState('open'), true);
  assert.equal(isValidModuleState('preview'), true);
  assert.equal(isValidModuleState('hidden'), true);
  assert.equal(isValidModuleState('locked'), false);
  assert.equal(isValidModuleState(''), false);
  assert.equal(isValidModuleState(null), false);
  assert.equal(isValidModuleState({ open: true }), false);
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd server && pnpm build && node --test dist/tests/classroom-module-state.test.js
```

预期：FAIL，`Cannot find module '../services/classroom-module-state.js'`。

- [ ] **Step 4: 实现**

`server/src/services/classroom-module-state.ts`：

```ts
export type ModuleKey = 'learning-sheet' | 'explorer' | 'companion';
export type ModuleState = 'open' | 'preview' | 'hidden';

export const MODULE_KEYS: readonly ModuleKey[] = ['learning-sheet', 'explorer', 'companion'] as const;
export const MODULE_STATES: readonly ModuleState[] = ['open', 'preview', 'hidden'] as const;

/** 老课堂没有 ClassroomModule 行时的兜底态。教学上最保守：可见但锁定。 */
export const DEFAULT_MODULE_STATE: ModuleState = 'preview';

export function isValidModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && (MODULE_KEYS as readonly string[]).includes(value);
}

export function isValidModuleState(value: unknown): value is ModuleState {
  return typeof value === 'string' && (MODULE_STATES as readonly string[]).includes(value);
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd server && pnpm build && node --test dist/tests/classroom-module-state.test.js
```

预期：4 项全过。

- [ ] **Step 6: 提交**

```bash
git add server/src/services/classroom-module-state.ts server/src/tests/classroom-module-state.test.ts
git commit -m "feat(server): 新增课堂模块三态的取值与校验"
```

---

## Task 3: PUT 端点与双发广播

**Files:**
- Modify: `server/src/routes/classroom.ts`（新增端点）
- Test: `server/src/tests/classroom-module-state-route.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `isValidModuleKey` / `isValidModuleState`
- Produces: `PUT /api/classroom/:id/modules/:moduleKey`，请求体 `{ state: ModuleState }`，响应 `{ moduleKey, state }`；成功时向 `classroom:<id>` 与 `teacher:<id>` 双发 `module-state-changed`，payload `{ moduleKey, state }`

**为什么是 `PUT` 而不是 `toggle`：** 既有权限开关都是 `POST /:id/toggle-allow-*`（读旧值取反）。三态不是布尔，取反没有意义；`PUT` 幂等、带目标态、可重试，是正确形状。

- [ ] **Step 1: 读既有端点作为结构模板**

```bash
cd /Users/zxc/myprojects/classnode
echo "=== toggle-allow-stop（双发广播的范例）===" && sed -n '773,793p' server/src/routes/classroom.ts
echo "=== 路由文件的挂载前缀 ===" && grep -n "app.use\|router\." server/src/routes/classroom.ts | head -8
echo "=== 既有路由测试的写法 ===" && sed -n '1,60p' server/src/tests/group-participant-flow.test.ts
```

**注意**：按项目约定，`/api/classroom` 的**教师鉴权在 `index.ts` 注册时统一挂**，路由自己不加重认证。新端点会**自动**被 `requireTeacher` 覆盖（它不属于那三个白名单形状）。**实施者须确认这一点**并在报告中说明。

- [ ] **Step 2: 写失败的测试**

`server/src/tests/classroom-module-state-route.test.ts`。照 `group-participant-flow.test.ts` 的 mock 风格：手写 `prisma` mock（只实现被调用的方法）、`app.set('io', …)` 收集 emit 调用、真实 http server。

测试至少覆盖：
1. 合法请求 → 200，响应 `{ moduleKey, state }`
2. **广播双发**：断言 `emit` 被调用了两次，房间名分别是 `classroom:classroom-1` 与 `teacher:classroom-1`，事件名 `module-state-changed`，payload `{ moduleKey, state }`
3. 非法 `moduleKey`（如 `'worksheet'`）→ 400，且**不写库、不广播**
4. 非法 `state`（如 `'locked'`）→ 400，且**不写库、不广播**
5. 课堂不存在 → 404
6. **幂等**：连续两次同值 PUT 都返回 200（且第二次不因「值未变」而报错）

- [ ] **Step 3: 跑测试确认失败**

```bash
cd server && pnpm build && node --test dist/tests/classroom-module-state-route.test.js
```

- [ ] **Step 4: 实现端点**

用 `upsert`（而非 `create`），因为老课堂没有行：

```ts
const record = await prisma.classroomModule.upsert({
  where: { classroomId_moduleKey: { classroomId: id, moduleKey } },
  create: { classroomId: id, moduleKey, state },
  update: { state },
});
const io = req.app.get('io');
io.to(`classroom:${id}`).emit('module-state-changed', { moduleKey, state });
io.to(`teacher:${id}`).emit('module-state-changed', { moduleKey, state });
res.json({ moduleKey, state });
```

**`where` 的复合键名必须是 `classroomId_moduleKey`**（Prisma 对 `@@unique([classroomId, moduleKey])` 的约定命名）。

- [ ] **Step 5: 跑测试确认通过 + 全量测试**

```bash
cd server && pnpm build && node --test dist/tests/classroom-module-state-route.test.js
cd /Users/zxc/myprojects/classnode && pnpm test 2>&1 | tail -5
```

**既有的 32 项必须仍全过。**

- [ ] **Step 6: 提交**

```bash
git add server/src/routes/classroom.ts server/src/tests/classroom-module-state-route.test.ts
git commit -m "feat(server): 新增课堂模块三态设置端点与双发广播"
```

---

## Task 4: 学生端初始三态下发 + 事件类型

**Files:**
- Modify: `server/src/routes/classroom.ts`（`GET /code/:code` 的返回对象）
- Modify: `src/lib/socket-events.ts`（新增事件类型，顺带修掉过时的 `joined` 声明）
- Test: `server/src/tests/classroom-module-state-route.test.ts`（追加一个用例）或独立文件

**Interfaces:**
- Consumes: Task 2 的 `MODULE_KEYS` / `DEFAULT_MODULE_STATE`
- Produces: `GET /api/classroom/code/:code` 的响应新增 `modules: Array<{ moduleKey, state }>`，**始终包含全部三个 key**（缺失的用默认态补齐）

**为什么走这里而不是 `joined`：** 见「后端现状 ①」—— `joined` 前端从不监听。而 `GET /code/:code` **已被学生端的 15 秒轮询兜底**（`chat-panel.tsx` 的轮询 effect），加字段就自动获得兜底与首屏两条路径。

- [ ] **Step 1: 定位返回对象**

```bash
cd /Users/zxc/myprojects/classnode
sed -n '521,570p' server/src/routes/classroom.ts
echo "=== 学生端 Event 类型声明 ===" && cat src/lib/socket-events.ts
```

- [ ] **Step 2: 写失败的测试**

断言 `GET /code/:code` 的响应含 `modules`，且：
- 该课堂有记录时返回记录的态
- **该课堂没有任何 `ClassroomModule` 行时，仍返回三个 key 且都是 `DEFAULT_MODULE_STATE`**（这条是老课堂升级兼容的核心）
- 只有部分 key 有记录时，缺失的用默认态补齐

- [ ] **Step 3: 跑测试确认失败 → 实现 → 跑测试确认通过**

实现要点：查 `classroomModule.findMany({ where: { classroomId } })`，然后

```ts
modules: MODULE_KEYS.map((moduleKey) => ({
  moduleKey,
  state: records.find((r) => r.moduleKey === moduleKey)?.state ?? DEFAULT_MODULE_STATE,
})),
```

**必须用 `MODULE_KEYS` 遍历补齐，不能直接返回查到的数组** —— 否则老课堂会返回空数组，学生端三个模块全部不可用。

- [ ] **Step 4: 补 `socket-events.ts` 的事件类型**

在 `ServerToClientEvents` 加：

```ts
'module-state-changed': (payload: { moduleKey: string; state: string }) => void;
```

**顺带修掉过时的 `joined` 声明**（`:3` 只声明了 `{ classroomId, blacklisted }`，与服务端实际 payload 不符）—— 要么改成实际形状，要么标注为「前端不监听」。

- [ ] **Step 5: 验证**

```bash
npx tsc --noEmit; echo "tsc: $?"
npx eslint src/app/classroom/; echo "eslint: $?"
pnpm test 2>&1 | tail -5
```

- [ ] **Step 6: 提交**

```bash
git add server/src/routes/classroom.ts src/lib/socket-events.ts server/src/tests/
git commit -m "feat(classroom): 学生端初始三态下发与事件类型"
```

---

## Task 5: 教师端三态控制 UI

**Files:**
- Modify: `src/app/teacher/classroom/page.tsx`（课堂看板）
- Modify: `src/lib/api.ts`（新增 API 方法）

**Interfaces:**
- Consumes: Task 3 的端点、Task 4 的事件类型
- Produces: 教师端可实时切换三个模块的态；教师端监听 `module-state-changed` 回显

**UI 落点**：照既有「课堂权限」下拉菜单（`src/app/teacher/classroom/page.tsx:877-891`）。它是三个布尔开关；新增的是一组**三选一**，形态不同，建议**单独一个下拉菜单**或在该菜单里加一个分组，**不要混进布尔开关列表**。

每个模块三个选项：`开放` / `预告（可见但锁定）` / `隐藏`。用 `role="menu"` / `role="menuitemradio"` 配 `aria-checked`。

- [ ] **Step 1: 读既有 UI 与数据流**

```bash
cd /Users/zxc/myprojects/classnode
echo "=== 权限下拉菜单（要模仿的交互）===" && sed -n '877,891p' src/app/teacher/classroom/page.tsx
echo "=== PermissionMenuItem 组件 ===" && sed -n '33,50p' src/app/teacher/classroom/page.tsx
echo "=== toggleStop 的乐观更新写法 ===" && sed -n '654,670p' src/app/teacher/classroom/page.tsx
echo "=== 教师端如何拿 classroom ===" && grep -n "setClassroom\|useState.*classroom" src/app/teacher/classroom/page.tsx | head
echo "=== api.ts 的 toggleAllowStop ===" && grep -n "toggleAllowStop" src/lib/api.ts
```

- [ ] **Step 2: 加 API 方法**

`src/lib/api.ts` 新增 `setClassroomModuleState(id: string, moduleKey: string, state: string)`，`PUT` 到 `/classroom/${id}/modules/${moduleKey}`，body `{ state }`。

- [ ] **Step 3: 实现 UI**

- 三态选择器，每个模块一行
- **乐观更新**（照 `toggleStop` 的写法）：点击立即更新本地 `classroom` 状态，请求失败则回滚并 `Toast`
- **监听 `module-state-changed` 回显**，让多端教师看到一致状态。注意教师端 socket 在 `teacher:<id>` 房间，广播已双发故能收到
- **`busy` 态**：请求期间禁用该项，防连点（照 `controlBusy` 的写法）

- [ ] **Step 4: 人工走查（本任务必做）**

教师端涉及真实交互，`tsc` 抓不到。`./dev.sh start` 后：

- [ ] 课堂看板上出现三态控制入口
- [ ] 切换某个模块到「隐藏」→ 请求成功、UI 反映新态
- [ ] 快速连点同一项 → 不产生重复请求（busy 生效）
- [ ] 断网/让请求失败 → UI 回滚且出现 Toast
- [ ] 刷新教师端页面 → 三态从服务端读回（证明 `GET /code/:code` 或课堂接口带回了它）

- [ ] **Step 5: 验证并提交**

```bash
npx tsc --noEmit; echo "tsc: $?"
npx eslint src/app/classroom/ src/app/teacher/; echo "eslint: $?"
pnpm build; echo "build: $?"
```

```bash
git add src/app/teacher/classroom/page.tsx src/lib/api.ts
git commit -m "feat(teacher): 课堂看板新增模块三态控制"
```

---

## Task 6: 端到端验收

**Files:** 无（纯验证）

- [ ] **Step 1: 干净启动**

```bash
./dev.sh stop && ./dev.sh start && ./dev.sh status
```

- [ ] **Step 2: 端到端走查（需要两个浏览器窗口：教师端 + 学生端）**

- [ ] 教师建课堂 → 学生进课堂
- [ ] 教师把「智能学伴」切到 `hidden` → 学生端**实时**收到（此刻学生端只是记录状态，M1b-2 才会渲染外壳；可在控制台或临时日志确认收到的 payload）
- [ ] 教师切到 `preview` → 学生端再收一次
- [ ] 教师切到 `open` → 学生端再收一次
- [ ] **断网重连**：学生端断网 → 教师改态 → 学生端恢复 → **15 秒内**通过轮询拿到最新态
- [ ] **老课堂兼容**：挑一个本分支之前建的课堂，确认 `GET /code/:code` 返回三个 key 且都是 `preview`

- [ ] **Step 3: 全量门禁**

```bash
npx tsc --noEmit; echo "tsc: $?"
npx eslint src/app/classroom/ src/app/teacher/; echo "eslint: $?"
pnpm build; echo "build: $?"
pnpm test 2>&1 | tail -5
git log --oneline main..HEAD
```

预期：`tsc` 退出 0 零输出；`eslint` 退出 0、恰好 1 条既有 warning；`pnpm build` 退出 0 且 Safari 检查通过；`pnpm test` **32 项 + 本里程碑新增的用例全过**。

---

## 完成后

M1b-1 交付：服务端有三态存储与端点、教师端能实时控制，学生端能收到推送与初始态。

**M1b-2 接手的事**（不在本计划内）：学生端首页（常驻门户）、`shell/` 容器 + `active` prop + 挂载管理 + 切换动画、以及**设计文档 §4.10 的全部前置项**（其中「streaming ref 复位只存在于面板卸载清理中」那条有两条互斥路线必须选一条）。M1b-2 的验收是**真机性能门槛**（设计文档 §4.8 的四项指标）。
