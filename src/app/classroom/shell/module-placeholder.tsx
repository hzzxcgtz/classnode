'use client';

import type { CSSProperties } from 'react';
import { MODULE_META } from '../module-meta';
import type { ModuleId, ModulePanelProps } from '../classroom-types';
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
 * 模块层：被惰性挂载、永不被卸载、`hidden` 后仍留在 DOM 里。它自己没有任何副作用，
 * 也不需要响应 `active`（契约里的 `active` 由 props 类型接住，供 M2/M3 换掉本组件时使用）。
 *
 * 文案与首页卡片的语气一致（「敬请期待」）：学生看到的是一个诚实的「还没有」，不是坏掉的页面。
 */
export function ModulePlaceholder({ moduleId }: ModulePlaceholderProps) {
  const meta = MODULE_META[moduleId];
  return (
    <div className={styles.placeholder}>
      <div className={styles.placeholderCard} style={{ '--module-accent': meta.accent } as CSSProperties}>
        <span className={styles.placeholderBadge}>{meta.label}</span>
        <p className={styles.placeholderTitle}>这个模块还在准备中，敬请期待</p>
        <p className={styles.placeholderNote}>老师开放后，这里就会是你的{meta.label}。</p>
      </div>
    </div>
  );
}
