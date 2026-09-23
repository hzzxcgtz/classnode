# 改名报告：探究助手 → 探究空间

**分支**：`fix/webapp-material-authority`
**提交**：`facf7f6 refactor(naming): 三件套第二件定名「探究空间」（原「探究助手」）`
**状态**：DONE_WITH_CONCERNS（两点见文末「Concerns」，都不是我改坏的，是需要用户/控制器裁定的事）

---

## 一、我自己 grep 出来的枚举结果（不照抄 brief）

改前全仓 `grep -rn 探究助手`（排除 `node_modules/.git/.next/dist/out`）：

```
244 行，分布在 51 个文件 + dev.sh + .superpowers/ 4 个文件
```

**改前的逐目录行数**（我自己数的，与 brief 给的数字不同 —— brief 那张表是文件数不是行数）：

| 目录 | 行数 | 处置 |
|---|---|---|
| `src/`（app + lib） | 90 | 改 |
| `server/src/`（含 tests） | 34 | 改 |
| `specs/` | 70 | 改（§3 那段单独改写，见下） |
| `server/vendor/README.md` | 2 | 改（**是我们自己的文档**，见 §三） |
| `server/prisma/schema.prisma` | 7 | 改（注释） |
| `src-tauri/src/lib.rs` | 3 | 改（注释 + stderr 文案） |
| `.gitignore` | 1 | 改（注释） |
| `design/student-home-cartoon-v*` | 9 | 改（但未纳入提交，见 §五） |
| `specs/2026-09-23-p1-worksheet.md`（未跟踪） | 5 | 改（未纳入提交） |
| **`dev.sh`** | **9** | **不改 —— Global Constraint 8 明令「不碰 dev.sh」（见 Concerns）** |
| **`.superpowers/`**（4 个文件） | **9** | **不改 —— 任务工作区 / 历史记录（见 §五）** |

### 分类判据

**改（用户看得见的文字 / 注释 / 日志 / 文档）**
- 学生端 UI：`src/app/classroom/module-meta.tsx` 的 `label: '探究空间'`（三处 UI 的唯一出处：首页卡片、Tab 栏、占位面板都读它）；`explore-panel.tsx` 的 iframe `title` 兜底值 `'探究空间'`
- 教师端 UI：`src/app/teacher/classroom/page.tsx` 的 `MODULE_LABELS.explorer`、看板「探究空间：N 人已有画面」、看板菜单 aria-label 与标题「探究空间画面」；`teacher/classroom/new/page.tsx`「学生在「探究空间」里会打开这个网页」；`teacher/webapps/page.tsx` 两处 description
- 运行期文案：`server/src/socket/index.ts` 的 `'无权订阅探究空间监控'`；`server/src/services/webapp-host.ts` 的端口冲突报错与三条启动日志
- 设备端日志前缀：`[探究助手] 丢弃一帧` / `[探究助手] SDK 诊断` → `[探究空间]`（**两端一起改**，`server/vendor/README.md` 里记录这个前缀的那张表同步改了 —— 见下）
- 注释与文档：全部源码注释、`specs/*.md`、`design/*`

**不改（标识符 / 持久化值 / 文件名 / 线缆契约）**
- `'explorer'`（`ClassroomModule.moduleKey`）、`ModuleId = 'explore'`、`MODULE_KEY_BY_ID.explore`、`ClassroomModuleKey`
- 事件名 `webapp-frame` / `webapp-diag` / `webapp-capture-*`（`webapp-presence` 全仓本就不存在，0 处）
- 路由 `/teacher/webapps/`、`/api/webapps`、模型 `Webapp` / 表 `ClassroomWebapp`
- 文件名 `src/app/classroom/explore/`、`explore-panel.tsx`、`use-explore-bridge.ts`、`/public/images/module-icons/explore.svg`

### ⚠️「探究网页」没有被误改（专门复核）

改名后 `探究网页` 仍在原处（`webapps/page.tsx` 的 `title="探究网页"`、概览 `aria-label="探究网页概览"`、`new/page.tsx` 的「关联探究网页」）。被改的只有**指模块**的那半句，例如
`学生会在探究助手里打开它` → `学生会在探究空间里打开它`。
`specs/2026-09-19-...md` §3 新增的最后一条专门写明这两个概念不同，防止后人再混。

### `server/vendor/` 那 2 处：**是我们自己的补丁文档，已改**

核对过：`server/vendor/` 只有三个文件 —— `snapdom.js`（第三方，**0 处**中文命中）、`snapdom.LICENSE`、`README.md`。
`README.md` 是我们为**自己打的 5 处 `img.decode()` 补丁**写的说明文档（测试 `🔴 本地补丁：补丁后的 sha256 与 README 记的一致` 就绑在它上面）。命中的 2 处（第 35、78 行）都是本文行文，属于「我们的文字」⇒ 改了。
**未触碰**该文件里的 sha256、版本号等一切被测试断言的字段 —— 改后 `pnpm test` 仍 308/308 全过，就是这个的证明。

---

## 二、设计文档 §3：改写成「记录反转」，不是删除

`specs/2026-09-19-classnode-learning-suite-design.md` §3 的第 98 行原是一段论证「为什么选『探究助手』而不是『探究空间』」。
**没有**简单替换（那会变成一句自相矛盾的话），而是整段改写成 4 条：

1. **09-19 的原始论证（已作废）** —— 完整保留当时的理由（「助手/学伴」撞车、但口头更顺）
2. **2026-09-23 用户最终定名：学习单 · 探究空间 · 智能学伴**（推翻上述权衡）
3. **影响面** —— 写明标识符与持久化值为何不跟着改，并点名 `'explorer'` / `ModuleId` / `MODULE_KEY_BY_ID` / `/teacher/webapps/` / `webapp-frame`
4. **⚠️「探究网页」是另一个概念，不随之改名**

第 38 行 `新增（原名「实验助手」，见 §3）` 里的历史旧名 `实验助手` **保留**（那是决策痕迹）。

---

## 三、改动统计

```
facf7f6  43 files changed, 217 insertions(+), 212 deletions(-)
```
217/212 的差额来自 §3 那段（1 行 → 6 行）。
另有 **8 个未跟踪文件也被改了文字、但未纳入本次提交**（见 §五）。

---

## 四、验收证据

### 4.1 改动后全仓 grep「探究助手」的**完整输出**（原样贴）

> 读法：本报告自己引用了这份输出，所以它也出现在结果里。**排除本报告自身后，全仓只剩 19 行**（下面贴的就是这 19 行）。
> 含本报告的全仓总数会随本报告自身的引用行数漂移（写这段时是 50 行），别拿它当基准 —— **以「排除本报告 = 19 行」为准**。

```
.superpowers/board-ui-fixes-brief.md:6:⚠️ **本任务开始前先读一遍当前代码** —— 上面刚有一次全仓改名（探究助手 → **探究空间**），
.superpowers/hotfix-webapp-authority-brief.md:1:# 热修：高级模式下学生帧被全数拒绝（探究助手快照不显示）
.superpowers/hotfix-webapp-authority-report.md:1:# 热修报告：高级模式下学生帧被全数拒绝（探究助手快照不显示）
.superpowers/rename-explore-space-brief.md:1:# 改名：探究助手 → **探究空间**
.superpowers/rename-explore-space-brief.md:10:把三件套里的第二件从「探究助手」改成「**探究空间**」，**全面**改。
.superpowers/rename-explore-space-brief.md:13:**背景**：09-19 设计文档 §3 原本专门论证过「为什么选『探究助手』而不是『探究空间』」
.superpowers/rename-explore-space-brief.md:14:（理由是「教师口头表述『打开探究助手』更顺」）。**用户现在推翻了这个决定**。
.superpowers/rename-explore-space-brief.md:66:1. **改完之后，全仓再 grep 一次「探究助手」**，只应剩下：
.superpowers/rename-explore-space-brief.md:70:2. 全仓 grep「探究空间」的数量，与「探究助手」改前的数量对照。
dev.sh:11:# 探究助手托管服务的端口。必须与服务端口不同源，否则 sandbox 的 allow-same-origin
dev.sh:150:  # 探究助手与 server 同进程，start_service 只按它自己那个 port 检查，所以这里补一条。
dev.sh:152:  # 「服务起来了、主功能正常、只有探究助手加载不出来、status 也不提示」——
dev.sh:159:  printf '  托管: %shttp://localhost:%s%s  （探究助手）\n' "$CYAN" "$WEBAPP_PORT" "$NC"
dev.sh:167:  # 前台模式下端口被占会表现为「服务起来了但探究助手加载不出来」，而不是明确的启动失败。
dev.sh:191:    # 探究助手与 server **同进程**，所以只附加在 server 那行，不新增第三个 service 项 ——
dev.sh:193:    [[ "$service" == server ]] && note="（探究助手 ${WEBAPP_PORT}）" || note=""
dev.sh:296:  start                 后台启动开发环境（前端 ${CLIENT_PORT} / 后端 ${SERVER_PORT} / 探究助手 ${WEBAPP_PORT}）—— 默认命令
dev.sh:322:  CLASSNODE_WEBAPP_PORT 覆盖。探究助手托管端口必须与后端端口不同（同源会让
specs/2026-09-19-classnode-learning-suite-design.md:100:- **09-19 的原始论证（已作废）**：三件套并列时「探究**助手**」与「智能学**伴**」在中文里都指"帮你的角色"，区分度低于备选「探究空间」；但教师口头表述「打开探究助手」更顺，故当时采用了「探究助手」。
```

逐来源计数（改后，含本报告的自引用）：

```
   9 dev.sh                                   ← Global Constraint 8：不碰 dev.sh
   9 .superpowers/（4 个文件）                 ← 任务工作区 / 历史记录，未纳入版本库
   1 specs/2026-09-19-...md:100               ← 第一节第 1 条「记录这次改名历史」的那句，应当保留
  31 .superpowers/rename-explore-space-report.md ← 本报告自己（自引用），不计
```

**⇒ 排除本报告：19 行。其中代码 0 行、`dev.sh` 9 行、任务工作区 9 行、设计文档的改名历史 1 行。**

**逐行归因**：`dev.sh` 9 行（其中 `:159`、`:193`、`:296` 是**用户/开发者可见的 status 与 help 输出**，不只是注释）；`.superpowers/` 9 行；设计文档 1 行是**故意留的历史引用**。**代码里 0 处。**

### 4.2「探究空间」数量对照

| | 改前 | 改后 |
|---|---|---|
| `探究助手`（行） | 244 | **19** |
| `探究空间`（行） | 7 | **243** |

改后 243 = 226（改名而来）+ 6（原本就有，其中 5 处在 `.superpowers/`）+ §3 改写新增的若干处。

### 4.3 `npx tsc --noEmit`

```
$ npx tsc --noEmit
TSC_EXIT=0
```
**改前改后都是 0**，无输出。

### 4.4 `cd server && pnpm test`

```
改前基线： ℹ tests 308   ℹ pass 308   ℹ fail 0
改后：     ℹ tests 308   ℹ pass 308   ℹ fail 0
```
**数字完全一致，未新增也未减少。** 未做 `rm -rf server/dist` —— 基线本来就是全绿，且切分支后 `pnpm test` 自己会先 `pnpm build`（tsc 全量重编），所以 `dist/` 不是陈旧产物。

值得单独点名的三条测试（都在守我这次动过的东西）：
- `🔴 本地补丁：补丁后的 sha256 与 README 记的一致` —— 证明我改 `server/vendor/README.md` 没碰被断言的内容
- SDK 语法/书写约束（`new Function(SDK_SOURCE)`）—— 证明我改 `SDK_SOURCE` 里那句 `ClassNode 探究空间 SDK` 注释没破坏模板串三条约束
- `webapp-sdk-injection` 那条用 `探究助手` 当任意正文的用例 —— 证明它不是断言、只是素材

### 4.5 eslint（限定范围）

```
$ npx eslint src/app/classroom/ src/lib/ src/app/teacher/
  112:50  warning  'tokenData' is assigned a value but never used
✖ 1 problem (0 errors, 1 warning)
```
**与改前完全相同的 1 条既存 warning**，且它在 `src/app/classroom/identity/use-student-session.ts` —— **不在本次改动文件之列**。未新增。

### 4.6 标识符一个都没动的**证明**（不是「我认为」）

`git grep` 逐模式统计 HEAD~1 vs HEAD 的命中行数：

| 模式 | HEAD~1 | HEAD | HEAD 去掉设计文档后 |
|---|---|---|---|
| `'explorer'` | 34 | 35 | **32 = 32** ✅ |
| `webapp-frame` | 59 | 60 | **59 = 59** ✅ |
| `/teacher/webapps/` | 7 | 8 | **6 = 6** ✅ |
| `MODULE_KEY_BY_ID` | 14 | 15 | **13 = 13** ✅ |
| `moduleKey` | 145 | 146 | **142 = 142** ✅ |
| `ClassroomWebapp` | 122 | 122 | ✅ |
| `webapp-diag` / `webapp-capture` | 20 / 13 | 20 / 13 | ✅ |

每一个 +1 都只来自 §3 新增的**那一行**（那行同时含 `'explorer'`、`moduleKey`、`MODULE_KEY_BY_ID`、`/teacher/webapps/`、`webapp-frame`）。**代码里这些标识符的命中数逐字未变。**

另有 `git diff --cached -U0 | grep '^[+-]' | grep -v 探究` 只剩 **1 行**（§3 段落里那个空行），即：**本次提交的每一处改动都与「探究」二字有关**，没有夹带任何其他改动。

---

## 五、Files changed

**提交内（43 个，全部 tracked）**

- `src/`（18）：`app/classroom/{module-meta.tsx, classroom-types.ts, use-classroom-session.ts, explore/{explore-panel.tsx, use-explore-bridge.ts, explore.module.css}, home/{student-home.tsx, home.module.css}, shell/{classroom-shell.tsx, module-placeholder.tsx, shell.module.css}, chat/use-chat-socket.ts}`、`app/teacher/classroom/{page.tsx, explore-tiles.tsx, use-webapp-monitor.ts, new/page.tsx}`、`app/teacher/webapps/page.tsx`、`lib/{api.ts, classroom-modules.ts, socket-events.ts, types.ts}`
- `server/`（11）：`src/index.ts`、`src/routes/classroom.ts`、`src/socket/index.ts`、`src/services/{webapp-host.ts, webapp-sdk.ts, webapp-capture.ts, group-material-resolve.ts}`、`src/tests/{webapp-monitor, webapp-sdk-injection, student-join-flow, group-participant-flow}.test.ts`、`vendor/README.md`
- `server/prisma/schema.prisma`（仅 `///` 注释；⚠️ 见 Concerns ②）
- `src-tauri/src/lib.rs`、`.gitignore`
- `specs/`（7 个 tracked）

**改了文字但未纳入提交（8 个，全部 untracked）**：
`design/student-home-cartoon-v{2,3,4,5,6}/`（7 个 md/html）+ `specs/2026-09-23-p1-worksheet.md`。
理由：`design/` 整个目录（41 个文件 / 17MB PNG）与 `specs/2026-09-23-p1-worksheet.md` 在本次任务开始前就**未被 git 跟踪**，是别的工作的产物。一个「改名」提交不该顺手把 17MB 素材和别人的新文档加进版本库。**文字已改（所以全仓 grep 是干净的），但要不要入库请用户/控制器定。**

---

## 六、Self-review findings

1. 我**没有**用 `git add -A`：`specs/2026-09-19-...md` 与 `specs/2026-09-22-p2-group-materials.md` 在我动手**之前**就带着上一轮会话的未提交改动（那两个文件的 `?? ` 之外的 `M`）。为了不把别人的在途改动卷进改名提交，我对这两个文件做了「取 HEAD → 只重放改名 + §3 改写 → 提交 → 再把原内容放回工作区」。**验证**：`git diff --cached | grep -c '部分章节已被取代\|实体化'` = **0**（那两个前置改动块一行都没进提交）；恢复后 `git status` 又只剩最初那 2 个 `M`。
2. 改 `server/prisma/schema.prisma` 注释**没有**、也**不会**触发任何 `db push` —— 我只用了 grep/perl/Edit，全程没碰 prisma CLI，也没碰数据库。
3. 没有新增任何 npm 依赖（`git show --stat` 里没有 `package.json` / lockfile）。
4. 没有跑根目录 `pnpm build`；`./dev.sh` 全程未停、未碰。
5. 我的替换是**纯中文串替换**（`s/探究助手/探究空间/g`），原理上不可能命中 ASCII 标识符 —— 但仍按 §4.6 的 grep 计数做了正面证明，没有停在「原理上不可能」。
6. 报告里引用的每一行输出**都是工具的真实输出**，包括 §4.1 那份 grep（粘贴前重新跑过一次）。

## 七、Concerns

① **`dev.sh` 还剩 9 处，其中 3 处是可见输出**（`:159` status 行「托管: http://localhost:PORT （探究助手）」、`:193` service note、`:296` help 文本）。Global Constraint 8 明令「不碰 dev.sh」，我照办了 —— 但这意味着**用户跑 `./dev.sh status` 时仍会看到旧名**。若用户要「全面」到底，需要一句明确的放行（改动只是注释与 printf 字符串，风险接近零，但我不想擅自越过明令）。**建议：请控制器裁定是否补一个 `dev.sh` 的小提交。**

② **`server/prisma/schema.prisma` 的注释改动会改掉它的内容哈希**。桌面端用 `schema.prisma` 内容哈希做 schema 版本（`src-tauri/src/lib.rs:311`，`.schema-version`），哈希一变，**下一次桌面端启动会走一遍「升级前备份 + `prisma db push`」**。因为 schema 结构其实没变，这次 push 是空操作、备份是多余的，**功能上无害**，但属于「一次注释改动引发了升级路径」。若认为不值得，可以只回退这一个文件的 7 行注释。**我倾向于保留**（`///` 注释在 Prisma Studio 里可见，留着旧名会误导人），但这是个需要知情的取舍。

③ `.superpowers/` 里 9 处未改：其中 6 处是**本次任务的 brief 本身**（我不该改自己的任务书），另 3 处是上一轮热修与看板任务的 brief/report —— 那是「当时发生了什么」的历史记录，把里面的用户原话「探究助手快照不显示」改掉等于篡改记录。若控制器认为工作区文件也该跟着改，请明示。另：`.superpowers/` **未被 .gitignore 忽略**（`git check-ignore` 不命中），所以它一直躺在 `git status` 的未跟踪列表里，将来一次 `git add -A` 会把任务书一起提交进库 —— 这个也许值得单独处理。
