# C2 审查修复报告（I2 / I1 / M1 / M2 / M3）

分支 `feat/p1-worksheet` · 提交 `f67cbb2` + `d954b0b`

---

## 0. 基线（改动前现测）

```
$ npx tsc --noEmit ; echo $?          →  0
$ npx eslint <本次涉及的文件> --max-warnings 0 ; echo $?  →  0
$ pnpm test                            →  ℹ tests 385 · pass 385 · fail 0
```

⚠️ 当时的根 `test` 就是 `pnpm --filter classnode-server test`，**前端测试一条都没跑**
（`src/lib/classroom-material.test.ts` 是个没人执行的文件）。`server/dist` 是新鲜的，
没有 `rm -rf` 的必要。

---

## 1. I2（最重）—— 撤销栈的回归网留在仓库里

### 1.1 关键事实的实测确认

审查者给的判断成立：那段纯函数区块**只用了类型**。

```
$ grep -n "^import\|require(" src/app/teacher/worksheets/edit/worksheet-editor-core.ts
23:import type { WorksheetContent, WorksheetQuestionNode, WorksheetSettings } from '@/lib/types';
```

全文唯一的 import 是 `import type`。Node 24 的类型擦除把整条语句删掉，运行时一次模块解析
都不发生，`@/lib/types` 这个路径别名不需要在运行时存在。**零新依赖、零测试框架**。

### 1.2 搬家是逐字的（机器比对，不是眼看）

脚本把 HEAD 版 `use-worksheet-editor.ts` 的第 25–415 行（两个 `// >>> … >>>` 标记之间）
与第 874–897 行（两个 `normalize*` 函数）拼起来，与新文件正文逐行比：

```
与 HEAD 原文的差异行数: 2 （应为 2：两个 export 关键字）
  line 397   exp: function normalizeLoadedContent(...)      act: export function normalizeLoadedContent(...)
  line 408   exp: function normalizeLoadedSettings(...)     act: export function normalizeLoadedSettings(...)
pure-block 段（1..390）逐字一致: true
```

**只有两处差异，都是为了「让 hook 能 import 这两个函数」加的 `export`。**
纯函数区块本身（标记之内的全部内容，含所有解释设计取舍的注释）逐字未变。

hook 那一侧也做了同样的比对：

```
原: 455 行 / 现: 455 行
hook 正文逐字一致: true          # 从 `/** 编辑器地址。` 到文件末，与原文件逐字相同
```

### 1.3 搬家范围的一处**主动扩大**（请审查者注意）

任务的原文是「把纯函数区块抽到 core（reducer、`newQuestion`、`randomIdSuffix`、以及任何
不依赖 React 的辅助）」。标记之外、文件底部的 `normalizeLoadedContent` /
`normalizeLoadedSettings` 也是纯函数，我把它们一并搬了（这就是上面那两处 `export` 的来源）。

理由：**M2 的修复要同时改 `isQuestionNode` 与 `normalizeLoadedContent` 两处**，而 M2 的
病根正是「两处各写一份差不多的判据」。如果 `normalizeLoadedContent` 留在 hook 里，那它
就落在 `node --test` 够不着的地方 —— M2 修完将**无法被回归网钉住**。搬完之后两者共用
同一道守卫，两条用例（`parseDraft` 与 `normalizeLoadedContent`）才能真的变红。

### 1.4 回归网：`worksheet-editor-core.test.ts`（54 条）

原 19 条断言的覆盖点一一对应重建，另补了 M1/M2/M3 的三组与几处边界：

| 覆盖点 | 用例 |
|---|---|
| 题目 id 改序后不漂移 | `🔴 move 交换位置，题目 id 与内容整块跟着走`（比对**引用**，证明是搬过去不是重建） |
| 越界 move 不进栈且返回同一对象 | `🔴 越界 move（第一题按 ▲ / 最后一题按 ▼）返回同一个对象，且不进栈` |
| 同值 `updatePrompt` 返回同一对象 | `🔴 同值 updatePrompt 返回同一个对象（不进栈、不产生空步撤销）` |
| 空栈 undo/redo 是 no-op | 两条 |
| 新改动清空 future | `🔴 新的改动清空 future（重做那条线失效）` |
| 历史栈上限 | 做 230 次改动 ⇒ `past.length === 200`，且栈底是「第 30 次改动之前」那一份 |
| 选项重编号后正确答案跟着**文本**走 | `🔴 删掉第一个选项后，正确答案仍然落在**同一段文本**上`（断言的是文本，不是字母） |
| 填空题空行处理 | `readFillAnswers` / `writeFillAnswers`（保留空行、往返无损）/ `sanitizeContentForSave`（出网前去空行） |
| 草稿形状校验 | `parseDraft` 六条：非 JSON、顶层字段逐个缺失、`savedAt` 为 NaN、节点形状 |
| 其余 | `optionKey`、`newQuestion`（含 `correctKeys` 默认**空**不是 `['A']`）、`readOptions` 容错、`draftKeyFor`、`buildPayload`、reset 不进栈、remove 未命中、`normalizeLoadedSettings` |

**数量 54（原 19 不必凑数，覆盖点一一对应且有余）。**

### 1.5 接进 `pnpm test` —— 前端用例真的跑起来了

根 `package.json`：

```json
"test": "pnpm test:client && pnpm test:server",
"test:client": "node --test \"src/**/*.test.ts\"",
"test:server": "pnpm --filter classnode-server test",
```

`test:server` 与改动前的 `test` **一字不差**，服务端那批的调用方式（含 `pnpm build` 与
cwd=server）完全没动 —— 「保住服务端照跑」是**结构上**保住的，不是我跑了两次看着像对。

用 glob 而不是列文件名：将来新增的 `src/**/*.test.ts` 自动进入，不会静默落在门外。
实测 glob 与枚举等价（仓库里正好 2 个文件，18 + 54 = 72）。

**`pnpm test`（根目录）输出——前端用例名看得见：**

```
$ pnpm test
✔ 🔴 越界 move（第一题按 ▲）返回同一个对象，且不进栈 (0.042458ms)
✔ 🔴 同值 updateData 返回同一个对象（与 updatePrompt 同一条规矩） (0.066916ms)
✔ 🔴 30 个选项的单子：改一处选项后仍然是 30 个，一个都没被砍掉 (0.056125ms)
✔ 🔴 parseDraft：节点缺 id / 缺 type / **缺 data** ⇒ 整份作废 (0.050125ms)
✔ 🔴 normalizeLoadedContent：缺 data 的节点被丢掉（否则编辑页 TypeError） (0.040792ms)
…
ℹ tests 72   ℹ pass 72   ℹ fail 0        # ← 前端（classroom-material 18 + worksheet-editor-core 54）
ℹ tests 385  ℹ pass 385  ℹ fail 0        # ← 服务端，与基线同数
```

**服务端那批还在跑，且数字与基线一字不差（385/385）。**
顺带治好 `src/lib/classroom-material.test.ts`（那 18 条今天起才真的被执行）。

---

## 2. 反证（把实现改坏，测试必须变红）

### 反证 ①：越界 move（任务点名的这一条）

```bash
# 破坏：把「原样返回」改成造一个新对象
- if (index < 0 || target < 0 || target >= content.nodes.length) return content;
+ if (index < 0 || target < 0 || target >= content.nodes.length) return { ...content, nodes: content.nodes.slice() };

$ node --test src/app/teacher/worksheets/edit/worksheet-editor-core.test.ts
✖ 🔴 越界 move（第一题按 ▲）返回同一个对象，且不进栈 (0.675292ms)
✖ 🔴 越界 move（最后一题按 ▼）返回同一个对象，且不进栈 (0.192292ms)
✖ move 一个不存在的 id ⇒ 同一对象（不插队、不报错） (0.129708ms)
ℹ tests 54 · pass 51 · fail 3

$ cp /tmp/core-backup.ts … && node --test …
ℹ tests 54 · pass 54 · fail 0
```

### 反证 ②：M3 与 M2 同时回退

```bash
# 破坏：writeOptions 回到 slice(0, MAX_OPTIONS)；isQuestionNode 不再查 data
$ node --test src/app/teacher/worksheets/edit/worksheet-editor-core.test.ts
✖ 🔴 30 个选项的单子：改一处选项后仍然是 30 个，一个都没被砍掉 (0.375416ms)
✖ 🔴 30 个选项、正确答案在第 28 个：答案**不丢**（原来会变成空数组） (0.2365ms)
✖ 🔴 parseDraft：节点缺 id / 缺 type / **缺 data** ⇒ 整份作废 (0.247375ms)
✖ 🔴 normalizeLoadedContent：缺 data 的节点被丢掉（否则编辑页 TypeError） (0.089708ms)
ℹ tests 54 · pass 50 · fail 4
```

第 2 条还顺带**实测出了 M3 的病**（旧实现下的真实返回）：

```
AssertionError: Expected values to be strictly deep-equal:
+ actual - expected
+ []
- [ 'k28' ]
```

`correctKeys` 从 `['k28']` 变成 `[]` —— 正是「没有报错」的那一步。

还原后复跑：`ℹ tests 54 · pass 54 · fail 0`。

---

## 3. I1 —— 预览的第二真源

`preview-modal.tsx` 顶部按任务要求写成**给下一个人的事实说明**（不是 TODO、没有 TODO 字样）：

- **为什么它现在是模仿**：学生端的学习单面板还没落地（D2），此刻还没有第二份实现可以跟它分叉。
- **什么时候必须换**：D2 一落地就不能再成立 —— 同一份 `content` 会被两段各自演化的 JSX 画出来，
  而**教师是拿这个弹窗当验收依据的**（规格 §6.3 原话「教师看到的就是学生看到的宽度」）。
- **换谁**：D2 / 学生端学习单面板（`src/app/classroom/` 下新增的那个面板），按学生身份渲染。
- **换了之后什么会变好**：预览不再是一份要同步维护的第二实现；「按 iPad 宽度渲染」那句承诺
  由真组件自己兑现（现在它靠一个写死的 768px 常量）。

顺带把 `preview-modal.tsx` / `question-card.tsx` 的 import 从 hook 改指内核 —— 这两个文件
只吃纯逻辑，指向内核之后「纯逻辑住在哪、回归网在哪」在它们的头上就看得见。

---

## 4. M1 / M2 / M3

### M1 —— `updateData` 同值去重

照 `updatePrompt` 的写法：逐个键 `===`，全同就 `return node`（`replaceNode` 见引用没变
便原样返回 content，`contentReducer` 便返回同一个 state，不进栈）。空补丁也走这条
（`every` 对空数组为真）。

**刻意不做深比较，理由已写进代码注释**：补丁里的 `options` / `correctKeys` 由 `writeOptions`
每次新造，按引用比必然不同、照常进栈；而深比较一旦遇上「就地改了数组再交进来」，会把
**真的变化**判成没变 —— 那比多一格撤销严重得多。这条边界有专门用例钉住，免得下一个人
以为它会做深比较。

### M2 —— 守卫补到与注释一致

`isQuestionNode` 加一行 `data` 检查（必须是**非数组的对象**：`data: null` 与 `data: []`
同样会被 `readOptions` 解引用成 `undefined.options` / `undefined`，都不能放行），并让
`normalizeLoadedContent` 从「只查是个对象」改成用**同一道** `isQuestionNode`。
`parseDraft` 与它现在共用一份判据 —— 两处各写一份「差不多」正是漏掉 `data` 的地方。

### M3 —— 选项不再静默截断（**选的是「不丢数据」**）

两条路我都评估过，选了**不丢数据**：

- 「把上限提到一个不会撞到服务端的值」不成立 —— 服务端**根本不设上限**
  （`server/src/services/worksheet-questions.ts` 的 `validateQuestion` 只要求
  `options.length >= 2`），所以任何有限值都只是把悬崖挪个位置，病还在。
- 因此改成：A–Z 之内照旧按位置重编号；**超出的原样保留 key，既不重编号也不丢弃**；
  `correctKeys` 里指向这些 key 的直接放行。教师把选项删回 26 个以内时会自然重新编号回 A–Z。

`MAX_OPTIONS` 的含义随之收窄并写进注释：它是「加号按不动了」的那条线（界面**新建**的上限），
不是读既有内容时的硬顶。

**代价（已知并写在注释里）**：>26 选项的题在缩回 26 以内之前，第 27 个起的 key 不是单字母。
这是刻意的取舍 —— 键长得怪是**看得见**的，少 4 个选项和空掉的正确答案是**看不见**的。

---

## 5. 验证（最终态）

```
$ npx tsc --noEmit                                   →  exit 0
$ npx eslint src/app/teacher/worksheets/edit/ \
             src/lib/classroom-material.test.ts \
             --max-warnings 0                        →  exit 0
$ pnpm test   →  72 / 72 pass（前端）  ·  385 / 385 pass（服务端，与基线同数）
```

约束遵守情况：未跑根目录 `pnpm build`（只跑过 `cd server && pnpm test` 内部的 `pnpm build`）；
未停 `./dev.sh`；未动 `CLAUDE.md` / `dev.sh` / `release.sh`；未跑 `prisma db push`；
`package.json` 只动 scripts，**依赖一段未改**（机器核对过 diff）；提交信息中文。

```
$ git diff bbeb51a..HEAD -- package.json | grep -E "dependencies|:.*\^"
（空）
$ git diff bbeb51a..HEAD --name-only -- CLAUDE.md dev.sh release.sh server/prisma
（空）
```

---

## 6. 遗留与需要审查者裁决的点

1. ⚠️ **一次未能复现的 `dist/tests/webapp-host.test.js` 失败**（诚实记下）。
   改动后的**第一次**根 `pnpm test` 里它红了：`✖ dist/tests/webapp-host.test.js (177.2ms)`，
   总数 `383 / pass 382 / fail 1`。之后：

   ```
   单跑该文件 12 次：run 1..12 全部 ℹ pass 16 ℹ fail 0
   根 pnpm test 4 次：全部 72/72 · 385/385
   ```

   我改的是根 `test` 脚本，它只是在服务端那批**之前**多起了一个互不相干的进程，
   理论上碰不到服务端用例的内部；失败点在 177ms（很早，丢 2 条子用例）。**没能复现，
   也没能定性**。按本项目的口径这属于「没找到解释的绿」，值得下一轮扫一眼
   `server/src/tests/webapp-host.test.ts`（它内部起 HTTP 服务、临时改 `CLASSNODE_WEBAPP_PORT`）。

2. **`test:client && test:server` 是 fail-fast**：前端测试红时，同一次调用里服务端那批不会跑。
   要的是「一眼看到最该修的那条」，代价是丢一次服务端信号。不引入依赖的前提下，
   更彻底的聚合要么写脚本、要么把 cwd 不同的两批塞进同一个 `node --test`（后者会改变
   服务端那批的调用方式，风险更大）。要改成别的形态请说一声。

3. **M1 的比较是逐个键的 `===`**（与 `updatePrompt` 逐字同形）：数组/对象值的补丁按引用比，
   内容相同但引用不同时仍然进栈。这是刻意的，但它是「M1 只解决了一部分」——
   如果审查者要的是「数组同内容也不进栈」，那需要深比较，请明确裁决（我不建议）。

4. 不做清单（M4–M8、规格 §6.4 删题文案）按控制器裁定**未动**。
