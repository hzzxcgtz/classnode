'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatPanelProps, ModuleId } from '../classroom-types';
import type { StudentHomeProps } from '../home/student-home';
import { StudentHome } from '../home/student-home';
import { StudentChatContent } from '../chat/chat-panel';
import { useOverlayPortal } from '../layer-overlays';
import { AvatarChangerModal, finishAvatarChange } from '../chat/avatar-changer';
import { ModuleTabBar } from './module-tab-bar';
import { ModulePlaceholder } from './module-placeholder';
import { moduleStateFor, useModuleTabs } from './use-module-tabs';
import styles from './shell.module.css';

export interface ClassroomShellProps {
  /**
   * 学伴面板的全部 props，**除 `active`**。
   *
   * `Omit` 不是省事，是这道闸的把守方式：`active` 是面板上五处页面级副作用的唯一开关
   * （Task 1），而它是 fail-open 的 —— 外壳一旦忘传，五处闸静默退回空操作且没有任何编译期
   * 信号。把 `active` 从入参类型里去掉之后，「谁来传」在类型上只剩外壳一个答案。
   */
  chat: Omit<ChatPanelProps, 'active'>;
  /** 首页的全部 props，**除 `active` 与 `onOpenModule`**：两者都由外壳注入（同理）。 */
  home: Omit<StudentHomeProps, 'active' | 'onOpenModule'>;
  /**
   * 视图相位的单向镜像（`'home'` = 学生在首页，`'shell'` = 在某个模块里）。
   *
   * 视图归本外壳所有（`useModuleTabs`），`step` 是 §4.2 既有的四元词汇、别处还在读它，
   * 所以这里把它镜像回去，而不是让两处各存一份「现在在哪儿」（那正是 §4.10 B8 说的
   * 「step 机与直写打架」的成因）。传进来的是 `useClassroomSession` 的 `setStep`（稳定
   * 引用），effect 只在相位真的变化时才会引起重渲染（同值 setState 会被 React 丢弃）。
   */
  onStepChange: (step: 'home' | 'shell') => void;
}

/** 层的键空间：首页 + 三个模块。 */
type LayerKey = 'home' | ModuleId;

/**
 * 视图相位 —— 一次切换里的四件事，必须**一起**变化，所以合成一个 state。
 *
 * `front` 与 `settled` 是两件不同的事，Task 7 的核心就在这个区分上：
 *   · `front`   = **学生点中的那一层**，点击即刻生效。层的可见性、滑动方向、Toast 的归属
 *                 跟它走（学生的手指已经落下，UI 必须立刻响应）。
 *   · `settled` = **前台层已经滑到位**（§4.6 的动画结束）。模块面板的 `active` 是
 *                 `front && settled`，理由见下面 `activate` 的注释。
 *
 * `leaving` 是正在滑出的那一层：§4.6 要求动画期间两层面共存，结束后才给它加
 * `visibility:hidden`（写在离场动画的 `to` 里，见 shell.module.css）。
 */
interface ViewPhase {
  front: LayerKey;
  leaving: LayerKey | null;
  /** 1 = 前进（新层自右入、旧层向左出）；-1 = 后退。仅决定用哪一组动画。 */
  dir: 1 | -1;
  settled: boolean;
}

/**
 * 动画就位后额外等的余量（ms）。
 *
 * 定时器与浏览器的动画时钟之间只差一个事件循环的抖动，宁可晚 40ms 也不早 ——
 * **早**才是错的方向：教学面板的标记条是 `getBoundingClientRect()` 量的（含 transform），
 * 早一帧就会把「还在平移中的坐标」当成最终值固定下来（Task 2 报告 §3 点名的陷阱）。
 * 而晚一帧只是键盘晚 40ms 弹出来，代价为零。
 */
const SETTLE_SLACK_MS = 40;

/** 老师消息下拉的宽度上限（沿用面板头那版的 360px）。 */
const TEACHER_MSGS_WIDTH = 360;

/** 下拉离视口边缘的最小留白（左/右/下三处共用）。 */
const TEACHER_MSGS_EDGE = 8;

/**
 * 某一层动画的时长（ms），**从该层的计算样式里读**，不在 JS 里另抄一份 240ms。
 *
 * 两个附带的好处，都不是巧合：
 *   · `prefers-reduced-motion` 下 CSS 把动画整个关掉（shell.module.css 末尾的
 *     `animation: none`），计算值随之落到 ≈0（本项目 globals.css 另有一条全局降级规则
 *     把任何动画时长压成 0.01ms）⇒ 外壳很快视为就位（多等一个 SETTLE_SLACK_MS 的余量，
 *     不是「立刻」）⇒ §4.7 的「降级为直接切换」自动成立，不需要第二条降级路径；
 *   · 将来把动画调快调慢，只有 CSS 那一处要改。
 *
 * 调用方必须**两侧都读**（离场层 + 前台层）再取最大值：决定「就位」的是入场层何时停，
 * 而 shell.module.css 里四条时长是四处独立的字面量，没有任何机制强制它们相等。
 */
function slideDurationMs(el: HTMLElement | null): number {
  if (!el) return 0;
  const raw = window.getComputedStyle(el).animationDuration || '';
  let longest = 0;
  raw.split(',').forEach((part) => {
    const value = parseFloat(part);
    if (isNaN(value)) return;
    const ms = part.trim().slice(-2) === 'ms' ? value : value * 1000;
    if (ms > longest) longest = ms;
  });
  return longest;
}

/**
 * 三件套外壳（§4.1 / §4.3 / §4.5 / §4.6）：顶部 Tab 栏 + 首页 + 三个模块层。
 *
 * **单页，没有路由**（§4.11 B3）：四个视图是同一条页面上的四个层，切 Tab 不触发导航 ——
 * 一旦某个 Tab 有自己的路由，页面会重挂、`restoreSessionFromUrl` 重跑、
 * `loadClassroom` + `createStudentSession` + `startChatSession` 全部重发。
 *
 * 分层模型见 shell.module.css 的头部注释。这里只有两条规则：
 *   · 首页与每个**已挂载**的模块各占一层，同一时刻只有一层可交互（`visibility`）；
 *   · 「已挂载」由 `useModuleTabs` 决定（惰性挂载 + 永不卸载）。
 *
 * 为什么首页也做成一层而不是留在 `step` 分支里：§4.5 的「切换保留内容」对首页同样成立
 * （滚动位置、换头像弹窗开着没关），而且 §4.6 的切换动画要求两个面板在动画期共存 ——
 * 首页与模块之间也要动画。写成 `step` 的两个分支就没有共存的窗口了。
 */
export function ClassroomShell({ chat, home, onStepChange }: ClassroomShellProps) {
  // 外壳与学伴面板共用同一个 setToast（会话级状态由 page.tsx 持有，这里只是转手）。
  const { setToast } = chat;
  const { activeModuleId, mountedIds, tabs, openModule, goHome } = useModuleTabs({
    classroom: chat.classroom,
    setToast,
  });

  /** 前台层：`activeModuleId` 为 `null` 时是首页。**点击即刻生效**，不等动画。 */
  const frontKey: LayerKey = activeModuleId ?? 'home';

  /** 层的位次，只用来判方向：首页最左，模块按 Tab 栏顺序向右排。 */
  const orderOf = (key: LayerKey): number => {
    if (key === 'home') return 0;
    const index = tabs.findIndex((tab) => tab.id === key);
    return index === -1 ? 2 : index + 1; // 不在 tabs 里（刚被教师关掉）时给一个中性位次
  };

  const [phase, setPhase] = useState<ViewPhase>({
    front: frontKey,
    leaving: null,
    dir: 1,
    settled: true, // 首次挂载没有动画：首页就是前台，静止着出现
  });

  /**
   * 「渲染期调整 state」（React 官方模式）：前台一变，就把离场层、方向、未就位三件事
   * 在**同一个 commit 里**算好交给 DOM。
   *
   * 为什么不能放在 effect 里：effect 在绘制之后跑，于是会先画出一帧「新前台已经可见、
   * 旧前台已经不可见」，下一帧才补上离场动画 —— 那一帧就是闪烁（§4.6 要求两层面共存）。
   * 条件写成本身保证不会死循环：调整之后 `phase.front === frontKey`，下一次渲染不再进分支。
   */
  if (phase.front !== frontKey) {
    setPhase({
      front: frontKey,
      leaving: phase.front,
      dir: orderOf(frontKey) >= orderOf(phase.front) ? 1 : -1,
      settled: false,
    });
  }

  /** 层元素，只为「读动画时长」而存：就位判定要读离场层与前台层**两侧**（见 slideDurationMs）。 */
  const layerRefs = useRef<Partial<Record<LayerKey, HTMLElement | null>>>({});

  /**
   * 动画结束 → 前台层「就位」。
   *
   * **两侧时长取最大值**：离场层与当前前台层（入场层）各读一次，谁长听谁的。真正决定「就位」
   * 的是**入场层**何时停 —— 只读离场层的话，将来单独把 `.enterRight` / `.enterLeft` 调长
   * （四条 240ms 是四处独立的字面量，没有任何机制强制它们相等），`settled` 就会在入场层还在
   * 平移途中翻真，约束 ② 要防的 bug 原样回来，且没有任何编译期或运行期信号。
   *
   * 这样写仍然是失败安全的：类名被删/改名，或浏览器干脆不放动画 ⇒ 两侧都量不到时长、都 ≈0
   * ⇒ 只等一个 SETTLE_SLACK_MS 就位 —— 而此时入场层也没有 transform，**没有东西可量错**。
   * 时长与位移来自同一条 `animation` 声明，只能一起失效。
   *
   * 依赖整个 `phase`：切换会让它换一个对象，于是计时器重新开始（快速连点时永远以最后一次
   * 为准）；就位后 `settled` 为真，本 effect 直接返回，不再重排。
   */
  useEffect(() => {
    if (phase.settled) return;
    const leavingEl = phase.leaving ? layerRefs.current[phase.leaving] ?? null : null;
    const frontEl = layerRefs.current[phase.front] ?? null;
    const timer = window.setTimeout(() => {
      setPhase((prev) => (prev.settled ? prev : { ...prev, settled: true, leaving: null }));
    }, Math.max(slideDurationMs(leavingEl), slideDurationMs(frontEl)) + SETTLE_SLACK_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // 视图 → step 的镜像，见上。
  useEffect(() => {
    onStepChange(frontKey === 'home' ? 'home' : 'shell');
  }, [frontKey, onStepChange]);

  /**
   * 模块面板的 `active`：**在前台、且已滑到位**。
   *
   * 为什么不是「在前台」就够（Task 7 的约束 ②，学伴面板的标记条）：标记条 portal 到 body
   * 之后是视口坐标的 `position: fixed`，坐标由 `getBoundingClientRect()` 量出 —— 而它**包含
   * transform**。若 `active` 在滑动途中就翻真，面板会在 `active` 上升沿量到一个被平移过的
   * 容器，把那个偏移量当成最终值固定下来（transform 不改布局尺寸，容器的 ResizeObserver
   * 不会触发，没有第二次机会）。等就位再翻真，那条既有的上升沿补测就量在 translateX(0) 上。
   *
   * 反过来，**离场层当场失去 `active`**（不等动画）：它已经不在前台了，五处页面级副作用
   * （锁 body 滚动、语音、聚焦、浮层可见性）该立刻收手 —— 尤其是聚焦。反过来的写法（离场层
   * 保住 `active` 直到动画结束）会在滑动期间留一个窗口：AI 恰好答完时 `waitingAI` 翻转，
   * 面板会把键盘弹到一个正在滑走的层上，正是 §4.10 C2 担心的那件事。
   */
  const activate = (key: LayerKey) => phase.front === key && phase.settled;

  /**
   * 一层（首页 / 一个模块）。非前台层留在 DOM 里（§4.5），隐藏态由 CSS 负责：
   * 前台层是 `.layerFront`（可见），正在离场的那层挂离场动画（动画终点才 `visibility:hidden`），
   * 其余层落回 `.layer` 自身的隐藏态。
   *
   * **入场层永远拿不到隐藏态** —— 它拿的是 `.layerFront`，这是构造性的（见 shell.module.css）：
   * 一旦入场层在过渡期仍是 `visibility:hidden`，`focus()` 就是静默 no-op，切回学伴时键盘
   * 永远弹不出来（§4.10 C2，本任务的硬约束 ①）。
   */
  const layerClass = (key: LayerKey, base: string) => {
    const parts = [styles.layer, base];
    if (phase.front === key) {
      parts.push(styles.layerFront);
      if (!phase.settled) parts.push(phase.dir > 0 ? styles.enterRight : styles.enterLeft);
    } else if (phase.leaving === key) {
      parts.push(phase.dir > 0 ? styles.exitLeft : styles.exitRight);
    }
    return parts.join(' ');
  };

  const renderLayer = (key: LayerKey, base: string, children: ReactNode) => (
    <section
      key={key}
      ref={(el) => {
        layerRefs.current[key] = el;
      }}
      className={layerClass(key, base)}
    >
      {children}
    </section>
  );

  /**
   * 只有**前台那一层**渲染 Toast。
   *
   * 首页与学伴面板各自 portal 一个 `<Toast>`（在 Task 4 之前两者靠 `step` 二选一渲染，天然
   * 互斥）。外壳让两层同屏之后，同一个 `toast` 会被渲染两遍 —— 两个提示条叠在屏幕底部。
   * 所以由外壳把非前台层的 toast 置空：`toast` 状态仍只有一个（会话级，`chat.toast` 与
   * `home.toast` 是同一个对象），渲染点也只剩一处。
   *
   * 归属按 `front` 而不是 `activate`：按 `activate` 归属会在动画那 240ms 里**卸载**提示条
   * （两层都没「就位」）⇒ `<Toast>` 被卸载 ⇒ 它内部那个 3 秒计时器的 effect 清理掉重来，
   * 计时要重头数。**注意这不解决视觉闪烁**：提示条的可见性是由 portal 包装层的 `activate()`
   * 决定的（与归属无关），所以切层时两层都会 `visibility:hidden` 约 240+40ms，两种归属都有。
   * `front` 归属真正修掉的是**计时器被重置**。
   *
   * **每个前台层都必须能渲染**（Task 11）：规则是无条件的，按层分而不是按模块实现度分 ——
   * 占位面板也接住了 `toast` / `setToast`（契约里那两项）。前一版占位面板不接，于是学生站在
   * 占位模块上时设的提示没有任何渲染点：既看不见，又因为没有 `<Toast>` 实例而**没有任何
   * 3 秒计时器**，提示会滞留在会话状态里，等学生切回首页时突然弹出几分钟前的旧提示。
   */
  const toastFor = (key: LayerKey) => (phase.front === key ? chat.toast : null);

  /**
   * ── 换头像（M1b-3 T2）────────────────────────────────────────────────────────
   *
   * 入口只剩顶栏那一个（Ruling 1），所以编排上移到外壳：面板头与首页此前各有一份逐字等价的
   * 调用（模态渲染 + `finishAvatarChange`），两份都随本次撤除。共享实现
   * （`AvatarChangerModal` / `finishAvatarChange`）一行没动，只换了调用方 ——
   * `finishAvatarChange` 要的六项 `host` 全挂在 `chat` 这个对象上（它们本来就是会话级状态，
   * 外壳只是转手），所以这里**不新增任何状态**。
   */
  const [showAvatarChanger, setShowAvatarChanger] = useState(false);

  /**
   * 换头像弹窗的浮层 `active` 传**恒为真**，不是 `activate(...)`。
   *
   * `useOverlayPortal` 的 `active` 语义是「**这一层**此刻是不是前台」，它存在的唯一理由是
   * 把 portal 到 body 的浮层收敛回宿主层的可见性（见 layer-overlays.tsx 的文件头）。而换头像
   * 不属于任何一层：它由**四个 tab 共用、始终可见**的顶栏触发 —— `activate` 是 `front &&
   * settled`，顶栏连切换动画期间都必须可用，两者的语义本就不同。挂在任何模块层的 `active`
   * 上都是错的答案，两种错法各有症状：
   *   · 挂 `activate('companion')`：教师在弹窗开着时把学伴模块关掉 → `use-module-tabs` 的
   *     `:102-107` 把学生送回首页 ⇒ `front` 变、`settled` 在动画期翻假 ⇒ 弹窗被隐藏，
   *     而 `showAvatarChanger` 仍是 true ⇒ 再点顶栏头像**什么都不会发生**（`true → true`
   *     被 React 丢弃，不重渲染）⇒ 学生卡在一个「状态说开着、屏幕上没有」的弹窗上，
   *     只能靠刷新脱身；
   *   · 挂「当前前台那一层」：同一个窗口里切一次 tab 就让它凭空消失。
   * 恒为真 = 弹窗的存活期与它的宿主（顶栏，也就是外壳本身）一致。这与 `active` 那套语义
   * 不冲突：外壳只在学生进了课堂之后才存在，而弹窗关闭时 `showAvatarChanger` 为 false、
   * 传给 portal 的 node 是 `null`，`useOverlayPortal` 对它直接返回 `null`（什么都不渲染）。
   *
   * ⚠️ 必须走 `useOverlayPortal`（Ruling 2）：`.bar` 是 `overflow-x: auto; overflow-y: hidden`，
   * 就地渲染的浮层会被纵向裁掉；自己另写一个 portal 则会丢掉「按 active 显式收敛」这条唯一
   * 的收口（同上）。实测确认：弹窗的祖先链里没有 `.bar`（`closest('header') === null`），
   * 且整块落在视口内。
   *
   * ⚠️ 变量名带 `avatar` 是给 T3 让路（Ruling 8）：教师消息下拉会在这个文件里**另加一个
   * 独立的 portal**、`active` 语义很可能与本条不同。两条各叫各的名字，谁也不要去「复用」
   * 或「合并」对方那一个 —— 合并会让一个浮层的可见性被另一个的 `active` 决定。
   */
  const avatarOverlayPortal = useOverlayPortal(true);

  /**
   * ── 老师消息下拉（M1b-3 T3）─────────────────────────────────────────────────
   *
   * 状态、下拉本体与「点击外部关闭」的 document 监听原本都长在学伴面板头（`chat-panel.tsx`
   * 的 `showTeacherPanel`）。随入口一并搬到这里，因为**入口是顶栏，而顶栏属于外壳**：
   * 下拉的挂载点必须与它可见的那个外壳同生共死，挂在面板上就会随「面板是不是前台」被牵连
   * —— 而顶栏在外壳挂载期间**始终可见**，学生的消息不跟着模块切换走。
   *
   * 数据不用搬：`teacherMsgs` 本来就由会话持有（`chat.teacherMsgs`，面板只是接 prop），
   * 到这里只是从同一个 `chat` 对象里读。
   */
  const [teacherMsgsOpen, setTeacherMsgsOpen] = useState(false);

  /** 下拉按钮的引用：下拉 portal 到 body 之后，落点只能从按钮的矩形量出来（见下表）。 */
  const teacherMsgsButtonRef = useRef<HTMLButtonElement | null>(null);

  /**
   * 下拉的落点（**视口坐标**，配合 `position: fixed`）。
   *
   * 为什么不继续用原来那套 `position: absolute; top: 100%; right: 0`：绝对定位要求下拉是
   * 按钮在 DOM 上的后代，而它必须 portal 到 body（Ruling 2）—— `.bar` 是
   * `overflow-x: auto; overflow-y: hidden`，就地渲染的双向下拉会被纵向裁掉一半。
   * portal 之后唯一的锚定办法就是量出按钮的位置，把坐标写进行内样式。
   *
   * `null` = 还没打开过（从没量过）。它只在点击之后才落值，所以静态导出预渲染时不存在，
   * 也就没有「服务端输出与首次客户端渲染不一致」的余地。
   */
  const [teacherMsgsPos, setTeacherMsgsPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);

  /**
   * 量一次下拉该落在哪儿。
   *
   * 两个方向都做**视口夹取**（而不是原来那种「贴着按钮右缘、任由它出屏」）：顶栏是横向滚动
   * 的，窄屏上按钮本身就可能落在视口右缘之外（T5 会重排这一组，届时这是兜底），照抄
   * `right: 0` 会让整块下拉跟着出屏。夹取之后任何情况下它都完整落在视口内。
   *
   * `maxHeight` 跟着落点算：下拉是「贴按钮下缘、最多 300px、内部滚动」，落点越低能用到的
   * 高度就越少 —— 直接把可用高度写进去，比让浏览器把底部裁掉要好。
   */
  const measureTeacherMsgs = useCallback(() => {
    const anchor = teacherMsgsButtonRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(TEACHER_MSGS_WIDTH, window.innerWidth - TEACHER_MSGS_EDGE * 2);
    const maxLeft = window.innerWidth - TEACHER_MSGS_EDGE - width;
    const left = Math.min(Math.max(TEACHER_MSGS_EDGE, rect.right - width), Math.max(TEACHER_MSGS_EDGE, maxLeft));
    const top = rect.bottom + 6;
    const maxHeight = Math.min(300, Math.max(120, window.innerHeight - top - TEACHER_MSGS_EDGE));
    setTeacherMsgsPos((prev) => (
      prev && prev.left === left && prev.top === top && prev.width === width && prev.maxHeight === maxHeight
        ? prev
        : { left, top, width, maxHeight }
    ));
  }, []);

  /**
   * 打开期间**每次提交之后**重量一次（M1b-3 T5 修 C16）。
   *
   * 为什么不能只挂 scroll + resize：这两件事都得先有「浏览器认识的事件」发生。T3 审查实测过
   * 两个都不产生任何 scroll 事件的反例：
   *   · 教师关掉一个模块 ⇒ Tab 组少一项、栏内重排，消息按钮**左移 107px**（三个模块全关时
   *     可达约 300px）。1280×800 下可滚动元素数为 0、文档也不滚动 ⇒ **永远不会产生
   *     scroll 事件** ⇒ 脱节一直保持到学生手动关掉再打开下拉；
   *   · 角标首次出现（学生正开着下拉读消息、老师发来第一条通知）⇒ 按钮 36 → 51px ⇒ 脱节 15px。
   * 两者都是 **React 状态变化引起的布局变化**，所以「每次提交后重量一次」正好覆盖它们。
   * 无依赖数组的 effect 就是「每次提交后运行」；`measureTeacherMsgs` 内部有等值短路
   * （四项全等时返回原对象），所以这一次额外的 setState 不会自激成循环。
   *
   * 用 `useLayoutEffect` 而不是 `useEffect`：落点是**视口坐标的行内样式**，必须在同一帧的
   * 绘制**之前**落定，否则会有一帧「按钮已经动了、下拉还在原地」。下拉没开着时它空转一次
   * （一次提前 return），代价可以忽略。
   *
   * ⚠️ 不要换成 `ResizeObserver`：T3 审查实测过净尺寸增量 `{button:0, chip:0, actions:0,
   * nav:1, bar:0}` —— 模块增减时**按钮自己的尺寸一点没变**，变的只是位置，而变尺寸的是
   * `nav.tabs`。ResizeObserver 只看尺寸、不看位置，挂在按钮或栏上都不会触发。
   */
  useLayoutEffect(() => {
    if (!teacherMsgsOpen) return;
    measureTeacherMsgs();
  });

  /**
   * 打开期间跟着按钮走：顶栏自己横向滚动、以及旋转屏幕。
   *
   * `scroll` 必须用**捕获阶段**：`.bar` 自己就是横向滚动容器，而 `scroll` 事件不冒泡 ——
   * 不捕获的话，顶栏横向滚动时下拉会留在原地，与按钮脱开。`resize` 覆盖旋转屏幕（夹取依赖
   * 视口宽度，不重量就会留一个按旧宽度算出的落点）。
   *
   * ⚠️ 这两条与上面那条「每次提交后重量」是**互补**的，不是重复：scroll / resize 根本不经过
   * React 提交（顶栏横向滚动并不引起重渲染），只有事件监听能覆盖它们。
   */
  useEffect(() => {
    if (!teacherMsgsOpen) return;
    const remeasure = () => measureTeacherMsgs();
    window.addEventListener('scroll', remeasure, true);
    window.addEventListener('resize', remeasure);
    return () => {
      window.removeEventListener('scroll', remeasure, true);
      window.removeEventListener('resize', remeasure);
    };
  }, [teacherMsgsOpen, measureTeacherMsgs]);

  /**
   * 点击外部关闭。
   *
   * ⚠️ 挂在**什么条件**上（面板那版是 `active && showTeacherPanel`）：搬到这里之后
   * `active` 没有对应物，条件只剩「下拉开着」一条 —— 因为顶栏在外壳挂载期间**始终可见**
   * （它不在任何一层里，切 Tab 只动 `.stage` 里的层），面板那半条 `active` 想排除的
   * 「模块隐藏、点了也没意义」这个窗口在这里**不存在**。外壳一旦卸载（退出/换身份/课堂结束），
   * 下面这条清理照跑，监听一并摘掉。
   *
   * ⚠️⚠️ 两条细节**必须**原样带着，不是可选优化：
   *   ① **延时挂载 + 显式 clearTimeout**：延时是为了躲开「打开它的那一次点击」；而清理里
   *      必须显式清掉定时器 —— 否则清理先于定时器执行时会 remove 一个尚未 add 的监听，
   *      随后那个定时器再把 handler **永久**挂到 document 上（再也摘不掉，包括卸载时）。
   *      `teacherMsgsOpen` 进依赖后挂载/摘除会很频繁，这个窗口必须关掉。
   *   ② 判「点在外面」用的是 `contains`，而 `teacherMsgsPanelRef` 挂在**portal 出去的那块
   *      下拉自己身上**（不是按钮的包裹层）：DOM 上它已不在按钮旁边，`contains` 照样成立
   *      （它比的是 DOM 树，不是布局）。点按钮时两条路都会把它关掉（React 的 onClick 先跑，
   *      再轮到 document 上的这条），结果一致且幂等。
   */
  const teacherMsgsPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!teacherMsgsOpen) return;
    const handler = (e: MouseEvent) => {
      if (teacherMsgsPanelRef.current && !teacherMsgsPanelRef.current.contains(e.target as Node)) {
        setTeacherMsgsOpen(false);
      }
    };
    // 延迟挂载以避免触发按钮自身的 click 事件
    const attachTimer = window.setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      window.clearTimeout(attachTimer);
      document.removeEventListener('click', handler);
    };
  }, [teacherMsgsOpen]);

  /**
   * 下拉那条独立 portal（Ruling 8：**另加自己那一个**，不去复用换头像的
   * `avatarOverlayPortal`）。两条的 `active` 语义在本文件里都是「恒为真」，但它们**各量各的
   * 落点、各有各的关闭路径**，合并会让一个浮层的可见性由另一个的状态决定。
   *
   * `active` 恒为真的理由与换头像弹窗同源：它由**四个 tab 共用、始终可见**的顶栏触发，
   * 不属于任何一层 —— 挂在任何模块层的 `active` 上，教师在另一个 tab 上关掉/切换模块就会
   * 把这个开着的下拉弄没（而 `teacherMsgsOpen` 仍是 true）。关闭时 `teacherMsgsOpen` 为
   * false、传给 portal 的 node 是 `null`，`useOverlayPortal` 直接返回 `null`，什么都不渲染。
   */
  const teacherMsgsOverlayPortal = useOverlayPortal(true);

  /** 顶栏头像是否表现为「可换」：真实学生参与者（小组没有这个能力）且教师奖励过机会。 */
  const canChangeAvatar = Boolean(chat.selectedStudent?.studentId) && chat.avatarTokenCount > 0;

  /**
   * 顶栏头像被点击。**任何情况下都要有反馈**（Ruling 1）：有机会就开弹窗，没机会就说清
   * 为什么 —— 文案与首页原来那行常驻提示（`avatarHint`）逐字相同。
   *
   * 从「常驻的一行灰字」改成「点击时的一句提示」是刻意的：顶栏高 52px、chip 只有 36px，
   * 放不下一行常驻说明；而 §4.4 那条「空状态要给出方向、不是把入口藏掉」照样成立 ——
   * 入口还在（可点），理由在点下去的那一刻说清楚。这个分支只有「是真实学生、机会为 0」
   * 一种情形能走到（小组参与者渲染的不是按钮），所以这句话在这里**永远是真的**。
   */
  const handleChangeAvatar = () => {
    if (canChangeAvatar) {
      setShowAvatarChanger(true);
      return;
    }
    setToast({ msg: '换头像的机会由老师奖励', type: 'info' });
  };

  /** 换头像的收尾（写透当前会话 → 拉服务端权威数据）：`chat` 结构性地满足 `AvatarChangeHost`。 */
  const handleAvatarChanged = async (result: { avatarId: number; svgContent: string }) => {
    await finishAvatarChange(
      {
        classroom: chat.classroom,
        selectedStudent: chat.selectedStudent,
        setAvatarSvgs: chat.setAvatarSvgs,
        setSelectedStudent: chat.setSelectedStudent,
        setAllStudentAvatars: chat.setAllStudentAvatars,
        fetchStudentTokens: chat.fetchStudentTokens,
      },
      result,
      () => setShowAvatarChanger(false),
    );
  };

  return (
    <div className={styles.shell}>
      {/* 操作组（M1b-3 T1）的四项能力全部来自 `chat` —— 它们本来就是会话级状态，
          外壳只是转手，因此这里**不新增任何状态、不新增 effect**。
          面板头那四个同名同义的入口已随 M1b-3 T4 整行撤除，所以顶栏这一组是**唯一**一份。 */}
      <ModuleTabBar
        tabs={tabs}
        activeId={activeModuleId}
        onSelect={openModule}
        onHome={goHome}
        connected={chat.connected}
        selectedStudent={chat.selectedStudent}
        avatarSvgs={chat.avatarSvgs}
        avatarTokenCount={chat.avatarTokenCount}
        onChangeAvatar={handleChangeAvatar}
        onSwitchIdentity={chat.onSwitchIdentity}
        onExit={chat.onExit}
        teacherMsgCount={chat.teacherMsgs.length}
        teacherMsgsOpen={teacherMsgsOpen}
        teacherMsgsButtonRef={teacherMsgsButtonRef}
        onToggleTeacherMsgs={() => setTeacherMsgsOpen((prev) => !prev)}
      />

      <div className={styles.stage}>
        {renderLayer(
          'home',
          styles.homeLayer,
          <StudentHome
            {...home}
            active={activate('home')}
            toast={toastFor('home')}
            onOpenModule={openModule}
          />,
        )}

        {mountedIds.map((id) => (
          renderLayer(id, styles.moduleLayer, id === 'companion' ? (
            <StudentChatContent
              // Ruling 4（路线 A）：换身份即重挂，卸载清理才会跑 —— `streamingRafRef` /
              // `streamingBufferRef` 的复位与「草稿不跨学生泄漏」都只长在那条清理里。
              // 用 `selectedStudent?.id` 而**不是** tab id：切 Tab 时它不变，所以切 Tab
              // 保留内容（正是 §4.5 要的），只有换身份才重挂。
              key={chat.selectedStudent?.id ?? 'no-student'}
              {...chat}
              active={activate(id)}
              toast={toastFor(id)}
            />
          ) : (
            <ModulePlaceholder
              moduleId={id}
              active={activate(id)}
              state={moduleStateFor(chat.classroom?.modules, id)}
              classroom={chat.classroom}
              session={chat.selectedStudent}
              // 占位面板也要接住 Toast：学生站在它上面时设的提示必须有渲染点（Task 11）。
              // `setToast` 与首页、学伴面板是同一个会话级 setter，所以关闭仍然是唯一一处写入。
              toast={toastFor(id)}
              setToast={setToast}
            />
          ))
        ))}
      </div>

      {/* 换头像弹窗（`.modal-overlay` 是 `position: fixed` / z-index 100，已 portal 到 body）。
          `titleId` 仍是入参而不是常量：DOM 里同时存在几个弹窗由调用方决定，共用 id 会让
          `aria-labelledby` 解析到先出现的那个（而且那是非法 HTML）—— 收敛成一处之后这个
          约束在此刻是「恰好只有一个」，但契约留在 prop 上，将来多一个入口不用改实现。 */}
      {avatarOverlayPortal(showAvatarChanger && (
        <AvatarChangerModal
          titleId="shell-avatar-changer-title"
          avatarTokenCount={chat.avatarTokenCount}
          studentId={chat.selectedStudent?.id ?? ''}
          avatars={chat.allStudentAvatars}
          setToast={setToast}
          onClose={() => setShowAvatarChanger(false)}
          onChanged={handleAvatarChanged}
        />
      ))}

      {/* 老师消息下拉（M1b-3 T3）。JSX 逐字沿袭面板头那版（配色、间距、圆角、空态文案），
          只有两处**必须**不同：
            · 外层容器从「按钮的绝对定位兄弟」变成 portal 到 body 的 `position: fixed`，
              坐标由 `teacherMsgsPos` 给（理由见上面 `teacherMsgsOverlayPortal` 的注释）；
            · 宽度与最大高度跟着量出来的落点走（视口夹取，见 `measureTeacherMsgs`）。
          `teacherMsgsPos` 为 null 时不渲染 —— 它只在打开之后才可能为 null（量在 effect 里，
          而那个 effect 与 `teacherMsgsOpen` 同一次提交后运行），所以肉眼不可见。 */}
      {teacherMsgsOverlayPortal(teacherMsgsOpen && teacherMsgsPos && (
        <div ref={teacherMsgsPanelRef} style={{
          position: 'fixed', left: teacherMsgsPos.left, top: teacherMsgsPos.top, zIndex: 50,
          width: teacherMsgsPos.width, maxHeight: teacherMsgsPos.maxHeight, overflowY: 'auto',
          borderRadius: 10, border: '1px solid #e0e7ff',
          background: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
        }}>
          {chat.teacherMsgs.length === 0 ? (
            <div style={{ padding: '24px 14px', textAlign: 'center', color: '#94a3b8', fontSize: '0.813rem' }}>
              暂无老师消息
            </div>
          ) : (
            chat.teacherMsgs.map((msg, i) => (
              <div key={i} style={{
                display: 'flex', gap: 10, padding: '10px 14px',
                borderBottom: i < chat.teacherMsgs.length - 1 ? '1px solid #f1f5f9' : 'none',
              }}>
                <div style={{
                  flexShrink: 0, width: 26, height: 26, borderRadius: 7,
                  background: 'linear-gradient(135deg, #4338ca, #6366f1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff',
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.75rem', color: '#4338ca' }}>老师</span>
                    <span style={{ fontSize: '0.688rem', color: '#94a3b8' }}>{msg.time}</span>
                  </div>
                  <div style={{ fontSize: '0.813rem', color: '#1e293b', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{msg.message}</div>
                </div>
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
