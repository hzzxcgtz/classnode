import { isInkFormat, type InkValue } from './ink-path.js';

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
}

/** 一个参与者（`ClassroomStudent` 一行 —— 分组 / 高级模式下是**组**）。 */
export interface Participant {
  participantId: string;
  name: string;
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
  displayName: string;
  kind: 'text' | 'ink' | 'unknown';
  text?: string;
  ink?: InkValue;
}

/** 从作答值里认出文字。`text/v1` 是本仓问答题的格式（`WorksheetAnswerValue`）。 */
function readText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.format !== 'text/v1') return null;
  return typeof raw.text === 'string' ? raw.text : '';
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
  return { format: raw.format, canvas: { w: canvas.w, h: canvas.h }, strokes: raw.strokes } as InkValue;
}

/**
 * 谁进载荷。
 *
 * 三条判据：① 是这一道题；② `status === 'submitted'`（只分析**定稿**的答案 ——
 * 设计文档 §8.4 `:742` 逐字写着逐题提交就是为了这件事）；③ 参与者名单里查得到。
 * **顺序按 `studentId` 升序**：模型会说「第 3 格」「上面第 5 条」，顺序不确定就映射不回去。
 */
export function selectAnalyzeEntries(
  answers: RawAnswer[], participants: Participant[], questionId: string,
): AnalyzeEntry[] {
  const nameById = new Map(participants.map((p) => [p.participantId, p.name]));
  const out: AnalyzeEntry[] = [];
  for (const answer of answers) {
    if (answer.questionId !== questionId) continue;
    if (answer.status !== 'submitted') continue;
    const displayName = nameById.get(answer.participantId);
    if (displayName === undefined) continue;
    const text = readText(answer.value);
    if (text !== null) {
      out.push({ studentId: answer.participantId, displayName, kind: 'text', text });
      continue;
    }
    const ink = readInk(answer.value);
    if (ink) {
      out.push({ studentId: answer.participantId, displayName, kind: 'ink', ink });
      continue;
    }
    out.push({ studentId: answer.participantId, displayName, kind: 'unknown' });
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
    else if (entry.kind === 'ink') hasInk = true;
  }
  if (hasText && hasInk) return 'mixed';
  return hasInk ? 'image' : 'text';
}
