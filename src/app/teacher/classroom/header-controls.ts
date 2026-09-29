/**
 * 教师看板头部**有哪些控件、各叫什么、禁不禁用**的判据（★ 2026-09-29，教师选「乙」）。
 *
 * 🔴 这一层为什么存在：那 6–9 个控件的「在不在 / 叫什么 / 禁不禁用」原先全写在 260k 的
 * `page.tsx` 的 JSX 里，**没有任何回归网**。而它每一条错了都**不报错** ——
 * `同步分组` 的两道条件、`全屏` 只在指定模式、两个开关的标签翻转、三个忙态键：
 * 屏幕上只是「按钮不对 / 不见了」，没有任何东西会红。
 *
 * ⚠️ 本文件**零运行时 import**（`node --test` 直接跑）。类型也只收**字符串**：
 * `mode` / `status` / `boardMode` 都按联合类型收窄在这里，而不是 import 那三个类型 ——
 * 那些类型住在 `page.tsx`（260k）与 `@/lib/types`，为一个「拿几个字符串比一比」的函数
 * 去依赖它们，收益为零而耦合是实的。
 *
 * ── 屏幕上的形状（按性质分四段，段之间一条分隔线）──────────────────────
 *   [暂停课堂][锁定作答] │ [同步分组][通知全体] │ [学习单][矩阵][全屏] │ [课堂权限▾][模块状态▾]
 *
 * 为什么会「杂乱」（教师的原话）：这五种东西原先**完全同级** —— 同一套 `btn-secondary`、
 * 同样 36px 高、同样内边距。⇒ 分组靠**位置与分隔线**表达，不靠颜色深浅
 * （那是投影给全班看的屏，把按钮改淡有真实的可发现性代价）。
 */

/** 一个控件属于哪一类。**顺序就是屏幕上的顺序**（`state` → `action` → `view` → `setting`）。 */
export type HeaderControlKind = 'state' | 'action' | 'view' | 'setting';

export type HeaderControlId =
  /** 课堂状态开关：暂停 / 恢复整节课。 */
  | 'pause'
  /** 课堂状态开关：停笔（仍可交卷）。 */
  | 'lock'
  /** 把班级的分组同步进课堂（只在分组 / 高级模式、且课堂未结束时才有）。 */
  | 'sync-groups'
  /** 给全班发一条消息（★ 2026-09-29：原名「通知全体」）。 */
  | 'notify'
  /**
   * ★ 2026-09-29（教师）：「『学习单』改名为『答题分析』，『矩阵』改名为『进度矩阵』，
   * 两者合并成一个『学习单』，通过鼠标点击下拉后选择」。
   * ⇒ 两个入口合成一个**下拉**，里面那两项见 `WORKSHEET_MENU_ITEMS`。
   */
  | 'worksheet-menu'
  /** 把格子铺满整屏（只在指定模式才有）。 */
  | 'fullscreen'
  /** ★ 2026-09-29：探究空间自己的设置弹窗（原来在「课堂权限」里的那一段）。 */
  | 'explore-settings'
  /** ★ 2026-09-29：智能学伴自己的设置弹窗（原来在「课堂权限」里的那一段）。 */
  | 'companion-settings'
  /** 模块三态菜单。 */
  | 'module-state';

/**
 * ★ 2026-09-29：「学习单」那个下拉里的两项。
 *
 * 🔴 标签放这里而不是写进 `WorksheetMenu` 的 JSX：教师这次**逐字给了这两个名字**，
 * 而一个下拉丢掉一项、或某一项改了名字，在屏幕上只是「少一个入口」——
 * 没有任何东西会红。放这儿就有一条用例钉着。
 */
export const WORKSHEET_MENU_ITEMS: ReadonlyArray<{ id: 'analysis' | 'matrix'; label: string; title: string }> = [
  {
    id: 'analysis',
    label: '答题分析',
    title: '按学习单看全班：先按学习单分组，再按题看正确率与作答',
  },
  {
    id: 'matrix',
    label: '进度矩阵',
    title: '学生×题目矩阵：一眼看出此刻该讲哪一题',
  },
];

/**
 * 忙态键。🔴 **只在这一份**：`runControlAction('answers-lock', …)` 那三个调用点写的是
 * 这几个字面量，而读它们的是本文件 —— 两处各写一份时，改一处会让忙态文案**永远不出现**
 *（按钮看着能点、点了没反应），而没有任何东西会红。
 */
export const HEADER_BUSY_KEYS = {
  syncGroups: 'sync-groups',
  pause: 'questions',
  lock: 'answers-lock',
} as const;

export interface HeaderControl {
  id: HeaderControlId;
  /** 屏幕上的字。**含忙态与状态翻转** —— 调用方不再自己拼三元。 */
  label: string;
  /** 悬浮说明。`''` = 不画 `title` 属性（不是画一个空的）。 */
  title: string;
  /** 已激活的**状态开关**（画主色）。非开关恒 `false`。 */
  active: boolean;
  disabled: boolean;
  kind: HeaderControlKind;
  /**
   * 这一格之前画一条分隔线（组边界）。**第一项恒 `false`** ——
   * 一个开在最左边的分隔线没有意义。
   */
  startsGroup: boolean;
  /** 打开的是哪种浮层（`null` = 普通按钮，不挂 `aria-haspopup`）。 */
  popup: 'dialog' | 'menu' | null;
  /** 那种浮层此刻开着没有（`aria-expanded`）。`popup: null` 时恒 `false`。 */
  expanded: boolean;
}

export interface HeaderLayoutInput {
  /** 课堂模式。只认 `'group'` / `'advanced'`（其余按标准模式处理）。 */
  mode: string;
  /** 课堂状态。`'ended'` 时同步分组不再出现。 */
  status: string;
  /** 整节课暂停中。 */
  paused: boolean;
  /** 作答锁定中。 */
  answersLocked: boolean;
  boardMode: 'follow' | 'assign';
  gridFullscreen: boolean;
  /** `controlBusy` 的当前值（`null` = 不忙）。**别的分组也在用这个 state**，见下面那条注释。 */
  busy: string | null;
  /** 「学习单」那个下拉开着没有。 */
  worksheetMenuOpen: boolean;
  /** 探究空间设置弹窗开着没有。 */
  exploreOpen: boolean;
  /** 智能学伴设置弹窗开着没有。 */
  companionOpen: boolean;
  /** 模块三态菜单开着没有。 */
  modulesOpen: boolean;
}

export interface HeaderLayout {
  controls: HeaderControl[];
  /**
   * **整块头部**（标题行 / 看板模式那一段 / 筛选行）显不显示。
   *
   * 🔴 全屏时整个头部被藏掉 —— 那是三处**同一个条件**（原来写成三个 `!gridFullscreen`）。
   * ⚠️ 统一它是有意的：三个各写一遍时，加第四个要藏的东西必然漏掉一处，
   * 而屏幕上只是「全屏了还有一行东西挂着」。
   */
  showsHeader: boolean;
  /**
   * 模块筛选那一段显不显示。
   *
   * 🔴 只在**跟随**模式：指定模式下全班的格子都是教师选的那一个模块
   * （`resolveTileModule` 直接返回 `assignModule`），按模块筛就只剩「全中」与「全不中」
   * 两种结果 —— 那种筛选器对教师毫无用处，却会让人以为它坏了。
   */
  showsModuleFilter: boolean;
}

/** 内部构造：把「通用字段」与「每个控件自己那几句」分开，免得每一项写六遍。 */
function build(
  id: HeaderControlId,
  kind: HeaderControlKind,
  label: string,
  extra: Partial<Omit<HeaderControl, 'id' | 'kind' | 'label'>> = {},
): HeaderControl {
  return {
    id, kind, label,
    title: '', active: false, disabled: false, startsGroup: false, popup: null, expanded: false,
    ...extra,
  };
}

/**
 * 这一屏头部此刻有哪些控件。
 *
 * ⚠️ 顺序即屏幕上的顺序。`startsGroup` 由**类别变化**推出（不是手写一串布尔）——
 * 手写的那一串会在「同步分组不出现」时分错组（标准模式下它就是缺席的，而它的下一个
 * 通知全体属于另一类）。
 */
export function headerControls(input: HeaderLayoutInput): HeaderControl[] {
  const busyPause = input.busy === HEADER_BUSY_KEYS.pause;
  const busyLock = input.busy === HEADER_BUSY_KEYS.lock;
  const busySync = input.busy === HEADER_BUSY_KEYS.syncGroups;
  /**
   * 🔴 **禁用是整排的，而文案是逐个的** —— 这一条与直觉相反，理由在 `page.tsx` 的
   * `runControlAction`：它开头是 `if (controlBusyRef.current) return;` ⇒ 任何控制动作在飞时，
   * 另外两个**点了也没反应**。只禁用「正在忙的那一个」会做出「看着能点、点了没反应」的按钮，
   * 比整排变灰糟得多。
   *
   * ⚠️ 判据是 `busy !== null` 而**不是**「三个键之一」：`controlBusy` 不是头部专用的，
   * 探究空间那两个采集分组（`'capture-*'`）也走同一个 `runControlAction`、占同一个 ref 守卫。
   * （本用例的第一版按「逐个禁用 + 只认那三个键」写，实测两处都红了 —— 那是这次抽判据
   * 顺手抓出来的一个真问题：采集设置保存期间三个按钮看着能点。）
   */
  const anyBusy = input.busy !== null;

  const controls: HeaderControl[] = [
    build('pause', 'state', busyPause ? '更新中...' : input.paused ? '恢复课堂' : '暂停课堂', {
      title: '暂停后学生无法使用三件套中的任何功能',
      active: input.paused,
      disabled: anyBusy,
    }),
    build('lock', 'state', busyLock ? '更新中...' : input.answersLocked ? '解锁作答' : '锁定作答', {
      title: '停笔：学生不能再修改答案，但仍然可以交卷',
      active: input.answersLocked,
      disabled: anyBusy,
    }),
  ];

  // 同步分组：只有分组 / 高级模式、且课堂**没有结束**时才存在。
  // ⚠️ 判据是 `status === 'ended'`（不是「非 active」）—— 暂停的课堂里分组照旧是活的。
  if ((input.mode === 'group' || input.mode === 'advanced') && input.status !== 'ended') {
    controls.push(build('sync-groups', 'action', busySync ? '同步中...' : '同步分组', {
      title: '把当前班级的分组名称和成员同步到正在进行的课堂',
      disabled: anyBusy,
    }));
  }
  // ★ 2026-09-29（教师）：「『通知全体』改成『全体消息』」。
  controls.push(build('notify', 'action', '全体消息', { title: '给全班或某一组、某个人发一条消息' }));

  // ★ 2026-09-29（教师）：原来的「学习单」与「矩阵」两个按钮合成**这一个下拉**
  //（里面的两项见 `WORKSHEET_MENU_ITEMS`）。合并的理由就是教师那句话本身：
  // 两者是「按学习单看全班」的两面，摆成两个并列按钮时教师分不出该按哪个。
  controls.push(build('worksheet-menu', 'view', '学习单', {
    title: '按学习单看全班：答题分析 / 进度矩阵',
    popup: 'menu', expanded: input.worksheetMenuOpen,
  }));
  // 全屏只在指定模式：跟随模式下每格显示的是**不同**的模块，铺满之后既不像投屏讲评、
  // 也不像图墙，教师按下去只会得到一个与预期无关的覆盖层。
  if (input.boardMode === 'assign') {
    controls.push(build('fullscreen', 'view', '全屏', { title: '全屏显示学生面板' }));
  }

  // ★ 2026-09-29（教师）：原来那一个「课堂权限」弹窗按模块**拆成两个**，
  // 每个模块的设置紧挨着它自己的按钮；「课堂权限」这个按钮随之取消。
  // ⚠️ 原来那个弹窗里的第三段（学习单）本来就只有一句「这一段还没有专属开关」——
  // 所以它没有对应的按钮，直接消失（不是漏了）。
  controls.push(build('explore-settings', 'setting', '探究空间', {
    title: '探究空间的设置：学生网页画面的采集',
    popup: 'dialog', expanded: input.exploreOpen,
  }));
  controls.push(build('companion-settings', 'setting', '智能学伴', {
    title: '智能学伴的设置：四项能力开关',
    popup: 'dialog', expanded: input.companionOpen,
  }));
  controls.push(build('module-state', 'setting', '模块状态', {
    popup: 'menu', expanded: input.modulesOpen,
  }));

  // 组边界由**类别变化**推出。第一项恒 false。
  let previousKind: HeaderControlKind | null = null;
  for (const control of controls) {
    control.startsGroup = previousKind !== null && previousKind !== control.kind;
    previousKind = control.kind;
  }

  return controls;
}

/** 头部那几段显不显示（与 `controls` 同一份输入，一次算完）。 */
export function headerLayout(input: HeaderLayoutInput): HeaderLayout {
  return {
    controls: headerControls(input),
    showsHeader: !input.gridFullscreen,
    showsModuleFilter: input.boardMode === 'follow' && !input.gridFullscreen,
  };
}
