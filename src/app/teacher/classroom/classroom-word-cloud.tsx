'use client';

import { useId, useMemo, type CSSProperties, type Ref } from 'react';
import type { Gradient, Word, WordRendererData } from '@isoterik/react-word-cloud';
import styles from './classroom-word-cloud.module.css';

export const CLOUD_FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
export const horizontalCloudWord = () => 0;

const colors = [
  [45, 'var(--primary)', '#7c3aed'],
  [-45, '#db2777', '#ea580c'],
  [135, '#059669', '#10b981'],
  [90, '#7c3aed', '#c084fc'],
  [0, '#934e4e', '#fbbf24'],
  [-90, '#0891b2', '#2dd4bf'],
] as const;

export function useClassroomCloudColors() {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return useMemo(() => {
    const gradients: Gradient[] = colors.map(([angle, start, end], index) => ({
      id: `cloud-${id}-${index}`,
      type: 'linear',
      angle,
      stops: [{ offset: '0%', color: start }, { offset: '100%', color: end }],
    }));
    return {
      gradients,
      fill: (_word: Word, index: number) => `url(#${gradients[index % gradients.length].id})`,
    };
  }, [id]);
}

export function ClassroomCloudWord({ data, ref, selected, onSelect, countLabel }: {
  data: WordRendererData;
  ref?: Ref<SVGTextElement>;
  selected?: boolean;
  onSelect?: (word: string | null) => void;
  countLabel?: string;
}) {
  return (
    <g transform={`translate(${data.x}, ${data.y}) rotate(${data.rotate})`}>
      <g className={styles.appear} style={{ '--word-delay': `${data.index * 45}ms` } as CSSProperties}>
        <text
          ref={ref}
          className={styles.word}
          textAnchor="middle"
          fontFamily={data.font}
          fontSize={data.size}
          fontWeight={data.weight}
          fill={data.fill}
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          aria-pressed={selected}
          aria-label={countLabel ? `${data.text}，${countLabel}` : undefined}
          onClick={onSelect ? () => onSelect(data.text) : undefined}
          onKeyDown={onSelect ? event => {
            if (!['Enter', ' ', 'Escape'].includes(event.key)) return;
            if (event.key === 'Escape' && !selected) return;
            event.preventDefault();
            event.stopPropagation();
            onSelect(event.key === 'Escape' ? null : data.text);
          } : undefined}
        >
          {countLabel && <title>{countLabel}</title>}
          {data.text}
        </text>
      </g>
    </g>
  );
}

export function renderClassroomCloudWord(data: WordRendererData, ref?: Ref<SVGTextElement>) {
  return <ClassroomCloudWord data={data} ref={ref} />;
}
