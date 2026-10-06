import type { ReactNode } from 'react';

/**
 * 编辑页的图标。**只放被两处以上用到的那几个** —— 单个地方自用的图标留在原地。
 *
 * ★ 2026-10-05（教师）：「删除统一用『垃圾桶』图标」+「注意，那个删除图标在其它题型里也有，
 * 要统一」。当时的真实状况正是**每个题型各写各的**：题目卡早就画了一个垃圾桶 SVG
 * （内联在 `question-card.tsx` 里），而任务卡、选项行、连线、归类、排序一律是一个 `×` 字
 * —— 于是同一页上「删除」长成了两种东西。
 *
 * 🔴 所以本组件是**搬迁**不是新画：几何逐字照抄题目卡里那一个（教师认可的正是它），
 *    再把题目卡改成用它。两处各画一个「垃圾桶」迟早会长得不一样，而那种差别在屏幕上
 *    只是「好像有点不齐」，没有人会专门来报。
 *
 * ⚠️ 定位规矩：**删除**用垃圾桶；**关闭**（对话框、设置浮层）仍然用 `✕` ——
 *    `math-insert-dialog.tsx` 与 `page.tsx` 里那两个是关闭，不在「统一」范围内。
 *    把关闭也画成垃圾桶，教师下次就会以为点它是删东西。
 */
export function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      /* 按钮自己有 `aria-label`（「删除选项 A」这种），图标不该被读屏再念一遍。 */
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
    </svg>
  );
}

export type EditorIconKind =
  | 'content'
  | 'prompt'
  | 'answer'
  | 'grading'
  | 'points'
  | 'keyboard'
  | 'handwriting'
  | 'photo'
  | 'tool'
  | 'background'
  | 'starter'
  | 'student'
  | 'correct';

/**
 * 编辑器里的结构图标。它们只出现在区块标题和模式选项中，用来帮助扫读，
 * 不作为装饰，也不单独承担文字含义。
 */
export function EditorIcon({ kind, size = 16 }: { kind: EditorIconKind; size?: number }) {
  const paths: Record<EditorIconKind, ReactNode> = {
    content: <><path d="M6 3.5h9l3 3V20.5H6z" /><path d="M15 3.5v4h4" /><path d="M9 12h6M9 16h6" /></>,
    prompt: <><path d="M4 18.5l1-4L15.5 4a2.1 2.1 0 0 1 3 3L8 17.5z" /><path d="M13.5 6l3 3" /></>,
    answer: <><path d="M4.5 12.5l4 4L19.5 5.5" /><path d="M12 20h8" /></>,
    grading: <><path d="M12 3.5l7 3v5c0 4.3-2.7 7.3-7 9-4.3-1.7-7-4.7-7-9v-5z" /><path d="M8.5 12l2.2 2.2 4.8-5" /></>,
    points: <><path d="M12 3.5l2.5 5.1 5.6.8-4 3.9.9 5.5-5-2.6-5 2.6.9-5.5-4-3.9 5.6-.8z" /></>,
    keyboard: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M6 10h1m3 0h1m3 0h1m3 0h1M7 14h10" /></>,
    handwriting: <><path d="M4 19l4-1 10-10a2.1 2.1 0 0 0-3-3L5 15z" /><path d="M13.5 6.5l3 3" /></>,
    photo: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M8 5l1-2h6l1 2" /></>,
    tool: <><path d="M14.5 5.5a4 4 0 0 0 4.8 5.8L12 18.6a2.2 2.2 0 0 1-3.1-3.1l7.3-7.3a4 4 0 0 0-1.7-2.7z" /></>,
    background: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="M4 17l5-5 3 3 2-2 6 5" /></>,
    starter: <><path d="M5 4v16M5 7h8a4 4 0 0 1 0 8H5" /><path d="M10 11h5" /></>,
    student: <><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6" /></>,
    correct: <><circle cx="12" cy="12" r="9" /><path d="M7.5 12l3 3 6-6" /></>,
  };

  return (
    <svg
      className="worksheet-editor-heading-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[kind]}
    </svg>
  );
}
