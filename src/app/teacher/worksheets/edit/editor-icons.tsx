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
