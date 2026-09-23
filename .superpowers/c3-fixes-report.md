# C3 修复报告（分支 `feat/p1-worksheet`）

修的是 `brief` 里 I1 / M1 / M2 / M3 / M4 / M5 六条，M6 按控制器裁定**不动**。

---

## 0. 基线（改之前，实测）

| 项 | 命令 | 结果 |
|---|---|---|
| 服务端测试 | `pnpm test`（含 `test:server`） | `tests 385 / pass 385 / fail 0` |
| 前端测试 | `pnpm test:client` | `tests 72 / pass 72 / fail 0` |
| 类型 | `npx tsc --noEmit` | 退出 0 |

> ⚠️ **基线不是红的，所以没有 `rm -rf server/dist` 的额外动作**。首次跑基线前我确实执行过一次
> `rm -rf server/dist` 再跑（约束 9 的预防性动作），结果 385/385 直接通过 —— 也就是说
> 这份基线不依赖任何陈旧的 `dist/`。
>
> 另注：`pnpm test` 的完整输出我第一次只 `tail -60` 存了日志，前端那 72 条被截掉了，
> 于是单独重跑 `pnpm test:client` 补测——上表前端数字来自那次补测，不是猜的。

## 1. 终态（改之后，实测，同一批命令）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 退出 0 |
| `npx eslint src/app/teacher/classroom/new/page.tsx src/app/teacher/worksheets/edit/page.tsx` | 退出 0（`globals.css` 被 eslint 跳过，见 §4） |
| `pnpm test` | 前端 **72/72**、服务端 **385/385**、`fail 0`、`^not ok` 计数 **0** |

**测试数字与基线逐位相同**：没有新增、没有跳过、没有变红。

---

## 2. I1（Important）课堂级学习单下拉无法取消 —— 已修，且**做了反证**

**改动**（`src/app/teacher/classroom/new/page.tsx`）：给 `GroupMaterialPicker` 加了一个
**显式选择加入**的 prop `clearOnReselect`（默认 `false`），语义是「点**已选中**的那一项 = 取消」。
课堂级学习单那一格带上它。

```tsx
onClick={() => onPick(clearOnReselect && value === option.id ? null : option.id)}
```

为什么是**新 prop** 而不是把行为改成全局：高级模式那三格的「取消」由列表第一项「不指定」承担，
而「不指定」是一个与「还没选」**不同**的合法状态（决定 vs 没决定，一个能提交一个被拦）。
让同一个手势同时承担两种语义，会把高级模式那三格已经被审查过的语义搅浑。
`allowUnspecified = false` 的格子没有「不指定」，所以只有它需要这个手势。

为什么不是直接把 `allowUnspecified` 改成 `true`：那一格传的 `value` 是
`selectedWorksheetId || undefined`，「没选」是 `undefined` 而不是 `null`，组件里
`allowUnspecified && value === null` 永远不成立 ⇒ 列表里会多出一个**永远不显示为选中**的
「不指定」项，与服务端语义对不上（组件自己的注释就写了这一点）。

### 怎么验的（真跑浏览器，不是读代码）

用 `evidence-c3/verify-c3.mjs`（CDP，拦截 `/api/*` 用桩数据应答 ⇒ **不需要教师会话、不碰真实数据库**），
在真的 dev server（:4000/:4001，用户正在用的那个，没停）上跑：

**正测 —— `node verify-c3.mjs i1`：**
```
① 初始: {"aria":"学习单：尚未选择","text":"选择学习单","expanded":"false"}
③ 选「光的折射 · 实验记录单」: OK
④ 选中后: {"aria":"学习单：光的折射 · 实验记录单", ...}
⑥ **再点同一项**（应触发取消）: OK
⑦ 取消后: {"aria":"学习单：尚未选择","text":"选择学习单","expanded":"false"}

✔ 第 4 步（前提）：选中生效 ——「再点一次」之前确实处于已选状态
✔ 第 7 步：**再点一次确实取消了**（回到未选）
判定: PASS
```

**反证（这条才是真的证据）—— 把 `clearOnReselect` 那一行去掉，同一脚本必须变红：**
```
④ 选中后: {"aria":"学习单：光的折射 · 实验记录单", ...}
✔ 第 4 步（前提）：选中生效 ——「再点一次」之前确实处于已选状态
✘ 第 7 步：再点一次没有取消 —— 单向门仍在
判定: FAIL
```
⇒ 这个脚本对「能不能取消」是**敏感**的，正测的 PASS 不是假绿。
（去掉那一行正是修复前的行为，所以这条同时也复现了 brief 描述的缺陷本身。）
随后从备份恢复，正测复跑仍 `PASS`。

> 脚本第 4 步「前提」是刻意加的：没有它，一个从头到尾都没选上的用例也会报「取消成功」——
> 这正是本项目里反复出现的那种假绿。事实上**第一次跑它就救了我一次**：选项按钮的文字是
> 「头像首字 + 名字」，`textContent` 是 `光光的折射 · 实验记录单`（两个「光」），
> 我原先用 `startsWith` 找元素 ⇒ 根本没点中，而第 7 步却"通过"了。前提检查把这次假绿挡下来了。

---

## 3. M1 —— 已修，幽灵符号的**引用**已消失

**改动**：`page.tsx:412-419` 那段注释里，`webappSectionRef` / `worksheetSectionRef` 并列的
半句改成只讲 `webappSectionRef`，并**如实补一句**学习单那一块没有自己的 ref（本轮未加），
说明从前那句为什么是错的。

**grep 复核**（brief 明确要求的那一步）：
```
$ grep -rn "worksheetSectionRef" src/
src/app/teacher/classroom/new/page.tsx:418:        //    并列写成「恒为 null」，而 `worksheetSectionRef` 这个符号**从未存在过** ——
```
只剩 **1** 处，且它是**否定句**：字面在说「这个符号从未存在过」。
即**没有任何一处再声称它存在或可用**。我选择保留符号名（而不是把整句删干净），
因为 brief 给的两个选项里「如实标注」是其一，且留着它，下一个 grep 到这个名字的人
会当场读到「它不存在」——把整句删掉反而丢失了这次纠错的痕迹。

**顺带核对了同一段注释的其余事实性断言**（避免我修一处、留一处谎）：
- 「`errors` 只可能是 title / class / groupAgents / material 四者之一」——
  `grep -n "errors\.[a-zA-Z]* *="` 结果正是这四个字段（6 处赋值、4 个字段名），**成立**。

**一个不在 brief 里、我没有改的发现**：`fieldErrors.agent`（`page.tsx:858/896/898` 读）
**从来没有被赋过值** —— 上面那次 grep 里没有任何 `errors.agent =`。也就是说
智能体那一块的红框与错误文字（含它的 SVG 图标）是**死代码**，永远不显示。
不在本轮范围（brief 只给了 I1/M1–M5），**未改**，留在这里给最终审查决定。

---

## 4. M2 —— 已修，高级模式的教师现在也看得到截断提示

**改动**：把截断提示提成一个变量 `worksheetTruncationHint`（定义在 `page.tsx:512-525`，
带一段说明为什么必须共享），在**两处**渲染：高级模式那块（每组下拉的正下方、
`worksheetLoadError` 提示之后）与课堂级那块（原位置）。

### 怎么验的

同样用 `verify-c3.mjs`，这次连**对照组**一起跑（没有对照组，「提示出现了」也可能只是
那句话被无条件渲染了）：

**m2（`total: 137`，只到手 3 份）：**
```
"高级模式块在": true,
"每组的「学习单」下拉数": 3,
"课堂级学习单块": "未渲染（正确）",
"截断提示数": 1,
"截断提示文字": "共 137 份学习单，下拉里只列出了前 3 份（按更新时间倒序）。 其余的到「学习单」页搜索确认。",
"截断提示在高级模式块内": true        ← 断言的是它在**高级模式那块 DOM 子树里**
✔ 拿不全（137 份只有 3 份）：**高级模式的教师看到了截断提示**
判定: PASS
```

**对照组 m2-control（`total: 3`，拿全了）：**
```
"截断提示数": 0, "截断提示在高级模式块内": false
✔ 对照组（拿全了 3/3）：提示**不**出现 —— 证明它不是无条件渲染的
判定: PASS
```

**回归 std-trunc（标准模式 · 137 份）**：提示仍在课堂级那一块里（`截断提示数: 1`，
`课堂级学习单块: "仍在（不该）"`），旧位置没被改坏。`判定: PASS`

---

## 5. M3 —— 注释已改成与现状一致；两条失效规则**我选择删掉**，并为这个判断做了 A/B

**改动**：`globals.css:2633-2646`。

- 旧注释说「高级模式每组那**两个**下拉（智能体 / 探究网页）」并解释 `flex: 1 1 320px`
  —— 下拉现在是**三件套三个**，`flex` 也早就不存在了。**已重写。**
- `.new-classroom-group-row { flex-wrap: wrap }` **已删**
- `.new-classroom-group-material { width: 100% !important }` **已删**

### 「删还是留」的判断与依据

brief 说这条由我判断、并写进报告。本项目的要求是「注释不许说谎」而非「必须删代码」，
所以我的取舍是：**注释必须重写（这是硬要求）；规则本身按「它是否真的无效」决定**。
判据是「无效」而不是「看起来多余」——所以我没有停在读代码，而是做了 A/B 实测：

| 视口宽 | 行宽 | 材料容器宽 | 三格宽度 | A/B |
|---|---|---|---|---|
| 640 | 460 | 430 | 211 / 211 / 211 | 旧 CSS 与新 CSS **逐位相同** |
| 700 | 520 | 490 | 158 / 158 / 158 | 同上 |
| 1280 | 668 | 638 | 207 / 207 / 207 | 同上 |

（方法：备份新 CSS → `git show HEAD:src/app/globals.css > src/app/globals.css` 换回旧版 →
同脚本重测三档宽度 → 比数字 → 恢复。`W=<宽> node evidence-c3/verify-c3.mjs layout`。）

【为什么旧 CSS 等价】材料容器宽**恰好**等于 `行宽 − 2×1px 边框 − 2×14px 内边距`
（640: 460−30=430；700: 520−30=490；1280: 668−30=638）——即它本来就靠
column flex 容器默认的 `align-items: stretch` 占满整行，`width: 100% !important`
只是把同一件事又说了一遍；而 `flex-wrap` 在高度自适应的 column 容器里**永不触发**。
两档窄屏（640 / 700）下三格仍等宽、仍各占 1/3，网格没被破坏。

**结论：两条规则确认无效 ⇒ 删除。** 这是「删」的依据；如果它们还有任何可见效果，
上表在三档宽度下就会分叉。删除同时消除了「下一个人以为这里还有排版逻辑」这个误导源。

> ⚠️ 一处我自己写错又改掉的地方，记下来免得下一个人重踩：我最初把断言写成
> 「材料容器宽 === 行宽」，跑出来是 `false`，差点误判成「布局坏了」。实际上差值正是
> 边框+内边距，**是我的断言错了，不是布局错了**。断言已改成按内容盒比较。

---

## 6. M4 —— 证据已落盘

```
.superpowers/sdd/2026-09-23-p1-worksheet-plan/evidence-c3/   （18 个文件）
```
- 从 `/tmp/c3` 复制的**唯一形态证据**：`before-{700,820,1100,1280}.png`、
  `after-{640,700,820,1280}.png`、`after-standard-1280.png`、
  `empty-{advanced,standard}.png`、`captured-{advanced,standard}.json`
- 本次新拍的改动后截图：`c3-after-{640,700}.png`
- 复现方法（截图/流程/本次验证三个脚本）：`cdp-shot.mjs`、`cdp-flow.mjs`、`verify-c3.mjs`

目录在 `.superpowers/sdd/.gitignore`（内容为 `*`）下 ⇒ **gitignored 但在磁盘上**，
与本项目其他工作留痕一致。已用 `git check-ignore -v` 确认。

`verify-c3.mjs` 里 `m2` / `m2-control` / `std-trunc` / `i1` / `layout` 五个用例的用法：

```bash
node .superpowers/sdd/2026-09-23-p1-worksheet-plan/evidence-c3/verify-c3.mjs i1
node .superpowers/sdd/2026-09-23-p1-worksheet-plan/evidence-c3/verify-c3.mjs m2          # 137 份
node .superpowers/sdd/2026-09-23-p1-worksheet-plan/evidence-c3/verify-c3.mjs m2-control  # 3 份
node .superpowers/sdd/2026-09-23-p1-worksheet-plan/evidence-c3/verify-c3.mjs std-trunc
W=700 node .superpowers/sdd/2026-09-23-p1-worksheet-plan/evidence-c3/verify-c3.mjs layout
```
（脚本会自己拉一个 headless Chrome，**不碰真实数据库**，也不影响正在跑的 dev server。）

---

## 7. M5 —— 已修，纯符号收口到内核

`src/app/teacher/worksheets/edit/page.tsx` 的 import 拆成两条：

- `useWorksheetEditor`、`type SaveStatus` ← 仍在 `./use-worksheet-editor`
  （前者是 hook 本身，后者的定义就在 hook 文件里，内核里没有）
- `QUESTION_TYPE_OPTIONS`、`type QuestionType`、`type WorksheetDraft` ← 改从 `./worksheet-editor-core`

核对了 `worksheet-editor-core.ts` 确实导出这三个（`QuestionType` :32、
`QUESTION_TYPE_OPTIONS` :35、`WorksheetDraft` :392），且 `use-worksheet-editor.ts:28` 的
`export * from './worksheet-editor-core'` 是那条**重复路径**的来源，注释里写明了。
现在 `question-card.tsx` / `preview-modal.tsx` / `page.tsx` 三处都指内核。

---

## 8. M6（不做）

按控制器裁定**未动**。`keptKeys` 不去重是审查者自己不建议现在改的（M3 的目标是「不丢数据」，
加去重会引入新的丢弃语义）。已确认工作区里没有任何针对它改动 —— 见 §9 的提交内容
只含三个文件，其中不含 `server/` 下任何文件。

---

## 9. 提交

只提交本轮的三个源文件；`specs/` 下那两个**改动不是我的**（进分支时就已 modified），
未纳入本次提交；`.superpowers/` 的报告按本仓惯例不提交（前几次的报告同样是未跟踪状态）。

```
src/app/teacher/classroom/new/page.tsx        I1 + M1 + M2
src/app/globals.css                           M3
src/app/teacher/worksheets/edit/page.tsx      M5
```

## 10. 约束遵守情况

- ✅ 既有测试全过，且数字与基线逐位相同（72/72 + 385/385）
- ✅ 无新增 npm 依赖（`git diff` 不含 `package.json`）
- ✅ 提交信息、报告、注释全中文
- ✅ **没有对任何真实库执行 `prisma db push`**；验证脚本全程用桩数据拦截 `/api/*`
- ✅ `pnpm test` / `pnpm build` **没有并发**（逐个跑）
- ✅ 没有跑根目录 `pnpm build`（未用；只跑了 `tsc --noEmit` 与 `pnpm test`）
- ✅ **`./dev.sh` 没有被停过**，反而复用了它做浏览器验证
- ✅ 未改 `CLAUDE.md` / `dev.sh` / `release.sh` / `package.json`

## 11. 遗留 / 给最终审查

1. **`fieldErrors.agent` 是死代码**（§3）—— 智能体那块的红框与错误文字永不显示。
   不在本轮范围，未改。
2. **M6**（`keptKeys` 不去重）—— 按裁定未动。
3. **M3 的两条规则是「删」而不是「留」**—— 依据是 §5 那张 A/B 表；若审查者倾向保留
   （比如认为将来布局会改回去），恢复成本是三条 CSS 行，且当时的注释已如实记录了它们
   为什么无效。
