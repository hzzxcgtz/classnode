# 文档一致性审计 · 修复报告

> 日期：2026-09-23 · 分支 `feat/p1-worksheet`
> 范围：审计清单第 1–14 条。**每一处都先自己核过代码再改**；判决权在代码。
> 🔴 按任务要求**跳过 C1 条**（它在 `src/app/teacher/classroom/page.tsx` 里，另一个任务正在改那个文件）。

## 门禁实测（动手前 / 动手后）

| 门禁 | 命令 | 动手前 | 动手后 |
|---|---|---|---|
| 类型 | `npx tsc --noEmit` | 退出 0 | **退出 0** |
| Lint（限定范围） | `npx eslint src/app/teacher/worksheets/edit/` | — | **退出 0，0 problem** |
| 前端测试 | `pnpm test:client` | 117/117 pass | **117/117 pass，0 fail** |
| 服务端测试 | `pnpm test:server` | 390/390 pass | **390/390 pass，0 fail** |

> ⚠️ **与审计给的基线数字（107 / 385）不同** —— 因为**并行的另一个任务正在往测试集里加用例**
> （服务端已从 385 涨到 390）。按「动手前现测」的口径记这里的实测值，不对齐审计的旧数字。
> ⚠️ 按约束 6 **没有跑根目录 `pnpm build`**（另一个任务在用）。本次改动只含文档与两处文案，
> `tsc` + 限定范围 eslint 已覆盖编译期风险。
> ⚠️ 按约束 4/5 **没有跑 `prisma db push`**、**没有停 `./dev.sh`**。

---

## 1. 规格 §5.1 —— 学生怎么知道自己是哪一份（严重）

**改了什么**：把「随 `groups[].materials.worksheet` 与 `join-classroom` 一起下发」整段重写成
「随模式走两条路」的表格 + 三条更正说明 + 一条 🔴「学生端不得只依赖 `joined`」。

**代码在哪一行证明新说法是对的**：

- `server/src/routes/classroom.ts:1050` —— `groups:` 的三元表达式是
  `(classroom.mode === 'advanced' || classroom.mode === 'group') ? … : undefined`
  ⇒ **`standard` 模式下 `groups` 就是 `undefined`**（旧文说它「一起下发」是错的）。
- `server/src/services/group-material-resolve.ts` 的 `resolveMaterialTargetId()` ——
  非 `advanced` 时 `return input.classroomLevelId` ⇒ **`group` 模式下组级 `worksheet` 恒为 `null`**。
- `server/src/socket/index.ts:1143-1155` —— `joined` 载荷是
  `{ classroomId, agents, groups, blacklisted }` ⇒ **只有 `groups[]`，没有课堂级 `worksheets[]`**。
- `src/lib/classroom-material.ts:118-120` ——
  `if (classroom.mode === 'advanced') return ownGroup(...)?.worksheet ?? null;
   return classroom.worksheets?.[0] ?? null;` ⇒ **两条路的真实来源**。
- 服务端自己的注释（`routes/classroom.ts:190-198` 的 `loadClassroomWorksheets` 文档注释）
  逐字写着同样三条 —— 我改后的规格与它一致。
- 实测：`grep -rn "joined" src/ | grep -v socket-events.ts` ⇒ 只剩注释里的提及，
  **学生端不监听 `joined`**（面板读 `GET /code/:code`）。这与我写进规格的 🔴 那条一致。

**顺带**：`groups[].materials.worksheet` 这个**嵌套形状名**本身也是错的（实际是扁平的
`groups[].worksheet`）。我把这个更正也写进了规格，并**同步修掉两处仍在传播这个名字的服务端注释**：
`server/src/routes/classroom.ts:196`（原「只有高级模式能靠 `groups[].materials.worksheet` 拿到学习单」）
与 `:1026`（同一句的复制）。这两处是同一个缺陷类（散文声称了一个不存在的形状），
而 `routes/classroom.ts` 本次**没有别的任务在动**，属于顺手且零风险。
验证：`grep -rn "materials\.worksheet" server/src/` 现在只剩那两条**纠正性**的提及；`tsc` 退出 0。

---

## 2. 规格 §6.4 + 两处代码文本 —— 顶栏那句假话（严重）

**改了什么**（四处）：

1. `specs/2026-09-23-p1-worksheet.md` §6.4 的横幅示例：
   `保存后学生端会立即看到变化` → **`学生需刷新或重新进入学习单才能看到新内容`**，
   并加了一段更正说明（含「警告本身要保留」的明确指示 + 待定项指针 §13-7）。
2. `src/app/teacher/worksheets/edit/page.tsx:167`（逐字渲染那句的 JSX）同上改掉。
3. `src/app/teacher/worksheets/edit/use-worksheet-editor.ts:257` 那段**把它当作理由**的注释
   （原「顶栏那句警告说的是「保存会立刻传到学生端」」）改成正确理由，并写明
   **为什么不能因为后半句改了就顺手删掉这次 `/usage` 刷新**（它只关系「几堂课在用」那一半）。
4. §3-J 的悬空指针 `见 §13 待定项` → `见 §13-7`，并**在 §13 补上第 7 条**（不是去掉指针）。

**代码在哪一行证明新说法是对的**：

- `grep -a -c "emit(" server/src/routes/worksheets.ts` ⇒ **1**，
  即文件里唯一的 `emit` 是 `broadcastAnswerUpdate` 里的 `worksheet-answer-updated`（发给 `teacher:<id>`）。
  `PUT /api/worksheets/:id`（教师保存内容）**一个 socket 事件都不发**。
- `src/app/classroom/worksheet/worksheet-panel.tsx` 只在挂载时拉一次 `student-view`
  （D2 报告的 concern 2 已核实，我复核了面板的数据来源注释）。
- 「警告本身仍然成立」的依据：`/usage` 数的是 `ClassroomWorksheet` +
  `ClassroomGroupMaterial(kind='worksheet')` + 历史 `WorksheetResponse`（规格 §5.5 三项），
  与内容变更有没有广播**无关**。
- 验证：`grep -rn "立即看到变化\|保存后学生端" src/ server/src/tests/` ⇒ **零命中**（含测试）。

---

## 3. 规格 §7.2 第一态 —— 与代码不一致（严重）

**改了什么**：§7.2 的「四种状态」表第一行由
`还没开始 | 还没有开始作答 + 全灰方格阵` 改为
`还没收到作答 | 还没收到作答 + 第二行「打开看板后的新作答会实时显示」。不画方格阵`，
并在表下补了一段 **🔴 「代码是对的」** 的理由块（端点事实 + 为什么写「还没开始」是编假事实 +
为什么画方格阵更糟 + **「不要把它改回去」** + 「回到那一态需要的是新端点，不是改文案」）。

**代码在哪一行证明新说法是对的**：

- `src/app/teacher/classroom/worksheet-tiles.tsx` 的 `case 'no-progress':`
  → `placeholder('还没收到作答', '打开看板后的新作答会实时显示', compact)`；
  且该分支**不渲染** `state.cells` 的方格阵（方格阵只出现在
  `case 'working' / 'stuck' / 'all-submitted'` 那一支）。
- `src/app/teacher/classroom/worksheet-tile-state.ts:131` ——
  `if (!cells.some((status) => status !== 'unanswered')) return { kind: 'no-progress' };`
- `src/app/teacher/classroom/worksheet-tile-state.ts:77-82` —— 状态机自己的注释写着
  「`no-progress` 与规格里那个「还没开始」**不是同一句话**，这是刻意的…
  看板没有拉取历史的 REST 端点…所以这里说的是能确证的那一句」。

**顺带（超出清单一条，请裁定）**：§7.2 的示意图里徽章写的是 `已看 2/3`，
而 D3 落地的是 **`已交 N/M`**（§3-I 已更正过标签，但示意图没跟上）。
我在示意图那行加了脚注指向 §3-I 并说明「N/M 里的 N 取同一批答案行上算得出来的那个数」。
**没有**动 §7.4 的数据来源表里 `已看 N/M | WorksheetAnswer.reviewedAt` 那一行 ——
它属于「缺教师端读端点」那件事（第 4 条），等端点落地后一并回填更合适。

---

## 4. 规格 §5.3 —— 缺教师端读端点（严重）

**改了什么**：§5.3 的接口清单里加了一行**占位**（在「作答」那一组的下面），
写明**「教师端按课堂读作答全貌（逐题答案 / 对错 / 正确率 / 已查看）」**，
并标注 **「形状以实施结果为准，落地后回填」**（路径、查询参数、载荷字段三样一起补），
外加一句 **「不要照本行去猜路径」**。

**没做什么（按任务要求）**：**没有发明端点路径**。
（说明：此刻工作区里确实已经能看到并行任务正在加的 `router.get('/classroom/:classroomId/answers', …)`，
但它是**未提交**的进行中改动，写进规格会与实现打架，所以按指示只留描述性占位。）

**代码在哪一行证明「缺」这件事**：
`grep -n "router\.\(get\|post\|put\|delete\)" server/src/routes/worksheets.ts`
列出的教师端形状只有 `/` · `/:id` · `/:id/usage` · `/:id/review`（review **只写不读**），
**没有任何一条教师端读答案行的路径**。这正是 §7.3 / §7.4 那四样数据今天拿不到的原因。

---

## 5. 规格 §13-2 / §3-AG —— `page.tsx:1454`/`:1146` 那张卡已撤走（严重）

**改了什么**：§13-2 的标题由「顶部「此刻各模块人数」…」改为「「各模块人数」…」，
正文把引用从 `page.tsx:1454` / `:1146` **改为指向「模块筛选行」**，
并**如实标注「组数 / 人数」这个缺陷本身「本次没有复查 / 未复验」**，同时写清复验需要什么
（实际开一个分组/高级模式的课堂看那一行的数字与标签）。§3-AG 的指针改为 `§13-2`，
并补了「那张卡已被撤走，本条未复验」的括号注。进度表的「阻塞与待定」同一条也补了「未复验」。

**代码在哪一行证明新说法是对的**：

- `src/app/teacher/classroom/page.tsx:1853-1858` —— 注释逐字：「这张卡**曾经**也显示
  「此刻各模块人数」…那些数字搬到了看板上方的**模块筛选行**…而此刻这张卡已经没有别的内容可显示」。
- `src/app/teacher/classroom/page.tsx:215` —— 「模块筛选行里的一个胶囊（原「此刻各模块人数」里的一个计数块）」。
- 现在的界面元素：`page.tsx:2053` 的 `aria-label="按模块筛选"` 那一行（六个 `ModuleCountChip`）。
- **「未复验」三个字是克制的**：那一行用的是 `students.length`（`page.tsx:2064` 附近），
  而分组/高级模式下 `ClassroomStudent` 一行是一个**组**（§1.2）⇒ 它**可能**仍然成立，
  但这需要实际打开一个分组模式的课堂才能判定，我**没有**做这个判定，所以只写「未复验」。

---

## 6. 规格 §10.1 —— 列表页去掉「预览」

**改了什么**：§10.1 的「教师列表页（卡片网格 + 使用量守卫 + 复制一份 + 预览）」删掉「+ 预览」，
并在代码块下加一句短注说明**预览只在编辑器里**（所以别照着加回来）。

**代码在哪一行证明新说法是对的**：
- `grep -c "预览" src/app/teacher/worksheets/page.tsx` ⇒ **0**。
- `src/app/teacher/worksheets/worksheet-card.tsx:23` —— 「网页那张卡的主动作是「预览」（一个弹窗），
  学习单这张是**跳转到编辑器**」。
- 编辑器那一份：`src/app/teacher/worksheets/edit/page.tsx` 顶栏有「预览」按钮（§6.3）。

---

## 7. 规格 §8.4 —— 补 `allowResubmit: false` 的契约

**改了什么**：§8.4 表格新增一行「设置 `allowResubmit` 为**假**，学生改已提交的题 | 🔴 服务端回 `409`，
且库里那行一个字节都不动」，并在表下补了一段三条的契约说明，
**明确点出这是跨端契约**：① 服务端 409（不是 400）且闸门排在 `ensureResponse` 之前；
② 学生端 `worksheet-queue.ts` 的 `isPermanentFailure` 按 `4xx ⇒ 丢弃 / 5xx 与网络错误 ⇒ 重试` 分流，
409 走的正是「丢弃」那一支；**改一边就要看另一边**，并写明只改一边的两个静默后果；
③ 界面侧「控件收起 + 换成一句话」的第二层。

**代码在哪一行证明新说法是对的**：
- `server/src/routes/worksheets.ts:1046` ——
  `return res.status(409).json({ error: '老师已设置本题提交后不可修改' });`
  同文件 `:1026` 的注释：「用 **409**（Conflict）…**不是 400**」。
- `src/app/classroom/worksheet/worksheet-queue.ts` 的 `isPermanentFailure()` ——
  `if (status === null) return false; return status >= 400 && status < 500;`
  以及它上方那段 🔴 注释，逐字点名「**4xx（含 `allowResubmit: false` 的 409）⇒ 永久失败，丢弃**」。
- `worksheet-queue.ts` 的 `permanentFailureMessage()` 里那条 `if (status === 409)` 分支的文案，
  与服务端返回的 `error` 一致。

---

## 8. 规格 §14.1 —— 「M5（手写）」是旧编号

**改了什么**：§14.1 的 `第一批到 M5（手写）之间不要拖太久` → **`第一批到 M4（手写）`**，
并加注说明手写已并入 M4、**现在的 M5 是「看板与课堂控制」**、编号单一来源是 milestones 总表。

**代码/文档在哪一行证明新说法是对的**：
`specs/2026-09-23-milestones.md:68-72` —— M4 的条目里明列「手写笔迹 · 绘图题」与
「Canvas 手写层（手写 / 绘图 共用）」；`:74-78` —— M5 = 「学生 × 题目矩阵 · 锁定作答 · 逐题投放 ·
顶部「人数 / 组数」文案」。与规格 §12 那张历史表（「~~M5~~ 已并入 M4」）也对得上。

---

## 9. 规格 §1 的过期「今天」类事实（6 处）

**改动原则**：**保留原文 + 逐条加「何时过期」的引用块**，不假装从没写错。

| # | 位置 | 原文（保留） | 更正块写了什么 |
|---|---|---|---|
| 1 | `2026-09-23-p1-worksheet.md` §1.1 | 「今天**没有任何地方**写 `kind='worksheet'`」 | **前半句已过期**（B2 落地后即写）；**后半句仍成立**（`Classroom.worksheetId` 至今不存在） |
| 2 | 同上 §1.1 | 「`kind` 联合类型今天是 `'agent' | 'webapp'`」 | **已扩成** `'agent' | 'webapp' | 'worksheet'`；并记「当时说「是一处改动」，这个估计是对的」 |
| 3 | 同上 §1.5 | 「`worksheet: 0` 是**硬编码**的」 | **两处已是真数字**；并提醒行号已漂、按符号名找 |
| 4 | `2026-09-22-p2-group-materials.md` §1.1 | 「学习单 \| 无模型（固定传 `worksheet: 0`）\| ❌ 尚未实现」 | 整行不再成立（四张表已建 + kind 已在写 + 计数已是真数字） |
| 5 | 同上 §4.3 | 「`worksheet` 仍为 0」 | 同上（第三项也改成了真数字） |
| 6 | `2026-09-19-…-design.md` §4.4 | 「学习单 \| `Classroom.worksheetId`（P1 一对一）」 | **这个列从来就不存在**；实际是关联表 + 组级材料行 |

**代码在哪一行证明新说法是对的**：

- 1（`kind='worksheet'` 已在写）：`server/src/routes/classroom.ts:110` / `:289` /
  `:362` / `:538` / `:587`（高级模式那个 `for (const [kind, targetId] of …)` 循环里就有
  `['worksheet', group.worksheetId]`）。
- 1 的反证（`Classroom.worksheetId` 不存在）：`grep -n "worksheetId" server/prisma/schema.prisma`
  ⇒ 只命中 `ClassroomWorksheet` 与 `WorksheetResponse` **两张子表**，`Classroom` 上没有该列。
- 2：`server/src/services/group-material-resolve.ts` 的 `kind: 'agent' | 'webapp' | 'worksheet'`。
- 3：`server/src/routes/classroom.ts:372` `worksheet: worksheet.id ? 1 : 0`（标准/分组）与
  `:554` `worksheet: normalizedGroups.filter((group) => group.worksheetId).length`（高级）。
- 4 / 5：同上两条；`resolveGroupMaterialViews()` 今天查**三条** `in`（agent / webapp / worksheet），
  `GroupMaterialView.worksheet` 是 `{ id, title } | null`。
- 6：`schema.prisma` 的 `ClassroomWorksheet(classroomId, worksheetId)` +
  `ClassroomGroupMaterial(kind='worksheet', targetId)`。

**⑤ 我核出 3 处而不是审计说的 2 处**：`p2-group-materials.md` 里除了 §1.1 那一行与 §4.3 那一句，
**§4.5 的代码块还把形状写成 `materials: { …, worksheet: null }`** —— 它既是同一个「学习单尚未实现」
的残影，**又把嵌套形状写错了**（实际是扁平的 `groups[].worksheet`，
`classroom-material.ts` 的注释逐字记着「那种嵌套形状**没有落地**」）。我一并加了更正块。

---

## 10. `specs/2026-09-23-milestones.md` —— D3 已完成

**改了什么**：
- D 组那一行：`D1 D2 ✅ · **D3 🔄** · D4 D5 ⬜` → `D1 D2 D3 ✅ · **D4 🔄** · D5 ⬜`
- 「离收口还差 **4** 步：**D3**（在跑）· D4 · D5 · E1」 → **「还差 3 步：D4（在跑）· D5 · E1」**，
  并加注 D3 的提交号 `c17f48d` 与当时跑绿的门禁。
- 「三件套的当前状态」表：学习单那一行 → 学生端 `D2/D3 已做，待真机验`；教师看板 `D3 已完成（c17f48d）；D4 在跑`。

**证明**：`git log --oneline -1 c17f48d` ⇒ `c17f48d feat(teacher): 看板格子的学习单内容区`
（就是本次的 HEAD 附近）；D3 报告的门禁段实测：`tsc` 退出 0 · 前端 107/107 + 服务端 385/385 ·
`pnpm build` 退出 0 · 产物里 `grep` 到「还没收到作答」。
同时 D4 在跑有两处独立证据：工作区有 `evidence-d4/` 目录，且 `server/src/routes/worksheets.ts`
有**未提交**的 +152 行改动（内含那个教师端读端点）。

---

## 11. `specs/2026-09-23-p1-worksheet-progress.md` —— 整表过期

**改了什么**（整段重写「一眼看」+ 进度表 + 门禁基线）：

- 「现在」：`⏸️ 已暂停（C1 跑完停）` → **`🔄 D4 在跑`**
- 「恢复时第一步」：`跑 C 阶段审查门（覆盖 C1）` → **`等 D4 落地 → D4 审查门 → 进 D5`**
- 「要你拍板的」：那条「列表页**没有入口**」标为 **✅ 已解决**，并指向 ledger 的 D3 段里
  **两条真正待裁的**（徽章「已交」vs「已看」、第一态文案 —— 两条同源：缺历史读端点）
- 进度条：`C 1/3` → **`C 3/3 ✅`**；`D 0/5` → **`D 3/5 🔄`**；总分 **`7/15` → `10/15`**
- 进度表：C1/C2/C3/D1/D2/D3 逐条填上**真实提交号**，D4 标 🔄 在跑
- 门禁基线：服务端 `367` → **现测 `390 pass / 0 fail`**；前端 → **`117/117`**；
  `pnpm build` 与 `./dev.sh status` 由「待测」改成**实测值**（D1 时发现 build 在 HEAD 上是红的、
  根因是一条 CSS 额度被 C1 用超、控制器修掉后复测绿）
- 「暂停交接」那一节**保留原文**并加注「已被逐条完成」
- 新增一条 ⚠️ 说明：**D1 / D2 的「✅」只覆盖自动化门禁，不覆盖真机**，并写明**为什么保留那句话**

**证明**（每条都实测过，不是抄审计）：

- 侧边栏入口**已加**：`grep -n "worksheets" src/app/teacher/layout.tsx` ⇒
  `20:  { path: '/teacher/worksheets', label: '学习单', icon: 'clipboard' },`
- C1/C2/C3 完成且过审：ledger 的「阶段 C 收口 —— **Approved，无 Critical**」那一节
  （`Task C1 / C2 / C3: complete (review Approved)`），提交 `7ca3391` / `26780e1`…`d954b0b` / `729f5a8`+`2d59b16`
- 10/15：A2 + B4 + C3 + D3 = 15 项里完成 10 项（A1 A2 / B1 B2 B3 B4 / C1 C2 C3 / D1 D2 D3）
- 测试数字：本次现测 `117/117` + `390/390`（命令与输出见本报告开头的门禁表）

---

## 12. ledger（`.superpowers/sdd/2026-09-23-p1-worksheet-plan/progress.md`）—— 停在 D1（最重要的一条）

**问题**：ledger 是「上下文丢了之后靠它恢复」的**唯一凭据**，而它此前**只记到 D1**；
D2 与 D3 的完成、偏离、裁定**一条都没有**。下一个人读它要么以为还欠着 D2/D3，
要么**完全不知道 D3 已经把两处规格文字改掉了** —— 而那两处**正是最容易被「改回去」的**。

**补了什么**（在原文件末尾追加一节「🔴 补记 D2 与 D3（2026-09-23，文档一致性审计时回填）」，
466 行 → 577 行）：

1. **开头一句为什么补** —— 说清「不补的代价是下一个人会改回去」。
2. **Task D2: complete** —— 提交 `47bcbff` + `5e57ddb`；交付物清单；
   **两处报告外改动**（compat allowlist 加 `dvh×3` 额度、`module-placeholder.tsx` 保留文件把
   `moduleId` 收成 `never`）连同各自的**理由与反证**；
   **7 条 concern 逐条现状**（哪条已解、哪条至今没变）；
   **关键实测**（4 条反向断言、2 条编译期闸门探针、`grep -rn "joined" src/` 零命中）。
3. **Task D3: complete** —— 提交 `c17f48d`；**两处规格外改动**（`socket-events.ts` 补事件类型声明、
   `types.ts` 补 `worksheets?`）；**两处「偏离规格文字」的裁定**
   （已交 N/M；还没收到作答 + 不画方格阵），两条都写明**根因是「没有拉取历史的端点」**
   以及**「只能靠数据源改，不能只改文案」**；**4 条 concern 逐条现状**（其中「历史的洞」
   标为「→ 正在做」，并指向规格 §5.3 的占位行）。
4. **📌 恢复时从哪继续** —— 替换掉原先停在 D1 的那句：明写 **D4 在跑 / D1–D3 已完成**、
   还差 3 步（D4 · D5 · E1）、以及 D4 若补上读端点则 D3 那两处偏离的**根因一并消解**
   （届时再定是否换回「已看」/「还没开始」，并强调**两处都只能靠数据源改**）。
5. **未验清单** —— D1 / D2 / D3 各自做不了的真机项列成一张单，并写明
   **「先例：D1 的处置方式就是标准」**（不标绿、写「需要用户执行」、给逐步操作），
   且点明 **E1 的端到端那一条照这个来** —— 这一条与第 14 条是同一个决定的两半。

---

## 13. `task-D5-brief.md` —— 落后于计划

**改了什么**：把 brief 的 Step 2 代码块**换成计划里的逐字版本** ——
由「显示值 = `isCorrect ? step : 0`」改为**由得分驱动**
（`score = 1` ⇒ 全对档步长；`score = 0.5` ⇒ 半对档；`score = 0` ⇒ 0），
并补上计划里那段 🔴 理由（M4 部分得分 + 两档步长 + 「今天得分只可能是 0 或 1，
**行为逐字不变，但接口要按得分写**」），外加一条 ⚠️ 说明「本 brief 原先与计划不一致」。

**证明**：`specs/2026-09-23-p1-worksheet-plan.md:1045-1057`（Task D5 Step 2）就是那个版本的来源。
差异本身是**将来要返工、且学生会看到累计值跳变**的实现风险 —— 所以两处必须逐字一致。

---

## 14. `task-E1-brief.md` —— 规定「真机跑不了时怎么标」

**改了什么**：在 Step 1 之前插入一个 **🔴 Step 0**，把 D1 的先例写成**可执行的规则**：
本机做不了的三条客观理由（没有 iPad、没有 jsdom/Playwright 且装东西违反「不新增 npm 依赖」、
真实库 0 份作答且没有可用的教师管理员密码 ⇒ 造数据会写进用户正在用的库；
桌面浏览器没有软键盘而这条验收最要紧的一半正是键盘遮挡）、
**处置方式三条**（如实写明「需要用户执行」而**不写「已验证」**；给出逐步操作与失败取证点；
**把能自动化的那半边的绿与真机那半边的未做分开写**，
不许用前者的绿暗示后者），并指明 D2 报告里那份 6 步手测清单**直接引用、不要重写一份**（两份会分叉）。
Step 1 那条端到端要求上也补了 🔴「按 Step 0 的口径标：本机未做 ⇒ 写「需要用户执行」+ 逐步操作，不标 ✅」。

**证明（先例原文）**：ledger 的「D1 的真机回归 —— **未做，不得标绿**」那一节 ——
原话「本机没有 iPad、没有 jsdom/Playwright、桌面浏览器无软键盘 ⇒ **假验不如不验**…
逐步操作已写在 D1 报告第四节，**交给用户执行**」。
E1 要跑的那条端到端（`specs/2026-09-23-p1-worksheet.md` §10.2 第一条）
要求的正是同一类真机条件，所以同一套处置。

---

## 未改的、与「不擅自扩大范围」有关的说明

- 🔴 **`src/app/teacher/classroom/page.tsx` 一个字都没碰**（审计 C1 条在那个文件里，按任务要求跳过）。
- **§7.4 数据来源表里 `已看 N/M | WorksheetAnswer.reviewedAt` 那一行没改** ——
  它属于第 4 条（缺教师端读端点），等端点落地后回填更合适；本次只在 §7.2 加了脚注指向 §3-I。
- **`src/app/teacher/page.tsx` 里的 `materials.worksheets` 没改** —— 核实过它是
  `classroomMaterialsInUse()` 返回的**局部变量名**（`page.tsx:762`），不是对**线缆形状**的声称，
  所以它不属于「散文声称了不存在的机制」。
- **根目录 `pnpm build` 没跑**（约束 6：另一个任务在用）。本次只改文档与两处文案，
  风险面由 `tsc` + 限定范围 eslint + 两套测试覆盖。
- **`./dev.sh` 没停**（约束 7），**没有 `prisma db push`**（约束 4）。

## 一处如实记的意外观察（不是缺陷）

`server/src/routes/worksheets.ts` 在并行任务手里，它当前含一个 **NUL 字节**
（`` `${response.participantId}\x00${response.worksheetId}` `` —— 用 NUL 当 Map 键的分隔符，
是刻意的）。副作用是 **`grep` 会把该文件当二进制**（输出 `Binary file … matches`），
本次查该文件一律用 `grep -a`。这是工具层面的坑，不是代码缺陷。
