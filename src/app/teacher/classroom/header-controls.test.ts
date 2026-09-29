/**
 * 教师看板头部**有哪些控件、各叫什么、禁不禁用**的判据（★ 2026-09-29，教师选「乙」）。
 *
 * 🔴 这一层为什么存在：那 6–9 个控件的「在不在 / 叫什么 / 禁不禁用」原先全写在 260k 的
 * `page.tsx` 的 JSX 里，**没有任何回归网**。而它每一条错了都**不报错** ——
 * `同步分组` 的两道条件、`全屏` 只在指定模式、两个开关的标签翻转、三个忙态键：
 * 屏幕上只是「按钮不对 / 不见了」，没有任何东西会红。
 *
 * ⚠️ 本文件里每一个条件都配了**阴性对照**（同一形状但条件不满足时它必须不在）。
 * 只断言「分组模式有同步分组」，那么一个恒返回全表的实现也能全绿。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HEADER_BUSY_KEYS, headerControls, headerLayout, type HeaderControlId, type HeaderLayoutInput,
} from './header-controls.ts';

/** 一个「什么都正常」的课堂：标准模式、进行中、未暂停、跟随、非全屏、不忙。 */
const BASE: HeaderLayoutInput = {
  mode: 'standard',
  status: 'active',
  paused: false,
  answersLocked: false,
  boardMode: 'follow',
  gridFullscreen: false,
  busy: null,
  permissionsOpen: false,
  modulesOpen: false,
};

function ids(input: Partial<HeaderLayoutInput> = {}): HeaderControlId[] {
  return headerControls({ ...BASE, ...input }).map((control) => control.id);
}

function control(id: HeaderControlId, input: Partial<HeaderLayoutInput> = {}) {
  const found = headerControls({ ...BASE, ...input }).filter((item) => item.id === id)[0];
  assert.ok(found, `这次输入里应当有 ${id}`);
  return found;
}

/** 悬浮说明不参与这些用例的判据 —— 单独一条用例管它。 */
function stripText(controls: ReturnType<typeof headerControls>) {
  return controls.map(({ label, id }) => `${id}=${label}`);
}

/* ── 1. 清单本身：有哪些、按什么顺序、怎么分组 ─────────────────────── */

test('🔴 标准模式 + 跟随：正好这七个控件，按「状态｜动作｜看数据｜设置」排', () => {
  assert.deepEqual(stripText(headerControls(BASE)), [
    'pause=暂停课堂',
    'lock=锁定作答',
    'notify=通知全体',
    'worksheet=学习单',
    'matrix=矩阵',
    'permissions=课堂权限',
    'module-state=模块状态',
  ]);
});

test('🔴 分组边界由 `startsGroup` 给出（渲染层只管画线，不做判断）', () => {
  const controls = headerControls(BASE);
  // 第一项恒 false —— 一个开在最左边的分隔线是没有意义的。
  assert.deepEqual(controls.map((c) => c.startsGroup), [false, false, true, true, false, true, false]);
  assert.deepEqual(controls.map((c) => c.kind), [
    'state', 'state', 'action', 'view', 'view', 'setting', 'setting',
  ]);
});

test('🔴 矩阵紧挨着学习单（它们是同一件事的两面，原来被两个设置项隔开）', () => {
  const list = ids();
  assert.equal(list.indexOf('matrix'), list.indexOf('worksheet') + 1);
});

test('🔴 暂停课堂排在锁定作答之前（两个最常用的状态开关在最左）', () => {
  const list = ids();
  assert.equal(list.indexOf('pause'), 0);
  assert.equal(list.indexOf('lock'), 1);
});

test('🔴 没有重复的 id（重复 = 屏幕上两个「暂停课堂」）', () => {
  const list = ids();
  assert.equal(new Set(list).size, list.length);
});

/* ── 2. 同步分组：两道条件（分组/高级 且 未结束）──────────────────── */

test('🔴 同步分组：标准模式**没有**它（阴性对照：分组模式有）', () => {
  assert.equal(ids().indexOf('sync-groups'), -1);
  assert.ok(ids({ mode: 'group' }).indexOf('sync-groups') !== -1);
  assert.ok(ids({ mode: 'advanced' }).indexOf('sync-groups') !== -1);
});

test('🔴 同步分组：课堂**已结束**时没有它（阴性对照：进行中有）', () => {
  assert.equal(ids({ mode: 'group', status: 'ended' }).indexOf('sync-groups'), -1);
  assert.ok(ids({ mode: 'group', status: 'active' }).indexOf('sync-groups') !== -1);
});

test('⚠️ 同步分组：`paused` 的课堂仍然有它（暂停 ≠ 结束）', () => {
  // 暂停只是停了学生的三件套，分组仍然是活的 —— 写成「非 active 就没有」会让教师
  // 在一个暂停的课堂里改完分组名却同步不过去。
  assert.ok(ids({ mode: 'group', status: 'paused' }).indexOf('sync-groups') !== -1);
});

/* ── 3. 全屏：只在指定模式 ─────────────────────────────────────── */

test('🔴 全屏只在指定模式出现（跟随模式下每格是不同模块，铺满没有意义）', () => {
  assert.equal(ids({ boardMode: 'follow' }).indexOf('fullscreen'), -1);
  assert.ok(ids({ boardMode: 'assign' }).indexOf('fullscreen') !== -1);
});

/* ── 4. 状态开关：标签翻转、两个不许同名 ─────────────────────────── */

test('🔴 暂停课堂的标签随状态翻转（恢复课堂 ⇄ 暂停课堂）', () => {
  assert.equal(control('pause').label, '暂停课堂');
  assert.equal(control('pause', { paused: true }).label, '恢复课堂');
  assert.equal(control('pause').active, false);
  assert.equal(control('pause', { paused: true }).active, true);
});

test('🔴 锁定作答的标签随状态翻转（解锁作答 ⇄ 锁定作答）', () => {
  assert.equal(control('lock').label, '锁定作答');
  assert.equal(control('lock', { answersLocked: true }).label, '解锁作答');
  assert.equal(control('lock', { answersLocked: true }).active, true);
});

test('🔴 两个状态开关**在任何组合下都不同名**（教师分不清自己按的是哪一个）', () => {
  // 一个是停课、一个是停笔。同名 = 一次误按 = 整节课被暂停，而屏幕上没有任何提示说按错了。
  for (const paused of [false, true]) {
    for (const answersLocked of [false, true]) {
      const a = control('pause', { paused, answersLocked }).label;
      const b = control('lock', { paused, answersLocked }).label;
      assert.notEqual(a, b, `paused=${paused} answersLocked=${answersLocked} 时两个开关同名：${a}`);
    }
  }
});

test('🔴 两个开关的 `active` 各管各的（暂停课堂不会把锁定作答也点亮）', () => {
  const controls = headerControls({ ...BASE, paused: true });
  assert.equal(controls.filter((c) => c.id === 'lock')[0].active, false);
});

/* ── 5. 忙态：只动那三个，别的不受影响 ───────────────────────────── */

test('🔴 忙态键只留一份（三个键的名字就是读写两处共用的那一份）', () => {
  assert.deepEqual(HEADER_BUSY_KEYS, {
    syncGroups: 'sync-groups', pause: 'questions', lock: 'answers-lock',
  });
});

test('🔴 忙的时候那三个控件显示忙态文案并禁用', () => {
  assert.equal(control('pause', { busy: HEADER_BUSY_KEYS.pause }).label, '更新中...');
  assert.equal(control('lock', { busy: HEADER_BUSY_KEYS.lock }).label, '更新中...');
  assert.equal(control('sync-groups', { mode: 'group', busy: HEADER_BUSY_KEYS.syncGroups }).label, '同步中...');
  assert.equal(control('pause', { busy: HEADER_BUSY_KEYS.pause }).disabled, true);
  assert.equal(control('lock', { busy: HEADER_BUSY_KEYS.lock }).disabled, true);
});

test('🔴 忙态**文案**是逐个的：锁定在忙，暂停课堂的字照旧是「暂停课堂」', () => {
  const busyLock = headerControls({ ...BASE, busy: HEADER_BUSY_KEYS.lock });
  assert.equal(busyLock.filter((c) => c.id === 'lock')[0].label, '更新中...');
  assert.equal(busyLock.filter((c) => c.id === 'pause')[0].label, '暂停课堂');
});

test('🔴 忙态**禁用**是整排的 —— 与 `runControlAction` 的 ref 守卫同口径', () => {
  // 🔴 这一条是**故意与直觉相反**的（本用例的第一版按「逐个禁用」写，实测红了才去核原码）：
  // `runControlAction` 开头是 `if (controlBusyRef.current) return;` —— 任何控制动作在飞的时候，
  // 另外两个**点了也没反应**。⇒ 只禁用「正在忙的那一个」会做出「看着能点、点了没反应」的按钮，
  // 那比整排变灰糟得多。所以：**文案**随各自那个键走，**禁用**跟着 `busy !== null`。
  const busyLock = headerControls({ ...BASE, busy: HEADER_BUSY_KEYS.lock });
  assert.equal(busyLock.filter((c) => c.id === 'pause')[0].disabled, true);
  assert.equal(busyLock.filter((c) => c.id === 'lock')[0].disabled, true);
});

test('⚠️ 任意一个忙态键都禁用那三个（含探究空间的采集键 —— 判据宽是有意的）', () => {
  // `controlBusy` 不是头部专用的：探究空间那两个采集分组（`'capture-*'`）也走
  // `runControlAction` ⇒ 它们同样占着 ref 守卫。判据写成「只认头部那三个键」的话，
  // 采集设置保存期间三个按钮**看着能点**，而 ref 守卫会把点击吞掉。
  const controls = headerControls({ ...BASE, busy: 'capture-width-320' });
  for (const id of ['pause', 'lock', 'notify'] as const) {
    assert.equal(controls.filter((c) => c.id === id)[0].disabled, id !== 'notify', `${id}`);
  }
  // ⚠️ 而**文案**不该因为他人的忙态变样（认不出的键没有任何一项显示「…中...」）。
  assert.equal(controls.every((c) => !c.label.includes('中...')), true);
});

test('🔴 忙态不影响另外四个（通知 / 学习单 / 矩阵 / 两个设置项）', () => {
  const controls = headerControls({ ...BASE, busy: HEADER_BUSY_KEYS.pause });
  for (const id of ['notify', 'worksheet', 'matrix', 'permissions', 'module-state'] as const) {
    const item = controls.filter((c) => c.id === id)[0];
    assert.equal(item.disabled, false, `${id} 不该被别的控件的忙态禁用`);
  }
});

/* ── 6. 浮层：哪种、开着没有 ─────────────────────────────────── */

test('🔴 两个设置项各自说自己开的是哪种浮层，以及开合态', () => {
  assert.equal(control('permissions').popup, 'dialog');
  assert.equal(control('module-state').popup, 'menu');
  assert.equal(control('permissions', { permissionsOpen: true }).expanded, true);
  assert.equal(control('permissions').expanded, false);
  assert.equal(control('module-state', { modulesOpen: true }).expanded, true);
});

test('⚠️ 非设置项没有浮层（`popup: null`）—— 别给普通按钮挂 aria-haspopup', () => {
  for (const id of ['pause', 'lock', 'notify', 'worksheet', 'matrix'] as const) {
    assert.equal(control(id).popup, null, `${id}`);
    assert.equal(control(id).expanded, false, `${id}`);
  }
});

/* ── 7. 悬浮说明（原来写死在 JSX 里的那几句）────────────────────── */

test('🔴 三句既有的悬浮说明逐字保留（它们是唯一的解释来源）', () => {
  assert.equal(control('pause').title, '暂停后学生无法使用三件套中的任何功能');
  assert.equal(control('lock').title, '停笔：学生不能再修改答案，但仍然可以交卷');
  assert.equal(control('sync-groups', { mode: 'group' }).title, '把当前班级的分组名称和成员同步到正在进行的课堂');
  assert.equal(control('worksheet').title, '按学习单看全班：先按学习单分组，再按题看正确率与作答');
  assert.equal(control('matrix').title, '学生×题目矩阵：一眼看出此刻该讲哪一题');
  assert.equal(control('fullscreen', { boardMode: 'assign' }).title, '全屏显示学生面板');
});

/* ── 8. `headerLayout`：头部那几段显不显示 ─────────────────────── */

test('🔴 全屏时整块头部（含模块筛选那一段）都不显示', () => {
  // 全屏把整个头部藏掉（`page.tsx` 的 `!gridFullscreen`），而这两段是头部的一部分。
  assert.equal(headerLayout({ ...BASE, gridFullscreen: true }).showsHeader, false);
  assert.equal(headerLayout({ ...BASE, gridFullscreen: true }).showsModuleFilter, false);
  assert.equal(headerLayout(BASE).showsHeader, true);
});

test('🔴 模块筛选只在跟随模式显示（指定模式下全班是同一个模块，按模块筛只剩全中/全不中）', () => {
  assert.equal(headerLayout({ ...BASE, boardMode: 'follow' }).showsModuleFilter, true);
  assert.equal(headerLayout({ ...BASE, boardMode: 'assign' }).showsModuleFilter, false);
});

test('⚠️ 指定模式仍然有看板模式那一段（否则切不回跟随）', () => {
  const layout = headerLayout({ ...BASE, boardMode: 'assign' });
  assert.equal(layout.showsHeader, true);
  assert.ok(layout.controls.some((c) => c.id === 'fullscreen'));
});
