/**
 * 教师看板头部**有哪些控件、各叫什么、禁不禁用**的判据（★ 2026-09-29，教师选「乙」）。
 *
 * 🔴 这一层为什么存在：那 6–9 个控件的「在不在 / 叫什么 / 禁不禁用」原先全写在 260k 的
 * `page.tsx` 的 JSX 里，**没有任何回归网**。而它每一条错了都**不报错** ——
 * `同步分组` 的两道条件、两个开关的标签翻转、三个忙态键：
 * 屏幕上只是「按钮不对 / 不见了」，没有任何东西会红。
 * （★ 2026-09-30：「全屏只在指定模式」那一条已取消，见第 3 节。）
 *
 * ⚠️ 本文件里每一个条件都配了**阴性对照**（同一形状但条件不满足时它必须不在）。
 * 只断言「分组模式有同步分组」，那么一个恒返回全表的实现也能全绿。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPANION_MENU_ITEMS, HEADER_BUSY_KEYS, WORKSHEET_MENU_ITEMS, headerControlGroups, headerControls, headerLayout, type HeaderControlId, type HeaderLayoutInput,
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
  worksheetMenuOpen: false,
  exploreOpen: false,
  companionMenuOpen: false,
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

test('🔴 标准模式 + 跟随：正好这八个控件，按**教师定死的三组**排', () => {
  // ★ 2026-09-30（教师第三轮）：「这个分类我认为是这样分：暂停课堂和锁定作答是一类，
  // 全体消息、全屏、模块状态是一类，学习单、探究空间和智能学伴是一类，并且按这个顺序。」
  // ⚠️ 顺序**变了**：全屏与模块状态原来一个在第 5 位、一个在最后，现在都并进第二组。
  assert.deepEqual(stripText(headerControls(BASE)), [
    // ① 课堂状态
    'pause=暂停课堂',
    'lock=锁定作答',
    // ② 对全班 / 整屏起作用
    'notify=全体消息',
    'fullscreen=全屏',
    'module-state=模块状态',
    // ③ 三个模块各自的入口
    'worksheet-menu=学习单',
    'explore-settings=探究空间',
    'companion-menu=智能学伴',
  ]);
});

test('🔴 分组是**结构**（一个盒子装一组），不是「在第几个前面画一条线」', () => {
  const controls = headerControls(BASE);
  assert.deepEqual(controls.map((c) => c.kind), [
    'state', 'state',
    'global', 'global', 'global',
    'module', 'module', 'module',
  ]);
  // 🔴 为什么把 `startsGroup` 那个布尔换成 `headerControlGroups`：前者要求**渲染层自己
  //    数边界**（判据只给了一个「这里要画线」的位），而屏幕上真正的形状是「三组、
  //    每组一个盒子」—— 用布尔表达时，「三组」这个事实在判据层里**根本没有出现过**，
  //    一条用例也就钉不住它。改成返回分组之后，下面这一条就是那个事实本身。
  assert.deepEqual(headerControlGroups(controls).map((group) => group.map((c) => c.id)), [
    ['pause', 'lock'],
    ['notify', 'fullscreen', 'module-state'],
    ['worksheet-menu', 'explore-settings', 'companion-menu'],
  ]);
});

test('🔴 同步分组进第 2 组、排在最前（它和「全体消息」一样是对全班做一件事）', () => {
  // ⚠️ 教师这一轮**没有点名它**（标准模式下它压根不出现）⇒ 这条是实施时定的：
  //    它是个**动作**（把班级的分组同步进课堂），既不是课堂状态开关，
  //    也不是某个模块自己的入口 ⇒ 只能进第 2 组。教师看到后可以改。
  assert.deepEqual(headerControlGroups(headerControls({ ...BASE, mode: 'group' })).map((g) => g.map((c) => c.id)), [
    ['pause', 'lock'],
    ['sync-groups', 'notify', 'fullscreen', 'module-state'],
    ['worksheet-menu', 'explore-settings', 'companion-menu'],
  ]);
});

test('🔴 `headerControlGroups`：不丢项、不重排（把清单摊平必须与输入逐项相同）', () => {
  // ⚠️ 这条是那个函数的**安全阀**：它按 `kind` 分组，一旦分错（比如按 `popup` 分、
  //    或者漏掉某一类），下面三组里就会少东西或多东西 —— 而屏幕上是「某个按钮不见了」，
  //    不报错。摊平回去逐项比，是唯一能挡住它的写法。
  for (const input of [BASE, { ...BASE, mode: 'group' }, { ...BASE, status: 'ended' }] as HeaderLayoutInput[]) {
    const controls = headerControls(input);
    assert.deepEqual(headerControlGroups(controls).flat().map((c) => c.id), controls.map((c) => c.id));
  }
});

test('🔴 学习单 / 矩阵 已经合成一个下拉：不再有那两个各自独立的按钮', () => {
  // ★ 2026-09-29（教师）：「两者合并成一个『学习单』，通过鼠标点击下拉后选择」。
  const list = ids();
  assert.ok(list.includes('worksheet-menu'));
  assert.equal(list.includes('worksheet' as HeaderControlId), false, '原来的「学习单」按钮不该还在');
  assert.equal(list.includes('matrix' as HeaderControlId), false, '原来的「矩阵」按钮不该还在');
});

test('🔴 学习单下拉：三个查看入口在前，一个课堂控制动作在后', () => {
  // ★ 2026-09-30：「逐题开放」并进来成了第三项。前两项是**看**，第三项**当着全班改**
  // 学生屏幕上有什么 —— 顺序不是随手排的，改的人要能一眼分清。
  assert.deepEqual(WORKSHEET_MENU_ITEMS.map((item) => item.label), ['学习单总览', '按学生查看', '按题目查看', '逐题开放']);
  assert.deepEqual(WORKSHEET_MENU_ITEMS.map((item) => item.id), ['overview', 'student', 'question', 'open']);
  // ⚠️ 三项的 id 必须互不相同 —— 相同的话菜单里点哪一项都会开同一个东西，而屏幕上不报错。
  assert.equal(new Set(WORKSHEET_MENU_ITEMS.map((item) => item.id)).size, WORKSHEET_MENU_ITEMS.length);
  // ⚠️ 每一项都要有一句悬浮说明：那个下拉里三项挤在一起，标题是唯一说清「按下去会怎样」的地方。
  for (const item of WORKSHEET_MENU_ITEMS) {
    assert.ok(item.title.length > 0, `${item.id} 没有悬浮说明`);
  }
});

test('🔴 「课堂权限」已经取消：它的两段各自成按钮（学习单那一段本来就没有开关）', () => {
  const list = ids();
  assert.equal(list.includes('permissions' as HeaderControlId), false, '课堂权限按钮应当消失');
  assert.ok(list.includes('explore-settings') && list.includes('companion-menu'));
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

/* ── 3. 全屏：两种看板模式都有 ─────────────────────────────────── */

test('🔴 全屏在**两种**看板模式下都出现（跟随模式曾经被藏掉，教师报过）', () => {
  // ★ 2026-09-30（教师）：「之前看板里有一个全屏功能，现在跟随模式下按钮没有了」。
  // 原判据是 `boardMode === 'assign'`，理由是「跟随模式下每格是不同模块，铺满没有意义」——
  // 那条理由站不住：覆盖层逐格调 `resolveTileModule`（与主看板**同一个**函数），
  // 跟随模式下每格照旧画那个学生此刻的模块。
  // ⚠️ 这条用例只钉「按钮在不在」；「铺满之后每格画得对不对」在 `page.tsx`
  //    （那一层没有回归网，见文件头那句话）。
  assert.ok(ids({ boardMode: 'follow' }).indexOf('fullscreen') !== -1, '跟随模式下必须有全屏');
  assert.ok(ids({ boardMode: 'assign' }).indexOf('fullscreen') !== -1, '指定模式下也必须有全屏');
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
  for (const id of ['notify', 'worksheet-menu', 'explore-settings', 'companion-menu', 'module-state'] as const) {
    const item = controls.filter((c) => c.id === id)[0];
    assert.equal(item.disabled, false, `${id} 不该被别的控件的忙态禁用`);
  }
});

/* ── 6. 浮层：哪种、开着没有 ─────────────────────────────────── */

test('🔴 每个设置项各自说自己开的是哪种浮层，以及开合态', () => {
  assert.equal(control('explore-settings').popup, 'dialog');
  assert.equal(control('module-state').popup, 'menu');
  assert.equal(control('worksheet-menu').popup, 'menu', '「学习单」是个下拉');
  assert.equal(control('explore-settings', { exploreOpen: true }).expanded, true);
  assert.equal(control('explore-settings').expanded, false);
  assert.equal(control('companion-menu').popup, 'menu', '「智能学伴」是个下拉（对话分析 / 设置）');
  assert.equal(control('companion-menu', { companionMenuOpen: true }).expanded, true);
  assert.equal(control('module-state', { modulesOpen: true }).expanded, true);
  assert.equal(control('worksheet-menu', { worksheetMenuOpen: true }).expanded, true);
});

test('⚠️ 非设置项没有浮层（`popup: null`）—— 别给普通按钮挂 aria-haspopup', () => {
  for (const id of ['pause', 'lock', 'notify'] as const) {
    assert.equal(control(id).popup, null, `${id}`);
    assert.equal(control(id).expanded, false, `${id}`);
  }
});

/* ── 7. 悬浮说明（原来写死在 JSX 里的那几句）────────────────────── */

test('🔴 关键悬浮说明与两个分析维度一致（它们是唯一的解释来源）', () => {
  assert.equal(control('pause').title, '暂停后学生无法使用三件套中的任何功能');
  assert.equal(control('lock').title, '停笔：学生不能再修改答案，但仍然可以交卷');
  assert.equal(control('sync-groups', { mode: 'group' }).title, '把当前班级的分组名称和成员同步到正在进行的课堂');
  assert.equal(control('worksheet-menu').title, '按题分析全班，或按学生分析整份学习单');
  assert.equal(control('fullscreen').title, '全屏显示学生面板');
  // 那两项各自的悬浮说明在 `WORKSHEET_MENU_ITEMS` 里（它们不是头部的控件）。
  assert.equal(WORKSHEET_MENU_ITEMS[0].title, '用学生 × 题目的矩阵查看全班进度，并快速进入详情');
  assert.equal(WORKSHEET_MENU_ITEMS[1].title, '查看某个学生或小组整份学习单的完成情况');
  assert.equal(WORKSHEET_MENU_ITEMS[2].title, '查看某一道题的全班统计与具体作答');
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

test('🔴 「智能学伴」那个下拉里的两项：教师给的两个名字', () => {
  assert.deepEqual(COMPANION_MENU_ITEMS.map((item) => item.label), ['对话分析', '设置']);
  assert.equal(new Set(COMPANION_MENU_ITEMS.map((item) => item.id)).size, 2);
});
