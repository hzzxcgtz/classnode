'use client';

import {
  Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Bar as BarModel } from './worksheet-question-stats';

/**
 * 「按题统计」的图表件（★ 2026-09-28，教师选定 **recharts**）。
 *
 * ── 为什么是 recharts（而不是继续手写）──────────────────────────────
 * 教师原话：「现在的图表非常不好看，类型也不够丰富……**这是在课堂上用于展示的，
 * 有很多听课老师**，要显得高大上」。⇒ 设计目标从「信息密度」改成
 * **远看有气势、近看有细节**。那一档的观感（入场动画、悬浮提示、坐标、圆角）
 * 手写要花十倍力气还未必对，而 recharts **已经在依赖里**（教师仪表盘在用）。
 *
 * ── 🔴 五条为「课堂展示」定的规矩 ──────────────────────────────────
 *   ① **字号整体上一档**（轴标签 0.75rem、数值 1rem）—— 投影和后排要看得见；
 *   ② **动画只留入场那一次**（`isAnimationActive` 默认开），不给每次重绘都加动效
 *      —— 一块屏幕上七八张图同时在动会晕，而展示时要显得**稳**；
 *   ③ **减法**：去掉坐标轴线、去掉竖网格、去掉图例框 —— 仪表盘之所以显专业靠的就是这个；
 *   ④ **Tooltip 做大**（圆角 10、带阴影、字 0.813rem）—— 它是「专业感」最直接的来源；
 *   ⑤ **颜色只承担语义**（对/部分/错/未判/未答），不承担装饰；同屏不超过 5 个色相。
 *
 * ⚠️ **热力矩阵不在这里**（连线左×右、归类条目×框仍是手写的）：
 * 热力图不是 recharts 的强项，硬用 `ScatterChart` 或者堆 100 个 `Bar` 会更丑。
 * 这一处按「用对工具」判，而不是按「统一用某一个库」判。
 */

/** 主题：颜色与字号**只有这一份**（各图各写一套的表现是同一屏里两个蓝）。 */
export const CHART = {
  /** 语义色 —— 与整个看板同源（`worksheet-tile-state.ts` / 抽屉那几处用的是同一组）。 */
  correct: '#15803d',
  partial: '#b45309',
  wrong: '#934e4e',
  noVerdict: '#527198',
  unanswered: '#cbd5e1',
  /** 中性：数据条的默认色（要**比语义色安静**，否则一屏全是重点）。 */
  neutral: '#3b82f6',
  muted: '#64748b',
  faint: '#94a3b8',
  ink: '#0f172a',
  /** 展示用：轴标签比正文大一点（投影后排要看得见）。 */
  axisFont: 12,
  valueFont: 14,
} as const;

/** Tooltip 的统一长相（三条：够大、圆角、有阴影）。 */
const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: '1px solid #e2e8f0',
  boxShadow: '0 6px 20px rgba(15,23,42,0.12)',
  fontSize: '0.813rem',
  padding: '8px 12px',
  background: 'white',
} as const;

/**
 * 横向条形图（选项分布 / 每空的答案 / 排序的逐位命中 / 问答的字数分布）。
 *
 * 🔴 **`layout="vertical"`**：横向条在中文标签下比纵向柱好读得多（中文不长于横排），
 * 而标签放左边不用旋转 —— 展示时没有人会去歪头看轴。
 */
export function CountBars({
  bars, unit, height, colorFor, dense = false,
}: {
  bars: ReadonlyArray<BarModel>;
  /** 量词（「人」/「组」）—— 出现在 tooltip 里。 */
  unit: string;
  /** 图高。条数多时由调用方给大一点（每条约 34px）。 */
  height?: number;
  /**
   * 这一根用什么颜色。缺省：中性蓝；正确答案建议传 `CHART.correct`。
   * ⚠️ 参数只要 `{ correct }` 这一点形状（不是整个 `Bar`）—— 这样调用方传
   * `{ label, count, correct }` 或别的形状都行，**不必去凑一个完整模型**。
   */
  colorFor?: (bar: { correct?: boolean }) => string;
  /** 紧凑档（每空的小图）：轴标签更短、条更细。 */
  dense?: boolean;
}) {
  const data = bars.map((bar) => ({ name: bar.label, count: bar.count, correct: bar.correct }));
  const fallback = (bar: { correct?: boolean }) => (bar.correct ? CHART.correct : CHART.neutral);
  return (
    <div style={{ width: '100%', height: height ?? Math.max(72, data.length * (dense ? 30 : 36)) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }} barCategoryGap={dense ? 4 : 6}>
          {/* 减法：数值轴整条藏掉（不画刻度、不画线）—— 条长本身已经表达了数值。 */}
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis
            type="category" dataKey="name" width={dense ? 76 : 132}
            tick={{ fontSize: CHART.axisFont, fill: CHART.muted }}
            axisLine={false} tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(15,23,42,0.04)' }}
            contentStyle={TOOLTIP_STYLE}
            // ⚠️ 不给 `value` 标注 `number`：recharts v3 的 `Formatter` 收的是
            // `ValueType | undefined`（比我写的宽），标窄了 TS 直接红。
            formatter={(value) => [`${value ?? 0} ${unit}`, '']}
            separator=""
          />
          <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={dense ? 12 : 18} isAnimationActive>
            {data.map((bar, index) => (
              <Cell key={index} fill={colorFor ? colorFor(bar) : fallback(bar)} />
            ))}
            {/* 🔴 数值写在条的**右端**（`position="right"`）：它才是主角，
                而 tooltip 要悬浮才看得见 —— 展示时不能指望有人去悬浮。 */}
            <LabelList dataKey="count" position="right" style={{ fontSize: CHART.valueFont, fontWeight: 700, fill: CHART.ink }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * 结论环（页头）。中心写正确率大字 —— 与堆叠条**并列**：条适合扫，环适合一眼抓住比例。
 *
 * ⚠️ 中心那块是**绝对定位的 DOM**（不是 recharts 的 label）：仪表盘那个健康度环就是这么做的，
 * 而 recharts 的 label 在圆里居中要调一堆参数、还不跟着字号走。
 */
export function VerdictDonut({
  data, centerText, centerNote, size = 148, unit: unitFallback = '',
}: {
  data: Array<{ name: string; value: number; color: string }>;
  /** 环中心那一行大字（正确率 / 已交率）。`null` ⇒ 画「—」。 */
  centerText: string | null;
  centerNote: string;
  size?: number;
  /** tooltip 里的量词（环里的数字是「人 / 组」）。 */
  unit?: string;
}) {
  const shown = data.filter((item) => item.value > 0);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <ResponsiveContainer width={size} height={size}>
        <PieChart>
          <Pie
            data={shown.length > 0 ? shown : [{ name: '暂无', value: 1, color: '#eef2f6' }]}
            dataKey="value" nameKey="name"
            innerRadius="62%" outerRadius="92%"
            paddingAngle={shown.length > 1 ? 2 : 0}
            stroke="none" isAnimationActive
          >
            {(shown.length > 0 ? shown : [{ color: '#eef2f6' }]).map((item, index) => (
              <Cell key={index} fill={item.color} />
            ))}
          </Pie>
          {shown.length > 0 && (
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [`${value ?? 0} ${unitFallback}`, String(name ?? '')]} />
          )}
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        {/* 展示用：中心那个数是**这一屏最大的字**（1.5rem）—— 一眼就是它。 */}
        <div style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.1, color: centerText ? CHART.ink : CHART.faint }}>
          {centerText ?? '—'}
        </div>
        <div style={{ fontSize: '0.688rem', color: CHART.faint, marginTop: 2 }}>{centerNote}</div>
      </div>
    </div>
  );
}

/**
 * 矩阵热力的**图例**（手写矩阵那边配它用）。
 * 🔴 热力图**必须**有图例：没有它，深浅只是一片蓝，「3 人」与「30 人」在屏幕上一样。
 */
export function HeatLegend({ max, unit }: { max: number; unit: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.688rem', color: CHART.faint }}>
      <span>少</span>
      {[0.1, 0.28, 0.46, 0.64].map((alpha) => (
        <span key={alpha} style={{ width: 14, height: 14, borderRadius: 4, background: `rgba(82, 113, 152, ${alpha})` }} />
      ))}
      <span>多</span>
      <span style={{ marginLeft: 4 }}>（最多 {max} {unit}）</span>
    </div>
  );
}
