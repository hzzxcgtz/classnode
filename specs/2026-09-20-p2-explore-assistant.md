# P2（探究助手）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 教师上传一个静态网页（ZIP 或多选文件）→ 学生在「探究助手」tab 里真的打开它 → 学生在网页里的操作实时出现在教师看板的图墙上。

**Architecture:** 新增**第二个 Express 实例**（同进程、独立端口 `CLASSNODE_WEBAPP_PORT`）只做静态托管，**不挂任何 API、不带任何 cookie、不设 `X-Frame-Options`** —— 于是学生端 `<iframe sandbox="allow-scripts allow-same-origin …">` 加载它时是**跨源**的，`allow-same-origin` 因此安全。托管服务在返回 HTML 时向 `</head>` 前注入一段 SDK；SDK 用 `postMessage` 把事件与截图交给学生端父页面，父页面经已有的 socket.io 连接送到服务端内存，再推给教师看板。

**Tech Stack:** Express + Prisma/SQLite + Socket.IO（`server/`）；Next.js 15 静态导出 + React 18 + CSS Modules（`src/`）；Safari 15（老 iPad）为硬约束。**不引入任何新依赖** —— `adm-zip` 已在 `server/package.json:24`。

**Spec:** `specs/2026-09-19-classnode-learning-suite-design.md` —— **§5 是权威设计**（§5.1 源隔离 / §5.2 上传 / §5.3 外部依赖自检 / §5.4 SDK / §5.5 实时链路 / §5.6 教师端），另 §10.2（隔离要点）、§10.3（未成年人数据）、§11.1（兼容检查扩容）、§12（错误处理）。

---

## 🔴 Step 0：分支与一个硬前置

```bash
git branch --show-current   # feat/m1b3-topbar-actions
git rev-parse HEAD          # 12b889e（**每次派发前自己现查，不要信系统快照**）
```

P2 从当前 `feat/m1b3-topbar-actions` 分出（与 M1b-3 从 M1b-2 分出同例）：

```bash
git checkout -b feat/p2-explore-assistant
```

⇒ 三个里程碑连成一条链，最后一次性合并。M1b-2 与 M1b-3 **都还没合并**。

### 🔴 派发 T1 之前：`dev.sh` 必须先落地

`dev.sh` 的工作区版本有用户自己的 **105 行未提交改动**（CLI 重构：`pkg` 目标归一、`db` 子命令、help 重写、`cmd_clean` 改清 `.dev/{pids,logs}`）。而 **T1 要改的正是同一批函数**（`cmd_status` 的 `for service in client server`、`start_service` 的端口注入、help 文案）。

⇒ **T1 派发前必须确认 `git status --porcelain dev.sh` 为空**。不空就请用户先提交，**不得**把两边的改动混进同一个 commit。

### 用户的明确要求

1. 中途不找用户确认合并；全部完成后才汇报，同意后才合并。
2. `CLAUDE.md` / `dev.sh` / `package.json` 里是用户自己的改动，**不碰**（T1 会合法地改 `dev.sh`，但只在用户提交之后）。
3. **只允许一个 `pnpm build` / `pnpm test` 在跑。**
4. **跑 `pnpm build` 之前先 `./dev.sh stop`，跑完 `./dev.sh start`，最后 `./dev.sh status` 复核 4000/4001 都在。** 这条被踩过三次：`pnpm build` 覆盖 `.next` 会把正在跑的 dev server 打成 500，**实施者因此拿到过假的绿灯**。

---

## Global Constraints

1. **既有 63 项测试必须继续全过**（`cd server && pnpm test`，基线 63 pass / 0 fail）。
2. **不得出现 regex lookbehind**（构建期检查会 fail）。**不得使用** Safari 15 不支持的 `Object.hasOwn` / `structuredClone` / `Array.prototype.at` / `findLast` / `:has()` / `@container` / `content-visibility`。
3. **`dvh` 与 `:focus-visible` 只在「有降级、不依赖它」时可用**（详见 Ruling 5）。
4. **提交信息中文**，格式 `<type>(scope): <做了什么>`。
5. **不碰** `CLAUDE.md` / `package.json`。
6. **不新增任何 npm 依赖。** ZIP 用已有的 `adm-zip`；SDK 是手写的单文件，不打包任何库。
7. **实施者必须用 `grep` 自行枚举依赖，不得信任任何清单（含本计划）。** 该条已生效过五次。
7b. 🔴 **凡是本计划给了「完整内容」让你整段替换一个**既有文件**的地方，你必须先读那个文件的当前内容，逐条列出它**现在**在做的事，再证明你的替换版**一件都没少**。**
   **这条是真的踩过**：T0 的「完整内容」替换掉 `check-classroom-browser-compat.mjs` 时，**把旧脚本唯一在查的 lookbehind 一起删了**（那是控制器的计划写错，实施者照做并上报，处置正确）。`tsc` / `lint` / `build` **全都不会报** —— 那个脚本的产物就是「什么都不报」。
   ⇒ 报告里必须给出：**替换前后各自在检查什么的对照表**，以及 `git diff` 里**每一处删除**的理由。
7c. **凡是 `Modify` 一个既有文件的任务，报告里必须给出该文件的 `git diff --stat` 与改动前后行数**，并明确回答「**有没有删除任何既有行为**」。大的（`socket/index.ts` 1001 行、`teacher/classroom/page.tsx` 2501 行）尤其要。
7d. 🔴 **任何「因此不扫 / 排除 / 安全 / 可以忽略」的注释或结论，必须附一条命令或一段实测输出。**
   **这条来自 T0 实施者的自省**（原文：「我写的『classroom 暂无懒加载』『不扫全量以免教师端假失败』都是**没核实的散文**，第二条还把一个真阳性挡在了扫描集外。**我是先有结论再补理由。**」）。
   代价是具体的：那句散文让一个**当时就存在**的 lookbehind 长期没被看见（`chunks/d6c63c35…js`，docx 库）。
   ⇒ 审查者可以直接查：「这句『所以安全』后面跟的命令在哪？」**没有命令的排除 = 未验证的排除。**
8. **测试若改数据库，必须逐表还原**，并在报告里给出还原证据。
9. **不要用 `reset-password` 造教师数据** —— 它会 `revokeAllTeacherSessions()`，把用户开着的教师标签页登出。

### 基线（动手前先跑一遍确认）

```bash
npx tsc --noEmit                              # 退出 0、零输出
npx eslint src/app/classroom/ src/lib/        # 退出 0、恰好 1 条既有 warning（use-student-session.ts 的 tokenData）
./dev.sh stop && pnpm build && ./dev.sh start # 退出 0 + Safari 检查通过；跑完必须复核 4000/4001
cd server && pnpm test                        # 63 pass / 0 fail
```

---

## Rulings（控制器已裁定）

**Ruling 1：第二个 Express 与主服务**同进程**，不是第二个进程。**

规格 §5.1 说「该端口故障不影响主服务」—— 那指的是**端口与请求层面**的隔离，不是进程隔离。同进程的理由是硬的：
- `server/src/index.ts:12` 的 `file-logger.ts` **必须是首个 import**（它 monkey-patch `console.*`）。第二进程要重来一遍日志与 `CLASSNODE_DATA_DIR` 解析。
- 需要共享 `CLASSNODE_DATA_DIR` 的解析与 prisma 单例。

⇒ 新实例自建最小中间件栈，`listen` 失败（`EADDRINUSE`）时**只 `console.warn` 并让主服务继续**，不 `process.exit`。

**若判断有误的代价**：将来若要求进程级隔离，需拆子进程并重做日志与 env 注入。

---

**Ruling 2：独立源服务**不继承主 app 的任何中间件**，且绝不设 `X-Frame-Options`。**

已核实 `server/src/index.ts:67-74` 的全局头里有 `res.setHeader('X-Frame-Options', 'DENY')`（`:71`）—— **照抄这段就会把 iframe 直接封死**。同一段里 `cors({ origin: true, credentials: true })`（`:67`）也与「不带任何 cookie」冲突。

新实例的栈只有三件：
1. 静态服务（`/webapps/<uuid>/…`）
2. 一个 **LAN gate**（与主服务同款、按 `remoteAddress` 判，不是 cookie）
3. SDK 脚本的 `/__classnode/sdk.js` 路由

**LAN gate 保留的理由**：教师关掉局域网访问（`lan-access = 'false'`）后，若 webapp 服务不守这条，局域网内仍能直接拉到托管网页。它与 cookie 无关，所以不与「不带 cookie」冲突。

**若判断有误的代价**：教师关闭局域网访问后，探究网页仍可被局域网内任意设备直接访问（只是静态资源，不含任何学生数据）。

---

**Ruling 3：前端通过 `GET /api/classroom/code/:code` 的响应发现 webapp 源，不新增 `NEXT_PUBLIC_*`。**

`src/lib/api-base.ts`（24 行）目前对「第二个源」一无所知。三条路里选这条：

| 路径 | 为什么不用 |
|---|---|
| 新增 `NEXT_PUBLIC_WEBAPP_PORT` | 端口可被 `CLASSNODE_WEBAPP_PORT` 覆盖，「服务端口 + 1」是**默认值不是恒定式**，前端硬编码 +1 会在覆盖时失效 |
| `/api/server-info` 下发 | 该端点**是教师门槛**（`index.ts` 注册时挂了 `requireTeacher`），学生调不到 |
| **✅ `GET /code/:code` 下发** | 学生端进课堂**必调**这个端点，且它本来就返回课堂信息；只需多带一个 `webappOrigin` |

dev 下的链路因此是：页面来自 `:4000`（Next dev）→ 接口 `:4001` → 托管源 `:4002`；生产下 `:3001` → `:3002`。

**若判断有误的代价**：若将来出现「拿到课堂信息之前就要构造 iframe src」的需求（现在没有），需补一条独立发现路径。

---

**Ruling 4（安全红线）：服务端必须**拒绝** `webappPort === serverPort`。**

`allow-scripts` + `allow-same-origin` 的组合**只在跨源时安全**（规格 §5.1 自己写明了这一点：同源时 iframe 可自行摘除 sandbox 并触达父页面）。

端口默认是「服务端口 + 1」，但 `CLASSNODE_WEBAPP_PORT` 可覆盖 —— 一旦被设成与服务端口相同，隔离**静默失效**。

⇒ 启动时若 `webappPort === port`：**不监听该端口**，打印明确错误，学生端的探究助手面板因此无法加载（可见的失败，优于静默的同源）。**不自动 +1** —— 自动改端口会让「用户配了什么」与「实际监听什么」不一致，排查时误导人。

**若判断有误的代价**：无（这是收紧而不是放宽）。

---

**Ruling 5：构建期兼容检查改为**扫源码 + 剥注释 + 按 (文件, 标记) 冻结当前行数**。**

三条实测事实决定了这个形状：

1. **扫 `out/` 产物会永久红。** 实测当前 `out/`：`Object.hasOwn` 命中 3 处（`256-*.js` 是 Next runtime 的垫片 `Object.hasOwn||(Object.hasOwn=…)`、`389-*.js` 是 `micromark` 的调用、`polyfills-*.js`）、`.at(` 命中 `256-*.js`（`e.digest.split(";").at(-2)`）、`structuredClone` 命中 `389-*.js`（`"function"==typeof structuredClone?…`，是**特性检测**）。这些开发者修不了 ⇒ 闸门永远红 ⇒ 没人再看它。
2. **现有脚本完全不读 CSS。** `scripts/check-classroom-browser-compat.mjs:13-15` 只从 `out/classroom/index.html` 抠 `<script src>`。而九条规则里**五条是 CSS 的**（`:has()` / `@container` / `content-visibility` / `dvh` / `:focus-visible`）。
3. **不剥注释会被自己的注释绊倒。** `home.module.css:3-4` 与 `shell.module.css:3-4` 的约束注释**逐字写着**这些标记。

**`dvh` 与 `:focus-visible` 的现状**（实测，都必须豁免）：

| 位置 | 内容 | 判定 |
|---|---|---|
| `chat.module.css:5-9` | `height:100vh; height:100dvh; height:var(--chat-viewport-height,100dvh);` + `max-height:var(…,100dvh)` | **有意的渐进增强**：`100vh` 是给 Safari 15 的降级行。`chat-panel.tsx:213-214` 的注释明写「Safari 15 不认识 dvh 会把整条声明丢弃 → 该帧高度退化为 auto」 |
| `globals.css:33,988,989,1299,1305`（5 行）<br>`chat.module.css:36,102`（2 行） | `:focus-visible { outline: … }` | 不支持 ⇒ **只丢焦点环**，布局与功能不受影响 |

⇒ **白名单按 `(文件, 标记) → 当前命中行数` 冻结**。行数**增长**即失败 —— 这样豁免文件里也不能再偷偷加新的同类用法。

**若判断有误的代价**：白名单略宽（豁免文件内新增同类用法只能靠行数捕获，不能靠语义）；或若某处豁免判断错了，会漏掉一个真问题。**这是取舍而不是疏漏**，依据是上面那张实测表。

> **顺带发现（记入 T0 的收口项）**：`home.module.css:3-4` 与 `shell.module.css:3-4` 的注释声称「不用 `dvh` / `:focus-visible`」，而 `chat.module.css` 与 `globals.css` 里两样**都在用**（共 7 行）。属「散文声称了一个不存在的机制」的**第 9 次**，T0 顺手把注释改成与事实相符的措辞。

---

**Ruling 6（⚠️ 用户可否决）：P2 的截图只做 `<canvas>` 直读，不引入截图库。**

规格 §5.4 写的是「优先直读 `<canvas>`（快）；页面无大 canvas 时按需加载截图库」，即**两档**。本计划**只做第一档**。

理由：第三方截图库（html2canvas 之类）体积大、要么外链（而 T2 的外部依赖自检恰恰在劝教师别依赖外链，自相矛盾）要么打包进 SDK；对老 iPad 是重负载，而 §4.8 的性能门槛是硬指标。**P2 不新增任何依赖**（Global Constraint 6）。

**代价（必须让用户知情）**：**纯 DOM 型探究网页在教师图墙上是空缩略图**，教师只能看到事件流（点击了什么、滚动到哪、页面内跳转），看不到画面。canvas 型（绘图、几何、模拟类）不受影响。

**若判断有误的代价**：教师对非 canvas 网页的监控能力弱于设计预期。**这条列为待用户决定项。**

---

**Ruling 7（隐私红线，不可放宽）：事件采集**默认不采集输入框内容**，靠**类型**而不是靠纪律来保证。**

规格 §5.4 的原文：「事件采集**默认不采集输入框内容**，仅记录『在某输入框输入、长度 N』。需采集具体内容必须由教师网页显式调用 `ClassNode.report()`。**此为面向未成年人的底线，不可放宽。**」

实现上的关键：SDK 里**构造上报载荷的只有一个函数**，它的参数类型里**没有任何内容字段** —— 输入事件只允许携带 `{ 选择器, 输入框类型, 长度 }`。`value` / `textContent` / `innerText` 一律不读。

⇒ 「不采集内容」变成**类型系统的约束**，而不是「实施者记得别写」。加一个内容字段会变成编译/审查双闸。

**若判断有误的代价**：未成年人的输入内容外泄到教师看板与服务端内存。**不可接受。**

---

**Ruling 8：监控数据只存内存，课堂结束释放；唯一落盘是一条汇总记录。**

先例是 `socket/index.ts:26-28` 的 `teacherNotificationCache`（内存 Map + TTL），其有界化写法在同文件 `:38-55` 的 `pruneSocketCaches`、由 `:301-302` 的定时器驱动。P2 的按学生帧 Map **照这个写**。

**若判断有误的代价**：内存随课堂时长线性增长（40 人 × 一帧 ≈ 600KB，可接受；不裁剪则无上界）。

---

**Ruling 9：「按需推流」用 `io.sockets.adapter.rooms.get('teacher:<id>')?.size`。**

**仓内没有任何先例**（侦察确认：`io.engine.clientsCount` 只在 `agents.ts:522` 与 `agent-checker.ts:65` 用来报数，没有一处按房间人数决定推不推）。

两个必须注意的点：
1. **房间空时会被 adapter 删除** ⇒ `get()` 返回 `undefined` ⇒ 必须 `?? 0`。
2. 判定要**防抖**：教师刷新页面会产生 0 → 1 → 0 的瞬时抖动，立刻停止推流会让刚回来的教师看到空图墙。⇒ 归零后延迟数秒再停。

**若判断有误的代价**：教师没开看板时学生端仍在上报（白耗电、白占带宽）；或更糟 —— 教师开着却收不到。

---

**Ruling 10：学生端 iframe 面板**不改** `ModulePanelProps` 契约。**

`classroom-types.ts:106-117` 的六字段契约里，`active` 的语义已经**正是**「此刻是否可见」，且 `:78-79` 的注释逐字点名了「如探究助手在此向 iframe 发挂起信号」。⇒ 挂起/恢复直接由 `active` 的**边沿**驱动，**不新增 prop、不改契约**（契约的「加一个模块 = 加一个组件」原则照旧成立）。

**若判断有误的代价**：无（这是最小改动路径）。

---

**Ruling 11：Tauri 侧必须显式注入 webapp 端口，并补 `webapps` 目录。**

已核实的三处事实：
- `src-tauri/src/lib.rs:27` `const SERVER_PORT: u16 = 3001;` —— **硬编码**，不是环境变量。
- `src-tauri/src/lib.rs:368-373` 的子进程 env **只注入 `CLASSNODE_DATA_DIR` 与 `DATABASE_URL`，不注入 `PORT`**（靠 `server/src/index.ts:54` 的 `parseInt(process.env.PORT || '3001')` 兜底）。⇒ **桌面端没有 `dev.sh`**，新端口不显式注入就永远不会生效。
- `src-tauri/src/lib.rs:277-280` 预建 `uploads/{chat,logos,temp}` + `backups`，**没有 `webapps`**。

⇒ T1 必须同时改：加常量、`spawn_server` 里对**两个**端口各调一次 `ensure_port_free`（`:206-211`）、env 链上补注入、目录列表加 `webapps`。

**顺带如实指出**：`server/.env` 里的 `PORT=3001` 对 `node dist/index.js` 其实是**惰性的** —— 全仓**没有任何 `dotenv`**（已 grep 确认）。所以「写进 `server/.env` 就生效」是错的，新端口只能靠 `dev.sh` / Tauri 显式 export。

**若判断有误的代价**：桌面端第二端口被占时静默失败；或 `webapps/` 目录不存在导致上传 500。

---

**Ruling 12：独立源服务必须进优雅退出。**

`server/src/index.ts:400-407` 的 shutdown **只 `close()` 了主 `httpServer`**。新实例不一并 close 的话，`process.exit(0)` 会掩盖它 —— 症状是开发时端口不被释放，下次启动撞 `assert_port_free` 直接 `die`（`dev.sh:59-63`）。

**若判断有误的代价**：每次 `./dev.sh restart` 都可能失败在端口占用上。

---

**Ruling 13：`sandbox` 集合照规格，不做增减。**

`allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-downloads`
**故意不给**：`allow-top-navigation`（防网页跳走整个页面）、`allow-modals`（防 `alert` 卡死老 iPad）。

`allow-downloads` 与 `allow-pointer-lock` 看似宽松，但它们是**教师自己写的教学网页**的合理需求（下载素材、拖拽交互），且跨源前提下无法触达父页面。

**若判断有误的代价**：某类教学网页功能不可用；或（放宽方向）增加一个逃逸面。

---

## 派发前冲突扫描的裁定

扫描覆盖：**每一对共享文件或接口的任务**，以及**每个任务自身文本是否自洽**。

### 共享文件 / 接口的对

| 任务对 | 共享物 | 谁产出 / 谁消费 | 裁定 |
|---|---|---|---|
| **T1 × T4** | 托管服务的 HTML 响应路径 | T1 建这个服务；T4 要在返回 HTML 时注入 SDK | **真冲突**。⇒ T1 **留一个具名接缝**：在返回 HTML 处调用 `injectSdk(html)`，该函数住在独立文件 `server/src/services/webapp-sdk.ts`，T1 只建一个**返回原串的原样桩**并写清注释。T4 只改这一个文件。**T4 不得改 T1 的服务文件。** |
| **T2 × T3** | 上传路由的校验链 | T3 产出扫描函数；T2 的路由要调它 | **真冲突**。⇒ **T3 排在 T2 之前**（纯函数 + 测试，零依赖），T2 直接 import。依赖方向单一，无前向依赖。**这是本计划与交接文件的顺序差异之一。** |
| **T2 × T5** | `webapps` 表的字段 | T2 建表；T5 要按课堂查「这个班关联了哪些网页」 | **不冲突**：T5 只**读** T2 建的表。⇒ T5 动手前先 `grep` `schema.prisma` 确认字段名，**不得照抄本计划的字段清单**。 |
| **T5 × T6** | postMessage 的**消息形状** | T5 定服务端事件名与载荷；T6 定父页面的接收端 | **真冲突（接口）**。⇒ **消息形状在 T5 定死并写进 `socket-events.ts`**，T6 按它写接收端。两者不得各自发明字段名。 |
| **T5 × T7** | 教师端订阅的事件名 | 同上 | 同上：T5 定名，T7 消费。 |
| **T6 × T7** | 无共享文件 | — | 无冲突 |
| **T0 × T1** | 无共享文件（T0 只动 `scripts/`） | — | 无冲突 |
| **T1 × T7** | 教师端「在线预览」要打开托管网页 | T1 提供源；T7 拼 URL | 轻微：T7 需要 `webappOrigin`。教师端能调 `/api/server-info`（有权限）⇒ T1 在那里也下发一份。**与 Ruling 3 不冲突**：学生走 `/code/:code`，教师走 `/api/server-info`，两处都下发、值同源。 |

### 每个任务自身是否自洽

| 任务 | 自洽性检查 |
|---|---|
| T0 | ✅ 规则表与豁免表覆盖同一批标记，无遗漏 |
| T1 | ✅ 端口常量、`dev.sh` 注入点、Tauri 注入点三处一一对应（已逐行核实） |
| T2 | ✅ import 的 `scanExternalDeps` 由 T3 产出，顺序在前 |
| T3 | ✅ 纯函数，无前置 |
| T4 | ✅ 只改 T1 留的桩文件 + 新增 SDK 源码 |
| T5 | ✅ 事件名在 T5 定义，T6/T7 消费；无循环依赖 |
| T6 | ✅ 只用 `ModulePanelProps` 的 `active`，不改契约 |
| T7 | ✅ 复用 `agents/` 的模式，无新契约 |
| T8 | ✅ 是清单，不含代码 |

---

## Task 0: 构建期兼容检查扩容

**Files:**
- Modify: `scripts/check-classroom-browser-compat.mjs`（35 行 → 约 130 行）
- Modify: `src/app/classroom/home/home.module.css:3-4`、`src/app/classroom/shell/shell.module.css:3-4`（只改注释措辞）
- Test: 无自动化测试（脚本自身即门禁），但**必须有手工反证**

**Interfaces:**
- Produces: 一个在 `pnpm build` 末尾运行的构建期闸门。后续所有任务的新代码都被它覆盖。

**背景**：规格 §11.1 说这是「本次升级中性价比最高的一项改动」，但**交接文件的任务分解漏了它**。它独立、零阻塞，所以排在 T1 之前，给后面所有前端代码上闸。

**为什么扫源码而不是扫 `out/`**：见 Ruling 5 —— 扫产物会命中 Next runtime 与 vendor chunk 的 3 处，**开发者修不了，闸门会永久红**。

- [ ] **Step 1: 先写「会被绊倒」的反证，确认真实基线**

在动手改脚本之前，先跑一遍现有脚本，把基线记下来（**这是验证闸门有效性的对照组，不是可选项**）：

```bash
./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status
# 记下当前输出的通过条数
```

- [ ] **Step 2: 重写脚本**

完整内容：

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- 1. 剥注释 ----------------------------------------------------------
// 必须剥，否则 home.module.css / shell.module.css 的「硬约束」注释本身
// 就逐字写着这些标记，脚本会被自己的注释绊倒（实测）。
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释（CSS + JS）
    .replace(/^[ \t]*\/\/.*$/gm, '')    // 行注释（JS/TS）
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // 行尾注释（避免吃掉 https://）
}

// ---- 2. 标记表 ----------------------------------------------------------
// hard: 零容忍，任何命中即失败。
// allowed: 已知且**有意**的用法，按 (文件, 标记) 冻结当前命中**行数** ——
//          行数增长即失败，这样豁免文件里也不能再偷偷加新的同类用法。
//          d 与 e 两条的依据见计划 Ruling 5 的实测表。
const HARD_TOKENS = [
  'Object.hasOwn',
  'structuredClone',
  'findLast',
  ':has(',
  '@container',
  'content-visibility',
  // `.at(` 单独一条，因为它最容易被误伤（`format(` 不含 `.at(`，但 `foo.at(` 是真命中）
  '.at(',
];

const ALLOWED = {
  'src/app/classroom/chat/chat.module.css': {
    // 100vh → 100dvh 的渐进增强链；chat-panel.tsx:213-214 明写
    // 「Safari 15 不认识 dvh 会把整条声明丢弃 → 该帧高度退化为 auto」
    'dvh': 3,
    ':focus-visible': 2,
  },
  'src/app/globals.css': {
    // 不支持只丢焦点环，布局与功能不受影响
    ':focus-visible': 5,
  },
};

// ---- 3. 扫描目标 --------------------------------------------------------
// 源码级：每个命中都可归因、可修。产物级会命中 Next runtime 与 vendor chunk。
const SCAN_ROOTS = ['src/app/classroom', 'src/lib', 'src/app/globals.css'];
const EXTS = ['.ts', '.tsx', '.css', '.mjs'];

function walk(target, out = []) {
  const abs = path.join(root, target);
  if (!fs.existsSync(abs)) return out;
  const stat = fs.statSync(abs);
  if (stat.isFile()) { out.push(target); return out; }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) walk(child, out);
    else if (EXTS.some((ext) => entry.name.endsWith(ext))) out.push(child);
  }
  return out;
}

const failures = [];
const files = SCAN_ROOTS.flatMap((r) => walk(r));

for (const rel of files) {
  const raw = fs.readFileSync(path.join(root, rel), 'utf8');
  const source = stripComments(raw);
  const lines = source.split('\n');

  for (const token of HARD_TOKENS) {
    const hit = lines.findIndex((line) => line.includes(token));
    if (hit !== -1) {
      failures.push(`${rel}:${hit + 1}: Safari 15 不支持 ${token}`);
    }
  }

  for (const [token, budget] of Object.entries(ALLOWED[rel] ?? {})) {
    const count = lines.filter((line) => line.includes(token)).length;
    if (count > budget) {
      failures.push(
        `${rel}: ${token} 出现 ${count} 行，超出豁免额度 ${budget} 行。` +
        `\n  该文件对该标记的既有用法是有意的降级（见 Ruling 5），但**不得新增**。`,
      );
    }
  }
}

// 反向检查：豁免表里点名的文件必须还在，否则豁免表在悄悄腐烂
for (const rel of Object.keys(ALLOWED)) {
  if (!files.includes(rel)) failures.push(`豁免表引用了不存在的文件: ${rel}`);
}

if (failures.length > 0) {
  throw new Error(`学生端浏览器兼容性检查失败:\n${failures.join('\n')}`);
}

console.log(
  `[browser-compat] 源码 ${files.length} 个文件通过 Safari 15 检查` +
  `（豁免 ${Object.keys(ALLOWED).length} 个文件的既有降级用法）`,
);
```

- [ ] **Step 3: 反证 —— 必须能真的失败**

**这一步是本任务的核心，不能跳过。** 逐个注入一个假违规，确认构建**真的红**，然后**撤掉**：

```bash
# 反证 1（CSS 标记，旧脚本根本扫不到 CSS）
printf '\n.x { color: red; }\n.y:has(> .z) { color: blue; }\n' >> src/app/classroom/home/home.module.css
./dev.sh stop && pnpm build; echo "退出码 $?"   # 必须非 0，且错误里点名 home.module.css
git checkout src/app/classroom/home/home.module.css

# 反证 2（JS 标记）
printf '\nconst a = Object.hasOwn({}, "k");\n' >> src/app/classroom/module-meta.tsx
./dev.sh stop && pnpm build; echo "退出码 $?"   # 必须非 0
git checkout src/app/classroom/module-meta.tsx

# 反证 3（豁免额度 —— 这条最容易做假）
# 往 globals.css 里再加一条 :focus-visible 规则，必须红
./dev.sh stop && pnpm build; echo "退出码 $?"
git checkout src/app/globals.css

./dev.sh start && ./dev.sh status   # 复核 4000/4001 都在
```

**三条都必须红。任何一条没红，说明闸门是假的** —— 修脚本，不要降低要求。

- [ ] **Step 4: 改两处与事实不符的注释**

`home.module.css:3-4` 与 `shell.module.css:3-4` 现在写的是「不用 `:has()` / `content-visibility` / `@container` / `dvh` / `color-mix()` / `:focus-visible`」。**`dvh` 与 `:focus-visible` 在本仓是在用的**（`chat.module.css` 与 `globals.css` 共 7 行），只是**都带降级**。

改成与事实相符的措辞，例如：

```
 * 硬约束（Safari 15，老 iPad）：不用 `:has()` / `content-visibility` / `@container` /
 * `color-mix()`；`dvh` 与 `:focus-visible` **只在带降级时**可用（如 chat.module.css 的
 * 100vh→100dvh 链）。动效只碰 `transform` 与 `opacity`
```

**不要顺手改代码去迁就注释** —— 那些用法是对的，错的是注释。

- [ ] **Step 5: 门禁 + 提交**

```bash
npx tsc --noEmit && pnpm lint
./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status
git add scripts/check-classroom-browser-compat.mjs src/app/classroom/home/home.module.css src/app/classroom/shell/shell.module.css
git commit -m "build(compat): 兼容检查扩为扫源码并覆盖 CSS 标记，附豁免额度"
```

---

## Task 1: 第三端口 + 独立源托管服务 + Tauri 侧

**Files:**
- Create: `server/src/services/webapp-host.ts`（独立 Express 实例）
- Create: `server/src/services/webapp-sdk.ts`（**T1 只建原样桩**，T4 填实现）
- Modify: `server/src/index.ts`（启动时起第二个监听；优雅退出时一并关闭；`/api/server-info` 与 `GET /code/:code` 下发 `webappOrigin`）
- Modify: `server/src/routes/classroom.ts`（`GET /code/:code` 响应加 `webappOrigin`）
- Modify: `dev.sh`（**仅在用户提交其改动之后**）
- Modify: `src-tauri/src/lib.rs`
- Test: `server/src/tests/webapp-host.test.ts`

**Interfaces:**
- Consumes: 无（本任务是底座）
- Produces:
  - `resolveWebappPort(serverPort: number): number` —— 读 `CLASSNODE_WEBAPP_PORT`，默认 `serverPort + 1`
  - `webappsRoot(): string` —— `<CLASSNODE_DATA_DIR>/webapps` 或 `<server>/uploads/webapps` 兜底
  - `startWebappHost(opts: { port: number; serverPort: number; lanAccessEnabled: boolean; webappsRoot: string }): Promise<import('node:http').Server | null>`
  - `injectSdk(html: string, opts: { sdkPath: string }): string` —— **T1 返回 `html` 原样**
  - `SDK_PATH = '/__classnode/sdk.js'`
  - 响应字段 `webappOrigin: string`（形如 `http://192.168.1.5:4002`）

**⚠️ 派发前置**：`git status --porcelain dev.sh` 必须为空。不空就停下来找用户。

- [ ] **Step 1: 端口与目录解析（先写测试）**

`server/src/tests/webapp-host.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWebappPort, webappsRoot } from '../services/webapp-host.js';

test('resolveWebappPort 默认是服务端口 + 1', () => {
  const saved = process.env.CLASSNODE_WEBAPP_PORT;
  delete process.env.CLASSNODE_WEBAPP_PORT;
  assert.equal(resolveWebappPort(4001), 4002);
  assert.equal(resolveWebappPort(3001), 3002);
  if (saved === undefined) delete process.env.CLASSNODE_WEBAPP_PORT;
  else process.env.CLASSNODE_WEBAPP_PORT = saved;
});

test('resolveWebappPort 可被环境变量覆盖', () => {
  const saved = process.env.CLASSNODE_WEBAPP_PORT;
  process.env.CLASSNODE_WEBAPP_PORT = '5555';
  assert.equal(resolveWebappPort(4001), 5555);
  if (saved === undefined) delete process.env.CLASSNODE_WEBAPP_PORT;
  else process.env.CLASSNODE_WEBAPP_PORT = saved;
});

test('resolveWebappPort 忽略非法值（回落到默认）', () => {
  const saved = process.env.CLASSNODE_WEBAPP_PORT;
  process.env.CLASSNODE_WEBAPP_PORT = 'abc';
  assert.equal(resolveWebappPort(4001), 4002);
  process.env.CLASSNODE_WEBAPP_PORT = '70000';  // 超出端口范围
  assert.equal(resolveWebappPort(4001), 4002);
  if (saved === undefined) delete process.env.CLASSNODE_WEBAPP_PORT;
  else process.env.CLASSNODE_WEBAPP_PORT = saved;
});
```

```bash
cd server && pnpm build && node --test dist/tests/webapp-host.test.js
# 预期：FAIL —— 找不到 resolveWebappPort
```

- [ ] **Step 2: 实现 `webapp-host.ts` 的解析部分**

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 独立源服务的端口。
 *
 * 默认「服务端口 + 1」而不是写死 4002：dev 下服务在 4001、桌面端在 3001（硬编码于
 * src-tauri/src/lib.rs:27），+1 让两边都对。可用 CLASSNODE_WEBAPP_PORT 覆盖。
 *
 * 非法值（非数字、超出 1..65535）**回落到默认**而不是抛错 —— 端口是启动路径上的配置，
 * 一个手滑的拼写不该让整个服务起不来。
 */
export function resolveWebappPort(serverPort: number): number {
  const raw = process.env.CLASSNODE_WEBAPP_PORT;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) return parsed;
  }
  return serverPort + 1;
}

/**
 * 托管网页的根目录。
 *
 * 与 uploads 平级（规格 §5.2）。注意 routes 层与 services 层的兜底深度不同：
 * 编译产物在 server/dist/services/，所以 '../..' 才是 server/。**照抄本函数的兜底，
 * 不要照抄 routes/upload.ts:16 的 '../../uploads'**（那是从 dist/routes/ 往上两级）。
 */
export function webappsRoot(): string {
  const base = process.env.CLASSNODE_DATA_DIR
    ? path.join(process.env.CLASSNODE_DATA_DIR, 'webapps')
    : path.join(__dirname, '../../uploads/webapps');
  return base;
}
```

```bash
cd server && pnpm build && node --test dist/tests/webapp-host.test.js
# 预期：3 pass
```

- [ ] **Step 3: 建 SDK 注入的接缝（T1 只建桩）**

`server/src/services/webapp-sdk.ts`：

```ts
export const SDK_PATH = '/__classnode/sdk.js';

/**
 * 在返回给学生的 HTML 里注入 SDK。
 *
 * ⚠️ **本文件是 T1 与 T4 的唯一接缝。** T1 只建这个「原样返回」的桩，让托管服务
 * 有一个具名的调用点；T4 实现真正的注入。**T4 只改这个文件，不得改 webapp-host.ts。**
 *
 * 这么做是因为 T1 与 T4 都要动「返回 HTML」这条路径：若 T1 什么都不留、T4 再去
 * webapp-host.ts 里加，两个任务就会改同一个文件的同一段（派发前冲突扫描已识别）。
 */
export function injectSdk(html: string, _opts: { sdkPath: string }): string {
  return html; // T4 替换本行
}
```

- [ ] **Step 4: 建独立源托管服务**

`webapp-host.ts` 追加：

```ts
import express from 'express';
import type { Server } from 'node:http';

export interface StartWebappHostOptions {
  port: number;
  /** 主服务端口。用来拒绝「webapp 端口 == 服务端口」这个危险的配置，见 Ruling 4。 */
  serverPort: number;
  lanAccessEnabled: boolean;
  webappsRoot: string;
}

/**
 * 独立源的静态托管服务（规格 §5.1）。
 *
 * **它不继承主 app 的任何中间件**，理由逐条都有出处：
 *   · `server/src/index.ts:71` 全局设了 `X-Frame-Options: DENY` —— 照抄这段会把
 *     iframe 直接封死。本服务**绝不设这个头**。
 *   · `:67` 的 `cors({ origin: true, credentials: true })` 与规格要求的
 *     「不带任何 cookie」冲突。本服务不设 cors，也不读 cookie。
 *   · `:75` 的 `express.json()` / `:77-80` 的 `/api` no-store / 各种 API 路由
 *     —— 本服务**一个都不挂**。
 *
 * LAN gate 是**保留**的（与主服务 `:98-101` 同款）：它按 remoteAddress 判、与 cookie
 * 无关，所以不与「不带 cookie」冲突。不保留的话，教师关掉局域网访问后，局域网内仍能
 * 直接拉到托管网页。
 */
export async function startWebappHost(
  opts: StartWebappHostOptions,
): Promise<Server | null> {
  // Ruling 4：同源 + allow-same-origin + allow-scripts 是危险组合
  // （iframe 可自行摘除 sandbox 并触达父页面）。端口相同意味着隔离静默失效。
  // **不自动 +1** —— 自动改端口会让「用户配了什么」与「实际监听什么」不一致。
  if (opts.port === opts.serverPort) {
    console.error(
      `❌ 探究助手托管端口(${opts.port}) 不能与服务端口相同。` +
      `同源 iframe 会让 sandbox 隔离失效，已拒绝启动该服务。` +
      `请设置 CLASSNODE_WEBAPP_PORT 为其他端口。`,
    );
    return null;
  }

  const app = express();

  const isLoopback = (address?: string) =>
    address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';

  app.use((req, res, next) => {
    if (opts.lanAccessEnabled || isLoopback(req.socket.remoteAddress)) return next();
    res.status(403).send('教师已关闭局域网访问');
  });

  // SDK 脚本。⚠️ 挂载必须在静态之前，否则会被 /webapps 的静态中间件抢走。
  app.get(SDK_PATH, (_req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-store'); // 与 HTML 同样的理由：升级后不能留旧的
    res.send(readSdkSource());
  });

  app.use(
    '/webapps',
    express.static(opts.webappsRoot, {
      index: ['index.html'],
      redirect: false,
      dotfiles: 'deny',
      setHeaders: (res) => {
        // 关键：静态 HTML 必须 no-store（CLAUDE.md 的既有约束）。托管网页与主前端
        // 是同一类东西 —— 升级后浏览器留着旧 HTML 会去请求已删的 JS chunk。
        res.setHeader('Cache-Control', 'no-store');
      },
    }),
  );

  return await new Promise<Server | null>((resolve) => {
    const server = app.listen(opts.port, '0.0.0.0', () => {
      console.log(`📦 探究助手托管服务 http://0.0.0.0:${opts.port}`);
      resolve(server);
    });
    server.on('error', (error: NodeJS.ErrnoException) => {
      // Ruling 1：本服务起不来**不能**拖垮主服务。EADDRINUSE 只 warn。
      console.error(`⚠️ 探究助手托管服务启动失败（${error.code}）：${error.message}`);
      console.error('   主服务继续运行；学生端的探究助手将无法加载。');
      resolve(null);
    });
  });
}
```

`readSdkSource()` 在 T1 里先返回一个最小可用的占位脚本（T4 换成真身）：

```ts
function readSdkSource(): string {
  return '/* ClassNode SDK — 实现见 Task 4 */\n';
}
```

- [ ] **Step 5: 接进 `index.ts`**

在 `main()` 里 `httpServer.listen`（`:383`）**之后**：

```ts
const webappPort = resolveWebappPort(port);
const webappServer = await startWebappHost({
  port: webappPort,
  serverPort: port,
  lanAccessEnabled: app.get('lanAccessEnabled') !== false,
  webappsRoot: webappsRoot(),
});
```

在 shutdown（`:400-407`）里一并关闭（**Ruling 12**）：

```ts
webappServer?.close();
```

`/api/server-info`（`:356-378`）的响应加一个字段：

```ts
webappOrigin: `http://${chosenIp}:${webappPort}`,
```

> 教师端用它做「在线预览」；学生端走 `GET /code/:code`（Ruling 3）。两处值同源，都来自这一个变量。

- [ ] **Step 6: `GET /code/:code` 下发 `webappOrigin`（学生端的发现路径）**

`server/src/routes/classroom.ts` 里 `GET /code/:code` 的响应加 `webappOrigin`。

⚠️ **端口值从哪来**：不要在这个文件里重新算一遍 —— `resolveWebappPort` 只在 `index.ts` 调用一次。用 `req.app.get('webappOrigin')`（在 `index.ts` 里 `app.set('webappOrigin', ...)`），与 `prisma` / `io` / `lanAccessEnabled` 同一套注入方式（CLAUDE.md 的既有约定）。

**实施者注意**：`resolveWebappPort` 与 `app.set('webappOrigin', …)` 的调用顺序 —— `app.set` 必须在 `main()` 里、`listen` 之前完成，否则路由拿到 `undefined`。动手前先读 `index.ts:92-95` 那三行 `app.set` 的位置，照同样时机放。

- [ ] **Step 7: `dev.sh`**

**先确认 `git status --porcelain dev.sh` 为空。** 然后：

1. `:10` 附近加 `WEBAPP_PORT="${CLASSNODE_WEBAPP_PORT:-$((SERVER_PORT + 1))}"`
2. 后端进程的 env 注入（`:99-100` 与前台模式 `:158`）加 `CLASSNODE_WEBAPP_PORT="$WEBAPP_PORT"`
3. `cmd_status`（`:173-185`）：server 那一行附带打印 webapp 端口。⚠️ 不要新增第三个 service 项 —— `cmd_stop`（`:167-171`）只按 PID 文件停，webapp 与 server **同进程**（Ruling 1），加了反而会去找一个不存在的 PID 文件。
4. `cmd_start`（`:148-149`）与 help（`:280`、`:305`）的端口说明一并更新
5. **`cmd_foreground`（`:155-156`）也要加 `assert_port_free "$WEBAPP_PORT"`** —— 否则前台模式下端口被占会表现为「服务起来了但探究助手加载不出来」，而不是明确的启动失败

⚠️ 注意 `assert_port_free`（`:59-63`）是 `die`（直接退出）—— 新增端口会把这个失败面从 2 扩大到 3。这是**有意的**：宁可启动失败，也不要静默的半可用状态。

- [ ] **Step 8: Tauri 侧（Ruling 11）**

`src-tauri/src/lib.rs`：

1. `:27` 旁加 `const WEBAPP_PORT: u16 = SERVER_PORT + 1;`
2. `spawn_server` 里 `:259` 之后对第二个端口再调一次 `ensure_port_free(WEBAPP_PORT)?`
3. env 链（`:368-373`）加 `.env("CLASSNODE_WEBAPP_PORT", WEBAPP_PORT.to_string())`
4. 数据目录预建列表（`:277-280`）加 `webapps`

- [ ] **Step 9: 门禁 + 实测端到端 + 提交**

```bash
# 单元测试
cd server && pnpm build && node --test dist/tests/webapp-host.test.js

# 端到端：手工放一个网页进去，确认托管服务真的能服务它，且**没有** X-Frame-Options
mkdir -p server/uploads/webapps/probe && printf '<h1>probe</h1>' > server/uploads/webapps/probe/index.html
./dev.sh restart && sleep 3
curl -sI http://127.0.0.1:4002/webapps/probe/ | grep -i 'x-frame-options'   # 必须**无输出**
curl -s  http://127.0.0.1:4002/webapps/probe/                               # 必须回 <h1>probe</h1>
curl -sI http://127.0.0.1:4002/api/health                                   # 必须 404（本服务不挂 API）
curl -sI http://127.0.0.1:4002/__classnode/sdk.js                           # 必须 200
rm -rf server/uploads/webapps/probe

# 反证：端口相同必须被拒绝（Ruling 4）
CLASSNODE_WEBAPP_PORT=4001 ./dev.sh restart && sleep 3
curl -s http://127.0.0.1:4001/api/health   # 主服务必须活着
# 日志里必须有「不能与服务端口相同」
./dev.sh restart

# 门禁
npx tsc --noEmit && pnpm lint
./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status   # 复核 4000/4001/4002
cd server && pnpm test                                             # 63 + 新增全过

git add server/src/services/webapp-host.ts server/src/services/webapp-sdk.ts \
        server/src/index.ts server/src/routes/classroom.ts \
        server/src/tests/webapp-host.test.ts dev.sh src-tauri/src/lib.rs
git commit -m "feat(webapp): 独立源托管服务与第三端口（含 Tauri 侧注入）"
```

**报告里必须给出**：`curl -sI` 那条 `X-Frame-Options` 的**原始输出**（证明它为空），以及端口相同时的日志原文。

---

## Task 2: 外部依赖自检（纯函数）

**Files:**
- Create: `server/src/services/webapp-external-deps.ts`
- Test: `server/src/tests/webapp-external-deps.test.ts`

**Interfaces:**
- Consumes: 无（**纯函数，零依赖 —— 所以它排在 T3 之前**）
- Produces:
  - `interface WebappSourceFile { path: string; content: string }`
  - `interface ExternalDependency { url: string; file: string }`
  - `scanExternalDeps(files: readonly WebappSourceFile[]): ExternalDependency[]`

**为什么排在 T3 之前**：T3 的上传路由要调它。派发前冲突扫描识别出这是唯一的前向依赖，交换顺序即可消除（见冲突扫描表的 T2×T3 行）。

**背景（规格 §5.3）**：教师可能在网页里用 CDN。环境是「局域网为主 + 外网可达」，外网正常时无碍，**外网变慢或被限流时该网页会白屏**，而教师会误判为 ClassNode 故障。

**不阻断上传，仅提醒。**

- [ ] **Step 1: 写测试**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanExternalDeps } from '../services/webapp-external-deps.js';

const f = (path: string, content: string) => ({ path, content });

test('命中 HTML 里的外链 script 与 link', () => {
  const deps = scanExternalDeps([
    f('index.html', `
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex/katex.min.css">
      <script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script>
    `),
  ]);
  assert.equal(deps.length, 2);
  assert.ok(deps.every((d) => d.file === 'index.html'));
});

test('相对路径与同源绝对路径不算外部依赖', () => {
  const deps = scanExternalDeps([
    f('index.html', '<script src="./app.js"></script><link href="/style.css" rel="stylesheet">'),
    f('app.js', "fetch('/api/data.json')"),
  ]);
  assert.deepEqual(deps, []);
});

test('CSS 的 @import 与 url() 都算', () => {
  const deps = scanExternalDeps([
    f('style.css', `@import url("https://fonts.googleapis.com/css2?family=Inter");
      .a { background: url(https://example.com/bg.png); }`),
  ]);
  assert.equal(deps.length, 2);
});

test('JS 里的字符串 URL 也算（fetch / import）', () => {
  const deps = scanExternalDeps([
    f('app.js', `import('https://cdn.skypack.dev/lodash');
      fetch("https://api.example.com/x");`),
  ]);
  assert.equal(deps.length, 2);
});

test('去重：同一个 URL 在多处出现只报一次', () => {
  const deps = scanExternalDeps([
    f('index.html', '<script src="https://cdn.a.com/x.js"></script>'),
    f('app.js', 'const u = "https://cdn.a.com/x.js";'),
  ]);
  assert.equal(deps.length, 1);
  assert.equal(deps[0].file, 'index.html'); // 先出现的文件
});

test('不把注释里的 URL 当依赖', () => {
  const deps = scanExternalDeps([
    f('app.js', '// 参考 https://example.com/docs\n/* https://example.com/x */'),
  ]);
  assert.deepEqual(deps, []);
});

test('排除 data: 与 blob: —— 它们是内联内容，不是外部依赖', () => {
  const deps = scanExternalDeps([
    f('style.css', '.a { background: url(data:image/png;base64,AAA); }'),
    f('app.js', 'const b = "blob:http://localhost/xxx";'),
  ]);
  assert.deepEqual(deps, []);
});

test('http 与 https 都算（局域网内的 http 服务同样会在断网时失效）', () => {
  const deps = scanExternalDeps([f('index.html', '<img src="http://10.0.0.5/logo.png">')]);
  assert.equal(deps.length, 1);
});
```

```bash
cd server && pnpm build && node --test dist/tests/webapp-external-deps.test.js
# 预期：FAIL —— 模块不存在
```

- [ ] **Step 2: 实现**

```ts
export interface WebappSourceFile {
  path: string;
  content: string;
}

export interface ExternalDependency {
  url: string;
  /** 首次出现这个 URL 的文件（包内相对路径）。 */
  file: string;
}

/**
 * 剥离注释后再找 URL。
 *
 * 必须剥：教师的网页里「参考 https://…/docs」这类注释很常见，把它们报成外部依赖
 * 会让提示变成噪音，而这条提示的价值完全建立在「报出来的都是真依赖」上。
 *
 * 已知的粗糙之处（有意的取舍）：会把字符串字面量里的 URL 一并算进来，哪怕它只是
 * 一段说明文字而非真的去请求。**宁可多报** —— 本函数的输出只驱动一条提醒，不阻断
 * 上传；漏报的代价（白屏后误判为 ClassNode 故障）比多报大得多。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** 匹配 http(s):// 开头、到空白或引号/括号/分号为止的一段。 */
const URL_PATTERN = /https?:\/\/[^\s"'`)>;,]+/g;

export function scanExternalDeps(
  files: readonly WebappSourceFile[],
): ExternalDependency[] {
  const seen = new Map<string, string>();

  for (const file of files) {
    const source = stripComments(file.content);
    for (const match of source.matchAll(URL_PATTERN)) {
      const url = match[0];
      // data: / blob: 不是 http(s)，上面的正则已经排除。这里再挡一次「同源相对地址
      // 被误写成绝对地址」的情况不必要 —— 教师写 http://10.0.0.5/x 就是外部依赖。
      if (!seen.has(url)) seen.set(url, file.path);
    }
  }

  return [...seen.entries()].map(([url, file]) => ({ url, file }));
}
```

```bash
cd server && pnpm build && node --test dist/tests/webapp-external-deps.test.js
# 预期：8 pass
```

- [ ] **Step 3: 门禁 + 提交**

```bash
npx tsc --noEmit
cd server && pnpm test      # 63 + 8 = 71 pass
git add server/src/services/webapp-external-deps.ts server/src/tests/webapp-external-deps.test.ts
git commit -m "feat(webapp): 外部依赖扫描（纯函数，供上传时提醒）"
```

---

## Task 3: 上传与存储

**Files:**
- Modify: `server/prisma/schema.prisma`（新增 `Webapp` 与 `ClassroomWebapp`）
- Modify: `server/src/index.ts`（新表的手写 DDL 同步块）
- Create: `server/src/routes/webapps.ts`
- Modify: `server/src/index.ts`（注册路由 + 鉴权）+ `src/lib/api.ts`（前端 API 函数）
- Test: `server/src/tests/webapp-upload.test.ts`

**Interfaces:**
- Consumes: `scanExternalDeps`（T2）；`webappsRoot()`（T1）
- Produces:
  - Prisma 模型 `Webapp`（`id/name/entryPath/createdAt/updatedAt`）与 `ClassroomWebapp`（`id/classroomId/webappId`，`@@unique([classroomId, webappId])`）
  - `validateWebappUpload(files: { path: string; size: number }[], entryHint?: string): { ok: true; entry: string } | { ok: false; reason: string }`
  - REST：`GET /api/webapps`、`GET /api/webapps/:id`、`POST /api/webapps`（multipart）、`PUT /api/webapps/:id`、`DELETE /api/webapps/:id`、`GET /api/webapps/:id/usage`

**⚠️ 实施者必须先 `grep` `schema.prisma` 与 `index.ts` 的 DDL 块**，按**既有写法**建表，不要照抄本计划的字段清单（Global Constraint 7）。已核实的既有写法：

- 主键：`String @id @default(uuid())`（`Agent :23`）
- 时间戳：`createdAt DateTime @default(now())` + `updatedAt DateTime @updatedAt`
- 带自身 id 的关联表：代理主键 + `@@unique`（`ClassroomAgent :173-182`）
- 手写 DDL 的三种笔法：具名外键约束（`:140-149`）、先探表再探索引的自愈写法（`:154-165`）、内联 FK 简写（`:214-221`）

⚠️ **`ClassroomModule :194-196` 旁边有一条长注释**：它的 schema 定义**必须与 `index.ts` 的手写 DDL 逐字对齐**，否则下次 `db push` 会重建表而同步块不再重跑。**新表照这条规矩办。**

- [ ] **Step 1: 上传校验（先写测试）**

`webapp-upload.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWebappUpload } from '../routes/webapps.js';

const f = (path: string, size = 1024) => ({ path, size });

test('必须有入口 HTML', () => {
  const r = validateWebappUpload([f('style.css'), f('app.js')]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /入口/);
});

test('单个 index.html 即可通过', () => {
  const r = validateWebappUpload([f('index.html')]);
  assert.deepEqual(r, { ok: true, entry: 'index.html' });
});

test('多个 HTML 时取第一个（按传入顺序），除非给了 entryHint', () => {
  const r = validateWebappUpload([f('a.html'), f('b.html')]);
  assert.deepEqual(r, { ok: true, entry: 'a.html' });
  const r2 = validateWebappUpload([f('a.html'), f('b.html')], 'b.html');
  assert.deepEqual(r2, { ok: true, entry: 'b.html' });
});

test('entryHint 指向不存在的文件时拒绝', () => {
  const r = validateWebappUpload([f('a.html')], 'nope.html');
  assert.equal(r.ok, false);
});

test('拒绝服务端脚本（本模块只做静态托管）', () => {
  for (const bad of ['x.php', 'x.jsp', 'x.asp', 'x.aspx', 'x.cgi', 'x.pl', 'x.py', 'x.rb']) {
    const r = validateWebappUpload([f('index.html'), f(bad)]);
    assert.equal(r.ok, false, `${bad} 应当被拒绝`);
  }
});

test('拒绝扩展名白名单之外的（含无扩展名）', () => {
  const r = validateWebappUpload([f('index.html'), f('evil.exe')]);
  assert.equal(r.ok, false);
  assert.equal(validateWebappUpload([f('index.html'), f('Makefile')]).ok, false);
});

test('白名单内的扩展名一律放行', () => {
  const ok = ['index.html', 's.css', 's.js', 's.mjs', 'd.json', 'i.png', 'i.jpg', 'i.svg',
    'f.woff2', 'f.ttf', 'a.mp3', 'a.mp4', 'w.wasm', 'i.webp', 'i.gif'];
  assert.equal(validateWebappUpload(ok.map((p) => f(p))).ok, true);
});

test('路径穿越一律拒绝（ZIP 里的 ../ 与绝对路径）', () => {
  for (const bad of ['../evil.html', '/etc/passwd', 'a/../../index.html', 'C:\\x.html']) {
    assert.equal(validateWebappUpload([f('index.html'), f(bad)]).ok, false, `${bad} 应被拒绝`);
  }
});

test('三项上限：文件数 / 单文件 / 总量', () => {
  assert.equal(validateWebappUpload(
    [f('index.html'), ...Array.from({ length: 600 }, (_, i) => f(`a${i}.css`))]).ok, false);
  assert.equal(validateWebappUpload([f('index.html', 30 * 1024 * 1024)]).ok, false);
  assert.equal(validateWebappUpload([f('index.html'), f('big.js', 90 * 1024 * 1024)]).ok, false);
});

test('大小写不敏感（.HTML 也是入口）', () => {
  assert.deepEqual(validateWebappUpload([f('INDEX.HTML')]), { ok: true, entry: 'INDEX.HTML' });
});
```

```bash
cd server && pnpm build && node --test dist/tests/webapp-upload.test.js
# 预期：FAIL
```

- [ ] **Step 2: 实现校验与常量**

在 `server/src/routes/webapps.ts` 里。**上限值集中在一处并导出**，好让 T7 的教师端提示与之一致：

```ts
/** 上传上限。集中在这里，教师端提示文案与它对齐（不要让两处各写一个数字）。 */
export const WEBAPP_LIMITS = {
  maxFiles: 500,
  maxSingleFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 80 * 1024 * 1024,
} as const;

/**
 * 扩展名白名单（规格 §5.2）。
 *
 * ⚠️ **服务端脚本一个都不给**：本模块只做静态托管，`.php` / `.jsp` / `.asp` / `.cgi`
 * 之类被下载走也不会执行，但放它们进来等于给未来的某个配置错误留一个执行面。
 * 这一类是**显式拒绝**而不是「不在白名单里所以顺带被拒」—— 理由是拒绝时的文案要
 * 说得具体（「本模块只托管静态网页」比「扩展名不支持」有用）。
 */
const REJECTED_EXTENSIONS = new Set([
  'php', 'php3', 'php4', 'php5', 'phtml', 'jsp', 'jspx', 'asp', 'aspx', 'cgi', 'pl', 'py', 'rb', 'sh',
]);

const ALLOWED_EXTENSIONS = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'map',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm',
  'wasm', 'txt', 'csv', 'md',
]);
```

`validateWebappUpload` 的**校验顺序**（顺序本身是设计，写清理由）：

```ts
export function validateWebappUpload(
  files: readonly { path: string; size: number }[],
  entryHint?: string,
): { ok: true; entry: string } | { ok: false; reason: string } {
  // 1. 路径安全最先 —— 它关乎「能不能写出目录」，比任何业务校验都优先。
  for (const file of files) {
    const normalized = file.path.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
      return { ok: false, reason: `不允许绝对路径：${file.path}` };
    }
    const segments = normalized.split('/');
    if (segments.some((s) => s === '..' || s === '.' || s === '')) {
      return { ok: false, reason: `路径含非法片段：${file.path}` };
    }
  }

  // 2. 数量与体积。放在扩展名前 —— 一个 5000 文件的包不值得逐个查扩展名。
  if (files.length > WEBAPP_LIMITS.maxFiles) {
    return { ok: false, reason: `文件数超过上限 ${WEBAPP_LIMITS.maxFiles}` };
  }
  let total = 0;
  for (const file of files) {
    if (file.size > WEBAPP_LIMITS.maxSingleFileBytes) {
      return { ok: false, reason: `单个文件超过上限 ${WEBAPP_LIMITS.maxSingleFileBytes / 1024 / 1024}MB：${file.path}` };
    }
    total += file.size;
  }
  if (total > WEBAPP_LIMITS.maxTotalBytes) {
    return { ok: false, reason: `总大小超过上限 ${WEBAPP_LIMITS.maxTotalBytes / 1024 / 1024}MB` };
  }

  // 3. 扩展名。
  for (const file of files) {
    const name = file.path.replace(/\\/g, '/').split('/').pop() ?? '';
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return { ok: false, reason: `文件必须有扩展名：${file.path}` };
    const ext = name.slice(dot + 1).toLowerCase();
    if (REJECTED_EXTENSIONS.has(ext)) {
      return { ok: false, reason: `本模块只托管静态网页，不接受服务端脚本：${file.path}` };
    }
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return { ok: false, reason: `不支持的文件类型 .${ext}：${file.path}` };
    }
  }

  // 4. 入口。放在最后 —— 前面都过了才谈得上「入口是哪个」。
  //    大小写不敏感：教师导出时写成 INDEX.HTML 很常见。
  const htmlFiles = files.filter((f) => f.path.toLowerCase().endsWith('.html') || f.path.toLowerCase().endsWith('.htm'));
  if (htmlFiles.length === 0) {
    return { ok: false, reason: '压缩包/所选文件中必须包含入口 HTML（如 index.html）' };
  }
  if (entryHint) {
    const hit = files.find((f) => f.path === entryHint);
    if (!hit) return { ok: false, reason: `指定的入口文件不存在：${entryHint}` };
    return { ok: true, entry: hit.path };
  }
  return { ok: true, entry: htmlFiles[0].path };
}
```

- [ ] **Step 3: 建表**

按 `schema.prisma` 的既有写法加 `Webapp` 与 `ClassroomWebapp`，并在 `index.ts` 的手写 DDL 块里加对应的 `CREATE TABLE`（**与 schema 逐字对齐**，见 `ClassroomModule :194-196` 的告诫）。

```bash
pnpm --filter classnode-server db:generate
cd server && pnpm build
```

- [ ] **Step 4: 路由本体**

照 `server/src/routes/agents.ts` 的骨架（`:14` 建 Router、每个 handler 内 `req.app.get('prisma')`、catch 统一 500 中文文案）。

上传路径两条：

```
POST /api/webapps
  Content-Type: multipart/form-data
  field:  archive（单个 .zip）或 files[]（多选）
  field:  name、entryHint（可选）
```

ZIP 那条**照 `server/src/routes/export.ts:719-728` 的现成模板**：multer 收 zip（扩展名白名单 `.zip`）→ `new AdmZip(path)` → `safeExtractZip(zip, dest, WEBAPP_LIMITS)` → 处理 → 删临时文件。

⚠️ **`safeExtractZip` 只查路径与体积，不做任何扩展名/内容白名单**（已核实 `upload-security.ts:61-87`）。⇒ 解压后**必须再跑一次 `validateWebappUpload`**，把扩展名与入口检查补上。**这两层都不能省**：`safeExtractZip` 防的是写出目录，`validateWebappUpload` 防的是托管不该托管的东西。

存储：`<webappsRoot()>/<uuid>/`，`entryPath` 存**包内相对路径**（不是绝对路径 —— 绝对路径会把数据目录的位置写进数据库，换机器就废）。

⚠️ **ZIP 有多层根目录是常态**（教师压缩时选了文件夹，于是包里是 `myproject/index.html`）。⇒ 解压后先探测：若**唯一**顶层项是目录且其中含 HTML，则把它**提升一层**（把该目录的内容移到 `<uuid>/` 下，`entryPath` 相应去掉前缀）。这条不写会得到一个「上传成功但打不开」的经典故障。**为这条写一个单测。**

- [ ] **Step 5: `GET /:id/usage`（照 `agents.ts:333-350`）**

```ts
const count = await prisma.classroomWebapp.count({ where: { webappId: req.params.id } });
res.json({ used: count > 0, classroomCount: count });
```

`DELETE /:id` 里同样拦截（照 `agents.ts:353-376`）：`count > 0` 时 400 + 中文文案；通过才 `prisma.webapp.delete` **并删除磁盘目录**。

⚠️ **删目录必须先校验路径**：照 `agents.ts:69-76` 的 `deleteManagedLogo` 手法 —— 先确认目标路径**确实在 `webappsRoot()` 之下**再 `fs.rm`，否则一个被污染的 `entryPath` 会变成任意删除。
**为这条写一个单测**（构造一个越界的 id/path，断言拒绝且磁盘未被触碰）。

- [ ] **Step 6: 把关联的网页下发给学生端**

T6 的面板要读 `classroom.webapps` 才知道该加载哪个网页。**服务端必须在 T3 就把这个字段发出来** —— 否则 T6 会去猜，或者被迫再开一个学生可访问的端点（那是把攻击面白白扩大）。

- `GET /api/classroom/code/:code`（学生可访问，`index.ts` 里三个免教师鉴权的形状之一）的响应加：
  ```ts
  webapps: [{ id, name, entryPath }]   // 该课堂关联的、教师已启用的网页，按关联顺序
  ```
- 教师端 `GET /api/classroom/:id` 同样加这一项（Ruling：两处共用同一个查询函数，避免两条路径口径不一）。

⚠️ **只发 `id` / `name` / `entryPath`，不发磁盘路径。** `Webapp` 表里若有任何指向文件系统的字段（绝对值或 `webappsRoot()` 之下的相对路径），**一律不进响应** —— 学生端拼 URL 只需要 `id` 与 `entryPath`（`${origin}/webapps/${id}/${entryPath}`），多发一个字段就等于把服务端的目录结构告诉客户端。

- [ ] **Step 7: 注册路由与鉴权**

`server/src/index.ts` 里按既有写法挂 `requireTeacher`（`webapps` 全部端点都是教师端，**没有学生可访问的端点** —— 学生靠 iframe 直接取静态文件，不经过 API）。

⚠️ **不要**给 `/api/webapps` 开学生 token 通道：一旦开了，学生就能列出全库的网页。**为这条写一个测试**：用学生 token 打 `GET /api/webapps`，断言 401/403。

- [ ] **Step 8: 门禁 + 提交**

```bash
npx tsc --noEmit && pnpm lint
cd server && pnpm test
./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status
git add server/prisma/schema.prisma server/src/index.ts server/src/routes/webapps.ts \
        server/src/routes/classroom.ts server/src/tests/webapp-upload.test.ts src/lib/api.ts
git commit -m "feat(webapp): 上传、校验与存储（ZIP 与多选两条路径）"
```

**报告里必须给出**：`GET /code/:code` 响应里 `webapps` 字段的原始 JSON（证明它只含 `id`/`name`/`entryPath`，**不含任何磁盘路径**），以及学生 token 打 `GET /api/webapps` 的**状态码**。

---

## Task 4: SDK 本体 + 注入

**Files:**
- Modify: `server/src/services/webapp-sdk.ts`（**填 T1 留的桩**；T4 只改这一个服务文件）
- Create: `server/public-sdk/classnode-sdk.js`（SDK 源码，纯 ES5 风格，无构建步骤）
- Modify: `server/package.json` 的构建步骤？**不改** —— 见下
- Test: `server/src/tests/webapp-sdk-injection.test.ts`

**Interfaces:**
- Consumes: `injectSdk(html, { sdkPath })`（T1 的桩）、`SDK_PATH`（T1）
- Produces:
  - 真正的 `injectSdk`：在 `</head>` 前插入 `<script src="/__classnode/sdk.js"></script>`
  - `readSdkSource(): string`（T1 里的占位实现换成读文件）
  - iframe 内可用的全局 `window.ClassNode`，含 `report(payload)` 与父页面发来的 `onPause`/`onResume`
  - **postMessage 消息形状**（T6 的父页面按它写接收端）：
    - 子 → 父：`{ source: 'classnode-sdk', type: 'ready' | 'event' | 'frame', payload: … }`
    - 父 → 子：`{ source: 'classnode-parent', type: 'pause' | 'resume' }`

**SDK 源码怎么送达浏览器**：**不要**放进 `src/public/`（那是学生端前端的地盘，会被 Next 静态导出处理）。放 `server/` 下的独立目录，由 T1 的 `/__classnode/sdk.js` 路由读文件返回。⚠️ **注意编译产物路径**：`tsc` 不会拷贝 `.js` 资源文件 ⇒ 读文件时要按 `__dirname` 往上找到 `server/public-sdk/`，**并且要在 `server/package.json` 的 build 脚本里加一条拷贝**，或者干脆**把 SDK 源码写成 `.ts` 里的模板字符串**。

**实施者请二选一并在报告里说明理由**。控制器倾向**后者**（模板字符串）：零构建步骤、零路径脆弱性、TS 编译时就能发现语法错。代价是 SDK 源码没有独立的语法高亮与 lint，且**不能有反引号**（要转义）——对一段 100 行左右的 ES5 脚本是可接受的。

- [ ] **Step 1: 注入函数（先写测试）**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectSdk, SDK_PATH } from '../services/webapp-sdk.js';

test('在 </head> 前注入', () => {
  const out = injectSdk('<html><head><title>t</title></head><body></body></html>', { sdkPath: SDK_PATH });
  assert.ok(out.includes(`<script src="${SDK_PATH}"></script>`));
  assert.ok(out.indexOf('sdk.js') < out.indexOf('</head>'));
});

test('大小写不敏感的 </HEAD> 也认', () => {
  const out = injectSdk('<html><HEAD></HEAD><body></body></html>', { sdkPath: SDK_PATH });
  assert.ok(out.includes('sdk.js'));
});

test('没有 head 时插到 <html> 之后', () => {
  const out = injectSdk('<html><body><h1>hi</h1></body></html>', { sdkPath: SDK_PATH });
  assert.ok(out.includes('sdk.js'));
  assert.ok(out.indexOf('sdk.js') < out.indexOf('<h1>'));
});

test('注入是幂等的 —— 已经有 SDK 就不重复插', () => {
  const once = injectSdk('<html><head></head><body></body></html>', { sdkPath: SDK_PATH });
  const twice = injectSdk(once, { sdkPath: SDK_PATH });
  assert.equal(twice, once);
  assert.equal(twice.split('sdk.js').length - 1, 1);
});

test('不是 HTML 时原样返回（不要损坏非 HTML 响应）', () => {
  const junk = '{"not":"html"}';
  assert.equal(injectSdk(junk, { sdkPath: SDK_PATH }), junk);
});

test('空字符串原样返回，不抛错', () => {
  assert.equal(injectSdk('', { sdkPath: SDK_PATH }), '');
});
```

- [ ] **Step 2: 实现注入**

```ts
export function injectSdk(html: string, opts: { sdkPath: string }): string {
  if (!html) return html;
  // 幂等：已经注入过就原样返回。教师自己也可能手写了一个 <script src="…/sdk.js">，
  // 重复注入会让 SDK 跑两遍、事件翻倍。
  if (html.includes(opts.sdkPath)) return html;

  const tag = `<script src="${opts.sdkPath}"></script>`;

  // 大小写不敏感地找 </head>。找不到就退到 <html ...> 之后，再找不到就整体前置 ——
  // 三种兜底都不改 HTML 的其余部分，最坏情况只是脚本早一点执行。
  const headClose = html.search(/<\/head\s*>/i);
  if (headClose !== -1) return html.slice(0, headClose) + tag + html.slice(headClose);

  const htmlOpen = html.search(/<html[^>]*>/i);
  if (htmlOpen !== -1) {
    const end = html.indexOf('>', htmlOpen) + 1;
    return html.slice(0, end) + tag + html.slice(end);
  }

  // 连 <html> 都没有（片段式 HTML）—— 只在看起来像 HTML 时才注入，
  // 避免把一个 JSON 响应改坏。
  if (!/<[a-z!]/i.test(html)) return html;
  return tag + html;
}
```

- [ ] **Step 3: SDK 本体 —— 隐私红线在这里落地**

**这是整个 P2 最需要审查的一段。** 红线（规格 §5.4 / §10.3 / `CLAUDE.md`）：

> 事件采集**默认不采集输入框内容**，仅记录「在某输入框输入、长度 N」。需采集具体内容必须由教师网页显式调用 `ClassNode.report()`。**此为面向未成年人的底线，不可放宽。**

**实现上的关键不是「记得别读 value」，而是让「读 value」无处可写** —— 上报载荷由**唯一一个**函数构造，它的形参类型里没有任何内容字段：

```js
/**
 * 构造一帧上报载荷。**SDK 内所有上报都必须经过这里。**
 *
 * ⚠️ 隐私红线（不可放宽）：这个函数**不接受任何自由文本参数**。
 * 输入类事件的载荷只有 { selector, inputType, length } —— `value` / `textContent` /
 * `innerText` 一律不读、不存、不传。
 *
 * 要采集具体内容，只能由教师网页**显式**调用 window.ClassNode.report(payload)，
 * 那是教师自己的选择与责任；SDK 绝不替他们采集。
 */
function buildEvent(kind, fields) {
  return {
    kind: kind,
    selector: fields.selector || '',
    inputType: fields.inputType || '',
    length: typeof fields.length === 'number' ? fields.length : 0,
    depth: typeof fields.depth === 'number' ? fields.depth : 0,
    to: fields.to || '',
    at: Date.now(),
  };
}
```

采集项（规格 §5.4 的四类）：

```js
// document 的 capture 阶段事件委托 —— 教师网页不需要改一行代码
document.addEventListener('click', function (e) {
  var el = e.target;
  if (!el || !el.tagName) return;
  post('event', buildEvent('click', {
    selector: describe(el),
    inputType: el.tagName.toLowerCase(),
  }));
}, true);

document.addEventListener('input', function (e) {
  var el = e.target;
  if (!el || !el.tagName) return;
  // ⚠️ 只取长度。**绝不读 el.value 的内容。**
  post('event', buildEvent('input', {
    selector: describe(el),
    inputType: (el.type || el.tagName).toLowerCase(),
    length: typeof el.value === 'string' ? el.value.length : 0,
  }));
}, true);

// 滚动深度：只在跨过新的十分位时上报，避免高频
var maxDepth = 0;
addEventListener('scroll', function () {
  var doc = document.documentElement;
  var total = doc.scrollHeight - doc.clientHeight;
  if (total <= 0) return;
  var decile = Math.floor((doc.scrollTop / total) * 10);
  if (decile <= maxDepth) return;
  maxDepth = decile;
  post('event', buildEvent('scroll', { depth: decile * 10 }));
}, { passive: true });

// 页面内跳转（hash 变化）
addEventListener('hashchange', function () {
  post('event', buildEvent('navigate', { to: location.hash }));
});

// 可见性变化（同时驱动截图暂停，见 T5 的降频）
document.addEventListener('visibilitychange', function () {
  post('event', buildEvent('visibility', { to: document.hidden ? 'hidden' : 'visible' }));
});
```

`describe(el)` 产出一个稳定但**不含文本内容**的选择器：

```js
/**
 * 给元素一个稳定的标识。**不读 textContent / value** —— 只用 tagName、id、class
 * 与「同标签兄弟中的序号」。文本内容属于学生输入与页面内容，不在采集范围内。
 */
function describe(el) {
  var tag = el.tagName.toLowerCase();
  if (el.id) return tag + '#' + el.id;
  var cls = (typeof el.className === 'string' ? el.className : '')
    .split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  var base = cls ? tag + '.' + cls : tag;
  var parent = el.parentNode;
  if (!parent || !parent.children) return base;
  var same = 0, idx = 0;
  for (var i = 0; i < parent.children.length; i++) {
    if (parent.children[i].tagName === el.tagName) {
      same++;
      if (parent.children[i] === el) idx = same;
    }
  }
  return base + ':nth-of-type(' + idx + ')';
}
```

其余能力：

- **握手**：`parent.postMessage({ source:'classnode-sdk', type:'ready' }, '*')`，父页面据此知道 iframe 已就绪。
- **挂起协议**：监听 `message`，`type === 'pause'` 时停掉截图循环与滚动上报；`'resume'` 时恢复并立即补一帧。
- **`ClassNode.report(payload)`**：教师显式上报的唯一入口。**原样透传**（这是教师自己的选择），但要**限长**（见下）。
- **截图**：**只做 `<canvas>` 直读**（Ruling 6）。找一个面积最大的 canvas，`toDataURL('image/jpeg', 0.4)`，缩到宽 320。没有 canvas 就不发 `frame` 消息。

**必须在 SDK 里做的三条硬防护**：

```js
// 1. 单条消息上限。教师网页可以 report 任意东西，一个 10MB 的 payload 会卡死老 iPad。
var MAX_PAYLOAD_BYTES = 32 * 1024;

// 2. 只接受来自父窗口的消息（防止被嵌入到别处时被第三方驱动）
addEventListener('message', function (e) {
  if (e.source !== parent) return;
  var d = e.data;
  if (!d || d.source !== 'classnode-parent') return;
  if (d.type === 'pause') paused = true;
  else if (d.type === 'resume') { paused = false; captureFrame(); }
});

// 3. 所有 postMessage 都带 source 标记，且用 '*' 目标源 —— 父页面在另一个源上，
//    无法预先知道它的 origin。安全性由父页面侧的 e.source 校验保证（见 T6）。
function post(type, payload) {
  if (paused && type !== 'ready') return;
  var msg = { source: 'classnode-sdk', type: type, payload: payload };
  var encoded;
  try { encoded = JSON.stringify(msg); } catch (err) { return; }  // 环形结构
  if (encoded.length > MAX_PAYLOAD_BYTES) return;
  parent.postMessage(msg, '*');
}
```

- [ ] **Step 4: 反证 —— 必须证明「读不到输入内容」**

**这一步不能跳过。** 在真实浏览器里验证，而不是读代码：

用一个带 `<input>` 的测试网页，输入 `秘密12345`，抓下所有 postMessage，**断言上报的 JSON 里不含 `秘密` 这两个字**：

```js
// 在父页面里收集
const frames = [];
window.addEventListener('message', (e) => frames.push(JSON.stringify(e.data)));
// …在 iframe 里输入「秘密12345」…
// 断言
const all = frames.join('');
if (all.includes('秘密')) throw new Error('隐私红线被突破：输入内容外泄');
if (!/\\"length\\":5/.test(all)) throw new Error('长度没有被采集 —— 采集逻辑可能整个没跑');
```

**第二条断言同样重要** —— 只断言「不含秘密」会放过大意「什么都没采集」的实现。

把这段做成一次性脚本（Playwright，`channel: 'chrome'`，已在 `/tmp/anim-test/node_modules/playwright`），**把原始输出贴进报告**。

- [ ] **Step 5: 门禁 + 提交**

```bash
npx tsc --noEmit && pnpm lint
cd server && pnpm test
git add server/src/services/webapp-sdk.ts server/src/tests/webapp-sdk-injection.test.ts
git commit -m "feat(webapp): 注入式 SDK（事件采集不含输入内容，截图仅 canvas）"
```

**报告里必须给出**：Step 4 那个反证脚本的**原始输出**（两条断言的结论），以及 SDK 是「模板字符串」还是「独立文件 + 拷贝步骤」的选择与理由。

---

## Task 5: 实时监控链路

**Files:**
- Modify: `server/src/socket/index.ts`（新事件 handler + 内存态 + 有界化）
- Modify: `src/lib/socket-events.ts`（新事件类型）
- Test: `server/src/tests/webapp-monitor.test.ts`

**Interfaces:**
- Consumes: T3 的 `Webapp` / `ClassroomWebapp` 表（**动手前先 `grep` schema 确认字段名**）
- Produces（**这些名字是 T6 与 T7 的契约，T5 定死，它们不得自行发明**）：
  - 学生 → 服务端：`webapp-event` `{ classroomId, webappId, events: WebappEvent[] }`
  - 学生 → 服务端：`webapp-frame` `{ classroomId, webappId, dataUrl: string }`
  - 服务端 → 教师：`webapp-student-event` `{ studentId, webappId, events }`
  - 服务端 → 教师：`webapp-student-frame` `{ studentId, webappId, dataUrl, at }`
  - 服务端 → 学生：`webapp-monitor-demand` `{ watching: boolean }`
  - 教师 → 服务端：`watch-webapp-monitor` `{ classroomId }` / `unwatch-webapp-monitor` `{ classroomId }`
  - `interface WebappEvent { kind: 'click'|'input'|'scroll'|'navigate'|'visibility'|'report'; selector: string; inputType: string; length: number; depth: number; to: string; at: number }`
  - 汇总：`recordWebappSummary(classroomId, entries)` —— 唯一落盘项

**内存模型**（Ruling 8 —— 照 `teacherNotificationCache` 与 `pruneSocketCaches` 的写法）：

```ts
/**
 * 每个学生每个网页的最新一帧 + 累计计数。**只存内存，不落盘**（规格 §5.5）。
 *
 * 有界化照同文件的 pruneSocketCaches（:38-55）：帧是「最新一帧覆盖」，所以一个学生
 * 一个网页恒为 1 条；事件是**累计计数**而不是流水账 —— 存流水账会让内存随课堂时长
 * 线性增长，而教师看板上要显示的本来就是「点了多少次、滚到多深」。
 */
interface WebappMonitorState {
  frames: Map<string, { dataUrl: string; at: number }>;   // key: `${studentId}:${webappId}`
  counters: Map<string, { clicks: number; inputs: number; maxDepth: number; reports: unknown[] }>;
  /** 订阅了本课堂探究助手视图的教师连接数（Ruling 9）。 */
  watchers: Map<string, Set<string>>;  // classroomId → Set<socketId>
}
```

- [ ] **Step 1: 写测试**

照 `classroom-module-state-route.test.ts` 的手法：手写假 io 收集 emit，断言事件名与载荷。

```ts
test('教师订阅前，学生上报不产生任何 emit（按需推流）', () => { … });

test('教师订阅后，学生事件被转发到 teacher:<id> 房间', () => { … });

test('教师订阅数归零后，学生收到 webapp-monitor-demand { watching:false }', () => { … });

test('帧只留最新一帧 —— 连发三帧后内存里仍只有 1 条', () => { … });

test('事件是累计计数而不是流水账 —— 内存不随事件数增长', () => { … });

test('教师刷新页面（0→1→0 的瞬时抖动）不会立刻通知学生停推', () => { … });
```

**最后一条对应 Ruling 9 的防抖**，是本任务最容易做错的地方。

- [ ] **Step 2: 按需推流（Ruling 9）**

```ts
/** 本课堂是否有教师在看探究助手视图。房间空时 adapter 会把房间删掉 ⇒ get() 返回 undefined。 */
function hasWatchers(io: Server, classroomId: string): boolean {
  return (io.sockets.adapter.rooms.get(`${TEACHER_ROOM_PREFIX}${classroomId}${WEBAPP_SUFFIX}`)?.size ?? 0) > 0;
}
```

⚠️ **不要用 `teacher:<id>` 房间本身** —— 教师只要打开课堂看板就进了那个房间，而「在看探究助手视图」是更窄的一件事。⇒ 另开一个房间 `teacher:<classroomId>:webapp`，只有 T7 的探究助手视图挂载时才 `join`。

**防抖**（Ruling 9 第 2 条）：watchers 归零后**延迟 15 秒**再通知学生停推，且这 15 秒内若又有人订阅则取消。用 `setTimeout` + 在订阅时 `clearTimeout`，写成一个小的 `scheduleDemandNotification(classroomId)`。

- [ ] **Step 3: 事件与帧的转发**

```ts
socket.on('webapp-event', (data) => { … });  // 校验归属（照 join-classroom 的 verifyStudentToken + findFirst 两步）
socket.on('webapp-frame', (data) => { … });  // 同上；覆盖 frames 里的那一条
```

**校验必须做**（照 `socket/index.ts:328-341` 的两步式）：`verifyStudentToken` 比对 `classroomId`/`studentId`，再 `classroomStudent.findFirst` 复查归属。⚠️ **还要校验这个课堂真的关联了这个 `webappId`** —— 否则学生可以上报任意 webappId 污染别的网页的统计。

- [ ] **Step 4: 降频（截图耗时超 300ms → 5s/10s/20s 三档）**

降频**在 SDK 侧执行**（测耗时的是它），服务端只下发当前档位。⇒ 父页面（T6）把服务端算出的档位随 `onResume`/定期的 `webapp-monitor-demand` 一起转给 iframe。

⚠️ **`document.hidden` 时完全停发**：SDK 自己判（Step 3 的 `visibilitychange` 已经在上报），不依赖服务端。

- [ ] **Step 5: 唯一落盘项 —— 课堂结束的汇总**

在课堂结束（`canTransition` 到 `ended` 的那条路径）时写一条汇总：谁、用了哪个网页、时长、交互次数。

**时长怎么算**：`webapp-event` 的 `visibility` 变化能推出在前台的时长，但更省事也够准的是「首帧时间 → 末帧时间」。**实施者选一种并在报告里说明**；不要两种都算。

**内存释放**：写汇总的同一处清空该课堂的三个 Map（规格 §5.5「课堂结束释放」）。

- [ ] **Step 6: 门禁 + 提交**

```bash
npx tsc --noEmit
cd server && pnpm test      # 新增 6 项全过
git add server/src/socket/index.ts src/lib/socket-events.ts server/src/tests/webapp-monitor.test.ts
git commit -m "feat(webapp): 实时监控链路（按需推流、计数式内存、唯一落盘汇总）"
```

---

## Task 6: 学生端「探究助手」面板

**Files:**
- Create: `src/app/classroom/explore/explore-panel.tsx`
- Create: `src/app/classroom/explore/explore.module.css`
- Create: `src/app/classroom/explore/use-explore-bridge.ts`（postMessage 桥）
- Modify: `src/app/classroom/shell/classroom-shell.tsx:522-523`（三路分发）
- Modify: `src/app/classroom/shell/module-placeholder.tsx`（收窄到只剩学习单）
- Modify: `src/app/classroom/classroom-types.ts`（`ClassroomInfo` 加 `webappOrigin` + 关联网页列表）
- Modify: `src/lib/api.ts` 的 `ClassroomInfo` 对应类型

**Interfaces:**
- Consumes: `ModulePanelProps`（`classroom-types.ts:106-117`，**不改契约** —— Ruling 10）、T5 的 postMessage 消息形状与 socket 事件名、`GET /code/:code` 的 `webappOrigin`（T1）
- Produces: 学生端的真实探究助手面板

**已核实的现场事实（实施者可直接用，但**仍须自己 `grep` 复核**）**：

- `classroom-shell.tsx:522` `mountedIds.map(...)`、`:523` 按 `id === 'companion'` 二分。**要改成三路**。⚠️ 动手前先读那一段的实际形态 —— 它可能已经被 T0~T5 之外的改动挪过位置。
- `use-module-tabs.ts:70-77` 的 `openModule` 只在 `state === 'open'` 时挂载，`mountedIds` **只增不减**，`:102-107` 的 effect 会在教师改态时把 `activeModuleId` 送回首页。
- `active` 的定义在 `classroom-shell.tsx:207`：`phase.front === key && phase.settled`。**这两个条件的合取意味着 `active` 在切换动画的中途是 `false`** —— 这正是要用来驱动挂起协议的边沿。
- `shell.module.css` 用 `visibility: hidden` 隐藏非前台层。⚠️ **`visibility: hidden` 不会让 iframe 停止运行** —— 浏览器节流只是兜底，所以必须走 postMessage 挂起协议（`classroom-types.ts:78-79` 的注释就是为这件事写的）。
- `module-placeholder.tsx` 的 `ModulePlaceholderProps` 把 `moduleId` 收窄为 `Exclude<ModuleId,'companion'>`（`:22-24`）。⇒ **`explore` 分出去之后，这个收窄要跟着变成 `Exclude<ModuleId,'companion'|'explore'>`**，否则占位面板仍然声称自己能渲染探究助手。

- [ ] **Step 1: iframe 面板**

```tsx
export function ExplorePanel({ active, state, classroom, session }: ModulePanelProps) {
  // 三态在 T3 已经在服务端与本面板之上处理过（外壳的 openModule 闸门），这里只需要
  // 处理「教师没关联任何网页」这个 P2 特有的空态。
  const webapp = classroom?.webapps?.[0] ?? null;
  const origin = classroom?.webappOrigin ?? null;

  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  const src = webapp && origin ? `${origin}/webapps/${webapp.id}/${webapp.entryPath}` : null;

  // ⚠️ 挂起协议由 `active` 的**边沿**驱动，而不是「active 为假时卸载 iframe」。
  //    卸载即丢状态（§4.5 的核心承诺），这与 use-module-tabs「一旦挂载永不卸载」同一条口径。
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(
      { source: 'classnode-parent', type: active ? 'resume' : 'pause' },
      '*',   // 目标源是独立源，父页面无法预先知道…，安全性由子页面侧的 e.source 校验保证
    );
  }, [active]);

  // 加载超时 —— §12 的第一条：不能让白屏把学生卡住
  useEffect(() => {
    if (!src || status !== 'loading') return;
    const timer = window.setTimeout(() => setStatus('failed'), 15000);
    return () => window.clearTimeout(timer);
  }, [src, status, reloadKey]);
  …
}
```

`sandbox` 属性（Ruling 13，照抄不要改）：

```tsx
<iframe
  ref={frameRef}
  key={reloadKey}
  src={src}
  title={webapp?.name || '探究助手'}
  sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-downloads"
  referrerPolicy="no-referrer"
  onLoad={() => setStatus('ready')}
  onError={() => setStatus('failed')}
/>
```

⚠️ **`allow` 属性不要加** —— 不申请任何权限（摄像头/麦克风等），与主服务 `Permissions-Policy` 的收紧方向一致。

- [ ] **Step 2: postMessage 桥（`use-explore-bridge.ts`）**

```ts
/**
 * iframe 与父页面之间的 postMessage 桥。
 *
 * ⚠️ **必须校验 `e.source`** —— 消息用 '*' 发给独立源，任何页面都能给本窗口发消息。
 *    仅凭 `e.data.source === 'classnode-sdk'` 是不够的（那是可伪造的字符串）。
 *    唯一可信的判据是「这条消息来自我们刚挂载的那个 iframe 的 contentWindow」。
 */
export function useExploreBridge(opts: {
  frameRef: RefObject<HTMLIFrameElement | null>;
  onEvents: (events: WebappEvent[]) => void;
  onFrame: (dataUrl: string) => void;
  onReady: () => void;
}) { … }
```

⚠️ **`/classroom/` 可达代码里不得有 regex lookbehind**（构建期检查会 fail，T0 之后覆盖面更宽）。

- [ ] **Step 3: 事件与帧上报**

经**已有的 socket 连接**发。**这条连接的取用路径已经查清，实施者直接照做**：

- socket 在 `chat/use-chat-socket.ts:302` 建立，存进 `wsRef.current`（**`wsRef` 是外部传进去的**，见同文件 `:19`）。
- `wsRef` 由 `src/app/classroom/page.tsx:46` 创建。
- 它**已经在传给外壳的 `chat` 对象里**（`page.tsx:152`）。⇒ 外壳手里就有 `chat.wsRef`，把它按 `ModulePanelProps` 之外的方式传给探究助手面板即可。

⚠️ **不要新建第二条 socket 连接** —— 那会让学生端多一条常驻连接，违背 §4.8 的内存门槛，服务端还要处理重复连接。

⚠️ **不要改 `ModulePanelProps` 契约**（Ruling 10）。`wsRef` 是**探究助手面板自己的 props**（面板的 props 多于契约的下限，这正是契约 `classroom-types.ts:82-83` 明说允许的）。照学伴面板的做法：`ExplorePanelProps extends ModulePanelProps` 再加 `wsRef`。

- [ ] **Step 4: 三路分发 + 占位面板收窄**

`classroom-shell.tsx:522-523` 改成三路（学伴 / 探究助手 / 占位），`module-placeholder.tsx` 的收窄类型跟着改。

- [ ] **Step 5: 真机验证（**不能只看代码**）**

这是 P2 里唯一直接验证 P0 容器设计的地方（规格 §2：P2 的意义是「用小的验证大的」）：

1. 切走再切回探究助手，**网页内容必须还在**（滚动位置、输入框里的草稿）
2. 切走时 iframe **确实收到 `pause`**（在 SDK 里 `console.log` 验证）
3. **切回时键盘不弹、布局不跳** —— 这条与 P0 未做的那 15 分钟验收是同一条
4. 教师把探究助手改成 `preview`/`hidden` → 学生被送回首页，**网页内容仍在**，改回 `open` 后原样恢复

- [ ] **Step 6: 门禁 + 提交**

```bash
npx tsc --noEmit && pnpm lint
./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status
git add src/app/classroom/explore/ src/app/classroom/shell/ src/app/classroom/classroom-types.ts src/lib/api.ts
git commit -m "feat(classroom): 探究助手面板换成真 iframe（沙箱 + 挂起协议）"
```

---

## Task 7: 教师端管理页 + 看板

**Files:**
- Create: `src/app/teacher/webapps/page.tsx` + 拆分组件
- Modify: `src/app/teacher/layout.tsx:11-21`（导航）+ `:477+`（**图标 switch，两处必须同时改**）
- Modify: `src/app/teacher/classroom/new/page.tsx`（勾选探究网页）
- Modify: `src/app/teacher/classroom/page.tsx`（探究助手视图）
- Modify: `src/lib/api.ts`

**Interfaces:**
- Consumes: T3 的 REST、T5 的事件名与房间名、T1 的 `/api/server-info` 的 `webappOrigin`
- Produces: 教师端全链路

**已核实的可复用件（实施者仍须自己 `grep` 复核）**：

| 要做的 | 抄哪个 |
|---|---|
| 卡片网格 + 空态 + 分页 | `src/app/teacher/agents/page.tsx:116-151` |
| 卡片布局与三按钮 | `agents/agent-card.tsx:63-79` |
| **使用量守卫**（删除前拦截） | `agents/use-agent-controller.ts:75-79` |
| 「无法删除」弹窗 | `agents/agent-overlays.tsx`（几乎通用，改文案） |
| 弹窗骨架 | `agents/page.tsx:193-194` 的 `modal-overlay`/`modal-content` |
| 表单校验 + FormData 提交 + 严格模式处理 | `agents/use-agent-form-actions.ts:28-34` |
| 视图切换 | `src/lib/components.tsx:25-48` 的 `TeacherPageTabs<T>`（**仍是唯一符合仓内习惯的选择**） |
| 详情抽屉 | `teacher/classroom/page.tsx:1295-1311`（fixed + 遮罩；⚠️ 没有 `role="dialog"`） |
| 勾选块的形态 | `teacher/classroom/new/page.tsx:453-513`（chip 药丸 + `aria-pressed`） |

- [ ] **Step 1: 管理页**

`/teacher/webapps/`：卡片网格 + 表单弹窗 + **在线预览**（`<iframe src={`${webappOrigin}/webapps/${id}/${entry}`}>`，⚠️ **教师端预览也要带同一套 sandbox** —— 不要因为「是教师自己传的」就裸挂，那等于给教师浏览器一个任意页面执行面）+ 使用量守卫。

- [ ] **Step 2: 导航（两处一起改）**

`layout.tsx:11-21` 加一项 `{ path: '/teacher/webapps', label: '探究网页', icon: 'globe' }`，**并且**在 `:477-556` 的图标 switch 里加对应分支。⚠️ **漏了第二处不会报错** —— 只是那一项渲染成无图标的空位。这是本任务最容易漏的一步。

- [ ] **Step 3: 新建课堂勾选网页**

照 `new/page.tsx:453-513` 改：多选 `Set<string>`（网页可以关联多个，智能体是单选）、`payload` 加 `webappIds`。

⚠️ **三处连带**（都在同一文件里，容易漏）：
1. `steps` 数组（`:151-160`）是**硬编码 3 项**的进度条 ⇒ 要么加第 4 步，要么把网页勾选并入「AI 配置」那一步。**控制器裁定：并入「AI 配置」那一步**（改标题为「AI 与网页」），不加第 4 步 —— 进度条加一格会让一个次要配置看起来与「选哪个班」同等重要。
2. 错误聚焦的 `agentSectionRef`（`:32`）要有一个兄弟 ref，且 `:107-111` 的滚动聚焦分支要补一支。
3. `api.createClassroom` 的签名（`src/lib/api.ts:133-134`）与 `createAdvancedClassroom`（`:135`）**都要加 `webappIds`** —— 高级模式也有这条路径。

- [ ] **Step 4: 探究助手视图**

在 `teacher/classroom/page.tsx` 里用 `TeacherPageTabs` 加视图，或用 `gridFullscreen` 同款的全屏切换。**控制器裁定：用 `TeacherPageTabs`** —— 它是仓内既有的视图切换件（`shield`/`classes`/`avatars` 三处在用），而 `gridFullscreen` 是布尔而不是视图。

⚠️ **header 区（`:818-1040`）是横向 flex**，加一条 Tabs 会挤压标题行。**控制器裁定：Tabs 放在 header 区之下、图墙之上的独立一行**（不塞进那条 flex），并沿用 `gridFullscreen` 已有的做法 —— 它在全屏时会藏掉整个 header（`:818`），Tabs 与它同进退。理由：塞进 flex 会让标题行在窄屏（教师也用 iPad 看板）被压成多行，而独立一行只多占 40px 且始终可用。

**若判断有误的代价**：看板纵向空间少 40px（图墙是 `auto-fill minmax(250px,1fr)`，少一行不影响每行格数）。

图墙：按学生一格，格子显示最新缩略图 + 交互计数；点开进抽屉看详情（事件流）。挂载时 `emit('watch-webapp-monitor', { classroomId })` 且 `join` 房间 `teacher:<id>:webapp`，卸载时反过来。⚠️ **`unwatch` 不能省** —— 少了它，教师离开视图后学生端永远不停止推流（Ruling 9 的按需推流就白做了）。

- [ ] **Step 5: 门禁 + 提交**

```bash
npx tsc --noEmit && pnpm lint
./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status
git add src/app/teacher/ src/lib/api.ts
git commit -m "feat(teacher): 探究网页管理页与实时看板视图"
```

---

## Task 8: 验收清单（**控制器自己写，不派发**）

照 `.superpowers/sdd/2026-09-20-m1b3-topbar-actions/acceptance.html` 的格式，产出
`.superpowers/sdd/2026-09-20-p2-explore-assistant/acceptance.html`。

七个阶段：

**A. 上传（教师端）**
- [ ] ZIP 包能传（含**多层根目录**的那种 —— 教师压缩时选了文件夹）
- [ ] 多选文件能传，首个 `.html` 作入口
- [ ] `.php` 被拒绝，且文案说「只托管静态网页」而不是「扩展名不支持」
- [ ] 超限（文件数 / 单文件 / 总量）各自被拒绝，文案里的数字与 `WEBAPP_LIMITS` 一致
- [ ] 外链网页上传后有提醒（**不阻断**）
- [ ] 删除被课堂引用的网页 → 被拦下

**B. 学生端**
- [ ] 打开探究助手，网页真的加载出来
- [ ] **在网页里输入一段内容，教师看板上看不到输入内容**（只看得到「输入了 N 个字符」）★ 红线
- [ ] 切走再切回，**网页内容原样还在**
- [ ] 教师改成 `preview` → 学生回首页；改回 `open` → 内容仍在
- [ ] `/classroom/` 的控制台**零报错**（老 iPad 上白屏的先兆）

**C. 教师看板**
- [ ] 挂载视图后，学生端的操作**真的实时出现**
- [ ] **关掉看板视图，学生端停止上报**（在 SDK 里验证 `pause` 已收到）
- [ ] 教师刷新页面不会让学生端闪断（Ruling 9 的防抖）
- [ ] canvas 型网页有缩略图；**纯 DOM 型是空缩略图**（Ruling 6 的已知代价，如实记）

**D. 老 iPad 真机（**合并 P0 的三条**）**
- [ ] 首屏 ≤3s / 模块切换 ≤300ms / 三模块全挂载 ≤150MB（**最后一个只能当下界读**）
- [ ] iPad 竖直 768px 顶栏姓名看得见
- [ ] 切回学伴时键盘不弹
- [ ] iframe 里的网页在 Safari 15 上能跑（**教师的网页可能用了新语法，这不是我们的 bug，但要能分清**）

**E. 回归（P0 的成果别被打坏）**
- [ ] 学伴对话、换头像、消息下拉、切换用户、退出课堂全部照旧
- [ ] 三态（开放/预告/隐藏）对三个模块都成立
- [ ] 教师看板原有功能不受新视图影响

**F. 安全**
- [ ] `curl -sI http://<host>:4002/webapps/x/` **无 `X-Frame-Options`**
- [ ] `curl -sI http://<host>:4002/api/health` → **404**
- [ ] 学生 token 打 `GET /api/webapps` → **被拒**
- [ ] `CLASSNODE_WEBAPP_PORT` 设成与服务端口相同时 → **拒绝启动该服务并打印明确错误**
- [ ] **反证**：在 iframe 里跑 `top.location.href = 'https://example.com'` → **被 sandbox 拦下**
- [ ] **反证**：在 iframe 里跑 `alert('x')` → **被 sandbox 拦下**

**G. 兼容**
- [ ] `pnpm build` 通过（T0 的闸门）
- [ ] T0 的三条反证仍然全红

---

## 任务分解对照（与交接文件 `specs/2026-09-20-p2-kickoff.md` 的差异）

| 本计划 | 交接文件 | 差异 |
|---|---|---|
| **T0** 构建期兼容检查扩容 | （无） | **新增**。规格 §11.1 点名它是「性价比最高的一项」，交接文件的任务分解漏了 |
| T1 第三端口 + 托管服务 | T1 | 补充：Tauri 侧四处改动、`webappOrigin` 的两条下发路径 |
| **T2** 外部依赖自检 | T3 | **提前到 T3 上传之前** —— 上传路由要 import 它，前向依赖在 SDD 里是禁忌 |
| **T3** 上传与存储 | T2 | 顺延一位 |
| T4 SDK + 注入 | T4 | 补充：隐私红线靠**类型**落地、SDK 源码的两种放法、反证脚本 |
| T5 实时监控 | T5 | 补充：房间是**新开的** `teacher:<id>:webapp` 而不是 `teacher:<id>` |
| T6 学生端面板 | T6 | 补充：`active` 的边沿语义、`module-placeholder` 的收窄类型要跟着改 |
| T7 教师端 | T7 | 补充：导航**两处**、`steps` 进度条、高级模式那条路径 |
| T8 验收清单 | T8 | 补充：**合并了 P0 未做的真机三条**（D 段） |

---

## 悬而未决、留给用户的事

1. **Ruling 6（可否决）**：P2 只做 canvas 截图，纯 DOM 网页在教师图墙上是空缩略图。若要补齐截图库，是**独立一项**（它要解决打包体积与老 iPad 性能）。
2. **P0 的真机验收仍未做**。本计划的 T8/D 段把它合并进来了，但 T6 的 Step 5 会**先**撞上同一套机制 —— 那时验一次比最后一起验更省。
3. **M1b-2 / M1b-3 / P2 三个里程碑将连成一条链**，最后一次性合并（Ruling：与既有惯例一致）。
