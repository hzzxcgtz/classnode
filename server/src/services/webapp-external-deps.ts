export interface WebappSourceFile {
  path: string;
  content: string;
}

export interface ExternalDependency {
  url: string;
  /** 首次出现这个 URL 的文件（包内相对路径）。 */
  file: string;
}

/**
 * 剥离注释后再找 URL。
 *
 * 必须剥：教师的网页里「参考 https://…/docs」这类注释很常见，把它们报成外部依赖
 * 会让提示变成噪音，而这条提示的价值完全建立在「报出来的都是真依赖」上。
 *
 * 已知的粗糙之处（有意的取舍）：会把字符串字面量里的 URL 一并算进来，哪怕它只是
 * 一段说明文字而非真的去请求。**宁可多报** —— 本函数的输出只驱动一条提醒，不阻断
 * 上传；漏报的代价（白屏后误判为 ClassNode 故障）比多报大得多。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** 匹配 http(s):// 开头、到空白或引号/括号/分号为止的一段。 */
const URL_PATTERN = /https?:\/\/[^\s"'`)>;,]+/g;

/**
 * data: / blob: URL 字面量，整段剔除。
 *
 * 为什么必须**整段**剔除、而不是指望 URL_PATTERN 自己把它们挡掉：`blob:http://localhost/xxx`
 * 里嵌着一个完整的 `http://` 前缀，而 URL_PATTERN 没有左边界锚点，于是会把内层那截
 * 当成外部依赖报出来。blob: / data: 都是页面自己在本地生成的内容，断网也照常显示，
 * 所以不算外部依赖。
 *
 * 字符类与 URL_PATTERN 一致（空白/引号/括号/分号/逗号截止）：`blob:a;b` 这种写法只剔到
 * 分号为止，不会把后面的代码一并吃掉。`\b` 用来避开 `metadata:` 这类标识符。
 */
const LOCAL_URL_LITERAL = /\b(?:data|blob):[^\s"'`)>;,]*/gi;

export function scanExternalDeps(
  files: readonly WebappSourceFile[],
): ExternalDependency[] {
  const seen = new Map<string, string>();

  for (const file of files) {
    const source = stripComments(file.content).replace(LOCAL_URL_LITERAL, '');
    for (const match of source.matchAll(URL_PATTERN)) {
      const url = match[0];
      if (!seen.has(url)) seen.set(url, file.path);
    }
  }

  return [...seen.entries()].map(([url, file]) => ({ url, file }));
}
