'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { MODULE_META } from '../module-meta';
import type { ModuleId } from '../classroom-types';
import type { ModuleTabEntry } from './use-module-tabs';
import styles from './shell.module.css';

export interface ModuleTabBarProps {
  /** 已启用（非 `hidden`）的模块，顺序由 `MODULE_KEYS` 决定。 */
  tabs: ModuleTabEntry[];
  /** 前台是哪个模块；`null` = 首页。 */
  activeId: ModuleId | null;
  onSelect: (id: ModuleId) => void;
  onHome: () => void;
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

/**
 * 顶部 Tab 栏（§4.1 / §4.2 / §4.7）。
 *
 * 三条规则，各自都有明确的来源：
 *   1. **首页入口在最左**（§4.2：「从模块返回首页的入口放在 Tab 栏最左侧」）。它是学生
 *      唯一的回门户通道，所以**只启用一个模块时也保留**（见第 3 条）。
 *   2. **只渲染非 `hidden` 的模块**；`preview` 显示但灰掉，点击由 `use-module-tabs` 的
 *      闸门给出「老师还没开放」——与首页卡片同一句提示、同一处闸门（§4.4 的三态表）。
 *   3. **只启用一个模块时不渲染 Tab 栏**（§4.7）：那时没有「切换」可言，一排只有一个
 *      按钮的 Tab 栏只是噪音。但**栏本身仍在**，因为首页入口不能跟着消失 —— 否则学生
 *      进了唯一的那个模块就再也回不到首页（§4.2 把回首页的入口放在这里，没有第二个）。
 *      判断写成「模块项 ≥ 2 才渲染 Tab 组」，而不是「整条栏渲染与否」。
 *
 * Task 7 在这里加了随选中项平移的指示器滑块（只用 `transform`/`opacity`）：
 * 滑块是一枚**半透明**的模块色药丸（见 shell.module.css 的 `.tabIndicator`），
 * 位置与宽度由 `offsetLeft` / `offsetWidth` 量出来 —— 不用 `getBoundingClientRect()`，
 * 因为它含祖先的 `transform`，而本壳的切换动画正在平移整个层。
 */
export function ModuleTabBar({ tabs, activeId, onSelect, onHome }: ModuleTabBarProps) {
  const homeActive = activeId === null;
  const showTabs = tabs.length >= 2;

  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Partial<Record<ModuleId, HTMLButtonElement | null>>>({});

  /** 滑块的几何：`x`（相对 nav 左缘）/ `w`。`null` = 还没量过（首次点击之前）。 */
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null);

  /**
   * 量一次滑块该在哪儿。
   *
   * `activeId === null`（首页在前台）时**什么都不做**：保留上一次的位置而不是清零，
   * 否则下次进模块时滑块会从栏的左端滑过来，而它该做的是在正确的位置淡入。
   * 落点是 `transform: translateX()` 而不是 `left` —— 布局属性动不了（动画只允许
   * transform/opacity），而 width 直接写死、不参与过渡（相邻 Tab 的宽度只差几个像素，
   * 肉眼看到的就是平移）。
   */
  const measure = useCallback(() => {
    if (activeId === null) return;
    const el = itemRefs.current[activeId];
    if (!el) return;
    const x = el.offsetLeft;
    const w = el.offsetWidth;
    setIndicator((prev) => (prev && prev.x === x && prev.w === w ? prev : { x, w }));
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
            className={styles.tabIndicator}
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
                style={{ '--tab-accent': meta.accent } as CSSProperties}
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
    </header>
  );
}
