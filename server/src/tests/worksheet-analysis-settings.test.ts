/**
 * ★ M7b：`analysisAgentId` 是**学习单级**设置（用户 2026-09-25 裁定 4）。
 *
 * ⚠️ 它的失败是**静默**的，三种都无声：
 *   · 少改 `normalizeSettings` ⇒ 存进去又读不出来（界面上那个下拉一刷新就回到「不指定」）；
 *   · 少改类型 ⇒ 读出来是 `undefined` 而界面上什么都不显示；
 *   · 回落方向写错 ⇒ 一个坏值变成一个**会被发出去**的默认值。
 *
 * 🔴 **`normalizeSettings` 原先不导出** —— 本任务第一步就是把它 `export` 出来，
 * 而不是在用例里另抄一份判据（抄一份就是第二份真源）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings } from '../routes/worksheets.js';

test('合法的字符串 id 原样保留', () => {
  const out = normalizeSettings({ analysisAgentId: 'agent-1' }) as Record<string, unknown>;
  assert.equal(out.analysisAgentId, 'agent-1');
});

test('🔴 空串 / 非字符串 / 缺字段 一律回落 null（不是 ""）', () => {
  for (const bad of ['', 42, null, undefined, {}, []]) {
    const out = normalizeSettings({ analysisAgentId: bad }) as Record<string, unknown>;
    assert.equal(out.analysisAgentId, null, `${String(bad)} 应回落 null`);
  }
  const absent = normalizeSettings({}) as Record<string, unknown>;
  assert.equal(absent.analysisAgentId, null, '整份设置缺席时也要有这一格（界面上那个下拉读它）');
});

test('🔴 它**没有默认智能体**是刻意的（默认指定 = 默认把学生作业发出去）', () => {
  // 这条是「用断言把一条设计决定钉住」：将来若有人出于「方便」给一个默认值，
  // 这条会红，而红的时候那句话就在断言消息里。
  const out = normalizeSettings({}) as Record<string, unknown>;
  assert.equal(out.analysisAgentId, null,
    '默认指定一个分析智能体等于「默认外发全班作业」—— 要改这条得先改规格 §3.2');
});

test('既有六件不受影响（加字段不许碰它们）', () => {
  const out = normalizeSettings({ allowResubmit: false, autoGrade: false }) as Record<string, unknown>;
  assert.equal(out.allowResubmit, false);
  assert.equal(out.autoGrade, false);
  assert.equal(out.rewardStyle, 'star');
  assert.equal(out.rewardStep, 1);
  assert.equal(out.halfStep, 0);
  assert.equal(out.defaultInputMode, 'keyboard');
});

test('🔴 四档开放方式都原样落库（少认一档 ⇒ 那份卷子静默变回「开放式」）', () => {
  // ★ 2026-09-30 加了第四档 `manual`（教师在看板上逐题开放）。
  // 🔴 危险的失效方向是**静默降级**：`WORKSHEET_ANSWER_MODES` 少一档，教师配好的
  //    「手动逐题开放」保存一次就变回 `open` —— 学生的屏幕会**整个放开**，
  //    而界面上没有任何提示（教师以为自己锁着，学生已经在做后面的题了）。
  for (const answerMode of ['open', 'task-step', 'question-step', 'manual']) {
    const out = normalizeSettings({ answerMode }) as Record<string, unknown>;
    assert.equal(out.answerMode, answerMode, `${answerMode} 应原样保留`);
  }
  // 认不出的值回落 `open`（= 什么都不拦，与「设置读不出来时不该把学生锁上」同向）。
  const bad = normalizeSettings({ answerMode: '第五档' }) as Record<string, unknown>;
  assert.equal(bad.answerMode, 'open');
});

test('★ 2026-09-30：「提交后可以修改」的默认是**关**（教师：「默认不能修改」）', () => {
  // 🔴 这一格是**默认值**那一半的服务端：`normalizeSettings` 决定「缺这个键的行长什么样」，
  //    前端 `worksheet-editor-core.ts` 的 `DEFAULT_SETTINGS` 决定「新建的学习单长什么样」。
  //    两处必须同值 —— 分叉的表现是「教师新建时看到的是 A、学生端生效的是 B」，
  //    而两边都不报错（前端 `worksheet-editor-core.test.ts` 有一条跨文件核对的用例钉着这一对）。
  const absent = normalizeSettings({}) as Record<string, unknown>;
  assert.equal(absent.allowResubmit, false, '缺键 ⇒ 不能修改');
  // ⚠️ 改的是**默认值**，不是存量：教师当年显式打开过的那几张单不受影响。
  assert.equal((normalizeSettings({ allowResubmit: true }) as Record<string, unknown>).allowResubmit, true);
  assert.equal((normalizeSettings({ allowResubmit: false }) as Record<string, unknown>).allowResubmit, false);
});

test('十一种卡通奖励都会原样落库，坏值仍回落星星', () => {
  for (const rewardStyle of [
    'classnode', 'star', 'flower', 'trophy', 'bear', 'rocket',
    'gem', 'crown', 'lightning', 'bulb', 'key',
  ]) {
    const out = normalizeSettings({ rewardStyle }) as Record<string, unknown>;
    assert.equal(out.rewardStyle, rewardStyle);
  }
  const bad = normalizeSettings({ rewardStyle: 'rainbow' }) as Record<string, unknown>;
  assert.equal(bad.rewardStyle, 'star');
  const removed = normalizeSettings({ rewardStyle: 'correctness' }) as Record<string, unknown>;
  assert.equal(removed.rewardStyle, 'star', '已移除的对错档读取后回落星星');
});

test('横竖屏自定义背景分别保留站内上传地址，外部地址一律清空', () => {
  const out = normalizeSettings({
    backgroundTheme: 'custom',
    backgroundImageUrl: '/uploads/chat/landscape.webp',
    backgroundPortraitImageUrl: '/uploads/chat/portrait.webp',
  }) as Record<string, unknown>;
  assert.equal(out.backgroundTheme, 'custom');
  assert.equal(out.backgroundImageUrl, '/uploads/chat/landscape.webp');
  assert.equal(out.backgroundPortraitImageUrl, '/uploads/chat/portrait.webp');

  const unsafe = normalizeSettings({
    backgroundImageUrl: 'https://example.com/landscape.webp',
    backgroundPortraitImageUrl: 'data:image/webp;base64,unsafe',
  }) as Record<string, unknown>;
  assert.equal(unsafe.backgroundImageUrl, null);
  assert.equal(unsafe.backgroundPortraitImageUrl, null);
});
