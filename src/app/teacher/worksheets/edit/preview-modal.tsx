'use client';

import type { WorksheetContent } from '@/lib/types';
import { QUESTION_TYPE_OPTIONS, readOptions } from './use-worksheet-editor';

/**
 * 学生端的宽度（规格 §6.3：「按 iPad 宽度渲染的弹窗 —— 价值正在于教师看到的就是
 * 学生看到的那个宽度」）。第一代 iPad 竖屏的 CSS 宽度就是这个数。
 */
const STUDENT_STAGE_WIDTH = 768;

/**
 * 预览弹窗。
 *
 * 两条刻意的取舍：
 *   1. **内层舞台是写死的 768px**，不是百分比 —— 一旦跟着窗口缩放，它就退化成
 *      「一个窄一点的预览」，那句「教师看到的就是学生看到的宽度」也就不成立了。
 *      教师的窗口比 768 窄时**横向滚动**，而不是把舞台压窄。
 *   2. 渲染的是**学生看到的题面**：没有正确答案、没有判分、控件全部只读
 *      （规格 §6.3 的「作答态」，第一批不接真实作答）。所以这里不显示
 *      `correctKeys` / `answers` —— 那会让教师误以为学生也看得到。
 */
export function WorksheetPreviewModal({ title, content, onClose }: {
  title: string;
  content: WorksheetContent;
  onClose: () => void;
}) {
  const questions = content.nodes;

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div
        className="worksheet-editor-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="worksheet-preview-title"
      >
        <header className="worksheet-editor-preview-head">
          <div>
            <h3 id="worksheet-preview-title">学生端预览</h3>
            <p>
             按 iPad 宽度 {STUDENT_STAGE_WIDTH}px 渲染，共 {questions.length} 题。这里只显示学生会看到的题目与作答控件，不含正确答案。
            </p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>关闭</button>
        </header>

        <div className="worksheet-editor-preview-scroll">
          <div className="worksheet-editor-preview-stage" style={{ width: STUDENT_STAGE_WIDTH }}>
            <div className="worksheet-editor-preview-title">{title || '未命名学习单'}</div>
            <div className="worksheet-editor-preview-progress">已作答 0 / {questions.length}</div>

            {questions.length === 0 ? (
              <p className="worksheet-editor-preview-empty">这份学习单还没有题目。</p>
            ) : questions.map((node, index) => (
              <div className="worksheet-editor-preview-question" key={node.id}>
                <div className="worksheet-editor-preview-question-head">
                  <span>第 {index + 1} 题</span>
                  <span className="worksheet-editor-preview-question-type">
                    {QUESTION_TYPE_OPTIONS.find(option => option.value === node.type)?.label ?? node.type}
                  </span>
                </div>
                <div className="worksheet-editor-preview-prompt">
                  {node.prompt.trim() ? node.prompt : <span className="worksheet-editor-preview-placeholder">（这道题的题干还没写）</span>}
                </div>

                {node.type === 'single-choice' && (
                  <div className="worksheet-editor-preview-options">
                    {readOptions(node).map(option => (
                      <label className="worksheet-editor-preview-option" key={option.key}>
                        <input type="radio" name={`preview-${node.id}`} disabled />
                        <span className="worksheet-editor-preview-option-key">{option.key}</span>
                        <span>{option.text.trim() || <span className="worksheet-editor-preview-placeholder">（选项 {option.key} 还没写）</span>}</span>
                      </label>
                    ))}
                  </div>
                )}
                {node.type === 'fill-blank' && (
                  <input className="input worksheet-editor-preview-input" disabled placeholder="在这里填写答案" />
                )}
                {node.type === 'short-answer' && (
                  <textarea className="input worksheet-editor-preview-input" rows={3} disabled placeholder="在这里作答" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
