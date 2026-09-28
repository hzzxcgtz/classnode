'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { MODULE_META } from '../module-meta';
import type { ModuleId, StudentSession } from '../classroom-types';
import { SvgAvatar } from '../chat/svg-avatar';
import type { ModuleTabEntry } from './use-module-tabs';
import styles from './shell.module.css';

export interface ModuleTabBarProps {
  /** 已启用（非 `hidden`）的模块，顺序由 `MODULE_KEYS` 决定。 */
  tabs: ModuleTabEntry[];
  /** 前台是哪个模块；`null` = 首页。 */
  activeId: ModuleId | null;
  onSelect: (id: ModuleId) => void;
  onHome: () => void;
  // ── 操作组（M1b-3 T1）：四项能力全部由外壳转手，栏自己不持有状态 ──
  /** 与课堂服务端的连接是否存活。`false` = 红点 + 「连接断开」。 */
  connected: boolean;
  /** 当前身份。`null`（理论上只在身份选择页出现）时不渲染学生头像与姓名。 */
  selectedStudent: StudentSession | null;
  /** 头像 SVG 池，键是 `Avatar.id`。缺项时头像降级成姓名首字。 */
  avatarSvgs: Record<number, string>;
  /**
   * 学生还剩几次换头像的机会（M1b-3 T5 补入，C8）。
   *
   * 栏只拿它做一件事：`> 0` 时在 chip 上多一枚角标。**不判断能不能换** —— 那条判断与弹窗
   * 一起归外壳（见 `onChangeAvatar`）。为什么这枚角标非有不可：T2 撤掉了首页的「换头像 N」
   * 按钮与面板头的「⭐ N」之后，「有 0 次」与「有 ≥1 次」的 chip 在**外观与交互上完全一致**，
   * 学生拿到老师奖励后没有任何线索 —— 恢复的是 T2 顺带抹掉的既有信号。
   */
  avatarTokenCount: number;
  /**
   * 顶栏头像被点击（M1b-3 T2）。
   *
   * 栏不判断「能不能换」—— 决定权（有机会就开弹窗、没机会就说为什么）与弹窗本身都归外壳，
   * 栏只负责把点击转出去。理由与它其余四项一致：这里不持有任何会话级状态。
   */
  onChangeAvatar: () => void;
  onSwitchIdentity: () => void;
  onExit: () => void;
  // ── 教师消息入口（M1b-3 T3）：与其余四项同源 —— 条数与下拉状态都归外壳 ──
  /** 老师消息条数。> 0 时按钮上带一枚角标（窄屏也保留：它是「有新消息」的唯一视觉线索）。 */
  teacherMsgCount: number;
  /** 下拉此刻是否展开（决定按钮的 aria-label / title 与按下态）。 */
  teacherMsgsOpen: boolean;
  /**
   * 下拉按钮的 DOM 引用，由外壳持有。
   *
   * 与其余 prop 不同，这是一根**引用**而不是一项能力 —— 因为下拉已经 portal 到 body
   * （顶栏 `.bar` 的 `overflow-y: hidden` 会把它纵向裁掉，见 classroom-shell.tsx），
   * 定位只能靠外壳量按钮的 `getBoundingClientRect()`。栏不量也不存，只是把它挂上去。
   */
  teacherMsgsButtonRef: RefObject<HTMLButtonElement | null>;
  onToggleTeacherMsgs: () => void;
}

/** 首页图标。内联 SVG 而不是 emoji：与三件套同一套线条，缩放不糊。 */
function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 10v10h5v-6h4v6h5V10" />
    </svg>
  );
}

/** 锁定角标（🔒），与首页卡片上那枚同一套画法。 */
function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** 切换身份（左右对向箭头）。与三件套同一套线条，缩放不糊。 */
function SwitchIdentityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </svg>
  );
}

/** 老师消息（铃铛）。画法与学伴面板头那枚「消息」按钮的铃铛同源（chat-panel.tsx 的 24 画布
 *  + 两条路径），只是按顶栏的 16px 画布重画了一遍描边宽度 —— 与另外三枚图标同规格。 */
function MessagesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

/** 退出课堂（开门 + 外走箭头）。 */
function ExitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

/**
 * 顶部 Tab 栏（§4.1 / §4.2 / §4.7）。
 *
 * 三条规则，各自都有明确的来源：
 *   1. **首页入口在最左**（§4.2：「从模块返回首页的入口放在 Tab 栏最左侧」）。它是学生
 *      唯一的回门户通道，所以**只启用一个模块时也保留**（见第 3 条）。
 *   2. **只渲染非 `hidden` 的模块**；`preview` 显示但灰掉，点击由 `use-module-tabs` 的
 *      闸门给出「这个模块还在的，老师先收起来啦」——与首页卡片同一句提示、同一处闸门（§4.4 的三态表）。
 *   3. ⊘ **2026-09-27 反转：「只启用一个模块时不渲染 Tab 栏」（原 §4.7）已作废。**
 *      教师实测报回：「如果只有一个学习单，那么导航栏里的『学习单』tab 还是要有的。」
 *
 *      🔴 旧理由（「一排只有一个按钮的 Tab 栏只是噪音」）在**这轮之后不成立了**：
 *      2026-09-27 起 Tab 会按「这节课有没有对应材料」隐藏（`visibleModules`），
 *      于是「只配了学习单」的课堂会掉到**一个**模块 —— 而那正是最常见的课堂。
 *      照旧规则办，那种课堂的学生进到学习单里，顶上只剩一个「首页」按钮：
 *      **看不出自己在哪个模块、也没有回到它的入口**，而那一排本来就是他核对「我在哪」
 *      的唯一地方。噪音的代价远小于「学生不知道自己身在何处」。
 *      ⇒ 判断从「模块项 ≥ 2 才渲染」改成「**有模块就渲染**」。
 *
 * Task 7 在这里加了随选中项平移的指示器滑块（只用 `transform`/`opacity`）：
 * 滑块是一枚**半透明**的模块色药丸（见 shell.module.css 的 `.tabIndicator`），
 * 位置与宽度由 `offsetLeft` / `offsetWidth` 量出来 —— 不用 `getBoundingClientRect()`，
 * 因为它含祖先的 `transform`，而本壳的切换动画正在平移整个层。
 *
 * ── 操作组（M1b-3 T1 / T2 / T3 / T5）────────────────────────────────────────
 * 栏右侧追加一组操作：连接状态、学生头像 + 姓名、老师消息、切换用户、退出课堂。能力**全部**
 * 由外壳从 `useClassroomSession` 转手进来（`connected` / `selectedStudent` / `avatarSvgs` /
 * `onChangeAvatar` / `onToggleTeacherMsgs` / `onSwitchIdentity` / `onExit` /
 * `avatarTokenCount`），栏自己不持有任何状态、不新增 effect —— 它只是一个展示点。T2 给头像
 * chip 加的那次点击（换头像）同样是转手：能不能换、换完怎么收尾都由外壳决定，栏连「有没有
 * 机会」都不判断。T3 的消息入口同理，唯一的例外是那根 `teacherMsgsButtonRef`：下拉 portal
 * 到 body 之后，落点只能由外壳量（栏仍然不量、不存，只是把引用挂上去）。
 *
 * 四条从控制器裁定下来的规矩，改这里时不要丢：
 *   ① **栏必须是一行**（M1b-3 T5 的用户要求）：栏高 52px 是面板与首页层的布局常量
 *      （`--shell-topbar-height`，见 shell.module.css 的文件头），**本任务不得改它**；
 *      宽度不够时由 `.bar` 的 `overflow-x: auto` 横向滚动兜底 —— 用户明确接受这一点，
 *      理由是「再加一行 44–48px 是整堂课持续付出的代价，横滑只是在极端情况下滑一下」。
 *   ② **无障碍信息不许比视觉更少**（Ruling 3）：每个操作 36px 高（与 Tab 同高），可点的一律
 *      是原生 `<button>` + `aria-label`，且 **`title` 与 `aria-label` 逐字一致**（T2 审查 C7b）。
 *   ③ **颜色不能是唯一的信息载体**（Ruling 3 续）：连接状态不是一个孤零零的绿点/红点 ——
 *      T5 起它把「已连接」/「连接断开」**写在脸上**，`role="img"` + `aria-label` 让这个标签
 *      稳定成为该元素的无障碍名字（纯装饰的圆点本身 `aria-hidden`）。
 *   ④ **操作组右对齐**（M1b-3 T5，Ruling 4 已作废）：`margin-left: auto` 把这一组推到栏的
 *      最右。T1 时控制器明确要求**不做**这件事，理由是用户当时选了「图标化」而非
 *      「Tab 组滚动、操作固定右侧」；T5 用户改口明确要求右对齐 ⇒ 那条禁令解除、改为要求。
 *
 * ⚠️ ④ 的一个副作用值得记下来：右对齐**只改变这一组的位置，不改变它内部的相对几何**
 * （`margin-left: auto` 吸走的是自由空间，组内排布与 Tab 组一点没动）。所以
 * `classroom-shell.tsx` 里那条「下拉跟按钮走」的测量仍然成立 —— 它是量按钮的
 * `getBoundingClientRect()`，不是量栏。这一点由 T5 实测确认（滑块 ΔX 仍为 0）。
 *
 * ⚠️ ② 在 T2 之后多了一层：`role="img"` 与「可点的入口」不可兼得（显式角色会覆盖掉 button
 * 角色）。可点的那三个（切换用户 / 退出课堂 / 头像 chip 的按钮形态）一律是原生 `<button>` +
 * `aria-label`；只有**真的不可点**的元素（连接状态、小组的 chip）才用 `role="img"`。
 *
 * 文案的两处对齐（T5）：用户口述的是「切换用户」与「退出教室」，代码库既有词汇是
 * 「切换身份」（那只是 T1 起的 aria-label，从没有过可见文字）与「退出课堂」（首页原来那个
 * 入口）。⇒ 采用**用户钦定的「切换用户」**作为可见文字与无障碍名（可见文字必须落在无障碍名
 * 里，WCAG 2.5.3），**「退出课堂」沿用代码库既有词汇**（把「教室」硬改过来是全局词汇问题，
 * 该单开一项，不在本任务里做）。

 *
 * 面板头里那套同样的画法（`chat-panel.tsx` 的 `studentBadge` / `connectionBadge`）曾是 T1 的
 * 参考，但**样式全部写在 shell.module.css**，不 import 面板的 CSS module：层级不对。现在
 * 面板头整行已随 M1b-3 T4 撤除（面板头那枚「换头像」星标计数先一步随 T2 撤除），两份并存的
 * 过渡期结束 —— 本文件所依赖的样式是这一组能力的**唯一**来源。
 */
export function ModuleTabBar({
  tabs,
  activeId,
  onSelect,
  onHome,
  connected,
  selectedStudent,
  avatarSvgs,
  avatarTokenCount,
  onChangeAvatar,
  onSwitchIdentity,
  onExit,
  teacherMsgCount,
  teacherMsgsOpen,
  teacherMsgsButtonRef,
  onToggleTeacherMsgs,
}: ModuleTabBarProps) {
  const homeActive = activeId === null;
  /**
   * ★ 2026-09-27：从 `>= 2` 改成 `>= 1` —— 教师实测后要求「只有一个模块时 Tab 也要在」，
   * 理由写在文件头第 3 条（与 §4.7 那条旧规矩的整体反转是同一件事）。
   */
  const showTabs = tabs.length >= 1;

  /**
   * 消息按钮的无障碍名 / tooltip —— 两处**逐字一致**（T2 审查 C7b 立的规矩），且把条数一起
   * 说出来：Ruling 3「图标化只减视觉宽度、不减无障碍信息」在这里同样成立 —— 角标只在
   * `teacherMsgCount > 0` 时出现，读屏用户不能因此少听到一个数。
   */
  const messagesLabel = `${teacherMsgsOpen ? '收起' : '查看'}老师消息，共 ${teacherMsgCount} 条`;

  /**
   * 头像 chip 是不是一个**按钮**：只有真实学生参与者能换头像（小组没有这项能力 ——
   * `studentId` 为空，服务端的 `avatarChangeTokens` 长在 `Student` 上，小组根本没有），
   * 所以小组拿到的是原来那个不可点的 `<span>`。
   *
   * 不做成「恒为按钮 + 小组点了没反应」：一个点下去什么都不发生的按钮比不可点的头像更糟，
   * 而给小组另编一句提示又会替产品决定一件没定过的事（首页面对小组时也是**没有入口**）。
   */
  const changeable = Boolean(selectedStudent?.studentId);

  /**
   * chip 上的「剩余换头像次数」角标（M1b-3 T5，C8）该不该出现。
   *
   * `avatarTokenCount > 0` 是**唯一**的信号来源（简报的判据）。多加的 `changeable` 不是第二个
   * 条件，而是一道**构造性的保证**：角标只在「点得动、且点了有反应」的那个形态上出现，所以
   * 它必然与解释它的 `aria-label`（见下面的 `chipLabel`）同进同出，不会出现一枚谁都解释不了
   * 的角标。两种写法在**今天可达的每一个状态里完全等价** —— 机会数长在 `Student` 上，
   * `fetchStudentTokens` 在 `studentId` 为空（小组）时直接 return，所以小组的
   * `avatarTokenCount` 恒为 0（`use-classroom-session.ts` 的 `fetchStudentTokens`）。
   */
  const showChipBadge = changeable && avatarTokenCount > 0;

  /**
   * chip 的无障碍名（按钮形态）：姓名 + 用途 + （有机会时）剩余次数。
   *
   * 角标是 `aria-hidden` 的纯视觉线索，所以那个数字必须在**无障碍名**里出现一次 —— 否则
   * 读屏用户就是唯一看不到「老师刚奖励了机会」的人（Ruling 3 的同一件事：视觉上少一点可以，
   * 无障碍信息不许少）。两处的写法因此与 `.actionBadge` 那枚消息角标一致：角标本身
   * `aria-hidden`，条数写进 `aria-label` / `title`，且两处**逐字一致**。
   */
  const chipLabel = selectedStudent
    ? `${selectedStudent.name}，更换头像${showChipBadge ? `，剩余 ${avatarTokenCount} 次机会` : ''}`
    : '';

  /**
   * chip 的内容：头像 + 姓名 (+ 剩余换头像次数角标)。两个形态（按钮 / 不可点的 span）
   * 逐字共用同一份。
   *
   * 头像圆是 `aria-hidden` 的纯装饰（头像 SVG 与姓名首字对读屏没有增量信息，姓名本身就在
   * 旁边），所以两个形态的无障碍名都由外层元素给。角标同理，见 `chipLabel`（它在 span 形态下
   * 永远不出现，因为 `showChipBadge` 含 `changeable`）。
   */
  const renderChipContent = (student: StudentSession) => (
    <>
      <span className={styles.studentChipAvatar} aria-hidden="true">
        {student.avatarId && avatarSvgs[student.avatarId] ? (
          <SvgAvatar svg={avatarSvgs[student.avatarId]} size={28} fallback={student.name[0]} />
        ) : student.name[0]}
      </span>
      <span className={styles.studentName}>{student.name}</span>
      {showChipBadge && (
        <span className={`${styles.actionBadge} ${styles.chipBadge}`} aria-hidden="true">{avatarTokenCount}</span>
      )}
    </>
  );

  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Partial<Record<ModuleId, HTMLButtonElement | null>>>({});

  /**
   * 滑块的几何：`x`（相对 nav 左缘）/ `w`。`null` = 还没量过（首次点击之前）。
   *
   * `instant` = 这次落位**不参与 transform 过渡**，只淡入。只有首次落位是 `true`：
   * 那一刻 `transform` 从 `none`（等价 `translateX(0)`）变成 `translateX(x)`，照常过渡的话
   * 药丸会从栏**左端**滑过来，而它该做的是在选中项处淡入。下一次切换时它是 `false`，
   * 滑动过渡照旧（见 shell.module.css 的 `.tabIndicatorInstant`）。
   */
  const [indicator, setIndicator] = useState<{ x: number; w: number; instant: boolean } | null>(null);

  /**
   * 量一次滑块该在哪儿。
   *
   * `activeId === null`（首页在前台）时**什么都不做**：保留上一次的位置而不是清零，
   * 否则下次进模块时滑块会从栏的左端滑过来，而它该做的是在正确的位置淡入。
   * 落点是 `transform: translateX()` 而不是 `left` —— 布局属性动不了（动画只允许
   * transform/opacity），而 width 直接写死、不参与过渡（相邻 Tab 的宽度只差几个像素，
   * 肉眼看到的就是平移）。
   *
   * `instant: !prev` 与上面的判等短路共用同一次 setState：**首次落位**（prev 为 null）这一帧
   * 关掉 transform 过渡，此后每次都是 `false`。等值短路返回原对象时 `instant` 保持原样，
   * 但那时 transform 也没变化，无过渡可言。
   */
  const measure = useCallback(() => {
    if (activeId === null) return;
    const el = itemRefs.current[activeId];
    if (!el) return;
    const x = el.offsetLeft;
    const w = el.offsetWidth;
    setIndicator((prev) => (prev && prev.x === x && prev.w === w ? prev : { x, w, instant: !prev }));
  }, [activeId]);

  // Tab 集合的身份串：`tabs` 每次渲染都是新数组（useModuleTabs 现算），直接当依赖会让下面的
  // effect 每帧重跑 —— 而流式回答期间外壳每来一个 chunk 就重渲染一次。
  const tabIds = tabs.map((tab) => tab.id).join(',');

  useEffect(() => {
    measure();
  }, [measure, tabIds]);

  // 文案换行、字体加载、旋转屏幕、模块增减都会改 Tab 的宽度；观察它们而不是只听 window.resize
  // （后者漏掉前两种）。观察回调里 setIndicator 会做等值短路，所以不会自激。
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(nav);
    Object.keys(itemRefs.current).forEach((key) => {
      const el = itemRefs.current[key as ModuleId];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [measure, tabIds]);

  return (
    <header className={styles.bar}>
      {/* 首页入口（在最左）。homeActive 时不给它 aria-current="page" 之外的动作 ——
          再点一次就是「原地不动」，不做成禁用按钮：禁用态会让学生以为回不去了。 */}
      <button
        type="button"
        className={homeActive ? `${styles.home} ${styles.homeActive}` : styles.home}
        aria-current={homeActive ? 'page' : undefined}
        onClick={onHome}
      >
        <HomeIcon />
        首页
      </button>

      {showTabs && (
        <nav className={styles.tabs} aria-label="课堂模块" ref={navRef}>
          {/* 指示器滑块（§4.6）。纯装饰，不接事件、不进无障碍树。 */}
          <span
            className={indicator && indicator.instant
              ? `${styles.tabIndicator} ${styles.tabIndicatorInstant}`
              : styles.tabIndicator}
            aria-hidden="true"
            style={{
              '--tab-accent': activeId ? MODULE_META[activeId].accent : undefined,
              transform: indicator ? `translateX(${indicator.x}px)` : undefined,
              width: indicator ? `${indicator.w}px` : 0,
              opacity: activeId !== null && indicator ? 1 : 0,
            } as CSSProperties}
          />
          {tabs.map(({ id, state }) => {
            const meta = MODULE_META[id];
            const selected = activeId === id;
            const locked = state === 'preview';
            // 选中态与锁定的类都挂在同一个按钮上；锁定优先（一个 preview 的模块不会在
            // 前台 —— 那正是 use-module-tabs 要把学生送回首页的情形）。
            const className = [
              styles.tab,
              selected && !locked ? styles.tabActive : null,
              locked ? styles.tabLocked : null,
            ].filter(Boolean).join(' ');
            return (
              <button
                key={id}
                type="button"
                ref={(el) => {
                  itemRefs.current[id] = el;
                }}
                className={className}
                // 身份色给药丸的 16% 底色与悬停态；强调色只给选中态的文字（对比度，见
                // module-meta.tsx 的文件头）。两个值同源，CSS 里不抄十六进制。
                style={{ '--tab-accent': meta.accent, '--tab-accent-strong': meta.accentStrong } as CSSProperties}
                aria-current={selected ? 'page' : undefined}
                aria-disabled={locked || undefined}
                onClick={() => onSelect(id)}
              >
                {meta.icon}
                <span className={styles.tabLabel}>{meta.label}</span>
                {locked && <LockIcon />}
              </button>
            );
          })}
        </nav>
      )}

      {/* ── 操作组（M1b-3 T1 / T5）。四项都是**共用**能力：任何层（首页或三个模块）下都在，
          因为它们属于「这一节课的会话」，不属于任何一个模块。 */}
      <div className={styles.actions}>
        {/* 连接状态。**不是按钮** —— 它没有可执行的动作，做成按钮只会让学生去点它。
            配色由 `.connectionOnline` / `.connectionOffline` 给；**文字就是信息载体本身**
            （Ruling 3 续：颜色不能是唯一的信息载体 —— T5 之前这里只有一个孤零零的圆点，
            状态只活在 `aria-label` 里，色盲/灰度屏学生看到的都是同一枚点）。
            `role="img"` + 同名的 `aria-label` / `title` 让「已连接」/「连接断开」稳定成为这个
            元素的无障碍名字；圆点是纯装饰（`aria-hidden`），名字不靠它。 */}
        <span
          className={`${styles.connectionStatus} ${connected ? styles.connectionOnline : styles.connectionOffline}`}
          role="img"
          aria-label={connected ? '已连接' : '连接断开'}
          title={connected ? '已连接' : '连接断开'}
        >
          <span className={styles.connectionDotMark} aria-hidden="true" />
          {connected ? '已连接' : '连接断开'}
        </span>

        {/* 学生头像 + 姓名（+ 剩余换头像次数角标）。姓名在窄屏由媒体查询隐藏、头像保留
            （见 shell.module.css 的 `.studentName`）。降级写法逐字对齐面板：有 avatarId 且
            池里有这张 SVG 才画 `SvgAvatar`，否则退到姓名首字（底色由 `.studentChipAvatar` 给）。

            ── 换头像的**唯一**入口（M1b-3 T2 / Ruling 1）──
            真实学生这里是 `<button>`：点它就换头像（有机会开弹窗，没机会由外壳给一句
            「换头像的机会由老师奖励」）。首页那个换头像按钮与面板头那枚星标计数随本次一并
            撤除，所以**这是学生唯一的入口**，删掉它等于把功能整个拿掉。

            ⚠️ 两个形态的无障碍名都是外层给，且**按钮上不能再有 `role="img"`**（T1 审查
            C3）：`<button role="img">` 的显式角色会覆盖掉 button 角色，读屏就不再把它念成
            可点的按钮 —— 这是「把它变成入口」这一步引入的新坑。`role="img"` 留在下面那个
            **不可点**的 span 上（那里它是对的：`img` 是叶子角色，窄屏 `display:none` 掉姓名
            之后，它仍让这个 chip 在无障碍树里是一个有名字的节点，而不是空的）。

            按钮的无障碍名走 `chipLabel`（`${name}，更换头像`，有机会时再补上剩余次数）：
            窄屏下姓名文本被 `display:none` 拿掉，只写「更换头像」的话学生就再也听不到自己在
            用哪个身份 —— T1 的 Ruling 3「只减视觉宽度、不减无障碍信息」在这里同样成立。
            T5 补的角标同理：它 `aria-hidden`，那个数字只从 `chipLabel` 读得到。宽屏下
            `aria-label` 覆盖子内容，姓名也**只念一次**（不会「标签一遍 + 可见文本一遍」）。

            `title` 与 `aria-label` **必须逐字一致**（T2 审查 C7b）：`title` 是鼠标用户看到
            的 tooltip，走的是「视觉变窄」的同一条路 —— 窄屏姓名 `display:none` 之后，
            若 tooltip 只写「更换头像」，鼠标用户同样看不出这是谁的身份。两处都带上姓名，
            改一处就要同时改另一处。（下面那个不可点的 span 形态同理，两者都写姓名。） */}
        {selectedStudent?.name && (
          changeable ? (
            <button
              type="button"
              className={showChipBadge
                ? `${styles.studentChip} ${styles.studentChipButton} ${styles.studentChipBadged}`
                : `${styles.studentChip} ${styles.studentChipButton}`}
              onClick={onChangeAvatar}
              aria-label={chipLabel}
              title={chipLabel}
            >
              {renderChipContent(selectedStudent)}
            </button>
          ) : (
            <span
              className={styles.studentChip}
              role="img"
              aria-label={selectedStudent.name}
              title={selectedStudent.name}
            >
              {renderChipContent(selectedStudent)}
            </span>
          )
        )}

        {/* ── 老师消息（M1b-3 T3）──
            入口从学伴面板头搬到这里：那条栏属于「这一节课的会话」，任何层（首页或三个模块）
            下都在，而面板头整行已随 T4 撤除。搬过来之后**面板侧不再有这个入口**，删掉它
            等于把「老师发的消息」整个藏起来。

            ⚠️ 位置在「学生 chip」与「切换用户」之间是照着面板头原来的次序
            （连接 / 学生 / 消息 / 切换 / 退出）排的，不是随手插的。

            ⚠️ 下拉本体**不在这里** —— 它 portal 到 body，由外壳渲染（见 prop 注释）。
            这里只有入口。

            ⚠️ **这是操作组里唯一一枚纯图标按钮**（T5 只给用户点名的四项加了文字：连接状态 /
            学生 chip / 切换用户 / 退出课堂，消息不在这份名单里）。它留着图标 + 角标，条数
            仍然完整写在 aria-label / title 里 —— 读屏用户不比视觉用户少听到任何东西。

            角标只在有条数时出现：36px 的图标按钮里塞不下「消息 0」，而 0 本身也不是学生
            需要一眼看到的信息。 */}
        <button
          type="button"
          ref={teacherMsgsButtonRef}
          className={teacherMsgsOpen ? `${styles.action} ${styles.actionActive}` : styles.action}
          onClick={onToggleTeacherMsgs}
          aria-expanded={teacherMsgsOpen}
          aria-label={messagesLabel}
          title={messagesLabel}
        >
          <MessagesIcon />
          {teacherMsgCount > 0 && (
            <span className={styles.actionBadge} aria-hidden="true">{teacherMsgCount}</span>
          )}
        </button>

        {/* 切换用户 / 退出课堂（M1b-3 T5 恢复文字）。与 `.home` / `.tab` 同一套度量
            （36px 高、12px 内边距、0.813rem / 650 字重、图标 + 文字），所以栏里五个入口看起来
            是同一排按钮，而不是「四个字按钮夹一个图标按钮」。文案的两处对齐见文件头。 */}
        <button
          type="button"
          className={styles.actionText}
          onClick={onSwitchIdentity}
          aria-label="切换用户"
          title="切换用户"
        >
          <SwitchIdentityIcon />
          切换用户
        </button>

        <button
          type="button"
          className={styles.actionText}
          onClick={onExit}
          aria-label="退出课堂"
          title="退出课堂"
        >
          <ExitIcon />
          退出课堂
        </button>
      </div>
    </header>
  );
}
