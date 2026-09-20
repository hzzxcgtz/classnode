export interface WebappSourceFile {
  path: string;
  content: string;
}

export interface ExternalDependency {
  /**
   * 识别到的一段外部引用。
   *
   * ⚠️ **只保证「这是一条外部依赖」，不保证是一个完整可用的 URL。**
   * 匹配到空白/引号/括号/分号为止，所以 CSS 里含 `;` 的地址会被截断，例如
   * `…css2?family=Inter:wght@400;700&display=swap` 只会返回 `…wght@400`。
   *
   * ⇒ **消费方不要拿它去直接请求，也不要原样展示给教师**（T3 的提示只展示
   * **数量与文件名**）。要展示域名的话，自己从返回值里取 host，不要直接打印本字段。
   */
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
 *
 * 另一处**明确接受**的粗糙（同为「误报优于漏报」方针，T0 定过）：这里只剥
 * **整行** `//` 注释，**行尾**注释里的 URL 仍会被报出来，例如
 * `const CDN = 1; // 详见 https://example.com/docs` 会报出 `example.com/docs`。
 * 不修的原因：剥行尾 `//` 必须先识别字符串字面量（`https://` 自己就含 `//`，
 * 无脑剥会把所有 URL 一起削掉），那是分词器的活，不是正则的活。
 * 后果只是提示里多一条噪音，不阻断上传、也不会掩盖真依赖 ⇒ 接受。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * 匹配一段 URL，两种写法：
 *
 * 1. 带 scheme：`https://…` / `http://…`。
 * 2. **协议相对**（scheme-relative）：`//cdn.example.com/x.js`。课件里常见，
 *    而它漏报的后果**正是本函数存在的理由** —— 外网不通 → 该资源加载失败 →
 *    白屏 → 教师误判成 ClassNode 故障，**且没有任何提示**。
 *
 * 协议相对那一支为什么长这样：
 * - `//` 之前必须是**定界符**（`[^\w:/]`：引号/括号/逗号/分号/空格/行首），不能紧跟
 *   标识符字符。于是 `data:…;base64,PHN2Zy//…` 里 base64 段内部的 `//` 不会被误认
 *   （它前面是字母）；`:` 同样被排除，所以 `https://a/b` **不会**在第一支之外
 *   再被第二支重复报一次。
 * - 主机名必须**至少含一个点**（`[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+`）。base64 字母表
 *   不含 `.`，这条把 base64 段彻底排除；`10.0.0.5` 这类 IP 照样命中。
 *   代价：`//localhost/x.js` 这种无点主机报不出来（判为可接受，见测试）。
 *
 * 两支都到空白/引号/括号/分号/逗号为止。
 */
const URL_PATTERN =
  /https?:\/\/[^\s"'`)>;,]+|(?:^|[^\w:/])(\/\/[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+[^\s"'`)>;,]*)/g;

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
      // 协议相对那一支带一个定界符前缀，真正的 URL 在第 1 组；带 scheme 那支没有第 1 组。
      const url = match[1] ?? match[0];
      if (!seen.has(url)) seen.set(url, file.path);
    }
  }

  return [...seen.entries()].map(([url, file]) => ({ url, file }));
}
