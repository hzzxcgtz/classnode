'use client';

import { studentVisibleGroups } from '@/lib/worksheet-questions';
import { useState, type CSSProperties } from 'react';
import type { WorksheetContent, WorksheetSettings } from '@/lib/types';
import { resolveWorksheetBackgroundSources } from '@/lib/worksheet-backgrounds';
import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import { surfaceAlphas } from '@/lib/worksheet-surface';
// 🔴 **学生端那个组件本体**，不是一份模仿。理由见下面的文件头 —— 这个 import 是本文件
// 唯一一处「教师端引学生端」的地方，而它引的是**唯一的作答态渲染**：
// 两个模块各自的路径在这里交汇，分叉在结构上不可能。
import { WorksheetQuestionList } from '@/app/classroom/worksheet/worksheet-panel';

/**
 * 学生端的宽度（规格 §6.3：「按 iPad 宽度渲染的弹窗 —— 价值正在于教师看到的就是
 * 学生看到的那个宽度」）。第一代 iPad 竖屏的 CSS 宽度就是这个数。
 */
const STUDENT_STAGE_WIDTH = 768;
const STUDENT_LANDSCAPE_WIDTH = 1024;
type PreviewOrientation = 'portrait' | 'landscape';

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
export function WorksheetPreviewModal({ title, content, settings, onClose }: {
  title: string;
  content: WorksheetContent;
  settings: WorksheetSettings;
  onClose: () => void;
}) {
  const [orientation, setOrientation] = useState<PreviewOrientation>('portrait');
  // 与面板同一条口径：拍平在调用方做（`flattenAnswerable`），所以「屏幕上有几道题」
  // 在预览与学生端是同一个数。
  // ⚠️ 不取 `flattenQuestions`：任务不是一道题（它没有作答控件），把它算进「共 N 题」
  // 会让这个数比屏幕上的卡片多几张 —— 而预览正是教师验收学生端的地方。
  const groups = studentVisibleGroups(content.nodes);
  // 「共 N 题」数的是**可作答的题**（与屏幕上画的张数同一个数）。
  const questionCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const backgrounds = resolveWorksheetBackgroundSources(
    settings.backgroundTheme,
    settings.backgroundImageUrl,
    settings.backgroundPortraitImageUrl,
  );
  const hasBackground = Boolean(backgrounds.landscape || backgrounds.portrait);
  const landscapeBackground = backgrounds.landscape ?? backgrounds.portrait;
  // ★ 2026-09-27：**卡片透度也要跟着来** —— 预览是教师验收学生端的地方
  //（规格 §6.3「教师看到的就是学生看到的」）。这里不设的话，那三个 CSS 变量会落到
  // CSS 里的兜底值（= 不透明），于是教师把透度调到「极透」、预览里却看不出任何变化。
  // ⚠️ 数值同样只有一份来源（`surfaceAlphas`），别在这里写字面量。
  const alphas = surfaceAlphas(settings.surfaceOpacity);
  const stageStyle = {
    width: orientation === 'portrait' ? STUDENT_STAGE_WIDTH : STUDENT_LANDSCAPE_WIDTH,
    /*
      ★ 2026-10-05（教师）：「垂直滚动条只需要保留一个。」
      🔴 这里原来是写死的 `height`（竖屏 1024 / 横屏 768）+ 舞台自己 `overflow-y: auto`
         ⇒ 弹窗里两条垂直滚动条（舞台一条、外面 `.worksheet-editor-preview-scroll` 一条）。
      ⇒ 改成 `minHeight`：**设备视口高度是下限**（短卷仍画出一个完整的设备框），
         内容更高时舞台跟着长高，滚动只由弹窗那一个容器负责。
      ⚠️ 宽度仍然是写死的设备宽度 —— 那一条才是「教师看到的就是学生看到的宽度」所依赖的，
         一个字都没动（见文件头那两条刻意的取舍）。
    */
    minHeight: orientation === 'portrait' ? STUDENT_LANDSCAPE_WIDTH : STUDENT_STAGE_WIDTH,
    '--ws-card-alpha': String(alphas.card),
    '--ws-card-active-alpha': String(alphas.cardActive),
    '--ws-surface-alpha': String(alphas.container),
    ...(landscapeBackground
      ? { '--worksheet-background-landscape': `url(${worksheetAssetUrl(landscapeBackground)})` }
      : {}),
    ...(backgrounds.portrait
      ? { '--worksheet-background-portrait': `url(${worksheetAssetUrl(backgrounds.portrait)})` }
      : {}),
  } as CSSProperties;

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div
        className="worksheet-editor-preview-modal teacher-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="worksheet-preview-title"
      >
        <header className="worksheet-editor-preview-head">
          <div>
            <h3 id="worksheet-preview-title">学生端预览</h3>
            <p>
             按 iPad {orientation === 'portrait' ? '竖屏' : '横屏'}尺寸渲染，共 {questionCount} 题。这里渲染的就是学生端作答面板的同一份组件与样式，只读、不含正确答案。
            </p>
          </div>
          <div className="worksheet-editor-preview-orientation" role="group" aria-label="预览方向">
            <button type="button" className={orientation === 'portrait' ? 'is-selected' : ''} onClick={() => setOrientation('portrait')}>竖屏</button>
            <button type="button" className={orientation === 'landscape' ? 'is-selected' : ''} onClick={() => setOrientation('landscape')}>横屏</button>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>关闭</button>
        </header>

        <div className="worksheet-editor-preview-scroll">
          <div
            className="worksheet-editor-preview-stage"
            style={stageStyle}
            data-has-background={hasBackground ? '1' : '0'}
            data-has-portrait={backgrounds.portrait ? '1' : '0'}
            data-preview-orientation={orientation}
          >
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
