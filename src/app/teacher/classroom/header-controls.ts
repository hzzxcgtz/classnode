/**
 * 教师看板头部**有哪些控件、各叫什么、禁不禁用**的判据（★ 2026-09-29，教师选「乙」）。
 *
 * 🔴 这一层为什么存在：那 6–9 个控件的「在不在 / 叫什么 / 禁不禁用」原先全写在 260k 的
 * `page.tsx` 的 JSX 里，**没有任何回归网**。而它每一条错了都**不报错** ——
 * `同步分组` 的两道条件、两个开关的标签翻转、三个忙态键：
 * 屏幕上只是「按钮不对 / 不见了」，没有任何东西会红。
 * （★ 2026-09-30：「全屏只在指定模式」那一条**已经取消**，见下面 `fullscreen` 的注释。）
 *
 * ⚠️ 本文件**零运行时 import**（`node --test` 直接跑）。类型也只收**字符串**：
 * `mode` / `status` / `boardMode` 都按联合类型收窄在这里，而不是 import 那三个类型 ——
 * 那些类型住在 `page.tsx`（260k）与 `@/lib/types`，为一个「拿几个字符串比一比」的函数
 * 去依赖它们，收益为零而耦合是实的。
 *
 * ── 屏幕上的形状（**三组，每组一个盒子**）─────────────────────────────────
 *
 *   〔暂停课堂 锁定作答〕  〔全体消息 全屏 模块状态〕  〔学习单▾ 探究空间▾ 智能学伴▾〕
 *      ① 课堂状态              ② 对全班 / 整屏            ③ 三个模块各自的入口
 *
 * ★ 2026-09-30（教师第三轮）：「这个分类我认为是这样分：**暂停课堂和锁定作答是一类，
 * 全体消息、全屏、模块状态是一类，学习单、探究空间和智能学伴是一类，并且按这个顺序**。」
 *
 * ⊘ 上一版是「按性质分四段、段之间一条 1px 分隔线」，而教师看到的是
 *   「这八个小按钮平铺着」—— 那条线（`#e2e8f0`，1px）**投屏上基本看不见**。
 *   ⇒ 分组从「一条线」改成**结构**：一个盒子装一组。见下面 `headerControlGroups`。
 */

/**
 * 一个控件属于哪一组。**顺序就是屏幕上的顺序**（`state` → `global` → `module`）。
 *
 * ★ 2026-09-30（教师第三轮）逐字定的三组，取值域就照着它来：
 *   · `state`  —— 课堂状态开关（暂停课堂 / 锁定作答）；
 *   · `global` —— 对全班 / 整屏起作用（全体消息 / 全屏 / 模块状态）；
 *   · `module` —— **三个模块各自的入口**（学习单 / 探究空间 / 智能学伴）。
 * ⊘ 原来那四个值（`action` / `view` / `setting`）是上一版按「性质」分的，
 *   与教师这次点的三组**对不上**（例如「全屏」原来与「学习单」同组，现在归第 2 组）。
 */
export type HeaderControlKind = 'state' | 'global' | 'module';

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
   * 学习单的两个分析入口合成一个下拉，分别承载按题分析与按学生分析。
   * 里面的具体项目见 `WORKSHEET_MENU_ITEMS`。
   */
  | 'worksheet-menu'
  /** 把格子铺满整屏（★ 2026-09-30：**两种看板模式都有**）。 */
  | 'fullscreen'
  /** ★ 2026-09-29：探究空间自己的设置弹窗（原来在「课堂权限」里的那一段）。 */
  | 'explore-settings'
  /**
   * ★ 2026-09-29（教师）：「把词云的这块功能迁移到下方『智能学伴』这个下拉按钮里边，
   * 专门给它设置一个选项，后弹出一个弹窗来显示」。
   * ⇒ 它从「一个设置按钮」变成**一个下拉**（两项见 `COMPANION_MENU_ITEMS`）。
   */
  | 'companion-menu'
  /** 模块三态菜单。 */
  | 'module-state';

/**
 * ★ 2026-09-29：「学习单」那个下拉里的两项。
 *
 * 🔴 标签放这里而不是写进 `WorksheetMenu` 的 JSX：教师这次**逐字给了这两个名字**，
 * 而一个下拉丢掉一项、或某一项改了名字，在屏幕上只是「少一个入口」——
 * 没有任何东西会红。放这儿就有一条用例钉着。
 */
/**
 * ★ 2026-09-29（教师）：「智能学伴」那个下拉里的两项。
 * · **对话分析** = 高频词云 + 活跃学生 TOP 10（原来挂在看板上方那块面板里）。
 * · **设置** = 四项能力开关（允许中断回答 / 导出对话 / 学生提问 / 显示追问建议）。
 */
export const COMPANION_MENU_ITEMS: ReadonlyArray<{ id: 'analysis' | 'settings'; label: string; title: string }> = [
  { id: 'analysis', label: '对话分析', title: '高频词云与活跃学生 TOP 10' },
  { id: 'settings', label: '设置', title: '学生端智能学伴页面的四项能力开关' },
];

/**
 * ★ 2026-10-09：查看入口统一为「总览 / 按学生 / 按题目」，都进入同一个工作区；
 * 「逐题开放」仍放在最后，但用分隔线标明它是课堂控制动作。
 *
 * 教师原话：「题目开放方式有必要再增加一个……在教师看板页面中，找一个合适的位置和方式，
 * 帮我呈现控制界面」。落在这里的理由：前三项都是**按学习单看全班**的工具，而
 * 「逐题开放」是紧邻这些查看入口的控制动作；头部那一排已经有 8 个控件，
 * 再加一个按钮只会更挤（而它只在学习单是「手动逐题开放」那一档时才有用）。
 *
 * 🔴 **四项的顺序就是菜单里的顺序**：前三项是**看**，最后一项是**改课堂状态**
 *（它会当着全班改学生屏幕上有什么）。改的人要能一眼分清。
 */
export const WORKSHEET_MENU_ITEMS: ReadonlyArray<{ id: 'overview' | 'student' | 'question' | 'open'; label: string; title: string }> = [
  {
    id: 'overview',
    label: '学习单总览',
    title: '用学生 × 题目的矩阵查看全班进度，并快速进入详情',
  },
  {
    id: 'student',
    label: '按学生查看',
    title: '查看某个学生或小组整份学习单的完成情况',
  },
  {
    id: 'question',
    label: '按题目查看',
    title: '查看某一道题的全班统计与具体作答',
  },
  {
    id: 'open',
    label: '逐题开放',
    title: '手动决定学生此刻能做哪几道题（学习单设成「手动逐题开放」时才生效）',
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
  /** 「智能学伴」那个下拉开着没有。 */
  companionMenuOpen: boolean;
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
    title: '', active: false, disabled: false, popup: null, expanded: false,
    ...extra,
  };
}

/**
 * 这一屏头部此刻有哪些控件。**顺序即屏幕上的顺序**（三组，见文件头）。
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

  /**
   * ⚠️ **顺序就是屏幕上的顺序，而这是教师逐字点的三组**（见文件头）。改顺序之前先看
   * `header-controls.test.ts` 里那条「正好这八个控件」—— 它把顺序逐个钉住了。
   */
  const controls: HeaderControl[] = [
    // ── ① 课堂状态：两个开关。它们会**当着全班**改学生屏幕上有什么。
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

  // ── ② 对全班 / 整屏起作用。
  //
  // 同步分组：只有分组 / 高级模式、且课堂**没有结束**时才存在。
  // ⚠️ 判据是 `status === 'ended'`（不是「非 active」）—— 暂停的课堂里分组照旧是活的。
  // ⚠️ 教师这一轮**没有点名它**（标准模式下它压根不出现）⇒ 位置是实施时定的：
  //    它是个**动作**（把班级分组同步进课堂），既不是课堂状态开关、也不是某个模块的入口
  //    ⇒ 只能进第 2 组，排在「全体消息」前面（两件事都是「对全班做一件事」）。
  if ((input.mode === 'group' || input.mode === 'advanced') && input.status !== 'ended') {
    controls.push(build('sync-groups', 'global', busySync ? '同步中...' : '同步分组', {
      title: '把当前班级的分组名称和成员同步到正在进行的课堂',
      disabled: anyBusy,
    }));
  }
  // ★ 2026-09-29（教师）：「『通知全体』改成『全体消息』」。
  controls.push(build('notify', 'global', '全体消息', { title: '给全班或某一组、某个人发一条消息' }));
  // ★ 2026-09-30（教师）：「全屏」**两种看板模式都给**。
  //
  // 原先是 `if (boardMode === 'assign')`，理由是「跟随模式下每格显示的是不同的模块，
  // 铺满之后与预期无关」。那条理由**已经被否掉**了，两处都是实的：
  //   · 教师报的是「**之前看板里有一个全屏功能**，现在跟随模式下按钮没了」——
  //     那是一个**既有的**用法被收掉了，而不是新功能；
  //   · 覆盖层本来就不依赖「全班同一个模块」：它逐格调 `resolveTileModule`
  //     （`page.tsx`，与主看板**同一个**函数）⇒ 跟随模式下每格照旧画那个学生
  //     此刻所在的模块，与主看板逐格一致。
  // ⚠️ 覆盖层里那句「全班显示『X』」是**指定模式专属**的说法，已按模式分开
  //（`page.tsx` 的全屏头部）—— 跟着这条一起改，否则跟随模式下它会**编造**一句
  //「全班都在智能学伴」。
  controls.push(build('fullscreen', 'global', '全屏', { title: '全屏显示学生面板' }));
  controls.push(build('module-state', 'global', '模块状态', {
    popup: 'menu', expanded: input.modulesOpen,
  }));

  // ── ③ 三个模块**各自的入口**（教师点名的第三组）。
  //
  // ★ 2026-09-29（教师）：原来那一个「课堂权限」弹窗按模块**拆成两个**，
  // 每个模块的设置紧挨着它自己的按钮；「课堂权限」这个按钮随之取消。
  // ⚠️ 原来那个弹窗里的第三段（学习单）本来就只有一句「这一段还没有专属开关」——
  // 所以它没有对应的按钮，直接消失（不是漏了）。
  // ★ 2026-09-29（教师）：原来的「学习单」与「矩阵」两个按钮合成**这一个下拉**
  //（里面的三项见 `WORKSHEET_MENU_ITEMS`）。合并的理由就是教师那句话本身：
  // 两者是「按学习单看全班」的两面，摆成两个并列按钮时教师分不出该按哪个。
  controls.push(build('worksheet-menu', 'module', '学习单', {
    title: '按题分析全班，或按学生分析整份学习单',
    popup: 'menu', expanded: input.worksheetMenuOpen,
  }));
  controls.push(build('explore-settings', 'module', '探究空间', {
    title: '探究空间的设置：学生网页画面的采集',
    popup: 'dialog', expanded: input.exploreOpen,
  }));
  // ★ 2026-09-29（教师）：智能学伴改成**下拉**：对话分析（词云弹窗）+ 设置（四项能力开关）。
  controls.push(build('companion-menu', 'module', '智能学伴', {
    title: '智能学伴：对话分析 / 设置',
    popup: 'menu', expanded: input.companionMenuOpen,
  }));

  return controls;
}

/**
 * 把清单按 `kind` 切成**屏幕上的那几个盒子**。
 *
 * 🔴 为什么要有它（而不是让渲染层自己数）：上一版判据给的是一个布尔 `startsGroup`
 *（「这一格之前画一条线」），于是「分成三组」这个事实**在判据层里根本没有出现过** ——
 * 渲染层拿到一串 true/false 自己数，数错了没有任何东西会红。
 * ★ 2026-09-30（教师）：「这个要**归归类**，按钮样式要有区分」⇒ 分组从「一条线」
 * 变成**结构**（一个盒子装一组），那这个结构就该由判据层给。
 *
 * ⚠️ **不重排、不丢项**：只是把相邻的同类项收进同一个盒子（`kind` 变了就开新盒子）。
 *    摊平回去必须与输入逐项相同 —— 有一条用例钉着（分错类的症状是「某个按钮不见了」）。
 * ⚠️ 返回的每一组都**非空**（同类的项必然相邻，因为 `headerControls` 就是按组拼的）。
 */
export function headerControlGroups(controls: HeaderControl[]): HeaderControl[][] {
  const groups: HeaderControl[][] = [];
  for (const control of controls) {
    const current = groups[groups.length - 1];
    if (current && current[0].kind === control.kind) current.push(control);
    else groups.push([control]);
  }
  return groups;
}

/** 头部那几段显不显示（与 `controls` 同一份输入，一次算完）。 */
export function headerLayout(input: HeaderLayoutInput): HeaderLayout {
  return {
    controls: headerControls(input),
    showsHeader: !input.gridFullscreen,
    showsModuleFilter: input.boardMode === 'follow' && !input.gridFullscreen,
  };
}
