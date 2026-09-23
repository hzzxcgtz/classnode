import crypto from 'crypto';
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import { requireTeacher } from '../middleware/auth.js';
import { getStudentSession } from '../middleware/student-auth.js';
import {
  flattenQuestions,
  validateQuestion,
  type QuestionNode,
  type QuestionType,
  type WorksheetContent,
} from '../services/worksheet-questions.js';

/**
 * 学习单路由。
 *
 * 鉴权在 `index.ts` 注册时分层（本项目约定：路由自身不加重认证）——
 * 但本路由**混装**教师端与学生端，所以 `worksheetAccessGate` 是安全的关键，
 * 见它的定义与 `index.ts` 里 `app.use('/api/worksheets', …)` 的注释。
 *
 * 文件按**教师端 / 学生端**两块分段：B3/B4 往「学生端」那一块里加处理器，
 * 不要动教师端那一段。
 */

// ── 鉴权闸门（★ 安全关键）───────────────────────────────────────────

/**
 * 学生只放行**三种形状**，其余一律拦下。三种形状：
 *   · `GET  /:id/student-view`     读自己那一份（服务端已剥离答案，§5.4）
 *   · `PUT  /:id/answers`          保存单题（幂等）
 *   · `POST /:id/answers/submit`   提交单题
 *
 * 🔴 学生 token 打教师端形状回 **403**，不回 401：401 的语义是「你没有认证」，
 * 而学生手里明明握着一个**有效**的 token —— 谎报未认证会让「cookie 过期了？」与
 * 「这接口学生不能用」两件事在日志与前端提示里混成一团。没有凭据时仍然回落到
 * `requireTeacher`（401），所以这一支不会把 401 这条路径吞掉。
 *
 * ⚠️ 「已查看」是 `POST /:id/review`，**不在**上面三种形状里 ⇒ 自然走教师那一支。
 * 改动下面这三条正则时务必确认它仍然**不匹配** `review`（B4 的第一条用例钉的就是它）。
 */
export const worksheetAccessGate: RequestHandler = (req, res, next) => {
  const student = getStudentSession(req);
  if (student) {
    const view = req.method === 'GET' && /^\/[^/]+\/student-view\/?$/.test(req.path);
    const save = req.method === 'PUT' && /^\/[^/]+\/answers\/?$/.test(req.path);
    const submit = req.method === 'POST' && /^\/[^/]+\/answers\/submit\/?$/.test(req.path);
    if (view || save || submit) return next();
    res.status(403).json({ error: '该接口仅教师可用' });
    return;
  }
  requireTeacher(req, res, next);
};

const router: Router = Router();

// ── content / settings 的解析与校验 ─────────────────────────────────

const QUESTION_TYPES: readonly string[] = ['single-choice', 'fill-blank', 'short-answer'];
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;

const DEFAULT_SETTINGS = {
  allowResubmit: true,
  autoGrade: true,
  defaultInputMode: 'keyboard',
} as const;

function normalizeSettings(raw: unknown): Prisma.InputJsonValue {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? raw as Record<string, unknown>
    : {};
  return {
    allowResubmit: typeof source.allowResubmit === 'boolean' ? source.allowResubmit : DEFAULT_SETTINGS.allowResubmit,
    autoGrade: typeof source.autoGrade === 'boolean' ? source.autoGrade : DEFAULT_SETTINGS.autoGrade,
    defaultInputMode: source.defaultInputMode === 'handwriting' ? 'handwriting' : DEFAULT_SETTINGS.defaultInputMode,
  };
}

/**
 * 归一化一道题。
 *
 * `id` 缺失时由服务端补一个 `q_<uuid>`（规格 §4.3 的占位形状）：创建时前端可能还没生成，
 * 而**提交之后这个 id 就是答案行的外键**（`WorksheetAnswer.questionId`），
 * 一旦落地就不能再变 —— 所以「补 id」只能发生在写入之前，不能发生在读取时。
 */
function normalizeNode(
  raw: unknown,
  label: string,
  errors: string[],
  seen: Set<string>,
): QuestionNode | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`${label}：题目格式不正确`);
    return null;
  }
  const node = raw as Record<string, unknown>;
  const type = typeof node.type === 'string' ? node.type : '';
  if (!QUESTION_TYPES.includes(type)) {
    errors.push(`${label}：题型「${type || '（空）'}」不受支持`);
    return null;
  }

  let id = typeof node.id === 'string' ? node.id.trim() : '';
  if (!id) id = `q_${crypto.randomUUID()}`;
  if (seen.has(id)) {
    // 重复 id 不是「小瑕疵」：`WorksheetAnswer` 的唯一键是 `(responseId, questionId)`，
    // 两道题共用 id ⇒ 学生的答案会 upsert 到同一行上，而看板与判分都以为有两道题。
    errors.push(`${label}：题目 id 重复（${id}）`);
    return null;
  }
  seen.add(id);

  const data = (node.data && typeof node.data === 'object' && !Array.isArray(node.data))
    ? node.data as Record<string, unknown>
    : {};

  const children = Array.isArray(node.children)
    ? node.children
      .map((child, index) => normalizeNode(child, `${label}.${index + 1}`, errors, seen))
      .filter((child): child is QuestionNode => child !== null)
    : [];

  return {
    id,
    type: type as QuestionType,
    prompt: typeof node.prompt === 'string' ? node.prompt : '',
    inputMode: node.inputMode === 'handwriting' ? 'handwriting' : 'keyboard',
    data,
    children,
  };
}

/** 校验并归一化 `content`。返回中文错误串（不合法时）。 */
function parseContent(raw: unknown): { ok: true; content: WorksheetContent } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'content 必须是对象' };
  }
  const source = raw as Record<string, unknown>;
  if (!Array.isArray(source.nodes)) {
    return { ok: false, error: 'content.nodes 必须是数组' };
  }

  const errors: string[] = [];
  const seen = new Set<string>();
  const nodes = source.nodes
    .map((node, index) => normalizeNode(node, `第 ${index + 1} 题`, errors, seen))
    .filter((node): node is QuestionNode => node !== null);

  // ⚠️ 校验跑在**归一化之后的树**上（`flattenQuestions` 递归展开），不是在原始 JSON 上：
  // 原始树里的 `children` 可能是任何东西，只有归一化过的节点形状才与判分/下发路径同构。
  for (const node of flattenQuestions({ schemaVersion: 1, nodes })) {
    for (const message of validateQuestion(node)) {
      const prompt = node.prompt.trim();
      errors.push(prompt ? `「${prompt.slice(0, 20)}」：${message}` : `${message}`);
    }
  }
  if (errors.length > 0) return { ok: false, error: errors.join('；') };

  const schemaVersion = typeof source.schemaVersion === 'number'
    && Number.isInteger(source.schemaVersion)
    && source.schemaVersion > 0
    ? source.schemaVersion
    : 1;

  return { ok: true, content: { schemaVersion, nodes } };
}

function readTitle(raw: unknown): string | null {
  const title = typeof raw === 'string' ? raw.trim() : '';
  return title ? title.slice(0, TITLE_MAX) : null;
}

function readDescription(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return text ? text.slice(0, DESCRIPTION_MAX) : null;
}

// ── 引用统计（`/usage` 与删除守卫共用同一个函数）────────────────────

interface WorksheetUsage {
  classrooms: Array<{ id: string; title: string; status: string; mode: string }>;
  endedClassroomCount: number;
  groupCount: number;
  responseCount: number;
}

/**
 * 删除守卫要数**三样**，不是两样（规格 §5.5）：
 *   ① 课堂级关联 `ClassroomWorksheet`
 *   ② 组级材料 `ClassroomGroupMaterial(kind='worksheet')`
 *   ③ **历史作答 `WorksheetResponse`**
 *
 * 🔴 ③ 不是可选的：Prisma 对必填关系默认 `ON DELETE RESTRICT`（权威 DDL 里
 * `WorksheetResponse_worksheetId_fkey` 就是 RESTRICT）⇒ 只数前两样会给出
 * 「没在用」的 400，然后数据库拒绝 —— 一个**说谎的 400**。
 *
 * ⚠️ ① 与 ② 命中同一间课堂时按 `classroomId` 去重（照 agents.ts / webapps.ts 的 Set 写法），
 * 否则 `classroomCount` 会把同一间课堂数两次。
 */
async function worksheetUsage(prisma: PrismaClient, worksheetId: string): Promise<WorksheetUsage> {
  const [classroomLinks, groupLinks, responseCount] = await Promise.all([
    prisma.classroomWorksheet.findMany({
      where: { worksheetId },
      include: { classroom: { select: { id: true, title: true, status: true, mode: true } } },
    }),
    prisma.classroomGroupMaterial.findMany({
      where: { kind: 'worksheet', targetId: worksheetId },
      include: { group: { select: { classroom: { select: { id: true, title: true, status: true, mode: true } } } } },
    }),
    prisma.worksheetResponse.count({ where: { worksheetId } }),
  ]);

  const byClassroomId = new Map<string, { id: string; title: string; status: string; mode: string }>();
  const collect = (rows: Array<{ classroom: { id: string; title: string | null; status: string; mode: string } }>) => {
    rows.forEach(row => {
      if (byClassroomId.has(row.classroom.id)) return;
      byClassroomId.set(row.classroom.id, {
        id: row.classroom.id,
        title: row.classroom.title || '未命名课堂',
        status: row.classroom.status,
        mode: row.classroom.mode,
      });
    });
  };
  collect(classroomLinks);
  collect(groupLinks.map(material => ({ classroom: material.group.classroom })));

  const classrooms = [...byClassroomId.values()];
  return {
    classrooms,
    endedClassroomCount: classrooms.filter(classroom => classroom.status === 'ended').length,
    groupCount: groupLinks.length,
    responseCount,
  };
}

function isUsed(usage: WorksheetUsage): boolean {
  return usage.classrooms.length > 0 || usage.groupCount > 0 || usage.responseCount > 0;
}

/**
 * 把三样引用合成一句中文。
 *
 * **文案要给出出路**（规格 §5.5）：不是「不能删除」，而是说清删了会丢什么、
 * 以及「想改内容」/「想要新的」各自该走哪条路 —— 教师读到「无法删除」时真正想问的
 * 就是这两件事。
 */
function describeUsage(usage: WorksheetUsage): string {
  // ⚠️ 没被引用时**不能说「无法删除」**：`/usage` 在删除确认弹窗之外也会被调用
  // （列表页的「关联课堂」入口），一句「无法删除」会让教师以为这份学习单动不了。
  if (!isUsed(usage)) {
    return '该学习单还没有被任何课堂或小组使用，可以放心删除。';
  }

  const parts: string[] = [];
  if (usage.classrooms.length > 0) {
    parts.push(`被 ${usage.classrooms.length} 个课堂引用（其中 ${usage.endedClassroomCount} 个已结束）`);
  }
  if (usage.groupCount > 0) {
    parts.push(`${usage.groupCount} 个小组正在把它当课堂材料`);
  }
  if (usage.responseCount > 0) {
    // 这一句是 ③ 的出口：没有它，教师会以为「只是关联，删掉没关系」。
    parts.push(`已收到 ${usage.responseCount} 份作答`);
  }

  const head = `该学习单${parts.join('，')}，无法删除。`;
  const tail = usage.responseCount > 0
    ? `删除后这 ${usage.responseCount} 份作答会一起消失。`
    : '请先从这些课堂或小组中移除后再试。';
  return `${head}${tail}若只是想改内容，请直接编辑；若想要一份新的，请用「复制一份」。`;
}

// ── 教师端 ──────────────────────────────────────────────────────────
//
// ⚠️ 这一段的每个端点都**只**在教师 cookie 下可达：学生 token 到不了这里
// （见 worksheetAccessGate）。路由内部因此不重复判权限。

/** 学习单列表（分页 + 标题搜索；第一批不做学科/年级筛选，规格 §3-W）。 */
router.get('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? ''), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? ''), 10) || 20));
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const where: Prisma.WorksheetWhereInput = search ? { title: { contains: search } } : {};

    const [total, rows] = await Promise.all([
      prisma.worksheet.count({ where }),
      prisma.worksheet.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // 关联课堂数**一次取全再在 JS 里去重统计**，不要在 map 里逐份 count（那是 N+1）。
    // ⚠️ 必须 union 两张表（课堂级 + 组级），与 /usage 同一口径 —— 只数课堂级会让
    // 高级模式的课堂整个从计数里消失，界面显示「没人用」而删除守卫回 400。
    const counts = await classroomCounts(prisma, rows.map(row => row.id));

    res.json({
      items: rows.map(row => ({
        id: row.id,
        title: row.title,
        description: row.description,
        schemaVersion: row.schemaVersion,
        // 列表里不放 `content`（那是详情的事）；但题数是列表最有用的一列，
        // 而它只能从 content 算 —— 所以 content 仍要读出来，只是不进响应。
        questionCount: countQuestions(row.content),
        classroomCount: counts.get(row.id) ?? 0,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('[worksheets] 获取学习单列表失败:', error);
    res.status(500).json({ error: '获取学习单列表失败' });
  }
});

/** 详情：含完整 `content`（编辑器要它）。 */
router.get('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const worksheet = await prisma.worksheet.findUnique({ where: { id: req.params.id } });
    if (!worksheet) return res.status(404).json({ error: '学习单不存在' });
    res.json(worksheet);
  } catch (error) {
    console.error('[worksheets] 获取学习单失败:', error);
    res.status(500).json({ error: '获取学习单失败' });
  }
});

/** 新建。 */
router.post('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const body = (req.body ?? {}) as Record<string, unknown>;

    const title = readTitle(body.title);
    if (!title) return res.status(400).json({ error: '学习单标题不能为空' });

    const parsed = parseContent(body.content);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const worksheet = await prisma.worksheet.create({
      data: {
        title,
        description: readDescription(body.description) ?? null,
        schemaVersion: parsed.content.schemaVersion,
        content: parsed.content as unknown as Prisma.InputJsonValue,
        settings: normalizeSettings(body.settings),
      },
    });
    res.json(worksheet);
  } catch (error) {
    console.error('[worksheets] 新建学习单失败:', error);
    res.status(500).json({ error: '新建学习单失败' });
  }
});

/**
 * 更新。**部分更新**：只处理 body 里出现过的字段。
 *
 * ⚠️ `content` 传了就整体替换（题目树没有「按 id 打补丁」的语义，硬做会把
 * 「删掉一道题」表达不出来）。改动会被归一化 + 校验一遍，与新建同一条路径。
 */
router.put('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const existing = await prisma.worksheet.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: '学习单不存在' });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const data: Prisma.WorksheetUpdateInput = {};

    if (body.title !== undefined) {
      const title = readTitle(body.title);
      if (!title) return res.status(400).json({ error: '学习单标题不能为空' });
      data.title = title;
    }
    if (body.description !== undefined) {
      data.description = readDescription(body.description) ?? null;
    }
    if (body.content !== undefined) {
      const parsed = parseContent(body.content);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      data.schemaVersion = parsed.content.schemaVersion;
      data.content = parsed.content as unknown as Prisma.InputJsonValue;
    }
    if (body.settings !== undefined) {
      data.settings = normalizeSettings(body.settings);
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: '没有需要更新的内容' });
    }

    const worksheet = await prisma.worksheet.update({ where: { id: req.params.id }, data });
    res.json(worksheet);
  } catch (error) {
    console.error('[worksheets] 更新学习单失败:', error);
    res.status(500).json({ error: '更新学习单失败' });
  }
});

/**
 * 复制一份。
 *
 * 🔴 **深拷贝**：`content` 与 `settings` 都是 JSON 结构，浅拷贝会让副本与原件
 * 共用同一批嵌套对象 —— 之后任何**就地**改动（例如编辑器把 `node.prompt` 改掉）
 * 会同时改掉原件里那道题。用 `structuredClone`（Node 24 内置）。
 *
 * ⚠️ **只复制内容，不复制关系**：`ClassroomWorksheet` / `ClassroomGroupMaterial` /
 * `WorksheetResponse` 一行都不带过来。副本是一份崭新的、还没人用的学习单 ——
 * 这正是「想改内容又不想动正在上的那节课」的用法，把关联也复制过来会让副本
 * 立刻被删除守卫拦住，那个用法就不成立了。
 */
router.post('/:id/duplicate', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const source = await prisma.worksheet.findUnique({ where: { id: req.params.id } });
    if (!source) return res.status(404).json({ error: '学习单不存在' });

    const copy = await prisma.worksheet.create({
      data: {
        title: `${source.title}（副本）`.slice(0, TITLE_MAX),
        description: source.description,
        schemaVersion: source.schemaVersion,
        content: structuredClone(source.content) as Prisma.InputJsonValue,
        settings: structuredClone(source.settings) as Prisma.InputJsonValue,
      },
    });
    res.json(copy);
  } catch (error) {
    console.error('[worksheets] 复制学习单失败:', error);
    res.status(500).json({ error: '复制学习单失败' });
  }
});

/** 被哪些课堂引用（删除确认弹窗用它把话说清楚）。 */
router.get('/:id/usage', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const worksheet = await prisma.worksheet.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!worksheet) return res.status(404).json({ error: '学习单不存在' });

    const usage = await worksheetUsage(prisma, req.params.id);
    res.json({
      used: isUsed(usage),
      classroomCount: usage.classrooms.length,
      endedClassroomCount: usage.endedClassroomCount,
      groupCount: usage.groupCount,
      responseCount: usage.responseCount,
      classrooms: usage.classrooms,
      message: describeUsage(usage),
    });
  } catch (error) {
    console.error('[worksheets] 查询学习单引用失败:', error);
    res.status(500).json({ error: '查询失败' });
  }
});

/** 删除（三样引用都为 0 才放行，规格 §5.5）。 */
router.delete('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const worksheet = await prisma.worksheet.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!worksheet) return res.status(404).json({ error: '学习单不存在' });

    const usage = await worksheetUsage(prisma, req.params.id);
    if (isUsed(usage)) {
      return res.status(400).json({ error: describeUsage(usage) });
    }

    await prisma.worksheet.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('[worksheets] 删除学习单失败:', error);
    res.status(500).json({ error: '删除学习单失败' });
  }
});

// ── 学生端（★ 处理器由 B3 / B4 实现，本任务只负责**放行**）──────────
//
//   GET  /:id/student-view        读自己那一份（服务端剥离答案，§5.4）      —— B3
//   PUT  /:id/answers             保存单题（幂等）                          —— B3
//   POST /:id/answers/submit      提交单题                                 —— B3
//   POST /:id/review              「已查看」标记（**教师专用**）             —— B4
//
// 这四条形状的**放行判据**在文件顶部的 `worksheetAccessGate` 里，那一段才是安全关键：
// 前三条是学生放行集，`review` **不在**其中（它走教师那一支）。
//
// ⚠️ 处理器实现时必须自己校验：该学生所属参与者的学习单解析结果 `=== :id`。
// 闸门只校验「是持有效 token 的学生」，不知道这个学生该拿哪一份 ——
// 高级模式下不同组拿的是不同的学习单，只校验 token 等于谁都能读别人组的那份。

// ── 内部工具 ────────────────────────────────────────────────────────

/**
 * 数一道学习单里有几道题（含嵌套）。
 *
 * ⚠️ 包一层 try/catch：`content` 是库里的 JSON，本路由写进去的永远合形状，
 * 但**一行手工改过的数据不该让教师的学习单列表整个 500**（照 webapps.ts 里
 * `loadClassroomWebapps` 对读路径的取舍）。坏行显示 0 题，列表照常出。
 */
function countQuestions(content: unknown): number {
  try {
    return flattenQuestions(content as WorksheetContent).length;
  } catch {
    return 0;
  }
}

/**
 * 一批学习单各自的「关联课堂数」（去重）。
 *
 * 两条路径都算（课堂级 + 组级），与 `/usage` 同一口径；**一次取全**，避免 N+1。
 */
async function classroomCounts(prisma: PrismaClient, worksheetIds: string[]): Promise<Map<string, number>> {
  const byWorksheet = new Map<string, Set<string>>();
  if (worksheetIds.length === 0) return new Map();

  const [links, materials] = await Promise.all([
    prisma.classroomWorksheet.findMany({
      where: { worksheetId: { in: worksheetIds } },
      select: { worksheetId: true, classroomId: true },
    }),
    prisma.classroomGroupMaterial.findMany({
      where: { kind: 'worksheet', targetId: { in: worksheetIds } },
      select: { targetId: true, group: { select: { classroomId: true } } },
    }),
  ]);

  const add = (worksheetId: string, classroomId: string) => {
    const set = byWorksheet.get(worksheetId) ?? new Set<string>();
    set.add(classroomId);
    byWorksheet.set(worksheetId, set);
  };
  for (const link of links) add(link.worksheetId, link.classroomId);
  for (const material of materials) add(material.targetId, material.group.classroomId);

  return new Map([...byWorksheet].map(([worksheetId, set]) => [worksheetId, set.size]));
}

export { router as worksheetRoutes };
export default router;
