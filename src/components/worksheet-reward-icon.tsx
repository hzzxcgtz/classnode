'use client';

import type { CSSProperties } from 'react';
import type { RewardStyle } from '@/lib/worksheet-reward';
import styles from './worksheet-reward-icon.module.css';

export type RewardIconState = 'empty' | 'drafting' | 'earned';

interface RewardIconProps {
  kind: RewardStyle;
  state?: RewardIconState;
  size?: number;
  className?: string;
  label?: string;
}

/** ClassNode 徽章单独成图，其他十种收藏型奖励分为两张雪碧图；分数保持清晰的矢量加分徽章。 */
export function RewardIcon({
  kind,
  state = 'earned',
  size = 28,
  className = '',
  label,
}: RewardIconProps) {
  const accessible = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  const commonClassName = `${styles.icon}${className ? ` ${className}` : ''}`;
  const style = { '--reward-icon-size': `${size}px` } as CSSProperties;

  if (kind === 'classnode') {
    return (
      <span
        className={`${commonClassName} ${styles.classnodeIcon}`}
        data-kind={kind}
        data-state={state}
        style={style}
        {...accessible}
      />
    );
  }

  if (kind === 'star' || kind === 'flower' || kind === 'trophy' || kind === 'bear') {
    return (
      <span
        className={`${commonClassName} ${styles.sprite}`}
        data-kind={kind}
        data-state={state}
        style={style}
        {...accessible}
      />
    );
  }

  if (
    kind === 'rocket'
    || kind === 'gem'
    || kind === 'crown'
    || kind === 'lightning'
    || kind === 'bulb'
    || kind === 'key'
  ) {
    return (
      <span
        className={`${commonClassName} ${styles.sprite} ${styles.spriteSecond}`}
        data-kind={kind}
        data-state={state}
        style={style}
        {...accessible}
      />
    );
  }

  if (kind === 'points') {
    return (
      <svg
        className={commonClassName}
        data-kind={kind}
        data-state={state}
        viewBox="0 0 48 48"
        width={size}
        height={size}
        style={style}
        {...accessible}
      >
        <path className={styles.main} d="m24 4 5 6.5 8-1 1.5 8 6.5 5-6.5 5 1.5 8-8-1.5-5 6.5-5-6.5-8 1-1.5-8-6.5-5 6.5-5-1.5-8 8 1.5L19 10.5 24 4Z" />
        <path className={styles.inkStroke} d="M24 16v16M16 24h16" />
      </svg>
    );
  }

  return null;
}
