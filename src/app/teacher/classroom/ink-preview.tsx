'use client';

import { strokePath, strokeWidthPx, textBoxOf, type InkValue } from '@/lib/worksheet-ink';

/**
 * 学生笔迹的**只读**渲染（★ M4b/E1）。
 *
 * ★ 2026-09-28：从 `worksheet-drawer.tsx` **搬到这里**成独立文件 —— 原因是
 * `answer-view.tsx`（逐题型的作答呈现）也要用它，而留在抽屉里会变成
 * `drawer → answer-view → drawer` 的**循环 import**。循环 import 在 ESM 里能跑，
 * 但组件之间的循环在 Fast Refresh / 条件渲染下会出一些很难查的问题 —— 直接拆开更省事。
 * 搬的时候内容**一个字没改**。
 *
 * 🔴 **一个判据都不含**：坐标换算与线宽全部走 `src/lib/worksheet-ink.ts` 的
 * `strokePath` / `strokeWidthPx` —— 学生端的 canvas（C1）走的是同一对函数。各写一份的后果是
 * **两边画出来的形状不一样**，而两处都「看起来正常」。
 *
 * 宽高比用**值自己记的** `canvas.w/h`（裁定 2）：容器不足时按它留白，而不是把图拉变形。
 * ⚠️ 抽屉的宽度是 420px 固定（规格 §7.3），所以一幅 320×240 的图在这里是**缩小的**。
 * 「教师能不能看清学生的字」是产品判断，本批**不做**放大视图 —— 已写进 F1 的真机清单。
 */
export function InkPreview({ value }: { value: InkValue }) {
  const { w, h } = value.canvas;
  // `w`/`h` 可能是 0（手改过的值 / 读不出来的框，见 `readCanvas` 的哨兵）：那时给一个最小
  // 可渲染的框，别让 SVG 的 viewBox 变成 "0 0 0 0"（那在 Safari 上什么都不画）。
  const box = { w: w > 0 ? w : 1, h: h > 0 ? h : 1 };
  return (
    <svg
      viewBox={`0 0 ${box.w} ${box.h}`}
      width="100%"
      style={{ display: 'block', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4 }}
      role="img"
      aria-label="学生的手写作答"
    >
      {/* `key={index}` 在这里**可以**接受：这个列表是静态的（只读、不重排、不增删、
          没有输入控件），React 只需要它在同一次渲染内唯一。⚠️ 但别照抄到别处 ——
          任何可排序 / 可增删的列表上用下标当 key 会让 React 复用错元素的状态。 */}
      {value.strokes.map((stroke, index) => (
        <path
          key={index}
          // ★ 2026-09-30：第三个参数是**形状**（缺省 = 手写，老值一个字不变）。
          // ⚠️ 漏了它，图形在这一屏会被画成一条手写线 —— 而学生屏幕上是对的。
          d={strokePath(stroke.points, box, stroke.shape)}
          fill="none"
          stroke={stroke.color}
          strokeWidth={strokeWidthPx(stroke, box)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {/* ★ 2026-09-30 第二轮：**文字**。⚠️ 与笔迹同一份估算框（`textBoxOf`）——
          学生画布用同一个函数 ⇒ 两边画在同一处，不可能分叉。
          ⚠️ `dominantBaseline="hanging"`：SVG 的 `y` 默认是**基线**，而我们的框是**左上角**；
          不对齐的话文字会整体上浮一个字高（屏幕上只是「位置有点怪」）。 */}
      {(value.texts ?? []).map((text, index) => {
        const [x, y, , h] = textBoxOf(text, box);
        return (
          <text
            key={`t${index}`}
            x={x}
            y={y}
            fontSize={h / 1.3}
            fill={text.color}
            dominantBaseline="hanging"
            style={{ fontFamily: 'inherit' }}
          >
            {text.text}
          </text>
        );
      })}
    </svg>
  );
}
