# 教师端界面修正（A–G + dev.sh 改名 H）· 报告

**分支**：`fix/webapp-material-authority`
**依据**：`.superpowers/board-ui-fixes-brief.md`（用户 2026-09-23 的四张带批注截图）
**日期**：2026-09-23

## 交付物

| 提交 | 覆盖 |
|---|---|
| `d1e94e0` | G（服务端） |
| `2a5ff47` | H（dev.sh 改名补完） |
| `3581dee` | A / B / C / D（看板） |
| `9610dd2` | E / F（教师首页卡片与弹窗） |

工作区里剩下未提交的 `specs/*.md` 与 `design/`、`.superpowers/` **都不是本次改动**
（会话开始时 `git status` 就已经是那样）。

---

## 验收数字（先给结论）

| 项 | 基线 | 现在 |
|---|---|---|
| `cd server && pnpm test` | **308 pass / 0 fail** | **311 pass / 0 fail**（+3 条 G 的用例） |
| `npx tsc --noEmit` | 0 | **0**（`tsc_exit=0`） |
| 限定范围 `eslint`（6 个改动文件） | —— | **0 error / 0 warning**（无输出） |
| `node --test src/lib/classroom-material.test.ts` | 12 pass | **18 pass / 0 fail**（+6 条 E/F 的用例） |
| `bash -n dev.sh` | —— | **退出 0** |

基线未变红，所以**没有**执行 `rm -rf server/dist`（约束 9 的条件未触发）。
服务端只跑过 `cd server && pnpm build`（tsc），**没有**跑根目录 `pnpm build`（约束 6）。

---

## A. 对话分析面板：智能学伴模块 `hidden` 时不显示

**改了什么**（`src/app/teacher/classroom/page.tsx`）
`<AnalyticsPanel …/>` 由无条件渲染改成：
```tsx
{moduleStateOf(classroom.modules, MODULE_KEY_BY_ID.companion) !== 'hidden' && (
  <AnalyticsPanel classroomId={id} allMessages={allMessages} loadAnalytics={loadAnalytics} />
)}
```
那行已经不成立的注释（「始终渲染，全屏时被 fixed 遮罩覆盖」）换成了新的口径，
并按 brief 要求写清**为什么只管 companion**：这块面板统计的全部是学伴对话；
探究空间不需要同类面板（它有自己的画面/事件监控）；学习单将来要有但要另行设计
（引了用户原话，不是 TODO）。

**怎么验的 / 看到什么**
- 编译期：`npx tsc --noEmit` 退出 0 —— 说明 `MODULE_KEY_BY_ID.companion` 与
  `moduleStateOf` 的签名对得上（`moduleStateOf` 收 `ClassroomModuleKey`，不是字符串）。
- 走查渲染路径：`classroom` 在该作用域已被收窄为非空（同一作用域里 `moduleStateOf(classroom.modules, moduleKey)`
  本来就在用，如模块状态菜单），所以这里不需要 `?.`。
- 三种态：`open` / `preview` ⇒ 渲染；`hidden` ⇒ **整块不渲染**（不是隐藏样式）。
  面板自身只在挂载时 `loadAnalytics()`，卸载后不再拉取，不产生新的请求。
- ⚠️ **没有做浏览器实测**（见文末「自评与保留」第 1 条）。

---

## B. 筛选胶囊：另加一组「三件套各多少人」

**改了什么**
1. 新状态 `studentModuleFilter: StudentModuleFilter`（`'all' | TileModule`），与既有
   `studentBoardFilter` **互不干扰**。
2. 新筛选行（状态筛选行正下方、`aria-label="按模块筛选"`）：`全部 | 学习单 | 探究空间 |
   智能学伴 | 首页 | 未知`，每一项可点、点中即筛。计数用既有的 `moduleDistribution`
   （**按人**数，不按格子）。
3. `displayCards` 的过滤改成两组**「与」**关系：状态不中 ⇒ 出局；模块不中 ⇒ 出局。
4. `ModuleCountChip` 从纯展示的 `<span>` 改成 `<button aria-pressed>`（带选中态），
   沿用同一套「模块名 + 数字」的视觉。
5. 「当前筛选下没有学生」那个「查看全部学生」按钮改成**两组都清**——
   原来只清状态那一组，模块还卡着的话，教师点完仍然看不到人，而按钮的字面意思正是「全部学生」。

**与顶部「此刻各模块人数」的重复 —— 我的处理与理由（brief 要求写进报告）**

**选择：合并。撤掉顶部那张卡里的模块计数，只留可点的这一处。**

- 三个选项里，「保留两处、只把新的做成可点」最省事，但正是 brief 警告的那种歧义：
  同一批数字出现在两个地方、只有一个能点，教师没有任何线索知道该点哪个。
- 「顶部退化成纯信息」也不解决问题 —— 它**本来**就是纯信息（那些 chip 从来就不可点），
  所以那句话等于什么都没做。
- 所以真正无歧义的只有「只留一处」，而留下的那处必须**能**筛选。代价是顶部那张卡
  失去全部内容，我做了两件事补上：
  - 卡片改名为「探究空间」（跟随模式）/「指定模式」，保留原有的探究画面两项计数；
  - 跟随模式下**没有任何探究信号时整张卡不渲染** —— 这不是我新立的规矩，
    原来那一行就是这么办的（`exploreWithFrame > 0 || exploreOpened > 0`），
    只是原来卡里还有别的数字撑着。既然只剩这一项，就照原决策办。
- ⚠️ 副作用：`data-board-distribution` 这个锚点在全班都没打开网页、且处于跟随模式时会消失。
  我 grep 过全仓，**没有任何消费者**（`grep -rn "data-board-distribution" .`（排除 node_modules/.next）
  只有定义处一行），所以不是断锚点。它仍然挂在同一张卡上。

**首页 / 未知 要不要也做成胶囊 —— 我的判断：要，而且必须**（brief 让我自己定）
- 理由已经不是「锦上添花」：顶部那张卡里的这几项计数被我撤掉了，筛选行如果只放三件套，
  这几个学生在整个筛选区里**彻底找不到**了。原来文件里对这两项的注释写着
  「少了它们，教师会以为人丢了」——这条理由在合并之后只会更强。
- 视觉上沿用 `muted`（弱化），与三件套区分开：它们不是模块，是两种「不在这三个里」。

**筛选语义（brief 要求写进报告）**
- 两组是**「与」**：状态那组答「他掉线了吗」，模块这组答「他在用哪一件」，教师要的是交集。
- 格子是否命中某模块，按**人**判而不是按格子的 `tileModule` 判：
  `cardInModule(card, m) = 任一成员的实际位置 === m`。
  小组格的 `tileModule` 可能是 `mixed`，而它确实**含有**在「学习单」里的人 ——
  教师点「学习单」是想找出这些学生，把 mixed 格整格藏掉正好把他们藏起来了。
  代价：一个 mixed 格会在多个模块筛选下都出现（它本来就横跨多个模块）。
- 模块筛选的计数是**按人**（与原来的顶部卡一致），而格子的命中是按格 ——
  所以「全部」那一项的数是**格子数**、其余三项是**人数**，小组课堂上两者对不上。
  这是刻意的：教师问的是「三件套各有多少人」（用户原话），不是「多少个格子」。

**指定模式下不渲染这一行 —— 我的理由**
指定模式下 `resolveTileModule` 对所有人恒返回 `assignModule`，按模块筛只剩
「全中」与「全不中」两种结果 —— 那种筛选器只会让人以为它坏了。同时
`effectiveModuleFilter` 在指定模式下恒为 `'all'`（**不偷偷清 state**，切回跟随时
原来挑的那一项还在）。全屏只在指定模式下可达，所以这一行不需要额外判 `gridFullscreen`。

**怎么验的 / 看到什么**
- 编译期把 TDZ 抓出来了：最初我把 `displayCards` 留在模块判定之前，而过滤回调要调
  `cardInModule` / `resolveStudentFocus` —— 两者都是 `const` 箭头函数，
  那是首屏即崩的 `ReferenceError`，不是「还没算好」。把两段计算移到模块判定之后，
  并在那里留了注释说明**为什么顺序是设计的一部分**。
- ⚠️ **没有做浏览器实测**（见文末）。

---

## C. 「N 轮」只在智能学伴下显示

**改了什么**
新增 `tileModuleBadge(module, members, rounds): string | null`，两处看板（主看板 / 全屏网格）
都改成 `{moduleBadge !== null && (<div …>{moduleBadge}</div>)}`，徽章文字只在
**智能学伴**那一支返回 `${rounds} 轮`。`rounds` 只算一次（两个调用点各加一行
`const moduleBadge = …`），「渲染与否」与「显示什么」读同一个值。

**三种模块各判各的 + 兜底**（brief 明确要求）
| `tileModule` | 徽章 |
|---|---|
| `companion` | `${rounds} 轮` |
| `worksheet` | `null` —— 今天**没有**学习单进度数据（表都还没建），编一个数才是错的；接上后这里改显示「已看 N/M」（用户裁定） |
| `explore` | `null` —— 那一格显示的是画面，与对话轮数无关 |
| `mixed` | 有成员在学伴 ⇒ `${rounds} 轮`，否则 `null` |
| 兜底（`home` / `unknown` / 线缆上多出来的取值） | `null` |

**口径选择（brief 要求两处一致）**：用**该格的 `tileModule`**（不是 `moduleStateOf`）——
A 用 `moduleStateOf` 判的是「整间课堂的学伴模块开没开」，C 判的是「**这一格**此刻显示的是不是学伴」，
本来就是两个问题；C 内部四处调用（两处徽章、两处 `tileShowsClear`）用的是同一个函数族。

小组格的灰度沿 `tileShowsClear` 的既有口径：`mixed` 时只要有成员在学伴就显示。
理由与那个垃圾桶逐字同源 —— `rounds` 数的是**学伴对话**，不是「在这个模块里说了几句」，
所以组内有人还在学伴时这个数就有意义。

---

## D. 格子内容区显示该生「当前所在模块」

**改了什么**
1. 从 `resolveTileModule` 里把「实际位置」那一层抽成 `resolveStudentFocus(studentId)`
   （不重写映射：`resolveTileModule` 改成在跟随模式下**直接返回** `resolveStudentFocus(id)`）。
2. 新增 `tileLocationNote(module, members): string | null`。
3. 在 `renderTileContent` 里统一出口：有 note 就在内容区顶部渲染一行小字
   （`flexShrink: 0`，`compact` 时字号更小），没有就直接返回原内容。
   主看板与全屏网格**共用**这一个出口，不存在「只有全屏才看得见」的差异。

**我的选择与理由（brief 要求写进报告）**

**选择：跟随模式下**不显示这行小字（两者相同时省略）；**指定模式下**，实际位置与该格
显示的模块**相同**时也省略。理由：

- brief 说这行小字「最有用的场景是指定模式」，又说跟随模式下两者恒等、要不要省略让我自己定。
  我核过代码：跟随模式下 `resolveTileModule` 与 `resolveStudentFocus` 是**同一个来源**
  （我特意把它们写成同一条），所以那一行永远等于格子标题，写出来只是同一句话说了两遍。
  小组格的逐人差异也已经由 `mixed` 分支逐人列出来了 —— 再加一行是重复。
- 因此判据落成一句更简单也更好核的话：**只在指定模式下出现**。它与「两值相同时省略」
  在跟随模式下等价（那正是上面的推理），但少一个分支要维护。
- 实际位置**未知**时也显示（「位置未知」）：指定模式下格子显示的是教师指定的内容，
  「还没收到这个学生的位置」与「他就在指定模块里」在界面上长得一模一样，而这行小字
  是唯一能区分两者的东西。`moduleLabelOf('unknown')` 是「…」（给格子标题用的），
  这里特意换成「位置未知」。
- **学生格**说他自己在哪（`实际在：学习单`）；**小组格**只列**不在**指定模块里的那些人
  （`实际：学习单 2、首页 1`），全组都在就不显示 —— 否则「3 人都在探究空间」会盖在每一格上。
- 文案用三件套的名字（走 `MODULE_ID_LABELS` 唯一出处），与别处一致。

**怎么验的 / 看到什么**
- 数据源确认（指定模式下它有东西可显示）：`student-module-focus` 的订阅在
  `page.tsx` 里是**无条件**的（不按看板模式分支），服务端也是无条件记录 + 回放：
  `server/src/socket/index.ts:1670`（写入）与 `:1258-1264`（教师 join 时回放，注释写明
  是为了「学生先进、教师后开」这个顺序）。所以指定模式下这行小字拿得到真实位置。
- ⚠️ **没有做浏览器实测**（见文末）。

---

## E. 课堂卡片：材料引用按类型分组

**改了什么**（`src/app/teacher/page.tsx`）
卡片中间那块从「只有一类（智能体）的一行」改成**按类型分三组**：
`学习单 · 探究网页 · 智能学伴`，每组一个类名 + 该类的全部条目，条目共用一套长相
（方形图标 + 名字 + 可选的组名）。三类走**同一套渲染**，空类不渲染（三类都空时整块不渲染，
与原来「没有智能体就整块不渲染」一致）。

**两条来源都覆盖（brief 的重点，也是本会话那个 bug 的同源风险）**
材料来源由一个**共用**函数决定，不在卡片里各读各的：
`classroomMaterialsInUse`（`src/lib/classroom-material.ts`）——
高级模式取 `groups[]`（每组一份，**不回落**），标准/分组取课堂级
（`classroomAgents` / `webapps` / `worksheets`）。这正是服务端
`resolveMaterialTargetId`（spec §4.4）的同一条规矩，只是问的是「**这间课堂**在用什么」
而不是「**某个学生**用哪一份」。

**同类多份怎么容纳**：按 `id` 去重，但**保留「这份是谁的」** —— 高级模式下同一个网页
被两个组选中会合成一条并把两个组名并列；不同组选了不同的网页就并排列出
（`光合作用 第1组`、`水循环 第2组`）。用户原话是「这些事要认真思考」，
我认为「4 个名字并列而不说为什么有 4 个」是没思考的那一版。

**学习单那一类当时为什么是空的、以及「让它显示得出来」我具体做了什么**

> ⚠️ **时序说明（2026-09-23 补写，如实记录，不粉饰）**：下面这三条写在
> `feat/p1-worksheet` 的后端实现**合并进来之前** —— 本批（`3581dee` / `9610dd2`）与
> P1 服务端长在**两条不同的分支**上。当时三条都是**实测**出来的，不是推断；
> 合并之后三条**全部失效**（当前树上已逐条复核，见下）。这份报告保留原文的结论框架，
> 但把「核过的事实」换成**当前**成立的那一版，免得下一个人读到旧结论以为服务端还要补。

当时核过的事实（三条，合并前为真）：
1. `Worksheet` 表不存在（`server/prisma/schema.prisma` 里没有该 model）；
2. 全仓**没有任何地方**写 `ClassroomGroupMaterial.kind='worksheet'`；
3. `GET /api/classroom/active` 不下发学习单字段。

**合并后的当前事实（每条都复跑过，命令在右）**：
1. 表**存在**：`grep -n "^model .*Worksheet" server/prisma/schema.prisma`
   → `428:model Worksheet` / `444:model ClassroomWorksheet`（另有 `WorksheetResponse` / `WorksheetAnswer`）。
2. 写路径**在**：`grep -rn "kind: 'worksheet'\|worksheetId" server/src/routes/classroom.ts`
   → `:587` 的写入循环含 `['worksheet', group.worksheetId]`（组级），
   `:362` / `:515` 是创建课堂时的 `worksheetIds` 解析。
3. `GET /api/classroom/active` **下发**学习单，两个层级都发：
   · 课堂级 `worksheets: { id, title }[]` —— `classroom.ts:700` 调用 `loadClassroomWorksheets`
     （定义在 `:217`；另两个调用点 `:882` = `GET /:id`、`:1005` = `GET /code/:code`）；
   · 组级 `groups[].worksheet: { id, title } | null` —— `resolveGroupMaterialViews` 拼出
     （`server/src/services/group-material-resolve.ts:188`）。

⇒ 因此**「形状先就位」这件事已经完成闭环**，不再是「等接上服务端」：读路径
（`classroomMaterialsInUse`）三类同一段代码，今天**真的有货可显示**。
`types.ts` 的三处注释（`WorksheetMaterialSummary` / `ActiveClassroom.groups[].worksheet?` /
`ActiveClassroom.worksheets?`）已按上面这一版改写；`src/lib/classroom-material.ts` 里两句
「今天恒为 `undefined`」与那条测试的名字也一并改掉了 —— 散文否认一个存在的机制与
散文声称一个不存在的机制一样会误导下一个人。

（接口形状仍然**只有** `id` / `title`：题目 `content` 与答案都不在这两个载荷里，别照着网页那套扩字段。）

**⚠️ 有意的行为变化**：卡片原来把 `classroomAgents` 与 `groups[].agent` **并集**显示（两种模式都并）。
分组/标准模式下材料的权威来源是课堂级，组级那一支本不该有（`create-advanced` 是唯一写组材料的路径），
它一旦出现就是「显示了一份学生不会用的材料」。现在这种模式只读课堂级 —— 少一个说谎的可能。

**怎么验的 / 看到什么**
- 见下面的「实测证据」第 3 条（`/active` 真的下发 `groups[].webapp`）与第 4 条（前端用例）。
- ⚠️ **没有做浏览器实测**（见文末）。

---

## F. 课堂设置弹窗：探究网页不再谎报「未关联」

**先核了一个前提（brief 说「若没有下发组级材料，你要给它补上」）**
**`/api/classroom/active` 已经下发了组级材料，不需要改服务端。** 证据（实测，见「实测证据」第 3 条）。

**改了什么**
弹窗那一段改读 `classroomMaterialsInUse(...).webapps`：
- 高级模式 ⇒ 各组在用的网页（与 `groups[].webapp` 同一来源），并在每条旁边标出是哪个组的；
- 标准 / 分组 ⇒ 课堂级列表（**顺序不变**，第一个仍是「唯一生效的那一个」）。
- 空的时候文案**按模式区分**：高级模式是「各组均未配置探究网页」，其余模式仍是「未关联」——
  两种「没有」不是同一件事（一个是「每个组都没配」，一个是「课堂级没关联」）。
- 「多选时代留下的课堂会被裁掉多余的」那条警告**只在非高级模式**出现，且仍以
  `webapps[0]` 为「会生效的那个」：高级模式按组配置，保存时不会被裁；
  而且高级模式下课堂级那几行按设计是**幽灵**，拿它算「会被删掉几个」是错的。

**怎么验的 / 看到什么**
- 实测证据第 3 条：高级模式的夹具里课堂级 `webapps = []`、`groups[0].webapp` 有值 ——
  这正是 bug 的现场（改前显示「未关联」），改后走的是组级那一支。
- 前端用例：`🔴 高级模式：各组都没配就是**空**，绝不回落到课堂级`（含反证，见下）。
- ⚠️ **没有做浏览器实测**（见文末）。

---

## G. 管理页「被多少个课堂关联」的计数漏了组级

**改了什么**（`server/src/routes/webapps.ts` 的 `GET /`）
`classroomCount` 原来只数 `ClassroomWebapp`（课堂级）。改成与同文件 `GET /:id/usage`、
DELETE 守卫**同一条口径**：union `ClassroomWebapp` + `ClassroomGroupMaterial(kind='webapp')`，
仍然「一次取全再在 JS 里统计」（两条 `findMany`，不是 N+1）。

**一个新的判断（brief 没写、我做的）**：按**课堂**去重，而不是把两张表的行数相加。
- `ClassroomWebapp` 有 `@@unique([classroomId, webappId])` ⇒ 课堂级那一支本来就
  「一行 = 一间课堂」，去重**不改变**它原来的数（不会悄悄改掉既有行为）；
- 组级那一支同一间课堂可以有多个组引用同一个网页，按行数会把它数成好几间课堂；
- `GET /:id/usage` 的 `classroomCount` 本来就是去重后的课堂数（`byClassroomId` 那张表），
  这样两个端点的 `classroomCount` 是同一个意思。

**TDD 证据**

**RED（先写测试，实现在后）** —— `cd server && pnpm build && node --test dist/tests/webapp-upload.test.js`：
```
✖ 🔴 只被组级材料引用的网页：GET /api/webapps 的 classroomCount 必须算上组级
  AssertionError: 只被小组引用的网页也算「已关联」，否则管理页会显示成未关联：
  [{"id":"11111111-…","name":"光合作用",…,"classroomCount":0}]
  0 !== 1
✖ 同一课堂的多个组引用同一网页：classroomCount 按**课堂**去重，不是按组数
  AssertionError: 按课堂去重后是 1：[{…,"classroomCount":0}]   0 !== 1
```
（同一轮里 `正对照：课堂级与组级指向同一间课堂时也算 1` 是**绿**的 —— 它证明这一轮红了不是因为夹具坏了。）

**GREEN** —— 实现之后：
```
✔ 🔴 只被组级材料引用的网页：GET /api/webapps 的 classroomCount 必须算上组级
✔ 同一课堂的多个组引用同一网页：classroomCount 按**课堂**去重，不是按组数
✔ 正对照：课堂级与组级指向**同一间**课堂时也算 1，不是把两条路径相加
ℹ tests 31  ℹ pass 31  ℹ fail 0
```

**反证（brief 要求：把 union 去掉 ⇒ 该测试变红）** —— 临时删掉
`for (const material of groupMaterials) addLink(material.targetId, material.group.classroomId);`
这一行后重编译再跑：
```
✖ 🔴 只被组级材料引用的网页：GET /api/webapps 的 classroomCount 必须算上组级
✖ 同一课堂的多个组引用同一网页：classroomCount 按**课堂**去重，不是按组数
✔ 正对照：课堂级与组级指向**同一间**课堂时也算 1，不是把两条路径相加
ℹ tests 31  ℹ pass 29  ℹ fail 2
```
**随后已还原**（`grep -n "for (const material of groupMaterials)"` 命中，
重跑 31 pass / 0 fail）。反证里那两条正是新增的那两条，正对照仍然绿 ——
说明红的是 union 本身，不是别的原因。

夹具改动：`createHarness` / `startServer` 各加了第 4 个可选参数
（`{ listedWebapps?, groupClassroomIds? }`），默认值保持原样 ⇒ **既有用例一行未改**。
`classroomWebapp.findMany` / `classroomGroupMaterial.findMany` 两个桩补上了新查询
真正 `select` 的字段（`webappId` / `classroomId` / `targetId` / `group.classroomId`），
包装层级一个字没简化。

**顺带修的一句过期注释**：`src/lib/api.ts` 的 `checkWebappUsage` 上面写着
「网页只有 `ClassroomWebapp` 一条关联路径」—— 那句话在上一轮组材料落地时就过期了。

---

## H. 补完 `dev.sh` 的改名（brief 之外）

**先核了前提**：`git status --short dev.sh` **无输出**（干净），可以改。

**改了什么**：`dev.sh` 里剩下的 9 处「探究助手」→「探究空间」，其中三处用户可见
（`cmd_status` 的托管行、service note、help 文本）。**只改中文文案**：
`WEBAPP_PORT` / `CLASSNODE_WEBAPP_PORT` / `start_service` / `assert_port_free` 等
变量名、端口逻辑、分支结构一个字没动。

**证据 1 —— `bash -n dev.sh`**
```
$ bash -n dev.sh
bash -n: OK (exit 0)
```
（无输出本身即为通过；退出码 0。）

**证据 2 —— 改后 `grep -n 探究助手 dev.sh`**
```
$ grep -n "探究助手" dev.sh
（无输出，退出码 1 = 零命中）
$ grep -c "探究空间" dev.sh
9
```

**证据 3 —— 「变量/端口/分支未动」不是我说的，是 diff 说的**
```
$ diff <(sed 's/探究空间/探究助手/g' dev.sh) /tmp/dev.sh.bak
✅ 除「探究空间→探究助手」外，dev.sh 与改前逐字一致（变量/端口/分支未动）
$ git diff --stat dev.sh
 dev.sh | 18 +++++++++---------
 1 file changed, 9 insertions(+), 9 deletions(-)
```
（`/tmp/dev.sh.bak` 是改前的副本；把新文件的「探究空间」还原成旧名之后与它逐字相同，
说明这 9 行以外**没有任何**改动。）

**全仓复查**：`grep -rn 探究助手`（排除 `node_modules/.next/.git/out/.superpowers/specs`）
退出码 1 —— 代码与文档里已无旧名；剩下的命中全在任务文档与那份记录历史的 spec 里（预料之中）。

---

## 实测证据（约束 10：每条「因此安全 / 已覆盖」都附一条命令或一段输出）

1. **G 的反证**：见上（29 pass / 2 fail 的输出）。
2. **E/F 的反证**：把 `classroomMaterialsInUse` 的高级模式分支改成不生效
   （`if (classroom.mode === 'advanced')` → `if (false)`）后：
   ```
   ✖ 高级模式：探究网页来自**各组**，同类多份全部列出
   ✖ 高级模式：同一个材料被两个组引用 → 合成一条，组名并列（不是列两遍）
   ✖ 🔴 高级模式：各组都没配就是**空**，绝不回落到课堂级
   ✖ 学习单：今天服务端不下发，但形状就位 —— 有数据就列得出来
   ℹ tests 18  ℹ pass 14  ℹ fail 4
   ```
   **随后已还原**（`grep -n "if (classroom.mode === 'advanced') {"` 命中，重跑 18 pass / 0 fail）。
3. **F 的前提「`/active` 已下发组级材料」是实测的，不是读代码推断的**。
   写了一个一次性探针（跑完即删，未入库）挂在 `dist/routes/classroom.js` 上，
   桩数据是「高级模式 + 一个组配了网页 + 课堂级 `webapps` 为空」：
   ```
   $ node .probe-active.mjs
   status = 200
   groups[0] = {"id":"g1","name":"第1组","classroomId":"c1","members":[{"id":"m1"}],
                "agent":null,"webapp":{"id":"w1","name":"光合作用","entryPath":"index.html"}}
   classroom-level webapps = []
   ```
   ⇒ `groups[].webapp` 确实在响应里，而课堂级确实是空的 —— **正是 F 那个 bug 的现场**，
   所以 F 不需要改服务端。
4. **D 的数据源在指定模式下也有值**：
   `grep -n "moduleFocus" server/src/socket/index.ts` → 写入在 `:1670`（无模式分支），
   回放在 `:1258-1264`（教师 join 看板时，注释说明是为了「学生先进、教师后开」这个顺序）。
   前端 `page.tsx:827` 的 `on('student-module-focus', …)` 也无模式分支。
5. **改名后的 `dev.sh` 语法**：`bash -n dev.sh` 退出 0（见 H）。

---

## Files changed

| 文件 | 提交 | 内容 |
|---|---|---|
| `server/src/routes/webapps.ts` | `d1e94e0` | G：`GET /` 的关联计数 union 组级 + 按课堂去重 |
| `server/src/tests/webapp-upload.test.ts` | `d1e94e0` | G：+3 条用例；夹具加两个可选参数与两个 `select` 字段 |
| `dev.sh` | `2a5ff47` | H：9 处中文文案改名（变量/端口/分支未动） |
| `src/app/teacher/classroom/page.tsx` | `3581dee` | A / B / C / D |
| `src/app/teacher/page.tsx` | `9610dd2` | E（卡片按类型分组）/ F（弹窗读实际在用的网页） |
| `src/lib/classroom-material.ts` | `9610dd2` | 新增 `classroomMaterialsInUse`（E/F 共用的读口径） |
| `src/lib/classroom-material.test.ts` | `9610dd2` | +6 条用例（含反证用的 🔴 一条） |
| `src/lib/types.ts` | `9610dd2` | `WorksheetMaterialSummary` + `groups[].worksheet?` / `worksheets?`（P1 形状就位） |
| `src/lib/api.ts` | `9610dd2` | 修一句过期注释（「网页只有一条关联路径」） |

**没碰**：`CLAUDE.md` / `release.sh` / `package.json` / `prisma`（没跑任何 `db push`）/
根目录 `pnpm build`（没跑）/ `./dev.sh` 的进程（没停）。

---

## Self-review findings（自查 diff 时发现并修掉的）

1. **TDZ（会首屏崩）**：B 的第一版把 `displayCards` 的过滤留在原处，而回调里要调
   `cardInModule` / `resolveStudentFocus`（`const` 箭头函数，定义在后面）——
   运行期是 `ReferenceError`。把两段计算移到模块判定之后，并留注释说明顺序是设计的一部分。
2. **误吞一行代码**：用「删掉行尾换行」的方式改注释时，把
   `const msgRounds: (number | null)[] = [];` 整行并进了上一行的注释里（`tsc` 报
   `Cannot find name 'msgRounds'`，9 处）。已修。**这条是 `npx tsc --noEmit` 抓出来的** ——
   如果我只跑 eslint，它是会过的。
3. **误删注释首行**：替换筛选行时把 `data-webapp-monitor` 那段注释的第一行吃掉了，
   留下悬空的半句。已补回。
4. **徽章算两遍**：C 的第一版在 JSX 里调了两次 `tileModuleBadge`（一次判空、一次取值），
   等于两份口径。改成在两处调用点各算一次 `const moduleBadge`，两个消费点读同一个值。
5. **`ModuleCountChip` 差点变成未使用变量**：撤掉顶部卡的模块计数后它没有调用点了
   （`@typescript-eslint/no-unused-vars` 会报）。改成按钮复用，而不是删掉组件 ——
   视觉语言（模块名 + 数字）延续下来，教师看到的还是同一批东西，只是能点了。
6. **`import` 了两个用不到的类型**：`ClassroomWebappSummary` / `WorksheetMaterialSummary`
   在 `teacher/page.tsx` 里只是被推断出来的，直接 import 会吃两条 warning。已删。
7. **「查看全部学生」只清一组**：顺手修了（不清模块那组的话按钮在说谎）。

---

## Concerns / 保留（请控制器重点看这几处）

1. 🔴 **A–F 全部没有做浏览器实测。**
   原因：`./dev.sh` 正在为你跑（约束 7 明确不许停），而且这些改动要在**进行中的课堂**里
   才能看到效果（需要登录教师端 + 至少一个学生在线切换模块），
   我没有办法在不打扰你的前提下真实渲染一遍。
   我做到的是：`npx tsc --noEmit` 退出 0、限定范围 eslint 0 warning、
   逐条走查渲染路径并把判据与真值表写进本报告。
   **请在浏览器里过一遍 A–D**（它们全在看板页，一次就能看完）：
   `模块状态 → 智能学伴 → 隐藏` 看面板是否消失、模块筛选行是否可点、
   某格停在探究空间时是否不再有「N 轮」、切到「指定」模式后格子顶部那行小字。

2. **B 的取舍值得你再确认一次**：我把顶部那张卡的模块计数**撤掉**了（合并成一个可点的筛选行）。
   理由是「同一批数字出现在两个地方、只有一个能点」必然引发歧义。
   代价是那张卡在跟随模式、全班都没打开探究网页时**整张消失**（顶部从 5 张卡变 4 张）。
   如果你更希望两处都在，改回来是一行的事（把 `ModuleCountChip` 那 5 行加回卡里即可），
   但那就回到 brief 警告的那个歧义上了。

3. **B 的计数口径**：「全部」那一项显示的是**格子数**，其余模块项显示的是**人数**
   （小组课堂上两者对不上）。这是刻意的（用户原话是「各有多少人」），
   但如果你觉得并排看着别扭，把「全部」也换成人数（`students.length`）是一行的改动。

4. **E 里我加了两处服务端还不下发的字段**（`groups[].worksheet?` / `worksheets?`）。
   这是 brief「让它显示得出来，将来接上就是对的」与「别新造口径」两条要求的平衡点：
   形状照 P1 规格写、声明成可选、注释写明今天不下发。
   如果你认为「声明一个服务端不发的契约」本身就是风险，删掉这两处即可 ——
   代价是 P1 落地时还要再改一遍读路径。

5. **E 去掉了 `classroomAgents ∪ groups[].agent` 里的组级那一半**（分组/标准模式）。
   我核过写路径（只有 `create-advanced` 写组材料，迁移也只覆盖高级模式），
   所以这是「去掉一个说谎的可能」，不是能力回退。但如果历史库里存在
   「分组模式 + 组材料」这种我没预见到的数据，卡片上会少显示一份材料。

6. **`data-board-distribution` 锚点会消失**：全仓 grep 无消费者（只有定义处一行），
   但如果 `.superpowers/sdd/` 下曾经有探针脚本用它而文件已被清理，那是断掉了一个
   我不知道的消费方。我查过当前工作区，没有。

7. **前端测试不在 `pnpm test` 里**：`src/lib/classroom-material.test.ts` 要走
   `node --test src/lib/classroom-material.test.ts` 单独跑（这是本仓既有的做法，
   与 `CLAUDE.md` 写的「测试在 `server/src/tests/`」并存）。我没有改 `package.json`
   （约束 8），所以这 6 条新用例**不会**被 `pnpm test` 带上 —— 请知悉。

---

## 控制器裁定（2026-09-23）

**B（筛选胶囊）：用户已确认「保持合并」。** 实施者把顶部卡的模块计数撤掉、合并成一行可点的筛选，
这与 brief 里引用的用户原话「另加一组」不一致 —— 但控制器把偏离摆给用户后，**用户选择保持合并**
（追问时给出的第三个选项「保持合并，但把消失的那张卡补回来」未被选中）。

⇒ 审查若把 B 报成偏离，**不进修复循环**：那是用户的知情选择，不是缺陷。
