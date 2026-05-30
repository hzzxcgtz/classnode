import { getApiBaseUrl } from './api-base';

/** Markdown 渲染（支持图片、加粗、斜体、代码、链接、列表） */
export function renderMarkdown(text: string): string {
  let html = text;

  // 1. 提取图片标记，用占位符替换（避免被后续 HTML 转义破坏）
  const images: { placeholder: string; tag: string }[] = [];

  // 1a. 先提取原始 HTML <img> 标签（Coze 等 AI 可能返回 HTML 而非 Markdown）
  html = html.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?\s*>/gi, (match) => {
    const placeholder = `%%RAWIMG_${images.length}%%`;
    // 将 <img> 标签中的相对路径也补全
    const fixed = match.replace(/src=["'](\/[^"']+)["']/gi, (m, src) => {
      return m.replace(src, `${getApiBaseUrl()}${src}`);
    });
    images.push({ placeholder, tag: fixed });
    return placeholder;
  });

  // 1b. 再提取 Markdown 图片标记 ![alt](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    const placeholder = `%%IMG_${images.length}%%`;
    const fullSrc = src.startsWith('/') ? `${getApiBaseUrl()}${src}` : src;
    images.push({
      placeholder,
      tag: `<img src="${fullSrc}" alt="${alt}" style="max-width:220px;max-height:180px;border-radius:10px;object-fit:cover;display:block;margin:4px 0" />`,
    });
    return placeholder;
  });

  // 2. 转义 HTML 防止 XSS
  html = html
    .replace(/&(?![a-z]+;|#[0-9]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 3. 代码块 (```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const langClass = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${langClass}>${code.trim()}</code></pre>`;
  });

  // 4. 行内代码 `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 5. 链接 [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--primary);text-decoration:underline">$1</a>');

  // 6. 加粗 **text**
  html = html.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');

  // 7. 斜体 *text*（放在加粗之后，避免抢 **）
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // 8. 无序列表
  html = html.replace(/^[-*] (.+)$/gm, '• $1');

  // 9. 标题 # 转加粗
  html = html.replace(/^#{1,3}\s+(.+)$/gm, '<strong>$1</strong>');

  // 10. 换行转 <br>
  html = html.replace(/\n/g, '<br>');

  // 11. 还原图片占位符
  for (const img of images) {
    html = html.replace(img.placeholder, img.tag);
  }

  return html;
}

/** 移除文本中的图片引用（Markdown 和 HTML），避免与 fileUrls 展示重复导致破裂图标 */
export function stripImages(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '')
    .replace(/<img\s+[^>]*\/?\s*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
