'use client';

import { useState } from 'react';
import { MathSpan } from '@/lib/worksheet-math-view';

/**
 * 「插入公式」的小弹窗（★ 2026-09-30，教师裁定 ①）。
 *
 * 🔴 **下面那排模板按钮不是装饰**：小学初中的老师不一定记得住 `\frac` / `\sqrt`，
 *    而这些恰恰是最常用的几个。没有模板，这个功能对多数教师等于不存在。
 *
 * ⚠️ 语法错**不拦着不让插**：教师可能就是想先插个占位、回头再改。
 *    实时预览里 KaTeX 自己会画出红色的错误标记，他当场看得见。
 *
 * ⚠️ 类名一律 `worksheet-editor-` 前缀（而不是 `worksheet-math-dialog-`）：本页有一条网
 *    （`editor-classes.test.ts`）守「编辑页用到的每一个 `worksheet-editor-*` 类都必须在
 *    `globals.css` 里有定义」—— 换个前缀就等于把这一族类挪出网外，而症状是
 *    **屏幕上只是「长得不对」，构建与 tsc 全都不报错**。
 */
const TEMPLATES: { tex: string; title: string }[] = [
  { tex: 'x^2', title: '上标' },
  { tex: 'x_1', title: '下标' },
  { tex: '\\frac{a}{b}', title: '分数' },
  { tex: '\\sqrt{x}', title: '根号' },
  { tex: '\\times', title: '乘号' },
  { tex: '\\div', title: '除号' },
  { tex: '\\ne', title: '不等于' },
  { tex: '\\le', title: '小于等于' },
  { tex: '\\ge', title: '大于等于' },
  { tex: '\\pi', title: '圆周率' },
  { tex: '\\angle', title: '角' },
  { tex: '^\\circ', title: '度' },
];

export function MathInsertDialog({ onInsert, onCancel }: {
  onInsert: (tex: string) => void;
  onCancel: () => void;
}) {
  const [tex, setTex] = useState('');
  return (
    <div className="worksheet-editor-math-dialog" role="dialog" aria-label="插入公式">
      <textarea
        className="worksheet-editor-math-dialog-input"
        value={tex}
        autoFocus
        placeholder="输入 LaTeX，例如 x^2 + \frac{1}{2}"
        onChange={(event) => setTex(event.target.value)}
      />
      {/* 实时预览：打错了当场看见（KaTeX 自己画红色错误标记） */}
      <div className="worksheet-editor-math-dialog-preview">
        {tex.trim()
          ? <MathSpan tex={tex} />
          : <span className="worksheet-editor-math-dialog-hint">上面输入公式，这里看效果</span>}
      </div>
      <div className="worksheet-editor-math-dialog-templates">
        {TEMPLATES.map((item) => (
          <button
            key={item.tex}
            type="button"
            title={item.title}
            // ⚠️ 用 `onMouseDown` + `preventDefault`：与工具栏那几个按钮同一条理由
            //（点按钮会把焦点从 textarea 拿走），见 `prompt-editor.tsx` 的 `pendingRangeRef`。
            onMouseDown={(event) => { event.preventDefault(); setTex((prev) => `${prev}${item.tex}`); }}
          >
            <MathSpan tex={item.tex} />
          </button>
        ))}
      </div>
      <div className="worksheet-editor-math-dialog-actions">
        {/* ⚠️ 取消按钮用 `onMouseDown` + `preventDefault` 与模板按钮同一条理由 ——
            这条弹窗是从题干工具栏打开的，任何一次意外的焦点转移都可能让
            `pendingRangeRef` 里记的选区失效。 */}
        <button type="button" onMouseDown={(event) => { event.preventDefault(); onCancel(); }}>取消</button>
        <button
          type="button"
          className="is-primary"
          disabled={!tex.trim()}
          onMouseDown={(event) => { event.preventDefault(); onInsert(tex.trim()); }}
        >
          插入
        </button>
      </div>
    </div>
  );
}
