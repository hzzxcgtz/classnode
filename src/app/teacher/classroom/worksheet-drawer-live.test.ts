/**
 * ★ 2026-10-07（教师）：「左边卡片和右边抽屉显示的不是同一份内容」—— **接线**判据。
 *
 * 🔴 为什么不能只靠 `worksheet-board-data.test.ts`：那几条证的是
 *   「`answerRowWithDraft` 叠得对」。而**抽屉愿不愿意用它**是另一件事 ——
 *   把抽屉改回 `const row = rowsByQuestion.get(...)`，那几条**照样全绿**，
 *   而教师看到的还是那张旧图（两处显示不一致），本机看不见界面，只能靠读源码发现。
 *
 * ⚠️ 它证的是「接线在、形态对」，**不证**渲染出来的那一张图对不对
 *   （那一条在 `answerRowWithDraft` 的用例里，含四个方向）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRAWER = fs.readFileSync(path.join(HERE, 'worksheet-drawer.tsx'), 'utf8');
const PAGE = fs.readFileSync(path.join(HERE, 'page.tsx'), 'utf8');

test('★ 抽屉的**两处**作答渲染都叠了实时预览（少一处就是两屏不一致）', () => {
  // 两处：`QuestionAnswers`（按题列全班）与 `ParticipantAnswers`（按人逐题）。
  // 只改一处的话，教师从矩阵点进去看到的是新的、从题目点进去看到的是旧的。
  const calls = DRAWER.match(/answerRowWithDraft\(/g) ?? [];
  assert.ok(calls.length >= 2, `抽屉里只有 ${calls.length} 处叠了实时预览 —— 两处渲染都要叠`);
});

test('★ 看板把 `liveDrafts` 传给了抽屉（不传的话上面那条是空的）', () => {
  assert.match(
    PAGE, /liveDrafts=\{wb\.liveDrafts\}/,
    '抽屉没拿到实时预览 ⇒ 它那一份永远是已落库的那一行（学生继续写的那一分钟里，这屏是旧的）',
  );
  assert.match(DRAWER, /liveDrafts: Record<string, \{ worksheetId: string; questionId: string; value: unknown \}>/,
    'prop 的类型走了样 —— 传进来的形状必须与 `useWorksheetBoard` 的 `liveDrafts` 一致');
});
