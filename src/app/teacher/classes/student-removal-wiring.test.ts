import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 「移出班级 / 彻底删除」这两个动作的**接线**：谁调谁、以及那条不可逆的路凭什么成立。
 *
 * 🔴 起因（审计 §B1 + 教师 2026-10-09 裁定）：名册上那颗 × 从前是**裸 `prisma.student.delete`**，
 *    级联清掉该生在全部课堂（含已结束）的对话与作答。拆成两个动作之后，最要命的失败是
 *    **两个入口接反了**（「移出班级」底下调的是删除）—— 那比不拆更坏：教师看着一句
 *    「历史都会保留」把东西删光，而且**没有任何东西会红**。
 *
 * ⚠️ 本文件只钉接线（本仓没有 DOM 测试脚手架）。**行为**那一半在
 *    `server/src/tests/student-removal.test.ts`（真 Prisma + 真 SQLite：移出之后三张表都还在、
 *    彻底删除仍然级联清干净、跨班 id 两条路都拒绝）。
 * ⚠️ 真机走查要看的：名册上一行点的到底是哪一颗按钮、两个弹窗的话是不是分别对得上。
 *
 * ```bash
 * node --test src/app/teacher/classes/student-removal-wiring.test.ts
 * ```
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = fs.readFileSync(path.join(HERE, 'page.tsx'), 'utf8');
const SERVER = fs.readFileSync(path.resolve(HERE, '../../../../server/src/routes/classes.ts'), 'utf8');
const SCHEMA = fs.readFileSync(path.resolve(HERE, '../../../../server/prisma/schema.prisma'), 'utf8');
const API = fs.readFileSync(path.resolve(HERE, '../../../lib/api.ts'), 'utf8');

/** 块注释与整行 `//` 注释：判据必须落在**活代码**上（注释里写着不算）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const page = stripComments(PAGE);

test('阳性对照：读到的是那几份文件（路径写错时下面每条都会静默变绿）', () => {
  assert.match(page, /runStudentAction/, 'page.tsx 里找不到那两个动作');
  assert.match(SERVER, /router\.(post|delete)\('/, 'classes.ts 里没有路由');
  assert.match(SCHEMA, /model Student \{/, 'schema 里找不到 Student');
});

test('🔴 分派的方向不许接反：永远是「remove ⇒ removeStudentFromClass」', () => {
  // 两处分派（单人 + 批量）都写成同一个三元形状，所以这条判据只认一种写法。
  const right = page.match(/remove\s*\?\s*api\.removeStudentFromClass\([^)]*\)\s*:\s*api\.deleteStudent\(/g) ?? [];
  assert.equal(right.length, 2, `两处分派（单人 / 批量）都要写成这个形状，实际匹配到 ${right.length} 处`);
  // 🔴 判据本体：**反过来的形状**一次都不许出现 —— 那正是「看着一句『历史都会保留』把东西删光」。
  const reversed = page.match(/remove\s*\?\s*api\.deleteStudent\(/g) ?? [];
  assert.deepEqual(reversed, [], '「移出班级」那条分支调的是删除 —— 两个入口接反了');
  // 两个接口各自的总调用次数必须**相等**（一处分派两次用，多出来的那次就是绕过判据的手写调用）。
  const removeCalls = (page.match(/api\.removeStudentFromClass\(/g) ?? []).length;
  const deleteCalls = (page.match(/api\.deleteStudent\(/g) ?? []).length;
  assert.equal(removeCalls, 2, `removeStudentFromClass 调了 ${removeCalls} 次（两处分派各一次）`);
  assert.equal(deleteCalls, 2, `deleteStudent 调了 ${deleteCalls} 次（两处分派各一次）`);
});

test('🔴 行内与批量栏都必须有**两个**入口（不能只留一个）', () => {
  assert.match(page, /runStudentAction\(s\.id, s\.name, 'remove'\)/, '行内没有「移出班级」那颗按钮');
  assert.match(page, /runStudentAction\(s\.id, s\.name, 'delete'\)/, '行内没有「彻底删除」那颗按钮');
  assert.match(page, /runBatchStudentAction\('remove'\)/, '批量栏没有「移出班级」');
  assert.match(page, /runBatchStudentAction\('delete'\)/, '批量栏没有「彻底删除」');
});

test('🔴 两个弹窗的话都从那一份模块取（不许就地另写一句）', () => {
  // ⚠️ 文案本身的对错由 `student-delete-warning.test.ts` 钉；这里只钉**入口用的是它**。
  for (const fn of ['singleStudentRemoveMessage', 'singleStudentDeleteMessage', 'batchStudentRemoveMessage', 'batchStudentDeleteMessage']) {
    assert.ok(page.includes(`${fn}(`), `${fn} 没有出现在页面上 —— 那句提示又变回就地手写了`);
  }
});

test('🔴 服务端：「移出班级」是**置空 classId**，不是删行', () => {
  const server = stripComments(SERVER);
  assert.match(server, /router\.post\('\/:classId\/students\/:studentId\/remove'/,
    '移出班级那条路由不见了');
  assert.match(server, /data: \{ classId: null \}/,
    '「移出班级」不是置空 `classId` —— 那就只能靠删行，而删行会级联清掉全部历史');
  // 阴性对照：那条路由的**函数体里**不许出现 delete（置空与删行是两件事）。
  const at = server.indexOf("router.post('/:classId/students/:studentId/remove'");
  const body = server.slice(at, server.indexOf('router.delete(', at));
  assert.ok(!/prisma\.student\.delete/.test(body), '「移出班级」那条路由里出现了删除 —— 接反了');
});

test('🔴 两条路都要先确认「这名学生确实在这个班里」（防跨班误删）', () => {
  const server = stripComments(SERVER);
  assert.match(server, /async function findStudentInClass/, '没有那道共用的闸');
  const uses = server.match(/findStudentInClass\(prisma,/g) ?? [];
  assert.equal(uses.length, 2, `两个端点都要用它（实际用了 ${uses.length} 次）`);
  assert.match(server, /where: \{ id: studentId, classId \}/, '闸的判据里没有带上 classId');
});

test('🔴 那条不可逆的路凭什么成立：`Student.classId` 必须是**可空**的', () => {
  // 「移出班级」= 把 classId 置空（上面那条）。schema 一旦改回非空，
  // 这条路由会在运行期抛（而 `tsc` 也会红 —— 但这条网让它红在**意图**上，不只是类型上）。
  const student = SCHEMA.slice(SCHEMA.indexOf('model Student {'), SCHEMA.indexOf('model Classroom {'));
  assert.match(student, /classId\s+String\?/, 'Student.classId 又变成非空了 —— 「移出班级」会写不进去');
  assert.match(student, /class\s+Class\?/, 'Student.class 关系没有跟着变成可空');
});

test('🔴 客户端 API 层两个方法各自打各自的路（注释里那句「不是同一件事」要有代码撑）', () => {
  const api = stripComments(API);
  const removeAt = api.indexOf('removeStudentFromClass:');
  const deleteAt = api.indexOf('deleteStudent:');
  assert.ok(removeAt > 0 && deleteAt > removeAt, 'api.ts 里找不到那两个方法（或顺序变了）');
  const removeBody = api.slice(removeAt, deleteAt);
  const deleteBody = api.slice(deleteAt, deleteAt + 300);
  assert.match(removeBody, /\/remove`/, 'removeStudentFromClass 没有打 /remove 那个路径');
  assert.match(removeBody, /method: 'POST'/, '移出班级是 POST `.../remove`，不是 DELETE');
  assert.match(deleteBody, /method: 'DELETE'/, 'deleteStudent 没有走 DELETE');
  assert.ok(!/\/remove`/.test(deleteBody), 'deleteStudent 打到了 /remove 那个路径 —— 两个方法接反了');
});
