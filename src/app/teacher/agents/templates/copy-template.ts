/** Clipboard fallback also supports teachers visiting over plain LAN HTTP. */
export async function copyTemplate(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* Try legacy copy. */ }
  }
  const focus = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    if (!document.execCommand('copy')) throw new Error('复制失败，请切换到“原文”后手动复制。');
  } finally {
    textarea.remove();
    if (focus instanceof HTMLElement) focus.focus();
  }
}
