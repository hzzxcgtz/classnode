import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { getApiBaseUrl } from './api-base';

const API_BASE_URL = getApiBaseUrl();

interface MarkdownProps {
  children: string;
  /** 是否允许渲染图片（流式输出时可禁用） */
  allowImages?: boolean;
  className?: string;
  /** 是否为流式输出模式（追加闪烁光标） */
  streaming?: boolean;
}

/** 使用 react-markdown 渲染 Markdown 内容的 React 组件 */
export function Markdown({ children, allowImages = true, className, streaming }: MarkdownProps) {
  const content = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
      rehypePlugins={[rehypeKatex]}
      components={{
        img: ({ src, alt }) => {
          if (!allowImages) return null;
          const fullSrc = src?.startsWith('/') ? `${API_BASE_URL}${src}` : src;
          return (
            <img src={fullSrc} alt={alt || ''}
              style={{ maxWidth: 220, maxHeight: 180, borderRadius: 10, objectFit: 'cover', display: 'block', margin: '4px 0' }} />
          );
        },
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--primary)', textDecoration: 'underline' }}>{children}</a>
        ),
        pre: ({ children }) => (
          <pre style={{ background: '#f1f5f9', borderRadius: 8, padding: '10px 14px', overflow: 'auto', fontSize: '0.813rem', lineHeight: 1.5, margin: '6px 0' }}>{children}</pre>
        ),
        code: ({ className, children, ...props }) => {
          const isInline = !className;
          if (isInline) {
            return <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontSize: '0.813rem' }}>{children}</code>;
          }
          return <code className={className} {...props} style={{ fontSize: '0.813rem' }}>{children}</code>;
        },
        table: ({ children }) => (
          <div style={{ overflowX: 'auto', margin: '6px 0' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.875rem' }}>{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th style={{ padding: '6px 10px', border: '1px solid #d1d5db', background: '#f1f5f9', fontWeight: 600, textAlign: 'left' }}>{children}</th>
        ),
        td: ({ children }) => (
          <td style={{ padding: '6px 10px', border: '1px solid #d1d5db' }}>{children}</td>
        ),
        blockquote: ({ children }) => (
          <blockquote style={{ borderLeft: '3px solid var(--primary,#667eea)', padding: '4px 0 4px 14px', margin: '6px 0', color: '#475569', background: '#f8fafc', borderRadius: '0 6px 6px 0' }}>{children}</blockquote>
        ),
        ol: ({ children }) => <ol style={{ paddingLeft: 22, margin: '4px 0', lineHeight: 1.7, listStyleType: 'decimal' }}>{children}</ol>,
        ul: ({ children }) => <ul style={{ paddingLeft: 20, margin: '4px 0', lineHeight: 1.7, listStyleType: 'disc' }}>{children}</ul>,
        li: ({ children }) => <li style={{ padding: '1px 0', listStyleType: 'inherit' }}>{children}</li>,
        h1: ({ children }) => <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '14px 0 6px', color: '#0f172a' }}>{children}</h1>,
        h2: ({ children }) => <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: '14px 0 6px', color: '#0f172a', borderBottom: '1px solid #eef2f6', paddingBottom: 4 }}>{children}</h2>,
        h3: ({ children }) => <h3 style={{ fontSize: '1.025rem', fontWeight: 700, margin: '14px 0 4px', color: '#1e293b' }}>{children}</h3>,
        h4: ({ children }) => <h4 style={{ fontSize: '0.938rem', fontWeight: 700, margin: '12px 0 4px', color: '#1e293b' }}>{children}</h4>,
        h5: ({ children }) => <h5 style={{ fontSize: '0.875rem', fontWeight: 700, margin: '12px 0 4px', color: '#1e293b' }}>{children}</h5>,
        h6: ({ children }) => <h6 style={{ fontSize: '0.8rem', fontWeight: 700, margin: '12px 0 4px', color: '#1e293b' }}>{children}</h6>,
        strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
        hr: () => <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid #e2e8f0' }} />,
        p: ({ children }) => <p style={{ margin: '6px 0' }}>{children}</p>,
      }}
    >
      {children}
    </ReactMarkdown>
  );

  return (
    <>
      {content}
    </>
  );
}

/** Markdown → HTML 渲染（字符串版，仅用于 DOCX 导出等需要 HTML 字符串的场景） */
export function renderMarkdown(text: string): string {
  let html = text;

  // 1. 提取图片标记
  const images: { placeholder: string; tag: string }[] = [];
  html = html.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?\s*>/gi, (match) => {
    const placeholder = `%%RAWIMG_${images.length}%%`;
    const fixed = match.replace(/src=["'](\/[^"']+)["']/gi, (m, src) =>
      m.replace(src, `${getApiBaseUrl()}${src}`));
    images.push({ placeholder, tag: fixed });
    return placeholder;
  });
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    const placeholder = `%%IMG_${images.length}%%`;
    const fullSrc = src.startsWith('/') ? `${getApiBaseUrl()}${src}` : src;
    images.push({
      placeholder,
      tag: `<img src="${fullSrc}" alt="${alt}" style="max-width:220px;max-height:180px;border-radius:10px;object-fit:cover;display:block;margin:4px 0" />`,
    });
    return placeholder;
  });

  // 2. 转义 HTML
  html = html
    .replace(/&(?![a-z]+;|#x?[0-9a-f]+;)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 3. 代码块
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const langClass = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${langClass}>${code.trim()}</code></pre>`;
  });

  // 4. 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 5. 分隔线
  html = html.replace(/^---+$/gm, '<hr>');

  // 6. 标题
  html = html
    .replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
    .replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
    .replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // 7. 有序列表
  html = html.replace(/(?:^\d+\.\s+.+$\n?)+/gm, (match) => {
    const items = match.trim().split('\n').map(line =>
      line.replace(/^\d+\.\s+(.+)$/, '<li>$1</li>')
    ).join('');
    return `<ol>${items}</ol>`;
  });

  // 8. 无序列表
  html = html.replace(/(?:^[-*]\s+.+$\n?)+/gm, (match) => {
    const items = match.trim().split('\n').map(line =>
      line.replace(/^[-*]\s+(.+)$/, '<li>$1</li>')
    ).join('');
    return `<ul>${items}</ul>`;
  });

  // 9. 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--primary);text-decoration:underline">$1</a>');

  // 10. 加粗
  html = html.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');

  // 11. 斜体
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // 12. 换行
  html = html.replace(/\n{2,}/g, '<br><br>');
  html = html.replace(/\n/g, '<br>');

  // 13. 还原图片
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

/** 剥离所有 Markdown 语法，只保留纯文本。用于对话监控等需要纯文本预览的场景 */
export function stripMarkdownToPlainText(text: string): string {
  let result = text;

  // 1. 移除代码块（保留内容）
  result = result.replace(/```[\s\S]*?```/g, '[代码]');

  // 2. 移除行内代码（保留内容）
  result = result.replace(/`([^`]+)`/g, '$1');

  // 3. 移除图片标记
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt) => alt || '[图片]');
  result = result.replace(/<img\s+[^>]*\/?\s*>/gi, '[图片]');

  // 4. 移除链接，保留文字，并在前后加空格防止粘连
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, ' $1 ');

  // 5. 移除加粗/斜体/删除线标记
  result = result.replace(/\*\*\*([\s\S]+?)\*\*\*/g, ' $1 ');  // 粗斜体 ***text***
  result = result.replace(/\*\*([\s\S]+?)\*\*/g, ' $1 ');      // 加粗 **text**
  result = result.replace(/\*([^*\n]+)\*/g, ' $1 ');           // 斜体 *text*
  result = result.replace(/~~([\s\S]+?)~~/g, ' $1 ');          // 删除线 ~~text~~
  result = result.replace(/__([\s\S]+?)__/g, ' $1 ');          // 下划线加粗 __text__

  // 6. 移除标题标记（# 及空格）
  result = result.replace(/^#{1,6}\s+/gm, '');

  // 7. 移除引用标记
  result = result.replace(/^>\s?/gm, '');

  // 8. 移除分隔线
  result = result.replace(/^[-*_]{3,}\s*$/gm, '');

  // 9. 移除无序列表标记
  result = result.replace(/^[-*+]\s+/gm, '');

  // 10. 移除有序列表的数字序号（保留内容）
  result = result.replace(/^\d+\.\s+/gm, '');

  // 11. 处理表格：移除 | 分隔符和 --- 行，单元格内容用空格隔开
  result = result.replace(/^[\s|]*:?-+:?[\s|]*$/gm, '');          // 表头分隔行
  result = result.replace(/^\|(.+)\|$/gm, (_, row) =>             // 表格行
    row.split('|').map((c: string) => c.trim()).filter(Boolean).join('、')
  );

  // 12. 处理数学公式（移除 $$ 和 $ 标记，保留公式内容，加简单标识）
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, ' [公式] ');
  result = result.replace(/\$([^$\n]+?)\$/g, ' [公式] ');

  // 13. 移除 HTML 标签
  result = result.replace(/<[^>]+>/g, '');

  // 14. 合并多余空格（保留换行）
  result = result.replace(/[ \t]+/g, ' ');
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}
