import crypto from 'crypto';
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import type { Server } from 'socket.io';
import { Prisma, type PrismaClient } from '@prisma/client';
import { requireTeacher } from '../middleware/auth.js';
import { getStudentSession } from '../middleware/student-auth.js';
import { resolveMaterialTargetId } from '../services/group-material-resolve.js';
// ★ 2026-09-25：两级题号（`任务一 · 1`）。与前端同名函数是**镜像**关系，
// 对拍用例 `src/lib/worksheet-heading-parity.test.ts` 钉着两边逐字相同。
// ⚠️ 与上面的 `flattenQuestions` **不是**一回事：那个吐出树里**所有**节点
//（含任务），而「一道题一条」的地方全都只认可作答的题。
import { flattenAnswerable } from '../services/worksheet-heading.js';
import { toAgentConfig } from '../services/agent-config.js';
import {
  flattenQuestions,
  grade,
  // ★ I1：`full` 那一档的拒绝判据（`0` 不合法，`half` 的 `0` 合法）。
  // 「什么算有效分值」仍然**只有一处**回答 —— 与 `normalizePoints` /
  // `isUsablePointValue` 同处一地定义（service），这里只用，不另抄。
  isRejectedFullPointValue,
  // `normalizePoints` 与 `isUsablePointValue` 同处一地定义（service）—— 「什么算有效分值」
  // 只有一处回答，而它直接决定「这题是继承学习单级还是脱离」。
  normalizePoints,
  // ⚠️ `POINTS_MAX` 只用在下面那条拒绝文案里（「必须是 1–99 的整数」）——
  // 不写字面量：它改了而这里没改，报错文案就会与真正的域不一致。
  POINTS_MAX,
  // ⚠️ A2 的最小适配用到这两个：`grade()` 现在要求调用点给出**这道题实际用的两个档**
  // （规格 §12 裁定 4：逐题优先、留空回落学习单级）。把「怎么算这两档」写在调用点
  // 就等于让每个调用点各抄一遍回落规则 —— 所以走这两个函数。
  pointsFromSettings,
  QUESTION_TYPES as QUESTION_TYPE_REGISTRY,
  resolvePoints,
  stripAnswers,
  validateQuestion,
  type QuestionNode,
  type QuestionType,
  type WorksheetContent,
} from '../services/worksheet-questions.js';
// ★ M4b：笔迹的体积校验（规格 §12 裁定 4 的后半句「服务端也要校验」）。
// 它是 `src/lib/worksheet-ink.ts` 在服务端的**第二份**实现 —— 服务端读不到 `src/`。
import { findInkValueError } from '../services/worksheet-ink.js';
// ★ M7a：分析载荷（「按题的一次性聚合」）。闸门在**零 import** 的 analysis-gate 里 ——
// 那个文件被前端的跨工程对拍用例加载，所以它不能 import 任何东西（M6a 的教训）。
import { isAnalyzableType } from '../services/analysis-gate.js';
import { questionTypeLabel } from '../services/question-type-labels.js';
import {
  KNOBS_SETTING_KEY, buildAnalysisPayload, entriesFromAggregate, entriesToAggregate,
  isAnalysisStale, lastSubmittedAt, layoutSheets, normalizeAnalysisKnobs, payloadLabels, selectAnalyzeEntries,
  type AnalyzeEntry, type Participant, type RawAnswer, type SheetKnobs,
} from '../services/analysis-payload.js';
import { labelsRenderOk, renderSheets } from '../services/analysis-render.js';
// ★ M7b：编排层的三个纯函数（平台闸门 / 消息构造 / 解读归一化）
import { analysisGateOf, buildAnalysisMessage, normalizeNarrative } from '../services/analysis-agent.js';
// ★ M7b：**全仓唯一一处 fetch 到第三方**
import { proxyAnalysisRequest } from '../services/ai-proxy.js';

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
 * 学生只放行**四种形状**，其余一律拦下。四种形状：
 *   · `GET  /:id/student-view`     读自己那一份（服务端已剥离答案，§5.4）
 *   · `GET  /:id/answers`          读**自己已有的作答**（水合，见下面的读端点）
 *   · `PUT  /:id/answers`          保存单题（幂等）
 *   · `POST /:id/answers/submit`   提交单题
 *
 * 🔴 学生 token 打教师端形状回 **403**，不回 401：401 的语义是「你没有认证」，
 * 而学生手里明明握着一个**有效**的 token —— 谎报未认证会让「cookie 过期了？」与
 * 「这接口学生不能用」两件事在日志与前端提示里混成一团。没有凭据时仍然回落到
 * `requireTeacher`（401），所以这一支不会把 401 这条路径吞掉。
 *
 * ⚠️ 「已查看」是 `POST /:id/review`，**不在**上面四种形状里 ⇒ 自然走教师那一支。
 * 改动下面这四条正则时务必确认它仍然**不匹配** `review`（B4 的第一条用例钉的就是它）。
 *
 * ⚠️ D4 新增的教师读端点 `GET /classroom/:classroomId/answers` 同样是**三段**路径，
 * 而 `^\/[^/]+\/answers\/?$` 这一条只匹配**恰好两段** ⇒ 它也落在教师那一支。
 * `worksheet-board.test.ts` 有一条「学生 token 打这个路径回 403」的用例把它钉住。
 *
 * 🔴 **新增的 `GET /:id/answers` 与它只差一个方法**：同一条正则、同一个「恰好两段」的形状。
 * 也就是说这两条**天然是一对**：将来若有人把 `answers` 这一段挪成三段（比如
 * `/:id/answers/list`），学生放行集会连带**打开教师看板那个端点** —— 而它带全班学生
 * 的作答。改这一行时先看 `worksheet-board.test.ts` 里那条 403 用例。
 */
export const worksheetAccessGate: RequestHandler = (req, res, next) => {
  const student = getStudentSession(req);
  if (student) {
    const view = req.method === 'GET' && /^\/[^/]+\/student-view\/?$/.test(req.path);
    // 🔴 「读自己的作答」与下面那条 `PUT` **共用** `^\/[^/]+\/answers\/?$` 这一条正则 ——
    // 形状一样、只有方法不同。两处要一起改（判据见上面第 47 行那一段）。
    const read = req.method === 'GET' && /^\/[^/]+\/answers\/?$/.test(req.path);
    const save = req.method === 'PUT' && /^\/[^/]+\/answers\/?$/.test(req.path);
    const submit = req.method === 'POST' && /^\/[^/]+\/answers\/submit\/?$/.test(req.path);
    if (view || read || save || submit) return next();
    res.status(403).json({ error: '该接口仅教师可用' });
    return;
  }
  requireTeacher(req, res, next);
};

const router: Router = Router();

// ── content / settings 的解析与校验 ─────────────────────────────────

/**
 * 校验用的题型白名单。**唯一真源是注册表**（`services/worksheet-questions.ts` 的
 * `QUESTION_TYPES`）—— 这里只是把它放宽成 `readonly string[]`，好对任意输入做
 * `includes`（注册表是 `as const` 的字面量联合）。
 *
 * 🔴 这里曾经**另抄了一份自己的字面量**，而两份表的**反向**不一致是**静默**的：
 * 校验这份多、注册表少 ⇒ `normalizeNode` 高高兴兴收下这道题，而注册表的
 * `validateQuestion` 不认识这个题型 ⇒ 返回空错误（它只对 `single-choice` /
 * `fill-blank` 两支做检查）⇒ 这道题**永远无法作答、也永远无法提交** ⇒
 * 整卷永远停在 `in-progress`、看板「已交 N/M」永远填不满，**全程无一处报错**。
 * （反方向是响亮的：注册表有、这里没有 ⇒ 保存时 400。）
 * M4 会一次加 8 个题型，所以这两份表在那之前就必须是同一份。
 */
const QUESTION_TYPES: readonly string[] = QUESTION_TYPE_REGISTRY;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;

/**
 * 奖励形式的**取值域**（规格 §9.2 的四选一）。
 *
 * ⚠️ 这四个字面量与标签/符号/取值函数在**前端**（`src/lib/worksheet-reward.ts`）各有一份：
 * 服务端读不到 `src/`，而前端也不该把「什么值合法」的判据放在只有自己看得见的地方。
 * 与题型注册表（`QUESTION_TYPES` 对 `QUESTION_TYPE_OPTIONS`）同一个由来 ——
 * **两处必须一起改**。改一处不会报错，只会让存进去的档在学生端落到默认档（画成星星）。
 */
const REWARD_STYLES: readonly string[] = ['correctness', 'star', 'flower', 'points'];
/** 全对档步长的取值域（规格 §9.2 定死 1 / 2 / 3 / 5）。 */
const REWARD_STEPS: readonly number[] = [1, 2, 3, 5];
/**
 * ★ M4a：**部分给分档**步长的取值域 —— 🔴 它**比 `REWARD_STEPS` 多一个 `0`**，两者是不同的域：
 * `rewardStep` 是「答对一题得几个」，`0` 在那里无意义（答对却得 0 个）；而部分给分档的 `0`
 * 是**一个合法的选择** = 这单不给部分分（规格 §12 裁定 3 定的默认值就是它）。
 *
 * ⚠️ **别复用 `REWARD_STEPS` 判它**：`REWARD_STEPS.includes(0)` 为假 ⇒ `halfStep: 0`
 * 会因为「不在域里」落回默认值（恰好也是 0，**碰巧**对），但 `halfStep: 4` 这样的越界值
 * **同样**落成 0 —— 合法值与越界值产生同一个观测，读者没法从代码看出「0 到底算不算数」。
 *
 * ⚠️ 这三个字面量与取值函数在**前端**（`src/lib/worksheet-reward.ts` 的 `HALF_STEPS` /
 * `DEFAULT_HALF_STEP` / `normalizeHalfStep`）各有一份，理由与上面的 `REWARD_STYLES` 逐字相同
 * —— **两处必须一起改**，改一处不会报错，只会让存进去的档在学生端变成另一个档。
 */
const HALF_STEPS: readonly number[] = [0, 1, 2, 3, 5];

const DEFAULT_SETTINGS = {
  allowResubmit: true,
  autoGrade: true,
  defaultInputMode: 'keyboard',
  // 默认档「星星 ⭐、每答对一题 1 个」的依据写在 `src/lib/worksheet-reward.ts` 的
  // `DEFAULT_REWARD_STYLE` 上（§9.2 的图与 §8.2 的版式图）。⚠️ 两处必须是同一对默认值：
  // 这里决定**缺字段的行**长什么样，前端那份决定**新建的单**长什么样。
  rewardStyle: 'star',
  rewardStep: 1,
  // 部分给分档的默认值是 **0**（规格 §12 裁定 3：「每题 全对 1 / 部分给分 0」）—— 与第一批行为
  // 逐字相同，所以已在用的学习单升级后学生端什么都不变。前端那一份是
  // `worksheet-reward.ts` 的 `DEFAULT_HALF_STEP`。
  halfStep: 0,
  // ★ M7b：**没有默认分析智能体**，这是刻意的 —— 默认指定一个等于「默认把全班作业发出去」。
  // ⇒ `null` 表示「没指定」，而没指定时分析按钮禁用并提示去哪儿配。
  analysisAgentId: null,
} as const;

/**
 * 归一化 `settings`。**六个键都会写出来**（缺的补默认）—— 落库的 JSON 因此总是完整的，
 * 学生端与编辑器都不必自己写 `?? 默认值`。
 *
 * 🔴 这里也是**奖励配置唯一的写入口**：`PUT /api/worksheets/:id` 是整份替换
 * （`data.settings = normalizeSettings(body.settings)`），所以本函数少认一个键，
 * 那个键就会被**静默丢掉** —— 教师配好「花朵 ×3」，保存一次改标题的请求就变回星星，
 * 而界面上没有任何提示。新增奖励相关的键时，这里与 `readStudentSettings` 要一起加。
 * （M4a 的 `halfStep` 就是这么加进来的：B2 之前它进不了这里，于是 `pointsFromSettings`
 * 读到的永远是默认的 0 —— 教师填的值会被一次「只改标题」的保存抹掉。）
 */
/** ★ M7b：**导出**是为了让用例能测它（原先不导出 ⇒ 只能另抄一份判据，那是第二份真源）。 */
export function normalizeSettings(raw: unknown): Prisma.InputJsonValue {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? raw as Record<string, unknown>
    : {};
  const rewardStyle = typeof source.rewardStyle === 'string' && REWARD_STYLES.includes(source.rewardStyle)
    ? source.rewardStyle
    : DEFAULT_SETTINGS.rewardStyle;
  const rewardStep = typeof source.rewardStep === 'number' && REWARD_STEPS.includes(source.rewardStep)
    ? source.rewardStep
    : DEFAULT_SETTINGS.rewardStep;
  // ⚠️ 判据是 `HALF_STEPS`（含 0），**不是** `REWARD_STEPS` —— 理由与代价写在它的定义上。
  const halfStep = typeof source.halfStep === 'number' && HALF_STEPS.includes(source.halfStep)
    ? source.halfStep
    : DEFAULT_SETTINGS.halfStep;
  return {
    allowResubmit: typeof source.allowResubmit === 'boolean' ? source.allowResubmit : DEFAULT_SETTINGS.allowResubmit,
    autoGrade: typeof source.autoGrade === 'boolean' ? source.autoGrade : DEFAULT_SETTINGS.autoGrade,
    defaultInputMode: source.defaultInputMode === 'handwriting' ? 'handwriting' : DEFAULT_SETTINGS.defaultInputMode,
    rewardStyle,
    rewardStep,
    halfStep,
    // ★ M7b：空串与坏值都回落 `null`（⇒ 分析按钮禁用并提示去哪儿配）。
    // ⚠️ 判据是「非空字符串」而不是「真值」—— `0` 与 `false` 不是合法的 agent id，
    // 但它们都不是空串，写成真值判断会把它们放过去，而那时界面上那个下拉会选不中任何一项。
    analysisAgentId: typeof source.analysisAgentId === 'string' && source.analysisAgentId !== ''
      ? source.analysisAgentId
      : null,
  };
}

/**
 * 归一化一道题。
 *
 * `id` 缺失时由服务端补一个 `q_<uuid>`（规格 §4.3 的占位形状）：创建时前端可能还没生成，
 * 而**提交之后这个 id 就是答案行的外键**（`WorksheetAnswer.questionId`），
 * 一旦落地就不能再变 —— 所以「补 id」只能发生在写入之前，不能发生在读取时。
 *
 * 🔴 返回值里**漏掉哪个字段，那个字段就被静默丢掉**：`PUT /api/worksheets/:id` 是整份替换
 * （`content = parseContent(...).content`），与 `normalizeSettings` 少认一个键是同一种毛病。
 * M4a 新增的 `points` 必须在下面显式带出来 —— 漏了的表现是「教师逐题填的分值，
 * 保存一次就全没了」，而界面上没有任何提示。
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

  // ★ M4a：多选题的 `partialCredit` **在这里归一化**（裁定：写入口跟写入口同一个提交）。
  //
  // 🔴 为什么值得挡：这个键今天**全仓只有判分侧读它一处**（`worksheet-questions.ts` 的
  // `allowsMissing`，判据是逐字等于 `'allow-missing'`），写入口在此之前是**原样透传**。
  // 于是编辑 UI 把那个值写错一个字符（`'allowmissing'` / `'allow missing'` / 布尔 `true`）
  // 就**原样落库**，判分静默退化成「全对才算」—— 教师明明选了「漏选算部分给分」，
  // 而分一直不对、**无任何报错**，他会去怀疑学生。
  //
  // ⚠️ 只认这两个字面量，认不出就**拒绝保存**（走 `parseContent` 既有的校验错误路径 ⇒ 400）。
  // 方向与 `allowsMissing` 同款：把认不出的值当成「允许漏选」会让一道本该判错的题
  // **静默给学生半分**，而教师看不出异常；拒绝保存是**响亮**的。
  //
  // ⚠️ **只对 `multi-choice` 认这个键**：另外 7 个题型的判分器都不读它（`true-false`
  // 走的是 `judgeSingleChoice`，不是多选那一支），所以别处出现它只是一段死数据，
  // 不是一句谎话 —— 为它拒掉整份保存属于越界。
  //
  // ⚠️ **缺席时保持缺席**，不补写 `'all-or-nothing'`：`allowsMissing` 对缺席的回答本来就是
  // 「全对才算」，语义已经完备；补一个键等于在教师**没碰过**这道题的情况下改写它的 `data`
  //（`data` 一律黑名单透传是这张表的既定手法）。⇒ 「归一化」的落点是
  // **「库里出现的值必然是这两个字面量之一」**，不是「每个多选节点都长出一个键」。
  if (type === 'multi-choice' && data.partialCredit !== undefined) {
    if (data.partialCredit !== 'all-or-nothing' && data.partialCredit !== 'allow-missing') {
      errors.push(`${label}：多选的「漏选算不算部分给分」取值不合法（只认 all-or-nothing / allow-missing）`);
    }
  }

  // ★ M4a/I1：`full` 的域是 `1..POINTS_MAX`（`half` 才是 `0..`）—— **`full: 0` 拒绝保存**。
  //
  // 🔴 为什么值得拒（2026-09-24 终审实测的完整链条）：`full: 0` 让**答对**的题拿到 0 分，
  // 于是同一次提交里学生屏幕画**红叉**（对错档按 `score >= 1` 画）、教师抽屉画**绿 `✓ 答对`**
  // 并把它计进正确率的分子、学生顶栏的奖励累计 +0 —— 四个观测互相打架，**全程无一处报错**。
  //
  // ⚠️ 与 `partialCredit` 同一种处置（认不出就**拒绝保存**，而不是回落到默认值）：
  // 回落会让教师的输入静默变成另一个数（0 ⇒ 1），而这条链上看起来一切正常。
  // 判据本身在 `isRejectedFullPointValue` 上 —— 它只拒「认得出但不合法」的那一个值，
  // 字符串 / `undefined` / 越界值仍是 A1 裁定的「没填 = 继承学习单级」。
  const rawPoints = (node.points && typeof node.points === 'object' && !Array.isArray(node.points))
    ? node.points as Record<string, unknown>
    : null;
  if (rawPoints && isRejectedFullPointValue(rawPoints.full)) {
    // ⚠️ 这是**发给教师看的**错误串（前端原样展示，不走 markdown）⇒ 不许出现 `**` 这类记号。
    errors.push(
      `${label}：「全对给几分」不能是 0 —— 必须是 1–${POINTS_MAX} 的整数`
      + `（填 0 会让答对的学生看到红叉：他答对了，却一分都没有）`,
    );
  }

  const points = normalizePoints(node.points);

  return {
    id,
    type: type as QuestionType,
    prompt: typeof node.prompt === 'string' ? node.prompt : '',
    inputMode: node.inputMode === 'handwriting' ? 'handwriting' : 'keyboard',
    // ⚠️ 只在**有值**时写这个键：`points: undefined` 落到 JSON 里是**整个键消失**
    // （`JSON.stringify` 会丢掉 undefined 的属性），所以两种写法在库里长得一样 ——
    // 但显式展开一个 `undefined` 会让「这个键到底存不存在」在读的一侧多一种形状。
    // 统一成「没有 = 键不存在」，`resolvePoints` 只看 `node.points` 的真假。
    ...(points ? { points } : {}),
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
    // ⚠️ 这里曾经写「请先从这些课堂或小组中移除后再试」—— 本仓**没有那个操作**，
    // 那句是一条**走不通的出路**（前端已经两次绕开它）。实测依据：
    // `PUT /api/classroom/:id/settings` 的 body 只取 `title`（`classroom.ts`），
    // `ClassroomGroupMaterial` 全仓只有两处 `create`（都在建课堂那一支）、
    // 没有任何删除或改写它的端点，也没有删除课堂的端点。教师照着那句话去找按钮
    // 会找不到，然后以为是自己没找对地方。所以说清现状，而不是指一条不存在的路。
    : '它被课堂或小组引用着，而当前版本还没有提供「解除引用」的入口。';
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

/**
 * 教师看板：**这一堂课的整批作答行**（`GET /classroom/:classroomId/answers`）。
 *
 * ── 它为什么必须存在（D3 实测出来的洞）────────────────────────────────
 * D3 的看板格子**完全由广播驱动**：`worksheet-answer-updated` 只在「学生刚保存/提交」那一刻
 * 发一次，而在此之前发生的作答没有任何办法补读。于是**教师刷新一次页面，早做完的学生就
 * 掉回「还没收到作答」态** —— 看板失忆，且不报任何错（`worksheet-tile-state.ts` 的
 * `no-progress` 那一态就是被这件事逼出来的）。抽屉（本任务的形态 A / B）本来也要同一份数据。
 *
 * ── 🔴 形状：为什么按「课堂」而不是按「学习单」────────────────────────
 * 高级模式下**每个组可以是不同的学习单**（规格 §1.2）——「全班共有的第 3 题」并不存在。
 * 所以响应天生是两层：`worksheets[] → participants[] → answerRows[]`，
 * 每一层都按**解析结果**分组（`resolveMaterialTargetId`，全项目唯一口径），
 * 而不是假设全班共用一份。标准 / 分组模式下 `worksheets[]` 只有一个元素，两层退化成一层的
 * 观感由前端负责（规格 §7.3：会「自动退化成一层」）。
 *
 * ── 🔴 不泄漏答案（规格 §5.4 红线）──────────────────────────────────
 * 读的是 `WorksheetAnswer` 行，**从不读 `Worksheet.content`** —— 正确答案
 * （`data.correctKeys` / `data.answers` / `data.explanation`）住在 content 的题目节点里，
 * 而这里只 `select` 学习单的 `{ id, title }`。逐题作答行里的 `value` 是**学生自己写的**
 * 那一个（§7.3 形态 A 的「学生原答案」要求它），与「正确答案」是两件事。
 * ⚠️ 改这个 handler 时**不要**顺手把 `content` 或题目节点的 `data` 加进来：
 * 那一步会把全班试卷的答案一起送到教师浏览器（虽然教师合法，但这个端点没有任何一处需要它）。
 *
 * ── 鉴权 ────────────────────────────────────────────────────────────
 * 🔴 **教师专用**。路径是 `/classroom/:classroomId/answers`（**三段**），
 * 刻意不落在 `worksheetAccessGate` 放行的那三种学生形状里：
 *   · `^\/[^/]+\/student-view\/?$` —— 末段必须是 `student-view`；
 *   · `^\/[^/]+\/answers\/?$`     —— **恰好两段**，而本路径是三段；
 *   · `^\/[^/]+\/answers\/submit\/?$` —— 末段必须是 `submit`。
 * 所以学生 token 打到这里会走 `requireTeacher` 那一支 ⇒ **403**（不是 401）。
 * 用例钉在 `worksheet-routes.test.ts` 与 `worksheet-board.test.ts` 两处。
 *
 * ── 口径上的两处取舍（都不是随手）────────────────────────────────────
 * ① **只回「此刻该答的那一份」上的作答行**。教师课上换过学习单时，旧那一份的作答行仍在库里，
 *    但学生此刻答的不是它 —— 混进来只会让抽屉显示一个与他手上那张单无关的进度。
 * ② **目标已被删（组级 `targetId` 悬空）的那一份不出现在响应里**：它没有标题、也没有题目
 *    （`Worksheet` 行已经没了），前端对它画不出任何东西；学生那边同样是读不到的（404）。
 *    这不是「静默丢数据」：那节课的那道题本来就已经不存在了。
 */
router.get('/classroom/:classroomId/answers', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const classroomId = req.params.classroomId;

    const classroom = await prisma.classroom.findUnique({
      where: { id: classroomId },
      select: {
        id: true,
        mode: true,
        groups: {
          select: {
            id: true,
            name: true,
            materials: { select: { kind: true, targetId: true } },
          },
        },
        students: {
          select: {
            id: true,
            type: true,
            groupId: true,
            student: { select: { name: true } },
            group: { select: { name: true } },
          },
        },
      },
    });
    if (!classroom) return res.status(404).json({ error: '课堂不存在' });

    const classroomLevelId = await loadClassroomLevelWorksheetId(prisma, classroomId);
    const groupMaterials = classroom.groups.flatMap(group =>
      group.materials.map(material => ({ groupId: group.id, kind: material.kind, targetId: material.targetId })));

    // 参与者 → 他此刻该答的那一份。**同一个函数**是全部三种模式唯一的解析口径。
    const participantsByWorksheet = new Map<string, Array<{ id: string; name: string; kind: string; groupName: string | null }>>();
    for (const participant of classroom.students) {
      const worksheetId = resolveMaterialTargetId({
        mode: classroom.mode,
        studentGroupId: participant.groupId,
        groupMaterials,
        classroomLevelId,
        kind: 'worksheet',
      });
      if (!worksheetId) continue;
      const list = participantsByWorksheet.get(worksheetId) ?? [];
      list.push({
        id: participant.id,
        // 小组 / 高级模式下这里是**一个组一行参与者**（`ClassroomStudent.type === 'group'`），
        // 所以名字优先取组名 —— 取 `student?.name` 会是 undefined。
        name: participant.student?.name ?? participant.group?.name ?? '未命名参与者',
        kind: participant.type,
        groupName: participant.group?.name ?? null,
      });
      participantsByWorksheet.set(worksheetId, list);
    }

    // 只查**存在**的那几份（取舍 ② 见 handler 注释）。
    const worksheets = await prisma.worksheet.findMany({
      where: { id: { in: [...participantsByWorksheet.keys()] } },
      select: { id: true, title: true },
    });
    const titleById = new Map(worksheets.map(worksheet => [worksheet.id, worksheet.title]));

    // 作答行**一次查全**（不是逐份 / 逐个参与者查 —— 40 人 × 20 题会变成 N+1）。
    // ⚠️ 只 select 答案行自己的列，不 `include` worksheet（那会把 content 拖出来）。
    const responses = await prisma.worksheetResponse.findMany({
      where: { classroomId },
      select: {
        participantId: true,
        worksheetId: true,
        answers: {
          // ⚠️ `isCorrect` **在，且只增不改**（协议字段）；`gradeState` / `score` 是 B1 新增的，
          // 看板的 ½ 部分给分档与「这题得了几分」只能来自这两列（规格 §12）。漏 select 一列的
          // 表现是**那个档永远画不出来**，而响应里也没有任何东西缺一块 —— 只是数字不对。
          select: {
            questionId: true, status: true, isCorrect: true,
            gradeState: true, score: true,
            reviewedAt: true, value: true,
          },
        },
      },
    });
    const rowsByPair = new Map<string, Array<{
      questionId: string; status: string; isCorrect: boolean | null;
      gradeState: string | null; score: number | null;
      reviewedAt: Date | null; value: Prisma.JsonValue | null;
    }>>();
    for (const response of responses) {
      rowsByPair.set(`${response.participantId}\x00${response.worksheetId}`, response.answers);
    }

    res.json({
      classroomId: classroom.id,
      worksheets: [...participantsByWorksheet.entries()]
        .filter(([worksheetId]) => titleById.has(worksheetId))
        .map(([worksheetId, participants]) => ({
          id: worksheetId,
          title: titleById.get(worksheetId)!,
          participants: participants.map(participant => ({
            participantId: participant.id,
            name: participant.name,
            kind: participant.kind,
            groupName: participant.groupName,
            // 没有答案行 = 这个人这道题没有任何动作（包括「从没开始」）。**空数组照发**：
            // 「已交 N/M」的分母是参与者数，把没作答的人整个删掉会让分母只剩作答过的人。
            answerRows: rowsByPair.get(`${participant.id}\x00${worksheetId}`) ?? [],
          })),
        })),
    });
  } catch (error) {
    console.error('[worksheets] 读取课堂作答行失败:', error);
    res.status(500).json({ error: '读取课堂作答行失败' });
  }
});

// ── 分析载荷（★ M7a）─────────────────────────────────────────────────
//
//   POST /:id/analysis/:questionId              算 + 落库 + 回载荷结构（不含图）
//   GET  /:id/analysis/:questionId              读已存的载荷结构（没算过 ⇒ 404）
//   GET  /:id/analysis/:questionId/sheet/:index 按需渲染第 index 张联系表（PNG）
//
// 🔴 **M7a 那一版这三条零外发**（把「将来要发什么」在本机算出来、存下来、给教师看）。
// **M7b 起多了第四条 `…/run`** —— 它才是外发的那一条，而它的出口**只有一处**
// （`ai-proxy.ts` 的 `proxyAnalysisRequest`），这就是 M7a 留那道缝的兑现：
// 合规审查只看那一个函数。
//
// 🔴 **鉴权**：这三条路径是三段 / 四段，**不匹配** `worksheetAccessGate` 放行学生的
// 那四条放行学生的形状里，三条是「恰好两段」、`answers/submit` 是**三段** ——
// 但这三条新路径（`…/analysis/…` 与 `…/analysis/…/sheet/…`）**一条都不匹配** ⇒ 自然落到
// `requireTeacher`。（原先这里写「都是恰好两段」，不实 —— 独立审查 M6 抓到；结论不变。）
// `analysis-endpoint.test.ts` 有一条「学生 token 打这三条路径一律 403」把它钉住 ——
// 改路径形状时要重新确认那一条。

/**
 * 这份学习单是不是**挂在这个班上**。
 *
 * 🔴 这是 I1 的修法：原先这里叫 `findWorksheetClassroomId`，做的是「**猜**一个课堂」——
 * 先取 `ClassroomWorksheet` 里 `createdAt` 最早的那条、再退到组级材料。而同一份学习单
 * 可以被**多个课堂**引用（`ClassroomWorksheet` 的唯一键是 `(classroomId, worksheetId)`，
 * `GET /:id/usage` 专门统计「被 N 个课堂引用」）⇒ 教师在乙班点「分析」，拿到的是**甲班**的
 * covered/total、甲班的答案、甲班的伪名列表；在乙班点「重新生成」会把甲班那份**静默覆盖**。
 *
 * ⇒ 现在课堂由**请求带入**（`?classroomId=`，前端从矩阵浮层所在的课堂传），这里只做一道
 * 校验：它确实挂在这个班上（课堂级绑定 **或** 该班的组级材料）。不挂 ⇒ 404，
 * 而不是回落到「猜一个」。
 */
async function isWorksheetInClassroom(
  prisma: PrismaClient, classroomId: string, worksheetId: string,
): Promise<boolean> {
  const classroomLevel = await prisma.classroomWorksheet.findFirst({
    where: { classroomId, worksheetId }, select: { id: true },
  });
  if (classroomLevel) return true;
  const groupLevel = await prisma.classroomGroupMaterial.findFirst({
    where: { kind: 'worksheet', targetId: worksheetId, group: { classroomId } },
    select: { id: true },
  });
  return groupLevel !== null;
}

/** 读一次旋钮。坏值回落默认（`normalizeAnalysisKnobs`），**不抛**。 */
async function loadAnalysisKnobs(prisma: PrismaClient): Promise<SheetKnobs> {
  const row = await prisma.setting.findUnique({ where: { key: KNOBS_SETTING_KEY } }).catch(() => null);
  return normalizeAnalysisKnobs(row?.value ?? null);
}

/** 题在 `content` 树里的位置（拍平序）—— 抬头那句「第 N 题」要用它。 */
async function loadAnalysisTarget(
  prisma: PrismaClient, classroomId: string, worksheetId: string, questionId: string,
): Promise<{ ok: true; node: QuestionNode; heading: string } | { ok: false; status: number; error: string }> {
  const worksheet = await prisma.worksheet.findUnique({ where: { id: worksheetId }, select: { content: true } });
  if (!worksheet) return { ok: false, status: 404, error: '学习单不存在' };
  // 与既有三处同形（:1288 / :1469 / :1806）：JSON 列的窄化要走 unknown。
  // ★ 两级题号（`任务一 · 3`），不是拍平下标：拍平序把**任务**也算了一号 ⇒ 抬头印出来的
  // 「第 N 题」会比教师看板上那一列大，而载荷里看不出来它是错的。
  // ⚠️ 入参是**顶层 nodes**：`flattenQuestions` 的返回值里节点还带着 `children`，
  // 再喂给 `flattenAnswerable` 会把小题数两遍。
  const items = flattenAnswerable((worksheet.content as unknown as WorksheetContent).nodes ?? []);
  const found = items.find((item) => item.node.id === questionId);
  if (!found) return { ok: false, status: 404, error: '这道题不在学习单里' };
  const node = found.node;
  const heading = found.heading;
  if (!isAnalyzableType(node.type)) {
    return { ok: false, status: 400, error: '这道题不是主观题 —— 客观题本来就判分，看板的对错已经回答了问题' };
  }
  if (!(await isWorksheetInClassroom(prisma, classroomId, worksheetId))) {
    // ⚠️ 404 而不是「回落到别的课堂」：同一份学习单可以被多个课堂引用，
    // 猜错的后果是把**别的班**的数据当成这个班的给教师看。
    return { ok: false, status: 404, error: '这份学习单没有挂在当前课堂上' };
  }
  return { ok: true, node, heading };
}

/**
 * 「他此刻该答的那一份」= **参与者 → 该题应作答的人**。
 *
 * 🔴 分母就在这个函数里。它必须走 `resolveMaterialTargetId` 这**唯一**的口径：
 * 高级模式下每个组可以是**不同的学习单**（M5b 规格 §2.2），所以
 * 「应作答的参与者数」**不是**「全班参与者数」—— 算错的后果是「已交 5/40」而实际只有
 * 5 人该答，教师会以为全班都没交，**且没有任何报错**。
 */
async function loadAnalysisParticipants(
  prisma: PrismaClient, classroomId: string, worksheetId: string,
): Promise<Participant[]> {
  const classroom = await prisma.classroom.findUnique({
    where: { id: classroomId },
    select: {
      id: true, mode: true,
      groups: { select: { id: true, materials: { select: { kind: true, targetId: true } } } },
      students: {
        select: {
          id: true, groupId: true,
          student: { select: { name: true } },
          group: { select: { name: true } },
        },
      },
    },
  });
  if (!classroom) return [];
  const classroomLevelId = await loadClassroomLevelWorksheetId(prisma, classroomId);
  const groupMaterials = classroom.groups.flatMap((group) =>
    group.materials.map((m) => ({ groupId: group.id, kind: m.kind, targetId: m.targetId })));

  const participants: Participant[] = [];
  for (const participant of classroom.students) {
    const resolved = resolveMaterialTargetId({
      mode: classroom.mode, studentGroupId: participant.groupId, groupMaterials, classroomLevelId, kind: 'worksheet',
    });
    if (resolved !== worksheetId) continue;
    participants.push({
      participantId: participant.id,
      // 分组 / 高级模式下这里是**一个组一行参与者**（`type === 'group'`）⇒ 名字优先取组名。
      name: participant.student?.name ?? participant.group?.name ?? '未命名参与者',
    });
  }
  return participants;
}

/** 这一份学习单在这一节课里的全部作答行（一次查全，不逐人查 —— GC 35）。 */
async function loadAnalysisAnswers(
  prisma: PrismaClient, classroomId: string, worksheetId: string,
): Promise<RawAnswer[]> {
  const responses = await prisma.worksheetResponse.findMany({
    where: { classroomId, worksheetId },
    select: {
      participantId: true,
      // ⚠️ `submittedAt` 是给**陈旧判定**用的（「这道题最后一次定稿」）——
      // `selectAnalyzeEntries` 不看它，但少 select 它的表现是「永远不显示过期」，
      // 而那是**静默**的：屏幕上没有任何东西缺一块。
      answers: { select: { questionId: true, status: true, value: true, submittedAt: true } },
    },
  });
  return responses.flatMap((response) =>
    response.answers.map((answer) => ({
      participantId: response.participantId,
      questionId: answer.questionId,
      status: answer.status,
      value: answer.value,
      submittedAt: answer.submittedAt ? answer.submittedAt.toISOString() : null,
    })));
}

/**
 * 读 `?classroomId=`。**必填**（同一份学习单可以被多个课堂引用，见 `isWorksheetInClassroom`）——
 * 缺了它只能猜，而猜错的后果是把别的班的数据当成这个班的。
 */
function readClassroomIdQuery(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value !== '' ? value : null;
}

/** 把一行库里的记录重建成载荷（`GET` 与 sheet 端点共用）。 */
function payloadFromStoredRow(
  row: { aggregate: unknown; totalCount: number },
  node: QuestionNode, heading: string, knobs: SheetKnobs,
): ReturnType<typeof buildAnalysisPayload> {
  const meta = { questionId: node.id, typeLabel: questionTypeLabel(node.type), prompt: node.prompt, heading };
  // ⚠️ `total` 取**存下来的** `totalCount`（与 `coveredCount` 同一时刻的口径），不重算 ——
  // 重算会让「存下来的分子」配上「现在的分母」，两边不是同一时刻的。
  return buildAnalysisPayload({
    question: meta,
    entries: entriesFromAggregate(row.aggregate),
    total: row.totalCount,
    knobs,
  });
}

/**
 * 回给前端的载荷（图不在里面 —— 它走 sheet 端点单独取）。
 *
 * `labeled`：标签**这一次**能不能渲染出来（缺 fontconfig 时是 `false`，界面据此给编号对照表）。
 * `stale`：「算完之后又有人交了这道题」—— 界面必须显眼说出来，否则教师会把一份不完整的
 * 名单当成当前的。
 */
async function payloadResponse(
  prisma: PrismaClient,
  worksheetId: string,
  payload: ReturnType<typeof buildAnalysisPayload>,
  labeled: boolean,
  stale: boolean,
  analysis: { narrative: string | null; agentId: string | null; model: string | null },
): Promise<Record<string, unknown>> {
  // ★ M7b：**「现在能不能发」由服务端算** —— 它需要三件事，而那三件的数据都在这一侧：
  // 有没有指定智能体 · 那个智能体启没启用 · 平台收不收得了这份载荷的形态。
  // 前端只管把 `canSend.reason` **逐字**说出来，不复述这些规则。
  const worksheet = await prisma.worksheet.findUnique({
    where: { id: worksheetId }, select: { settings: true },
  });
  const settings = normalizeSettings((worksheet?.settings ?? {}) as Record<string, unknown>);
  const analysisAgentId = (settings as Record<string, unknown>).analysisAgentId;
  let analysisAgent: { name: string; platform: string } | null = null;
  let canSend: { ok: true } | { ok: false; reason: string };
  if (typeof analysisAgentId !== 'string' || analysisAgentId === '') {
    canSend = { ok: false, reason: '这份学习单还没有指定分析型智能体（去学习单编辑器的「设置」里选一个）' };
  } else {
    const agent = await prisma.agent.findUnique({
      where: { id: analysisAgentId },
      // ★ 2026-09-25：`toAgentConfig` 要用共享凭据决定使哪把钥匙，必须一起取。
      include: { credential: { select: { token: true } } },
    });
    if (!agent || !agent.enabled) {
      canSend = { ok: false, reason: '指定的分析型智能体不存在或已停用' };
    } else if (agent.purpose !== 'analysis') {
      // 与 `run` 端点**逐字同一条判据** —— 界面据此禁用按钮，教师就不会被邀请去点一个必然 400 的操作。
      canSend = { ok: false, reason: '这个智能体的用途是「学伴」，不能用来接收全班作业（去智能体管理里把它改成「分析」）' };
    } else {
      analysisAgent = { name: agent.name, platform: agent.platform };
      canSend = analysisGateOf(payload, agent.platform);
    }
  }
  return { ...payload, labeled, stale, ...analysis, analysisAgent, canSend };
}

router.post('/:id/analysis/:questionId', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const worksheetId = req.params.id;
    const questionId = req.params.questionId;
    const classroomId = readClassroomIdQuery(req.query.classroomId);
    if (!classroomId) return res.status(400).json({ error: '缺少 classroomId' });
    const target = await loadAnalysisTarget(prisma, classroomId, worksheetId, questionId);
    if (!target.ok) return res.status(target.status).json({ error: target.error });

    const participants = await loadAnalysisParticipants(prisma, classroomId, worksheetId);
    const answers = await loadAnalysisAnswers(prisma, classroomId, worksheetId);
    const entries = selectAnalyzeEntries(answers, participants, questionId);
    const knobs = await loadAnalysisKnobs(prisma);
    const meta = {
      questionId, typeLabel: questionTypeLabel(target.node.type), prompt: target.node.prompt, heading: target.heading,
    };
    const payload = buildAnalysisPayload({ question: meta, entries, total: participants.length, knobs });

    await prisma.worksheetQuestionAnalysis.upsert({
      where: { classroomId_worksheetId_questionId: { classroomId, worksheetId, questionId } },
      // ⚠️ 只写 `aggregate` + `totalCount`：`payloadKind` 与「已交数」都从 `aggregate` 推得出来，
      // 各存一列等于给同一件事留两个会静默分叉的来源（独立审查 M4）。`totalCount` 不同 ——
      // 它是**冻结的分母**，从 `aggregate` 里推不出来（没作答的人不进条目）。
      update: {
        aggregate: entriesToAggregate(entries) as unknown as Prisma.InputJsonValue,
        totalCount: participants.length,
        computedAt: new Date(),
      },
      create: {
        classroomId, worksheetId, questionId,
        aggregate: entriesToAggregate(entries) as unknown as Prisma.InputJsonValue,
        totalCount: participants.length,
      },
    });
    // 🔴 `update` 里**刻意不写** `narrative` / `perStudent` / `agentId` / `model` ——
    // 那四格是将来 AI 写的，重算载荷**不该把它们清掉**。漏了这一点的表现是
    // 「教师重算一次，之前花掉的 AI 解读没了」，而**没有任何报错**。
    // （`analysis-endpoint.test.ts` 有一条用例钉着它。）

    // 刚算完 ⇒ 不可能已过期（`computedAt` 是此刻）。仍然照发这一格，让前端只有一个形状要处理。
    // 🔴 `labeled` 必须**真算一次探针**（不是传 `null`）：界面只在 `labeled === false` 时给
    // 「编号对照表」，而 `null === false` 是假 ⇒ 那一整块 UI 永远不会渲染 ——
    // 它恰好在探针为 false 的那一刻才需要，那一刻它不存在。
    // ⚠️ 刚算完时那三格是**旧值**（`upsert` 的 update 刻意不碰它们）—— 如实读库里的。
    const fresh = await prisma.worksheetQuestionAnalysis.findUnique({
      where: { classroomId_worksheetId_questionId: { classroomId, worksheetId, questionId } },
      select: { narrative: true, agentId: true, model: true },
    });
    res.json(await payloadResponse(prisma, worksheetId, payload, await labelsRenderOk(), false,
      fresh ?? { narrative: null, agentId: null, model: null }));
  } catch (error) {
    console.error('[worksheets] 生成分析载荷失败:', error);
    res.status(500).json({ error: '生成分析载荷失败' });
  }
});

router.get('/:id/analysis/:questionId', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const worksheetId = req.params.id;
    const questionId = req.params.questionId;
    const classroomId = readClassroomIdQuery(req.query.classroomId);
    if (!classroomId) return res.status(400).json({ error: '缺少 classroomId' });
    const row = await prisma.worksheetQuestionAnalysis.findUnique({
      where: { classroomId_worksheetId_questionId: { classroomId, worksheetId, questionId } },
    });
    if (!row) return res.status(404).json({ error: '这道题还没有生成过分析' });
    const target = await loadAnalysisTarget(prisma, classroomId, worksheetId, questionId);
    if (!target.ok) return res.status(target.status).json({ error: target.error });
    const knobs = await loadAnalysisKnobs(prisma);
    // ★ 陈旧 = 「算完之后又有人交了这道题」。**服务端算**（前端那份看板数据里没有
    // `submittedAt`），判据是纯函数，与 `computedAt` 比字符串序。
    // ⚠️ 第三个实参是 **worksheetId**，不是 questionId —— 传错的后果是这里永远查到 0 行、
    // 于是**永远不报过期**，而屏幕上一点异常都没有（这一条被 `analysis-endpoint.test.ts`
    // 的 stale 用例当场抓住）。
    const answers = await loadAnalysisAnswers(prisma, classroomId, worksheetId);
    const stale = isAnalysisStale(row.computedAt.toISOString(), lastSubmittedAt(answers, questionId));
    res.json(await payloadResponse(prisma, worksheetId,
      payloadFromStoredRow(row, target.node, target.heading, knobs), await labelsRenderOk(), stale,
      { narrative: row.narrative, agentId: row.agentId, model: row.model }));
  } catch (error) {
    console.error('[worksheets] 读取分析载荷失败:', error);
    res.status(500).json({ error: '读取分析载荷失败' });
  }
});

router.get('/:id/analysis/:questionId/sheet/:index', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const worksheetId = req.params.id;
    const questionId = req.params.questionId;
    const sheetIndex = Number.parseInt(req.params.index, 10);
    if (!Number.isInteger(sheetIndex) || sheetIndex < 0) {
      return res.status(404).json({ error: '没有这一张' });
    }
    const classroomId = readClassroomIdQuery(req.query.classroomId);
    if (!classroomId) return res.status(400).json({ error: '缺少 classroomId' });
    const row = await prisma.worksheetQuestionAnalysis.findUnique({
      where: { classroomId_worksheetId_questionId: { classroomId, worksheetId, questionId } },
      select: { aggregate: true },
    });
    if (!row) return res.status(404).json({ error: '这道题还没有生成过分析' });

    const entries: AnalyzeEntry[] = entriesFromAggregate(row.aggregate);
    const knobs = await loadAnalysisKnobs(prisma);
    const layouts = layoutSheets(entries, payloadLabels(entries), knobs);
    if (sheetIndex >= layouts.length) return res.status(404).json({ error: '没有这一张' });

    // 🔴 **按需渲染**（规格 §3.1 决定 1）：库里只存结构化的 `aggregate`，
    // 图是派生物。旋钮改了以后旧图不会变成「看着对、其实按旧参数画的」。
    const rendered = await renderSheets(entries, [layouts[sheetIndex]], knobs);
    if (!rendered || rendered.sheets.length === 0) {
      return res.status(503).json({ error: '这一张渲染不出来（本机缺图片渲染能力）' });
    }
    if (!rendered.labeled) res.setHeader('X-ANALYSIS-LABELS', 'none');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(rendered.sheets[0]);
  } catch (error) {
    console.error('[worksheets] 渲染联系表失败:', error);
    res.status(500).json({ error: '渲染联系表失败' });
  }
});

/**
 * ★ M7b：把 M7a 那道缝接活 —— 读已存的载荷，发给学习单上指定的分析型智能体，写回解读。
 *
 * 🔴 **它只写 `narrative`/`agentId`/`model`**（用户 2026-09-25 裁定 3：两组字段各自动自己
 * 那一半）。`aggregate`/`totalCount`/`computedAt` 属于「这份载荷是什么时候、按什么算的」，
 * 与「AI 怎么解读它」是两件事 —— 教师只想重发一次时不该连带把前者也改掉。
 *
 * 🔴 **失败一律不写库**：模型返回空、平台报错、渲不出图 —— 三种都不写，
 * 于是「界面上原本那段解读」不会因为一次失败而消失（那是**静默**的）。
 */
router.post('/:id/analysis/:questionId/run', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const worksheetId = req.params.id;
    const questionId = req.params.questionId;
    const classroomId = readClassroomIdQuery(req.query.classroomId);
    if (!classroomId) return res.status(400).json({ error: '缺少 classroomId' });

    const target = await loadAnalysisTarget(prisma, classroomId, worksheetId, questionId);
    if (!target.ok) return res.status(target.status).json({ error: target.error });

    const row = await prisma.worksheetQuestionAnalysis.findUnique({
      where: { classroomId_worksheetId_questionId: { classroomId, worksheetId, questionId } },
    });
    if (!row) return res.status(404).json({ error: '这道题还没有生成过分析' });

    // 学习单上指定的那个分析智能体（M7b 裁定 4：学习单级）
    const worksheet = await prisma.worksheet.findUnique({
      where: { id: worksheetId }, select: { settings: true },
    });
    const settings = normalizeSettings((worksheet?.settings ?? {}) as Record<string, unknown>);
    const analysisAgentId = (settings as Record<string, unknown>).analysisAgentId;
    if (typeof analysisAgentId !== 'string' || analysisAgentId === '') {
      return res.status(400).json({ error: '这份学习单还没有指定分析型智能体（去学习单编辑器的「设置」里选一个）' });
    }
    const agent = await prisma.agent.findUnique({
      where: { id: analysisAgentId },
      // ★ 2026-09-25：`toAgentConfig` 要用共享凭据决定使哪把钥匙，必须一起取。
      include: { credential: { select: { token: true } } },
    });
    if (!agent || !agent.enabled) {
      return res.status(400).json({ error: '指定的分析型智能体不存在或已停用' });
    }
    // 🔴 ★ M7b（独立审查 I2）：**那道闸必须是双向的**。`purpose` 原先只挡「学生看不见分析型」，
    // 而分析这一侧**什么型都收** ⇒ 两条现实路径会让**一个学伴 bot 收到全班作业**：
    // ① 教师把一个 bot 从「分析」改回「学伴」（同一个 bot，学生也在跟它聊）；
    // ② 任何能写 `settings.analysisAgentId` 的路径（导入 / 手改 / 复制学习单）。
    if (agent.purpose !== 'analysis') {
      return res.status(400).json({ error: '这个智能体的用途是「学伴」，不能用来接收全班作业（去智能体管理里把它改成「分析」）' });
    }

    const knobs = await loadAnalysisKnobs(prisma);
    const entries = entriesFromAggregate(row.aggregate);
    const payload = buildAnalysisPayload({
      question: { questionId, typeLabel: questionTypeLabel(target.node.type), prompt: target.node.prompt, heading: target.heading },
      entries, total: row.totalCount, knobs,
    });

    // 第一道闸（界面用的也是它）
    const gate = analysisGateOf(payload, agent.platform);
    if (!gate.ok) return res.status(400).json({ error: gate.reason });

    // 联系表按需渲染（M7a 决定 1）—— 只有需要图时才渲
    let labeled = true;
    const images: Buffer[] = [];
    if (payload.payloadKind !== 'text') {
      const rendered = await renderSheets(entries, payload.sheetLayouts, knobs);
      if (!rendered || rendered.sheets.length === 0) {
        return res.status(502).json({ error: '联系表渲不出来（本机缺图片渲染能力）' });
      }
      images.push(...rendered.sheets);
      // 🔴 **必须把它传下去**：探针说标签没画出来时，消息里那句「每格上方标着代号」
      // 就是**假的**，而模型会照着猜 ⇒ 分析结果整体错位。退化时 `buildAnalysisMessage`
      // 会把编号对照以文本形式附上（Task 3 的裁定）。
      labeled = rendered.labeled;
    }

    // 🔴 **必须转成 `AgentConfig`**（与 `socket/index.ts:1973` 那处同一写法）：
    // 库里 `apiKey` 存的是 **AES 密文**，直接把它当 key 发出去，平台会回 401 ——
    // 而那条错误在界面上只会显示成「分析失败」，看不出是「密钥没解密」。
    // ★ 收口（2026-09-25）：从前这里自己 `decrypt(agent.apiKey)` —— 它是 7 处之一。
    // 不传 conversationId：每次分析都要一个新会话，两次分析之间不该串上下文。
    const agentConfig = toAgentConfig(agent, agent.credential);
    const result = await proxyAnalysisRequest(agentConfig, buildAnalysisMessage(payload, labeled), images);
    if (!result.success) return res.status(502).json({ error: result.error ?? '分析失败' });
    const narrative = normalizeNarrative(result.content ?? '');
    if (narrative === '') {
      // 🔴 **空解读不写库** —— 写进去的后果是「界面上原本那段解读消失了」，而没有任何报错。
      return res.status(502).json({ error: '模型没有返回可用的解读（未写入）' });
    }

    await prisma.worksheetQuestionAnalysis.update({
      where: { classroomId_worksheetId_questionId: { classroomId, worksheetId, questionId } },
      // ⚠️ 只这三格。`aggregate`/`totalCount`/`computedAt` 一个字都不动。
      data: { narrative, agentId: agent.id, model: agent.platform },
    });
    res.json({ narrative, agentId: agent.id, model: agent.platform });
  } catch (error) {
    console.error('[worksheets] 分析失败:', error);
    res.status(500).json({ error: '分析失败' });
  }
});

// ── 学生端 ──────────────────────────────────────────────────────────
//
//   GET  /:id/student-view        读自己那一份（服务端剥离答案，§5.4）
//   GET  /:id/answers             读**自己已有的作答**（刷新后水合，规格 §8.3）
//   PUT  /:id/answers             保存单题（幂等）
//   POST /:id/answers/submit      提交单题
//   POST /:id/review              「已查看」标记（**教师专用**，B4）—— 实现**在上面教师端
//                                 那一段**，这里列出来只是为了让闸门那四条正则的对照物
//                                 在同一处看得全（闸门只放行上面四条）。
//
// 这五条形状的**放行判据**在文件顶部的 `worksheetAccessGate` 里，那一段是安全关键：
// 前四条是学生放行集，`review` **不在**其中（它走教师那一支）。
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
  /** ★ M5a：这间课堂此刻是否锁定了作答（判据在 `requireOwnWorksheet` 里取）。 */
  answersLocked: boolean;
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
          // ★ M5a：锁定作答的判据跟着 context 走 —— 写路径要用它，免得每个端点再查一次课堂。
          answersLocked: true,
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

  return {
    prisma,
    classroomId: participant.classroomId,
    participantId: participant.id,
    answersLocked: participant.classroom.answersLocked,
    worksheet,
  };
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
 * 学生端只拿 `settings` 里的**五个**字段：`allowResubmit` / `autoGrade` /
 * `rewardStyle` / `rewardStep` / `halfStep`。
 *
 * 前两个是 B3 就有的，中间两个是 D5 加的（规格 §9.2：奖励形式是**学习单级**配置，
 * 而学生端要拿它才知道该把判分画成对错、星星、花朵还是分数），`halfStep` 是 M4a 的 B2 加的
 * —— 它到这里为止才是**活的**：在此之前 `normalizeSettings` 不认那个键（写不进去），
 * 所以下发它等于下发一个恒为 `undefined` 的字段。**它不下发分数** ——
 * 星星/花朵/分数在服务端从来不是数据，只是一个「怎么画」的开关（§9.1）。
 *
 * `defaultInputMode` 仍然刻意不下发：第一批恒为 `keyboard`（规格 §3-V），多给一个字段
 * 只是给前端多一个能读错的开关。库里手工改过的行缺字段时按 `DEFAULT_SETTINGS` 兜底。
 *
 * ⚠️ 返回体的键数**被 `worksheet-student.test.ts` 逐字钉着**（`deepEqual`）。加字段要
 * 一起改那条用例 —— 那是有意的：学生端下发什么，必须是有人明确决定过的事。
 */
function readStudentSettings(raw: unknown): {
  allowResubmit: boolean; autoGrade: boolean; rewardStyle: string; rewardStep: number; halfStep: number;
} {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? raw as Record<string, unknown>
    : {};
  // ⚠️ 与 `normalizeSettings` 走**同一对取值域与同一条回落规则**：两处各判一次的话，
  // 库里的坏值会让「教师看到的」与「学生看到的」不是同一个档。
  return {
    allowResubmit: typeof source.allowResubmit === 'boolean' ? source.allowResubmit : DEFAULT_SETTINGS.allowResubmit,
    autoGrade: typeof source.autoGrade === 'boolean' ? source.autoGrade : DEFAULT_SETTINGS.autoGrade,
    rewardStyle: typeof source.rewardStyle === 'string' && REWARD_STYLES.includes(source.rewardStyle)
      ? source.rewardStyle
      : DEFAULT_SETTINGS.rewardStyle,
    rewardStep: typeof source.rewardStep === 'number' && REWARD_STEPS.includes(source.rewardStep)
      ? source.rewardStep
      : DEFAULT_SETTINGS.rewardStep,
    // ⚠️ 域是 `HALF_STEPS`（含 0），与上一行**不是**同一个数组 —— 见它的定义。
    halfStep: typeof source.halfStep === 'number' && HALF_STEPS.includes(source.halfStep)
      ? source.halfStep
      : DEFAULT_SETTINGS.halfStep,
  };
}

function findQuestion(content: Prisma.JsonValue, questionId: string): QuestionNode | null {
  // ⚠️ 跳过任务：任务是分组容器，**没有作答值**（教师裁定 ①a）。拿它的 id 来落库
  // 会写出一行永远判不了分、也永远画不出来的作答；「找不到」才是实话。
  return flattenAnswerable((content as unknown as WorksheetContent).nodes ?? [])
    .map((item) => item.node)
    .find(node => node.id === questionId) ?? null;
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
  /** ★ M4a：三态判定结果（`correct` / `partial` / `incorrect`），`null` = 没判分。 */
  gradeState: string | null;
  /** ★ M4a：这道题实际拿到的数（教师逐题填的绝对值），`null` = 没判分。 */
  score: number | null;
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
    // ⚠️ **`isCorrect` 在，且只增不改**：它是协议字段，改名 ⇒ **看板**拿到 `undefined`
    // ⇒ `gradeState` 为 null 的那些行**静默不画 ✓/✗**，没有任何报错。新增的两个是 `gradeState`
    // 与 `score`（规格 §12），`src/lib/socket-events.ts` 的同名事件类型要一起改。
    // ⊘ 2026-09-24 更正：这句原先写「看板**与学生端**拿到 `undefined`」—— **学生端不订这条广播**。
    // 实测 `/usr/bin/grep -rn "worksheet-answer-updated" src` ⇒ **7 处**：
    // `src/app/teacher/classroom/` 5 处（其中 4 处在注释里、1 处是 `page.tsx` 的 `on(...)`，
    // 那是**唯一真正的订阅方**）· `src/lib/` 2 处（`types.ts` 的说明 + `socket-events.ts`
    // 的事件类型声明）· **`src/app/classroom/`（学生端）零命中**。
    // ⚠️ 我第一次写这一条时只跑了 `… src | grep classroom/` 这条**过滤过**的命令，
    // 却按全量口吻写成「5 处、全在教师端」—— 终审的限定复查抓到。**过滤过的输出不能当全量的数用。**
    // ⚠️ 同时删掉了原句尾巴上的「与奖励」—— 奖励是**学生端**的东西（`reward-badge.tsx`），
    // 看板不画它；主语收窄之后那个宾语就越界了。
    // 补主语不只是措辞：写成「学生端也会坏」会让人以为这条载荷是学生可见的，而它**不是** ——
    // 载荷里有每名学生的作答状态与对错，学生房间是**全班学生**（见 `worksheetBoardRoom`）。
    isCorrect: answer.isCorrect,
    gradeState: answer.gradeState,
    score: answer.score,
    reviewedAt: answer.reviewedAt,
  });
}

/**
 * 取（或建）这个参与者在**这份学习单**上的作答会话。**整卷状态的回退就发生在下面这一行。**
 *
 * ── `WorksheetResponse.status` / `.submittedAt` 的口径 ─────────────────
 * ★ **唯一权威**。改这两列（包括在别处加第三条写入路径）之前先读这一段。
 *
 * 规格 §5.3 只规定了正向（全部题都提交 ⇒ `submittedAt = now`），**回退是本实现自定的**。
 * 之所以要把它写死在这里：D 的看板一旦开始读这两列，它就成为一份**没有任何测试能替你
 * 判断对错**的输入 —— 与其让 D 自己猜，不如把口径一次说清。
 *
 *   · 置 `submitted` + `submittedAt = now`：**只**发生在 `POST /:id/answers/submit` 里、
 *     当前 `content` 中的**每一道题**都已 `status='submitted'` 时
 *     （那一段的判定是 `total > 0 && submittedCount >= total`）。
 *   · 回退 `in-progress` + `submittedAt = null`：就是下面这条 `update` —— **任何**一次
 *     保存或提交都无条件先回退；提交路径紧接着若判定交齐，会立刻再置回 `submitted`，
 *     并写上**这一次**的时间戳。
 *
 * ⇒ 在「学生只做保存 / 提交」的世界里，这两列**恒为下列二者之一**：
 *   `submitted` + 最后一次交齐的时刻，或 `in-progress` + `null`。不存在中间态。
 *
 * ⚠️ 别被 `schema.prisma` 那句 `// not-started | in-progress | submitted` 误导：
 * `not-started` **只是 DDL 的 DEFAULT**（`services/worksheet-schema.ts` 里的建表语句），
 * **没有任何代码路径会写它** —— 本文件是全项目唯一建/改 `WorksheetResponse` 的地方，
 * 而这里 `create` 一律写 `in-progress`。所以「没有这一行」= 学生没开始，
 * 「有这一行且 `in-progress`」= 开始了。两者不是同一件事，别用 `not-started` 去表示前者。
 *
 * 🔴 **未定义的情形 —— 如实记下，没有替它编规则。** 下面三种今天**没有任何代码路径处理**，
 * 也没有测试覆盖；看板遇到其中任何一种都**不能**假定这两列仍然成立，要自己现算：
 *   ① 已交卷后教师**加题**：整卷仍是 `submitted` + **旧的** `submittedAt`，而它此刻并不
 *      覆盖新加的那道题（教师端 `PUT /:id` 只写 `Worksheet.content`，一行
 *      `WorksheetResponse` 都不碰）。
 *   ② 未交卷时教师**删题**：把没交的那道删掉之后，剩下的题其实已经全部提交，但**没有**
 *      任何路径会在改单之后重算整卷状态 ⇒ 它会一直停在 `in-progress`。
 *   ③（① 与 ② 的合意）所以 `status === 'submitted'` 的准确含义是
 *      「**最后一次由学生触发的重算**那一刻，`content` 里的题全交了」，
 *      **不是**「此刻 `content` 里的题全交了」。要后者请现算（拿 `content` 的题数与
 *      `WorksheetAnswer` 比），别信这两列。
 *
 * ⚠️ `create` 里写 `startedAt`、`update` 里**不写**，合起来就是规格要的 `startedAt ??= now`：
 * 它是「什么时候开始做的」，之后每次保存都刷一遍等于没有这个字段。
 * ⚠️ `status: 'in-progress'` 则**无条件**写：一次保存意味着这份卷子此刻正在被作答 ——
 * 整卷交过之后学生又改了一题（`allowResubmit`），它必须回到 `in-progress`。
 * ⚠️ `submittedAt: null` 与 `status` **同进同退**，不能只写一个：只拨 `status` 会持久化一行
 * `in-progress` + **上一次的交卷时间戳** —— 一对互相矛盾的字段。题级那条路径
 * （`PUT /:id/answers` 的 `update`）早就做了对偶处理（同一行的 `submittedAt: null`），
 * 整卷级漏掉它纯属不对称：规格没规定回退，但两处要么同对偶、要么同错。
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
    update: { status: 'in-progress', submittedAt: null },
  });
}

/**
 * 读自己那一份。🔴 **答案在这里被剥掉**（规格 §5.4 第一条）。
 *
 * 剥离发生在**服务端、返回之前**，且返回的是**新对象**（`stripAnswers` 不就地改）。
 * 前端过滤等同于未过滤：`content` 一旦离开这台机器，学生就能在网络面板里看到答案。
 *
 * 🔴 **这里刻意不下发这名学生已有的作答**（那是下面 `GET /:id/answers` 的事），
 * 理由有两个，第二个才是决定性的：
 *   ① 本响应体是红线用例（`worksheet-student.test.ts` 第一条）唯一看守的东西，
 *      而它守的方式是对**整串**做 `!raw.includes('answers')`。加一个叫 `answers`
 *      的顶层键会让那条钝器误报 ⇒ 逼人去把它磨细。**红线不该为新功能让路。**
 *   ② 「学生做了一半刷新后做好的题没了」要的是**客户端读回服务端已有状态**，
 *      与「题目长什么样」是两次不同用途的读取：前者每挂载一次就要拉、还会随作答变化，
 *      后者只在打开面板时拉一次。捆在一起会让这条路径的失败模式变成两件事一起失败。
 *
 * ⚠️ 曾经这里写的是另一句话：「第一批没有『断线重进接着答』的入口（本地队列就够了），
 * 多下发一份作答只会多一处需要脱敏的表」。**那个理由是错的** —— 队列只留**还没保存成功**
 * 的条目，保存成功的题在客户端一点留底都没有，所以「本地队列就够了」从来就不成立。
 * 实测与修法见 `GET /:id/answers` 的注释。
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
 * 读**自己已有的作答**（学生端面板挂载时与 `student-view` **并行**拉一次）。
 *
 * ── 为什么必须有它：「学生做了一半刷新页面后，做好的题没了」────────────────
 *
 * 🔴 成因不是数据丢了，是**从来不下发**。保存是好的 —— 那一行一直在
 * `WorksheetAnswer` 里（`PUT` 回 200 就是落库成功）；丢的是**客户端的那一份留底**：
 * 学生端的 `localStorage` 队列（`src/app/classroom/worksheet/worksheet-queue.ts`）
 * 只管**还没保存成功**的条目，服务端一 200 就立刻出队（那是规格 §8.3 要的语义）。
 * 于是「保存成功」的题在客户端**一点都不剩**，刷新即空白 ——
 * 而界面上没有任何报错，学生只会以为自己白写了，然后重敲一遍。
 *
 * ⚠️ 上面 `student-view` 那段注释里「不下发这名学生已有的作答」的**旧理由**
 * （「多下发一份作答只会多一处需要脱敏的表」）**是错的**，它把两件事混成了一件事：
 * 队列确实不需要服务端再发一份，但**屏幕**需要 —— 队列是「还没发出去的」，
 * 不是「已经发出去的」。所以这条读端点是补上后者，而不是给队列加一条旁路。
 *
 * ── 形状（规格 §8.3 的水合输入）─────────────────────────────────────────
 *
 * ```json
 * { "rows": [ { "questionId", "value", "status", "submittedAt", "isCorrect", "gradeState", "score" } ] }
 * ```
 *
 * ⚠️ 信封那个键叫 `rows`（「作答行」，本文件通篇的用词），**不叫 `answers`** ——
 * 那个词是 `ANSWER_KEYS` 里**正确答案**那个字段的名字。两个端点都被
 * 「响应里不许出现 `ANSWER_KEYS` 里的任何一个键」这条红线扫，而 `answers` 一旦成为
 * 键名，扫描器就分不清「正确答案泄漏了」与「这是作答行」。改名的代价是零，误报的代价
 * 是有人去把扫描器改松一点。
 *
 * 七件都必须在，各自对应界面上的**一件**东西（少一件就是一处静默的失灵）：
 *   · `questionId` —— 贴回哪一道题（规格 §3-P：题 id 稳定；`value` 与它配对）；
 *   · `value`      —— **学生自己写的那个值**，填回输入框（`draftFromValue` 的反向）；
 *   · `status`     —— `✓ 已提交` 芯片与顶栏进度条 «已交 N/M» 的判据；
 *   · `submittedAt`—— 交卷时间（回顾与看板的输入，与 `student-view` 同级地下发）；
 *   · `isCorrect`  —— **奖励**。D5 报告里那条 concern「刷新后奖励会消失」与本条是
 *                     同一个根因（客户端不从服务端读回已有状态），这一条把它一起解决：
 *                     星星由 `isCorrect` 现算，而它现在撑得过刷新。
 *                     ⚠️ 它仍然是 `boolean | null`：`null` 是「没判分」，
 *                     **不是**「判错」（`grade()` 对主观题回 `null`、关掉 `autoGrade` 也回 `null`）。
 *                     ⚠️ 语义已**收窄为「全对」**（规格 §12）：`false` 同时覆盖
 *                     `incorrect` 与 `partial`，所以它**推不出**下面那两个。
 *   · `gradeState` —— ★ M4a 新增：三态（`correct` / `partial` / `incorrect`）。
 *                     看板要画「½ 部分给分」（抽屉里的逐题行）、要按三态统计，都只能来自它。
 *   · `score`      —— ★ M4a 新增：这道题拿到的**绝对数**（教师逐题填的两个档之一）。
 *                     奖励显示**由得分驱动**（规格 §9），所以缺了它学生刷新后画不出奖励。
 *                     ⚠️ 旧行（M3 落的）它一直是 `null`：那时没有逐题分值，读的一侧按
 *                     `gradeState` 兜底推导（D3 处理），**不要**在这里编一个数补上。
 *
 * ── 为什么不塞进 `student-view` ─────────────────────────────────────────
 *
 * `student-view` 的红线用例（`worksheet-student.test.ts` 第一条）对**整串响应**做
 * `!raw.includes('answers')` —— 那是一件**刻意钝**的兵器：它不区分「键名」与「恰好
 * 出现的字符串」，宁可误报也不放过。往那个响应体里加一个叫 `answers` 的顶层键，
 * 就只剩两条路：把那条钝器磨细（削掉它本来就有的过度覆盖），或者给字段起一个
 * 为了绕开子串检查的名字。两条都是**为了新功能去动红线**，都不是这里该付的代价。
 * 所以作答走自己的路径：`student-view` 那个响应体**一个字节都没变**，钝器照旧。
 *
 * ── 安全（规格 §5.4）────────────────────────────────────────────────────
 *
 * 🔴 这里下发的是**学生自己写的 `value`**，**不含任何正确答案**：
 * `correctKeys` / `answers`（正确答案那个字段）/ `explanation` 都住在
 * `Worksheet.content` 的题目节点里，而本端点**根本不碰 `content`**
 * ——它只从 `WorksheetAnswer` 选上面那七列，那七列里没有一样是题的元数据。
 * ⚠️ **不要**为了「顺手」把 `content` 也带上（那会把剥离责任挪到这里，
 * 而这个端点没有 `stripAnswers`）。判据有实测：见 `worksheet-student.test.ts`
 * 第 ⑦ 节的三条（键名级递归扫描 + 原文级子串 + 正确/错误答案的阳性对照）。
 *
 * ⚠️ 返回**空数组**而不是 404：没开始作答是**合法状态**（一份新卷子就是这样）。
 * ⚠️ 读路径**不建**任何行：`requireOwnWorksheet` 只查不写，这里也只 `findMany`
 * ——顺手建一个 `WorksheetResponse` 会让教师看板把一个什么都没做的学生
 * 显示成「已开始作答」，而这条路径只是打开面板而已。
 */
router.get('/:id/answers', async (req, res) => {
  try {
    const ctx = await requireOwnWorksheet(req, res);
    if (!ctx) return;

    const rows = await ctx.prisma.worksheetAnswer.findMany({
      // 三件一起收窄：只有**这一间课堂 × 这一份学习单 × 这一个参与者**的行。
      // 与 `PUT` 里那条 `allowResubmit` 的查询同一个嵌套形状（同一份判据，两处一致）。
      where: {
        response: {
          classroomId: ctx.classroomId,
          worksheetId: ctx.worksheet.id,
          participantId: ctx.participantId,
        },
      },
      // ⚠️ `isCorrect` **在，且只增不改**；`gradeState` / `score` 是 B1 新增的（规格 §12）。
      select: {
        questionId: true, value: true, status: true, submittedAt: true,
        isCorrect: true, gradeState: true, score: true,
      },
      // 顺序无关（前端按 `questionId` 配对），但固定下来让响应可比对 ——
      // 用例里的 `deepEqual` 与人工排障都因此少一处「这次顺序为什么不一样」。
      orderBy: { questionId: 'asc' },
    });

    // ⚠️ **不按当前 `content` 过滤**：教师删掉一道题之后，留给它的那行答案照样发回去。
    // 前端只画 `content` 里的题，多出来的键落不到屏幕上；而在这里过滤等于把
    // 「这一题还在不在」这条判据抄第二遍 —— 抄错的表现是**学生的作答静默消失**。
    //
    // ⚠️ `value` 为 SQL NULL（学生把这题清空了）时它读出来就是 `null`，
    // 前端按「清空」处置（`draftFromValue(null)` ⇒ 空草稿），与队列里的 `null` 同义。
    res.json({ rows });
  } catch (error) {
    console.error('[worksheets] 读取学生作答失败:', error);
    res.status(500).json({ error: '读取作答失败' });
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

    // ★ M4b：笔迹的**体积校验**排在**所有落库动作之前** —— 与下面那条 409 同一条纪律
    // （「被拒的保存不留任何痕迹」：`ensureResponse` 会建作答会话、会把整卷的状态拨回去）。
    // 🔴 不排在这里的后果：一个超限的值把学生的整卷从 `submitted` 拨回 `in-progress`，
    // 然后这一条又被 400 拒掉 —— 教师看板上那次交卷**凭空消失**。
    //
    // ⚠️ **只挂在 PUT 上**：
    //   · 不挂 `submit` —— 值是上一次 PUT 存进来的，提交路径读的是库里那一份
    //     （`worksheetAnswer.findFirst` 的 `value`）⇒ 再校验一次不增加安全性，
    //     只多一处会与这里分叉的判据；
    //   · 不挂读端点（`GET /:id/answers` / `student-view`）—— 挡在读的一侧等于让一个
    //     已经存在的超限值**永远读不回来**（学生的画在屏幕上消失）。
    //
    // ⚠️ 它**不是格式门**：`findInkValueError` 对认不出的 `format` 一律放行（认得出才查体积）。
    // 往这里加一句「认不出的 `format` ⇒ 400」是**另一件事**，会违反
    // `worksheet-answer-value.ts:48-76`（那段「`format` 在服务端只被读两处」）那条纪律 —— 见 `services/worksheet-ink.ts` 的 🔴。
    const inkError = findInkValueError(body.value);
    if (inkError) return res.status(400).json({ error: inkError });

    // ★ M5a：课堂级「锁定作答」—— 保存被拒，**交卷仍然放行**（规格 §3.2 / 裁定 ③）。
    //
    // 🔴 判据排在**所有落库动作之前**（与上面那条体积校验、下面那条 409 同一条纪律）：
    // `ensureResponse` 的 `update` 支是**无条件**的（`status:'in-progress', submittedAt:null`）
    // ⇒ 排在它之后判，被拒的保存会先把整卷从 `submitted` 拨回 `in-progress`，
    // 教师看板上那次交卷**凭空消失**（GC 22）。
    //
    // 🔴 状态码 **409** 与一个**机器可读**的 `code`：本文件里 409 已经表示「当前状态不允许这个操作」，
    // 而客户端必须能把它与下面那条 `allowResubmit` 的 409 **分开** —— 那条**只有中文文案**，
    // 靠文案判会在改文案时静默失效（后果：离线队列把学生的作答当永久失败**丢掉**，GC 21）。
    //
    // ⚠️ **只挂在 PUT 上**，`submit` 那条路径不判 —— 与上面那条体积校验逐字同源的理由：
    // 交卷读的是库里已经存住的那份，而「保存」已经被这里拦住了 ⇒ 再判一次不改变结果，
    // 只多一处会与这里**分叉**的判据（规格 §3.2 的「一处判据、两条路径」= 判据只有一份，
    // 不是「在两个端点各写一遍」）。`submit` 那边有一句注释说明它为什么故意不判。
    if (ctx.answersLocked) {
      return res.status(409).json({ error: '老师已锁定作答', code: 'answers-locked' });
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
      //
      // 🔴 **`gradeState` 与 `score` 必须跟着一起清**（B1）。它们是同一次判分的另外两个
      // 面，只清 `isCorrect` 会让这一行变成「没判对、但有态有分」的自相矛盾形状：
      // 学生端会照 `score` 画出一个**库里已经不成立**的奖励，而看板照 `gradeState` 画一个 ✓/½/✗。
      // 三列一起清是唯一的自洽写法 —— 这与 `use-worksheet-answers.ts:327` 那条
      // 「得分必须跟着清」是同一件事的两端。
      update: {
        value: toJsonValue(body.value),
        status: 'draft',
        submittedAt: null,
        isCorrect: null,
        gradeState: null,
        score: null,
      },
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
 * 提交单题。🔴 **判分在这里做**（规格 §5.4 第二条）：服务端算，前端只拿判分结果。
 *
 * ⚠️ 这里曾经写着「按 §3-S **不返回 `score`** —— 分值一旦下发就有人拿它做统计，
 * 而它可由 `isCorrect` 推导」。**那句话已经作废，两句都不成立**（规格 §12 明写
 * M4 重开了 §3-S）：
 *   · 三态之后 `score` **不再可由 `isCorrect` 推导** —— `isCorrect=false` 同时覆盖
 *     `incorrect` 与 `partial`，而这两者对应的 `score` 是 0 与「部分给分那个数」（可以是 0，
 *     也可以是教师填的 2），同一个 `false` 底下有两个不同的数；
 *   · §3-S 那条「不下发」的理由（怕人拿它做统计）也被 M4 一起推翻了：奖励显示现在
 *     **由得分驱动**（规格 §9），不下发 `score` 恰恰等于学生端画不出奖励。
 * 所以现在返回 `{ isCorrect, gradeState, score }`。
 */
router.post('/:id/answers/submit', async (req, res) => {
  try {
    const ctx = await requireOwnWorksheet(req, res);
    if (!ctx) return;

    // ★ M5a：`answersLocked` **不拦这里** —— 裁定 ③ 是「停笔，但还能交卷」。
    // 交卷读的是库里已经存住的那份（下面那条 `worksheetAnswer.findFirst`），
    // 而「保存」已经在 PUT 上被拦住了 ⇒ 锁定之后交上去的一定是锁定前的最后一份。
    //
    // ⚠️ 判据**不在这里**再写一遍：那会变成第二个会与 PUT 分叉的门（同 `findInkValueError`
    // 只挂 PUT 那条纪律）。要改锁的语义，改 PUT 上那一处 ——
    // 🔴 本注释**刻意带上 `answersLocked` 这个标识符**（而不是只说「锁定作答」）：
    // 这样 `grep -n answersLocked server/src/routes/worksheets.ts` 会同时命中医处与这里，
    // 「改语义时不会静默漏掉第二处」才是真的。中文注释命不中标识符 grep。

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
    // 🔴 **`points` 只许来自这一行**（规格 §12 裁定 4 / 5：逐题优先，留空回落学习单级）。
    // 别在调用点手拼 `{ full: 2, half: 1 }`，也别写 `node.points ?? pointsFromSettings(...)`
    // —— 手拼出来的东西**没有任何东西会拦**：实测 `{full: NaN}` ⇒ `grade()` 回
    // `score: NaN`（`isCorrect` 还是对的，所以界面上只表现为分数是 `NaN`），
    // `{full: -5}` ⇒ `score: -5`（学生的奖励累计变成负数）。今天安全**仅因为**
    // 唯一的生产调用点照抄了 `resolvePoints` —— 它同时负责 `normalizePoints` 的
    // 坏形状回落，那是手拼拿不到的。
    const points = resolvePoints(node, pointsFromSettings(ctx.worksheet.settings));
    // ⚠️ 关掉自动判分是「**不判**」（`null`），不是「判错」（`false`）—— 两者在学生端
    // 与看板上是完全不同的两种显示。`grade()` 对主观题同样返回 `null`（§5.6）。
    // ⇒ `verdict === null` 与 `verdict.state === 'incorrect'` 是**两件事**：
    // 前者界面上画不出奖励，后者画 0。
    const verdict = autoGrade ? grade(node, answer.value, points) : null;
    // ★ `isCorrect` 的语义**收窄为「全对」**（规格 §12「得分与正确率的口径」），
    // 由 `verdict.state` 派生 —— 它**不再是第二真相源**。⚠️ 但**字段名一个字符都不许改**：
    // 它是协议字段，而**只靠它读得出来的行还在**（A1 的回填只补了 `gradeState`，
    // `score` 刻意留 null —— 旧行没有逐题分值，写死任何一个数都是编的）。
    // ⇒ 改名 ⇒ **未回填的行同时丢奖励与丢标记**，而两处都不报错：
    //   · 学生端 `worksheet-queue.ts` 的 `scoreFromWire(row)`：`score` 不是数时用它折出奖励；
    //   · 教师端 `worksheet-drawer-state.ts` 的 `rowVerdict(row)`：`gradeState` 为 null 时用它折出 ✓/✗。
    // ⚠️ 哨兵用例：`worksheet-realtime.test.ts` 里那条「广播体仍然含 `isCorrect`」。
    // ⊘ 2026-09-24 更正：这里原先给的理由是「改名 ⇒ `scoreFromWire` 回 `null` ⇒ 不画奖励」。
    // 那句在 D1+D2 改了入参（收**整行**而不是一个布尔）、D3 把 `score` 提为第一优先级之后
    // **已经不成立**（新行有 `score`，兜底那两行根本走不到）。理由换成了上面那条**旧行**的理由 ——
    // 「不许改名」这个结论没变，因为它从来不只是关于奖励的。
    const isCorrect = verdict ? verdict.state === 'correct' : null;
    const gradeState = verdict ? verdict.state : null;
    // ⚠️ `score` 与 `gradeState` **同生共死**：`verdict` 为 null 时两个都是 null。
    // 只写一个会让读的一侧在「有分无态」与「有态无分」之间猜（D3 的兜底就是按
    // 「`score` 是 null 才回落到 `gradeState` 推导」写的）。
    const score = verdict ? verdict.score : null;

    const updated = await ctx.prisma.worksheetAnswer.update({
      where: { responseId_questionId: { responseId: response.id, questionId } },
      data: { status: 'submitted', submittedAt: now, isCorrect, gradeState, score },
    });

    // 整卷进度：当前 content 里的每一题都 `submitted` 才算交卷。
    // ⚠️ 只数**还在 content 里的**题：教师删掉一道题之后，库里留给它的那行答案
    // 不该让整卷永远交不了（改单只警告不拦，规格 §3-J）。
    const submitted = await ctx.prisma.worksheetAnswer.findMany({
      where: { responseId: response.id, status: 'submitted' },
      select: { questionId: true },
    });
    // 🔴 **任务不进这个分母**：它在 `WorksheetAnswer` 里永远没有对应的行，
    // 被算进来 ⇒ `submittedCount >= total` 恒假 ⇒ **整卷永远交不了卷**，
    // 而学生明明每道小题都交了、教师看板上的「全部交齐」永不出现，**没有任何报错**。
    // ⚠️ 入参是**顶层 nodes**，不是 `flattenQuestions` 的返回值：后者吐出来的节点**还带着
    // `children`**，再喂给 `flattenAnswerable` 会把小题数两遍。
    const inContent = new Set(
      flattenAnswerable((ctx.worksheet.content as unknown as WorksheetContent).nodes ?? [])
        .map((item) => item.node.id),
    );
    const total = inContent.size;
    const submittedCount = submitted.filter(row => inContent.has(row.questionId)).length;
    if (total > 0 && submittedCount >= total) {
      // ⚠️ 这是**全项目唯一**把整卷置为 `submitted` 的地方（回退在 `ensureResponse`）。
      // 这两列的口径与三种**未定义**情形写在 `ensureResponse` 的注释里，改这里之前先读那一段。
      await ctx.prisma.worksheetResponse.update({
        where: { id: response.id },
        data: { status: 'submitted', submittedAt: now },
      });
    }

    // 规格 §5.7 的第 ③ 步。⚠️ 这里带上 `isCorrect`：看板抽屉的逐题 ✓/✗ 只能来自这条广播
    // （§7.4：不做按需推流）。整卷状态那一次 `update` **不**单独广播 —— 它没有新的
    // questionId 可带，而看板的「已交 N/M」由逐题广播累加即可。
    broadcastAnswerUpdate(req, ctx, updated);
    // ⚠️ `isCorrect` **在**，且**只增不改**（见上面那段注释）。`gradeState` / `score`
    // 是 B1 新增的两个字段。
    // ⊘ 2026-09-24 更正：这里原先写「前端今天只读 `isCorrect`，改读的那一步在 D3/E1」——
    // 那一步**早就做完了**：学生端读 `score`（奖励，`worksheet-queue.ts` 的 `scoreFromWire`）、
    // 看板读 `gradeState`（✓ / ½ / ✗，`worksheet-drawer-state.ts` 的 `rowVerdict`）；
    // `isCorrect` 今天只在**未回填的旧行**上兜底。它仍不许改名，但理由换了（见 `rowVerdict`）。
    res.json({ isCorrect, gradeState, score });
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
    // ⚠️ 数的是**可作答的题**，任务不算 —— 否则每有一个任务，列表上就多报一道题。
    return flattenAnswerable((content as WorksheetContent).nodes ?? []).length;
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
