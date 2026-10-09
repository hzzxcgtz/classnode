import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 身份页（选姓名那一屏）**必须有提示的宿主**。
 *
 * 🔴 起因（2026-10-09 审计 §B22）：`handleIdentityConfirm` 失败时（会话建不出来 ——
 * 课堂已结束、服务端刚重启、断网）会 `setToast({ … 'error' })`，而 `step === 'identity'`
 * 那一支**只渲染 `<IdentityPicker>`**、没有任何 `<Toast>` 实例
 * ⇒ 学生点了「进入课堂」之后**屏幕上不出现任何文字**，只看到按钮从「进入中」转回原样。
 * 他唯一能猜到的是「再点一次」。
 *
 * ⚠️ 这是本仓**已经栽过一次**的同一形态：`classroom-shell.tsx` 里那段注释逐字写着占位面板
 * 从前不接 `toast` ⇒ 「既看不见，又因为没有 `<Toast>` 实例而**没有任何 3 秒计时器**」，
 * 提示会滞留在会话状态里、等切回首页时突然弹出一条几分钟前的旧提示。
 * 身份页是**第三个**渲染点，只是当年漏了它。
 *
 * ⚠️ **本文件证明的是接线，不是浏览器里的行为**（没有 jsdom）：它扫源码里
 * 「身份那一支有没有渲染宿主」与「失败那条路有没有产生提示」。真正的行为要人工验：
 * **断网后在身份页点「进入课堂」，屏幕上要出现一句人能看懂的话**。
 *
 * ```bash
 * node --test src/app/classroom/identity-toast-host.test.ts
 * ```
 */

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, 'page.tsx');
const SESSION = path.join(HERE, 'use-classroom-session.ts');

test('🔴 身份页要渲染提示宿主（否则那一页设的提示一个字都不会出现）', () => {
  const source = stripComments(readFileSync(PAGE, 'utf8'));
  const identityIndex = source.indexOf("session.step === 'identity'");
  const shellIndex = source.indexOf('<ClassroomShell');
  assert.ok(identityIndex >= 0, '找不到身份页那一支 —— 用例的锚点失效了，先修用例');
  assert.ok(shellIndex > identityIndex, '外壳必须在身份页那一支之后（切出来的片段才是身份页）');

  const branch = source.slice(identityIndex, shellIndex);
  assert.match(branch, /<IdentityPicker/, '切出来的这一支不是身份页');
  // 🔴 用共用的 `ClassroomToast` 而不是就地写一个 `<Toast>`：**关闭要清空会话级 toast**
  // 这一条与「3 秒计时器」都长在那个组件里（`layer-overlays.tsx` 的文件头写着「写两遍就是
  // 会漂移的重复」）。就地写一个 `<Toast msg={toast.msg} />` 少了 `onClose`
  // ⇒ 提示**永远不会自己消失**，学生切到首页时它还在。
  assert.match(branch, /<ClassroomToast/,
    '身份页没有提示宿主 ⇒ 进入课堂失败时屏幕上不出现任何文字，学生只能靠猜');
});

test('🔴 那条路上真的会产生一句提示（否则宿主是摆设）', () => {
  // 上一条只证明「有地方显示」。若失败那一支哪天不再设提示，宿主就白挂着 ——
  // 而「按了没反应」这个症状一模一样。
  const source = stripComments(readFileSync(SESSION, 'utf8'));
  const confirmIndex = source.indexOf('const handleIdentityConfirm');
  const switchIndex = source.indexOf('const handleSwitchIdentity');
  assert.ok(confirmIndex >= 0 && switchIndex > confirmIndex, '找不到 handleIdentityConfirm —— 先修用例');

  const branch = source.slice(confirmIndex, switchIndex);
  assert.match(branch, /setToast\(/, '进入课堂失败时没有任何提示产生');
  assert.match(branch, /joiningRef\.current = false/,
    '失败后没放开 joiningRef ⇒ 学生再点一次也不会重试（按钮成了摆设）');
  // ⚠️ 另半边（提示内容是不是人话）不在这里断：它取决于 `api.createStudentSession` 抛出来的
  //    文案，属于「学生 token 过期被说成教师会话失效」那一族（审计 §B19），不在本次范围。
});
