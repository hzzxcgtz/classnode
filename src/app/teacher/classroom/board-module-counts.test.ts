/**
 * 看板顶部那一行「学习单 N 人 / 探究空间 N 人 / 智能学伴 N 人」的判据（教师 2026-09-29 批注 ③）。
 *
 * 教师原话：「这里显示的人数应该是指**当前正处在这个页面中的在线人数**」。
 * 截图里的症状：全班 40 人、离线 38 人，而「学习单」写着 8 人 ——
 * 那 8 个里多数是**离线**、只是最后一次停在学习单的人。
 *
 * 🔴 这一层为什么必须存在：判据写进 `page.tsx` 的 JSX 就没有任何回归网（本仓没有 jsdom）。
 * 而这条判据错了**不报错** —— 只是教师按那个数字做判断（「还有 8 个人在写学习单，
 * 再等一会儿」），而实际只有 2 个人在线。
 *
 * ⚠️ 用例里每一个「不计数」的断言都配了一个**对照**（同样形状但在线的人**要**计数）：
 * 只写「离线的没被数进去」，那么一个恒返回 0 的实现也能全绿。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cardInOnlineModule, isOnlineStatus, onlineModuleDistribution, resolveFocus,
} from './board-module-counts.ts';

/* ── 1. 谁算「在线」（判据只有这一处）────────────────────────────── */

test('🔴 isOnlineStatus：thinking 也算在线（「他没掉线，只是在想」）', () => {
  assert.equal(isOnlineStatus('online'), true);
  assert.equal(isOnlineStatus('thinking'), true);
});

test('🔴 isOnlineStatus：offline / 缺失 / 别的串一律不算在线', () => {
  assert.equal(isOnlineStatus('offline'), false);
  // ⚠️ 这一条是**方向**：`undefined` 是「这条 socket 状态从没收到过」，
  //    不是「在线」也不是「离线」。当成在线会把没来的人算进模块人数里。
  assert.equal(isOnlineStatus(undefined), false);
  assert.equal(isOnlineStatus(''), false);
  // 线缆值不设防时的拼错（服务端只发这三个字面量，但读的一侧不该崩也不该乱认）
  assert.equal(isOnlineStatus('Online'), false);
  assert.equal(isOnlineStatus('在线'), false);
});

/* ── 2. 参与者的实际位置 ─────────────────────────────────────────── */

test('resolveFocus：三个模块 / 首页（null）/ 从没收到过（键不在）', () => {
  const map = { a: 'worksheet', b: null, c: 'companion' } as Record<string, 'worksheet' | 'explore' | 'companion' | null>;
  assert.equal(resolveFocus(map, 'a'), 'worksheet');
  assert.equal(resolveFocus(map, 'c'), 'companion');
  // 键在、值是 null = 「他在首页」；键**不在** = 「不知道他在哪」。
  // 合并成一件就会把「不知道」说成「在首页」—— 那是编造出来的一条事实。
  assert.equal(resolveFocus(map, 'b'), 'home');
  assert.equal(resolveFocus(map, 'zzz'), 'unknown');
});

test('🔴 resolveFocus：原型链上的键不算「收到过」（`toString` 不是模块）', () => {
  // 用 `value in map` 的写法会让 'toString' 命中 `Object.prototype.toString`，
  // 于是那一格显示成一个模块名而**屏幕上看不出异常**。
  assert.equal(resolveFocus({}, 'toString'), 'unknown');
  assert.equal(resolveFocus({}, 'constructor'), 'unknown');
});

/* ── 3. 三个模块各几人（本次改动的实质）──────────────────────────── */

test('🔴 onlineModuleDistribution：离线的**不计数**（截图里那个 8 人的成因）', () => {
  const focus = { a: 'worksheet', b: null, c: 'explore' } as const;
  const statuses = { a: 'online', b: 'offline', c: 'offline' };
  const counts = onlineModuleDistribution(['a', 'b', 'c'], focus, statuses);
  assert.equal(counts.worksheet, 1, '在线的那个');
  assert.equal(counts.explore, 0, 'c 在探究空间，但离线 —— 不该被算进去');
  assert.equal(counts.home, 0);
});

test('🔴 onlineModuleDistribution：thinking 算在线（对照：同一形状离线则不算）', () => {
  const focus = { a: 'worksheet' } as const;
  assert.equal(onlineModuleDistribution(['a'], focus, { a: 'thinking' }).worksheet, 1);
  assert.equal(onlineModuleDistribution(['a'], focus, { a: 'offline' }).worksheet, 0);
});

test('onlineModuleDistribution：首页与「不知道在哪」也各占一格（函数是完整的）', () => {
  const focus = { a: null } as const;
  const counts = onlineModuleDistribution(['a', 'b'], focus, { a: 'online', b: 'online' });
  assert.equal(counts.home, 1);
  assert.equal(counts.unknown, 1);
});

test('onlineModuleDistribution：没有位置记录的在线学生落在 unknown，不会消失', () => {
  // 「在线但一个模块都没报」是真会发生的（刚连上、还在首页那一跳之间）。
  // 落进 unknown 而不是被丢掉：丢掉的话 三个模块之和 ≠ 在线人数，而屏幕上没有东西解释差额。
  const counts = onlineModuleDistribution(['a', 'b', 'c'], { a: 'worksheet' } as const,
    { a: 'online', b: 'online', c: 'online' });
  assert.equal(counts.worksheet, 1);
  assert.equal(counts.unknown, 2);
  const sum = counts.worksheet + counts.explore + counts.companion + counts.home + counts.unknown;
  assert.equal(sum, 3, '在线的人一个都不能丢');
});

test('onlineModuleDistribution：空名册与全离线都回五个 0', () => {
  assert.deepEqual(onlineModuleDistribution([], {}, {}), { worksheet: 0, explore: 0, companion: 0, home: 0, unknown: 0 });
  assert.deepEqual(
    onlineModuleDistribution(['a'], { a: 'worksheet' } as const, { a: 'offline' }),
    { worksheet: 0, explore: 0, companion: 0, home: 0, unknown: 0 },
  );
});

test('onlineModuleDistribution：逐人累加，同一模块多人', () => {
  const counts = onlineModuleDistribution(['a', 'b', 'c'], { a: 'explore', b: 'explore', c: 'explore' } as const,
    { a: 'online', b: 'thinking', c: 'online' });
  assert.equal(counts.explore, 3);
});

/* ── 4. 点那一格筛出来的格子（必须与数字同口径）────────────────── */

test('🔴 cardInOnlineModule：成员在该模块但**离线** ⇒ 不命中（数字与格子同口径）', () => {
  const focus = { a: 'worksheet' } as const;
  assert.equal(cardInOnlineModule(['a'], 'worksheet', focus, { a: 'offline' }), false);
  // 对照：同一个人在线就命中 —— 少了这一条，一个恒 false 的实现也能过上面那句。
  assert.equal(cardInOnlineModule(['a'], 'worksheet', focus, { a: 'online' }), true);
});

test('cardInOnlineModule：在线但在别的模块 ⇒ 不命中', () => {
  assert.equal(cardInOnlineModule(['a'], 'worksheet', { a: 'explore' } as const, { a: 'online' }), false);
});

test('cardInOnlineModule：小组卡 —— 任一成员命中即命中（组是一个格子）', () => {
  const focus = { a: 'companion', b: 'worksheet' } as const;
  const statuses = { a: 'offline', b: 'online' };
  assert.equal(cardInOnlineModule(['a', 'b'], 'worksheet', focus, statuses), true, 'b 在线且在学习单');
  assert.equal(cardInOnlineModule(['a', 'b'], 'companion', focus, statuses), false, 'a 在学伴但离线');
});

test('cardInOnlineModule：空成员列表不命中（不抛）', () => {
  assert.equal(cardInOnlineModule([], 'worksheet', {}, {}), false);
});

/* ── 5. 数字与筛选必须同源 ───────────────────────────────────────── */

test('🔴 同一个人：被数字数进去 ⇔ 在自己的单人格子上命中筛选', () => {
  // 这两条判据分家过一次就是「数字写 2 人、点开 8 格」——教师 2026-09-29 选定「一起改」。
  const focus = { online_in: 'worksheet', offline_in: 'worksheet', online_out: 'explore' } as const;
  const statuses = { online_in: 'online', offline_in: 'offline', online_out: 'online' };
  const counts = onlineModuleDistribution(['online_in', 'offline_in', 'online_out'], focus, statuses);
  const hits = ['online_in', 'offline_in', 'online_out']
    .filter((id) => cardInOnlineModule([id], 'worksheet', focus, statuses)).length;
  assert.equal(counts.worksheet, hits);
  assert.equal(hits, 1);
});
