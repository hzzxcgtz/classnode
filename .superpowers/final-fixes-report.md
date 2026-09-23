# 学习单最终全分支审查 —— 六条修复报告

分支 `feat/p1-worksheet`。基线（动手前现测，`rm -rf server/dist` 后）：

```
ℹ tests 132 / ℹ pass 132 / ℹ fail 0     ← 前端
ℹ tests 391 / ℹ pass 391 / ℹ fail 0     ← 服务端
EXIT=0
npx tsc --noEmit（client / server）均 exit 0
```

修复后：

```
ℹ tests 135 / ℹ pass 135 / ℹ fail 0     ← 前端（+3 条新用例）
ℹ tests 391 / ℹ pass 391 / ℹ fail 0     ← 服务端（条数不变，全过）
EXIT=0
npx tsc --noEmit（client / server）均 exit 0
npx eslint → 0 errors，645 warnings（我改动的 10 个文件**一条都不在里面**，见下）
pnpm build → exit 0（含 Safari 15 lookbehind 兼容检查）
./dev.sh stop → pnpm build → ./dev.sh start → ./dev.sh status → 4000/4001 都在
```

---

## #1 🔴 `worksheets.ts` 里的 2 个裸 NUL 字节

**改了什么**：把 `:719` 与 `:736` 两处模板字面量里的真 `0x00` 字符换成 4 个字符的转义
`\x00`（语义完全相同：`\x00` 就是一个 NUL 字符）。改动：

```diff
-      rowsByPair.set(`${response.participantId}<真 NUL>${response.worksheetId}`, response.answers);
+      rowsByPair.set(`${response.participantId}\x00${response.worksheetId}`, response.answers);
```

**证明（原始输出）**：

```
$ file server/src/routes/worksheets.ts
server/src/routes/worksheets.ts: Java source, Unicode text, UTF-8 text
```

（修之前这一行是 `server/src/routes/worksheets.ts: data`。「Java source」是 `file` 的启发式
误判，无关紧要 —— 要害是 `UTF-8 text` 取代了 `data`。）

```
$ echo -n "HEAD: "; git show HEAD:server/src/routes/worksheets.ts | perl -0777 -ne 'print scalar(()=/\x00/g),"\n"'
HEAD: 2
$ echo -n "工作区: "; perl -0777 -ne 'print scalar(()=/\x00/g),"\n"' server/src/routes/worksheets.ts
工作区: 0
```

```
$ grep -rl "worksheetAccessGate" server/src
server/src/index.ts
server/src/tests/worksheet-realtime.test.ts
server/src/tests/worksheet-student.test.ts
server/src/tests/worksheet-board.test.ts
server/src/tests/worksheet-routes.test.ts
server/src/routes/worksheets.ts          ← 定义它的文件，现在找得到了
```

```
$ grep -n "移除后" server/src/routes/*.ts
server/src/routes/webapps.ts:743:  …请先从这些课堂中移除后再试。…
server/src/routes/worksheets.ts:331:  // ⚠️ 这里曾经写「请先从这些小组中移除后再试」…   ← 不再被静默跳过
```

修之前这条 `grep` **只**回 `webapps.ts` 一行。现在它也会回 `worksheets.ts` ——
这就是「grep 不再一声不响地跳过这个文件」的直接证据。

**顺带扫过全仓**：`git ls-files 'server/src/*' 'src/*'` 下除本次修复外，只剩
`src/app/icon.png` 含 NUL 字节（它本来就是 PNG 二进制，正常）。

---

## #2 🔴 401 被当成永久失败 ⇒ 学生作答被丢弃 + 一句谎话

**改动**（三处，一个判据）：

1. `src/app/classroom/worksheet/worksheet-queue.ts`：把「是不是永久失败」这个**布尔**
   换成三档 `classifyFailure(status): 'permanent' | 'session-expired' | 'transient'`，
   `401` 单独成档。`isPermanentFailure` 保留为 `classifyFailure(...) === 'permanent'` 的
   薄封装（既有用例与既有调用点不用改）。新增 `sessionExpiredMessage()`。
2. `src/app/classroom/worksheet/use-worksheet-answers.ts`：flush 循环改成按 `classifyFailure`
   分派。`'permanent'` 仍出队 + 弹服务端原话；`'session-expired'` **不出队**、只弹
   「刷新页面」那句、然后 `break`（token 已失效，后面每条都会 401，继续发只是白打服务端）。
   新增 `sessionExpiredRef` 把「这次会话已过期」记住：既防止每 1.5 秒重复弹同一句，
   也让 `submit()` 能把「先等网络恢复」换成正确的那句。
3. `submit()` 里 401 不再回落服务端原话（那句是 `middleware/auth.ts` 的
   「教师会话已失效，请重新登录」——说给教师的，学生没有教师会话可登）。

**为什么这样就不丢数据**：队列键是「课堂 + 参与者」且落在 `localStorage`（`worksheetQueueKey`），
刷新页面会重新 `createStudentSession` 并由水合那一段重放整个队列。不出队 ⇒ 一条都不会少。

**409 保住了**：`allowResubmit:false` 仍归 `'permanent'` ⇒ 仍出队 + 仍提示（B3 的契约）。

**测试（3 条，`worksheet-queue.test.ts`）**：

```
$ node --test src/app/classroom/worksheet/worksheet-queue.test.ts
✔ 🔴 isPermanentFailure：4xx 是永久（含 409），5xx 与网络错误是暂时
✔ 🔴 反向断言：把 5xx 也算成永久 ⇒ 上一条红
✔ permanentFailureMessage：优先用服务端那句，拿不到才回落；409 有专门的一句
✔ 🔴 401 不出队（会话过期），409 仍出队（阳性对照）          ← 新增
✔ 🔴 反向断言：把 401 归回「永久失败」⇒ 上一条红             ← 新增
✔ 会话过期的提示说「刷新页面」，且**不是**服务端那句说给教师听的话  ← 新增
…（其余 9 条原有）
ℹ tests 15 / ℹ pass 15 / ℹ fail 0
```

⚠️ 新增用例里的 `drops()` **共用被测的 `classifyFailure` 本身**，所以在实现回退时它不会
变成假绿（若测试自己写一遍 `status >= 400`，回退后它照样通过）。

**★ 反证（实测做了，不是只写在注释里）**：把 `classifyFailure` 里的
`if (status === 401) return 'session-expired';` 那一行删掉（即回退成「4xx 一律永久」），
再跑同一个测试文件 —— **恰好那两条 401 用例变红，其余 13 条仍绿**：

```
✖ 🔴 401 不出队（会话过期），409 仍出队（阳性对照） (0.310584ms)
✖ 🔴 反向断言：把 401 归回「永久失败」⇒ 上一条红 (0.053667ms)
ℹ tests 15 / ℹ pass 13 / ℹ fail 2
```

随后已还原，复跑 15/15 绿。

---

## #3 规格里仍在描述一个不存在的全局设置（纯文档）

**改了什么**（`specs/2026-09-23-p1-worksheet.md`，三处各加更正横幅，都指向 §12 与 `Worksheet.settings`）：

- **§9.2** 开头加 🔴 横幅：本节描述的「全局设置」不存在，实现是**学习单级**
  （`Worksheet.settings`，UI 在编辑器设置面板）；附实测依据 `grep -rn "作答反馈" src/` 零命中，
  并注明「下面这段留着是为了让 §12 的『推翻』有可对照的原文，不要照着它去验收」。
- **§10.1** 范围行 `奖励形式（全局设置 + 学生端呈现）` → `奖励形式（**学习单级**配置 + 学生端呈现）`，
  并在该节已有的「教师列表页去掉了预览」那条更正后面补了同批第二处更正说明。
- **决策表 N** 补上 `⚠️ 2026-09-23 更正` 标记（与同批被推翻的 I / J / R / S 同一格式），
  行内划掉「全局设置」并改指 `Worksheet.settings`，写明「那个分组**从未存在过**」。
  ⚠️ 不补这一处的话，做人工验收的人会照着表去 `/teacher/` 首页找一个不存在的分组。

**证明**：

```
$ grep -rn "作答反馈" src/
（零命中 —— 修之前修之后都是零命中，这正是本节要更正的「规格写了、实现没有」）
```

```
$ grep -n "奖励形式（" specs/2026-09-23-p1-worksheet.md
978:奖励形式（**学习单级**配置 + 学生端呈现）
```

剩余仍出现「全局设置」的地方逐一核对过，全部是**引用旧决定**的语境
（§9.2 横幅内、§9.2 被标注为「不要照做」的正文、§12 的 M4 ① 正文明说推翻它）——
不是新的假话。

---

## #4 两份 `QUESTION_TYPES`（反向不一致是静默的）

**改了什么**（2 行）：

```diff
-const QUESTION_TYPES: readonly string[] = ['single-choice', 'fill-blank', 'short-answer'];
+const QUESTION_TYPES: readonly string[] = QUESTION_TYPE_REGISTRY;   // 由 import 引入
```

`routes/worksheets.ts` 现在 `import { QUESTION_TYPES as QUESTION_TYPE_REGISTRY }` 自
`services/worksheet-questions.ts`，自己那份真源已删。放宽成 `readonly string[]` 只是为了
对任意输入做 `includes`（注册表是 `as const` 的字面量联合）。

同时把注册表里那段**只分析了一个方向**的注释改写：原文说「两份不一致的后果是新增题型被
400 拒绝（响亮失败），所以第一批没有合并它们」—— 只分析了「注册表有、校验没有」。
反向（校验有、注册表没有）是**静默**的：`normalizeNode` 收下这道题，而
`validateQuestion` 只对 `single-choice` / `fill-blank` 两支做检查 ⇒ 返回空错误 ⇒
那道题永远无法作答、也永远无法提交。注释现在写明了这一点，并提醒 M4 加题型时
`validateQuestion` 的 `if` 链要同步加一支。

**证明**：

```
$ grep -n "QUESTION_TYPES" server/src/routes/worksheets.ts
（只剩 2 处：注释里的说明 + `const QUESTION_TYPES: readonly string[] = QUESTION_TYPE_REGISTRY;`）
$ grep -rn "QUESTION_TYPES" server/src --include=*.ts | grep -v tests
server/src/routes/worksheets.ts:  QUESTION_TYPES as QUESTION_TYPE_REGISTRY,   ← import
server/src/routes/worksheets.ts:  const QUESTION_TYPES: readonly string[] = QUESTION_TYPE_REGISTRY;
server/src/services/worksheet-questions.ts:  export const QUESTION_TYPES = [...] as const;
```

真源只剩一处；服务端 391 条测试全过、server `tsc` exit 0。

---

## #5 `describeUsage` 给出一条走不通的出路

**先核实了断言**（不凭规格转述）：本仓确实**没有**「移除」这个操作 ——

```
$ grep -rn "classroomGroupMaterial" server/src/routes/*.ts | grep -iE "create|update|delete|upsert|deleteMany"
server/src/routes/classroom.ts:592:  await tx.classroomGroupMaterial.create({ ... });
server/src/routes/classroom.ts:770:  await tx.classroomGroupMaterial.create({ ... });
   ⇒ 只有 create，且两处都在「建课堂」那一支；没有任何删除 / 改写它的端点

$ sed -n '1199,1202p' server/src/routes/classroom.ts
router.put('/:id/settings', async (req, res) => {
  const { title } = req.body;        ⇒ 课堂设置只能改标题，改不了材料关联

$ grep -rn "router.delete" server/src/routes/classroom.ts
server/src/routes/classroom.ts:1452:router.delete('/:id/student/:studentId/messages', ...)
   ⇒ 唯一的 DELETE 是删学生消息，没有删课堂的端点
```

**改了什么**（1 行）：

```diff
-    : '请先从这些课堂或小组中移除后再试。';
+    : '它被课堂或小组引用着，而当前版本还没有提供「解除引用」的入口。';
```

（并在上一行补了注释，把上面那三条实测依据写进去 —— 免得下一轮有人以为是漏写。）

**顺带修掉 4 处因这次改动而变成假话的注释**：前端的
`worksheet-overlays.tsx` / `types.ts` / `use-worksheet-list.ts` / `worksheets/page.tsx`
里都写着「服务端那句含『请先从这些课堂或小组中移除后再试』，所以前端不用它」——
服务端那句已经改掉，这四句注释就成了新的假话。已改成「前端不用它是因为它是一段给一行字
用的整话（弹窗要列清单、要点名哪几间课堂），措辞各自演化」，并保留历史说明。

**证明**：无测试钉住旧文案（`grep -rn "移除后再试" server/src/tests src` 修前修后都只在
注释里命中，没有断言）；服务端 391 条测试全过。

---

## #8 `duplicate` 在保存中会静默失败

**改了什么**（`use-worksheet-editor.ts`，约 6 行）：`save()` 的三种 `null` 里只有
「`savingRef.current` 为真」这一种是静默的（既不动 `saveStatus` 也不弹提示）。
`duplicate` 拿到它之后补一句提示；另两种（标题为空 / 请求失败）`save()` 自己会说话，不重复。

```ts
if (!saved) {
  if (savingRef.current) {
    callbacksRef.current.onNotice({ message: '正在保存中，等这次保存完再点「复制一份」', type: 'error' });
  }
  return;
}
```

**证明**：`npx tsc --noEmit` exit 0；`npx eslint` 对该文件 0 warning；
`pnpm build` exit 0（该 hook 被 `edit/page.tsx` 引用，进了产物）。

---

## 门禁汇总

| 门 | 结果 |
|---|---|
| `pnpm test` | 前端 **135/135**、服务端 **391/391**、fail 0 |
| `npx tsc --noEmit`（client） | exit 0 |
| `npx tsc --noEmit`（server） | exit 0 |
| `npx eslint` | 0 errors；645 warnings，**改动过的 10 个文件一条都不在里面** |
| `./dev.sh stop && pnpm build && ./dev.sh start && ./dev.sh status` | build exit 0（含 Safari 15 兼容检查）；4000/4001 都在 |

eslint 的 645 条 warning 全部是既有的（绝大多数来自 `server/vendor/snapdom.js` 这个
打包产物）。核对方式：把 eslint 输出里出现过的文件头列出来，与本次改动的文件求交集 ——
交集为空：

```
$ grep "^/Users" /tmp/eslint.log | sed 's|.*/classnode/||' | sort -u
.superpowers/sdd/…（4 个 evidence/verify 脚本）
serve-frontend.js
server/src/tests/webapp-monitor.test.ts
server/src/tests/worksheet-realtime.test.ts
server/vendor/snapdom.js
src/app/classroom/identity/use-student-session.ts
```

---

## ⚠️ 留一条给控制器（未改，因为不在本次六条里）

`server/src/routes/webapps.ts:743` 有**同一句**走不通的出路：
`该网页已被 N 个课堂和 M 个小组使用，无法删除。请先从这些课堂中移除后再试。`
它不在 #5 的范围内（#5 只点 `describeUsage`），且 `worksheet-overlays.tsx` 的既有注释把它
称作「既有 `webapps.ts` 那句已知误导措辞」—— 看起来是**已被分诊过、判为可以留**的。
本次没动它。若控制器认为该一并改掉，那是一次同形的 1 行改动。

## 未做（按控制器裁定保留）

DDL 只由正则把关 · `stripAnswers` 黑名单（**M4 加题型那一刻必须回头改**）· 测试脚手架三份重复 ·
`keptKeys` 不去重 · Windows 路径可移植性 · `globals.css` 长度 · 放行判据放宽到 500 ·
`grade()` 忽略 `value.format` · 弹窗无请求序号 · C1 少做筛选 · `ExploreDetailPanel` 回落 ·
`webapp-host.test.js` 抖动与 `/tmp` 固定路径（**不得当它已解决**）· 「已交 N/M」两个分母 ·
三份组材料类型声明不一致 · `duplicate` 标题 200 字边界 · `CLAUDE.md` 没跟上 `pnpm test` 语义。

约束遵守：未新增 npm 依赖；未跑 `prisma db push`；未改 `CLAUDE.md` / `dev.sh` /
`release.sh` / `package.json`；`pnpm test` 与 `pnpm build` 全程串行，同一时刻只有一个在跑；
`./dev.sh` 在 build 前停、build 后起，未停着不放。
