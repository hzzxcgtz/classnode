/**
 * 课堂级「逐题开放」的读写判据（★ 2026-09-30，教师）。
 *
 * 🔴 这一组守的是**静默降级的方向**：`Classroom.worksheetOpen` 是库里的 JSON，
 * 坏值（手改过的行、老版本写下的形状、别的单的键）只能静默降级 ——
 * 而降级成「全开放」与降级成「全关着」是**两件完全不同的事**，屏幕上都不报错：
 *   · 降级成「全关着」⇒ 学生那一屏少几道题（**看得见**，老师说一声就好）；
 *   · 降级成「全开放」⇒ 一份设了手动静止的卷子整个放开，**没有任何异常**。
 * ⇒ 判据一律朝前者倒（空）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWorksheetOpen,
  openQuestionsFor,
  withOpenQuestions,
} from '../services/worksheet-open.js';

test('🔴 认不出的值一律当**空**（不是「全开放」）', () => {
  for (const bad of [null, undefined, 'x', 42, true, []]) {
    assert.deepEqual(normalizeWorksheetOpen(bad), {}, `${String(bad)} 应回空`);
  }
  // 阳性对照：一个**合法**的形状必须真的读得出来（否则上面那条「回空」什么都没证明）。
  assert.deepEqual(normalizeWorksheetOpen({ ws1: ['q1'] }), { ws1: ['q1'] });
});

test('🔴 键上的坏形状逐项丢掉，合法的那些照常保留', () => {
  const out = normalizeWorksheetOpen({
    ws1: ['q1', 42, '', null, 'q1', {}, 'q2'],   // 只应留下 q1 / q2（去重）
    ws2: 'q1',                                    // 不是数组 ⇒ 整个键丢掉
    ws3: [],                                      // 空数组 ⇒ 与「没开过」同义，键不写出来
  });
  assert.deepEqual(out, { ws1: ['q1', 'q2'] });
  assert.equal('ws2' in out, false);
  assert.equal('ws3' in out, false);
});

test('🔴 归一化是**幂等**的（每次写都过一遍它，结果不许逐次变化）', () => {
  const once = normalizeWorksheetOpen({ ws1: ['q2', 'q1'], ws2: ['q9'] });
  assert.deepEqual(normalizeWorksheetOpen(once), once);
});

test('读某一份单：没有那个键 ⇒ 空数组（不是抛、不是 undefined）', () => {
  const raw = { ws1: ['q1'] };
  assert.deepEqual(openQuestionsFor(raw, 'ws1'), ['q1']);
  assert.deepEqual(openQuestionsFor(raw, 'ws2'), []);
  assert.deepEqual(openQuestionsFor(raw, ''), []);
  assert.deepEqual(openQuestionsFor(null, 'ws1'), []);
});

test('🔴 写一份单**不许碰另一份**（高级模式下一堂课有好几份单）', () => {
  const before = { ws1: ['q1'], ws2: ['q9'] };
  const after = withOpenQuestions(before, 'ws1', ['q2', 'q3']);
  assert.deepEqual(after, { ws1: ['q2', 'q3'], ws2: ['q9'] }, 'ws2 必须逐字不动');
  // ⚠️ 入参**不许**被就地改掉：它是从 Prisma 读出来的对象，就地改会让「同一份 ctx
  //    在这一条请求里后面的读取」看到已经改过的值（那条路没有任何用例盖得到）。
  assert.deepEqual(before, { ws1: ['q1'], ws2: ['q9'] });
});

test('🔴 写空清单 = **收回这一份单的全部开放**（键整个删掉，与「没开过」同义）', () => {
  assert.deepEqual(withOpenQuestions({ ws1: ['q1'], ws2: ['q9'] }, 'ws1', []), { ws2: ['q9'] });
});

test('写：整份替换（后写者赢）且幂等', () => {
  const once = withOpenQuestions({}, 'ws1', ['q1', 'q2']);
  assert.deepEqual(once, { ws1: ['q1', 'q2'] });
  assert.deepEqual(withOpenQuestions(once, 'ws1', ['q1', 'q2']), once);
  assert.deepEqual(withOpenQuestions(once, 'ws1', ['q2']), { ws1: ['q2'] }, '少一个就是少一个');
});
