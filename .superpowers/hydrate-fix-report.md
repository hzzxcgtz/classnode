# 「学生做了一半刷新页面后，做好的题没了」——修复报告

分支 `feat/p1-worksheet`。现象、根因、修法、实测、反证，逐条如下。

---

## 一、根因复核：控制器的判断是对的

`server/src/routes/worksheets.ts` 的 `student-view` 只回
`{ id, title, description, content, settings }`，**不含该学生已有的作答行**。
它上面那段注释写明了当初的理由：

> ⚠️ 不下发这名学生已有的作答：第一批没有「断线重进接着答」的入口（规格 §8 只要求
> 本地 `localStorage` 队列），多下发一份作答只会多一处需要脱敏的表。

**那个假设是错的**，而且错在一个很具体的地方：它把「队列」当成了「客户端的留底」，而队列
按定义**只留还没保存成功的条目**（`use-worksheet-answers.ts` 的 flush 循环里
`commitQueue(dropQueueItem(...))` 只在 `outcome.ok` 之后执行）。所以：

| | 客户端有留底吗 | 服务端有吗 |
|---|---|---|
| 还没保存成功（断网 / 还没到防抖点） | 有（队列） | 没有 |
| **已经保存成功** | **一点都没有** | **有** |

「已经保存成功」那一格正是刷新后变成空白的那一批。

---

## 二、「数据丢没丢」的实测 —— **没丢**

### 实测 A：真实 `server/prisma/dev.db` 里，用户刚刚人工验收留下的那三行还在

```
$ cd server && node -e "…prisma.worksheetResponse.findMany({include:{answers:true}})…"
WorksheetResponse 行数: 1
 resp c77ca7fe-… c1fb5609-… 1c490a22-… submitted 2026-09-23T13:35:35.317Z answers= 3
WorksheetAnswer 行数: 3
  q_a4046fbf-…  value={"format":"choice/v1","selected":["B"]}  status=submitted  isCorrect=true
  q_1d672f99-…  value={"format":"fill/v1","text":"氧气"}        status=submitted  isCorrect=true
  q_bd29c561-…  value={"format":"text/v1","text":"不知道唉"}    status=submitted  isCorrect=null
```

这正是用户报现象时那份卷子（课堂 `6013` / 学习单「测试学习单」）。
**三条作答一条不少，全部 `submitted`。**

### 实测 B：同一时刻，刷新页面拿到的响应里没有它们

```
$ curl -s .../api/worksheets/c1fb5609-…/student-view -H "Authorization: Bearer $TOKEN"
顶层键: id, title, description, content, settings
有没有 answers 字段: false
```

⇒ **数据从来没丢，丢的是「读回来的那条路」。** 这是本次修复的分水岭。

### 实测 C：受控复现（临时库，不碰真实库）

`/tmp/cn-repro/repro.ts`（真 Express + 真 `worksheetAccessGate` + 真路由 + 临时 SQLite，
建库前先断言 `DATABASE_URL` 落在 `os.tmpdir()` 下）：

```
① 保存 q_1 ⇒ HTTP 200 {"success":true,"questionId":"q_1","status":"draft"}
① 保存 q_2 ⇒ HTTP 200 {"success":true,"questionId":"q_2","status":"draft"}
② 刷新后 GET student-view ⇒ HTTP 200
   返回体顶层键: id, title, description, content, settings
③ 查库 WorksheetAnswer ⇒ 2 行
   q_1  value={"format":"choice/v1","selected":["B"]}  status=draft  isCorrect=null
   q_2  value={"format":"fill/v1","text":"H2O"}        status=draft  isCorrect=null
──────────────────────────────────────────────
数据丢了吗：没丢 —— 两行都还在服务端
刷新后的响应把它带给学生了吗：★ 没带（这就是「做好的题没了」）
```

---

## 三、修法：**另加一个学生端读端点**，而不是往 `student-view` 里塞

### 3.1 为什么选「新端点」（两条路都评估过）

| | A. 扩 `student-view` | **B. 新端点 `GET /:id/answers`（采用）** |
|---|---|---|
| 请求数 | 1 | 2（`Promise.all` 并行，延迟 ≈ 1 次） |
| 闸门 | 不动 | 加一行正则（`GET` + 已有的 `^\/[^/]+\/answers\/?$`） |
| 🔴 `student-view` 的红线用例 | **要么被磨细，要么给字段起个躲子串的名字** | **一个字节都不用改** |

决定性的理由是第三行。`worksheet-student.test.ts` 第一条红线对**整串响应**做
`!raw.includes('answers')` —— 那是一件**刻意钝**的兵器（规格 §10 的验收条目就是它）。
往那个响应体里加一个叫 `answers` 的顶层键，只剩两条路：把钝器磨细（削掉它本来就有的
过度覆盖），或者给字段起一个专门为绕开子串检查而生的名字。**两条都是「为了新功能去动红线」。**

> 我自己先踩了一次这个坑，可以当实证：新端点最初的响应体我写成了 `{ "answers": rows }`，
> 结果**我自己写的那条键名扫描用例**当场变红 ——
> `AssertionError: 回读响应里出现了答案键「answers」`。
> 那不是误报，那是判据在正常工作。于是把信封键改成 `{ "rows": rows }`（「作答行」，
> 本文件通篇的用词），而不是去给用例开一个豁免口子。

代价如实记两条：
- 多一次网络往返（并行发出，且失败时**一起失败** —— 见 3.3）；
- 闸门多一条学生放行形状。它值得单独盯一眼：`GET /:id/answers` 与 `PUT /:id/answers`
  **共用同一条正则**（`^\/[^/]+\/answers\/?$`，只是方法不同），而教师看板的
  `GET /classroom/:classroomId/answers` 靠「**恰好两段**」被挡在外面 ——
  将来若有人把这一段挪成三段，学生放行集会**连带打开教师看板那个端点**。
  这条已经写进闸门的注释，且 `worksheet-board.test.ts` 那条 403 用例仍然绿。

### 3.2 服务端：`GET /api/worksheets/:id/answers`

```json
{ "rows": [ { "questionId", "value", "status", "submittedAt", "isCorrect" } ] }
```

- 前置校验直接复用 `requireOwnWorksheet`（与另外三条学生形状**同一个**函数），
  所以「越权读别人组那份」的判据与 `student-view` 完全一致，不是第二份。
- 只 `select` 那五列，**根本不碰 `content`** ⇒ 没有可泄漏的答案；
- 读路径**只查不写**：没作答过的学生拿到 `{ "rows": [] }`，不会顺手建出
  `WorksheetResponse`（那会让教师看板把什么都没做的学生显示成「已开始作答」）。
- **不按当前 `content` 过滤**：教师删题后留下的那行照样发回，前端只画 `content` 里的题，
  在这里过滤等于把「这题还在不在」抄第二遍 —— 抄错的症状是**学生的作答静默消失**。
- 顺带把 `student-view` 上那段**错的**旧注释改成了「为什么这里刻意不下发」＋
  「那个旧理由是错的，实测与修法见 `GET /:id/answers`」。

### 3.3 前端：三次读取并行、一起失败

`worksheet-panel.tsx` 用 `Promise.all([student-view, answers])`，两个都成功才进 `ready`。

**「一起失败」是刻意的一条**：作答读不回来而题目照常显示的话，学生看到的是一份**空白**卷子，
而他的作答其实好好地躺在服务端 —— **那正是这次要修的那个症状，只是换了个成因**。
宁可整块报错（复用已有的重试卡片），也不要让他看着空白以为自己白写了。

---

## 四、合并规则（本次最容易写错的地方）

抽成了一个纯函数 `hydrateAnswers(saved, queue)`（`worksheet-queue.ts`），
理由是它必须**能被 `node --test` 直接跑到** —— 那个目录没有 React 测试框架。

三个来源，**优先级从低到高**：

```
① 什么都没有                      ⇒ 空白（一道没做过的题就该是空白）
② 服务端已有的作答（savedAnswers） ⇒ 草稿 + 状态 + 得分 + lastSent
③ 本地队列（localStorage）        ⇒ 覆盖 ②  ← 🔴 队列赢
```

逐条口径：

| 来源 | `drafts` | `statuses` | `scores` | `lastSent` |
|---|---|---|---|---|
| 服务端那一行 | 填 | 填 | 填 | **填** |
| 队列那一条 | **覆盖** | **删** | **删** | **不填** |

三条推理，缺一条都会踩坑：

1. 🔴 **队列必须赢。** 队列里那一题是「本地更新、还没被服务端确认」的改动（学生刚改完，
   或上一次会话断网留下的），服务端那一行一定更旧。拿它覆盖，学生看到的正是他刚删掉的旧答案 ——
   **「刚改完，一刷新又变回旧答案」**，比原 bug 更难查。
2. **队列那一题的状态与得分要让位。** 本地这次改动马上会被 `PUT` 拨回 `draft`、
   把 `isCorrect` 清成 `null`（`routes/worksheets.ts` 的 update 分支）。留着它们，
   界面会一边显示「✓ 已提交 ⭐」一边让学生继续改 —— 一句关于他自己的谎话。
3. **`lastSent` 两边刻意不对称。** 服务端回读来的行 ⇒ **填**（库里确实有这一行，
   学生随后清空它时必须发一条「清空」出去，否则服务端一直留着学生已经删掉的答案）；
   队列那一条 ⇒ **不填**（它还没被确认过 —— 可能发出去过、200 丢在路上了，也可能根本没发出去；
   填了的代价是凭空在库里多一行 `value` 为 NULL 的作答，教师看板立刻把这名学生显示成
   「已开始作答」）。这正是原文件里那段「刻意不填 `lastSent`」的取舍，一字未改。

**离线队列本身一行都没动**（`readQueue` / `writeQueue` / `upsertQueueItem` / `dropQueueItem` /
`replayOrder` / `classifyFailure` 全是原样），只多了一个消费它的纯函数。
唯一搬动的是 `scoreFromWire`：从 `use-worksheet-answers.ts` 搬到 `worksheet-queue.ts`
（定义仍然只有一处），因为水合这一侧也要用它，而「`null` 不是 `0`」这条判据必须有一条
跑得到的用例钉着。

### 引用稳定性（否则会把学生正在敲的字抹掉）

水合 effect 的依赖是 `[queueKey, savedAnswers]`，而它的开头会**整个替换** drafts/statuses/scores。
所以 `savedAnswers` 的**数组身份**必须稳定：它被放进 `load` state 里，与题目一起由同一次
`Promise.all` 灌进去（每次 fetch 只建一份）；还没读到时代入的是**模块级常量**
`NO_SAVED_ANSWERS`，不是现写的 `[]`。两处都写了注释，因为「现 map 一份」是一个看起来
完全无害、实际每次渲染都会抹掉输入的写法。

---

## 五、安全实测

### 5.1 新增的判据（用例里，三层）

`worksheet-student.test.ts` 新增的「刷新」用例里，三道判据缺一不可：

1. **键名级（递归扫描）**：`ANSWER_KEYS` 一个都不许作为**键**出现
   （照 `worksheet-board.test.ts` 的 `collectKeys`）；
2. **原文级（子串）**：`correctKeys` / `explanation` 连字面量都不许有；
3. **阳性对照（两条）**：学生写的那个**错**答案必须在（否则「搜不到正确答案」可能只是因为
   响应是空的）；**正确答案必须不在**。

夹具是刻意设计的：两道客观题学生都**答错**，且写的是正确里没有的字符串
（填空答 `CO2`，正确是 `H2O`；单选选 `A`，正确是 `B`）。断言里就有
`assert.ok(!raw.includes('H2O'), '正确答案不得随作答回读一起下发')`。

### 5.2 真实 dev 服务 + 用户自己那份数据的实测

```
$ curl -s .../api/worksheets/c1fb5609-…/answers -H "Authorization: Bearer $TOKEN"
HTTP 200
{"rows":[{"questionId":"q_1d672f99-…","value":{"format":"fill/v1","text":"氧气"},…,"isCorrect":true},
         {"questionId":"q_a4046fbf-…","value":{"format":"choice/v1","selected":["B"]},…,"isCorrect":true},
         {"questionId":"q_bd29c561-…","value":{"format":"text/v1","text":"不知道唉"},…,"isCorrect":null}]}

=== 安全实测：正确答案字段搜得到吗 ===
  correctKeys 出现次数: 0
  explanation 出现次数: 0
  answers 出现次数: 0
  "options" 出现次数: 0
```

```
=== 递归键名扫描（与用例同一判据）===
  响应里出现过的所有键: rows, questionId, value, format, text, status, submittedAt, isCorrect, selected
  含答案键 correctKeys ? false
  含答案键 answers ? false
  含答案键 explanation ? false
```

### 5.3 ⚠️ 一条**假阳性**，如实记下

我第一次做的实测是「把 `content` 里每个正确答案的字面量拿出来，在新响应里 `includes` 一下」，
结果报了两条「泄漏」：

```
  [★泄漏] correctKeys / q_a4046fbf-… = "B"
  [★泄漏] answers / q_1d672f99-… = "氧气"
```

**这两条都是假阳性**：这位学生那两道题**答对了**，所以他的 `value` 里本来就是 `"B"` 和 `"氧气"`。
把「正确答案字面量」与「学生自己写的字面量」区分开之后：

```
  [出现，但那就是学生自己写的那个值（不是泄漏）] correctKeys q_a4046fbf-… = "B"
  [出现，但那就是学生自己写的那个值（不是泄漏）] answers    q_1d672f99-… = "氧气"
  [未出现（安全）] answers q_1d672f99-… = "氮气"
  [未出现（安全）] answers q_1d672f99-… = "氧化碳"
真泄漏条数: 0
```

⇒ **裸子串搜索在「学生答对了」时会天然误报**，判据必须是键名级（或配合「学生自己写的是什么」）。
这正好解释了为什么上面 5.1 的夹具要刻意让学生**答错**。

### 5.4 `content` 的剥离逻辑**一个字都没动**

`stripAnswers` 及其调用点原样。`student-view` 那个响应体**一个字节都没变**
（红线用例因此原样通过，`.superpowers` 里那条「答案剥离做了双向反证」的结论仍然成立）。

---

## 六、TDD 证据

### 6.1 基线（先自测，符合预期）

```
$ rm -rf server/dist && pnpm test
ℹ tests 135 / pass 135 / fail 0        ← 前端
ℹ tests 391 / pass 391 / fail 0        ← 服务端
```
（裸跑第一次是红的：`webapp-host.test.js` 报 `Unable to deserialize cloned data…`，
清掉 `server/dist/` 后恢复 —— 即约束 9 说的那种脏 `dist`。）

### 6.2 RED（先写用例，未动实现）

前端 —— 模块里还没有 `hydrateAnswers` 这个导出：

```
$ node --test "src/app/classroom/worksheet/worksheet-queue.test.ts"
✖ src/app/classroom/worksheet/worksheet-queue.test.ts
ℹ tests 1 / pass 0 / fail 1
```

服务端 —— 新端点还不存在（闸门把它当教师端形状拦下），且那条既有用例扩到四个端点后也红：

```
$ node --test dist/tests/worksheet-student.test.js
✖ 刷新：已保存的作答仍在库里，且刷新后仍能读回（value/status/submittedAt/isCorrect）
✖ 回读：没作答是空数组；别人组那份 403；教师 cookie 401
✖ 鉴权：教师 cookie 打学生端四个端点 ⇒ 401（不是 500）
ℹ tests 17 / pass 14 / fail 3
```

### 6.3 GREEN

```
$ pnpm test
ℹ tests 141 / pass 141 / fail 0        ← 前端（135 + 6 条新的水合用例）
ℹ tests 393 / pass 393 / fail 0        ← 服务端（391 + 2 条新的）
```

### 6.4 ★ 反证（两条，都实测变红）

**反证 ①：把前端的「队列赢」反过来（服务端的值覆盖队列）**

```
$ node --test "src/app/classroom/worksheet/worksheet-queue.test.ts"
✖ 🔴 hydrateAnswers：队列里那一题**赢** —— 服务端的旧值不得冲掉刚改完还没保存的新答案
✖ 🔴 hydrateAnswers：队列里的「清空」也要赢过服务端的旧值
ℹ tests 21 / pass 19 / fail 2
```

**反证 ②：把服务端的水合去掉**（摘掉闸门里 `GET /:id/answers` 那条学生放行形状）

```
$ node --test dist/tests/worksheet-student.test.js
✖ 刷新：已保存的作答仍在库里，且刷新后仍能读回（value/status/submittedAt/isCorrect）
✖ 回读：没作答是空数组；别人组那份 403；教师 cookie 401
ℹ tests 17 / pass 15 / fail 2
```

两条反证都已还原，还原后复跑为绿。

---

## 七、D5 那条 concern：「刷新后奖励会消失」—— **同一根因，本次一并解决**

D5 报告里记过 `scores` 只在内存里、刷新即消失。它与本 bug 是**同一个根因**
（客户端不从服务端读回已有状态），水合顺手解决了：

- 新端点下发 `isCorrect`（`boolean | null`）；
- `hydrateAnswers` 用 `scoreFromWire` 把它变成 `scores`；
- `worksheet-panel.tsx` 顶栏的 `rewardTotal` 与每题旁的 `QuestionReward` 都读 `answers.scores`
  ⇒ **刷新后星星/花朵/分数会重新画出来**。

顺带修好的还有两件同样只在内存里、刷新即归零的状态：

- **顶栏进度条 «已交 N/M»**（读 `answers.statuses`）—— 刷新后不再掉回 `0/M`；
- **`✓ 已提交` 芯片**，以及 `allowResubmit: false` 时「已提交的题收起输入控件」那道闸门
  —— 之前刷新后会用**可编辑**的样子显示一道其实改不动的题，学生敲完字才吃一个 409。

⚠️ 一条**没**解决的、如实记下：`isCorrect` 只在 `autoGrade` 打开**且**该题已提交时才有值；
`draft` 状态的题在服务端那一行的 `isCorrect` 本来就是 `null`（`PUT` 的 update 分支会清掉它）。
所以「改了已提交的题、还没重新提交」时刷新，星星会不见 —— 那**不是**丢数据，
而是服务端此刻确实没有这一题的判分。要改得先改 `isCorrect` 的生命周期，本次不动。

---

## 八、验收与约束核对

| 约束 | 结果 |
|---|---|
| 既有测试继续全过 | 前端 135→141、服务端 391→393，**0 红** |
| 不新增 npm 依赖 | 无 `package.json` 改动 |
| 中文提交信息 / 报告 / 注释 | 是 |
| 不 `prisma db push` 打真实库 | 只在 `os.tmpdir()` 下的临时库建过（用例里有断言把门） |
| 同一时刻只有一个 build/test | 是 |
| 根 `pnpm build`：stop → build → start → status | 已按序执行，`./dev.sh status` 复核 client 4000 / server 4001 均在 |
| 不停着 `./dev.sh` 不放 | 只停了 build 那一次，随后已起回 |
| 不碰 `CLAUDE.md` / `dev.sh` / `release.sh` / `package.json` | 未碰 |
| 三件套叫法 | 报告中一律「学习单 · 探究空间 · 智能学伴」 |
| Safari 15 约束 | `pnpm build` 的 `check-classroom-browser-compat.mjs` 通过（27 个脚本 × 59 个源码文件，仅命中既有的 docx 容忍表条目） |

**未纳入提交的既有工作区改动**（不是本次产生的，原样留着）：
`specs/2026-09-23-p1-worksheet.md` 的修改与 `specs/2026-09-23-m4-handoff.md`（M4 得分模型裁定）。
