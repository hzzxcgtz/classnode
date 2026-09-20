'use client';

import type { CSSProperties } from 'react';
import { MODULE_META } from '../module-meta';
import type { ModuleId, ModulePanelProps } from '../classroom-types';
import { ClassroomToast, useOverlayPortal } from '../layer-overlays';
import styles from './shell.module.css';

/** 学习单与探究助手：M1b-2 里它们是**占位面板**（Ruling 2），M3 / M2 才实现。 */
type PlaceholderModuleId = Exclude<ModuleId, 'companion'>;

/**
 * 占位面板的 props。**`extends ModulePanelProps` 是刻意的**：契约（§4.3）要求「每个模块
 * 都接住 `active` / `state` / `classroom` / `session`」，而这里四项的名字与契约完全一致
 * （学伴面板做不到这一点，所以那边只留了一个结构锚点 —— 见 classroom-types.ts 的
 * `_ContractCheck`）。用 `extends` 而不是另写一遍字段：契约加一项时这里会**编译失败**，
 * 而不是悄悄少接一个 prop。
 *
 * `moduleId` 收窄到非 `companion`：学伴是真面板。写宽了会让「外壳把学伴也渲染成占位」
 * 变成合法代码，而那正是 Ruling 2 要防的假象。
 */
export interface ModulePlaceholderProps extends ModulePanelProps {
  moduleId: PlaceholderModuleId;
}

/**
 * 未实现模块的占位（Ruling 2）。
 *
 * 存在的意义不是「先占个位置」，而是让外壳、三态、挂载、切换这些**真实机制**在 M2/M3 之前
 * 就能被完整验证（§4.8 的性能门槛压的正是「三个模块同时挂载」）。所以它必须是一个正常的
 * 模块层：被惰性挂载、永不被卸载、`hidden` 后仍留在 DOM 里。除了下面这条 Toast，它自己
 * **没有任何副作用**，也不需要响应 `active`（契约里的 `active` 接住后正好只给 Toast 的
 * portal 用）。
 *
 * 文案与首页卡片的语气一致（「敬请期待」）：学生看到的是一个诚实的「还没有」，不是坏掉的页面。
 *
 * **为什么占位面板也必须渲染 Toast（M1b-2 Task 11）**：外壳的归属规则是「前台那一层渲染，
 * 别的层拿到 null」，而它的 3 秒自动关闭计时器长在 `<Toast>` 组件内部 —— 占位面板前一版
 * 没接住 `toast`，于是学生**站在占位模块上**时设的提示（例：点未开放的 Tab ⇒ 「老师还没开放」，
 * §4.4；`avatar-rewarded` 的奖励提示）会**没有任何渲染点**：不只是看不见，是连计时器都不存在，
 * 提示会滞留在会话状态里，等学生切回首页时突然弹出一条几分钟前的旧提示。
 * 归属仍然只有一处（外壳按 `front` 交给某一层），所以这里渲染**不会**造成双份叠加。
 *
 * 走 `useOverlayPortal` 而不是就地渲染：`<Toast>` 是 `position: fixed`，而层在切换动画里带
 * `transform`（会成为它的包含块）且 `.stage` 有 `overflow: hidden`（会裁掉它）—— 与首页、
 * 学伴面板同一条理由（Ruling 5）。portal 提上去之后不再继承本层的 `visibility: hidden`，
 * 所以可见性必须显式按 `active` 决定（隐藏期间 `Toast` 仍是挂载的，计时器照跑，
 * 与首页/学伴面板的口径一致）。
 */
export function ModulePlaceholder({ moduleId, active, toast, setToast }: ModulePlaceholderProps) {
  const meta = MODULE_META[moduleId];
  const overlayPortal = useOverlayPortal(active);
  return (
    <div className={styles.placeholder}>
      <div className={styles.placeholderCard} style={{ '--module-accent': meta.accent } as CSSProperties}>
        <span className={styles.placeholderBadge}>{meta.label}</span>
        <p className={styles.placeholderTitle}>这个模块还在准备中，敬请期待</p>
        <p className={styles.placeholderNote}>老师开放后，这里就会是你的{meta.label}。</p>
      </div>
      {overlayPortal(toast ? <ClassroomToast toast={toast} setToast={setToast} /> : null)}
    </div>
  );
}
