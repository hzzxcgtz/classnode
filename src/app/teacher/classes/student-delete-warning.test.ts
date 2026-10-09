import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STUDENT_DELETE_CONSEQUENCE,
  STUDENT_REMOVE_CONSEQUENCE,
  singleStudentDeleteMessage,
  batchStudentDeleteMessage,
  singleStudentRemoveMessage,
  batchStudentRemoveMessage,
} from './student-delete-warning.ts';

/**
 * ★ 2026-10-09 审计：**删学生会级联销毁该生在全部课堂（含已结束）的对话与学习单作答**，
 * 而两个确认弹窗都**没有说这件事**（批量那句只多一句「此操作不可撤销」）。
 *
 * 这一条测试钉的是**文案必须说出的三件事**，不是措辞：
 *   ① 范围 —— 「所有课堂（包括已结束的）」；
 *   ② 内容 —— 对话记录与学习单作答；
 *   ③ 后果 —— 无法恢复。
 * 少任何一件，教师点下去时就是在不知道代价的情况下销毁自己上学期的数据。
 *
 * ⚠️ 客户端页面（`.tsx`）在本仓**没有渲染测试的脚手架**（`test:client` 只扫 `src` 下
 *    以 `.test.ts` 结尾的文件、且没有 DOM），所以判据抽成这个纯模块来钉。
 *    代价：这条网挡得住「有人把话改短」，挡不住「有人绕过这个函数另写一句」——
 *    后者的防线是两个入口都从这里取文案（`page.tsx` 的两处调用）。
 */

/** 三件事各至少要有一种说法 —— 用词组而不是整句，避免把文案钉死成不能改。 */
const FACTS: ReadonlyArray<[string, RegExp]> = [
  ['范围：所有课堂', /所有课堂|全部课堂/],
  ['范围：含已结束的', /已结束/],
  ['内容：对话记录', /对话/],
  ['内容：学习单作答', /学习单作答/],
  ['后果：无法恢复', /无法恢复|不可恢复/],
];

test('单个学生：删除确认必须说清会牵连所有课堂的对话与作答', () => {
  const message = singleStudentDeleteMessage('张三');
  assert.ok(message.includes('张三'), '要说清楚删的是谁');
  for (const [label, pattern] of FACTS) {
    assert.match(message, pattern, `单人删除的提示少了「${label}」`);
  }
});

test('批量删除：同一份后果说明（两个入口不许有一个少说）', () => {
  const message = batchStudentDeleteMessage(3);
  assert.match(message, /3 名/, '要说清楚删几个人');
  for (const [label, pattern] of FACTS) {
    assert.match(message, pattern, `批量删除的提示少了「${label}」`);
  }
});

test('两个入口用的是同一份后果说明（防止只改一处、另一处悄悄漂移）', () => {
  assert.ok(singleStudentDeleteMessage('张三').includes(STUDENT_DELETE_CONSEQUENCE),
    '单人删除必须逐字带上共用的那句');
  assert.ok(batchStudentDeleteMessage(2).includes(STUDENT_DELETE_CONSEQUENCE),
    '批量删除必须逐字带上共用的那句');
});

test('阴性对照：不许把后果说成「只是移出班级」（那正是原来的谎）', () => {
  for (const message of [singleStudentDeleteMessage('张三'), batchStudentDeleteMessage(2)]) {
    assert.doesNotMatch(message, /仅从.*班级中删除|只是从.*班级中删除/,
      '只说「从班级中删除」等于隐瞒了级联销毁');
  }
});

// ── ★ 2026-10-09（教师裁定「删学生拆两件事」）：两个动作各说各的后果 ──────────
//
// 🔴 拆开的理由（审计 §B1）：名册上那个 × 一直是**裸删** —— `Student` →(Cascade)
//    `ClassroomStudent` →(Cascade) `Message` / `WorksheetResponse` ⇒ 教师按日常名册维护的
//    预期（「他不在我这个班了」）点下去，上个学期的东西一起没了。
//    ⇒ 「移出班级」只断名册归属（`Student.classId = null`，服务端那条路有真库用例
//      `server/src/tests/student-removal.test.ts` 钉着），「彻底删除」才是原来那个破坏性动作。
//
// 两句话必须**互不相同**，而且各自说对：说反了比不说更坏（教师会照着一句假话去点）。

test('🔴 移出班级说的必须是「历史保留」，不是「会删」', () => {
  const message = singleStudentRemoveMessage('张三');
  assert.ok(message.includes('张三'), '要说清楚动的是谁');
  assert.match(message, /保留/, '「移出班级」必须说清历史与作答**保留**');
  assert.match(message, /所有课堂|全部课堂/, '范围要说清（他所有课堂里的东西都不动）');
  assert.match(message, /已结束/, '范围里那句「包括已结束的」不能省');
  assert.match(message, /重新加回|再加回|重新添加/, '要说清这一步是可逆的（还能加回来）');
  assert.doesNotMatch(message, /无法恢复|不可恢复/, '移出班级不删任何东西 —— 说「无法恢复」是句假话');
  assert.match(message, /仍然会留在那个课堂/, '要说清「正在上课的学生不会被踢出课堂」这个非直觉的后果');
});

test('🔴 批量移出：同一份说明（两个入口不许有一个少说）', () => {
  const message = batchStudentRemoveMessage(3);
  assert.match(message, /3 名/, '要说清几个人');
  assert.match(message, /保留/);
  assert.doesNotMatch(message, /无法恢复|不可恢复/);
});

test('🔴 两个动作的文案必须**分开**：彻底删除那句要说「不只是移出班级」', () => {
  // 没有这一条，两个按钮共用一句「删除」也能让上面全绿 —— 而教师分不出哪个是哪个。
  assert.ok(singleStudentRemoveMessage('张三') !== singleStudentDeleteMessage('张三'),
    '两个动作用了同一句话 —— 教师没法从弹窗上分出自己在点哪个');
  assert.match(singleStudentDeleteMessage('张三'), /不只是移出班级/,
    '「彻底删除」必须点明它**不只是**从名册上去掉');
  assert.match(batchStudentDeleteMessage(2), /不只是移出班级/);
  // 反过来也要成立：移出那句不许把自己说成删除。
  assert.doesNotMatch(singleStudentRemoveMessage('张三'), /彻底删除/);
});

test('🔴 四个入口共用两份后果说明（防止只改一处、另一处悄悄漂移）', () => {
  assert.ok(singleStudentRemoveMessage('张三').includes(STUDENT_REMOVE_CONSEQUENCE));
  assert.ok(batchStudentRemoveMessage(2).includes(STUDENT_REMOVE_CONSEQUENCE));
  assert.ok(singleStudentDeleteMessage('张三').includes(STUDENT_DELETE_CONSEQUENCE));
  assert.ok(batchStudentDeleteMessage(2).includes(STUDENT_DELETE_CONSEQUENCE));
  assert.notEqual(STUDENT_REMOVE_CONSEQUENCE, STUDENT_DELETE_CONSEQUENCE);
});
