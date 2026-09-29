import type { SVGProps } from 'react';

type NavigationIconProps = Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & {
  size?: number;
};

/**
 * 学习单：夹板 + 两项课堂任务。
 *
 * 轮廓只用 24×24 网格里的大形状，18px 的教师侧栏和 21px 的学生 Tab 都能看清。
 */
export function WorksheetNavigationIcon({ size = 24, ...props }: NavigationIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 4H6.5A2.5 2.5 0 0 0 4 6.5v12A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-12A2.5 2.5 0 0 0 17.5 4H16" />
      <rect x="8" y="2.5" width="8" height="4" rx="1.5" />
      <path d="m8 11 1.4 1.4 2.4-2.7M14.5 11.2H17" />
      <path d="m8 16.5 1.4 1.4 2.4-2.7M14.5 16.7H17" />
    </svg>
  );
}

/**
 * 探究空间：网页窗口里可拖动的圆点、方块与连接路径。
 *
 * 它表达的是教师制作的交互式网页，不使用地球或实验器材，避免被理解成普通网站或单一学科。
 */
export function ExploreSpaceNavigationIcon({ size = 24, ...props }: NavigationIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="2.5" y="3" width="19" height="18" rx="2.5" />
      <path d="M2.5 8h19" />
      <circle cx="6" cy="5.5" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="8.8" cy="5.5" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="14.5" r="2.2" />
      <rect x="15.2" y="12.7" width="3.5" height="3.5" rx="0.7" />
      <path d="M9.8 14.4c1.8-2.4 3.5 2 5.3 0" />
    </svg>
  );
}

/**
 * 智能体（教师侧栏「AI智能体」与学生端「学伴」那一族）。
 *
 * ★ 2026-09-29（教师）：「三个图标改一改，跟左侧菜单栏一致」——
 * 看板工具条上「学习单 / 探究空间 / 智能学伴」那三个按钮的图标换成**侧栏那三个**。
 * 「学习单」「探究空间」本来就已经是共用组件；这一个原来**内联在 `teacher/layout.tsx`** 里
 * ⇒ 抽到这里，两处共用一份（各写一份必然漂移，而屏幕上只是「两个地方的图标长得不一样」）。
 * ⚠️ 图形与侧栏那一枚逐字相同（同一个 24×24 网格、同样的 `strokeWidth`）。
 */
export function AgentNavigationIcon({ size = 24, ...props }: NavigationIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9 12h6" />
      <path d="M12 9v6" />
      <path d="M8 4V2" />
      <path d="M16 4V2" />
      <path d="M8 20v2" />
      <path d="M16 20v2" />
    </svg>
  );
}
