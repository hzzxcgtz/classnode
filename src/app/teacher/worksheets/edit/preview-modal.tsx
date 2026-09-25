'use client';

import { studentVisibleGroups } from '@/lib/worksheet-questions';
import type { WorksheetContent } from '@/lib/types';
// 🔴 **学生端那个组件本体**，不是一份模仿。理由见下面的文件头 —— 这个 import 是本文件
// 唯一一处「教师端引学生端」的地方，而它引的是**唯一的作答态渲染**：
// 两个模块各自的路径在这里交汇，分叉在结构上不可能。
import { WorksheetQuestionList } from '@/app/classroom/worksheet/worksheet-panel';

/**
 * 学生端的宽度（规格 §6.3：「按 iPad 宽度渲染的弹窗 —— 价值正在于教师看到的就是
 * 学生看到的那个宽度」）。第一代 iPad 竖屏的 CSS 宽度就是这个数。
 */
const STUDENT_STAGE_WIDTH = 768;

/**
 * 预览弹窗。
 *
 * ── 它渲染的是**真的那个组件**（P1 / D2 起）────────────────────────────────
 *
 * 在本文件的前一版里，这里是一份**手写的只读模仿**：同一份 `content` 被两段各自演化的
 * JSX 画出来。当时那么写是成立的（学生端面板还没落地，没有第二份实现可以跟它分叉），
 * 但那句话在 D2 落地的那一刻就失效了 —— 而**教师是拿这个弹窗当验收依据的**
 * （规格 §6.3 的原话是「教师看到的就是学生看到的宽度」），于是「预览里长这样、
 * 学生那里不是」会成为一种没有任何报错的失真。这是本项目最忌讳的那种缺陷：
 * 两份真源，谁都不知道它们什么时候分了岔。
 *
 * 现在这里渲染的是 `WorksheetQuestionList`（`src/app/classroom/worksheet/worksheet-panel.tsx`
 * 导出的**同一个**组件）—— 学生的作答面板用的也是它。因此：
 *   · 题面怎么排、选项怎么标号（A/B/C…）、空题干怎么显示、未知题型怎么办，
 *     全部只有一份实现；
 *   · 样式也共用同一份 CSS module，教师看到的是**像素级**的那一份，不是「大致像」。
 *
 * ── 两条刻意的取舍 ────────────────────────────────────────────────────────
 *   1. **内层舞台是写死的 768px**，不是百分比 —— 一旦跟着窗口缩放，它就退化成
 *      「一个窄一点的预览」，那句「教师看到的就是学生看到的宽度」也就不成立了。
 *      教师的窗口比 768 窄时**横向滚动**，而不是把舞台压窄。
 *   2. **只读**（`interactive={false}`）：没有「提交本题」、控件全部 `disabled`、
 *      不显示任何作答状态。这里**不接真实作答**（规格 §6.3），也**不显示正确答案** ——
 *      那会让教师误以为学生也看得到。
 *
 * ⚠️ 顶栏（标题 / 进度 / 保存状态 / 奖励累计）**不**在这个共享组件里：它读的是
 * 学生的会话状态（保存中、离线条数、奖励累计），教师端没有对应物。所以这里只画一个
 * 标题条 + 题目列 —— 与学生在面板里看到的上半部分一致，而不是假装连状态都一样。
 *
 * 🔴 **奖励一处都不许在这里出现**（规格 §3-U：教师在那些地方问的是「哪道题错得多」，
 * 星星不提供信息）。它不会出现有**两道**保证，都是结构性的、不是一句约定：
 *   · 下面这个 `WorksheetQuestionList` **不传** `reward` / `scores` —— 共享组件里那两处
 *     奖励的渲染都以「传了配置」为前提（`reward?: …`，不传就没有东西可画）；
 *   · 而且它是以 `interactive={false}` 渲染的，共享组件里那道 `interactive && reward`
 *     的闸门即使将来有人补传了配置也仍然关着。
 * 看板 / 抽屉 / 按题看则根本不经过这个组件。
 */
export function WorksheetPreviewModal({ title, content, onClose }: {
  title: string;
  content: WorksheetContent;
  onClose: () => void;
}) {
  // 与面板同一条口径：拍平在调用方做（`flattenAnswerable`），所以「屏幕上有几道题」
  // 在预览与学生端是同一个数。
  // ⚠️ 不取 `flattenQuestions`：任务不是一道题（它没有作答控件），把它算进「共 N 题」
  // 会让这个数比屏幕上的卡片多几张 —— 而预览正是教师验收学生端的地方。
  const groups = studentVisibleGroups(content.nodes);
  // 「共 N 题」数的是**可作答的题**（与屏幕上画的张数同一个数）。
  const questionCount = groups.reduce((sum, group) => sum + group.items.length, 0);

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
             按 iPad 宽度 {STUDENT_STAGE_WIDTH}px 渲染，共 {questionCount} 题。这里渲染的就是学生端作答面板的同一份组件与样式，只读、不含正确答案。
            </p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>关闭</button>
        </header>

        <div className="worksheet-editor-preview-scroll">
          <div className="worksheet-editor-preview-stage" style={{ width: STUDENT_STAGE_WIDTH }}>
            <div className="worksheet-editor-preview-title">{title || '未命名学习单'}</div>
            <WorksheetQuestionList
              groups={groups}
              // 预览没有作答态可言：空输入态、空状态、空提交中。**不传** `onChange` /
              // `onSubmit`，配合 `interactive={false}` ⇒ 一行都不会被写出去。
              drafts={{}}
              statuses={{}}
              submitting={{}}
              interactive={false}
              // 只读态没有「已提交」可言（`statuses` 是空的），这个开关在预览里不生效；
              // 传 `true` 只是不给读的人留一个「这里为什么是 false」的问题。
              allowResubmit
              // ★ M5a：锁定是**课堂级**的运行时状态，教师端的「学生端预览」没有课堂可言
              // ⇒ 恒 `false`。显式写出来（而不是靠默认值）是刻意的，见那个字段的注释。
              answersLocked={false}
            />
          </div>
        </div>
      </div>
    </>
  );
}
