'use client';

import { useEffect, useState } from 'react';
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PromptText } from '@/lib/worksheet-prompt-text';
import type { Bar as Count, QuestionDistribution } from './worksheet-question-stats';
import { selectionRate, combinationSlices } from './question-option-distribution-data';
import { CHART, VerdictDonut } from './question-stats-charts';
import styles from './question-type-distributions.module.css';

const COLORS = ['#5b83a5', '#85a4bd', '#abc0d0', '#c7d6e0', '#dbe5ed', '#edf1f5'];
function useChartAnimation() {
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setAnimate(!media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return animate;
}

export function BlankDistribution({ blanks, total, unit }: { blanks: Extract<QuestionDistribution, {kind:'blanks'}>['blanks']; total: number; unit: string }) {
  return <div className={styles.blocks}>{blanks.map(blank => {
    const slices = combinationSlices(blank.bars, total, '其他答案', '留空');
    return <div className={styles.blank} key={blank.label}>
      <div className={styles.heading}><strong>{blank.label}</strong><small>{blank.distinct} 种写法 · 已交 {total} {unit}</small></div>
      <div className={styles.shareTrack} aria-label={`${blank.label}答案占比`}>
        {slices.map((slice,index) => <span key={slice.label} style={{width:`${total ? slice.count / total * 100 : 0}%`,background:COLORS[index % COLORS.length]}} title={`${slice.label}：${slice.count}${unit}`} />)}
      </div>
      <ul className={styles.answers}>{slices.map((slice,index) => <li key={slice.label}><i style={{background:COLORS[index % COLORS.length]}} /><span><PromptText text={slice.label} placeholder="留空" /></span><strong>{slice.count} {unit}</strong><small>{selectionRate(slice.count,total)}%</small></li>)}</ul>
    </div>;
  })}</div>;
}

export function OrderDistribution({ positions, orders, total, unit }: { positions: Array<{index:number;hits:number}>; orders: readonly Count[]; total:number;unit:string }) {
  const animate = useChartAnimation();
  const data = positions.map(position=>({label:`第${position.index+1}位`,rate:selectionRate(position.hits,total),hits:position.hits}));
  return <div className={styles.blocks}>
    <div><div className={styles.heading}><strong>各位置命中率</strong><small>以已交 {total} {unit}为基数</small></div>
      <div className={styles.plot} role="img" aria-label={data.map(item=>`${item.label}排对${item.hits}${unit}，${item.rate}%`).join('；')}>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{top:16,right:16,bottom:4,left:0}}>
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fontSize:11,fill:CHART.muted}} />
          <YAxis domain={[0,100]} ticks={[0,50,100]} width={36} axisLine={false} tickLine={false} tick={{fontSize:10,fill:CHART.faint}} tickFormatter={value=>`${value}%`} />
          <Tooltip formatter={(value)=>[`${value}%`,'位置命中率']} />
          <Line type="linear" dataKey="rate" stroke="#648ba9" strokeWidth={2} dot={{r:5,fill:'#648ba9',stroke:'#fff',strokeWidth:2}} isAnimationActive={animate} animationDuration={600} />
        </LineChart></ResponsiveContainer>
      </div>
      <div className={styles.positions}>{data.map(item=><span key={item.label}>{item.label} <b>{item.hits}/{total}</b> {unit}</span>)}</div>
    </div>
    {orders.length>0 && <div><div className={styles.heading}><strong>常见排序路径</strong><small>前三种，不代表全部作答</small></div>
      <ol className={styles.paths}>{orders.map(order=><li key={order.label}>
        <div className={styles.pathSteps}>{order.label.split(' → ').map((step,index)=><span key={index}><small>{index+1}</small><PromptText text={step} placeholder="未填写" /></span>)}</div>
        <strong>{order.count} {unit} <small>{selectionRate(order.count,total)}%</small></strong>
      </li>)}</ol>
    </div>}
  </div>;
}

export function TextDistribution({ lengths, unit }: { lengths: readonly Count[]; unit:string }) {
  const animate = useChartAnimation();
  return <div><div className={styles.heading}><strong>文字长度分布</strong><small>字数反映作答长度，不代表答案质量</small></div>
    <div className={styles.plot} role="img" aria-label={lengths.map(item=>`${item.label}：${item.count}${unit}`).join('；')}>
      <ResponsiveContainer width="100%" height="100%"><BarChart data={lengths} margin={{top:12,right:8,bottom:4,left:0}}>
        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fontSize:10,fill:CHART.muted}} interval={0} />
        <YAxis allowDecimals={false} width={30} axisLine={false} tickLine={false} tick={{fontSize:10,fill:CHART.faint}} />
        <Tooltip formatter={value=>[`${value} ${unit}`,'作答数量']} />
        <Bar dataKey="count" fill="#789ab5" radius={[5,5,0,0]} maxBarSize={44} isAnimationActive={animate} animationDuration={600} />
      </BarChart></ResponsiveContainer>
    </div>
    <div className={styles.positions}>{lengths.map(item=><span key={item.label}>{item.label} <b>{item.count}</b> {unit}</span>)}</div>
  </div>;
}

export function InkDistribution({ drawn,total,unit }: {drawn:number;total:number;unit:string}) {
  return <div className={styles.ink}>
    <VerdictDonut size={140} centerFontSize="1.05rem" centerNoteFontSize=".65rem" centerText={`${drawn}/${total}`} centerNote="已交笔迹" unit={unit} data={[{name:'已交笔迹',value:drawn,color:'#648ba9'},{name:'尚未提交',value:Math.max(0,total-drawn),color:'#e1e8ef'}]} />
    <div><strong>{drawn} {unit}已提交作品</strong><p>其余 {Math.max(0,total-drawn)} {unit}尚未提交。</p><small>图形、数学作图和导图的内容质量，请结合实际作品与 AI 分析查看。</small></div>
  </div>;
}
