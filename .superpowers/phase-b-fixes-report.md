# 阶段 B 三处审查发现的修复报告

- 分支：`feat/p1-worksheet`
- 提交：`359cc0f` fix(worksheets): 整卷回退同清 submittedAt；为答案键黑名单补泄漏门与口径注释
- 涉及文件（4 个，全在 `server/src/`）：
  - `server/src/routes/worksheets.ts`
  - `server/src/services/worksheet-questions.ts`
  - `server/src/tests/worksheet-grade.test.ts`
  - `server/src/tests/worksheet-student.test.ts`
- 结论：**DONE**，三条全部修完，全量 **385 pass / 0 fail**（基线 384，新增 1 条）。

---

## 0. 基线

先清陈旧产物（本仓 `pnpm test` 不清理 `dist`，切分支后会跑到别的分支的测试）：

```
$ rm -rf server/dist && cd server && pnpm test
ℹ tests 384
ℹ pass 384
ℹ fail 0
```

修完后的全量：

```
$ cd server && pnpm test
ℹ tests 385
ℹ pass 385
ℹ fail 0
```

> ⚠️ 本仓 `server/package.json` 的 `test` 是 `pnpm build && node --test dist/tests/*.test.js`，
> 即**先 `tsc` 再跑**。所以测试文件里的类型错误会**先**让 `pnpm test` 编译失败 ——
> 这正是 F2 的编译期门能成立的前提（见 §2.3）。

---

## 1. F1 — 整卷回退不清 `WorksheetResponse.submittedAt`

### 改动

`server/src/routes/worksheets.ts`，`ensureResponse()`：

```diff
   return ctx.prisma.worksheetResponse.upsert({
     where: { classroomId_worksheetId_participantId: key },
     create: { ...key, status: 'in-progress', startedAt: now },
-    update: { status: 'in-progress' },
+    update: { status: 'in-progress', submittedAt: null },
   });
```

与题级回退（`PUT /:id/answers` 的 `update: { …, status: 'draft', submittedAt: null, isCorrect: null }`）
现在是对偶的：两处要么同对偶、要么同错。

### 断言读的是库里的行，不是处理器的返回值

`server/src/tests/worksheet-student.test.ts` 的
「状态：allowResubmit 为真时改已提交的题，本题回 draft、整卷回 in-progress」用例：

```ts
const rolledBack = await db.prisma.worksheetResponse.findFirstOrThrow();
assert.equal(rolledBack.status, 'in-progress');
assert.equal(rolledBack.submittedAt, null, '整卷回退必须同时清掉上一次的交卷时间戳，否则两列自相矛盾');
```

用的是 `db.prisma...findFirstOrThrow()` —— **从库里读回那一行**。
（处理器返回值里根本没有整卷那两列：`PUT /:id/answers` 只回 `{ success, questionId, status }`，
拿返回值断言等于什么都没断。这句也写进用例注释了。）

### 反证：把修复退回原样 ⇒ 必须变红（已做）

```
$ cp ... && python3 -c "把 update 改回 { status: 'in-progress' }"
反证补丁：把 F1 的修复退回原样（update 只写 status）
$ pnpm build && node --test dist/tests/worksheet-student.test.js
✖ 状态：allowResubmit 为真时改已提交的题，本题回 draft、整卷回 in-progress (374.030208ms)
ℹ tests 14
ℹ pass 13
ℹ fail 1
  AssertionError [ERR_ASSERTION]: 整卷回退必须同时清掉上一次的交卷时间戳，否则两列自相矛盾
```

还原后：

```
$ grep -n "update: { status: 'in-progress', submittedAt: null }," src/routes/worksheets.ts
814:    update: { status: 'in-progress', submittedAt: null },
$ node --test dist/tests/worksheet-student.test.js
ℹ tests 14 / pass 14 / fail 0
```

---

## 2. F2 — `ANSWER_KEYS` 是黑名单，补一条泄漏门

### 2.1 先确认「泄漏是真的」，不是纸面推理

`normalizeNode` 把 `data` 原样透传、`ANSWER_KEYS` 只删它列出的键，
所以一个不在表里的答案键**真的**会跟着 `student-view` 出去。实测：

```
$ node --input-type=module -e "
  import { stripAnswers } from './dist/services/worksheet-questions.js';
  const node = { id:'q1', type:'single-choice', prompt:'x', inputMode:'keyboard',
    data:{ options:[{key:'A',text:'甲'}], correctKeys:['A'], solution:'标准解法' }, children:[] };
  console.log(JSON.stringify(stripAnswers({schemaVersion:1,nodes:[node]}).nodes[0].data));"
student-view 实际下发的 data = {"options":[{"key":"A","text":"甲"}],"solution":"标准解法"}
```

`solution` 原样下发。规格 §5.4 的措辞是单数的 `answer`，而代码里的键是复数的 `answers`
—— 一个字的差别就是一次静默泄漏。

### 2.2 改动

`server/src/services/worksheet-questions.ts`：

- 题型注册表改为**运行时导出**（`QuestionType` 由它派生），测试可以**遍历**它，
  而不是在测试里把题型名抄一遍：
  ```ts
  export const QUESTION_TYPES = ['single-choice', 'fill-blank', 'short-answer'] as const;
  export type QuestionType = (typeof QUESTION_TYPES)[number];
  ```
- `ANSWER_KEYS` 由 `const` 改为 `export const`（仍是唯一来源，`stripAnswers` 照旧用它），
  并在注释里写明它是**黑名单**、漏一个就是泄漏、防线在哪条用例。

`server/src/tests/worksheet-grade.test.ts` 新增一条用例（+ `ANSWER_KEY_AUDIT` 样本表）：

1. 遍历 `QUESTION_TYPES`，每个题型都必须有登记样本；
2. 样本 `data` 的**每个键**都必须被声明成「答案」或「给学生」之一（双向，防样本与代码脱节）；
3. 🔴 **每个答案键都必须 ∈ `ANSWER_KEYS`** ← 本次要的那道门；
4. 每个「给学生」的键都必须 **∉** `ANSWER_KEYS`（反向：防多剥，学生拿到残缺的题）；
5. 行为对照：把样本做成一道真题，跑一遍**真实的 `stripAnswers`**，断言剩下的键
   **正好**是 `safeKeys` —— 只比键名的话，一个「`stripAnswers` 什么都不删」的实现也能让
   第 1–4 条全绿。

```
$ node --test dist/tests/worksheet-grade.test.js
✔ 🔴 每个题型的答案键都必须 ∈ ANSWER_KEYS（黑名单漏一个 = 静默泄漏给学生） (0.123458ms)
ℹ tests 10 / pass 10 / fail 0
```

### 2.3 反证（两条都做了）

**(a) 给某个题型的 `data` 加一个不在表里的答案键 `solution` ⇒ 必须变红**

```
反证补丁已打入：single-choice 的 data 多了一个答案键 solution（不在 ANSWER_KEYS 里）
$ pnpm build && node --test dist/tests/worksheet-grade.test.js
✖ 🔴 每个题型的答案键都必须 ∈ ANSWER_KEYS（黑名单漏一个 = 静默泄漏给学生） (0.276ms)
ℹ pass 9
ℹ fail 1
  AssertionError [ERR_ASSERTION]: 题型「single-choice」的答案键「solution」不在 ANSWER_KEYS 里
  ⇒ student-view 会把它原样下发给学生（规格 §5.4）
```

红的原因是**目标那一条断言**（不是样本自检那一条），正是要钉的失效形态。

**(b) 编译期门：`QUESTION_TYPES` 多一个题型、`ANSWER_KEY_AUDIT` 没补 ⇒ `tsc` 失败**

```
反证补丁：QUESTION_TYPES 多了一个题型 matching，但 ANSWER_KEY_AUDIT 没补
$ pnpm build
src/tests/worksheet-grade.test.ts(153,7): error TS2741: Property 'matching' is missing in type
'{ … }' but required in type 'Record<"single-choice" | "fill-blank" | "short-answer" | "matching", AnswerKeyAudit>'.
[ELIFECYCLE] Command failed with exit code 2.
```

`tsc` 失败 ⇒ `pnpm test` 整体失败 ⇒ M4 加题型时**连测试都跑不起来**，不会静默通过。

还原（两处补丁都验过不在了）：

```
$ grep -n "matching" src/services/worksheet-questions.ts ; grep -n "solution" src/tests/worksheet-grade.test.ts
(无输出)
$ grep -n "QUESTION_TYPES = " src/services/worksheet-questions.ts
11:export const QUESTION_TYPES = ['single-choice', 'fill-blank', 'short-answer'] as const;
$ node --test dist/tests/worksheet-grade.test.js
ℹ tests 10 / pass 10 / fail 0
```

### 2.4 这道门的**边界**（如实写在用例注释里，不要当成「已根治」）

- ✅ 挡得住：已声明的答案键不在 `ANSWER_KEYS` 里；题型加了没登记（编译期）；
  「给学生」的键被误列进黑名单。
- ❌ 挡不住：**加了答案键却根本不声明它**（把 `answer` 塞进 `data` 又不去动样本表）。
  黑名单上的键名本来就不可能被枚举出来。
- ⇒ 它是**回归门，不是证明**。真正的根治是改成 allowlist 投影
  （按题型列出哪些键安全，而不是列出哪些键危险）—— 那需要按题型判定「哪些键对学生安全」，
  是另一个决定，本次**刻意没做**，留给最终审查分诊。

### 2.5 顺带发现（未改，仅记录）

`routes/worksheets.ts:63` 另有一份 `QUESTION_TYPES: readonly string[]`（校验用），
与 `services/worksheet-questions.ts` 的新运行时注册表是**两份**。
不一致的后果是「新增题型被 400 拒绝」—— **响亮失败**，不是静默放行，
所以本次没有合并它们；已在那份新注册表的注释里写明此事。

---

## 3. F3 — 把整卷状态的口径写进注释

写在 `server/src/routes/worksheets.ts` 的 `ensureResponse()` 注释里（**回退那两列被写的就近处**，
也是 D 最可能读到的地方），并在**置 `submitted` 的那一处**加了指向它的交叉引用
（`// ⚠️ 这是全项目唯一把整卷置为 submitted 的地方 … 改这里之前先读那一段`）。

注释写明的三件事：

1. **何时置 `submitted` + `submittedAt = now`**：**只**在 `POST /:id/answers/submit` 里、
   当前 `content` 中的每一道题都已 `submitted` 时（判定式 `total > 0 && submittedCount >= total`）。
2. **何时回退、回退时两列各是什么**：**任何**一次保存或提交都无条件先回退成
   `in-progress` + `submittedAt = null`；提交路径紧接着若判定交齐会立刻再置回 `submitted`
   并写上**这一次**的时间戳。⇒ 在「学生只做保存/提交」的世界里两列不存在中间态。

### ⚠️ 未定义的情形：**如实写成「未定义」，没有编规则**

评审要求「不要编一个听起来合理的规则」，所以这三条**没有**给出「应该是什么」的规则，
而是明说没有任何代码路径处理、也没有测试覆盖，看板遇到必须自己现算：

- ① 已交卷后教师**加题**：整卷仍是 `submitted` + **旧的** `submittedAt`，此刻并不覆盖新题
  —— 教师端 `PUT /:id` 只写 `Worksheet.content`，一行 `WorksheetResponse` 都不碰。
- ② 未交卷时教师**删题**：把没交的那道删掉后剩下的题其实已全部提交，
  但**没有**任何路径在改单后重算整卷状态 ⇒ 会一直停在 `in-progress`。
- ③ ①② 的合意：`status === 'submitted'` 的准确含义是
  「**最后一次由学生触发的重算**那一刻，`content` 里的题全交了」，
  **不是**「此刻 `content` 里的题全交了」。要后者请现算，别信这两列。

**「散文声称了一个不存在的机制」的自查**：以上每一条都是从代码读出来/grep 出来的，不是推测 ——
本次修复前 `grep -rn "worksheetResponse\." src --include="*.ts" | grep -v src/tests/` 只有 **3 处**：

```
src/routes/worksheets.ts:218   prisma.worksheetResponse.count({ where: { worksheetId } }),   // 删除守卫计数
src/routes/worksheets.ts:778   return ctx.prisma.worksheetResponse.upsert({ … })             // ensureResponse（回退）
src/routes/worksheets.ts:938   await ctx.prisma.worksheetResponse.update({ … })              // submit（唯一置 submitted）
```

三处全部有主，所以「没有任何路径在改单后重算整卷状态」「`not-started` 没人写」这两句是可证的。

**另外补了一条容易误导的**：`schema.prisma` 那行 `// not-started | in-progress | submitted`
会让人以为 `not-started` 是个会出现的状态；实测它只是 DDL 的 `DEFAULT`
（`src/services/worksheet-schema.ts:56`），**没有任何代码写它**：

```
$ grep -rn "not-started" src/ prisma/schema.prisma | grep -v "src/tests/"
src/services/worksheet-schema.ts:56:    "status" TEXT NOT NULL DEFAULT 'not-started',
prisma/schema.prisma:464:  status        String   @default("not-started")  // not-started | in-progress | submitted
```

注释里明说了「没有这一行 = 学生没开始」与「有这一行且 in-progress = 开始了」是两件事，
别拿 `not-started` 表示前者。

---

## 4. 全局约束逐条核对

| # | 约束 | 核对 |
|---|---|---|
| 1 | 既有测试继续全过 | ✅ 385 pass / 0 fail（基线 384 + 新增 1） |
| 2 | 不新增 npm 依赖 | ✅ 只改了 `package.json` 之外的源码，`git diff --stat` 无依赖文件 |
| 3 | 提交信息、报告、注释中文 | ✅ |
| 4 | 🔴 绝不 `prisma db push` 打在真实库上 | ✅ 见 §5。测试全部 `openTempDb()` 到 `os.tmpdir()`，且每条都带 `assert.ok(url.startsWith('file:'+os.tmpdir()))` 与 `assert.notEqual(…, prisma/dev.db)` 两道自断言闸门 |
| 5 | 只允许一个 `pnpm build`/`pnpm test` 在跑 | ✅ 全部串行；基线那一次用后台跑，**完成并取到结果后**才开始改代码 |
| 6 | 不跑根目录 `pnpm build` | ✅ 只跑过 `cd server && pnpm build`（= `tsc`）与 `cd server && pnpm test` |
| 7 | 不停 `./dev.sh` | ✅ 全程未停；改完源码后 `tsx watch` 自己重启了一次（见 §5.3），未干预 |
| 8 | 不碰 `CLAUDE.md`/`dev.sh`/`release.sh`/`package.json` | ✅ `git status` 里这四者均未出现 |
| 9 | 测试若改数据库须逐表还原 + 证据 | ✅ 见 §5（结论：**测试没改真实库**） |
| 10 | 「因此安全/已覆盖/已修复」必须附命令或实测输出 | ✅ 每条结论都附了命令与输出，含两处反证 |
| 11 | 三件套叫「学习单 · 探究空间 · 智能学伴」 | ✅ 本次注释/文案未新增三件套称谓；涉及处只说「学习单」 |

---

## 5. 数据库证据（约束 4 与 9）

### 5.1 第一次「指纹变了」——**不是测试干的**，查清了

跑完第一次全量后 `dev.db` 的 SHA-256 变了，没有放过这个信号，继续查：

```
（全量前）mtime=2026-09-23 13:45:49  sha256=dea13be0…f0c0b9
（全量后）mtime=2026-09-23 13:45:53  sha256=c7d50148…e75556   ← 变了
```

`dev.db` 大小两次都是 `4005888`（没变），且有活跃的 dev server（PID 21221，端口 4001，
dev 模式下 `DATABASE_URL` 就是 `server/prisma/dev.db`）。先做「静置观察」排除自增写入：

```
观察 40 秒（期间不跑任何测试）
13:46:19  mtime=13:45:53 …
…（8 次采样全部 mtime=13:45:53）
13:46:54  mtime=13:45:53
```

静置不自增。于是做**受控实验**：取指纹 → 跑全量 → 再取指纹。

### 5.2 受控实验：全量测试对 `dev.db` **零影响**

```
实验开始=13:47:04
  mtime=13:45:53  sha256=c7d50148…e75556      ← 实验前
$ pnpm test        （13:47:05 → 13:47:22）
ℹ tests 385 / pass 385 / fail 0
实验后：
  mtime=13:45:53  sha256=c7d50148…e75556      ← 与实验前**逐字节相同**
```

⇒ **测试套件不碰 `dev.db`**（mtime 与 SHA-256 前后一致）。这也就是约束 9 要求的
「改了就逐表还原并给证据」的**阴性证据**：本次无需还原，因为没有改动。

### 5.3 那 13:45:53 的写入是谁：dev server 因我的编辑而重启

```
$ tail .dev/logs/server.log
1:45:37 PM [tsx] change in ./src/routes/worksheets.ts Restarting...
[server] Received SIGTERM, shutting down gracefully...
[server] SQLite version: 3.46.0
[server] Classroom participant migration complete
🚀 ClassNode Server running on port 4001
[AgentChecker] 开始检测 2 个智能体...
```

`tsx watch` 在 13:45:37 检测到我对 `src/routes/worksheets.ts` 的编辑 → 重启 →
启动路径（participant migration + AgentChecker）写库 → 13:45:49 / 13:45:53 两次 mtime 前进。
**这是 dev server 的正常启动行为，不是测试污染**，且它每改一次 server 源码就会发生一次
（约束 7 要求不停 dev.sh，所以这是本任务下不可避免的）。表结构未变（文件大小不变）。

### 5.4 临时库清理

```
$ ls -d /tmp/cn-worksheet-* 2>/dev/null
(无输出 —— 各用例 t.after 里 fs.rmSync 已清理)
```

---

## 6. 自查（按评审给的三个问题）

- **F1**：断言读的是**库里的行**吗？ → 是。`db.prisma.worksheetResponse.findFirstOrThrow()`，
  且用例注释里写明了「`PUT` 的返回值里根本没有整卷那两列，拿返回值断言等于什么都没断」。
  反证：退回旧代码 → 该用例红（§1）。
- **F2**：反证做了吗？`solution` 真的红吗？ → 做了，而且做了**两条**：
  (a) 加 `solution` 答案键 → 目标断言红，报错文案就是「不在 ANSWER_KEYS 里 ⇒ 会原样下发给学生」；
  (b) 加题型不登记 → `tsc` 报 TS2741，`pnpm test` 编译阶段就失败。两处都已还原并复验绿（§2.3）。
  另外先实测了「泄漏是真的」（`solution` 确实原样出现在 `student-view` 的 data 里，§2.1），
  而不是只论证它是真的。
- **F3**：有没有把「未定义」写成「有规则」？ → 没有。三种情形都明写「**未定义**」+
  「没有任何代码路径处理、没有测试覆盖」+「看板不能假定这两列成立，要自己现算」，
  并附了可证的依据（全项目只有 3 处访问这两列、全部有主）。没有给出任何
  「应该显示成 X」的规则。

---

## 7. 遗留（不在本次范围，留给最终审查分诊）

1. **allowlist 投影**：把答案剥离从黑名单改成按题型的 allowlist。需要判定「每个题型哪些键
   对学生安全」，是产品决定。本次只加了回归门。
2. **F2 门的固有边界**：挡不住「加了答案键却不声明」（§2.4）。
3. **两份 `QUESTION_TYPES`**（§2.5）：不一致是响亮失败，本次未合并。
4. **改单后不重算整卷状态**（§3 的①②）：注释已如实标为未定义；若 D 的看板要显示
   「已交 N/M」，需要现算而非读 `WorksheetResponse`。
5. 本次修复让 dev server 重启过一次（tsx watch 检测到源码变更），期间它会短暂不可用 ——
   若用户当时正在浏览器里验证，可能看到一次断连。已在 §5.3 记明原因。
