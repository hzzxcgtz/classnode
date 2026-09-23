# 三条审查意见的修复报告（F1 / F2 / F3）

> 分支：`feat/p1-worksheet`（起点 `e5bb10b` = 合并 `fix/webapp-material-authority` 之后的 HEAD）
> 日期：2026-09-23
> 提交：`d643791`（F1）· `c35f75d`（F2）· `a9e2339`（F3）

## 结论一句话

三条都改了，改法都是**按当前树成立的事实**写，不改形状、不加依赖、不动服务端。
F1 是散文（注释 / 报告）与事实对不上；F2 是前端读了服务端从不下发的字段；
F3 是一行单位错。

## 基线（先现测，后动手）

```
$ cd server && rm -rf dist && pnpm test
ℹ tests 384
ℹ pass 384
ℹ fail 0
```

改完复跑同一命令，**数字一致**（384 / 0）：

```
$ cd server && pnpm test
ℹ tests 384   ℹ pass 384   ℹ fail 0
```

⚠️ 关于约束 9：`server/dist/` 里原本有上一轮的产物（`pnpm test` 不清理它）。
我**先** `rm -rf server/dist` 再跑的基线，所以上面的 384/0 是全新编译的结果，不是旧产物。
`server/dist` 现在是我这轮重编译出来的，未被回滚。

未跑根目录 `pnpm build`（约束 6，会覆盖 `.next`）；未停 `./dev.sh`；未碰
`CLAUDE.md` / `dev.sh` / `release.sh` / `package.json`；未新增依赖；未跑任何 `prisma db push`。

静态检查：

```
$ npx tsc --noEmit          # 无输出
$ npx eslint src/app/teacher/classroom/page.tsx src/lib/types.ts \
             src/lib/classroom-material.ts src/lib/classroom-material.test.ts \
             src/app/classroom/home/student-home.tsx     # 无输出
```

---

## F1（Important）· 三条「核过的事实」在合并后全部失效

**这是一条纯散文缺陷，没有一行代码行为是错的。** 但按控制器的话说：
「散文否认了一个存在的机制」和「散文声称了一个不存在的机制」一样会误导下一个人 ——
尤其 P1 的实施者，读到会以为服务端还要补。

### 我自己复跑的实测（**每一条都推翻了旧结论**）

```
$ grep -n "^model .*Worksheet" server/prisma/schema.prisma
428:model Worksheet {
444:model ClassroomWorksheet {
459:model WorksheetResponse {
479:model WorksheetAnswer {

$ grep -n "kind: 'worksheet'\|worksheetId" server/src/routes/classroom.ts
362:    const worksheet = await resolveSingleMaterialId(prisma, worksheetIds, 'worksheet', 'create');
480:        worksheetId: toId(input.worksheetId),
515:    const worksheet = await resolveSingleMaterialId(prisma, worksheetIds, 'worksheet', 'create-advanced');
587:        ['agent', group.agentId], ['webapp', group.webappId], ['worksheet', group.worksheetId],

$ grep -rn "loadClassroomWorksheets" server/src/
server/src/routes/classroom.ts:217:async function loadClassroomWorksheets(     ← 定义
server/src/routes/classroom.ts:700:      worksheets: await loadClassroomWorksheets(prisma, classroom.id),   ← /active
server/src/routes/classroom.ts:882:    const worksheets = await loadClassroomWorksheets(prisma, classroom.id);   ← /:id
server/src/routes/classroom.ts:1005:    const worksheets = await loadClassroomWorksheets(prisma, classroom.id);   ← /code/:code

$ grep -n "worksheet" server/src/services/group-material-resolve.ts
115:  worksheet: { id: string; title: string } | null;
188:      worksheet: worksheet ? { id: worksheet.id, title: worksheet.title } : null,
```

⇒ 旧三句（表不存在 / 没人写 `kind='worksheet'` / `/active` 不下发）**在当前树上全部为假**。

### 改了什么

| 文件 | 原来 | 现在 |
|---|---|---|
| `src/lib/types.ts:105` `WorksheetMaterialSummary` | 「P1 尚未落地，表不存在、没人写、不下发」 | 组级 `groups[].worksheet` + 课堂级 `worksheets` 各自的出处（函数名 + 文件 + 行号），并写明**形状只有 `id`/`title`** |
| `src/lib/types.ts:380` `ActiveClassroom.groups[].worksheet?` | 「服务端不下发这个字段」 | 服务端**会发**；`null` 是高级模式的合法值（不回落） |
| `src/lib/types.ts:407` `ActiveClassroom.worksheets?` | 「今天服务端不查询也不下发」 | 服务端**会发**（`loadClassroomWorksheets`）；可选的理由与 `webapps?` 逐字相同 |
| `src/lib/classroom-material.ts:25 / :46` | 「今天恒为 `undefined`」×2 | 两份材料的出处与归属模式 |
| `src/lib/classroom-material.test.ts:240` | 测试名「今天服务端不下发，但形状就位」 | 「读 `groups[].worksheet`，带组名 —— 服务端就是这个形状」 |
| `src/app/classroom/home/student-home.tsx:174` | 「P1 未落地」 | 「学生端面板还没做（P1 的 D 阶段）」，并写明**别因此去服务端补活** |
| `.superpowers/board-ui-fixes-report.md` §E | 三条「核过的事实」+ 「形状先就位」 | 保留原文框架，**加时序说明**，并把「核过的事实」换成当前成立的那一版（附命令） |

### 报告文件里的时序说明（如实写，不粉饰）

> ⚠️ **时序说明（2026-09-23 补写，如实记录，不粉饰）**：下面这三条写在 `feat/p1-worksheet`
> 的后端实现**合并进来之前** —— 本批（`3581dee` / `9610dd2`）与 P1 服务端长在**两条不同的
> 分支**上。当时三条都是**实测**出来的，不是推断；合并之后三条**全部失效**。

## 要求的那一遍自查 grep（F1 的收尾动作）

```
$ grep -rn "Worksheet 表不存在\|不下发学习单\|不下发这个字段\|今天恒为 \`undefined\`\|还没做" src/ .superpowers/*.md
src/app/classroom/home/student-home.tsx:174:  …「学生端面板还没做」（P1 的 D 阶段）…        ← 我改的，仍成立
src/app/teacher/classroom/page.tsx:2873:  …「占位。学习单本身还没做…」                    ← 见下方「核过但没改」
src/app/teacher/classroom/page.tsx:2878:  …「尚未支持。学习单还没有做，这里先留位。」        ← 同上
src/app/teacher/classroom/new/page.tsx:183:  …「键**不存在** = 教师还没做出决定…」          ← 无关（表单初值）
src/lib/types.ts:110:  …「别再照着旧话说『还没做』」                                      ← 我写的新句
.superpowers/board-ui-fixes-report.md:222:  …「不下发学习单字段。」                        ← 在「合并前为真」的引用块内
.superpowers/board-ui-fixes-report.md:240:  …「散文否认一个存在的机制…」                   ← 我写的新句
```

**当前树里没有任何一处再声称「学习单服务端不存在 / 不下发」。** 剩下的两处
（`page.tsx:2873` / `:2878`）我核过之后判断**仍然成立**，理由见下一节。

---

## F2（Important）· 看板对话抽屉的 AI 署名用错了智能体

### 根因（实测，非推断）

```
$ grep -rn "agentIds" server/src/ --include="*.ts" | grep -v /tests/
server/src/routes/agents.ts:181:    const agentIds = agents.map(agent => agent.id);      ← 局部变量
server/src/routes/classroom.ts:338:  const { title, classIds, agentIds, … } = req.body;     ← 请求体
server/src/routes/classroom.ts:355:  const uniqueAgentIds = toIdList(agentIds);             ← 请求体
server/src/services/group-material-resolve.ts:152:  const agentIds = new Set<string>();     ← 局部 Set

$ grep -rn "agentIds" server/src/routes/*.ts | grep -i "res.json\|res.status"
（无输出）

$ grep -n "getClassroom:" src/lib/api.ts
154:  getClassroom: (id: string) => request<ClassroomDetail>(`/api/classroom/${id}`),   ← 原样透传
```

⇒ `cr.agentIds` **恒为 `undefined`** ⇒ `agents.find(...)` 恒不中 ⇒ 恒回落 `agents[0]`，
也就是**整个智能体库的第一个**。抽屉里每条助手消息都挂着错误的名字与头像，而且不报任何错。

这与本会话刚修的快照 bug 是**同一个根因家族**：材料的权威来源早就从「课堂级」变成了
「高级模式每组一份」，而这里还在按老假设读。

### 改法：去用那个已经存在的函数，不另写一套

```tsx
const drawerAgent = effectiveGroupAgent(
  { ...classroom, agents: classroom.classroomAgents?.map((item) => item.agent) },
  { groupId: students.find((s) => s.id === selectedStudent?.id)?.groupId ?? null },
);
```

- 解析**全权**交给 `effectiveGroupAgent`（`@/lib/classroom-material`）—— 它已经带着
  「**高级模式只认自己的组、本组没配就是 `null`、不回落**」这条规矩（spec §4.4）。
- 我只做两件事：**改名**（教师端这条路径上课堂级智能体叫 `classroomAgents`，不叫 `agents`；
  与 `src/app/teacher/page.tsx:758` 是同一行写法）+ **从名册现查 `groupId`**
  （与 `exploreDetailStudent` 同一条理由：名册会变，存对象就是留一份不更新的旧快照）。
- 删掉了 `classroomAgent` state、`ClassroomAgentDisplay` 类型、以及那一次
  「把整个智能体库拉下来只为挑第一个」的 `api.getAgents()` 请求。

### 怎么验证的（看得见的输出，不是「已修复」三个字）

**① 旧 / 新署名并列对比**（脚本 `/tmp/f2-verify.mjs`，直接 import 真实的
`src/lib/classroom-material.ts`，课堂与名册形状照抄 `GET /api/classroom/:id` 的响应）：

```
$ node /tmp/f2-verify.mjs
标准模式      旧署名=库里第一个（谁都不是）   新署名=标准模式那个
分组模式      旧署名=库里第一个（谁都不是）   新署名=分组模式那个
高级·本组有    旧署名=库里第一个（谁都不是）   新署名=第1组的智能体
高级·本组没配  旧署名=库里第一个（谁都不是）   新署名=（null ⇒ 界面写「AI 助手」）
```

「旧署名」四行**全都是同一个**名字，正是根因（`agentIds` 恒空 ⇒ 恒回落 `agents[0]`）的实证。

**② 逐学生走一遍抽屉的实际取数路径**（脚本 `/tmp/f2-verify2.mjs`，含
`students.find(s => s.id === selectedStudent?.id)?.groupId` 这一步）：

```
$ node /tmp/f2-verify2.mjs
点开 张三（第1组）⇒ 第1组的智能体
点开 cs-2 ⇒ （null ⇒ 界面写「AI 助手」，不拿课堂级顶上）
点开 cs-3 ⇒ （null ⇒ 界面写「AI 助手」，不拿课堂级顶上）
```

高级模式下第 2 组没配智能体、课堂级那个是幽灵（`课堂级幽灵（不该出现）`）——
**它一次都没出现**，说明「不回落」这条规矩在**新的调用点**上同样成立。

⚠️ **诚实交代边界**：以上是**脚本级**验证（真实解析函数 + 真实响应形状），
**不是浏览器实测**。我没有在浏览器里点开抽屉看那行字 —— 那需要一间高级模式、两个组、
其中一组没配智能体的活课堂。`cd server && pnpm test` 覆盖不到这条（它是纯前端），
约束里也说明了这一点。**要真机确认的话**：建一间高级模式课堂，第 1 组配 A 智能体、
第 2 组配 B，看板点开第 1 组某个学生的格子 ⇒ 抽屉里助手署名应为 A 而不是「智能体库里第一个」。

---

## F3（Minor）· 筛选行里两个「全部」的单位不一致

### 语义判断：统一到**人数**（`students.length`）

理由（三选一的判断依据）：

1. 这一组筛选器的标签是「模块」，它在文档里的定位是「**三件套中各有多少人**」（用户原话，
   见 `page.tsx:1836-1837` 那段注释）。问的是人，就该用人。
2. 同组另外五项（学习单 / 探究空间 / 智能学伴 / 首页 / 未知）全部来自 `moduleDistribution`，
   而它是**逐 `students` 计数**的（`for (const student of students) counts[resolveStudentFocus(student.id)] += 1`）。
   五个值之和**恰好等于** `students.length` —— 所以「全部」用人时，这一行内部是可交叉验算的。
3. 反过来把五个模块项改成格子数**做不到**：小组格的成员可能散在不同模块（`mixed`），
   一个格子会被计五次或零次，「按模块数格子」根本没有定义。

### 改法与实测

```tsx
-  <ModuleCountChip label="全部" value={allDisplayCards.length} … />
+  <ModuleCountChip label="全部" value={students.length} … />
```

```
$ grep -n 'label="全部"' -A 1 src/app/teacher/classroom/page.tsx
1841:              <ModuleCountChip label="全部" value={students.length}
1842:                selected={studentModuleFilter === 'all'} onSelect={() => setStudentModuleFilter('all')} />
```

**状态那一组（在线 / 互动中 / 需关注 / 离线）我**没有**改，仍用 `boardFilterCounts` 的格子数** ——
那是**对**的：小组在「在线」这件事上是一个不可拆的单位（`getDisplayCardStatus` 对小组卡
按「有成员在互动 / 有成员在线」定一个状态），拆成人反而会撒谎。
两组各按自己的语义，但**同一组内单位一致**；注释里把这条写清楚了。

---

## 我核过但**没改**的（连同理由，交给最终审查分诊）

1. **`page.tsx:2873` / `:2878`「学习单还没有做，这里先留位」**
   （「课堂权限」弹窗里的占位段）。核过之后判断**仍然成立**：它说的是**这个弹窗里没有
   学习单的权限开关可摆**，不是「服务端没有学习单」。判据：该段的用户可见文案是「尚未支持」，
   而三件套里学习单的**客户端**部分（`specs/2026-09-23-p1-worksheet-progress.md`：
   C 教师端 0/3、D 学生端 0/5）确实一行都还没有。**没改是因为它是用户可见文案，
   属于产品措辞决定，不该由一次「修注释」顺手改掉。**
2. **同族的「学习单 · 尚未支持」三处**（`page.tsx:1439` 的占位面板、
   `:1798` 的指定模式按钮 hint、`:1844` 的模块筛选 chip）。
   这几处的 `尚未支持` 指的是**看板画不出学习单那一格**（`placeholder('学习单 · 尚未支持',
   '这个模块还没接进看板')`）—— 这是真的：`resolveTileModule` 拿到 `worksheet` 时走的就是
   placeholder。⚠️ 但要提醒一句：**`moduleDistribution.worksheet` 今天是可能 > 0 的**
   （学生端 `use-module-tabs.ts:60` 接受 `'worksheet'`，学生点进去就会上报
   `module-focus = 'worksheet'`），所以那个 chip 会显示成「学习单 2 尚未支持」——
   数字是真的，「尚未支持」指的也是真的（看板画不出来），但**两件事并排容易读成
   「这些学生是不存在的」**。要不要改文案是产品决定，我没动。
3. **`.superpowers/board-ui-fixes-brief.md:78`**「它现在恒为空，你要让它显示得出来」
   —— **没改**：brief 是**当时下达的指令**，改它就是篡改历史。报告 §E 里的时序说明
   已经交代了它为什么当时成立。

## 顾虑 / 遗留

- **F2 只有脚本级验证，没有浏览器实测**（理由与复现步骤见 F2 一节）。这是本次最需要
  真机确认的一条。
- `drawerAgent` 是在组件体里用**普通 const**（不是 `useMemo`）算的 —— 每次渲染一次
  `students.find`（几十项）+ 一次函数调用，可忽略；关键是它**在早退 `if (!classroom)`
  之后**，所以不能是 hook（会破坏 hook 顺序）。这一点违反了「hot path 上别做 O(n)」的
  直觉，但代价确实低于引入一个 hook。
- 我没有重跑根目录 `pnpm build`（约束 6），所以 **student bundle 的
  `check-classroom-browser-compat.mjs` 这一轮没跑**。我在 `/classroom/` 路径上只改了一句
  注释（`student-home.tsx`），没有引入正则；即便如此，「没跑就是不变量没被验证过」这句话
  仍然成立，特此说明。
- 三条提交都只碰前端与文档。`src/` 侧**只有两处行为改动**：F2 的助手署名取数（`drawerAgent`）、
  F3 的那个数字（`students.length`）；其余全是注释 / 测试名。服务端一行未动。
