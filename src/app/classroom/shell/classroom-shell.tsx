'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { ChatPanelProps } from '../classroom-types';
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

/**
 * 三件套外壳（§4.1 / §4.3 / §4.5）：顶部 Tab 栏 + 首页 + 三个模块层。
 *
 * **单页，没有路由**（§4.11 B3）：四个视图是同一条页面上的四个层，切 Tab 不触发导航 ——
 * 一旦某个 Tab 有自己的路由，页面会重挂、`restoreSessionFromUrl` 重跑、
 * `loadClassroom` + `createStudentSession` + `startChatSession` 全部重发。
 *
 * 分层模型见 shell.module.css 的头部注释。这里只有两条规则：
 *   · 首页与每个**已挂载**的模块各占一层，同一时刻只有一层可见（`visibility`）；
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
  const homeActive = activeModuleId === null;

  // 视图 → step 的镜像，见上。
  useEffect(() => {
    onStepChange(homeActive ? 'home' : 'shell');
  }, [homeActive, onStepChange]);

  /**
   * 一层（首页 / 一个模块）。非活动层留在 DOM 里，只是 `visibility:hidden`（§4.5）——
   * 隐藏态顺带获得「不可聚焦、不可点」的语义（§4.10 C2），这对面板里那些自动聚焦的
   * effect 是必需的：`visibility:hidden` 下 `focus()` 静默 no-op，不会把键盘弹到别的 Tab 上。
   *
   * 可见性走 class 而不是内联 style：Task 7 的切换动画要接管这件事（动画期两层面共存，
   * 结束后才给**离场**层加 hidden），内联 style 会与它打架。
   */
  const renderLayer = (key: string, active: boolean, className: string, children: ReactNode) => (
    <section key={key} className={`${styles.layer} ${className} ${active ? styles.layerVisible : ''}`.trim()}>
      {children}
    </section>
  );

  /**
   * 只有**当前可见的那一层**渲染 Toast。
   *
   * 首页与学伴面板各自 portal 一个 `<Toast>`（在 Task 4 之前两者靠 `step` 二选一渲染，天然
   * 互斥）。外壳让两层同屏之后，同一个 `toast` 会被渲染两遍 —— 两个提示条叠在屏幕底部。
   * 所以由外壳把不可见层的 toast 置空：`toast` 状态仍只有一个（会话级，`chat.toast` 与
   * `home.toast` 是同一个对象），渲染点也只剩一处。
   */
  const toastFor = (active: boolean) => (active ? chat.toast : null);

  return (
    <div className={styles.shell}>
      <ModuleTabBar tabs={tabs} activeId={activeModuleId} onSelect={openModule} onHome={goHome} />

      <div className={styles.stage}>
        {renderLayer(
          'home',
          homeActive,
          styles.homeLayer,
          <StudentHome
            {...home}
            active={homeActive}
            toast={toastFor(homeActive)}
            onOpenModule={openModule}
          />,
        )}

        {mountedIds.map((id) => {
          const active = activeModuleId === id;
          return renderLayer(id, active, styles.moduleLayer, id === 'companion' ? (
            <StudentChatContent
              // Ruling 4（路线 A）：换身份即重挂，卸载清理才会跑 —— `streamingRafRef` /
              // `streamingBufferRef` 的复位与「草稿不跨学生泄漏」都只长在那条清理里。
              // 用 `selectedStudent?.id` 而**不是** tab id：切 Tab 时它不变，所以切 Tab
              // 保留内容（正是 §4.5 要的），只有换身份才重挂。
              key={chat.selectedStudent?.id ?? 'no-student'}
              {...chat}
              active={active}
              toast={toastFor(active)}
            />
          ) : (
            <ModulePlaceholder
              moduleId={id}
              active={active}
              state={moduleStateFor(chat.classroom?.modules, id)}
              classroom={chat.classroom}
              session={chat.selectedStudent}
            />
          ));
        })}
      </div>
    </div>
  );
}
