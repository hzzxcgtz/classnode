import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * ★ 2026-09-25：`allowStudentAsk`（教师端「允许学生提问」）的**方向**。
 *
 * 🔴 这条字段是**后加的**，所以「认不出」是一个真实存在的状态：老服务端的响应里
 * 根本没有这一格。方向写反的后果**不会报错、只会静默**：
 *   · 客户端写成 `!classroom?.allowStudentAsk` ⇒ 学生的输入框**打不了字**，
 *     而教师端那条开关显示「开」—— 两边都看不出哪里错了；
 *   · 服务端 ALTER 写成 `DEFAULT 0` ⇒ **所有老课堂**静默地禁止提问。
 *
 * ⚠️ 本仓已经因为这一条栽过两次（`webappCaptureEnabled` 的 `!== false`、
 * `webappThumbnailWidth ?? 320`），两次的注释里都写着同一句话：
 * **「认不出 = 开 / 用默认」**。这条用例把它钉在源码上。
 *
 * ⚠️ 与 `classroom-material.test.ts` 同一条纪律：证明的是**源码里的判据形态**，
 * 不是浏览器里的行为（本仓没有前端测试框架）。
 */

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function read(relativePath: string): string {
  return stripComments(readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8'));
}

/** 读它的三处（都在学生端 —— 教师端读的是自己刚写回的值，不存在「认不出」）。 */
const READERS = [
  'src/app/classroom/chat/chat-panel.tsx',
  'src/app/classroom/shell/classroom-shell.tsx',
  'src/app/classroom/home/student-home.tsx',
];

test('🔴 客户端读 `allowStudentAsk` 必须用 `=== false`，不能用真值判断', () => {
  for (const relativePath of READERS) {
    const source = read(relativePath);
    if (!source.includes('allowStudentAsk')) continue;
    assert.ok(
      source.includes('allowStudentAsk === false'),
      `${relativePath} 读了 allowStudentAsk 却没有 === false —— 认不出（老服务端没有这一格）`
      + '会被当成「老师禁止提问」，学生的输入框静默地打不了字',
    );
    // 反向：真值判断一起都不许有。`!!` 与 `Boolean(` 同理。
    assert.ok(
      !/!\s*[\w.?]*allowStudentAsk/.test(source),
      `${relativePath} 出现了对 allowStudentAsk 的取反 —— 那是「认不出 = 禁止」，方向反了`,
    );
  }
});

test('🔴 老课堂加这一列时必须 `DEFAULT 1` —— 认不出就当**允许**', () => {
  // 与 `webappCaptureEnabled` / `allowStudentStop` 同一方向。写成 0 的话，升级之后
  // 每一堂老课都**静默地**禁止学生提问，而教师端那条开关显示「关」——
  // 看起来像是他自己关掉的。
  const source = readFileSync(new URL('../../server/src/services/legacy-upgrade.ts', import.meta.url), 'utf8');
  assert.ok(
    source.includes('ADD COLUMN "allowStudentAsk" BOOLEAN NOT NULL DEFAULT 1'),
    'allowStudentAsk 的 ALTER 不是 DEFAULT 1 —— 老课堂会被静默地禁止提问',
  );
  // 阳性对照：同一段里别的布尔列本来就该怎么写还怎么写（别为了这条把别人改坏）。
  assert.ok(source.includes('ADD COLUMN "answersLocked" BOOLEAN NOT NULL DEFAULT 0'));
});
