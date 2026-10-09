# 审计报告 · 2026-10-09（1.6 → 2.0 全量）

**基线**：提交区间 `8e29d18f..83f1ed19`（v1.6.0 → 当前 HEAD，2026-07-15 → 10-09）。
812 提交 / 466 源文件（411 新增）/ +143,412 −7,351。

**方法**：分四批派只读审计员（高风险边界 → 服务端其余 → 学生端 → …），
**每条结论都由 Claude 自己重读代码复核后才写进本文件**；未复核的单独列一节。
测试基线由 Claude 实跑：`pnpm test` client 1487 / server 982，前端 `tsc --noEmit` 退出码 0。

**批次进度**：1（高风险边界）✅ 2（服务端其余）✅ 3（学生端）✅ 4（教师端）/ 5（`src/lib`）/ 6（测试与假绿）**未做**。

---

## A. 已修（提交 `694e25a6`）

| 问题 | 位置 | 说明 |
|---|---|---|
| `manual`（逐题开放）档作答静默消失 | `routes/worksheets.ts` `answerStepAllowed` | 只特判 `open`，`manual` 落进顺序解锁 ⇒ 开放过的题 409（客户端归 `locked`、不重试不提示）、未开放的题反被放行。补 `manual` 档，判据与 `student-view` 共用 `openQuestionsFor` |
| 文心/智谱「停止生成」不生效 | `wenxin/chat.ts`、`zhipuai/chat.ts` | 吞 `AbortError` 返回半截文本 ⇒ `ai-proxy` 的 `aborted:true` 成死代码 ⇒ 半截回答落库+推教师+进 history。改为与 coze 一致 rethrow |
| 混合填空主观空被恒判答错 | `worksheet-questions.ts` `fillBlankWrongIndexes` | 与判分侧（`:443` 只算 `auto` 空）判据分叉 ⇒ 同一响应里整题「全对」而该空「答错」。反馈侧改用同一条：没有答案键就不参与对错 |
| 「只写了字」的笔迹在报告里丢失 | `ink-path.ts`（新增 `inkHasContent`）、`ink-render.ts`、`export-service.ts` | 渲染层 2026-09-30 已修、报表层判据没跟上 ⇒ 印「（这一题没有笔画）」并丢掉已渲染的 PNG（实测 2432 字节）。抽成唯一判据共用 |
| 删学生的后果没说 | `classes/page.tsx`、新增 `classes/student-delete-warning.ts` | 级联删掉该生在**全部课堂（含已结束）**的对话与作答，单人/批量两个弹窗都没说。抽成一份共用文案 |

回归网 +5 个文件；其中两条做过**变异验证**（把旧判据放回去，对应用例确实变红）。

---

## B. 已确认、未修（Claude 自核过代码）

按「静默丢数据 / 不可逆」优先。

**Critical / High**
1. **删学生会级联销毁该生在全部课堂（含已结束）的对话与作答** —— `classes.ts:227` 是裸 `prisma.student.delete`（**紧挨其上 100 行的删班级却有守卫**，`classes.ts:106-113`）；schema 三条外键全 Cascade（`ClassroomStudent.student`、`Message.studentId`、`WorksheetResponse.participant`）。**教师已定：拆成「移出班级」/「彻底删除」**
2. **屏蔽词命中后客户端卡死在「等待 AI」** —— `chat/chat-panel.tsx:562` 落两个闸门，`chat/use-chat-socket.ts:321-335` 的 `shield-warned` 不复位（**其它 11 条**终止路径全部复位 —— 原文写「8 条」，实测 11，见 §G）；`allowStudentStop === false` 时屏幕上没有可点的出口 → ✅ **已修（§G）**
3. **「只写了字」的手写作答在客户端就发不出去** —— `lib/worksheet-answer-value.ts` `isDraftEmpty` 与 `valueFromDraft` 都只看 `strokes`、不看 `texts`；那段专为 `texts` 写的重建代码因此够不到 → ✅ **已修（§G）**
4. **慢网下同一题的改动被在途请求顶掉** —— `worksheet-queue.ts` `dropQueueItem` 只比 `questionId`；`use-worksheet-answers.ts:466/496` 处的快照出队会把学生更新的那条一起删。→ ✅ **已修 + 已补回归网（2026-10-09，见 §F）**
4b. 🔴 **新发现（补第 4 条的网时撞出来的）：「清空」那一支会把在途的那条一起摘掉** —— `use-worksheet-answers.ts:617-623`。学生答了一题（`lastSentRef` 里**没有**它）、停手 1.5s 让 PUT 上路，随后在**这一次往返还没回来**时把这道题删干净 ⇒ `buildAnswerValue` 回 `null`、`lastSentRef[id]` 仍是 `undefined` ⇒ 走分支③ `dropQuestionFromQueue`（**无条件**按题目删）⇒ 队列空了，而那个在途的 PUT **照样落库**。结果：屏幕上空白、库里是旧内容、队列里没有任何一条会去纠正它 —— 与第 4 条同一个病（「看得见的那份 ≠ 交上去的那份」），窗口是**一次网络往返**。第 4 条按 `at` 比之后，这一条**仍在**（它删的不是「那一条」而是「这一题」，语义上正是它要的）。
   修法需要让 `setDraft` 能分辨「从没发出去」与「正在发」—— 今天没有任何东西记着在途的是哪一题（`flush` 取的快照不留痕）；`lastSentRef` 上也有一段注释逐字写着这个歧义（`:307-315`：「可能发出去过、200 丢在路上了」）。属于 hook 内的改动，本仓没有 jsdom ⇒ **改动之前先想清楚它的回归网落在哪**（可把判据抽成 `worksheet-queue.ts` 的纯函数，把在途状态作为入参）。→ ✅ **已修（§H）**
5. **清空画布后旧位图照样交上去** —— `drawing-tool-body.tsx` `update` 保留旧 `image` + `keepsDrawingDocument` 的 `|| Boolean(image)` + `basic-drawing.tsx` 清空不清快照 ⇒ 教师看到学生删掉的那张画 → ✅ **已修（§H）**

**安全 / 访问控制**
6. 学生可读全班通知（含发给别人的私信）—— `index.ts:731` 的 `!req.query.studentId ||` + `classroom.ts:1812-1825` 无 `studentId` 时 `where` 只剩 `classroomId`
7. `/uploads` 静态服务注册在局域网门**之前**（`index.ts:120` vs `:141`）⇒ 关了局域网访问仍可被局域网拉取
8. 托管网页可凭教师 cookie 打主源 API —— `cors({origin:true, credentials:true})`（`index.ts:102`）+ 同 site 跨端口；而 `webapp-sandbox.ts:10-12` 的注释把安全前提写成「够不到教师会话」
9. 掩码可被当新值写回（真实密钥被覆盖成掩码的密文且不报错）—— `agents.ts:386`、`:414-415` 只判「非空字符串」，无掩码识别
10. `maskAgentSecret` 对 9 位密钥露 8 位 —— `agent-secret-policy.ts:19-20`

**数据一致性 / 正确性**
11. `participantCount` 同名字段两个分母 —— `/all`、`/active`（`classroom.ts:724/763`）＝`_count.students`（全部参与者）；`/history/all`（`:1767`）＝`COUNT(DISTINCT studentId) FROM Message`（只数发过言的）
12. 量词「人 vs 组」写死 —— `worksheet-question-stats.ts:435/438/448/…`、`question-stats-overlay.tsx:87`、`matrix-overlay.tsx:610,613`、`worksheet-drawer.tsx:374,420`（**分母是对的，只是措辞**）
13. `worksheet-question-stats.ts:508` 把**位置数**当**人数**说（`full` 可大于分母；`:506-507` 的注释本身就写着「人数」）
14. 桌面壳托盘「启动服务」与 setup 延迟线程可并发出两个 Node —— `lib.rs:623` 不查 `IS_STARTING`（该标志只在 `:477-500` 用），`:394` 覆盖 `ServerState` ⇒ 孤儿进程、停止键失效（**与 `dev.sh` 孤儿同族**）
15. 删班级被永久挡住，而提示指向**不存在的功能** —— `classes.ts:111` 说「请先删除关联的课堂」，全仓无 `DELETE /api/classroom/:id`
16. `io.emit('agent-connection-lost')` / `agents-checked` 全局广播（含学生）—— `socket/index.ts:2164,2168`
17. `captureBlocked` 回放缺前缀守卫 ⇒ 跨课堂把 B 班学生 id 发给 A 班教师 —— `socket/index.ts:1615-1623`（对照 `drain:964` 有守卫）
18. `activeStreams` 以 `socket.id` 为键，同 socket 连发两条互相偷中断槽 —— `socket/index.ts:1993` + `:2173`
19. 学生 token 过期时 REST 端点显示**教师**文案「教师会话已失效，请重新登录」—— `avatar-changer.tsx:73`、`chat-panel.tsx:536,541`（`middleware/auth.ts:64`）
20. 课堂结束这条路径**不断开 socket**（`router.push` 是客户端导航）—— `use-chat-socket.ts:192-196`、`use-classroom-session.ts:268-272` ⇒ 同机两条连接
21. 断线重连**不补拉历史** ⇒ 断线期间的 AI 回答要手动刷新 —— `use-chat-socket.ts:101-116`
22. 身份页确认失败**屏幕上不出现任何文字**（toast 在该页没有宿主）—— `classroom/page.tsx:94-111` vs `:147/184` → ✅ **已修（§G）**
23. 恢复备份后一次性迁移不重跑（`export.ts:670-688`）；备份漏 `webapps/` 目录（`export.ts:471-493`）
24. `index.ts:161-495` 一个大 try/catch 把 schema 对齐失败降级成一行 warn（后面所有新列/新表被跳过）
25. `group-materials-migration.ts:70` 建表无 `IF NOT EXISTS` ⇒ 中途失败后下次启动起不来

**低 / 环境**
26. `webapp-host.test.ts:97` 把 `CLASSNODE_DATA_DIR` 写成固定 `/tmp/cn-data-dir`（既往报告已记「不得当它已解决」，**仍未修**）
27. `drainWebappMonitor` 是破坏性的、调用方「先取走再写库」、失败只打日志（`classroom.ts:1246-1251`）⇒ 统计静默丢失（测试里可复现 `database is locked`）
28. `file-logger.ts:25-27` 无大小上限、无轮转；`agents.ts:393-398` 一条 400 分支漏清理上传的 logo；`agent-checker` 的 `Promise.all` 被一个卡住的上游拖住整批；`moduleFocus` 学生 disconnect 不清（6h TTL）；`unwatch` 无条件删整个课堂的 focus；`worksheet-draft-preview` 无上界/无限流；导出 CSV 公式注入（前端零调用点）；`export-doc` 的 blob 下载锚点不入 DOM + 同步 revoke（老 iPad Safari）
29. **`src` 源码里无正则后向断言等 Safari 15 禁用写法**（三个审计员各自 grep 源码确认零命中）—— 这是**源码级**结论；构建期闸门扫的是上次产物
30. **`ping`**：每次启动向硬编码 IP **明文**上报持久设备 ID + 智能体计数；`CLAUDE.md` 写 opt-in、`index.ts:816` 注释写「需先配置 `ping_url`」，而全仓无该设置读取，唯一门是 `NODE_ENV==='development'`。→ **教师已定：整个删掉**

---

## C. 审计员报过、**Claude 未自核**（不背书）

统计口径「总交互轮数」在对话记录 docx 与学情报表里是两个数；报告「判定」列与看板对主观题判分不一致；分析 `run` 端点无并发闸且 `perStudent` 是读-改-写合并；`fetchWithTimeout` 不覆盖 body 读取；
iPad 上排序条目「想滚动」被判成拖动并静默改答案（`worksheet.module.css:1132` + `use-pointer-drag.ts`）；
tool 分流台账：`drawing-tool-body.tsx:89-95`、`worksheet-drawing-document.ts:49-55` 是「显式 3 档 + else 兜底」⇒ 加第 5 档会被静默吸进兜底；
`ink-body.tsx:186` 的分派判据与 `isDraftEmpty` 口径相反；流式渲染每帧全量重解析（O(n²)）；`isComposing` 单判据（同仓别处是 `|| keyCode===229`）；`markdown.tsx:92-103` 未转义 `<img>` 回填（**今日零引用，潜伏**）；探究空间头 15 秒无提示、内层滚动恒报 0%；入口页断网显示浏览器英文原文；身份页搜索框 14px 触发 iOS 缩放。

---

## D. 教师拍板的四条（2026-10-09）

1. **填空题简化**：所有空都不涉及 AI 评分；主观内容走**问答题**。删 `'ai'` 与 `'none'` 两档；老 AI 空按「不算分」+ 编辑器提示。改动面五处（见记忆 `audit-2026-10-09-teacher-decisions`）。⚠️ `aiScoringEnabled` 本身不能删。
2. **删学生拆两个动作**：「移出班级」只动名册不动历史；「彻底删除」保留级联行为并写明。
3. **`ping` 整个删掉**。
4. **隐私例外照旧**：`proxyAnalysisRequest` 继续发「姓名+学号」，**代码不动**，改 `CLAUDE.md` 那句（它至今写着「no AI provider ever receives a student's name」）。

---

## E. 下一步（接续顺序）

1. ~~给「在途出队」补竞态回归网（先写会红的），跑红→绿~~ ✅ 2026-10-09 完成，见 §F
2. ~~批次 B ① 剩四条~~ ✅ **全部完成**（三条见 §G，清空画布 + 4b 见 §H）
3. `ping` 整个删 + 改 `CLAUDE.md`
4. 填空题简化 · 删学生拆分
5. 开**批次 4（教师端 `src/app/teacher/**`）**，再 `src/lib` 105 文件、测试与假绿

---

## F. 2026-10-09 续做（§E 第 1 步）：在途出队的竞态回归网

**先说结论：上一轮那处「代码已改」只改了签名，行为一个字没变。** 补网时第一条用例当场红：

```
node --test src/app/classroom/worksheet/worksheet-queue.test.ts   # 红：actual [] / expected [200]
```

`dropQueueItem(items, item)` 当时仍是 `items.filter(existing => existing.questionId !== item.questionId)`
—— 注释写着「判据必须连这一条编辑的身份一起比（`questionId` + `at`）」，代码只比题目。
学生更新的那一条照旧被删掉（屏幕新、库里旧、不报错）。改为按 `questionId + at` 比之后转绿。
⇒ **这是「注释写的判据 ≠ 代码做的判据」的又一例**，也是「代码已改」不能当「已验证」的实证。

**做了什么**
- `worksheet-queue.ts`：`dropQueueItem` 改为身份比对（`questionId + at`）；注释补上这条**假定**
  （同一题两次入队不会落在同一毫秒）与「与 `dropQuestionFromQueue` 不许再合回一个」。
- `worksheet-queue.test.ts` 新增第 **2b** 节共 4 条：主用例（快照在途 + 学生又改同一题）、
  阳性对照（还是那一条必须照常出队、不牵连别的题）、两函数必须**分岔**、反向断言（旧形状必红）。
- 变异验证两条：① 把旧判据放回去 ⇒ 3 条红（补网之前实测）；② 改成「永不删」⇒ 4 条红
  （证明阳性对照不是摆设）。

**实测（同一次会话内）**
| 命令 | 结果 |
|---|---|
| `node --test src/app/classroom/worksheet/worksheet-queue.test.ts` | 35 → **39 pass / 0 fail** |
| `pnpm test:client` | 1487 → **1491 pass / 0 fail** |
| `pnpm test:server` | **982 pass / 0 fail** |
| `npx tsc --noEmit` | 退出码 **0** |

**遗留**：§B **4b**（新发现，「清空」那一支摘掉在途条目）未修，已并入 §E 第 2 步。

---

## G. 2026-10-09 续做（§E 第 2 步的前端三条）：屏蔽词死路 / 只写字交不出去 / 身份页无提示

**三条都改了产品行为，都先写了会红的用例。**

### G1 · 屏蔽词命中后没有出口（§B2）
证据链（本次重读）：服务端 `socket/index.ts:1829` 发 `shield-warned` 之后**直接 `return`**，
不调用 AI；客户端 `chat/use-chat-socket.ts` 的 `shield-warned` 处理器只弹提示、不收闸门
⇒ `waitingAI` / `sendingRef` 一直挂着；`chat-panel.tsx:956` 那个三元在
`allowStudentStop === false` 时把发送键换成 `disabled` 的发送键（输入框也 `disabled`）
⇒ **屏幕上没有任何出口**，只能刷新。
**修**：在该处理器里补上 `sendingRef.current = false; setWaitingAI(false);`（与另外 11 条同款）。
**网**：新增 `chat/waiting-gate.test.ts`（4 条）——按 `socket.on('名'` **切块**扫，
逐条列出 12 条「这一轮到此为止」的事件名；切块而不是全文扫是关键的：
全文扫时「12 处少 1 处」永远看不见。另有阳性对照（`ai-thinking` / `ai-chunk` 不许碰闸门）。
**变异验证**：① 补网前实测 2 条红，缺失名单里**只有** `shield-warned`；
② 事后把 `agent-disabled` 的复位删掉 ⇒ 名单精确点名 `agent-disabled`。

### G2 · 只写了字的笔迹交不出去（§B3）
`isDraftEmpty` 与 `valueFromDraft` 各写了一份「有没有内容」，且**两份都只看 `strokes`**
⇒ 学生用画布的文字工具写一段话、一笔没画：「提交本题」按不动，而 `valueFromDraft` 里
那段专为 `texts` 写的重建**永远够不到**（渲染层与报表层 2026-09-30 已经认了这份作答）。
**修**：抽成**一条**判据 `inkDraftHasContent`（`lib/worksheet-answer-value.ts`），两处共用；
判据里 `texts` 的过滤条件**逐字照抄** `valueFromDraft` 的过滤（`typeof === 'string' && !== ''`）——
放宽成「数组非空」会让一条 `{ text: '' }` 交上去一份**空作答**。
**网**：`worksheet-answer-value.test.ts` 新增 3 条，其中一条断
「`isDraftEmpty` ⟺ `buildAnswerValue === null`」**同进同出**，并额外断「交出去的那个值
**确实有内容**」。
**变异验证**：① 旧判据 ⇒ 红；② 只把 `valueFromDraft` 的过滤改成 `trim()` ⇒
**这一版抓到了**（这一条最初写漏了，是变异跑出来的：非 `null` 但里面什么都没有）。

### G3 · 身份页没有提示的宿主（§B22）
`handleIdentityConfirm` 失败会 `setToast`，而 `step === 'identity'` 那一支只渲染 `<IdentityPicker>`
⇒ 学生点「进入课堂」之后屏幕上不出现任何文字。**修**：那一支补渲染共用宿主 `ClassroomToast`
（关闭即清会话级 toast、3 秒计时器都在它里面）。**网**：新增 `identity-toast-host.test.ts`（2 条），
另一半断「失败那条路真的会产生提示 + 放开 `joiningRef`」。

### 顺手改正的
- §B2 原文说「其它 **8 条**终止路径全部复位」，按文件实测是 **11 条**（用例里逐条列了名单）。
- 报告里的路径少两层：`chat-panel.tsx` / `use-chat-socket.ts` 在 `src/app/classroom/**chat/**`，
  `ink-path.ts`（`inkHasContent`）在 `server/src/services/`。**动手前先按路径解析一遍**——
  这三条我核实时有两条按原文路径 `find` 是零命中。

### 实测（同一次会话内）
| 命令 | 结果 |
|---|---|
| `pnpm test:client` | 1491 → **1500 pass / 0 fail** |
| `pnpm test:server` | **982 pass / 0 fail** |
| `npx tsc --noEmit` | 退出码 **0**（首轮抓到我自己新用例里 2 个类型错，已修） |
| `npx eslint <本次改动的 6 个文件>` | 无输出 |

⚠️ 三条修的都是**接线**：本仓没有 jsdom，`waiting-gate` / `identity-toast-host` 两个网
扫的是源码结构（照 `last-module-storage.test.ts` 的既有姿势），**真机行为仍未验** ——
待验清单：① 关掉「允许学生停止生成」后发一条命中屏蔽词的话，输入框与发送键要能再用；
② 断网后在身份页点「进入课堂」，屏幕上要出现一句人能看懂的话；
③ 画布上只写字不画笔画，「提交本题」要能按。

**遗留（§E 第 2 步还剩）**：§B5（清空画布后旧位图照样交上去）、§B **4b**（「清空」那一支摘掉在途条目）
→ 两条已在 §H 做完。

---

## H. 2026-10-09 续做（§E 第 2 步的剩下两条）：清空画布 / 在途条目

### H1 · 清空画布后旧位图照样交上去（§B5）
**链路**（重读确认）：四个画板的「清空」**都**汇到 `drawing-tool-body.tsx` 的 `update`
（各自 `onChange(空数据)`），而它无条件把上一张快照带过去 ⇒ `data` 空了、`image` 还是那张
**画着学生刚删掉的东西**的图；`keepsDrawingDocument` 认「有快照」也算一份作答 ⇒ 那份照样落库，
教师看板 / AI 联系表 / Word 报告里全是学生已经删掉的那张画。
**修**：判据抽成 `keepsPreviousImage(previous, tool, data)`（`lib/worksheet-drawing-document.ts`），
放在 `update` 一处（四个工具一条路，正是该放的地方）。
判据分两半，**两半都不能少**：清空 ⇒ 作废；其余（正常改动 / 他本来就什么都没画）⇒ 留着 ——
后者是 2026-10-07 修好的那一档（学生还没动笔时，底稿**只**存在于快照里）。
**网**：`worksheet-drawing-document.test.ts` 一条四格表 + `drawing-tool-body.test.ts` 一条接线。

### H2 · 「清空」那一支摘掉在途条目（§B4b）
**修**：判据抽成 `emptyEditAction({ confirmed, inFlight, pending })`
（`worksheet-queue.ts`，三档：`enqueue-clear` / `drop-pending` / `nothing`），
`setDraft` 只分派；`flush` 在 `await putAnswer` **之前**把这一条记进 `inFlightRef`、
在 `finally` 里清掉。
**网**：`worksheet-queue.test.ts` 第 2c 节两条 + 新增 `answer-inflight-wiring.test.ts`（2 条，接线）。

### 变异验证（本次五条网逐条跑过）
| 变异 | 结果 |
|---|---|
| `keepsPreviousImage` 退回「永远留着」 | H1 的纯用例红 |
| `emptyEditAction` 去掉 `\|\| state.inFlight` | 2c 两条红（且**只有**这两条） |
| 接线网：`inFlightRef` 记号 / `setDraft` 用判据 | 补网时实测红（功能不存在） |

### 顺手修掉的一处**我自己引入的**告警
`update` 里改用 `keepsPreviousImage(drawingDocument, …)` 之后，`react-hooks/exhaustive-deps`
报「missing dependency: 'drawingDocument'」（**HEAD 版本无此告警**，用
`git show HEAD:<file> \| npx eslint --stdin --stdin-filename <file>` 对照确认）。
没有把 `drawingDocument` 加进依赖（那一份每次作答变化都换新对象 ⇒ `onChange` 会跟着换身份，
四个第三方画板的依赖不在这一层手里），而是照本仓 `worksheetIdRef` / `answersLockedRef` 的写法
镜像进 `documentRef`，依赖收回 `[box, onChange, tool]`。

### 实测（同一棵树上）
| 命令 | 结果 |
|---|---|
| `pnpm test:client` | 1500 → **1506 pass / 0 fail** |
| `pnpm test:server` | **982 pass / 0 fail** |
| `npx tsc --noEmit` | 退出码 **0** |
| `npx eslint <本次全部改动文件>` | 无输出 |

⚠️ 仍是**接线**：H1 的行为要人工验「画一笔 → 清空 → 教师看板/报告里那张画要变空」；
H2 要人工验「慢网下答一题、趁保存还在路上删干净 ⇒ 服务端也被清空」。
H1 的纯判据那一半是硬的（真值表 + 变异）。

**至此 §E 第 2 步全部完成。** 下一步按 §E 第 3 步：`ping` 整个删 + 改 `CLAUDE.md`。
