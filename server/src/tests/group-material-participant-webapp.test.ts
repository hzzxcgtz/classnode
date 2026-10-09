import { prepareTemporarySqliteFile } from './helpers/temporary-sqlite.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { resolveParticipantWebappId } from '../services/group-material-resolve.js';
import { loadClassroomWebapps } from '../routes/webapps.js';

/**
 * `resolveParticipantWebappId` —— 「这个**参与者**此刻该用哪个探究网页」。
 *
 * ⚠️ **这个文件刻意用真 Prisma + 真 SQLite，而不是手搓一个假 prisma。**
 * 被验证的东西恰好是**查询本身**：`ClassroomGroupMaterial` 的关联过滤对不对、
 * 课堂级那一份的 `orderBy` 是不是与读路径同一个顺序。一个只回放调用参数的替身
 * **证明不了这两件事**（关系名写错、`orderBy` 写反，替身一样绿，而生产环境
 * 要么查不到、要么给出另一个网页）。
 *
 * ⚠️ **临时库，绝不是真实库**：`DATABASE_URL` 一律指向 `os.tmpdir()` 下的文件，
 * 用例开头第一件事就是断言这一点（见 `withDb`）。项目里已经出过一次
 * 「`db push` 打在真实库上、删掉一列」的事故，这条断言是那次事故的直接产物。
 *
 * ── 这个文件为什么存在（2026-09-23 热修） ──────────────────────────────
 * 该判定原本内联在 `socket/index.ts` 的 `resolveWebappReporter` 里（**测试够不着**），
 * 用的口径是「本课堂的 `ClassroomWebapp` 关联过这个网页吗」。而分组材料那一轮
 * 把高级模式的网页权威改成了「每组一份」，该模式下 `ClassroomWebapp` **恒为空**
 * ⇒ 学生端每一帧都被拒（用户报「快照完全不显示」）。抽出来 + 逐组合断言就是
 * 为了防止它再次静默地按失效假设跑下去。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** server/node_modules/.bin/prisma（dist/tests → server 根） */
const PRISMA_BIN = path.resolve(HERE, '../../node_modules/.bin/prisma');
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

/**
 * 每个用例一个**临时库**（与 `classroom-webapp-link.test.ts` 同款）。
 *
 * ⚠️ 收尾必须是 `$disconnect()`：Prisma 的连接池会把进程钉住，测试文件**永不退出**
 * —— 实测过：漏了它，`node --test` 会一直挂到超时（不是报错，是没有任何输出）。
 */
async function withDb(t: { after: (fn: () => Promise<void>) => void }): Promise<PrismaClient> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-participant-webapp-'));
  const file = path.join(dir, 'test.db');
  const url = `file:${file}`;
  // 🔴 这条断言是安全闸门，不是装饰：它保证下面那次 db push 不可能落在真实库上。
  assert.ok(url.startsWith(`file:${os.tmpdir()}`), `DATABASE_URL 必须指向临时目录，实际是 ${url}`);
  assert.notEqual(path.resolve(file), path.resolve(HERE, '../../prisma/dev.db'));
  prepareTemporarySqliteFile(url);
  execFileSync(PRISMA_BIN, ['db', 'push', '--skip-generate', `--schema=${SCHEMA}`], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  t.after(async () => {
    await prisma.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return prisma;
}

/**
 * 一间课堂 + 两个组 + 一个「甲组的学生」参与者。
 *
 * `ClassroomGroupMaterial.targetId` 是**多态**的、没有真外键 ⇒ 组级材料可以直接写
 * 字面量 id，不需要先造 `Webapp` 行。而 `ClassroomWebapp.webappId` **有**外键 ⇒
 * 课堂级那一份必须先造真的 `Webapp`（见 `addClassroomWebapp`）。
 */
async function seed(prisma: PrismaClient, mode: string) {
  const classroom = await prisma.classroom.create({ data: { mode, status: 'active' } });
  const groupA = await prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: '甲组' } });
  const groupB = await prisma.classroomGroup.create({ data: { classroomId: classroom.id, name: '乙组' } });
  const participantA = await prisma.classroomStudent.create({
    data: { classroomId: classroom.id, type: 'student', groupId: groupA.id },
  });
  return { classroomId: classroom.id, groupA, groupB, participantA };
}

/**
 * 课堂级关联一行（= 读路径 `loadClassroomWebapps` 读的那张表）。
 *
 * 🔴 `linkId` / `createdAt` 都可显式指定：排序的两个键是 **`ClassroomWebapp`** 的
 *    `createdAt` 与 `id`（**不是** `Webapp.id`）。下面的顺序用例要**独立**推出
 *    「第一个是谁」（而不是复述生产代码），就必须能控制这两个键。
 */
async function addClassroomWebapp(
  prisma: PrismaClient,
  classroomId: string,
  name: string,
  options: { createdAt?: Date; linkId?: string } = {},
) {
  const webapp = await prisma.webapp.create({ data: { name, entryPath: `${name}.html` } });
  const link = await prisma.classroomWebapp.create({
    data: {
      classroomId,
      webappId: webapp.id,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      ...(options.linkId ? { id: options.linkId } : {}),
    },
  });
  return { webappId: webapp.id, linkId: link.id };
}

// ══════════════════════════════════════════════════════════════════════════
// 逐组合：模式 × 组级有没有配
// ══════════════════════════════════════════════════════════════════════════

test('高级模式：本组配了网页 ⇒ 返回那个 id', async (t) => {
  const prisma = await withDb(t);
  const { classroomId, groupA, participantA } = await seed(prisma, 'advanced');
  await prisma.classroomGroupMaterial.create({ data: { groupId: groupA.id, kind: 'webapp', targetId: 'w-jia' } });

  assert.equal(
    await resolveParticipantWebappId(prisma, { classroomId, participantId: participantA.id }),
    'w-jia',
  );
});

test('高级模式：本组没配、别的组配了 ⇒ null（★ 绝不能拿到别人组的）', async (t) => {
  const prisma = await withDb(t);
  const { classroomId, groupB, participantA } = await seed(prisma, 'advanced');
  // 网页在**乙组**名下，而参与者属于甲组。旧口径（课堂级关联）会把这一份算作
  // 「本课堂的网页」从而放行 —— 那等于学生静默地用另一个组的网页。
  await prisma.classroomGroupMaterial.create({ data: { groupId: groupB.id, kind: 'webapp', targetId: 'w-yi' } });

  assert.equal(
    await resolveParticipantWebappId(prisma, { classroomId, participantId: participantA.id }),
    null,
    '不得回落到「本课堂别的组配的网页」',
  );
});

test('高级模式：本组没配、课堂级故意放一个 ⇒ null（不回落）', async (t) => {
  const prisma = await withDb(t);
  const { classroomId, participantA } = await seed(prisma, 'advanced');
  await addClassroomWebapp(prisma, classroomId, 'classroom-level');

  // 非空自检：课堂级**确实有**一行 —— 否则这条用例在「课堂级本来就是空的」时
  // 也会通过，而那证明不了「不回落」这件事（对照整个消失）。
  const level = await loadClassroomWebapps(prisma, classroomId);
  assert.equal(level.length, 1, '前置条件：课堂级确实关联了一份网页');

  assert.equal(
    await resolveParticipantWebappId(prisma, { classroomId, participantId: participantA.id }),
    null,
    '不回落：高级模式的权威来源是「每组一份」，课堂级那一行不参与解析',
  );
});

test('标准 / 分组模式：用课堂级那一份', async (t) => {
  const prisma = await withDb(t);
  for (const mode of ['standard', 'group']) {
    const { classroomId, groupA, participantA } = await seed(prisma, mode);
    const level = await addClassroomWebapp(prisma, classroomId, `level-${mode}`);
    // 组级也放一份，且**故意不同** —— 这两个模式里它必须被忽略。
    await prisma.classroomGroupMaterial.create({ data: { groupId: groupA.id, kind: 'webapp', targetId: 'w-jia' } });

    assert.equal(
      await resolveParticipantWebappId(prisma, { classroomId, participantId: participantA.id }),
      level.webappId,
      `${mode} 必须用课堂级 —— 那个模式全班共用一套材料`,
    );
  }
});

test('标准模式：课堂级也没有 ⇒ null', async (t) => {
  const prisma = await withDb(t);
  const { classroomId, participantA } = await seed(prisma, 'standard');

  assert.equal(await resolveParticipantWebappId(prisma, { classroomId, participantId: participantA.id }), null);
});

test('组级材料 kind 不是 webapp（如 agent）⇒ 不算数', async (t) => {
  const prisma = await withDb(t);
  const { classroomId, groupA, participantA } = await seed(prisma, 'advanced');
  await prisma.classroomGroupMaterial.create({ data: { groupId: groupA.id, kind: 'agent', targetId: 'a-jia' } });

  assert.equal(await resolveParticipantWebappId(prisma, { classroomId, participantId: participantA.id }), null);
});

// ══════════════════════════════════════════════════════════════════════════
// 参与者的身份：不存在 / 不是本课堂的 / 小组本身也是参与者
// ══════════════════════════════════════════════════════════════════════════

test('参与者不存在 ⇒ null', async (t) => {
  const prisma = await withDb(t);
  const { classroomId } = await seed(prisma, 'advanced');

  assert.equal(await resolveParticipantWebappId(prisma, { classroomId, participantId: 'no-such-participant' }), null);
});

// 🔴 反证（阴性对照）：参与者的 id **真实存在**，但属于**另一个课堂** ——
//    只按 id 查（漏掉 classroomId 那一半 where）会让它拿到那个课堂的材料。
test('参与者是别的课堂的 ⇒ null（不得跨课堂拿材料）', async (t) => {
  const prisma = await withDb(t);
  const a = await seed(prisma, 'advanced');
  const b = await seed(prisma, 'advanced');
  await prisma.classroomGroupMaterial.create({ data: { groupId: b.groupA.id, kind: 'webapp', targetId: 'w-other' } });

  assert.equal(
    await resolveParticipantWebappId(prisma, { classroomId: a.classroomId, participantId: b.participantA.id }),
    null,
  );
});

test('课堂不存在 ⇒ null', async (t) => {
  const prisma = await withDb(t);
  const { participantA } = await seed(prisma, 'advanced');

  assert.equal(
    await resolveParticipantWebappId(prisma, { classroomId: 'no-such-classroom', participantId: participantA.id }),
    null,
  );
});

test('参与者是小组（type=group）时同样按它自己的 groupId 解析', async (t) => {
  const prisma = await withDb(t);
  const { classroomId, groupB } = await seed(prisma, 'advanced');
  await prisma.classroomGroupMaterial.create({ data: { groupId: groupB.id, kind: 'webapp', targetId: 'w-yi' } });
  // ⚠️ 用**乙组**：`ClassroomStudent` 上有 `@@unique([classroomId, groupId])`，
  //    甲组已经站着 `seed()` 建的那个学生参与者，再往甲组塞一条会撞唯一键。
  const groupParticipant = await prisma.classroomStudent.create({
    data: { classroomId, type: 'group', groupId: groupB.id },
  });

  assert.equal(
    await resolveParticipantWebappId(prisma, { classroomId, participantId: groupParticipant.id }),
    'w-yi',
  );
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴 课堂级那一份的**顺序**必须与读路径（`loadClassroomWebapps`）逐字一致
//
// 学生端目前只加载 `webapps[0]`（P2 的已知收窄），所以读路径的「第一个」就是
// 学生的「唯一那一个」。两处顺序一旦不同，就会出现「教师看到的」与「学生实际用的」
// 不是同一个，而界面上**没有任何地方**能看出来。
// ══════════════════════════════════════════════════════════════════════════

test('🔴 课堂级的顺序与 loadClassroomWebapps 一致：createdAt 升序', async (t) => {
  const prisma = await withDb(t);
  const { classroomId, participantA } = await seed(prisma, 'standard');
  const base = Date.parse('2026-09-23T00:00:00.000Z');
  // 关联行的 id 取成与时间顺序**相反**的字典序：若哪一处漏掉了 createdAt，
  // 排序会落到 id 上，取到的就是另一行 —— 这条前置断言会立刻红。
  const late = await addClassroomWebapp(prisma, classroomId, 'late', { createdAt: new Date(base + 2000), linkId: 'link-a' });
  const mid = await addClassroomWebapp(prisma, classroomId, 'mid', { createdAt: new Date(base + 1000), linkId: 'link-b' });
  const early = await addClassroomWebapp(prisma, classroomId, 'early', { createdAt: new Date(base), linkId: 'link-c' });

  const viaRead = await loadClassroomWebapps(prisma, classroomId);
  assert.equal(viaRead.length, 3, '前置条件：三行都在');
  assert.equal(viaRead[0].id, early.webappId, '前置条件：读路径取到的是**最早**那一行（而不是 id 最小的那行）');
  assert.notEqual(early.linkId, [...[late, mid, early].map(item => item.linkId)].sort()[0],
    '前置条件：最早那一行的关联 id 不是最小 —— 否则「漏掉 createdAt」与「没漏」区分不开');

  assert.equal(
    await resolveParticipantWebappId(prisma, { classroomId, participantId: participantA.id }),
    viaRead[0].id,
    '两处必须给出同一个网页 —— 否则「教师看到的」与「学生实际用的」不是同一个',
  );
});

test('🔴 时间戳逐字相同（SQLite 秒级精度）时按关联行 id 兜底，两处仍然一致', async (t) => {
  const prisma = await withDb(t);
  const { classroomId, participantA } = await seed(prisma, 'standard');
  // 实测过的形态：一次嵌套 create 写多行，SQLite 的 CURRENT_TIMESTAMP 只有秒精度，
  // 同一批行拿到**逐字相同**的 createdAt，排序落到兜底的 uuid（那时是随机的）。
  const same = new Date(Date.parse('2026-09-23T00:00:00.000Z'));
  await addClassroomWebapp(prisma, classroomId, 'c', { createdAt: same, linkId: 'link-c' });
  await addClassroomWebapp(prisma, classroomId, 'b', { createdAt: same, linkId: 'link-b' });
  const first = await addClassroomWebapp(prisma, classroomId, 'a', { createdAt: same, linkId: 'link-a' });

  const viaRead = await loadClassroomWebapps(prisma, classroomId);
  assert.equal(viaRead.length, 3, '前置条件：三行都在');
  // 独立推出来的期望值（不是复述生产代码）：时间戳逐字相同 ⇒ 唯一确定的次序是
  // 关联行 id 升序 ⇒ `link-a` 那一行。
  assert.equal(viaRead[0].id, first.webappId, '前置条件：读路径在打平时按关联行 id 升序兜底');

  assert.equal(
    await resolveParticipantWebappId(prisma, { classroomId, participantId: participantA.id }),
    first.webappId,
    '打平时也必须与读路径取到同一行',
  );
});
