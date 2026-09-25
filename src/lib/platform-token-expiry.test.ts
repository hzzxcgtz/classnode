/**
 * ★ API Token 共享（第 5 步的判据部分）：**有效期还剩多久**。
 *
 * 这一层单独抽出来、单独断言的理由与 `worksheet-drawer-state.ts` 那批逐字相同：
 * 这里的判据错了**不抛异常、不让编译失败**，只会让教师看到一句错的结论 ——
 * 而这一句结论的作用正是「催他及时换 Token」。说错了比不说更糟。
 *
 * 🔴 「天」按**自然日**算，不按 24 小时 —— 教师看的是「还有几天」，不是「还有几小时」。
 * 所以下面每一条都拿**当天零点**举例：傍晚 23:00 与次日 01:00 只差 2 小时，
 * 但那是「明天到期」与「今天到期」，跨了一个自然日。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultExpiryDate, tokenExpiryView } from './platform-token-expiry.ts';

/** 本地时间的某一天几点。 */
function at(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}
/** 本地时间的某一天，格式化成 `<input type="date">` 要的 `YYYY-MM-DD`。 */
function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

test('🔴 未设置有效期 ⇒ 是一个**要被催促**的状态，不是沉默的默认', () => {
  const view = tokenExpiryView(null, at(2026, 9, 25));
  assert.equal(view.level, 'none');
  assert.equal(view.days, null);
  assert.equal(view.text, '未设置有效期');
  // 读不出来的值也走这一档（手改过的库 / 老格式），**不写「还剩 0 天」**：
  // 那会让教师以为今天就到期，而其实是根本不知道。
  assert.equal(tokenExpiryView('不是日期', at(2026, 9, 25)).level, 'none');
  assert.equal(tokenExpiryView(undefined, at(2026, 9, 25)).text, '未设置有效期');
});

test('🔴 天数是**自然日**之差：只差两小时也可能差一天', () => {
  // 9/25 23:00 看 9/26 到期 ⇒ 还剩 1 天（不是「不到 1 天」更不是 0 天）
  assert.equal(tokenExpiryView(ymd(2026, 9, 26), at(2026, 9, 25, 23, 0)).days, 1);
  // 9/26 01:00 看 9/26 到期 ⇒ 就是今天
  assert.equal(tokenExpiryView(ymd(2026, 9, 26), at(2026, 9, 26, 1, 0)).days, 0);
});

test('四档颜色与文案', () => {
  const now = at(2026, 9, 25);
  // > 7 天：正常
  assert.deepEqual(tokenExpiryView(ymd(2026, 10, 10), now), { level: 'ok', days: 15, text: '还剩 15 天' });
  assert.equal(tokenExpiryView(ymd(2026, 10, 3), now).level, 'ok', '8 天还属于正常档');
  // ≤ 7 天：提醒
  assert.deepEqual(tokenExpiryView(ymd(2026, 10, 1), now), { level: 'soon', days: 6, text: '还剩 6 天' });
  assert.equal(tokenExpiryView(ymd(2026, 9, 29), now).level, 'soon', '4 天仍是「提醒」档');
  // ⚠️ 边界逐条钉死：7 / 3 / 0 各自落在哪一档，是**并排的两档之间**最容易写反的地方
  assert.equal(tokenExpiryView(ymd(2026, 10, 3), now).level, 'ok', '8 天：ok（>7 才降级）');
  assert.equal(tokenExpiryView(ymd(2026, 10, 2), now).level, 'soon', '★ 7 天：soon —— spec 写的是「≤7 天」，不是「<7 天」');
  assert.equal(tokenExpiryView(ymd(2026, 10, 1), now).level, 'soon', '6 天：soon');
  assert.equal(tokenExpiryView(ymd(2026, 9, 29), now).level, 'soon', '4 天：soon');
  assert.equal(tokenExpiryView(ymd(2026, 9, 28), now).level, 'urgent', '★ 3 天：urgent —— spec 写的是「≤3 天」，不是「<3 天」');
  assert.equal(tokenExpiryView(ymd(2026, 9, 27), now).level, 'urgent', '2 天：urgent');
  // 当天
  assert.deepEqual(tokenExpiryView(ymd(2026, 9, 25), now), { level: 'urgent', days: 0, text: '今天到期' });
  // 已过期
  assert.deepEqual(tokenExpiryView(ymd(2026, 9, 22), now), { level: 'expired', days: -3, text: '已过期 3 天' });
  assert.deepEqual(tokenExpiryView(ymd(2026, 9, 24), now), { level: 'expired', days: -1, text: '已过期 1 天' });
});

test('🔴 过期的严重度不低于「今天到期」—— 这是分档的唯一单调性要求', () => {
  const now = at(2026, 9, 25);
  const order = ['ok', 'soon', 'urgent', 'expired'];
  const seen = [
    tokenExpiryView(ymd(2026, 10, 20), now).level,
    tokenExpiryView(ymd(2026, 9, 30), now).level,
    tokenExpiryView(ymd(2026, 9, 25), now).level,
    tokenExpiryView(ymd(2026, 9, 1), now).level,
  ];
  assert.deepEqual(seen, order, '越接近 / 越过期，档位只能越靠后，不能回跳');
});

test('🔴 新建时的默认有效期 = 今天 + 30 天（扣子当前的上限，教师可改）', () => {
  assert.equal(defaultExpiryDate(at(2026, 9, 25)), '2026-10-25');
  // ⚠️ 跨月、跨年、跨闰年都要对 —— `+30*86400000` 那种写法在夏令时切换那两天会差一天，
  //    而这里用的是日历加天数。
  assert.equal(defaultExpiryDate(at(2026, 12, 20)), '2027-01-19');
  assert.equal(defaultExpiryDate(at(2028, 2, 10)), '2028-03-11', '2028 是闰年（2 月有 29 天）');
});
