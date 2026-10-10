'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { Bar } from './worksheet-question-stats';
import { combinationSlices, selectionRate } from './question-option-distribution-data';
import styles from './question-option-distribution.module.css';

const COLORS = ['#547a9e', '#8ca7bf', '#bccbd9', '#e2e8ef'];

export function OptionDistribution({ bars, combos, total, unit }: {
  bars: readonly Bar[]; combos: readonly Bar[]; total: number; unit: string;
}) {
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setAnimate(!media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const slices = combinationSlices(combos, total);
  return <div className={styles.distribution}>
    <div className={styles.caption}>选项选择率 <span>以已交 {total} {unit}为基数{combos.length > 0 ? '，多选题各项独立统计' : ''}</span></div>
    <div className={styles.options}>
      {bars.map(bar => {
        const rate = selectionRate(bar.count, total);
        const split = bar.label.indexOf('. ');
        return <div key={bar.label} className={styles.option} data-correct={bar.correct || undefined}>
          <div className={styles.optionHeading}><b>{split > 0 ? bar.label.slice(0, split) : bar.label}</b>{bar.correct && <small>正确选项</small>}</div>
          <div className={styles.optionText}>{split > 0 ? bar.label.slice(split + 2) : bar.label}</div>
          <div className={styles.optionMetric}>
            <div className={styles.rateRing} style={{ '--rate': `${rate * 3.6}deg` } as CSSProperties} aria-hidden="true"><b>{rate}%</b></div>
            <span><strong>{bar.count}</strong> {unit}选择</span>
          </div>
        </div>;
      })}
    </div>
    {slices.length > 0 && <div className={styles.combinations}>
      <div className={styles.caption}>作答组合 <span>展示前三种，其余合并为“其他组合”</span></div>
      <div className={styles.combinationBody}>
        <div className={styles.chart} role="img" aria-label={`作答组合分布：${slices.map(item => `${item.label} ${item.count}${unit}`).join('，')}`}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices} dataKey="count" nameKey="label" innerRadius="58%" outerRadius="87%" paddingAngle={slices.length > 1 ? 3 : 0} stroke="none" isAnimationActive={animate} animationDuration={600}>
                {slices.map((slice, index) => <Cell key={slice.label} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(value) => [`${value ?? 0} ${unit}`, '人数']} contentStyle={{ borderRadius: 8, fontSize: '.75rem', borderColor: '#dce5ed' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className={styles.chartCenter}><strong>{total}</strong><small>已交{unit}数</small></div>
        </div>
        <ul className={styles.legend}>
          {slices.map((slice, index) => <li key={slice.label}>
            <i style={{ background: COLORS[index % COLORS.length] }} aria-hidden="true" />
            <span>{slice.label}</span><strong>{slice.count} <small>{unit}</small></strong><em>{total > 0 ? Number((slice.count / total * 100).toFixed(1)) : 0}%</em>
          </li>)}
        </ul>
      </div>
    </div>}
  </div>;
}
