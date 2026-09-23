import crypto from 'crypto';
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import type { Server } from 'socket.io';
import { Prisma, type PrismaClient } from '@prisma/client';
import { requireTeacher } from '../middleware/auth.js';
import { getStudentSession } from '../middleware/student-auth.js';
import { resolveMaterialTargetId } from '../services/group-material-resolve.js';
import {
  flattenQuestions,
  grade,
  stripAnswers,
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

/**
 * 「已查看」标记（规格 §3-AA / §3-D）：教师给**某个参与者的某一道题**打 `reviewedAt`。
 * 课上问的是「还剩几个我没看」，所以它按 `(参与者 × 题)` 存 —— 「这题看了几人」与
 * 「这人看了几题」两个方向都能算出来。
 *
 * 🔴 **教师专用**。`POST /:id/review` **不在** `worksheetAccessGate` 的学生放行三种形状里
 * （见文件顶部那个闸门与 `index.ts` 注册处的注释），所以学生 token 到这里是 **403**；
 * 少了这条，学生就能伪造「老师已看过我的作业」，而看板的「已看 N/M」不会报错、
 * 只会显示一个教师以为自己点过的数字。用例钉在 `worksheet-realtime.test.ts` 与
 * `worksheet-routes.test.ts` 两处。
 *
 * ⚠️ **只对已经存在的答案行生效**：学生没答过这一题时回 **409**（当前状态不允许）。
 * 另一种做法是「顺手建一行 `status: 'unanswered'`、只填 `reviewedAt`」，但那条路会
 * 把一个假信号喂给下游 —— `POST /:id/answers/submit` 的前置检查只问「这一行在不在」
 * （`if (!answer) return 400`），凭空建出来的空行会让**从未作答**的题可以提交，
 * 进而在看板上记成「已提交 · 答错」并推进整卷进度。那正是看板数据里最坏的一类
 * **坏数据**（看板唯一的进度来源就是这些行）。
 * 这是个待裁定的语义点，取舍与备选改法写在 `worksheet-realtime.test.ts` 的对应用例里。
 */
router.post('/:id/review', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const worksheet = await prisma.worksheet.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!worksheet) return res.status(404).json({ error: '学习单不存在' });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const participantId = typeof body.participantId === 'string' ? body.participantId.trim() : '';
    const questionId = typeof body.questionId === 'string' ? body.questionId.trim() : '';
    if (!participantId) return res.status(400).json({ error: '缺少 participantId' });
    if (!questionId) return res.status(400).json({ error: '缺少 questionId' });

    // 参与者必须先存在：否则一个手滑的 id 会一路走到「没有答案行」那一支，
    // 教师拿到的是一句「该学生还没有作答这道题」—— 说了一个不存在的人没作答，
    // 与「这个人根本不在课堂里」是两种不同的处置。
    const participant = await prisma.classroomStudent.findUnique({
      where: { id: participantId },
      select: { id: true },
    });
    if (!participant) return res.status(404).json({ error: '参与者不存在' });

    // 答案行的定位口径与 PUT / submit 一致：`(参与者, 学习单, 题)` ⇒ 那一条 response
    // 下的那一行（`@@unique([responseId, questionId])` 保证至多一行）。
    const existing = await prisma.worksheetAnswer.findFirst({
      where: { questionId, response: { worksheetId: req.params.id, participantId } },
      select: { id: true },
    });
    if (!existing) {
      return res.status(409).json({ error: '该学生还没有作答这道题，无法标记「已查看」' });
    }

    // 重复调用是**刷新**而不是「第一次有效」：教师连点两次、或换台设备再看一遍都是正常
    // 形态，而 `reviewedAt` 的语义是「**最后**一次查看的时间」（看板靠它判断「刚看过」）。
    const updated = await prisma.worksheetAnswer.update({
      where: { id: existing.id },
      data: { reviewedAt: new Date() },
      select: { questionId: true, reviewedAt: true },
    });
    res.json({ success: true, participantId, questionId: updated.questionId, reviewedAt: updated.reviewedAt });
  } catch (error) {
    console.error('[worksheets] 标记已查看失败:', error);
    res.status(500).json({ error: '标记已查看失败' });
  }
});

// ── 学生端 ──────────────────────────────────────────────────────────
//
//   GET  /:id/student-view        读自己那一份（服务端剥离答案，§5.4）
//   PUT  /:id/answers             保存单题（幂等）
//   POST /:id/answers/submit      提交单题
//   POST /:id/review              「已查看」标记（**教师专用**，B4）—— 实现**在上面教师端
//                                 那一段**，这里列出来只是为了让闸门那三条正则的对照物
//                                 在同一处看得全（闸门只放行上面三条）。
//
// 这四条形状的**放行判据**在文件顶部的 `worksheetAccessGate` 里，那一段是安全关键：
// 前三条是学生放行集，`review` **不在**其中（它走教师那一支）。
//
// 🔴 闸门只校验「这是一个持有效 token 的学生」，**不知道**这个学生该拿哪一份 ——
// 高级模式下不同组拿的是不同的学习单，只认 token 等于谁都能读别人组那份。
// 所以下面**每一个**处理器都先走 `requireOwnWorksheet`，它把这件事一次做完。

/**
 * 学生端三条路径共用的前置校验。
 *
 * 按顺序做四件事，任何一步不通过就**自己写好响应**并返回 `null`（调用方直接 return）：
 *   ① 没有学生会话 ⇒ **401**（教师 cookie 能过闸门，但过不了这里 —— 少了这一步，
 *      教师误点学生端 URL 会拿到 `student.studentId` 打在 null 上的 500）；
 *   ② 参与者不存在、或不属于 token 里的那间课堂 ⇒ 403（伪造/过期 token）；
 *   ③ 该参与者**此刻该拿的那一份**（`resolveMaterialTargetId`，全项目唯一口径）
 *      `!== :id` ⇒ **403**；
 *   ④ 那一份在库里不存在（组级 `targetId` 没有真外键，目标可能已被删）⇒ 404。
 *
 * 🔴 ③ 用 **403 而不是 404**（B3 的明确裁定）：404 会让「这不是你的那一份」与
 * 「这一份不存在」在学生端与日志里混成同一个信号，而这两件事的处置完全不同。
 * 顺带它也**不泄露存在性** —— 拿别人的 id 来试，得到的是同一句「不是你的」。
 */
interface StudentWorksheetContext {
  prisma: PrismaClient;
  classroomId: string;
  participantId: string;
  worksheet: {
    id: string; title: string; description: string | null;
    content: Prisma.JsonValue; settings: Prisma.JsonValue;
  };
}

async function requireOwnWorksheet(req: Request, res: Response): Promise<StudentWorksheetContext | null> {
  const student = getStudentSession(req);
  if (!student) {
    res.status(401).json({ error: '需要学生身份' });
    return null;
  }
  const prisma: PrismaClient = req.app.get('prisma');

  const participant = await prisma.classroomStudent.findUnique({
    where: { id: student.studentId },
    select: {
      id: true,
      classroomId: true,
      groupId: true,
      classroom: {
        select: {
          mode: true,
          groups: { select: { id: true, materials: { select: { kind: true, targetId: true } } } },
        },
      },
    },
  });
  if (!participant || participant.classroomId !== student.classroomId) {
    res.status(403).json({ error: '该参与者不属于当前课堂' });
    return null;
  }

  const classroomLevelId = await loadClassroomLevelWorksheetId(prisma, participant.classroomId);
  const targetId = resolveMaterialTargetId({
    mode: participant.classroom.mode,
    studentGroupId: participant.groupId,
    groupMaterials: participant.classroom.groups.flatMap(group =>
      group.materials.map(material => ({ groupId: group.id, kind: material.kind, targetId: material.targetId }))),
    classroomLevelId,
    kind: 'worksheet',
  });

  if (targetId !== req.params.id) {
    res.status(403).json({ error: '这不是你的学习单' });
    return null;
  }

  const worksheet = await prisma.worksheet.findUnique({ where: { id: req.params.id } });
  if (!worksheet) {
    res.status(404).json({ error: '学习单不存在' });
    return null;
  }

  return { prisma, classroomId: participant.classroomId, participantId: participant.id, worksheet };
}

/**
 * 课堂级学习单（标准 / 分组模式的权威来源，规格 §1.2）。
 *
 * ⚠️ 排序 `[{createdAt:'asc'},{id:'asc'}]` 必须与 `routes/classroom.ts` 的
 * `loadClassroomWorksheets` 和写入口的 `worksheetLinkRows` **逐字一致** ——
 * 三者不同口径就会出现「教师保存时看到的第一份」与「学生拿到的那份」不是同一份。
 * 第一批按**单选**收窄（规格 §4），所以取第一条就是那一份。
 *
 * ⚠️ 老库缺表时降级为 `null`（读路径不可失败，与 `loadClassroomWorksheets` 同一条规矩）：
 * 降级的结果是学生拿到 403「这不是你的学习单」，而不是一个 500。
 */
async function loadClassroomLevelWorksheetId(prisma: PrismaClient, classroomId: string): Promise<string | null> {
  try {
    const row = await prisma.classroomWorksheet.findFirst({
      where: { classroomId },
      select: { worksheetId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return row?.worksheetId ?? null;
  } catch {
    return null;
  }
}

/**
 * 学生端只拿 `settings` 里的**两个**字段（B3 的明确要求）。
 *
 * `defaultInputMode` 刻意不下发：第一批恒为 `keyboard`（规格 §3-V），多给一个字段
 * 只是给前端多一个能读错的开关。库里手工改过的行缺字段时按 `DEFAULT_SETTINGS` 兜底。
 */
function readStudentSettings(raw: unknown): { allowResubmit: boolean; autoGrade: boolean } {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? raw as Record<string, unknown>
    : {};
  return {
    allowResubmit: typeof source.allowResubmit === 'boolean' ? source.allowResubmit : DEFAULT_SETTINGS.allowResubmit,
    autoGrade: typeof source.autoGrade === 'boolean' ? source.autoGrade : DEFAULT_SETTINGS.autoGrade,
  };
}

function findQuestion(content: Prisma.JsonValue, questionId: string): QuestionNode | null {
  return flattenQuestions(content as unknown as WorksheetContent).find(node => node.id === questionId) ?? null;
}

/**
 * 学生发来的作答值原样落库（格式由题型注册表定义，规格 §4.3）。
 *
 * ⚠️ `undefined` 必须转成 `Prisma.DbNull`（SQL NULL）而不是留给 Prisma 忽略：
 * 前者的语义是「这一题的作答被清空了」，后者是「这次请求不动这一列」——
 * 学生把输入框删干净再保存时，要的是前者。
 */
function toJsonValue(raw: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return raw === undefined ? Prisma.DbNull : (raw as Prisma.InputJsonValue);
}

interface AnswerRow {
  questionId: string;
  status: string;
  isCorrect: boolean | null;
  reviewedAt: Date | null;
}

/**
 * 教师看板的 socket 房间名。
 *
 * 🔴 这里是 `teacher:<id>`，**不是**规格 §5.7 示意图里写的 `classroom:<id>`。
 * 代码里 `classroom:<id>` 是**学生**房间（`socket/index.ts` 的 `join-classroom` 里
 * `socket.join(...)`，`routes/classroom.ts` 各处 `io.to('classroom:'+id)` 全都是在发学生），
 * 教师看板加入的是 `teacher:<id>`（同文件的 `join-teacher-board`，前端由
 * `src/lib/socket.ts` 的 `joinTeacherBoard` 触发）。
 *
 * ⚠️ 写错房间的后果与「压根没实现」一模一样：事件照发、日志干净、看板永远不动，
 * 没有任何报错。更要紧的是载荷里有每名学生的作答状态与对错，而学生房间里是**全班学生**。
 * 所以 `worksheet-realtime.test.ts` 不把这个名字当常量抄一遍：它先跑一遍真实的
 * `join-teacher-board` 量出看板进了哪个房间，再与这里的广播目标对比。
 */
function worksheetBoardRoom(classroomId: string): string {
  return `teacher:${classroomId}`;
}

/**
 * 把一次作答变化推给教师看板（规格 §5.7 链路的第 ③ 步）。
 *
 * ⚠️ 只在**落库成功之后**调用：广播是「库里已经这样了」的通知，先发后写会让看板显示
 * 一个尚未提交（甚至可能被回滚）的状态。
 * 🔴 载荷**必须**含 `questionId`：看板格子的「正在做第 N 题」只靠它（§7.4 的数据来源表），
 * 缺了会退化成一句笼统的进度 —— 而且**没有任何报错**。
 */
function broadcastAnswerUpdate(
  req: Request,
  ctx: { classroomId: string; participantId: string },
  answer: AnswerRow,
): void {
  // `io` 从 `req.app.get('io')` 取（本项目约定：路由不直接 import io）。
  const io = req.app.get('io') as Server | undefined;
  if (!io) {
    // 不明着吞掉：缺 io 时广播会静默消失，而看板只会「不动」——那是最难查的一种表现。
    console.error('[worksheets] app 上没有注册 io，学习单进度广播被跳过');
    return;
  }
  io.to(worksheetBoardRoom(ctx.classroomId)).emit('worksheet-answer-updated', {
    classroomId: ctx.classroomId,
    participantId: ctx.participantId,
    questionId: answer.questionId,
    status: answer.status,
    isCorrect: answer.isCorrect,
    reviewedAt: answer.reviewedAt,
  });
}

/**
 * 取（或建）这个参与者在**这份学习单**上的作答会话。
 *
 * ⚠️ `create` 里写 `startedAt`、`update` 里**不写**，合起来就是规格要的 `startedAt ??= now`：
 * 它是「什么时候开始做的」，之后每次保存都刷一遍等于没有这个字段。
 * ⚠️ `status: 'in-progress'` 则**无条件**写：一次保存意味着这份卷子此刻正在被作答 ——
 * 整卷交过之后学生又改了一题（`allowResubmit`），它必须回到 `in-progress`。
 * 用 `upsert` 而不是「先查再建」：前者在 SQLite 上是单条 `INSERT … ON CONFLICT`，
 * 学生端两题接连保存时不会撞 `@@unique([classroomId, worksheetId, participantId])`。
 */
function ensureResponse(ctx: StudentWorksheetContext, now: Date) {
  const key = {
    classroomId: ctx.classroomId,
    worksheetId: ctx.worksheet.id,
    participantId: ctx.participantId,
  };
  return ctx.prisma.worksheetResponse.upsert({
    where: { classroomId_worksheetId_participantId: key },
    create: { ...key, status: 'in-progress', startedAt: now },
    update: { status: 'in-progress' },
  });
}

/**
 * 读自己那一份。🔴 **答案在这里被剥掉**（规格 §5.4 第一条）。
 *
 * 剥离发生在**服务端、返回之前**，且返回的是**新对象**（`stripAnswers` 不就地改）。
 * 前端过滤等同于未过滤：`content` 一旦离开这台机器，学生就能在网络面板里看到答案。
 *
 * ⚠️ 不下发这名学生已有的作答：第一批没有「断线重进接着答」的入口（规格 §8 只要求
 * 本地 `localStorage` 队列），多下发一份作答只会多一处需要脱敏的表。
 */
router.get('/:id/student-view', async (req, res) => {
  try {
    const ctx = await requireOwnWorksheet(req, res);
    if (!ctx) return;

    const { worksheet } = ctx;
    res.json({
      id: worksheet.id,
      title: worksheet.title,
      description: worksheet.description,
      content: stripAnswers(worksheet.content as unknown as WorksheetContent),
      settings: readStudentSettings(worksheet.settings),
    });
  } catch (error) {
    console.error('[worksheets] 学生读取学习单失败:', error);
    res.status(500).json({ error: '读取学习单失败' });
  }
});

/**
 * 保存单题（学生端防抖 1.5s 调一次）。**幂等**：同一个 `(参与者, 学习单, 题)`
 * 连打两次只留一行，`value` 是后一次（规格 §5.3）。
 */
router.put('/:id/answers', async (req, res) => {
  try {
    const ctx = await requireOwnWorksheet(req, res);
    if (!ctx) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const questionId = typeof body.questionId === 'string' ? body.questionId.trim() : '';
    if (!questionId) return res.status(400).json({ error: '缺少 questionId' });
    // `questionId` 必须**属于这份 content**：题目 id 是答案行的关联键（规格 §3-P），
    // 收下一个不属于它的 id 会在看板上凭空多出一道题。
    if (!findQuestion(ctx.worksheet.content, questionId)) {
      return res.status(400).json({ error: '该题不属于这份学习单' });
    }

    // 🔴 `allowResubmit: false` 在**服务端**生效（规格 §8.4 三层控制里的第一层）。
    // 只靠学生端收起输入框，这个设置就是对教师说的假话 —— 与答案剥离同一条原则：
    // **过滤在服务端执行，不在前端**（规格 §5.4）。
    //
    // ⚠️ 用 **409**（Conflict：「当前状态不允许这个操作」），**不是 400**：本文件里 400
    // 已经表示「请求本身有问题」（缺 `questionId`、题不属于这份学习单）。混用会让客户端的
    // 离线队列没法区分「这一条该丢弃」与「这一条该修参数重试」。
    //
    // ⚠️ 这一步排在 `ensureResponse` **之前**：被拒的保存不留任何痕迹
    // （建会话/把整卷从 submitted 拨回 in-progress 都算痕迹）。
    const { allowResubmit } = readStudentSettings(ctx.worksheet.settings);
    if (!allowResubmit) {
      const current = await ctx.prisma.worksheetAnswer.findFirst({
        where: {
          questionId,
          response: {
            classroomId: ctx.classroomId,
            worksheetId: ctx.worksheet.id,
            participantId: ctx.participantId,
          },
        },
        select: { status: true },
      });
      if (current?.status === 'submitted') {
        return res.status(409).json({ error: '老师已设置本题提交后不可修改' });
      }
    }

    const now = new Date();
    const response = await ensureResponse(ctx, now);
    const answer = await ctx.prisma.worksheetAnswer.upsert({
      where: { responseId_questionId: { responseId: response.id, questionId } },
      create: { responseId: response.id, questionId, value: toJsonValue(body.value), status: 'draft' },
      // ⚠️ `isCorrect: null` 不是顺手清一下：`WorksheetAnswer.isCorrect` 的语义是
      // 「autoGrade 开启**且已提交**时才有值」（规格 §4.1）。改回 draft 却留着上次的
      // `true`，看板会显示成「这题刚判对」，而学生此刻正在把它改错。
      update: { value: toJsonValue(body.value), status: 'draft', submittedAt: null, isCorrect: null },
    });

    // 规格 §5.7 的第 ③ 步：写库走 HTTP，socket 只承担「服务端 → 教师看板」的单向广播。
    // ⚠️ 载荷用的是**刚落库那一行**的字段（不是请求体）：看板看到的必须是库里的真相。
    broadcastAnswerUpdate(req, ctx, answer);
    res.json({ success: true, questionId, status: 'draft' });
  } catch (error) {
    console.error('[worksheets] 保存作答失败:', error);
    res.status(500).json({ error: '保存作答失败' });
  }
});

/**
 * 提交单题。🔴 **判分在这里做**（规格 §5.4 第二条）：服务端算，前端只拿 `{ isCorrect }`。
 * 按 §3-S **不返回 `score`** —— 分值一旦下发就有人拿它做统计，而它可由 `isCorrect` 推导。
 */
router.post('/:id/answers/submit', async (req, res) => {
  try {
    const ctx = await requireOwnWorksheet(req, res);
    if (!ctx) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const questionId = typeof body.questionId === 'string' ? body.questionId.trim() : '';
    if (!questionId) return res.status(400).json({ error: '缺少 questionId' });
    const node = findQuestion(ctx.worksheet.content, questionId);
    if (!node) return res.status(400).json({ error: '该题不属于这份学习单' });

    // 没作答过就没有可判的答案。若照判，空题会被记成「已提交 · 判错」并推进整卷进度 ——
    // 而看板的唯一数据源就是这些行，学生什么都没写、看板上显示他做完了。
    //
    // ⚠️ 这一步排在 `ensureResponse` **之前**（所以它只查答案行、不建作答会话）：
    // 被拒的提交不该留下任何痕迹 —— 一次 400 顺手给这名学生开一份「已开始作答」，
    // 教师看板会把一个什么都没做的学生显示成正在做。
    const answer = await ctx.prisma.worksheetAnswer.findFirst({
      where: {
        questionId,
        response: {
          classroomId: ctx.classroomId,
          worksheetId: ctx.worksheet.id,
          participantId: ctx.participantId,
        },
      },
      select: { responseId: true, value: true },
    });
    if (!answer) return res.status(400).json({ error: '请先作答再提交本题' });

    const now = new Date();
    const response = await ensureResponse(ctx, now);

    const { autoGrade } = readStudentSettings(ctx.worksheet.settings);
    // ⚠️ 关掉自动判分是「**不判**」（`null`），不是「判错」（`false`）—— 两者在学生端
    // 与看板上是完全不同的两种显示。`grade()` 对主观题同样返回 `null`（§5.6）。
    const isCorrect = autoGrade ? grade(node, answer.value) : null;

    const updated = await ctx.prisma.worksheetAnswer.update({
      where: { responseId_questionId: { responseId: response.id, questionId } },
      data: { status: 'submitted', submittedAt: now, isCorrect },
    });

    // 整卷进度：当前 content 里的每一题都 `submitted` 才算交卷。
    // ⚠️ 只数**还在 content 里的**题：教师删掉一道题之后，库里留给它的那行答案
    // 不该让整卷永远交不了（改单只警告不拦，规格 §3-J）。
    const submitted = await ctx.prisma.worksheetAnswer.findMany({
      where: { responseId: response.id, status: 'submitted' },
      select: { questionId: true },
    });
    const inContent = new Set(flattenQuestions(ctx.worksheet.content as unknown as WorksheetContent).map(q => q.id));
    const total = inContent.size;
    const submittedCount = submitted.filter(row => inContent.has(row.questionId)).length;
    if (total > 0 && submittedCount >= total) {
      await ctx.prisma.worksheetResponse.update({
        where: { id: response.id },
        data: { status: 'submitted', submittedAt: now },
      });
    }

    // 规格 §5.7 的第 ③ 步。⚠️ 这里带上 `isCorrect`：看板抽屉的逐题 ✓/✗ 只能来自这条广播
    // （§7.4：不做按需推流）。整卷状态那一次 `update` **不**单独广播 —— 它没有新的
    // questionId 可带，而看板的「已交 N/M」由逐题广播累加即可。
    broadcastAnswerUpdate(req, ctx, updated);
    res.json({ isCorrect });
  } catch (error) {
    console.error('[worksheets] 提交作答失败:', error);
    res.status(500).json({ error: '提交作答失败' });
  }
});

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
