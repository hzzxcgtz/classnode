# 热修报告：高级模式下学生帧被全数拒绝（探究助手快照不显示）

**分支**：`fix/webapp-material-authority`（从 `feat/p2-explore-assistant` 的 `ee655f3` 分出）
**提交**：`6dc9538`
**状态**：DONE

---

## 一、根因确认（我自己的复现，不是转述 brief）

`resolveWebappReporter`（`server/src/socket/index.ts:1299`）问的是
「**本课堂**的 `ClassroomWebapp` 关联过这个网页吗」，而高级模式的网页权威来源是
「每组一份」，该模式下 `ClassroomWebapp` **恒为空** ⇒ 学生端每一帧都在这里被拒。

四条独立证据（全部只读，未写真实库）：

```
$ sqlite3 -readonly server/prisma/dev.db "SELECT id, mode, status FROM Classroom WHERE mode='advanced';"
f7eefffb-35c3-4c06-b38b-7e52c8902878|advanced|active

$ sqlite3 -readonly server/prisma/dev.db "SELECT COUNT(*) FROM ClassroomWebapp WHERE classroomId='f7eefffb-…';"
0

$ sqlite3 -readonly server/prisma/dev.db "SELECT g.name, m.kind, m.targetId FROM ClassroomGroupMaterial m
    JOIN ClassroomGroup g ON g.id=m.groupId WHERE g.classroomId='f7eefffb-…';"
贾家组|agent|fa1e3de0-a209-4937-872d-94ac20ffa722
贾家组|webapp|f83923e7-be25-4a8f-aa5e-6309ab280677
薛家组|agent|a3ab6ffb-14e3-4023-acd5-fa926b985b38
薛家组|webapp|51ec6216-cef0-4c66-8ac1-653ab5cb5009

$ grep -c "webapp-frame 被拒：这个网页没有关联到本课堂" .dev/logs/server.log
119
$ grep -o "classroom=[a-f0-9-]* webappId=[a-f0-9-]*" .dev/logs/server.log | sort -u
classroom=f7eefffb-… webappId=51ec6216-cef0-4c66-8ac1-653ab5cb5009
classroom=f7eefffb-… webappId=f83923e7-be25-4a8f-aa5e-6309ab280677
```

**闭合**：被拒的两个 webappId **恰好**就是两个组各自配的那一份，而课堂级为 0 行。
学生端上报的是自己组的正确网页，被判据拒掉 —— 与「学生端有问题」无关。

**为什么它静默坏了几轮**：`resolveWebappReporter` 零测试覆盖。动手前实测：

```
$ grep -rc "这个网页没有关联到本课堂" server/src/tests/
0 次（src/tests 下无任何文件提到过它）
```

---

## 二、What I implemented

### 2.1 `resolveParticipantWebappId`（`server/src/services/group-material-resolve.ts`）

```ts
export async function resolveParticipantWebappId(
  prisma: PrismaClient,
  input: { classroomId: string; participantId: string },
): Promise<string | null>
```

- 只负责把 `resolveMaterialTargetId` 的入参查齐；**「高级模式不回落」没有重写**。
- 两波并行查询：① `Classroom.mode` + `ClassroomStudent.groupId`；
  ② 本课堂各组的 `ClassroomGroupMaterial(kind='webapp')` + 课堂级那一份。
- `ClassroomStudent` 的 where **同时**带 `classroomId`（少了它，别的课堂的参与者 id
  会拿到那个课堂的材料 —— 有专门一条阴性对照用例）。
- 课堂级那一份的 `orderBy` 与读路径**逐字一致**，实测：

```
$ grep -n "orderBy: \[{ createdAt: 'asc' }, { id: 'asc' }\]" \
    server/src/routes/webapps.ts server/src/routes/classroom.ts server/src/services/group-material-resolve.ts
server/src/services/group-material-resolve.ts:82:      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
server/src/routes/webapps.ts:787:      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],   ← loadClassroomWebapps
server/src/routes/classroom.ts:236:    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
server/src/routes/classroom.ts:588:          webapps: { select: { webappId: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
```

并有一条**运行时**对照（真 SQLite）：`resolveParticipantWebappId` 的返回值必须等于
`loadClassroomWebapps(...)[0].id`，两种形态各一条 —— `createdAt` 不同（写入顺序与时间
顺序刻意相反）与 `createdAt` 逐字相同（打平后按关联行 id 兜底，用显式 linkId 独立推出
期望值，不复述生产代码）。

### 2.2 `resolveWebappReporter` 改用它

```ts
const [classroom, effective] = await Promise.all([
  prisma.classroom.findUnique({ where: { id: classroomId }, select: { status: true } }),
  resolveParticipantWebappId(prisma, { classroomId, participantId: membership.id }),
]);
if (effective === null) return { ok: false, reason: '该学生（或其小组）没有配置探究网页' };
if (effective !== webappId) {
  return { ok: false, reason: `上报的网页不是该学生的有效网页（有效 ${effective}，上报 ${webappId}）` };
}
if (classroom?.status === 'ended') return { ok: false, reason: '课堂已结束' };
```

**改严了，改前改后的差别（已写进代码注释）**：

| | 改前 | 改后 |
|---|---|---|
| 问的是 | 「**本课堂**关联过这个网页吗」（课堂级 `ClassroomWebapp`） | 「**这是你自己的**网页吗」（按该参与者的模式/组解析） |
| 高级模式 | 那张表恒为空 ⇒ **每帧都拒**（本次事故） | 按组解析 ⇒ 正常放行 |
| 越权 | 只要课堂级关联过，学生能替**别的组**送帧、污染那个网页的统计 | 堵上 |

**保留下来的（逐条核对，未动）**：
- `socket.data.studentId` / `socket.data.classroomId` 检查 + 拒因文案；
- `socket.rooms.has('classroom:' + classroomId)` 检查 + 「这一条最常见，也最容易被误读」
  整段注释；
- 「课堂已结束 ⇒ 不再收上报」检查 + 它整段注释（只挡 `ended`、不挡 `paused`，
  restore 后自动恢复）；状态改为**单独查一次主键**（旧实现搭在作废的那次查询上顺带取回），
  与新判定**并行**发；
- 三处调用点与日志里 ` classroom=… webappId=…` 的后缀格式（`1381 / 1470 / 1533` 三行未改）。

**三处调用点确实共用这一个函数（核对过）**：

```
$ grep -n "async function resolveWebappReporter\|await resolveWebappReporter" server/src/socket/index.ts
1299:    async function resolveWebappReporter(classroomId: string, webappId: string): Promise<
1371:        const reporter = await resolveWebappReporter(...)   ← webapp-event（文字档，1367）
1465:        const reporter = await resolveWebappReporter(...)   ← webapp-frame（帧，1446）
1530:        const reporter = await resolveWebappReporter(...)   ← webapp-diag（诊断，1521）
```

一处定义、三处调用 ⇒ 只改这一处即覆盖三条链路。它们在 socket 处理器闭包内部、
测试够不着，所以 2.1 的抽取正是为了可测。

**未引入缓存**（按 brief 2.3）。

---

## 三、TDD Evidence

### 基线

先现测基线时发现 **`server/dist/` 是另一个分支的陈旧产物**：`node --test dist/tests/*.test.js`
会把它一起跑。多出来的 `.test.js` 是 5 个 `worksheet-*`（每个 4 个产物：
`.js` / `.js.map` / `.d.ts` / `.d.ts.map`，共 20 个文件 = 132 − 112，见下），
而本分支 schema 里没有 `Worksheet`：

```
$ grep -n "model Worksheet" server/prisma/schema.prisma    → 无（exit 1）
$ ls server/src/tests | grep -i worksheet                   → 无
$ ls server/dist/tests | grep -i worksheet                  → worksheet-grade / -realtime / -routes / -schema / -student .test.js
$ ls server/dist/tests | wc -l        → 132     ← 动手前
$ ls server/src/tests | wc -l         → 27      ← 对应的源文件
$ rm -rf dist && pnpm build && ls dist/tests/*.test.js | wc -l   → 28（= 27 + 我新增的那条，逐一对上）
```

基线因此是**红的**（`The table main.Worksheet does not exist`、`500 !== 404`）。
`dist/` 是 `gitignore` 的构建产物（`git check-ignore -v server/dist` → `.gitignore:49`），
且 dev 服务端跑的是 `tsx watch src/index.ts`（`server/package.json` 的 `dev` 脚本）而
**不是** `dist/` ⇒ 清掉它对运行中的 dev 环境无影响。

```
$ rm -rf server/dist && cd server && pnpm test
ℹ tests 293   ℹ pass 293   ℹ fail 0   ← 基线（我记下的数字）
```

### RED（两段）

**RED #1 —— 编译期**：新测试引用的导出还不存在。

```
src/tests/group-material-participant-webapp.test.ts(9,10): error TS2305:
  Module '"../services/group-material-resolve.js"' has no exported member 'resolveParticipantWebappId'.
```

**RED #2 —— 只实现 2.1、2.2 仍是旧口径**（这一条才是真证据：**线上症状被复现**）：

```
$ node --test dist/tests/group-material-participant-webapp.test.js dist/tests/webapp-monitor.test.js
ℹ tests 76   ℹ pass 75   ℹ fail 1
✖ failing tests:
✖ 🔴 高级模式：本组配了网页、课堂级关联为空 ⇒ 帧必须被接收

  AssertionError [ERR_ASSERTION]: 本组配了网页 ⇒ 这一帧必须转发给教师看板（线上症状就是这里被拒）
  0 !== 1
```

**唯一的一条红，就是用户报的那件事**（帧没被转发 ⇒ 快照不显示）。12 条单测全绿，
因为它们测的是 2.1。

### GREEN

```
$ cd server && pnpm test
ℹ tests 308   ℹ pass 308   ℹ fail 0
```

293 → 308：新增 12 条 `resolveParticipantWebappId` 单测 + 3 条 socket 级用例。

---

## 四、反证证据（★ 本次唯一的通过对照，未省）

把 2.2 的判定**临时改回**「查 `ClassroomWebapp`」（即旧代码原样），其余不动：

```
$ grep -n "反证用" server/src/socket/index.ts
1316:      // 【反证用·临时改回旧口径】旧判定：本课堂关联过这个网页吗

$ cd server && pnpm build && node --test dist/tests/webapp-monitor.test.js
ℹ tests 64   ℹ pass 63   ℹ fail 1
✖ failing tests:
✖ 🔴 高级模式：本组配了网页、课堂级关联为空 ⇒ 帧必须被接收

  AssertionError [ERR_ASSERTION]: 本组配了网页 ⇒ 这一帧必须转发给教师看板（线上症状就是这里被拒）
  0 !== 1
```

**同时**（说明这条反证为什么必须有 socket 级用例）：单测文件在同一状态下**全绿** ——
它测的是 2.1，2.1 没被改。

```
$ node --test dist/tests/group-material-participant-webapp.test.js
ℹ tests 12   ℹ pass 12   ℹ fail 0
```

还原并逐字验证还原到位：

```
$ cp /tmp/index.ts.fixed server/src/socket/index.ts
$ diff /tmp/index.ts.fixed server/src/socket/index.ts && echo "(无差异)"
(无差异)
$ grep -c "反证用" server/src/socket/index.ts
0
$ cd server && pnpm test
ℹ tests 308   ℹ pass 308   ℹ fail 0
```

---

## 五、Files changed

| 文件 | 改动 |
|---|---|
| `server/src/services/group-material-resolve.ts` | +65：新增 `resolveParticipantWebappId` |
| `server/src/socket/index.ts` | +19/-15：`resolveWebappReporter` 改用它 + import；四条既有检查原样保留 |
| `server/src/tests/group-material-participant-webapp.test.ts` | 新增（12 条，真 Prisma + 真 SQLite 临时库） |
| `server/src/tests/webapp-monitor.test.ts` | 假 prisma 改为与新查询同形（并如实回答旧判据那一问）；+3 条 socket 级用例；decorate 1 条既有用例 |

**未新增任何 npm 依赖**（`git show --stat HEAD` 里没有 `package.json` / lockfile）。
**未碰**那两处「明确不做」：

```
$ git show --stat HEAD | grep -E "routes/webapps.ts|teacher/page.tsx"
(未出现在本次提交里)
```

**未在真实库上跑过任何 `db push`**：

```
$ git show --stat HEAD -- server/prisma/dev.db
(无)
$ sqlite3 -readonly server/prisma/dev.db "…"   ← 复查，数字与动手前逐字一致
advanced / 0 / 4
```

`withDb()` 在每次 `db push` 之前断言 `DATABASE_URL` 指向 `os.tmpdir()` 且
`path.resolve(file) !== server/prisma/dev.db`。

---

## 六、Self-review findings

1. **根因被修的是根因，不是症状**：判定改问「这是你自己的网页吗」。
   单测「本组没配、**别的组**配了 ⇒ `null`」与「本组没配、课堂级**故意**放一个 ⇒ `null`」
   两条都带非空自检（后者先断言课堂级确实有 1 行，否则「不回落」无从谈起）。
2. **`classroomLevelId` 的排序**：grep 四处的 `orderBy` 逐字相同（见 §2.1），
   另有两条运行时对照用例。
3. **保留项**：四条既有检查与注释逐条核对在位；三处调用点与日志后缀未动（§2.2）。
4. **Discipline**：未碰两处「明确不做」（附命令）；未做超出 brief 的事。
5. **一处必须说明的既有用例改动**：`webapp-monitor.test.ts` 里的
   `drain 返回每个参与者每个网页一行…` 原本让**同一个学生**上报 `webapp-1` 与
   `webapp-2`。那是**旧口径下才成立**的形状（假 prisma 替旧判据放行任意 webappId）。
   改严之后「一个参与者只有一个有效网页」，照旧写就是自欺。改为**两个参与者**
   上报同一个有效网页，这条用例真正守的东西（一行一个参与者、单帧时长退化 0、
   行的形状恰好四项、drain 只清自己那个课堂）一条都没少。已在注释里写明理由。
6. **假 prisma 的如实性**：新查询与旧判据问的那一问，替身都**如实回答**
   （`where.webappId` 对不上就是 `null`，课堂级为空也是 `null`）。这是反证能成立的前提 ——
   否则它会红在「替身缺字段」而不是红在真实理由上。

---

## 七、Concerns

1. **`server/dist/` 陈旧产物会跨分支污染 `pnpm test`**。`pnpm test` = `pnpm build && node --test dist/tests/*.test.js`，
   而 `tsc` 不清理输出目录 ⇒ 在这个工作目录里切分支后，上一次编译的测试会继续被跑。
   本次基线就是被它弄红的（`.dev/logs/server.log` 里 `12:25:17 PM [tsx] unlink in ./src/services/worksheet-schema.ts`
   正是那批 worksheet 源码被移走的时刻）。**我没有改 `package.json`**（constraint 8），
   只是清了一次 `dist/`。建议后续在 `test` 脚本里加一步清理。
2. **`dev.db` 在 12:36:01 有一次写入，写入者是用户常驻的 dev 服务端，不是我的 `db push`**：
   `[tsx] change in ./src/socket/index.ts Restarting...`（12:35:09~35）—— 我改源码触发了
   `tsx watch` 重启，服务端启动时跑它自己的 schema 同步/AgentChecker。实测该 mtime 在我
   只跑 `/tmp` 库用例的整段时间里**没有前进**（12:36:01 → 12:36:01）。真实库结构复查完好
   （`ClassroomGroup` 仍无 `agentId`，四张表都在）。
3. **校验改严的一个真实行为变化**（预期内，但值得知道）：教师中途换掉网页、而学生当时
   离线，客户端重连后冲刷的**缓冲帧**带的是旧 `webappId` ⇒ 现在会被拒（旧口径下若课堂级
   仍关联着它就会被收下）。丢弃这些帧是正确的（那是没人再用的页面），但它确实是行为变化。
4. **悬空 `targetId` 的口径不对称（既有，非本次引入）**：组材料指向的网页已被删时，
   `resolveMaterialTargetId` 仍返回那个 id（帧会被收下），而读路径 `resolveGroupMaterialViews`
   会显示为未配置。实测：

   ```
   $ node --input-type=module -e "import('…/group-material-resolve.js').then(m =>
       console.log(JSON.stringify(m.resolveMaterialTargetId({mode:'advanced',studentGroupId:'g1',
         groupMaterials:[{groupId:'g1',kind:'webapp',targetId:'deleted-webapp-id'}],
         classroomLevelId:null, kind:'webapp'}))))"
   "deleted-webapp-id"
   ```

   可达性很低：`Webapp` 的删除守卫会 400（既有用例
   `🔴 只被组级材料引用的网页：usage 的 used 为真、DELETE 被 400 拦下` 在跑），
   只有守卫存在之前的历史数据才会悬空。后果是那间课堂结束时 `recordWebappSummary`
   可能撞 `WebappUsage.webappId` 的外键而使整批汇总失败（该失败已被捕获、不影响结束请求）。
   brief 未要求处理，我**没有动**它。
5. **往返次数**：判定从「2 波串行」变成「3 波、每波内部并行」（成员复查 → mode+groupId →
   组材料+课堂级）。帧 ≤ 每 5 秒一条 / 人，可接受；未引入缓存（按 brief 2.3）。

---

## 用户实测确认（2026-09-23）

用户原话：**「快照已经有了」**。

这是本热修**唯一的最终验收**：控制器与实施者的证据（119 行拒绝日志停止增长、
308/308 全绿、反证复现了用户症状）都只是间接的；教师看板上「等待画面」变成真实快照，
才是端到端的确证。
