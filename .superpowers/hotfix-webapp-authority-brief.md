# 热修：高级模式下学生帧被全数拒绝（探究助手快照不显示）

**分支**：`fix/webapp-material-authority`（从 `feat/p2-explore-assistant` 的 `ee655f3` 分出）
**优先级**：用户报的急件 —— 电脑端与性能良好的 iPad 上**快照完全不显示**

---

## 一、根因（已闭合，证据在下）

`server/src/socket/index.ts:1316` 的 `resolveWebappReporter` 用**课堂级关联表**判权：

```ts
const linked = await prisma.classroomWebapp.findFirst({
  where: { classroomId, webappId },
  select: { id: true, classroom: { select: { status: true } } },
});
if (!linked) return { ok: false, reason: '这个网页没有关联到本课堂' };
```

而分组材料那一轮改动把**高级模式的网页权威来源从「课堂级」改成了「每组一份」** ——
`server/src/routes/classroom.ts` 的创建路径明确写着：

> 🔴 高级模式**不再写课堂级网页**。网页在这个模式下的权威来源是「每组一份」，
> 留着课堂级那一行会长出「它到底谁在用」的第二套解释，而运行期规定了不回落。

⇒ **高级模式下 `ClassroomWebapp` 恒为空 ⇒ 每一帧都被这条拒掉。** 学生端完全正常。

### 实测证据（控制器已跑过，可直接复现）

服务端日志 `.dev/logs/server.log` 有 **96 行**：

```
[Socket] webapp-frame 被拒：这个网页没有关联到本课堂 classroom=f7eefffb-35c3-4c06-b38b-7e52c8902878 webappId=f83923e7-be25-4a8f-aa5e-6309ab280677
```

查真实库（只读）：

```sql
SELECT mode FROM Classroom WHERE id='f7eefffb-35c3-4c06-b38b-7e52c8902878';   -- advanced
SELECT COUNT(*) FROM ClassroomWebapp WHERE classroomId='f7eefffb-…';          -- 0
SELECT g.name, m.targetId FROM ClassroomGroupMaterial m
  JOIN ClassroomGroup g ON g.id=m.groupId
  WHERE g.classroomId='f7eefffb-…';   -- 贾家组/薛家组共 4 行，其中就有 f83923e7-…
```

### 为什么它能静默坏掉

**`resolveWebappReporter` 目前零测试覆盖** —— 拒因字符串 `这个网页没有关联到本课堂` 在
`server/src/tests/` 里一次都没出现过。它的三个调用点（帧 / 文字档 / 诊断，`socket/index.ts:1449 / 1355 / 1514`）
都在 socket 处理器内部，测试够不着。

---

## 二、修法

### 2.1 把「该参与者的有效网页」抽成可测的纯函数

放进 `server/src/services/group-material-resolve.ts`（`resolveMaterialTargetId` 已经在那儿，
且那个文件存在的理由就是「抽成纯函数是为了逐组合断言」）：

```ts
/**
 * 某个**参与者**（学生或小组）在本课堂里实际该用哪个探究网页。
 *
 * 与 `resolveMaterialTargetId` 的关系：那个函数是唯一口径，本函数只负责把它的入参查齐。
 * 抽出来的理由：这个判定原本内联在 `socket/index.ts` 的处理器里，**测试够不着**，
 * 于是它按已失效的假设（课堂级是权威）跑了好几轮都没人发现。
 */
export async function resolveParticipantWebappId(
  prisma: PrismaClient,
  input: { classroomId: string; participantId: string },
): Promise<string | null>
```

实现要点：

- 查 `Classroom` 的 `mode` 与 `status`
- 查参与者的 `groupId`（`ClassroomStudent.groupId`）
- `groupMaterials`：本课堂所有组的 `ClassroomGroupMaterial`，`kind='webapp'`
- `classroomLevelId`：本课堂的 `ClassroomWebapp` 第一行 —— 🔴 **排序必须与 `loadClassroomWebapps`
  完全一致**（`orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]`）。读路径的单选收窄用的是这个顺序，
  两边不一致会出现「教师看到的」与「学生实际用的」不是同一个。
- 交给 `resolveMaterialTargetId({ mode, studentGroupId, groupMaterials, classroomLevelId, kind: 'webapp' })`
- **高级模式不回落**由那个函数保证，你不要重写一遍

### 2.2 `resolveWebappReporter` 改用它

```ts
const effective = await resolveParticipantWebappId(prisma, { classroomId, participantId: membership.id });
if (effective === null) return { ok: false, reason: '该学生（或其小组）没有配置探究网页' };
if (effective !== webappId) {
  return { ok: false, reason: `上报的网页不是该学生的有效网页（有效 ${effective}，上报 ${webappId}）` };
}
```

**保留下来的**（不要动）：
- `socket.data.studentId` / `socket.data.classroomId` 的检查与它那句注释
- `socket.rooms.has('classroom:' + classroomId)` 的检查与它那段注释（「这一条最常见，也最容易被误读」）
- **课堂已结束 ⇒ 不再收上报**那条，连同它整段注释（只挡 `ended`、不挡 `paused`）
- 三处调用点、以及日志里 ` classroom=… webappId=…` 的后缀格式

**这个改动顺带把校验变严了**，是好事，请写进注释：改前问的是「本课堂关联过这个网页吗」
（于是学生可以替**别的组**送帧），改后问的是「**这是你自己的**网页吗」。

### 2.3 性能

帧本来就低频（≤ 每 5 秒一条 / 人），新增两条查询可接受，**但请尽量并行**
（现状是两条串行）。不要引入缓存 —— 那会让「教师改了材料」到「生效」之间出现一个说不清的窗口。

---

## 三、测试要求

`resolveParticipantWebappId` 必须有单测，**逐组合**（照 `group-material-resolve.test.ts` 的既有写法）：

| 场景 | 期望 |
|---|---|
| `advanced` + 该组配了网页 | 返回那个 id |
| `advanced` + 该组**没**配网页，而**别的组**配了 | **返回 `null`**（★ 反证：绝不能拿到别人组的） |
| `advanced` + 该组没配，课堂级**故意**放一个 | **返回 `null`**（不回落） |
| `standard` | 返回课堂级那一份 |
| `group` | 返回课堂级那一份 |
| 参与者不存在 | `null` |

★ **必须带反证并实测**：把 2.2 的判定临时改回「查 `ClassroomWebapp`」，
「advanced + 组配了网页」那条**必须变红**（复现线上症状）。把命令与输出写进报告。

**另外**：`resolveWebappReporter` 的另外两个调用点（文字档 / 诊断）走同一个函数，
不需要各自再测 —— 但请在报告里说明你核对过它们确实共用这一处。

---

## 四、Global Constraints

1. **既有测试必须继续全过。** 动手前现测一遍基线并记下数字。
2. **不新增任何 npm 依赖。**
3. 提交信息中文；报告、注释一律中文。
4. 🔴 **绝不 `prisma db push` 打在真实库上**（`server/prisma/dev.db`）。测试用 `/tmp` 副本库。
5. **只允许一个 `pnpm build` / `pnpm test` 在跑。**
6. ⚠️ **不跑根目录的 `pnpm build`**（会覆盖 `.next`）。用 `cd server && pnpm build`。
7. ⚠️ **不要停 `./dev.sh`** —— 用户正在用它验证。
8. 不碰 `CLAUDE.md` / `dev.sh` / `package.json` / `release.sh`。
9. 🔴 **任何「因此安全 / 可以忽略 / 不扫」的结论，必须附一条命令或一段实测输出。**

---

## 五、交付

1. 先写测试（TDD），跑，确认失败
2. 实现 2.1 + 2.2
3. 跑聚焦测试，再跑全量
4. 做那条反证，**实测**线上症状可复现且被修复
5. 提交（中文信息）
6. 自查 diff
7. 报告写到 `/Users/zxc/myprojects/classnode/.superpowers/hotfix-webapp-authority-report.md`

**不要做**（控制器已裁定，属另外两处同族缺陷，另有安排）：
- `server/src/routes/webapps.ts:429` 的关联计数（管理页把组级引用算成未关联）
- `src/app/teacher/page.tsx:1725` 的课堂设置弹窗读课堂级 `webapps` 导致显示「未关联」
