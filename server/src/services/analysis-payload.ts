import { INK_DEFAULT_TEXT_SIZE, INK_STROKE_COLOR, isInkColor, isInkFormat, isInkShapeKind, isInkTextSize, type InkValue } from './ink-path.js';
import { CHAT_IMAGE_URL } from './worksheet-ink.js';
import { analysisAnswerText } from './analysis-question.js';
import type { QuestionNode } from './worksheet-questions.js';

/**
 * ★ M7a：载荷的**判据层**。**纯函数、不碰 sharp、不碰网络、不读库。**
 *
 * 与 `analysis-render.ts` 的分界线是「有没有碰 sharp」—— 同 `ink-path.ts` / `ink-render.ts`
 * 那条既有纪律（见 `ink-render.ts:8-14`）。
 *
 * ⚠️ 本文件**不能**承载闸门（`isAnalyzableType`）：它 import 了 `./ink-path.js`，
 * 而跨工程对拍用例跑在前端 runner 里、Node 不把 `.js` 解析成 `.ts` ⇒ 闸门住在
 * 零 import 的 `analysis-gate.ts` 里。**不要为了「少一个文件」把它们合并。**
 */

/** 服务端读到的作答行（`WorksheetAnswer` 的一行，已 select 出需要的那几列）。 */
export interface RawAnswer {
  participantId: string;
  questionId: string;
  status: string;
  value: unknown;
  /** 服务端已经算好的判分结论；分析链路只展示，绝不在这里重新判分。 */
  gradeState?: 'correct' | 'partial' | 'incorrect' | null;
  /**
   * 定稿时刻（ISO 串）。**只有「陈旧判定」读它** —— `selectAnalyzeEntries` 不看。
   *
   * ⚠️ 它**不是** `WorksheetResponse.submittedAt`（那是「整卷」的时间戳）。
   * 拿整卷的去比，会让「有人交了**别的**题」也算成这份分析过期 ——
   * 而假提示会训练教师忽略真提示，比没有提示更坏。
   */
  submittedAt?: string | null;
}

/** 一个参与者（`ClassroomStudent` 一行 —— 分组 / 高级模式下是**组**）。 */
export interface Participant {
  participantId: string;
  name: string;
  /**
   * ★ 2026-10-07（教师：联系表标签改用「姓名 + 学号」）—— 标签里的那个**尾号**。
   *
   * 🔴 它**不是** `Student.studentNo` 的副本：名册装载那一侧已经做过回落
   * （`analysisLabelNo`），这里拿到的就是**要印在图上**的那个尾号。
   * `null` = 不加尾号（组）。
   */
  labelNo: string | null;
}

/**
 * ★ 2026-10-07：一个参与者**要印在联系表 / 文档上的尾号**（`张伟#7` 里那个 `7`）。
 *
 * · 有学号 ⇒ 学号。姓名区分度高，学号挡**重名**；
 * · 学生没有学号 ⇒ **id 末四位**。🔴 不能只留姓名：一个班里两个「张伟」会让模型认错人，
 *   而那正是这次换标签要消掉的失败（分为此会**静默**贴到另一个人头上）。
 *   末四位不好看，但它对得起「唯一」这条硬要求；
 * · 组 ⇒ `null`：组名本身已经是标识（教师取的），加个尾号只会让它更长更难读。
 *
 * ⚠️ 判据是「**有没有学生行**」（`isGroup`），不是「有没有组」—— `ClassroomStudent.type`
 *    历史上可能没跟上（参与者迁移过），而 `student` 关系在不在是事实。
 */
export function analysisLabelNo(
  participant: { participantId: string; studentNo?: string | null },
  isGroup = false,
): string | null {
  const no = typeof participant.studentNo === 'string' ? participant.studentNo.trim() : '';
  if (no) return no;
  return isGroup ? null : participant.participantId.slice(-4);
}

/** 一个参与者在**这一份载荷里**的标签（`张伟#7`）。纯函数。 */
export function participantLabel(participant: Participant): string {
  const no = typeof participant.labelNo === 'string' ? participant.labelNo.trim() : '';
  return no ? `${participant.name}#${no}` : participant.name;
}

/**
 * 进载荷的一条作答。
 *
 * `kind: 'unknown'` 是**刻意存在**的：库里可能有本版认不出的形状（题型被改过、行被手改过）。
 * 静默过滤掉它们的后果是 `coveredCount` 说 12 而文档里只有 8 段 —— 两边对不上且不报错。
 * ⇒ 认不出就以 `'unknown'` 留在载荷里，由文档 / 格子**说一句实话**。
 */
export interface AnalyzeEntry {
  studentId: string;
  kind: 'text' | 'ink' | 'photo' | 'unknown';
  text?: string;
  ink?: InkValue;
  photoUrl?: string;
  gradeState?: 'correct' | 'partial' | 'incorrect' | null;
  // 🔴 **这里刻意没有 `displayName`。**
  // 原先有，而它**只写不读**：标签由 `payloadLabels` 从**名册**派生（★ 2026-10-07 起；
  // 在那之前是按 `studentId` 的序派生的伪名），真名一次都没从这个字段显示过（独立审查 M3）。
  // 它却被写进了 `aggregate`，于是库里多一份**用不上的真名副本** ——
  // 而将来那道缝若图省事从 `aggregate` 取数发出去，真名会跟着走。少一份这种副本，
  // 就少一处将来要审的地方。
  // ⚠️ ★ 2026-10-07 之后**这条理由更强了**：标签本身就是「姓名 + 学号」，
  //    再往 `aggregate` 里存一份姓名的意义已经为零，而多存一份就多一处要审的地方。
}

/** 从作答值里认出文字。`text/v1` 是本仓问答题的格式（`WorksheetAnswerValue`）。 */
function readText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.format !== 'text/v1') return null;
  return typeof raw.text === 'string' ? raw.text : '';
}

// ★ 2026-10-06：URL 形状搬到 `worksheet-ink.ts`（报告/导出那一侧也要读同一份）。
//    两份正则正是本仓反复被咬的那种分叉 —— 一处放宽、另一处没跟上，就会有人
//    把任意路径喂进 `resolveLocalPath`。


/** 从作答值中识别本站上传的照片，拒绝把任意本地路径带进后续文件读取。 */
function readPhoto(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.format !== 'photo/v1') return null;
  return typeof raw.url === 'string' && CHAT_IMAGE_URL.test(raw.url) ? raw.url : null;
}

/**
 * ★ 2026-10-06：第三方画板交上来的**位图**（`drawing.image`）。
 *
 * 🔴 为什么必须有它：新画板把内容放在 `drawing.data` 里（流程图/思维导图/数学作图/
 *    基础绘图都不再产 `strokes`），而服务端**渲染不了**那些文档。
 *    ⇒ 少了这一支，`readInk` 会以「0 根笔画」把整条作答吃掉：联系表里那一格是空的，
 *      而且 `payloadKindOf` 见 `kind === 'ink'` 就判 `'image'` ⇒ **连文字文档都不发**，
 *      模型只看到一叠空格子（实测：`drawing` 字段被 `readInk` 整个丢掉）。
 * ⚠️ 读出来当成 **photo** 条目：联系表那条合成照片的路是现成的、实测能出图。
 */
function readDrawingRaster(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!isInkFormat(raw.format)) return null;
  const drawing = raw.drawing;
  if (!drawing || typeof drawing !== 'object' || Array.isArray(drawing)) return null;
  const image = (drawing as Record<string, unknown>).image;
  return typeof image === 'string' && CHAT_IMAGE_URL.test(image) ? image : null;
}

/**
 * 从作答值里认出笔迹。判据是 `format`（与 `judge()` 同一条：判据是格式，不是题型）。
 *
 * 🔴 形状坏掉时回 `null`（⇒ 调用方落成 `unknown`）而不是把坏值当笔迹带走：
 * 带着一个 `canvas.w = 'x'` 的值往下走，会在**渲染那一步**才炸，而那时
 * 整条链路已经 500、教师只看到「分析失败」四个字。
 */
function readInk(value: unknown): InkValue | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!isInkFormat(raw.format)) return null;
  const canvas = raw.canvas as { w?: unknown; h?: unknown } | undefined;
  if (!canvas || typeof canvas.w !== 'number' || typeof canvas.h !== 'number') return null;
  if (!Number.isFinite(canvas.w) || !Number.isFinite(canvas.h)) return null;
  if (!Array.isArray(raw.strokes)) return null;
  const strokes = readStrokes(raw.strokes);
  // ★ 2026-09-30 第二轮：文字也要透传（与 `shape` 同一条纪律 —— 本文件是**第四份读入器**，
  // 不在跨工程对拍网里，而它吞掉字段的后果是「AI 与学生/教师看到的不是同一个东西」）。
  const texts = readTexts(raw.texts);
  // ⚠️ 一条笔画都不剩时仍然算 ink（`hasInk` 会为假、那一格写「空白」）——
  // 回 `null` 会让它落成 `unknown`，而「画了但一条有效笔画都没有」与「认不出形状」不是一回事。
  // ⚠️ `texts` **没有就不带那个键**（与前端 `readInkValue` 同一条口径：
  //    老值原样，不是凭空多一个空数组）。
  const ink: InkValue = { format: raw.format, canvas: { w: canvas.w, h: canvas.h }, strokes };
  if (texts.length > 0) ink.texts = texts;
  return ink;
}

/** 夹到 `0..1`。与 `src/lib/worksheet-ink.ts` 的 `clamp01` 同一口径。 */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * 🔴 **在读的一侧把坐标夹到 `0..1`、把坏点丢掉** —— 与 `src/lib/worksheet-ink.ts` 的
 * `readPoint` 同一条纪律（`worksheet-ink.ts:100-101` 逐字写着「那边把越界的数**夹到 `0..1`**，
 * 这里**不夹**……夹取是**读**的一侧的事」）。
 *
 * ⚠️ 为什么这件事在这里很重要：`toPixel` 是纯乘法（`x * box.w`，**不夹**），
 * 而联系表把每一格 `translate` 到自己的框里 ⇒ 一个 `x: -0.5` 的点会被画到**左边那一格**
 * （相邻参与者）去，看起来就是那个人画的。**跨人错位，且不报错。**
 *
 * 而 `src/lib/worksheet-ink.ts` 的 `readPoint` 只保护**学生端画布 / 教师抽屉 / M6a 导出**
 * 那几条路 —— 本批的联系表是**新的一条**，它必须自己走同一口径。
 * （写入口刻意**不拒**越界数：`worksheet-ink.ts:99` 写着「越界不是拒绝的理由」。）
 * ⚠️ 本文件是笔迹的**第四份读入器**：`readStrokes` **自己在重建每一笔** ⇒
 * **不被跨工程对拍网盯着**（对拍盯的是 `ink-path.ts` 那一份），加字段时最容易漏的就是这里。
 * ⊘ 2026-09-30（复审）：这里原来还写着「它不 import `ink-path.ts`」—— **那是假的**，
 *   本文件第 1 行就引着它。理由写错比不写更糟：下一个人会照着一个假的理由去办。
 */
/**
 * ★ 第二轮：读文字（`readStrokes` 的姊妹）。**坏形状整段丢掉** —— 与「坏点丢整笔」同一条。
 * ⚠️ 这里**故意不引 `ink-path.ts` 的 `readText`**（那个是私有函数）⇒ 规则与前端
 *    `worksheet-ink.ts` 的 `readText` **必须逐字相同**：`text` 非空、`at` 是合法二元点；
 *    `color` / `size` 坏掉**回落默认**（样式坏不丢几何）。
 */
function readTexts(raw: unknown): Array<{ text: string; at: [number, number]; color: string; size: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ text: string; at: [number, number]; color: string; size: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.text !== 'string' || row.text === '') continue;
    const at = row.at;
    if (!Array.isArray(at) || at.length !== 2) continue;
    const [x, y] = at;
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      text: row.text,
      at: [clamp01(x), clamp01(y)],
      color: isInkColor(row.color) ? row.color : INK_STROKE_COLOR,
      size: isInkTextSize(row.size) ? row.size : INK_DEFAULT_TEXT_SIZE,
    });
  }
  return out;
}

function readStrokes(raw: unknown[]): InkValue['strokes'] {
  const out: InkValue['strokes'] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const stroke = item as Record<string, unknown>;
    if (!Array.isArray(stroke.points)) continue;
    const points: Array<[number, number]> = [];
    for (const point of stroke.points) {
      if (!Array.isArray(point) || point.length !== 2) continue;
      const [x, y] = point;
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push([clamp01(x), clamp01(y)]);
    }
    if (points.length === 0) continue;
    // ★ 2026-09-30：`shape` 必须**透传**，与前端 `readInkValue` 同一条纪律。
    // 🔴 这一层是**第四份读入器**：它**自己在重建每一笔**，所以**不被跨工程对拍网盯着**
  //    （对拍盯的是 `ink-path.ts` 那一份）——
    //    吞掉 `shape` 的后果是 **AI 看到的图与教师看到的不是同一个东西**，两边都不报错。
    // ⚠️ 「认不出的形状」⇒ **丢掉整笔**（不是静默当手写）：与前端同一把尺子。
    // 🔴 形状表用 `ink-path.ts` 那一个（本文件**本来就引着它**）—— 不在这里再抄一份。
    //    抄一份就是「同一个事实多份拷贝」，而这一整轮收的正是那笔账。
    const shape = stroke.shape;
    if (shape !== undefined && !isInkShapeKind(shape)) continue;
    const next: InkValue['strokes'][number] = {
      points,
      width: typeof stroke.width === 'number' && Number.isFinite(stroke.width) ? stroke.width : 0,
      color: typeof stroke.color === 'string' ? stroke.color : '',
    };
    if (isInkShapeKind(shape)) next.shape = shape;
    out.push(next);
  }
  return out;
}

/**
 * 谁进载荷。
 *
 * 三条判据：① 是这一道题；② `status === 'submitted'`（只分析**定稿**的答案 ——
 * 设计文档 §8.4 `:742` 逐字写着逐题提交就是为了这件事）；③ 参与者名单里查得到。
 * **顺序按 `studentId` 升序**：模型会说「第 3 格」「上面第 5 条」，顺序不确定就映射不回去。
 */
export function selectAnalyzeEntries(
  answers: RawAnswer[],
  participants: Participant[],
  questionId: string,
  question?: QuestionNode,
): AnalyzeEntry[] {
  // 参与者名单仍然要 —— 它挡的是「库里有一行谁的名单里都没有的作答」（脏数据）。
  const known = new Set(participants.map((p) => p.participantId));
  const out: AnalyzeEntry[] = [];
  for (const answer of answers) {
    if (answer.questionId !== questionId) continue;
    if (answer.status !== 'submitted') continue;
    if (!known.has(answer.participantId)) continue;
    const text = readText(answer.value);
    if (text !== null) {
      out.push({ studentId: answer.participantId, kind: 'text', text, gradeState: answer.gradeState ?? null });
      continue;
    }
    // ⚠️ 位图排在笔迹**前面**：新画板的作答 `strokes` 是空数组，`readInk` 照样认它
    //    （那条纪律写在 `readInk` 上：「一条笔画都不剩时仍然算 ink」）⇒ 排在后面就永远轮不到。
    const raster = readDrawingRaster(answer.value);
    if (raster) {
      out.push({ studentId: answer.participantId, kind: 'photo', photoUrl: raster, gradeState: answer.gradeState ?? null });
      continue;
    }
    const ink = readInk(answer.value);
    if (ink) {
      out.push({ studentId: answer.participantId, kind: 'ink', ink, gradeState: answer.gradeState ?? null });
      continue;
    }
    const photoUrl = readPhoto(answer.value);
    if (photoUrl) {
      out.push({ studentId: answer.participantId, kind: 'photo', photoUrl, gradeState: answer.gradeState ?? null });
      continue;
    }
    // 客观题的值不是 text/v1：在这里按题型把 key/id 转成选项文字、条目文字与关系。
    const described = question ? analysisAnswerText(question, answer.value) : null;
    if (described !== null) {
      out.push({ studentId: answer.participantId, kind: 'text', text: described, gradeState: answer.gradeState ?? null });
      continue;
    }
    out.push({ studentId: answer.participantId, kind: 'unknown', gradeState: answer.gradeState ?? null });
  }
  return out.sort((a, b) => (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0));
}

/**
 * 载荷形态。**由实际作答值的格式决定，不由题型决定** —— 一道问答题可能「之前键盘作答、
 * 之后改成手写」，学生那份已经交上来的 `text` 值仍然在库里（`judge()` 在
 * `worksheet-questions.ts:889` 逐字记着这个场景）。
 *
 * 全 `unknown` 或空时回 `'text'`：那种情况下至少给一份**能把话说出来**的文档，
 * 而不是一张空格子图（教师看不懂一张没有画的联系表）。
 */
export function payloadKindOf(entries: AnalyzeEntry[]): 'text' | 'image' | 'mixed' {
  let hasText = false;
  let hasInk = false;
  for (const entry of entries) {
    if (entry.kind === 'text') hasText = true;
    else if (entry.kind === 'ink' || entry.kind === 'photo') hasInk = true;
  }
  if (hasText && hasInk) return 'mixed';
  return hasInk ? 'image' : 'text';
}

/* ── 文字类的聚合文档 ─────────────────────────────────────────────────── */

/**
 * 一份答案里最多带出多少个字。
 *
 * 🔴 **超长的必须截断、且必须说出来。** 学生完全可能粘一整篇作文进来；原样带出的后果是
 * 这份文档被一条答案撑爆（它将来要发给 AI，token 是按字算的），而**看不出来是被谁撑的**。
 * 悄悄砍掉前半/后半更坏：教师与模型都会把残句当成完整的答案来读。
 */
export const ANSWER_TEXT_MAX = 800;

/**
 * 一道题在界面上的位置信息。
 *
 * ★ 2026-09-25：`index: number`（0-based 拍平题序）换成 **`heading: string`**（两级题号，
 * `任务一 · 3`；没有任务前缀时就是 `3`）。
 *
 * 🔴 换的理由不只是显示：拍平序把**任务节点也算了一号** ⇒ 任务一旦在树里，抬头印出来的
 * 「第 N 题」就比教师看板上那一列大 —— 而**载荷里看不出来它是错的**（它只是个数字）。
 * 两级题号与看板、抽屉、导出、学生端**同一份**（`services/worksheet-heading.ts` 的
 * `flattenAnswerable`，对拍用例钉着与前端逐字相同）。
 */
export interface QuestionMeta {
  questionId: string;
  typeLabel: string;
  prompt: string;
  heading: string;
  /** 选项、待排序条目、左右栏、分类框等题干之外的材料。 */
  details?: string;
  /** 已按题型翻译成人类可读文字的参考答案/评价要求。 */
  referenceAnswer?: string;
  /** 教师补充的主观题评分标准与示例图片。 */
  rubricText?: string;
  rubricImageUrl?: string | null;
  /**
   * ★ 2026-10-06：这道绘图题有没有教师预先给出的「初始图」（判据在 `analysis-question.ts` 的
   * `hasDrawingStarter`，与前端 `readDrawingStarter` 同一把尺子）。
   *
   * 🔴 它决定提示词里要不要加 `DRAWING_STARTER_NOTE` 那一句：初始图**不算**学生的作答，
   *    而位图快照是**完整那张图**（含教师画的内容）—— 不说这一句，模型会把教师给的框与连线
   *    算成学生的成果。
   * ⚠️ **可选**：这是后加的字段，题面字面量（用例、老调用点）缺省即「没有初始图」。
   */
  drawingStarter?: boolean;
  /** 主观题可选的 AI 评分设置；未开启时仍把配置明确带到载荷中。 */
  aiScoring?: { enabled: boolean; maxScore: number; unit: string; criteria: string; parts?: Array<{ index: number; maxScore: number }> };
}

/** 超长就截断并附一句说明。 */
function truncate(text: string): string {
  if (text.length <= ANSWER_TEXT_MAX) return text;
  return `${text.slice(0, ANSWER_TEXT_MAX)}\n（已截断：原文共 ${text.length} 字，只带出前 ${ANSWER_TEXT_MAX} 字）`;
}

function gradeLabel(state: AnalyzeEntry['gradeState']): string | null {
  if (state === 'correct') return '全对';
  if (state === 'partial') return '部分正确';
  if (state === 'incorrect') return '答错';
  return null;
}

function localStatsOf(entries: AnalyzeEntry[]): { correct: number; partial: number; incorrect: number; ungraded: number } {
  let correct = 0;
  let partial = 0;
  let incorrect = 0;
  let ungraded = 0;
  for (const entry of entries) {
    if (entry.gradeState === 'correct') correct += 1;
    else if (entry.gradeState === 'partial') partial += 1;
    else if (entry.gradeState === 'incorrect') incorrect += 1;
    else ungraded += 1;
  }
  return { correct, partial, incorrect, ungraded };
}

function localStatsLine(entries: AnalyzeEntry[]): string {
  const stats = localStatsOf(entries);
  if (stats.correct + stats.partial + stats.incorrect === 0) return `本地统计：${stats.ungraded} 份作答未自动判分`;
  const parts = [`全对 ${stats.correct}`, `部分正确 ${stats.partial}`, `答错 ${stats.incorrect}`];
  if (stats.ungraded > 0) parts.push(`未自动判分 ${stats.ungraded}`);
  return `本地统计：${parts.join('；')}`;
}

/**
 * 文字类的聚合文档。**纯字符串拼装**，发出去的就是它。
 *
 * ⚠️ **上线的是 `labels` 给的标签**。★ 2026-10-07（教师裁定）：标签从「`User_00X` 伪名」
 * 改成「**姓名 + 学号**」（`张伟#7`）—— 教师明确接受「真名发给第三方」这个代价，
 * 理由是伪名只差最后一位、模型读图会看串，而看串的后果是**分数静默贴到别人头上**。
 * （同一次决定的另一半：图里学生自己写的名字也不遮盖，见 `analysis-render.ts`。）
 * `labels` 由调用方给（本函数是纯函数，不生成标签）；
 * 缺标签时**回落成参与者 id** 而不是留空：留空的后果是那一整段没有归属。
 *
 * ⚠️ 抬头里的 `covered / total` 是**防假绿**用的：载荷只覆盖了一部分人，
 * 而一份没有分母的名单会被读成「全班就这些人」。零份作答时 `covered` 是 0，
 * 那句话必须照发（**不是空文档**）—— 教师点开时看到「已交 0/40 · 尚无已提交的作答」
 * 才是对的反馈，一份空文档看起来像「功能坏了」。
 */
export function buildTextDocument(
  question: QuestionMeta, entries: AnalyzeEntry[], labels: Map<string, string>,
  covered: number, total: number,
): string {
  const head = [
    `${question.heading} · ${question.typeLabel}`,
    `题干：${question.prompt || '（题干为空）'}`,
    `题目材料：${question.details || '（没有额外题面材料）'}`,
    `参考答案：${question.referenceAnswer || '（未提供参考答案）'}`,
    `评分标准：${question.rubricText || '（未提供评分标准）'}`,
    `评分标准图片：${question.rubricImageUrl ? '已作为图片附件提供' : '（未提供）'}`,
    `已交 ${covered}/${total}`,
    localStatsLine(entries),
  ].join('\n');
  if (entries.length === 0) return `${head}\n\n尚无已提交的作答。\n`;
  const body = entries.map((entry) => {
    const who = labels.get(entry.studentId) ?? entry.studentId;
    const verdict = gradeLabel(entry.gradeState);
    const label = verdict ? `${who}｜${verdict}` : who;
    if (entry.kind === 'unknown') return `【${label}】（这一份的形状本版认不出，未纳入）`;
    if (entry.kind === 'photo') return `【${label}】（照片作答，见联系表）`;
    const raw = entry.text ?? '';
    if (raw.trim() === '') return `【${label}】（空白）`;
    return `【${label}】\n${truncate(raw)}`;
  });
  return `${head}\n\n${body.join('\n\n')}\n`;
}

/* ── 联系表的排版与旋钮 ───────────────────────────────────────────────── */

/**
 * 「一张联系表多大」的旋钮。**必须可配**（用户 2026-09-25 裁定 3）：
 * 「每格多大才够模型看清」本机验不了（没有视觉模型、看不见图）⇒ 只能用真模型调参，
 * 而**调参不许改代码**。
 *
 * 四个字段、**三个**旋钮：每格的宽与高算一个（「一张格子多大」），另两个是「几列」「每张最多几格」。
 */
export interface SheetKnobs {
  cellWidth: number;
  cellHeight: number;
  columns: number;
  maxCellsPerSheet: number;
}

/**
 * 默认值。取绘图题的原生画布尺寸 —— `ink-render.ts:31-33` 的注释逐字写着
 * 「绘图题的默认框就是 320 × 240」。
 *
 * 🔴 **这三个数是我猜的**（规格 §七 裁定 3，用户已知情并选择「先试」）：
 * 40 人 ⇒ 3 列 × 4 行 = 12 格 ⇒ 4 张。真模型上够不够看清，只能用真模型调。
 */
export const DEFAULT_ANALYSIS_KNOBS: SheetKnobs = { cellWidth: 320, cellHeight: 240, columns: 3, maxCellsPerSheet: 12 };

/** 旋钮落在 `Setting` 表里的键。 */
export const KNOBS_SETTING_KEY = 'worksheet-analysis-knobs';

/** 格子之间的间距 · 整张图的外边距 · 每格上方标签条的高度（像素）。 */
export const SHEET_GAP = 12;
export const SHEET_MARGIN = 16;
/*
 * ★ 2026-10-07（教师：40 人一起交给智能体）：「把联系表上的代号**画大一点**」——
 * 模型是在**读那张图**辨认「第几格是谁」，代号画小了它就看串，而看串的后果是
 * **分贴到别人头上**（解析那一侧只要求「代号在名单里」，认错也照收，两边都不报错）。
 * ⇒ 代号字体 15 → **24**，这条标签条相应 22 → **34**（代价：每格里的图矮 12px）。
 * ⚠️ 改这里要同时改 `analysis-render.ts` 里那句 `font-size` 与基线偏移 —— **三处一起动**。
 *   （我第一次就漏了这一处：`analysis-render.ts` 改了、这里没改，而脚本无条件打印 ok ✗。）
 */
export const SHEET_LABEL_H = 34;

/**
 * 各旋钮的合法区间 —— 归一化时越界回落默认。
 *
 * 🔴 下界刻意不为 0：0 宽的格子会让渲染函数画出一张**没有格子**（或格子叠在一起）的图，
 * 而**构建不报错、产物是真 PNG**，教师只看到一张白图。
 */
const KNOB_RANGE: Record<keyof SheetKnobs, [number, number]> = {
  cellWidth: [64, 1024],
  cellHeight: [48, 1024],
  columns: [1, 8],
  maxCellsPerSheet: [1, 64],
};

/**
 * 把 `Setting` 里的原始值归一化成旋钮。**坏值一律回落默认，不是拒绝** ——
 * 与本仓既有的 `normalizePointValue` / `normalizeSettings` 同一条纪律：
 * 一个手改坏的数字不该让教师的「分析」按钮 500。
 *
 * ⚠️ `NaN` / `Infinity` **不是**合法数值（`typeof NaN === 'number'`，只判类型会放它过去），
 * 所以额外走 `Number.isFinite`。
 */
export function normalizeAnalysisKnobs(raw: unknown): SheetKnobs {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_ANALYSIS_KNOBS };
    }
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_ANALYSIS_KNOBS };
  const source = parsed as Record<string, unknown>;
  const out = { ...DEFAULT_ANALYSIS_KNOBS };
  for (const key of Object.keys(KNOB_RANGE) as Array<keyof SheetKnobs>) {
    const value = source[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const rounded = Math.trunc(value);
    const [min, max] = KNOB_RANGE[key];
    if (rounded < min || rounded > max) continue;
    out[key] = rounded;
  }
  return out;
}

/** 联系表里的一格。`hasInk` 为假时这一格只画标签与底板（空笔迹 / unknown / 文字条目）。 */
export interface SheetCell {
  index: number;
  studentId: string;
  anonLabel: string;
  x: number;
  y: number;
  w: number;
  h: number;
  labelX: number;
  labelY: number;
  hasInk: boolean;
}

export interface SheetLayout {
  sheetIndex: number;
  width: number;
  height: number;
  cells: SheetCell[];
}

/**
 * 一行占的高度 = 标签条 + 格子 + 行间距。
 *
 * ⚠️ 几何顺序是 **外边距 → 标签条 → 格子**（不是「格子上面贴一条越出外边距的标签」）：
 * 所以格子的 y 要比「这一行的起点」再往下让一个 `SHEET_LABEL_H`。
 * 计划里那段示例代码把这两个偏移写反了（标签跑到外边距之上），这条断言在用例里
 * （`c0.labelY === SHEET_MARGIN` 且 `c0.y === SHEET_MARGIN + SHEET_LABEL_H`）。
 */
function rowPitch(knobs: SheetKnobs): number {
  return knobs.cellHeight + SHEET_LABEL_H + SHEET_GAP;
}

/**
 * 把 N 份作答排成一张或多张联系表。
 *
 * 🔴 **`unknown` 与空笔迹的条目也要占一格**（`hasInk: false`）：不占格的后果是
 * 联系表上少一格，而 `coveredCount` 仍然是原来的数 —— 教师看到「12 人已交」却只有 11 幅画，
 * 且**没有任何报错**。空那一格由渲染层画成灰底 + 一句「（空白）」/「（形状认不出）」。
 *
 * 顺序与 `entries` 一致（调用方已按 `studentId` 排好）⇒ 第 n 格永远是同一个人，
 * 于是「第 3 格」这句话在载荷、图、编号对照表三处指的是同一个人。
 */
export function layoutSheets(entries: AnalyzeEntry[], labels: Map<string, string>, knobs: SheetKnobs): SheetLayout[] {
  const capacity = knobs.maxCellsPerSheet;
  if (entries.length === 0 || capacity < 1) return [];
  const sheetCount = Math.ceil(entries.length / capacity);
  const sheets: SheetLayout[] = [];
  for (let s = 0; s < sheetCount; s++) {
    const slice = entries.slice(s * capacity, (s + 1) * capacity);
    const rows = Math.ceil(slice.length / knobs.columns);
    const cells: SheetCell[] = slice.map((entry, i) => {
      const col = i % knobs.columns;
      const row = Math.floor(i / knobs.columns);
      const x = SHEET_MARGIN + col * (knobs.cellWidth + SHEET_GAP);
      const labelY = SHEET_MARGIN + row * rowPitch(knobs);
      const y = labelY + SHEET_LABEL_H;
      return {
        index: s * capacity + i,
        studentId: entry.studentId,
        anonLabel: labels.get(entry.studentId) ?? entry.studentId,
        x, y, w: knobs.cellWidth, h: knobs.cellHeight,
        labelX: x, labelY,
        hasInk: entry.kind === 'photo'
          || (entry.kind === 'ink' && Array.isArray(entry.ink?.strokes) && entry.ink.strokes.length > 0),
      };
    });
    sheets.push({
      sheetIndex: s,
      width: SHEET_MARGIN * 2 + knobs.columns * knobs.cellWidth + Math.max(0, knobs.columns - 1) * SHEET_GAP,
      height: SHEET_MARGIN * 2 + rows * (knobs.cellHeight + SHEET_LABEL_H) + Math.max(0, rows - 1) * SHEET_GAP,
      cells,
    });
  }
  return sheets;
}

/* ── 编排层（薄，不写判断）────────────────────────────────────────────── */

/** 一道题的聚合载荷。图**不在**里面 —— 它是派生物，走单独的端点按需渲染。 */
export interface AnalysisPayload {
  questionId: string;
  questionLabel: string;
  typeLabel: string;
  prompt: string;
  questionDetails: string;
  referenceAnswer: string;
  rubricText: string;
  rubricImageUrl: string | null;
  /**
   * ★ 2026-10-06：这题有没有教师给的「初始图」（见 `QuestionMeta.drawingStarter`）。
   * 提示词据此追加 `DRAWING_STARTER_NOTE` 那一句；`false` ⇒ **一个字都不加**。
   */
  drawingStarter: boolean;
  localStats: { correct: number; partial: number; incorrect: number; ungraded: number };
  payloadKind: 'text' | 'image' | 'mixed';
  covered: number;
  total: number;
  entries: Array<{ studentId: string; anonLabel: string }>;
  /** ★ 2026-10-07：真的可以评分的那些代号（评分那一段只点这些人的名）。 */
  scorableLabels: string[];
  /** ★ 2026-10-07：这一版读不出作答、因而评不了的人（图没抓到 / 形状认不出）。 */
  unscorableIds: string[];
  text: string | null;
  sheetLayouts: SheetLayout[];
  knobs: SheetKnobs;
  aiScoring: { enabled: boolean; maxScore: number; unit: string; criteria: string; parts?: Array<{ index: number; maxScore: number }> };
}

/**
 * 生成标签（`张伟#7`）。
 *
 * 🔴 **从名册派生**（★ 2026-10-07 教师裁定），不再按条目下标派生。
 *   老写法（`User_` + 下标零填充）的失败是**静默**的：模型读图时把 `User_001` /
 *   `User_002` 看串，分数就贴到另一个人头上 —— 而解析那一侧只要求「标签在名单里」，照收不误。
 *
 * 🔴 **刻意不用全局 `anonymizer`**，两个理由：
 *   ① 它是有状态的单例（`MAX_ENTRIES = 500`，满了或换课堂就重置）——
 *      为一次分析再塞 40 条进去会**加快**它重置，而重置会让**正在进行的一段聊天**
 *      里同一个学生的伪名中途换掉（`anonymizer.ts:7`）；
 *   ② 这里要的语义不同：标签只需**在这份载荷内**稳定且可复算
 *      （同一份 aggregate 重渲必须得到同一组标签），不需要与聊天那边一致。
 *
 * ⚠️ **调用方必须喂同一份名册**：重渲（`payloadFromStoredRow`）与新分析两条路径
 *    都要走 `loadAnalysisParticipants` —— 喂了不同的名册，同一份 `aggregate`
 *    会渲出两组标签，而图、文档、提示词三处对不上，**没有任何报错**。
 */
export function payloadLabels(entries: AnalyzeEntry[], participants: Participant[]): Map<string, string> {
  const roster = new Map(participants.map((participant) => [participant.participantId, participant]));
  const used = new Set<string>();
  const labels = new Map<string, string>();
  entries.forEach((entry, index) => {
    const participant = roster.get(entry.studentId);
    // ⚠️ 名册里没有他（作答行还在、参与者已经退出课堂）⇒ 回落成**老式伪名**。
    //    回落成真名是**猜**（我们不知道他是谁），留空则那一格没有归属。
    let label = participant ? participantLabel(participant) : `User_${String(index + 1).padStart(3, '0')}`;
    /*
     * 🔴 **标签必须互不相同。** `parseAiAnalysisResult` 按标签把分收回来（`byLabel`），
     *   两个一样的标签会让**分数静默贴到另一个人头上** —— 那正是这次要修的失败，
     *   不能在新写法里再开一个同样的口子。
     * 触发条件很窄但真实：同名的两个学生都没填学号；或名册里没有的那几个人凑出同一下标。
     */
    if (used.has(label)) {
      let n = 2;
      while (used.has(`${label}-${n}`)) n += 1;
      label = `${label}-${n}`;
    }
    used.add(label);
    labels.set(entry.studentId, label);
  });
  return labels;
}

/**
 * ★ 组装载荷。**薄编排层，不写判断**（规格 §3.2 的硬要求）：
 * 标签、形态、文档、排版全调上面那几个纯函数。
 *
 * `total` 由调用方给 —— 它是「**该题应作答的**参与者数」（高级模式下不是全班人数），
 * 口径在路由那一层（复用 `resolveMaterialTargetId`）；本函数不读库、算不出它。
 *
 * ★ 2026-10-07：`participants` 是**必填**的（标签由它派生）。刻意不给默认值 ——
 *    漏传的后果是标签全回落成老式伪名，而「模型看串格、分贴错人」正是要修的那件事，
 *    编译期拦住比运行时静默退化好。
 */
export function buildAnalysisPayload(input: {
  question: QuestionMeta; entries: AnalyzeEntry[]; total: number; knobs: SheetKnobs;
  participants: Participant[];
}): AnalysisPayload {
  const { question, entries, total, knobs, participants } = input;
  const labels = payloadLabels(entries, participants);
  const payloadKind = payloadKindOf(entries);
  return {
    questionId: question.questionId,
    questionLabel: question.heading,
    typeLabel: question.typeLabel,
    prompt: question.prompt,
    questionDetails: question.details || '（没有额外题面材料）',
    referenceAnswer: question.referenceAnswer || '（未提供参考答案）',
    rubricText: question.rubricText || '',
    rubricImageUrl: question.rubricImageUrl ?? null,
    // ⚠️ `=== true` 不是啰嗦：题面字面量可能没这个键（老调用点），`undefined` 必须落成 `false`
    //    —— 落成真值的后果是**每一道题**的提示词都多一句「图里有教师的初始图」。
    drawingStarter: question.drawingStarter === true,
    localStats: localStatsOf(entries),
    payloadKind,
    covered: entries.length,
    total,
    entries: entries.map((entry) => ({ studentId: entry.studentId, anonLabel: labels.get(entry.studentId)! })),
    /*
     * ★ 2026-10-07（教师：40 人一起交给智能体）—— **这一版读不出来的作答**（快照没抓到、
     *   形状也认不出 ⇒ `kind: 'unknown'`）。
     * 🔴 它们原来只是文档里写一句「未纳入」，可**评分那一段照样点名要它们的分数**
     *    （「给每一位已提交作答的学生评分……不能遗漏」）⇒ 模型只能**编**：
     *   给一个没看到任何东西的学生编一个分和一段评价，落库，学生端还真会显示出来。
     * ⇒ 现在把两件事分开：`scorableLabels` 是**真的可以评**的那些（喂给评分那一段），
     *   `unscorableIds` 是评不了的（喂给教师面板，说明「这几个人评不了、要让他们重交」）。
     */
    scorableLabels: entries.filter((entry) => entry.kind !== 'unknown').map((entry) => labels.get(entry.studentId)!),
    unscorableIds: entries.filter((entry) => entry.kind === 'unknown').map((entry) => entry.studentId),
    // 形态是 image 时不给文档（一张联系表就是全部内容）；mixed 两样都给。
    text: payloadKind === 'image' ? null : buildTextDocument(question, entries, labels, entries.length, total),
    sheetLayouts: payloadKind === 'text' ? [] : layoutSheets(entries, labels, knobs),
    knobs,
    aiScoring: question.aiScoring ?? { enabled: false, maxScore: 10, unit: '分', criteria: '' },
  };
}

/* ── 落库 / 取回 ──────────────────────────────────────────────────────── */

/**
 * 条目 → `aggregate` 的 JSON 形状（写库用）。
 *
 * ⚠️ 存的是**快照**（含答案内容），不是只存计数：`aggregate` 是「本次分析看到的东西」的
 * 唯一事实来源。只存计数的话，重新打开预览就得回去读 `WorksheetAnswer` ——
 * 而那份数据在两次打开之间**可能已经变了**（学生改了、又交了），于是图上的内容与
 * 存下来的 `coveredCount` 对不上，**且没有任何报错**。
 */
export function entriesToAggregate(entries: AnalyzeEntry[]): Array<Record<string, unknown>> {
  return entries.map((entry) => ({
    studentId: entry.studentId,
    kind: entry.kind,
    text: entry.text ?? null,
    ink: entry.ink ?? null,
    photoUrl: entry.photoUrl ?? null,
    gradeState: entry.gradeState ?? null,
  }));
}

/**
 * `aggregate` → 条目（读库用，联系表端点靠它重渲）。
 *
 * 🔴 **必须能扛住脏数据**：这一列是 JSON，可能被手改过、也可能是**更老的版本**写的
 * （本功能以后会长）。坏一行就整条 500 的后果是「分析打不开了」，而库里其实只有一条记录坏了。
 * ⇒ 认不出的行落成 `unknown`（在图上占一格、写「形状认不出」），不认得的整体回空数组。
 */
export function entriesFromAggregate(raw: unknown): AnalyzeEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: AnalyzeEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.studentId !== 'string' || row.studentId === '') continue;
    const gradeState = row.gradeState === 'correct' || row.gradeState === 'partial' || row.gradeState === 'incorrect'
      ? row.gradeState : null;
    if (row.kind === 'text') {
      out.push({
        studentId: row.studentId, kind: 'text',
        text: typeof row.text === 'string' ? row.text : '',
        gradeState,
      });
      continue;
    }
    if (row.kind === 'ink') {
      const ink = readInk(row.ink);
      out.push(ink
        ? { studentId: row.studentId, kind: 'ink', ink, gradeState }
        : { studentId: row.studentId, kind: 'unknown', gradeState });
      continue;
    }
    if (row.kind === 'photo') {
      const photoUrl = typeof row.photoUrl === 'string' && CHAT_IMAGE_URL.test(row.photoUrl) ? row.photoUrl : null;
      out.push(photoUrl
        ? { studentId: row.studentId, kind: 'photo', photoUrl, gradeState }
        : { studentId: row.studentId, kind: 'unknown', gradeState });
      continue;
    }
    out.push({ studentId: row.studentId, kind: 'unknown', gradeState });
  }
  return out;
}

/* ── 陈旧判定 ─────────────────────────────────────────────────────────── */

/** 这批作答行里，**这一道题**最后一次定稿的时刻（没有交过 ⇒ `null`）。 */
export function lastSubmittedAt(answers: RawAnswer[], questionId: string): string | null {
  let latest: string | null = null;
  for (const answer of answers) {
    if (answer.questionId !== questionId) continue;
    const at = answer.submittedAt;
    if (typeof at !== 'string' || at === '') continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

/**
 * ★ M7a：一份分析是不是**过期**了 —— 即「算完之后又有人交了」。
 *
 * 🔴 为什么由**服务端**判、并把结果放进响应（而不是前端自己算）：
 * 前端手上那份看板数据里**压根没有 `submittedAt`**（`WorksheetBoardAnswerRow` 没这个字段），
 * 而这件事要的是「**这道题**最后一次提交的时刻」。让前端算就得给看板端点加字段 ——
 * 那是改一个 M5b 的既有端点去成全一个新功能。数据在服务端，判据就该在服务端。
 *
 * 比较按字符串序：ISO 8601 的字典序就是时间序，不需要建 `Date`。
 * 同一时刻**不算**陈旧（`>` 不是 `>=`）—— 算完之后立刻打开预览不该显示「可能已过期」。
 */
export function isAnalysisStale(computedAt: string, lastSubmittedAtValue: string | null): boolean {
  if (!lastSubmittedAtValue) return false;
  return lastSubmittedAtValue > computedAt;
}
