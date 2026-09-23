'use client';

import type { CSSProperties } from 'react';
import { MODULE_META } from '../module-meta';
import type { ModuleId, ModulePanelProps } from '../classroom-types';
import { ClassroomToast, useOverlayPortal } from '../layer-overlays';
import styles from './shell.module.css';

/**
 * 未实现模块的占位（Ruling 2）—— **今天没有任何调用点**。
 *
 * ── 为什么它还在，以及为什么它的 `moduleId` 是 `never` ─────────────────────
 *
 * 它存在的意义不是「先占个位置」，而是让外壳、三态、挂载、切换这些**真实机制**在
 * 模块落地之前就能被完整验证（§4.8 的性能门槛压的正是「三个模块同时挂载」）。
 * 随着 P1 的学习单面板在 D2 落地，`ModuleId` 的三项**全部**有了真面板
 * （学伴 / 探究空间 / 学习单），外壳的三路分发里因此**不再有占位分支**。
 *
 * ⇒ `ModulePlaceholderProps.moduleId` 的类型就是 `never`：
 *   · 「外壳把某个**真面板**渲染成占位」——也就是 `moduleId={'worksheet'}` 这种写法 ——
 *     现在是**编译错误**。这正是当年 `PlaceholderModuleId = Exclude<ModuleId, …>` 立的那道门，
 *     三个模块全落地之后它只剩一个空集，于是写成 `never` 反而是它现在准确的样子；
 *   · 任何一个新模块（P4…）落地时**也不会**用到本组件：那一刻要做的是一个真面板。
 *
 * ⚠️ **谁想删这个文件，请先一并处理两处引用它的注释**：`classroom-types.ts` 里
 * 「占位面板也接住了 `toast` / `setToast`」（Task 11 补进契约的那两项）与
 * `_ContractCheck` 那一段都以「`ModulePlaceholderProps extends ModulePanelProps`」为例
 * 讲「契约加一项 = 编译错误」。单独删掉本文件会让那两段话指向幽灵。
 *
 * ── 为什么占位面板（当年）也必须渲染 Toast（M1b-2 Task 11）──────────────────
 * 外壳的 Toast 归属规则是「前台那一层渲染，别的层拿到 null」，而它的 3 秒自动关闭计时器
 * 长在 `<Toast>` 组件内部 —— 一个不接住 `toast` 的层被放到前台时，学生设的提示
 * （例：点未开放的 Tab ⇒ 「老师还没开放」，§4.4；`avatar-rewarded` 的奖励提示）
 * 会**没有任何渲染点**：不只是看不见，是连计时器都不存在，提示会滞留在会话状态里，
 * 等学生切回首页时突然弹出一条几分钟前的旧提示。归属仍然只有一处（外壳按 `front` 交给
 * 某一层），所以这里渲染**不会**造成双份叠加。
 *
 * 走 `useOverlayPortal` 而不是就地渲染：`<Toast>` 是 `position: fixed`，而层在切换动画里
 * 带 `transform`（会成为它的包含块）且 `.stage` 有 `overflow: hidden`（会裁掉它）——
 * 与首页、学伴面板同一条理由（Ruling 5）。portal 提上去之后不再继承本层的
 * `visibility: hidden`，所以可见性必须显式按 `active` 决定（隐藏期间 `Toast` 仍是挂载的，
 * 计时器照跑，与首页/学伴面板的口径一致）。
 */
export interface ModulePlaceholderProps extends ModulePanelProps {
  /** 见文件头：三个模块全部落地之后这个类型**只剩空集**，写出来就是 `never`。 */
  moduleId: never;
}

export function ModulePlaceholder({ moduleId, active, toast, setToast }: ModulePlaceholderProps) {
  // ⚠️ 这一个 `as ModuleId` **不是**在绕过上面那道门：入参的类型是 `never`，
  // 调用方**给不出任何值**（给 `'worksheet'` 直接编译失败）。变量本身是 `never` 时
  // TS 不允许读属性（`MODULE_META[moduleId].accent` 会报「Property 'accent' does not
  // exist on type 'never'」），而模块身份色只能来自 `MODULE_META` 这一处来源
  // （它的文件头写死了那条规矩：各写一份字面量必然漂移）。
  const meta = MODULE_META[moduleId as ModuleId];
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
