'use client';

import type { ReactNode } from 'react';

/**
 * 「正确答案」那块提示 —— **填空与选择 / 判断共用这一份**。
 *
 * ★ 2026-09-27：这段盒子原来**只**在 `choice-blank-answer.tsx` 里（教师那轮的原话是
 * 「答错的用其它颜色表示，可以在原文字上加删除线，并在后面写上正确答案」）。
 * 这一轮教师要求「选择和判断学生错误后**也要与填空一样**给出叉叉符号并给出正确答案」
 * ⇒ 两个调用点了。⚠️ 盒子的样式在那两个文件里各写一遍的话，改一次只会改一处 ——
 * 而学生看到的是「填空那张红框和选择那张红框长得不一样」，**没有任何报错**。
 *
 * 🔴 **句子由调用方给**（`children`），这里只管那块盒子：填空说的是「第 2 空填『氧气』」，
 *    选择说的是「B」—— 两者的措辞不一样，而盒子必须一模一样。
 *
 * ⚠️ **用内联样式，不走 `worksheet.module.css`**：这是原来那一版的做法（那轮的理由是
 *    「改动面越小越好」），这次沿用 —— 顺带它也不受 CSS 模块类名网约束，没有可漂移的类名。
 * ⚠️ `role="status"`：它是**提交之后才出现**的一段反馈，读屏该把它念出来
 *    （选择题那边与 `worksheet-panel.tsx` 里那块 `questionFeedback` 同一个角色）。
 * ⚠️ **颜色不是唯一的信息载体**（本仓的既有纪律）：开头那个「正确答案」四个字就是，
 *    所以色盲 / 灰度屏学生不会只看到一片红底。
 */
export function CorrectAnswerNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      style={{
        marginTop: 10,
        padding: '10px 14px',
        borderRadius: 10,
        background: '#fef2f2',
        border: '1px solid #fecaca',
        fontSize: '0.813rem',
        lineHeight: 1.7,
      }}
    >
      <strong style={{ color: '#b91c1c', marginRight: 8 }}>正确答案</strong>
      <span style={{ color: '#7f1d1d' }}>{children}</span>
    </div>
  );
}
