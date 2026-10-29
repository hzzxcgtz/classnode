/** Clipboard API requires HTTPS; classroom LAN HTTP still needs a copy fallback. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const input = document.createElement('textarea');
    input.value = text;
    input.readOnly = true;
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(input);
    try {
      input.select();
      input.setSelectionRange(0, text.length);
      if (!document.execCommand('copy')) throw new Error('Copy unavailable');
    } finally {
      input.remove();
      previous?.focus({ preventScroll: true });
    }
  }
}
