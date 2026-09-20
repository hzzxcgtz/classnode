'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatPanelProps, ModuleId } from '../classroom-types';
import type { StudentHomeProps } from '../home/student-home';
import { StudentHome } from '../home/student-home';
import { StudentChatContent } from '../chat/chat-panel';
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

  return (
    <div className={styles.shell}>
      <ModuleTabBar tabs={tabs} activeId={activeModuleId} onSelect={openModule} onHome={goHome} />

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
    </div>
  );
}
