import { Router } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { createStudentToken } from '../middleware/student-auth.js';
import { hasTeacherSession } from '../middleware/auth.js';
import { ALLOWED_SOURCE_STATUSES } from '../services/classroom-state.js';
import { compareStudentNumbers } from '../services/student-sort.js';
import { initialModuleRows, isValidModuleKey, isValidModuleState, mergeModuleStates } from '../services/classroom-module-state.js';
import { abortClassroomStreams, broadcastWebappDemand } from '../socket/index.js';
import type { WebappUsageRow } from '../socket/index.js';
import { captureFieldsFromInput, normalizeCaptureConfig } from '../services/webapp-capture.js';
import { loadClassroomWebapps } from './webapps.js';
import { EMPTY_GROUP_MATERIAL_VIEW, resolveGroupMaterialViews } from '../services/group-material-resolve.js';
import { studentAgentView } from '../services/agent-purpose.js';
import { formatDuration } from '../services/worksheet-report.js';
// ★ 2026-09-30：课堂级「逐题开放」。判据在那个服务里（含 `normalizeWorksheetOpen`），
// 这里只用它；`flattenAnswerable` 用来核「这些题 id 真的在这份单里」（见那个端点的注释）。
import { normalizeWorksheetOpen, withOpenQuestions } from '../services/worksheet-open.js';
import { flattenAnswerable } from '../services/worksheet-heading.js';
import type { WorksheetContent } from '../services/worksheet-questions.js';

const router: Router = Router();

const PUBLIC_CODE_WINDOW_MS = 60_000;
const PUBLIC_CODE_MAX_REQUESTS = 120;
const publicCodeRequests = new Map<string, number[]>();

/**
 * 互动码保留四位以兼顾课堂输入效率；对公开查询加温和限流，降低局域网内批量枚举的风险。
 * 每位学生正常进入和断线恢复只会产生极少量请求，不会增加其操作步骤。
 */
function limitPublicCodeRequests(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void {
  const now = Date.now();
  const client = req.socket.remoteAddress || 'unknown';
  const recent = (publicCodeRequests.get(client) || []).filter(timestamp => timestamp > now - PUBLIC_CODE_WINDOW_MS);
  if (recent.length >= PUBLIC_CODE_MAX_REQUESTS) {
    res.status(429).json({ error: '查询过于频繁，请稍后再试' });
    return;
  }
  recent.push(now);
  publicCodeRequests.set(client, recent);
  if (publicCodeRequests.size > 2_000) {
    for (const [key, timestamps] of publicCodeRequests) {
      if (timestamps.every(timestamp => timestamp <= now - PUBLIC_CODE_WINDOW_MS)) publicCodeRequests.delete(key);
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  next();
}

router.use('/code', limitPublicCodeRequests);

/**
 * ★ M6c：历史页那三件套的**三个数**（探究空间用量 + 学习单交卷数）。
 *
 * 🔴 **一轮查完 50 个课堂，不许 N+1**（GC 35）—— 形状与上面 `Message` 那条聚合**逐字同款**：
 * 同一组 `?` 占位符、`IN (…)`、`GROUP BY "classroomId"`。
 *
 * ⚠️ **空表那一路靠的不是 `COALESCE`**（终审实测：去掉它，4 条用例仍全绿）：
 * 查询带 `GROUP BY` ⇒ **空集根本没有行**，`COALESCE` 永无机会触发；而下面那句
 * 「先给每个 id 落一个全 0 的条目」才是真正让「没有记录」与「查询漏了」分开的那一步。
 * `COALESCE` 留着是防御性的（`durationMs` 是 `NOT NULL DEFAULT 0`，它今天不可能被触发）。
 *
 * 🔴 **`worksheetSubmitted` 只数 `status='submitted'`**：草稿不是交卷（GC 34 的分母同理）。
 */
export async function loadHistoryTraces(prisma: PrismaClient, ids: string[]): Promise<Map<string, {
  webappUsageCount: number; webappDurationMs: number; worksheetSubmitted: number; worksheetTotal: number;
}>> {
  const out = new Map<string, { webappUsageCount: number; webappDurationMs: number; worksheetSubmitted: number; worksheetTotal: number }>();
  // 与既有那条同一条守卫：空数组不发查询（`IN ()` 是语法错误）。
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => '?').join(',');

  // 🔴 **`COUNT(DISTINCT "studentId")`，不是 `COUNT(*)`** —— 这条是**跑用例时才发现**的：
  //    `WebappUsage` 有唯一约束 `(classroomId, studentId, webappId)`（一个参与者对一个网页一行），
  //    所以**行数是「参与者 × 网页」**。一节用了 3 个网页、5 个参与者的课，行数可以是 15，
  //    而列上写的是「N 人」—— 用 `COUNT(*)` 就是**在纸上撒谎**。
  const webapp = await prisma.$queryRawUnsafe<Array<{ classroomId: string; cnt: number; total: number }>>(
    `SELECT "classroomId", COUNT(DISTINCT "studentId") AS cnt, COALESCE(SUM("durationMs"), 0) AS total FROM "WebappUsage" WHERE "classroomId" IN (${placeholders}) GROUP BY "classroomId"`,
    ...ids,
  );
  const worksheet = await prisma.$queryRawUnsafe<Array<{ classroomId: string; submitted: number; total: number }>>(
    `SELECT r."classroomId" AS "classroomId", ` +
    `SUM(CASE WHEN a."status" = 'submitted' THEN 1 ELSE 0 END) AS submitted, COUNT(*) AS total ` +
    `FROM "WorksheetAnswer" a JOIN "WorksheetResponse" r ON r."id" = a."responseId" ` +
    `WHERE r."classroomId" IN (${placeholders}) GROUP BY r."classroomId"`,
    ...ids,
  );

  // 先给每个 id 落一个全 0 的条目 —— 那样「没有记录」与「查询漏了」在调用方看来是两件事。
  for (const id of ids) out.set(id, { webappUsageCount: 0, webappDurationMs: 0, worksheetSubmitted: 0, worksheetTotal: 0 });
  for (const row of webapp) {
    const entry = out.get(row.classroomId);
    if (entry) { entry.webappUsageCount = Number(row.cnt); entry.webappDurationMs = Number(row.total); }
  }
  for (const row of worksheet) {
    const entry = out.get(row.classroomId);
    if (entry) { entry.worksheetSubmitted = Number(row.submitted); entry.worksheetTotal = Number(row.total); }
  }
  return out;
}

function generateCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// 学生选择身份后静默领取课堂临时令牌，不增加前端操作步骤。
router.post('/code/:code/student-session', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const participantId = typeof req.body?.studentId === 'string' ? req.body.studentId : '';
    const classroom = await prisma.classroom.findUnique({ where: { code: req.params.code } });
    if (!classroom || classroom.status === 'ended') return res.status(404).json({ error: '课堂不存在或已结束' });
    const member = await prisma.classroomStudent.findFirst({
      where: { classroomId: classroom.id, id: participantId },
      select: { id: true },
    });
    if (!member) return res.status(403).json({ error: '该参与者不属于当前课堂' });
    res.json({ token: createStudentToken(classroom.id, member.id), expiresIn: 7200 });
  } catch {
    res.status(500).json({ error: '创建学生会话失败' });
  }
});

/** 生成不重复的 4 位互动码，只检查活跃/暂停中的课堂（已结束的码可回收） */
async function generateUniqueClassroomCode(prisma: PrismaClient | Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateCode();
    const existing = await prisma.classroom.findFirst({
      where: { code, status: { in: ['active', 'paused'] } },
    });
    if (!existing) return code;
  }
  // 保底：遍历所有活跃课堂的码，找出未用的
  const used = await prisma.classroom.findMany({
    where: { status: { in: ['active', 'paused'] } },
    select: { code: true },
  });
  const usedSet = new Set(used.filter((c: { code: string | null }) => c.code).map((c: { code: string | null }) => c.code));
  for (let n = 1000; n <= 9999; n++) {
    const code = n.toString();
    if (!usedSet.has(code)) return code;
  }
  throw new Error('无可用的互动码');
}

/**
 * 解析并校验创建课堂时勾选的**关联材料**（探究网页 / 学习单）—— 两者走**同一套**口径。
 *
 * ⚠️ **这是 `ClassroomWebapp` 与 `ClassroomWorksheet` 关联唯一的一处校验**。T3 只建了表与
 * 读取/删除路径，关联是在这里建立的 —— 少这一处，教师勾了网页（或学习单）、课堂照样建出来，
 * 而学生端永远看不到任何东西：一次**没有任何报错**的「看起来成功」。
 *
 * 三条口径（`kind` **只决定查哪张表、文案念哪一项**，三条本身对两者逐字相同）：
 *   · 未传 / 非数组 ⇒ `[]`（老客户端不发这个字段，必须当「没勾」而不是报错）。
 *   · 去重 —— `@@unique([classroomId, webappId])` 撞上重复 id 会让整个事务失败，
 *     而那会表现成「创建课堂失败」，与真实原因（前端重复发了一个 id）对不上。
 *   · **有一个 id 不存在就整条 400**，不是静默跳过：静默跳过 = 教师勾了三个、进去只有两个，
 *     而界面上没有任何痕迹。id 来自刚刚拉取的列表，对不上只可能是教师的页面已经过期。
 *
 * 校验对学习单**同样必要**，哪怕 `ClassroomGroupMaterial.targetId` 没有真外键：
 * 不校验就会写下一行指向不存在目标的材料，而读路径把它如实显示成「未配置」
 * ⇒ 教师明明选了、学生看到的是「老师还没布置」，仍然没有任何报错。
 */
async function resolveMaterialIds(
  prisma: PrismaClient,
  raw: unknown,
  kind: 'webapp' | 'worksheet',
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const label = CLASSROOM_MATERIAL_LABELS[kind];
  if (raw === undefined || raw === null) return { ok: true, ids: [] };
  if (!Array.isArray(raw)) return { ok: false, error: `${label}参数无效` };
  const ids = Array.from(new Set<string>((raw as unknown[]).filter((id): id is string => typeof id === 'string' && !!id)));
  if (ids.length === 0) return { ok: true, ids: [] };
  const found = kind === 'webapp'
    ? await prisma.webapp.findMany({ where: { id: { in: ids } }, select: { id: true } })
    : await prisma.worksheet.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) return { ok: false, error: `所选${label}已不存在，请刷新后重试` };
  return { ok: true, ids };
}

/**
 * `ClassroomWebapp` 的关联行 —— **`createdAt` 显式写入**，不用 `@default(now())`。
 *
 * 🔴 实测（见 task-7 报告）：SQLite 的 `CURRENT_TIMESTAMP` 只有**秒**精度，而这里是一次
 * 嵌套 create 写多行 ⇒ 同一课堂的所有行**拿到逐字相同的 `createdAt`**。读路径是
 * `orderBy: [{createdAt:'asc'},{id:'asc'}]`（`loadClassroomWebapps`），时间戳打平时排序
 * 落到兜底的 **uuid**，也就是**随机**。实测输出：
 *
 * ```
 * 选中顺序 : 6d603c56… b1a9ca72… 1ea3a382…
 * 读回顺序 : b1a9ca72… 6d603c56… 1ea3a382…   ← 不是选中顺序
 * createdAt: 三个逐字相同
 * ```
 *
 * 后果不是「顺序难看」，而是**学生打开的网页不是教师以为的那个**：学生端目前只加载
 * `webapps[0]`（P2 的已知收窄），而 `[0]` 是随机的 —— 教师勾了 A、B、C，学生可能拿到
 * 任意一个，界面上没有任何地方能看出来。
 *
 * 所以这里按**勾选顺序**写出一组严格递增的时间戳（都落在过去，彼此差 1ms）。
 * 这与 schema 里那句话是一致的：`createdAt` 在本表上**就是排序键**
 * （`schema.prisma` 的 `ClassroomWebapp` 注释：「没有时间列就没有稳定次序」）——
 * 本函数只是让那个次序等于教师的选择，而不是等于 uuid 的字典序。
 */
function webappLinkRows(ids: readonly string[], now: number = Date.now()) {
  return ids.map((webappId, index) => ({
    webappId,
    createdAt: linkRowCreatedAt(ids.length, index, now),
  }));
}

/**
 * 「关联行的 `createdAt`」—— `ClassroomWebapp` 与 `ClassroomWorksheet` **共用同一条**规则。
 *
 * ⚠️ 抽成函数（而不是让学习单那条路径各写一遍那个减法）是刻意的：这两个调用点必须
 * **逐字同源**。`ClassroomWorksheet` 的 schema 注释里写着「★ 排序键。理由与
 * `ClassroomWebapp` 逐字同源」—— 那份同源只有在这里由**同一行代码**保证时才是真的，
 * 否则就是两句注释在互相背书。
 *
 * @param count 本次写入的行数
 * @param index 该行的勾选次序（0 最早）
 * @returns 严格递增、且全部 ≤ `now - 1` 的时间戳（不产生「未来」的时间戳）
 */
function linkRowCreatedAt(count: number, index: number, now: number): Date {
  return new Date(now - (count - index));
}

/**
 * `ClassroomWorksheet` 的关联行 —— 与 `webappLinkRows` 同一条规则（见 `linkRowCreatedAt`）。
 *
 * 今天这批是**单选**（`resolveSingleMaterialId` 收到一份），所以这里恒为 0 或 1 行，
 * 排序还看不出差别。仍然照写，有两个理由：
 *   · 表结构允许多行（`@@unique([classroomId, worksheetId])`，规格 §4 明说将来要支持多份），
 *     真到那天再补，就是在一张**已经可能有平手时间戳**的表上补 —— 历史行的顺序已经错了；
 *   · 读路径的 `orderBy` 必然要照抄 `loadClassroomWebapps` 的 `[{createdAt:'asc'},{id:'asc'}]`
 *     （同一套排序键），那时平手就落到 uuid 字典序 = 随机。
 * 代价是 0 行。
 */
function worksheetLinkRows(ids: readonly string[], now: number = Date.now()) {
  return ids.map((worksheetId, index) => ({
    worksheetId,
    createdAt: linkRowCreatedAt(ids.length, index, now),
  }));
}

/**
 * 课堂关联的**学习单**，下发给学生端与教师端看板 —— 与 `loadClassroomWebapps`
 * （`routes/webapps.ts`）**同一个模式**，是读路径上课堂级学习单的**唯一**来源。
 *
 * 🔴 **为什么必须有它**：标准 / 分组模式下 `ClassroomGroupMaterial` 里**没有任何行**
 * （那两种模式的材料权威来源就是课堂级，见 `resolveMaterialTargetId` —— 它对
 * `standard` / `group` 直接返回 `classroomLevelId`）。而 `groups[]` 在 `standard` 模式
 * 根本不下发（`GET /code/:code` 里它是 `undefined`）、在 `group` 模式下每组的 `worksheet`
 * 恒为 `null`。⇒ **只有高级模式能靠 `groups[].worksheet` 拿到学习单**
 * （⚠️ 是**扁平**的 `groups[].worksheet`，不是 `groups[].materials.worksheet` ——
 * 嵌套的 `materials` 那种形状**从来没有落地**，`classroom-material.ts` 记着这件事）；
 * 少了本函数，标准/分组模式的学生端就**完全没有**「老师布置了哪一份」的来源，
 * 而界面上只会显示「还没有布置」—— 一次没有任何报错的静默差异。
 *
 * ⚠️ **只发 `id` / `title`**（与 `GroupMaterialView.worksheet` **同一个形状**）：
 * 字段名与形状跟组级那份一致，前端就只需要处理**一种**学习单形状（同 `GroupMaterialView`
 * 对 `agent` 的那条规矩）。题目结构（`content`）**不进引导载荷** —— 学生端按 id 单独拉取，
 * 由服务端剥掉答案字段（B3 的 `student-view`）。
 *
 * ⚠️ 三条路径（`GET /code/:code`、`GET /:id`、`GET /active`）**共用本函数** ——
 * 与 `loadClassroomWebapps` 的调用点一一对应（`/all` 两者都不发，故不含）。
 * 形状在其中一条上分叉一次，「教师看到的」与「学生打开的」就不是同一个了。
 *
 * ⚠️ **读路径不可失败**：ClassroomWorksheet 表缺失（老库启动 DDL 被跳过）时降级为空数组，
 * 绝不能因为查不到学习单把学生挡在课堂门外。用 try/catch 而不是 `.catch()`：老库缺表时
 * Prisma 拒绝的是一个 Promise，而「模型整个不存在」时是**同步**抛，`.catch()` 接不住后者。
 *
 * ⚠️ 排序 `[{createdAt:'asc'},{id:'asc'}]` **必须**与写入口（`worksheetLinkRows` /
 * `linkRowCreatedAt`）和 `trimExtraClassroomWebapps` 的读法逐字相同 —— 三者不同口径就会出现
 * 「保存前看到的第一个」与「保存后留下的那个」不是同一个。
 */
async function loadClassroomWorksheets(
  prisma: PrismaClient,
  classroomId: string,
): Promise<{ id: string; title: string }[]> {
  type Row = { worksheet: { id: string; title: string } };
  let rows: Row[] = [];
  try {
    rows = await prisma.classroomWorksheet.findMany({
      where: { classroomId },
      select: { worksheet: { select: { id: true, title: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  } catch {
    return [];
  }
  return rows.map(row => ({ id: row.worksheet.id, title: row.worksheet.title }));
}

/**
 * 课堂三件套 —— **AI 智能体 / 探究网页 / 学习单**。
 *
 * 真实的一堂课由这三样东西组成，但**每一项都不是必填**：教师可以只挂一个智能体让孩子对话，
 * 也可以只放一个网页让孩子自己探究。**唯一的硬性要求是三项里至少有一项** ——
 * 三项全空的课堂建出来，学生进去看到的是一片空白，而教师以为自己成功了。
 *
 * ⚠️ 三项的**数法各不相同**，调用处必须如实数「真的配了的」，见 `classroomMaterialError`
 * 的两处调用点：标准/分组数课堂级那一份，高级模式数**真的配了的组级材料数**（不是组的数量）。
 * 把三件套写成一张表而不是一串 `if`，就是为了让「学习单接进来」那次改动只落在数字上。
 */
const CLASSROOM_MATERIAL_LABELS = {
  agent: 'AI 智能体',
  webapp: '探究网页',
  worksheet: '学习单',
} as const;

type ClassroomMaterialCounts = Record<keyof typeof CLASSROOM_MATERIAL_LABELS, number>;

/**
 * 三件套的「至少一项」判据。**这是全项目唯一的判据**，两条创建路径都走它。
 *
 * 返回 `null` 表示通过；否则返回可直接回给教师的中文文案。
 * 文案的落点是「该怎么办」——「至少需要一项内容」+ 三项的名字，而不是一句「参数无效」。
 */
function classroomMaterialError(counts: ClassroomMaterialCounts): string | null {
  const kinds = Object.keys(CLASSROOM_MATERIAL_LABELS) as (keyof typeof CLASSROOM_MATERIAL_LABELS)[];
  const total = kinds.reduce((sum, kind) => sum + Math.max(0, counts[kind] || 0), 0);
  if (total > 0) return null;
  return `课堂至少要有一项内容：${Object.values(CLASSROOM_MATERIAL_LABELS).join(' / ')}（三项都不是必填，选其中任意一项即可）`;
}

/**
 * 关联材料**单选**：一个课堂只关联一个探究网页（P2.3），课堂级的学习单同理（P1 §4）。
 *
 * 表结构不动（`ClassroomWebapp` / `ClassroomWorksheet` 仍是多对多，只是每个课堂最多留一行）。
 * 学生端本来就只加载 `webapps[0]`（学习单的读路径也按同一形状收窄），第二个及以后
 * **从来没有生效过** —— 这一处是把界面与实际行为对齐，不是砍掉一个正在用的功能
 * （旧的行为本身是个陷阱：教师勾了 A、B、C，学生拿到哪个是随机的，见 `webappLinkRows`
 * 的实测注释）。
 *
 * 为什么是「取第一个 + 留痕」而不是「多于一个就 400」：
 * 已经部署出去的旧版前端发的是数组，400 会让那些教师**建不出课堂**，而它们发来的第一个 id
 * 恰好就是当时唯一生效的那个 ⇒ 取第一个对教师无损。被丢掉的那些**必须写进日志** ——
 * 丢掉一个教师勾过的选项属于改数据，不留痕就成了静默改写（与 `trimExtraClassroomWebapps`
 * 同一条规矩）。
 *
 * 校验仍然是**整条**的：`resolveMaterialIds` 先确认每一个 id 都存在，再有 id 不存在就 400。
 * 哪怕多出来的那个会被丢掉也不放行 —— 「页面已过期」值得让教师刷新一次，
 * 而不是让他拿到一个自己没预期的课堂。
 */
async function resolveSingleMaterialId(
  prisma: PrismaClient,
  raw: unknown,
  kind: 'webapp' | 'worksheet',
  context: string,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const resolved = await resolveMaterialIds(prisma, raw, kind);
  if (!resolved.ok) return resolved;
  const [first, ...dropped] = resolved.ids;
  if (dropped.length > 0) {
    console.warn(
      `[Classroom] ${CLASSROOM_MATERIAL_LABELS[kind]}为单选，已忽略多余选项（${context}）：保留 ${first}，忽略 ${dropped.join(', ')}`,
    );
  }
  return { ok: true, id: first ?? null };
}

/**
 * 把课堂的探究网页裁剪到「只留第一个」。
 *
 * 历史数据里可能有课堂关联了多个网页（多选时代留下的）。那些多出来的关联行**从未生效过**
 * （学生端只读 `webapps[0]`），留着只会让「这个课堂到底用哪个网页」在界面上说不清。
 * 教师在管理页保存课堂设置时顺手对齐。
 *
 * ⚠️ **删了哪些由调用方写进服务端日志**（`file-logger` 会把 console 落到
 * `CLASSNODE_DATA_DIR/logs/`）。这是本项目自己定的规矩：改数据要留痕 ——
 * 静默删除会让「网页怎么没了」变成一件无法追查的事，而且删掉的是教师以为自己配好的东西。
 * 日志由调用方在**事务提交之后**写：写在事务里会在回滚时留下一句没发生过的「已裁剪」。
 *
 * @returns 被删掉的关联行（`{id, webappId}`），没删就是空数组。
 */
async function trimExtraClassroomWebapps(
  prisma: PrismaClient | Prisma.TransactionClient,
  classroomId: string,
): Promise<{ id: string; webappId: string }[]> {
  // 与读路径（`loadClassroomWebapps`）**同一套排序**，否则会出现
  // 「保存前看到的第一个」与「保存后留下的那个」不是同一个 —— 那是最坏的一种不一致。
  const links = await prisma.classroomWebapp.findMany({
    where: { classroomId },
    select: { id: true, webappId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (links.length <= 1) return [];
  const dropped = links.slice(1);
  await prisma.classroomWebapp.deleteMany({ where: { id: { in: dropped.map(link => link.id) } } });
  return dropped;
}

// 创建课堂（标准模式）
router.post('/create', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { title, classIds, agentIds, mode = 'standard', webappIds, worksheetIds } = req.body;

    // ① 参与班级 —— **不属于三件套**。它是学生名册的来源，仍然必填。
    //    与三件套**分开报错**：从前合在一句「请选择班级和智能体」里，只缺班级的教师
    //    会跑去智能体那一栏找问题，而那里本来就是好的。
    if (!classIds?.length) {
      return res.status(400).json({ error: '请选择参与课堂的班级（学生名册来自班级）' });
    }
    if (!['standard', 'group'].includes(mode)) return res.status(400).json({ error: '课堂模式无效' });
    // ⚠️ 必须先 `Array.isArray` 再 `.filter`：智能体现在是**选填**，`agentIds` 缺席是常态
    // （从前那条 `!agentIds?.length` 的守卫顺带挡住了这一句，拆开报错后它就没人挡了）。
    // 顺带把 `classIds` 也收紧 —— 传个字符串进来 `"abc".length` 为真、`.filter` 却不存在，
    // 那是 500 而不是「请选择班级」，与「报错要告诉教师该怎么办」相悖。
    const toIdList = (raw: unknown): string[] => Array.from(new Set<string>(
      (Array.isArray(raw) ? raw : []).filter((id): id is string => typeof id === 'string' && !!id),
    ));
    const uniqueClassIds = toIdList(classIds);
    const uniqueAgentIds = toIdList(agentIds);
    if (uniqueClassIds.length === 0) return res.status(400).json({ error: '所选班级无效，请刷新页面后重新选择' });
    if (mode === 'group' && uniqueClassIds.length !== 1) return res.status(400).json({ error: '分组模式一次只能选择一个班级' });

    // ② 探究网页与学习单（**各自单选**，数组里最多只有第一个生效）。
    const webapp = await resolveSingleMaterialId(prisma, webappIds, 'webapp', 'create');
    if (!webapp.ok) return res.status(400).json({ error: webapp.error });
    const worksheet = await resolveSingleMaterialId(prisma, worksheetIds, 'worksheet', 'create');
    if (!worksheet.ok) return res.status(400).json({ error: worksheet.error });

    // ③ 三件套「至少一项」。智能体不是必填 —— 只选网页、只选学习单同样能建课堂。
    //    🔴 学习单数的是**课堂级的那一份**（0 或 1）：这个模式下全班共用一套材料，
    //    权威来源就是 `ClassroomWorksheet`（规格 §4 / §5.2）。高级模式那处**数法不同**
    //    （数真的配了的组级学习单数），见 `/create-advanced`。两处不能互相抄。
    const materialError = classroomMaterialError({
      agent: uniqueAgentIds.length,
      webapp: webapp.id ? 1 : 0,
      worksheet: worksheet.id ? 1 : 0,
    });
    if (materialError) return res.status(400).json({ error: materialError });

    const classroom = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const code = await generateUniqueClassroomCode(tx);
      const created = await tx.classroom.create({
      data: {
        code,
        title: title || null,
        mode,
        classes: {
          create: uniqueClassIds.map(classId => ({ classId })),
        },
        classroomAgents: {
          create: uniqueAgentIds.map(agentId => ({ agentId })),
        },
        // 单选 ⇒ 各自至多一行（`webappLinkRows` / `worksheetLinkRows` 仍按勾选顺序写
        // createdAt，见 `linkRowCreatedAt` 的注释：那是排序键，不能交给 DEFAULT）
        webapps: { create: webappLinkRows(webapp.id ? [webapp.id] : []) },
        worksheets: { create: worksheetLinkRows(worksheet.id ? [worksheet.id] : []) },
        // ★ 2026-09-29（教师）：「这三个模块在创建后默认是开放」。
        // 🔴 在这里**种下三行**、而不是改 `DEFAULT_MODULE_STATE`：那个常量同时兜着
        // 「行缺失」与「行里的值认不出」，而后者是一次读失败，不该把模块开给学生。
        // 副作用（有意）：新课堂从此 `hasModuleRows === true` ⇒「本课堂未单独配置过模块」
        // 那条提示不会再出现在新课堂上 —— 它本来就只在真的一行都没有时为真。
        modules: { create: initialModuleRows() },
      },
      include: {
        classes: { include: { class: { include: { students: true } } } },
        classroomAgents: { include: { agent: true } },
      },
      });

      if (mode === 'group') {
      // 分组模式：小组本身就是课堂参与者，不再创建虚拟 Student。
      const classGroups = await tx.classGroup.findMany({
        where: { classId: uniqueClassIds[0] },
      });
      for (const classGroup of classGroups) {
        const classroomGroup = await tx.classroomGroup.create({
          data: {
            classroomId: created.id,
            name: classGroup.name,
            sourceClassGroupId: classGroup.id,
          },
        });
        let memberIds: string[] = [];
        try { memberIds = JSON.parse(classGroup.studentIds || '[]'); } catch {}
        const members = memberIds.length > 0 ? await tx.student.findMany({
          where: { id: { in: memberIds } },
          select: { id: true, name: true, studentNo: true },
        }) : [];
        if (members.length > 0) {
          await tx.classroomGroupMember.createMany({ data: members.map(member => ({
            classroomId: created.id, groupId: classroomGroup.id,
            studentId: member.id, name: member.name, studentNo: member.studentNo,
          })) });
        }
        const participant = await tx.classroomStudent.create({
          data: {
            classroomId: created.id,
            type: 'group',
            groupId: classroomGroup.id,
          },
        });
        await tx.interaction.create({
          data: {
            classroomId: created.id,
            studentId: participant.id,
          },
        });
      }
    } else {
      // 标准模式：真实学生是课堂参与者。
      const allStudents = created.classes.flatMap((cc) => cc.class.students);
      for (const student of allStudents) {
        const participant = await tx.classroomStudent.create({ data: {
          classroomId: created.id, type: 'student', studentId: student.id,
        } });
        await tx.interaction.create({ data: { classroomId: created.id, studentId: participant.id } });
      }
      }
      return created;
    });

    res.json(classroom);
  } catch (error) {
    console.error('Create classroom error:', error);
    res.status(500).json({ error: '创建课堂失败' });
  }
});

// 创建课堂（高级模式 — 分组）
router.post('/create-advanced', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { title, classId, groups, webappIds, worksheetIds } = req.body;

    if (!classId || !groups?.length) {
      return res.status(400).json({ error: '请选择班级和分组' });
    }
    if (!Array.isArray(groups) || groups.length > 100) return res.status(400).json({ error: '分组数量无效' });
    const normalizedGroups = groups.map((group: unknown) => {
      const input = typeof group === 'object' && group !== null ? group as Record<string, unknown> : {};
      // 空串与缺字段一律归一成 `null`。`''` 会成为**第三种**状态落库：它在 `?.` 判空里
      // 与 `null` 表现一致、看起来是对的，直到有人写 `where: { targetId: null }` 的统计 ——
      // 那一刻空串那一行不在结果里，而没有任何地方报错。
      const toId = (raw: unknown): string | null =>
        (typeof raw === 'string' && raw.trim() ? raw.trim() : null);
      return {
        name: typeof input.name === 'string' ? input.name.trim() : '',
        agentId: toId(input.agentId),
        webappId: toId(input.webappId),
        worksheetId: toId(input.worksheetId),
      };
    });
    // ⚠️ 文案只说**名称**。智能体在高级模式里是**选填**（每组可以不指定），把它写进这条
    // 文案会把「只忘了填组名」的教师指到「智能体」那一栏去找原因 —— 那一栏根本没有错。
    if (normalizedGroups.some(group => !group.name)) return res.status(400).json({ error: '分组名称不能为空' });
    if (new Set(normalizedGroups.map(group => group.name)).size !== normalizedGroups.length) return res.status(400).json({ error: '分组名称不能重复' });

    // 课堂级网页在高级模式下**不落库**（理由见下面 `classroom.create` 的注释）。仍然解析它
    // 有两个用处：① 保持「口径只有一套」（与标准模式同一个 `resolveSingleMaterialId`）；
    // ② id 不存在时照样 400 —— 旧前端发来的「页面已过期」值得让教师刷新一次，
    // 而不是让他拿到一个自己没预期的课堂。
    // ⚠️ 但**必须留痕**：解析通过之后它就被丢掉了，而教师端看到的是「创建成功」。
    // 静默丢掉一个教师勾过的选项属于改数据不留痕（同 `trimExtraClassroomWebapps`
    // 与 `resolveSingleMaterialId` 里那两条「丢掉多余选项要写日志」的规矩）。
    const webapp = await resolveSingleMaterialId(prisma, webappIds, 'webapp', 'create-advanced');
    if (!webapp.ok) return res.status(400).json({ error: webapp.error });
    if (webapp.id) {
      console.warn(
        `[Classroom] 高级模式的课堂级网页不再生效（${webapp.id}）—— 该模式下网页的权威来源是「每组一份」，`
        + '这一项已被忽略。请在每个小组那一行单独选择网页（旧版创建页仍在发这个字段）。',
      );
    }

    // 课堂级学习单在高级模式下**同样不落库**，处理与上面那段逐字同构（口径只有一套：
    // 同一个 `resolveSingleMaterialId`；id 不存在照样 400；解析通过后被丢掉就必须留痕）。
    //
    // ⚠️ 与网页那处的**事实差异**，如实记下以免后人误判：网页那次是有**已部署的旧前端**在发
    // `webappIds`（今天的创建页已不发，见 `src/app/teacher/classroom/new/page.tsx` 里
    // 「不要在这里发课堂级的 `webappIds`」那段）。`worksheetIds` 是本次新加的字段，
    // **今天没有任何前端会在高级模式下发它**。所以这一处是**门禁**（口径同构 + 将来不会再
    // 长出「发了却被静默丢掉」这条路径），不是兼容旧版。
    // 留着它的理由仍然充分：静默丢掉一个教师勾过的选项属于改数据不留痕
    // （同 `trimExtraClassroomWebapps` 的规矩），而这个字段一旦有人发（比如把标准模式那一段
    // 同构地抄到高级分支里），失效将是**完全无声**的。
    const worksheet = await resolveSingleMaterialId(prisma, worksheetIds, 'worksheet', 'create-advanced');
    if (!worksheet.ok) return res.status(400).json({ error: worksheet.error });
    if (worksheet.id) {
      console.warn(
        `[Classroom] 高级模式的课堂级学习单不再生效（${worksheet.id}）—— 该模式下学习单的权威来源是`
        + '「每组一份」，这一项已被忽略。请在每个小组那一行单独选择学习单。',
      );
    }

    // 组级材料也要校验它存在 —— 走**同一个** `resolveMaterialIds`，不新长第二套口径。
    // 一次把所有组的 id 合起来校验（逐组调一次会变成 N 次同样的查询）。
    // ⚠️ 学习单**同样要校验**，尽管 `ClassroomGroupMaterial.targetId` 没有真外键（写不进去
    // 会失败的那种保护不存在）：不校验就会静默写下一行指向不存在目标的材料，而读路径把它
    // 如实显示成「未配置」⇒ 教师选了、学生看到「老师还没布置」，全程没有任何报错。
    const groupWebappCheck = await resolveMaterialIds(
      prisma,
      normalizedGroups.map(group => group.webappId).filter((id): id is string => id !== null),
      'webapp',
    );
    if (!groupWebappCheck.ok) return res.status(400).json({ error: groupWebappCheck.error });
    const groupWorksheetCheck = await resolveMaterialIds(
      prisma,
      normalizedGroups.map(group => group.worksheetId).filter((id): id is string => id !== null),
      'worksheet',
    );
    if (!groupWorksheetCheck.ok) return res.status(400).json({ error: groupWorksheetCheck.error });

    // 三件套「至少一项」——走**同一个**判据，但数的是**真的配了的材料数**。
    // ⚠️ 用「组的数量」冒充会让「所有组都不配」的空课堂建出来（见 `classroomMaterialError`
    // 的注释：那正是这条规则要防的形态）。
    // 🔴 课堂级材料（网页 / 学习单）**都不计入**这一项：本模式**不写**它们（下面 `create`
    // 的注释）。计一个不落库的材料，等于把「所有组都不指定 + 教师勾了课堂级材料」这条
    // 路径放行 —— 而它建出来的正是一个**三件套全空的课堂**，也就是这条规则唯一要防的形态。
    // 判据是「真的配了的材料数」，所以只数会落库的那些：**每组的**智能体 / 网页 / 学习单。
    // 🔴 `worksheet` 这一格**必须**是 `filter(...).length`，**不能用组的数量冒充** ——
    // 那正好会让上面那种「三件套全空」的课堂建出来（规格 §5.2）。
    const materialError = classroomMaterialError({
      agent: normalizedGroups.filter((group) => group.agentId).length,
      webapp: normalizedGroups.filter((group) => group.webappId).length,
      worksheet: normalizedGroups.filter((group) => group.worksheetId).length,
    });
    if (materialError) return res.status(400).json({ error: materialError });

    const classroom = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.classroom.create({
        data: {
        code: await generateUniqueClassroomCode(tx),
        title: title || null,
        mode: 'advanced',
          classes: { create: { classId } },
          // ★ 2026-09-29（教师）：「这三个模块在创建后默认是开放」—— 与 `/create` 那处
          // **逐字同源**（同一个 `initialModuleRows()`）。两条创建路径漏种一条的表现是
          // 「另一种模式建出来的课堂三个模块全点不进去」，而屏幕上没有任何异常。
          modules: { create: initialModuleRows() },
          // 🔴 高级模式**不再写课堂级网页**。网页在这个模式下的权威来源是「每组一份」，
          // 留着课堂级那一行会长出「它到底谁在用」的第二套解释，而运行期规定了不回落
          // ⇒ 它会变成一个**永远看不见、却挡得住删除守卫**的幽灵。
          // ⚠️ 已存在的课堂由 §4.2 第 5 步的实体化保证不回归（老课堂的课堂级网页已搬成每组一份）。
        },
      });

    const sourceGroups = await tx.classGroup.findMany({ where: { classId } });
    // Create group participants and freeze the roster at classroom creation.
    for (const group of normalizedGroups) {
      const sourceGroup = sourceGroups.find(item => item.name === group.name);
      const classroomGroup = await tx.classroomGroup.create({
        data: {
          classroomId: created.id,
          name: group.name,
          sourceClassGroupId: sourceGroup?.id,
        },
      });
      // 该组的材料各写一行。**唯一写入口** —— 运行期读的就是这些行（`resolveMaterialTargetId`）。
      // ⚠️ `targetId` 没有真外键，所以「目标已不存在」的兜底在删除守卫（agents.ts / webapps.ts）
      // 与读路径的容忍里，不在这里。
      for (const [kind, targetId] of [
        ['agent', group.agentId], ['webapp', group.webappId], ['worksheet', group.worksheetId],
      ] as const) {
        if (!targetId) continue;
        await tx.classroomGroupMaterial.create({ data: { groupId: classroomGroup.id, kind, targetId } });
      }
      let memberIds: string[] = [];
      try { memberIds = JSON.parse(sourceGroup?.studentIds || '[]'); } catch {}
      const members = memberIds.length > 0 ? await tx.student.findMany({
        where: { id: { in: memberIds } }, select: { id: true, name: true, studentNo: true },
      }) : [];
      if (members.length > 0) await tx.classroomGroupMember.createMany({ data: members.map(member => ({
        classroomId: created.id, groupId: classroomGroup.id,
        studentId: member.id, name: member.name, studentNo: member.studentNo,
      })) });
      const participant = await tx.classroomStudent.create({ data: {
        classroomId: created.id, type: 'group', groupId: classroomGroup.id,
      } });
      await tx.interaction.create({ data: { classroomId: created.id, studentId: participant.id } });
    }

    // 🔴 这里**不再**从各组 agentId 派生 `ClassroomAgent`。
    // 理由：迁移后组不再有 agentId，而高级模式下那个数组本就是「各组智能体的并集」，
    // 语义可疑 —— §1.2 ① 的学生静默用错智能体正是它造成的（运行期不再回落它）。
    // 学生端的智能体一律来自自己的组（`resolveMaterialTargetId`）。
    // ⚠️ 老课堂里已有的派生行**仍在**，它们是惰性的（读不到），本次不删 —— 删历史行
    // 属于另一个决定，而且删错了不可逆。

      return tx.classroom.findUnique({
      where: { id: created.id },
      include: {
        groups: { include: { materials: true } },
        classroomAgents: { include: { agent: true } },
        classes: { include: { class: { include: { students: true } } } },
      },
      });
    });

    res.json(classroom);
  } catch (error) {
    console.error('Create advanced classroom error:', error);
    res.status(500).json({ error: '创建高级课堂失败' });
  }
});

// 获取所有课堂（含全部关联数据，仪表盘用）
router.get('/all', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classrooms = await prisma.classroom.findMany({
      include: {
        _count: { select: { students: true, interactions: true } },
        classroomAgents: { include: { agent: true } },
        classes: { include: { class: true } },
        groups: { include: { materials: true, members: { select: { id: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // 组的材料（智能体 / 网页 / 学习单）走**同一个**解析口径（`resolveGroupMaterialViews`）。
    // 一次把全部课堂的组喂进去 ⇒ 总共只多三条 `in` 查询，与课堂数、组数无关。
    const groupMaterialViews = await resolveGroupMaterialViews(
      prisma, classrooms.flatMap(classroom => classroom.groups),
    );
    res.json(classrooms.map(classroom => ({
      ...classroom,
      groups: classroom.groups.map(({ materials: _materials, ...group }) => ({
        ...group,
        ...(groupMaterialViews.get(group.id) ?? EMPTY_GROUP_MATERIAL_VIEW),
      })),
      participantCount: classroom._count.students,
      realStudentCount: classroom.mode === 'group' || classroom.mode === 'advanced'
        ? classroom.groups.reduce((count, group) => count + group.members.length, 0)
        : classroom._count.students,
    })));
  } catch (error) {
    res.status(500).json({ error: '获取所有课堂失败' });
  }
});

// 获取活跃课堂（含暂停的课堂）
router.get('/active', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classrooms = await prisma.classroom.findMany({
      where: { status: { in: ['active', 'paused'] } },
      include: {
        _count: { select: { students: true } },
        students: { select: { studentId: true, totalRounds: true } },
        classroomAgents: { include: { agent: true } },
        classes: { include: { class: true } },
        groups: { include: { materials: true, members: { select: { id: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // 与 `/all` 同一条口径：组材料一次解析，三条 `in` 查询。
    const groupMaterialViews = await resolveGroupMaterialViews(
      prisma, classrooms.flatMap(classroom => classroom.groups),
    );
    // 管理页的「课堂设置」弹窗要把探究网页**只读展示**出来（P2.3），所以随列表一起下发。
    // 用**同一个** `loadClassroomWebapps`（与 `GET /:id`、`GET /code/:code` 同口径）逐课堂查一次：
    // 这里的行数就是「正在进行的课堂数」，通常只有 1~2 个，为省这几条查询去写第二套批量实现
    // 得不偿失 —— 口径分叉（比如排序不同）会让「管理页显示的那个」与「学生打开的那个」不是同一个。
    res.json(await Promise.all(classrooms.map(async classroom => ({
      ...classroom,
      groups: classroom.groups.map(({ materials: _materials, ...group }) => ({
        ...group,
        ...(groupMaterialViews.get(group.id) ?? EMPTY_GROUP_MATERIAL_VIEW),
      })),
      participantCount: classroom._count.students,
      realStudentCount: classroom.mode === 'group' || classroom.mode === 'advanced'
        ? classroom.groups.reduce((count, group) => count + group.members.length, 0)
        : classroom._count.students,
      webapps: await loadClassroomWebapps(prisma, classroom.id),
      // 课堂级学习单：与 `webapps` 同形同源（标准 / 分组模式的权威来源，高级模式恒为空数组）。
      worksheets: await loadClassroomWorksheets(prisma, classroom.id),
    }))));
  } catch (error) {
    res.status(500).json({ error: '获取活跃课堂失败' });
  }
});

// 将仍在进行中的分组课堂更新为当前班级分组。课堂结束后继续保留创建时的快照，
// 避免后续改组改写历史记录；已经产生对话的小组也不会因班级端删除而被静默移除。
router.post('/:id/sync-groups', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const classroom = await tx.classroom.findUnique({
        where: { id: req.params.id },
        include: {
          classes: { select: { classId: true } },
          groups: { select: { id: true, name: true, sourceClassGroupId: true } },
          classroomAgents: { select: { agentId: true } },
          // 高级模式补新组时要照迁移（§4.2 第 5 步）的同一条规则把课堂级网页实体化，
          // 否则新补的组与它同组的老组不是一套材料（老组看得到网页、新组看不到）。
          webapps: { select: { webappId: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        },
      });
      if (!classroom) throw new Error('CLASSROOM_NOT_FOUND');
      if (!['group', 'advanced'].includes(classroom.mode)) throw new Error('NOT_GROUP_CLASSROOM');
      if (!['active', 'paused'].includes(classroom.status)) throw new Error('CLASSROOM_ENDED');
      if (classroom.classes.length !== 1) throw new Error('INVALID_CLASSROOM_CLASS');

      const classId = classroom.classes[0].classId;
      const sourceGroups = await tx.classGroup.findMany({ where: { classId }, orderBy: { createdAt: 'asc' } });
      // 分组模式的学生仍用**课堂级**智能体（§4.4），所以它必须存在 —— 这条守卫只对分组模式成立。
      // ⚠️ 高级模式不能要求它：那里每组各自配材料，而 `classroomAgents` 已**不再派生**
      //    （Step 7 第 5 点）⇒ 新建的高级课堂这个数组是空的，照旧抛 MISSING_AGENT 会让
      //    「同步分组」对所有新的高级课堂永久 400。
      const fallbackAgentId = classroom.classroomAgents[0]?.agentId ?? null;
      if (classroom.mode === 'group' && !fallbackAgentId) throw new Error('MISSING_AGENT');
      // 高级模式：新补的组照迁移的同一条规则继承课堂级网页（单选 ⇒ 第一行）。
      const classroomWebappId = classroom.mode === 'advanced'
        ? (classroom.webapps[0]?.webappId ?? null)
        : null;

      let addedGroups = 0;
      let updatedGroups = 0;
      // 仅用名称补齐历史数据中没有 sourceClassGroupId 的旧课堂；之后会写回稳定关联。
      const claimedLegacyGroupIds = new Set<string>();
      for (const sourceGroup of sourceGroups) {
        let classroomGroup = classroom.groups.find(group => group.sourceClassGroupId === sourceGroup.id);
        if (!classroomGroup) {
          classroomGroup = classroom.groups.find(group =>
            !group.sourceClassGroupId && !claimedLegacyGroupIds.has(group.id) && group.name === sourceGroup.name,
          );
          if (classroomGroup) claimedLegacyGroupIds.add(classroomGroup.id);
        }

        if (!classroomGroup) {
          classroomGroup = await tx.classroomGroup.create({
            data: {
              classroomId: classroom.id,
              name: sourceGroup.name,
              sourceClassGroupId: sourceGroup.id,
            },
          });
          // ⚠️ 这里**不**继承课堂级智能体。高级模式里那个数组是「各组智能体的并集」，
          //    取第一个等于给新组随机挑一个别人的智能体 —— 正是 §1.2 ① 那个静默缺陷。
          //    新组没有材料就是「未配置」，由教师显式配置（读路径会如实显示成未配置）。
          //    分组模式不写材料：它的权威来源是课堂级（§4.4）。
          if (classroomWebappId) {
            await tx.classroomGroupMaterial.create({
              data: { groupId: classroomGroup.id, kind: 'webapp', targetId: classroomWebappId },
            });
          }
          const participant = await tx.classroomStudent.create({
            data: { classroomId: classroom.id, type: 'group', groupId: classroomGroup.id },
          });
          await tx.interaction.create({ data: { classroomId: classroom.id, studentId: participant.id } });
          addedGroups++;
        } else {
          await tx.classroomGroup.update({
            where: { id: classroomGroup.id },
            data: { name: sourceGroup.name, sourceClassGroupId: sourceGroup.id },
          });
          updatedGroups++;
        }

        let memberIds: string[] = [];
        try {
          const parsed: unknown = JSON.parse(sourceGroup.studentIds || '[]');
          memberIds = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
        } catch { /* Treat malformed legacy data as an empty group. */ }
        const members = memberIds.length === 0 ? [] : await tx.student.findMany({
          where: { id: { in: memberIds }, classId },
          select: { id: true, name: true, studentNo: true },
        });
        await tx.classroomGroupMember.deleteMany({ where: { groupId: classroomGroup.id } });
        if (members.length) {
          await tx.classroomGroupMember.createMany({
            data: members.map(member => ({
              classroomId: classroom.id,
              groupId: classroomGroup!.id,
              studentId: member.id,
              name: member.name,
              studentNo: member.studentNo,
            })),
          });
        }
      }

      return { addedGroups, updatedGroups, sourceGroupCount: sourceGroups.length };
    });

    const io = req.app.get('io');
    io?.to(`teacher:${req.params.id}`).emit('classroom-groups-synced', result);
    res.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'CLASSROOM_NOT_FOUND') return res.status(404).json({ error: '课堂不存在' });
    if (message === 'NOT_GROUP_CLASSROOM') return res.status(400).json({ error: '只有分组课堂可以同步分组' });
    if (message === 'CLASSROOM_ENDED') return res.status(409).json({ error: '已结束课堂保留原有分组快照，不能同步' });
    if (message === 'MISSING_AGENT') return res.status(400).json({ error: '课堂未配置可用智能体' });
    if (message === 'INVALID_CLASSROOM_CLASS') return res.status(400).json({ error: '该课堂无法确定所属班级' });
    console.error('[Classroom] sync groups error:', error);
    res.status(500).json({ error: '同步分组失败' });
  }
});

// 获取课堂详情（含学生列表和消息）
router.get('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({
      where: { id: req.params.id },
      include: {
        classes: { include: { class: true } },
        classroomAgents: { include: { agent: true } },
        groups: { include: { materials: true, members: { orderBy: { studentNo: 'asc' } } } },
        students: {
          include: {
            student: true,
            group: true,
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
          orderBy: { joinTime: 'asc' },
        },
      },
    });
    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    // 小组成员来自课堂创建时的快照，不再按当前班级组名动态匹配。
    const groupMembersMap: Record<string, { groupName: string; members: { id: string; name: string; studentNo: string | null }[] }> = {};
    for (const group of classroom.groups) {
      const snapshot = {
        groupName: group.name,
        members: group.members.map(member => ({ id: member.studentId || member.id, name: member.name, studentNo: member.studentNo })),
      };
      groupMembersMap[group.id] = snapshot;
    }

    const students = classroom.students.map(cs => ({
      ...cs,
      participantType: cs.type,
      participantId: cs.id,
      // 旧教师看板仍读取 student 字段；小组在此处只提供展示 DTO，并非数据库 Student。
      student: cs.student || {
        id: cs.id, classId: '', name: cs.group?.name || '未命名小组', studentNo: null,
        gender: null, tag: null, avatarId: null, avatarChangeTokens: 0,
      },
    }));
    // 教师端看板也依赖三态（刷新后要还原模块的开关状态）。
    // 与 /code/:code 共用 mergeModuleStates，老课堂的零行兜底只在这一处定义。
    // 读路径不可失败：ClassroomModule 表缺失（老库启动 DDL 被跳过）时降级为全默认态，
    // 绝不能因为查不到模块而把教师/学生挡在课堂之外。
    // 失败时留 null 而不是空数组：空数组同时意味着「查到了，零行」（老课堂，从未设置过），
    // 下面的 hasModuleRows 要区分这两种情况，不能把「读不到」说成「没有」。
    const moduleRecords = await prisma.classroomModule
      .findMany({ where: { classroomId: classroom.id }, select: { moduleKey: true, state: true } })
      .catch(() => null);
    // 探究空间：与 /code/:code 共用同一个查询函数（Ruling），避免学生端和教师看板
    // 两条路径口径不一。只含 id / name / entryPath，磁盘根路径不进响应。
    const webapps = await loadClassroomWebapps(prisma, classroom.id);
    // 课堂级学习单：与 `webapps` 同形同源（标准 / 分组模式的权威来源）。教师看板的
    // 「课堂设置」弹窗要把这一项只读展示出来，与网页并列。
    const worksheets = await loadClassroomWorksheets(prisma, classroom.id);
    // 组的材料（智能体 / 网页 / 学习单）走**同一个**解析口径 —— 「管理页显示的那个」与
    // 「学生打开的那个」必须是同一个。
    const groupMaterialViews = await resolveGroupMaterialViews(prisma, classroom.groups);
    res.json({
      ...classroom,
      groups: classroom.groups.map(({ materials: _materials, ...group }) => ({
        ...group,
        ...(groupMaterialViews.get(group.id) ?? EMPTY_GROUP_MATERIAL_VIEW),
      })),
      students,
      groupMembersMap,
      webapps,
      worksheets,
      modules: mergeModuleStates(moduleRecords ?? []),
      // 该课堂有没有 ClassroomModule 行。mergeModuleStates 会把缺失的 key 补齐成默认态，
      // 所以「三态全是 preview」既可能是「教师把三项都设成了暂停」也可能是「从未设置过」，
      // 前端单看 modules 分不出来。行数据本就读出来了，这个派生量不增加任何查询；
      // 读取失败（null）时不下结论、不发这个字段，前端只在明确拿到 false 时才提示。
      // 显式判空（而不是 `moduleRecords?.length ? … : undefined`）：写成后者会让「查到了、零行」
      // 也落到 undefined，老课堂的提示永远不再出现，且不报任何错。
      hasModuleRows: moduleRecords === null ? undefined : moduleRecords.length > 0,
      /**
       * ★ 2026-09-30：课堂级「逐题开放」的清单（`{ [学习单 id]: [已开放的题 id…] }`）。
       *
       * 🔴 **只在教师这一条路上发**。学生的读路径是 `GET /api/worksheets/:id/student-view`
       * 的 `openQuestions`（那里只发**他自己那一份单**的那几个 id）——
       * 把整间课堂的清单发给学生属于多给（高级模式下那是**别的组**的单）。
       * ⚠️ 别顺手也加到 `/code/:code` 上：那条载荷有「形状逐字钉住」的用例
       *（`student-join-flow.test.ts`），而学生端一个字节都不读它。
       * ⚠️ 归一化之后再发：`null`（老课堂）与坏值都收成 `{}`，客户端不必再防一次。
       */
      worksheetOpen: normalizeWorksheetOpen(classroom.worksheetOpen),
    });
  } catch (error) {
    res.status(500).json({ error: '获取课堂详情失败' });
  }
});

// 获取学生的完整对话记录
router.get('/:id/student/:studentId/messages', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroomStudent = await prisma.classroomStudent.findFirst({
      where: {
        classroomId: req.params.id,
        id: req.params.studentId,
      },
    });
    if (!classroomStudent) return res.status(404).json({ error: '未找到该学生' });

    const messages = await prisma.message.findMany({
      where: { studentId: classroomStudent.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    messages.reverse(); // 反转回正序，前端按时间顺序展示
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: '获取消息失败' });
  }
});

// 获取课堂全部消息（教师分析用）
router.get('/:id/all-messages', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(500, Math.max(50, Number.parseInt(String(req.query.limit || '500'), 10) || 500));
    // Message 已有 classroomId + createdAt 联合索引，直接按课堂读取可避免大班级时先查学生、再构造超长 IN 条件。
    const messages = await prisma.message.findMany({
      where: { classroomId: req.params.id },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        classroomStudent: { include: { student: true, group: true } },
      },
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: '获取消息失败' });
  }
});

router.get('/:id/message-stats', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const [total, userMessages, assistantMessages, participants] = await Promise.all([
      prisma.message.count({ where: { classroomId: req.params.id } }),
      prisma.message.count({ where: { classroomId: req.params.id, role: 'user' } }),
      prisma.message.count({ where: { classroomId: req.params.id, role: 'assistant' } }),
      prisma.message.findMany({ where: { classroomId: req.params.id }, distinct: ['studentId'], select: { studentId: true } }),
    ]);
    res.json({ total, userMessages, assistantMessages, participantCount: participants.length });
  } catch {
    res.status(500).json({ error: '获取消息统计失败' });
  }
});

// 根据互动码获取课堂信息（学生端用）
router.get('/code/:code', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({
      where: { code: req.params.code },
      include: {
        classroomAgents: { include: { agent: true } },
        groups: { include: { materials: true } },
      },
    });
    if (!classroom) return res.status(404).json({ error: '互动码无效' });
    if (classroom.status === 'ended') return res.status(400).json({ error: '课堂已结束' });

    // 三态随课堂信息一起下发，供学生端三条路径读取：首屏（外壳 loadClassroom 进入会话时）、
    // 连接达成时的补读（use-chat-socket 的 connect 回调用本端点只取 modules 合并 ——
    // 覆盖首次加入前与断线期间收不到广播的两个空窗）、以及 use-classroom-session 那条
    // 15 秒轮询（M1b-2 Task 6 起也合并 modules，覆盖连接存活期间漏掉一次广播的第三种窗口）。
    // 写入端点只为被设置的那一个模块建行，老课堂一行都没有，故必须按 MODULE_KEYS 补齐。
    // 读路径不可失败：ClassroomModule 表缺失（老库启动 DDL 被跳过）时降级为全默认态
    // ——「三个模块可见但锁定」是能接受的退化，把学生挡在课堂门外不是。
    const moduleRecords = await prisma.classroomModule
      .findMany({ where: { classroomId: classroom.id }, select: { moduleKey: true, state: true } })
      .catch(() => [] as { moduleKey: string; state: string }[]);

    // 探究空间：该课堂关联的网页，按关联顺序下发。
    // ⚠️ **只发 id / name / entryPath**，不发任何磁盘路径。学生端用
    // `http://${location.hostname}:${webappPort}/webapps/${id}/${entryPath}` 自己拼。
    // 查询失败（老库缺表）时降级为空数组 —— 读路径不可失败，不能把学生挡在课堂门外。
    const webapps = await loadClassroomWebapps(prisma, classroom.id);

    // 课堂级学习单：**标准 / 分组模式下学生知道「老师布置了哪一份」的唯一下发点**
    // （那两种模式 `groups[]` 里没有材料行，`standard` 下 `groups` 甚至是 `undefined`）。
    // 与 `webapps` 同形同源，学生端照 `mode` 二选一：高级看自己组，其余看这一个。
    const worksheets = await loadClassroomWorksheets(prisma, classroom.id);

    // 各组的材料（智能体 / 网页 / 学习单）。与 `/:id`、`/all`、`/active`、`join-classroom`
    // 共用同一个解析口径 —— 五条路径的形状必须逐字一致。
    const groupMaterialViews = await resolveGroupMaterialViews(prisma, classroom.groups);

    res.json({
      id: classroom.id,
      code: classroom.code,
      title: classroom.title,
      mode: classroom.mode,
      status: classroom.status,
      // ★ M5a：课堂级「锁定作答」。学生端读它来显示锁定态（与 `status` 同一条通道）。
      answersLocked: classroom.answersLocked,
      allowStudentStop: classroom.allowStudentStop,
      allowStudentExport: classroom.allowStudentExport,
      // ★ 2026-09-25：只禁提问（与 `status` 的整节课暂停区分开）。
      allowStudentAsk: classroom.allowStudentAsk,
      // 探究空间托管服务的**端口**（不是拼好的 URL）。学生端用
      // `http://${location.hostname}:${webappPort}` 自己拼 —— 它本来就知道自己是从哪个
      // IP 进来的，所以永远正确、无缓存、不会陈旧。托管源必须与父页面**跨源**，
      // sandbox 的 allow-same-origin 才是安全的。端口在 index.ts 里只算一次，这里只读。
      webappPort: req.app.get('webappPort') as number | undefined,
      webapps,
      // 课堂级学习单（数组，与 `webapps` 同形）。学生端按 `mode` 二选一取用：
      // 高级 ⇒ `groups[].worksheet`（自己组那份）；标准/分组 ⇒ 本数组的第 0 个。
      // ⚠️ 扁平字段（`groups[].worksheet`），不是 `groups[].materials.worksheet`。
      worksheets,
      modules: mergeModuleStates(moduleRecords),
      // ★ M7b：**学生绝不可见分析型**（一个「会收到全班作业」的 bot 不该出现在小学生的
      // 聊天列表里）。走共用助手 —— 「首屏」与「socket 的 joined」两处必须是同一把尺子
      // （`socket/index.ts` 那条注释逐字要求两者逐字一致）。
      agents: classroom.classroomAgents
        .map((ca) => studentAgentView(ca))
        .filter((view): view is NonNullable<typeof view> => view !== null),
      groups: (classroom.mode === 'advanced' || classroom.mode === 'group')
        ? classroom.groups.map(group => {
            const view = groupMaterialViews.get(group.id);
            return {
              id: group.id,
              name: group.name,
              // ⚠️ 三个都可能是 null（组可以不配，而且没有真外键 ⇒ 目标可能已被删）。
              //    今天那处非空解引用（`group.agent.id`）会让**整间课堂** 500。
              //    ⚠️ 这里**不写 `?? EMPTY_GROUP_MATERIAL_VIEW`**：`view` 的缺失是另一回事
              //    （Map 里本该每个组都有一条），逐字段判空更直白。三个字段一个都不能少 ——
              //    学生端按「有没有这个键」区分「未配置」与「这一版服务端还没这个功能」。
              agent: view?.agent ?? null,
              webapp: view?.webapp ?? null,
              worksheet: view?.worksheet ?? null,
            };
          })
        : undefined,
    });
  } catch (error) {
    res.status(500).json({ error: '查询课堂失败' });
  }
});

// 获取课堂的学生列表（学生端选择身份用）
// 身份选择前必须公开名单；沿用课堂码入口的温和限流，避免被持续轮询。
router.get('/:id/students', limitPublicCodeRequests, async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({
      where: { id: req.params.id },
      select: { mode: true, status: true },
    });
    if (!classroom || classroom.status === 'ended') {
      return res.status(404).json({ error: '课堂不存在或已结束' });
    }
    const students = await prisma.classroomStudent.findMany({
      where: { classroomId: req.params.id },
      include: { student: true, group: true },
    });
    const filtered = students;
    if (classroom.mode === 'standard') {
      filtered.sort((left, right) => compareStudentNumbers(
        left.student?.studentNo,
        right.student?.studentNo,
        left.student?.name || '',
        right.student?.name || '',
      ));
    }
    const isTeacher = hasTeacherSession(req);
    res.json(filtered.map((cs: Prisma.ClassroomStudentGetPayload<{ include: { student: true; group: true } }>) => ({
      // id 始终是稳定的课堂参与者 ID；标准模式另外保留真实 studentId。
      id: cs.id,
      participantType: cs.type,
      studentId: cs.studentId,
      name: cs.type === 'group' ? (cs.group?.name || '未命名小组') : (cs.student?.name || '未知学生'),
      // 学生端只需姓名和头像完成极简身份选择；学号、性别仅提供给教师端。
      studentNo: isTeacher ? (cs.student?.studentNo || null) : null,
      gender: isTeacher ? (cs.student?.gender || null) : null,
      avatarId: cs.student?.avatarId || null,
      groupId: cs.groupId,
      groupName: classroom?.mode === 'standard' ? undefined : cs.group?.name,
      status: cs.status,
    })));
  } catch (error) {
    res.status(500).json({ error: '获取学生列表失败' });
  }
});

// 教师奖励真实学生头像更换权限（参数为课堂参与者 ID；小组参与者不支持此操作）。
router.post('/:id/student/:studentId/reward-avatar', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const io = req.app.get('io');
    const participantId = req.params.studentId;
    const membership = await prisma.classroomStudent.findFirst({
      where: { classroomId: req.params.id, id: participantId },
      include: { classroom: { select: { status: true } } },
    });
    if (!membership) return res.status(404).json({ error: '该学生不属于当前课堂' });
    if (!membership.studentId) return res.status(400).json({ error: '小组参与者不支持更换头像奖励' });
    if (membership.classroom.status === 'ended') return res.status(409).json({ error: '课堂已结束，不能继续奖励' });
    const updated = await prisma.student.update({
      where: { id: membership.studentId },
      data: { avatarChangeTokens: { increment: 1 } },
    });
    // 实时通知学生端
    if (io) {
      io.to(`student:${membership.studentId}`).emit('avatar-rewarded', { tokens: updated.avatarChangeTokens });
    }
    res.json({ success: true, tokens: updated.avatarChangeTokens });
  } catch (error) {
    console.error('[reward-avatar] Error:', error);
    res.status(500).json({ error: '奖励失败' });
  }
});

// 结束课堂
router.post('/:id/end', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const changed = await tx.classroom.updateMany({
        where: { id: req.params.id, status: { in: [...ALLOWED_SOURCE_STATUSES.end] } },
        data: { status: 'ended', endedAt: new Date(), code: null },
      });
      if (changed.count !== 1) throw new Error('INVALID_CLASSROOM_STATE');
      return tx.classroom.findUniqueOrThrow({ where: { id: req.params.id } });
    });

    // 通知所有连接的学生和教师
    const io = req.app.get('io');
    const activeConnections = req.app.get('activeConnections') as Map<string, string> | undefined;
    const activeStreams = req.app.get('activeStreams') as Map<string, AbortController> | undefined;
    if (activeConnections && activeStreams) abortClassroomStreams(classroom.id, activeConnections, activeStreams);

    // 探究空间：取走本课堂的内存监控数据（取完即清空）→ 写唯一一条落盘汇总。
    // 内存态住在 socket 模块、结束逻辑在这里（预审 2），所以经 app.set('webappMonitor') 取用。
    //
    // ⚠️ 汇总失败**不能让本请求失败**：课堂在上面那个事务里已经结束（不可回滚），
    // 回 500 只会让教师看到「结束失败」而课堂其实已经结束了。记日志，把结果留在服务端。
    const webappMonitor = req.app.get('webappMonitor') as {
      drain: (classroomId: string) => WebappUsageRow[];
      record: (prisma: PrismaClient, classroomId: string, rows: WebappUsageRow[]) => Promise<number>;
    } | undefined;
    if (webappMonitor) {
      try {
        const rows = webappMonitor.drain(classroom.id);
        const written = await webappMonitor.record(prisma, classroom.id, rows);
        if (written > 0) console.log(`[Classroom] webapp usage summary written: ${written} row(s) for ${classroom.id}`);
      } catch (error) {
        console.error('[Classroom] webapp usage summary failed:', error);
      }
    }

    io.to(`classroom:${classroom.id}`).emit('classroom-ended');
    io.to(`teacher:${classroom.id}`).emit('classroom-ended');

    res.json(classroom);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CLASSROOM_STATE') {
      return res.status(409).json({ error: '只有进行中或已暂停的课堂可以结束' });
    }
    res.status(500).json({ error: '结束课堂失败' });
  }
});

/**
 * 更新课堂设置。
 *
 * 🔴 **只有课堂名称可以改，其余一律只读**。参与班级、参与模式、智能体、探究网页都是
 * 创建时冻结的：课堂已经开在学生面前了，中途换班级或换智能体等于换了另一堂课，
 * 历史对话与统计（`Interaction` 按参与者记）会对不上。
 *
 * 所以这里**只读 `title`** —— body 里其它字段不是「没校验」，是**不采用**：
 * 前端把它们渲染成只读展示，服务端则根本不看。两边都拦，任一被绕过都不会改到数据。
 *
 * 顺带对齐一次探究网页的单选约束（见 `trimExtraClassroomWebapps`）：多选时代留下的
 * 多余关联在这里裁掉，删了什么写进服务端日志。
 */
router.put('/:id/settings', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { title } = req.body;

    const dropped = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.classroom.update({
        where: { id: req.params.id },
        data: { title: title || null },
      });
      return trimExtraClassroomWebapps(tx, req.params.id);
    });

    // ⚠️ 日志在**事务提交之后**才写：写在事务里的话，一次回滚会留下一句没发生过的「已裁剪」。
    // 内容必须如实 —— 删了哪几条、留下了哪个，让「网页怎么少了一个」能查。
    if (dropped.length > 0) {
      console.warn(
        `[Classroom] 课堂 ${req.params.id} 保存设置时裁剪了 ${dropped.length} 条多余的探究网页关联：` +
        `删除 ${dropped.map(link => link.webappId).join(', ')}（探究网页为单选，保存后只保留第一位）`,
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Update classroom settings error:', error);
    res.status(500).json({ error: '更新课堂设置失败' });
  }
});

// 暂停课堂
router.post('/:id/pause', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const changed = await prisma.classroom.updateMany({ where: { id: req.params.id, status: ALLOWED_SOURCE_STATUSES.pause[0] }, data: { status: 'paused' } });
    if (changed.count !== 1) return res.status(409).json({ error: '只有进行中的课堂可以暂停' });
    const classroom = await prisma.classroom.findUniqueOrThrow({ where: { id: req.params.id } });

    const io = req.app.get('io');
    const activeConnections = req.app.get('activeConnections') as Map<string, string> | undefined;
    const activeStreams = req.app.get('activeStreams') as Map<string, AbortController> | undefined;
    if (activeConnections && activeStreams) abortClassroomStreams(classroom.id, activeConnections, activeStreams);
    io.to(`classroom:${classroom.id}`).emit('classroom-paused');
    io.to(`teacher:${classroom.id}`).emit('classroom-paused');

    res.json(classroom);
  } catch (error) {
    console.error('[Classroom] pause error:', error);
    res.status(500).json({ error: '暂停课堂失败' });
  }
});

// 恢复课堂
router.post('/:id/resume', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const changed = await prisma.classroom.updateMany({ where: { id: req.params.id, status: ALLOWED_SOURCE_STATUSES.resume[0] }, data: { status: 'active' } });
    if (changed.count !== 1) return res.status(409).json({ error: '只有已暂停的课堂可以继续' });
    const classroom = await prisma.classroom.findUniqueOrThrow({ where: { id: req.params.id } });

    const io = req.app.get('io');
    io.to(`classroom:${classroom.id}`).emit('classroom-resumed');
    io.to(`teacher:${classroom.id}`).emit('classroom-resumed');

    res.json(classroom);
  } catch (error) {
    console.error('[Classroom] resume error:', error);
    res.status(500).json({ error: '恢复课堂失败' });
  }
});

// M5a：锁定作答（停笔，但交卷仍然放行 —— 规格 §3.2）
router.post('/:id/lock-answers', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    // 先判存在：`update` 对不存在的 id 会抛，而我们要的是 404（不是 500）。
    const exists = await prisma.classroom.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: '课堂不存在' });
    // 🔴 **幂等**：已经锁着再锁一次也 200，而且**照样广播** ——
    // 客户端的状态可能与服务端不同步（另一个标签页、刚重连），一次多余的广播是自愈，
    // 不是噪音（载荷是空的，一个事件名而已）。
    const classroom = await prisma.classroom.update({ where: { id: req.params.id }, data: { answersLocked: true } });

    const io = req.app.get('io');
    if (io) {
      io.to(`classroom:${classroom.id}`).emit('answers-locked');
      io.to(`teacher:${classroom.id}`).emit('answers-locked');
    }

    res.json(classroom);
  } catch (error) {
    console.error('[Classroom] lock answers error:', error);
    res.status(500).json({ error: '锁定作答失败' });
  }
});

// M5a：解锁作答
router.post('/:id/unlock-answers', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const exists = await prisma.classroom.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: '课堂不存在' });
    const classroom = await prisma.classroom.update({ where: { id: req.params.id }, data: { answersLocked: false } });

    const io = req.app.get('io');
    if (io) {
      io.to(`classroom:${classroom.id}`).emit('answers-unlocked');
      io.to(`teacher:${classroom.id}`).emit('answers-unlocked');
    }

    res.json(classroom);
  } catch (error) {
    console.error('[Classroom] unlock answers error:', error);
    res.status(500).json({ error: '解锁作答失败' });
  }
});

/**
 * ★ 2026-09-30（教师）：课堂级「逐题开放」—— 把某一份学习单**已开放的题**整份写下去。
 *
 * 教师原话：「题目开放方式有必要再增加一个：允许教师纯手工、可按顺序的、一个一个去开启
 * 每个小题的使用权限，在教师看板页面中，找一个合适的位置和方式，帮我呈现控制界面」。
 *
 * ── 形状 ──────────────────────────────────────────────────────────────────
 * `POST /api/classroom/:id/worksheet-open`，body `{ worksheetId, questionIds }`。
 * 🔴 **整份替换**、不是增量（`+1 / -1` 那种）：教师那台机器上同时开着看板与设置是常事，
 * 增量式的「先读再改」会让两个标签页互相丢更新。整份替换天然是后写者赢，而且**幂等**
 *（同一个清单发两次结果一样，客户端重试/重连都不会改变状态）。
 * 🔴 返回**整张映射**（不是刚写的那一份单）：客户端拿它直接覆盖本地那份，
 * 高级模式下别的组那份也在里面 —— 少发一份就要客户端自己去拼，那是第二份真相。
 *
 * ── 校验 ──────────────────────────────────────────────────────────────────
 * · 课堂不存在 ⇒ 404（`update` 对不存在的 id 会抛，而我们要的是 404 不是 500）；
 * · 学习单不存在 ⇒ 404；
 * · **题 id 必须真的在这份学习单里** ⇒ 否则 400。最后一条是必要的：教师的标签页可能停在
 *   几十分钟前那一版（课上改过题），把已经不存在的 id 存下去只会让库里长出一堆幽灵条目，
 *   而**没有任何东西会报错** —— 学生那边少一道题，老师以为是自己的错觉。
 *
 * ⚠️ 幂等：清单没变也照样写、照样广播（与 `lock-answers` 同一条理由 —— 客户端的状态
 * 可能与服务端不同步，一次多余的广播是自愈，不是噪音）。
 * ⚠️ 权限：走教师端那一道闸（`index.ts` 给 `/api/classroom` 注册的 `requireTeacher`）——
 * 学生**拿不到**这个端点，所以清单不可能由学生改。
 */
router.post('/:id/worksheet-open', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const worksheetId = typeof req.body?.worksheetId === 'string' ? req.body.worksheetId : '';
    const questionIds: unknown = req.body?.questionIds;
    if (!worksheetId) return res.status(400).json({ error: '缺少学习单 id' });
    if (!Array.isArray(questionIds)) return res.status(400).json({ error: 'questionIds 必须是数组' });

    const classroom = await prisma.classroom.findUnique({
      where: { id: req.params.id },
      select: { id: true, worksheetOpen: true },
    });
    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    const worksheet = await prisma.worksheet.findUnique({
      where: { id: worksheetId },
      select: { id: true, content: true },
    });
    if (!worksheet) return res.status(404).json({ error: '学习单不存在' });

    // 归一化**先做**：坏形状（非字符串 / 重复 / 空串）在这里被丢掉，
    // 下面那道「是不是这份单的题」只面对一份干净的清单。
    const next = withOpenQuestions(classroom.worksheetOpen, worksheetId, questionIds);
    const wanted = next[worksheetId] ?? [];
    // ⚠️ 与 `worksheets.ts` 那条读法逐字同形（`.nodes ?? []`）：`content` 是库里的 JSON，
    // 手改过的行可能是任何形状 —— 少了 `?? []`，一份坏数据会让这个端点 500。
    const known = new Set(
      flattenAnswerable((worksheet.content as unknown as WorksheetContent).nodes ?? [])
        .map(({ node }) => node.id),
    );
    const unknownId = wanted.find((id) => !known.has(id));
    if (unknownId) {
      return res.status(400).json({ error: `这一题不在这份学习单里（${unknownId}），刷新页面后重试` });
    }

    const updated = await prisma.classroom.update({
      where: { id: classroom.id },
      data: { worksheetOpen: next },
    });

    const io = req.app.get('io');
    if (io) {
      // 🔴 载荷里带上 `worksheetId`：一间课堂可以有好几份单（高级模式），
      // 收到广播的人必须知道**是哪一份**变了，否则只能整份重拉。
      const payload = { worksheetId, questionIds: wanted };
      io.to(`classroom:${updated.id}`).emit('worksheet-open-changed', payload);
      io.to(`teacher:${updated.id}`).emit('worksheet-open-changed', payload);
    }

    res.json({ worksheetOpen: normalizeWorksheetOpen(updated.worksheetOpen) });
  } catch (error) {
    console.error('[Classroom] worksheet-open error:', error);
    res.status(500).json({ error: '设置逐题开放失败' });
  }
});

// 恢复已结束的课堂（重新生成互动码）
router.post('/:id/restore', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');

    // 1. 校验课堂状态
    const existing = await prisma.classroom.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, mode: true },
    });
    if (!existing) return res.status(404).json({ error: '课堂不存在' });
    if (existing.status !== 'ended') return res.status(400).json({ error: '只能恢复已结束的课堂' });

    const classroom = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newCode = await generateUniqueClassroomCode(tx);
      const changed = await tx.classroom.updateMany({
        where: { id: req.params.id, status: ALLOWED_SOURCE_STATUSES.restore[0] },
        // ★ M5a：恢复课堂 = 重新开始上课 ⇒ 顺手解锁（仍停笔是自相矛盾的）。
        // 这里**只通知教师端**（学生要用新码重新加入，不在房间里）—— 与这段既有注释一致。
        // ★ 2026-09-30：「逐题开放」的清单**一起清掉** —— 那是**上一节课**的进度，
        // 留着会让新一节课一打开就开放着上次讲到的那几题（而教师以为要从头开始）。
        data: { status: 'active', code: newCode, endedAt: null, answersLocked: false, worksheetOpen: Prisma.JsonNull },
      });
      if (changed.count !== 1) throw new Error('INVALID_CLASSROOM_STATE');
      return tx.classroom.findUniqueOrThrow({ where: { id: req.params.id } });
    });

    // 通知教师端（学生端不通知，学生需重新用新码加入）
    const io = req.app.get('io');
    if (io) {
      io.to(`teacher:${classroom.id}`).emit('classroom-restored', { classroom });
    }

    res.json(classroom);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CLASSROOM_STATE') {
      return res.status(409).json({ error: '该课堂已被恢复，请刷新页面' });
    }
    console.error('[Classroom] restore error:', error);
    res.status(500).json({ error: '恢复课堂失败' });
  }
});

// 切换是否允许学生中断 AI 回答
router.post('/:id/toggle-allow-stop', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({ where: { id: req.params.id } });
    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    const updated = await prisma.classroom.update({
      where: { id: req.params.id },
      data: { allowStudentStop: !classroom.allowStudentStop },
    });

    const io = req.app.get('io');
    io.to(`classroom:${classroom.id}`).emit('allow-stop-changed', { allow: updated.allowStudentStop });
    io.to(`teacher:${classroom.id}`).emit('allow-stop-changed', { allow: updated.allowStudentStop });

    res.json({ allowStudentStop: updated.allowStudentStop });
  } catch (error) {
    console.error('[Classroom] toggle allow-stop error:', error);
    res.status(500).json({ error: '切换失败' });
  }
});

/**
 * 切换是否允许学生**提问**（★ 2026-09-25）。
 *
 * 🔴 它与 `POST /:id/pause`（「暂停课堂」）是**两件事**，别合并：
 *   · `pause` 改的是 `status`，封住**三件套整体**（学习单 / 探究空间 / 智能学伴都进不去）；
 *   · 这一条只关掉「问问题」这一件事 —— 学生仍然能看学习单、看探究网页。
 * 拆开的直接原因：工具栏上那个按钮**标签写着「暂停学生提问」而调的是 `pause`**
 * （2026-09-25 之前一直如此），教师要求「暂停课堂」归按钮、只禁提问归课堂权限。
 */
router.post('/:id/toggle-allow-ask', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({ where: { id: req.params.id } });
    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    const updated = await prisma.classroom.update({
      where: { id: req.params.id },
      data: { allowStudentAsk: !classroom.allowStudentAsk },
    });

    const io = req.app.get('io');
    io.to(`classroom:${classroom.id}`).emit('allow-ask-changed', { allow: updated.allowStudentAsk });
    io.to(`teacher:${classroom.id}`).emit('allow-ask-changed', { allow: updated.allowStudentAsk });

    res.json({ allowStudentAsk: updated.allowStudentAsk });
  } catch (error) {
    console.error('[Classroom] toggle allow-ask error:', error);
    res.status(500).json({ error: '切换失败' });
  }
});

// 切换是否允许学生导出（复制/Word）
router.post('/:id/toggle-allow-export', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({ where: { id: req.params.id } });
    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    const updated = await prisma.classroom.update({
      where: { id: req.params.id },
      data: { allowStudentExport: !classroom.allowStudentExport },
    });

    const io = req.app.get('io');
    io.to(`classroom:${classroom.id}`).emit('allow-export-changed', { allow: updated.allowStudentExport });
    io.to(`teacher:${classroom.id}`).emit('allow-export-changed', { allow: updated.allowStudentExport });

    res.json({ allowStudentExport: updated.allowStudentExport });
  } catch (error) {
    console.error('[Classroom] toggle allow-export error:', error);
    res.status(500).json({ error: '切换失败' });
  }
});

/**
 * 设置本课堂的探究空间采集参数（P2.2）：要不要采画面、多清楚、多久一次。
 *
 * ⚠️ **改完必须重新下发一次档位。** 学生端不会主动来问 —— 它只在收到
 * `webapp-monitor-demand` 时才换档。少了这一步，教师调完之后要等到下一次
 * 订阅/退订才生效，而那时教师很可能已经离开这个视图了 ⇒ **"设置没生效"且没有任何报错**。
 *
 * ⚠️ 归一化在服务端做（`captureFieldsFromInput`）：宽度与周期都会被夹进合法范围。
 * 客户端拿到的永远是已经合法的值。
 *
 * 注：多标签页的教师端同步（`webapp-capture-changed`）跟着 T4 的界面一起接，
 * 这里先不发那条事件 —— 教师自己的界面用本次响应更新即可。
 */
router.post('/:id/webapp-capture', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({ where: { id: req.params.id } });
    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    const fields = captureFieldsFromInput(req.body ?? {});
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: '没有要修改的采集参数' });
    }

    const updated = await prisma.classroom.update({ where: { id: req.params.id }, data: fields });

    await broadcastWebappDemand(req.app.get('io'), prisma, classroom.id);

    res.json(normalizeCaptureConfig(updated));
  } catch (error) {
    console.error('[Classroom] set webapp-capture error:', error);
    res.status(500).json({ error: '设置失败' });
  }
});

// 切换是否允许追问建议
router.post('/:id/toggle-allow-follow-ups', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroom = await prisma.classroom.findUnique({ where: { id: req.params.id } });
    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    const updated = await prisma.classroom.update({
      where: { id: req.params.id },
      data: { allowFollowUps: !classroom.allowFollowUps },
    });

    const io = req.app.get('io');
    io.to(`classroom:${classroom.id}`).emit('follow-ups-changed', { allow: updated.allowFollowUps });
    io.to(`teacher:${classroom.id}`).emit('follow-ups-changed', { allow: updated.allowFollowUps });

    res.json({ allowFollowUps: updated.allowFollowUps });
  } catch (error) {
    console.error('[Classroom] toggle allow-follow-ups error:', error);
    res.status(500).json({ error: '切换失败' });
  }
});

// 设置课堂模块的三态（open / preview / hidden）
// 用 PUT 而非 toggle：三态没有「取反」语义，PUT 幂等、带目标态、可重试。
router.put('/:id/modules/:moduleKey', async (req, res) => {
  // 先校验再落库：非法输入不得产生任何写入或广播。
  const { moduleKey } = req.params;
  const { state } = req.body ?? {};
  if (!isValidModuleKey(moduleKey)) {
    return res.status(400).json({ error: '无效的模块标识' });
  }
  if (!isValidModuleState(state)) {
    return res.status(400).json({ error: '无效的模块状态' });
  }

  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const id = req.params.id;
    const classroom = await prisma.classroom.findUnique({ where: { id } });
    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    // 老课堂没有 ClassroomModule 行，因此用 upsert 而非 create。
    // where 的复合键名由 Prisma 依 @@unique([classroomId, moduleKey]) 约定生成。
    await prisma.classroomModule.upsert({
      where: { classroomId_moduleKey: { classroomId: id, moduleKey } },
      create: { classroomId: id, moduleKey, state },
      update: { state },
    });

    // 教师端只加入 teacher:<id>，学生端只加入 classroom:<id>，两边都必须发。
    const io = req.app.get('io');
    io.to(`classroom:${id}`).emit('module-state-changed', { moduleKey, state });
    io.to(`teacher:${id}`).emit('module-state-changed', { moduleKey, state });

    res.json({ moduleKey, state });
  } catch (error) {
    console.error('[Classroom] set module state error:', error);
    res.status(500).json({ error: '设置模块状态失败' });
  }
});

// 清除学生的对话记录（重置为新会话）
router.delete('/:id/student/:studentId/messages', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroomStudent = await prisma.classroomStudent.findFirst({
      where: {
        classroomId: req.params.id,
        id: req.params.studentId,
      },
    });
    if (!classroomStudent) return res.status(404).json({ error: '未找到该学生' });

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.message.deleteMany({ where: { studentId: classroomStudent.id } });
      await tx.interaction.upsert({
      where: {
        classroomId_studentId: {
          classroomId: req.params.id,
          studentId: classroomStudent.id,
        },
      },
      update: { totalRounds: 0, firstMsgLen: null },
      create: { classroomId: req.params.id, studentId: classroomStudent.id },
      });
      await tx.classroomStudent.update({
      where: { id: classroomStudent.id },
      data: { totalRounds: 0 },
      });
    });

    // 通知该学生端清空对话
    const io = req.app.get('io');
    io.to(`classroom:${req.params.id}`).emit('messages-cleared', {
      studentId: req.params.studentId,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Clear messages error:', error);
    res.status(500).json({ error: '清除记录失败' });
  }
});

// 获取历史课堂列表
router.get('/history/all', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classrooms = await prisma.classroom.findMany({
      where: { status: 'ended' },
      include: {
        _count: { select: { students: true, interactions: true } },
        classes: { include: { class: true } },
        groups: { include: { members: { select: { id: true } } } },
      },
      orderBy: { endedAt: 'desc' },
      take: 50,
    });

    // 批量查询每个课堂的参与学生数和消息总字数
    const ids = classrooms.map(c => c.id);
    type MsgStat = { classroomId: string; participantCount: number; totalChars: number; totalRounds: number };
    let statsMap = new Map<string, MsgStat>();
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const raw = await prisma.$queryRawUnsafe<MsgStat[]>(
        `SELECT "classroomId", COUNT(DISTINCT "studentId") AS "participantCount", SUM(LENGTH("content")) AS "totalChars", SUM(CASE WHEN "role" = 'user' THEN 1 ELSE 0 END) AS "totalRounds" FROM "Message" WHERE "classroomId" IN (${placeholders}) GROUP BY "classroomId"`,
        ...ids,
      );
      statsMap = new Map(raw.map(r => [r.classroomId, r]));
    }

    // ★ M6c：三件套的三个数（探究空间 + 学习单）。**一次查完**，不分课堂发查询。
    const traces = await loadHistoryTraces(prisma, ids);

    const result = classrooms.map(c => ({
      ...c,
      participantCount: Number(statsMap.get(c.id)?.participantCount ?? 0),
      realStudentCount: c.mode === 'group' || c.mode === 'advanced'
        ? c.groups.reduce((count, group) => count + group.members.length, 0)
        : c._count.students,
      totalRounds: Number(statsMap.get(c.id)?.totalRounds ?? 0),
      totalChars: Number(statsMap.get(c.id)?.totalChars ?? 0),
      ...(traces.get(c.id) ?? { webappUsageCount: 0, webappDurationMs: 0, worksheetSubmitted: 0, worksheetTotal: 0 }),
      // ★ **时长文案由服务端算好**：`formatDuration` 住在服务端的判据层里，前端 import 它会
      //   连带拉进 `./ink-path.js`（Next 解析不了那种说明符）⇒ 让前端另写一份是**第二份实现**。
      //   所以口径那一条（规格 §3.2「不许在历史页再写一份」）靠**这个字段**成立。
      webappDurationText: formatDuration(traces.get(c.id)?.webappDurationMs ?? 0),
    }));

    res.json(result);
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: '获取历史记录失败' });
  }
});

  // 获取课堂当前在线学生 ID 列表（从 socket 活跃连接 Map 中读取）
  router.get("/:id/online", (req, res) => {
    try {
      const activeConnections = req.app.get("activeConnections") as Map<string, string> | undefined;
      if (!activeConnections) return res.json({ studentIds: [] });
      const classroomId = req.params.id;
      const studentIds: string[] = [];
      for (const key of activeConnections.keys()) {
        const [cid, sid] = key.split(":");
        if (cid === classroomId) studentIds.push(sid);
      }
      res.json({ studentIds });
    } catch (error) {
      res.status(500).json({ error: "获取在线状态失败" });
    }
  });

// 获取教师通知（学生端页面加载 / 重连时调用）
router.get('/:id/notifications', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { studentId } = req.query;
    const notifications = await prisma.teacherNotification.findMany({
      where: {
        classroomId: req.params.id,
        ...(typeof studentId === 'string' ? {
          OR: [
            { studentId: null },
            { studentId },
          ],
        } : {}),
      },
      // 重连只需恢复最近通知；限制读取量避免长期课堂的通知记录拖慢学生端恢复。
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(notifications.reverse());
  } catch (error) {
    console.error('[Notifications] get error:', error);
    res.status(500).json({ error: '获取教师通知失败' });
  }
});

export default router;
