/**
 * ★「这个网页引用了、但包里没有」的本地文件。
 *
 * 🔴 它存在是因为一个**静默**的失败：教师传一个单 HTML，而它的样式在旁边的
 * `style.css` 里 —— 上传成功、学生打开**没有样式**，教师那边的提示是零。
 * 这与 `scanExternalDeps` 盯的那件事（外网资源）是**两件事**，所以是两个扫描器：
 * 那个列的是 `https://…`，这个列的是 `style.css`。
 *
 * ⚠️ **已知粗糙，沿用 `scanExternalDeps` 那条方针（误报优于漏报）**：
 * 动态拼出来的路径（`fetch('./data/' + id + '.json')`）会被报成缺失。
 * ⇒ 这条提示**不阻断上传**，措辞必须写成「**疑似**引用了」，不能写成断言。
 *
 * ⚠️ 返回的是**引用原样**（教师写的那个字符串），不是解析后的路径 ——
 * 解析后的路径他不认识，而他要做的是回去改那个引用。
 */
import { stripComments, type WebappSourceFile } from './webapp-external-deps.js';

/**
 * 三支：`href=` / `src=` 的属性值、CSS 的 `url(...)`、CSS 的 `@import "..."`。
 *
 * ⚠️ 与 `scanExternalDeps` 的 `URL_PATTERN` 有同一条已知粗糙：匹配到空白/引号/括号/分号
 * 为止，所以 `url(a;b.png)` 会被截断。**只影响提示的文字，不影响判定**。
 */
const REFERENCE_PATTERN =
  /\b(?:href|src)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)|@import\s+["']([^"']+)["']|srcset\s*=\s*["']([^"']+)["']/gi;

/**
 * `srcset` 的值是**逗号分隔的候选表**：`img/a.png 1x, img/b.png 2x`。
 * 每项取第一个空白前的那个 token 就是地址（后面是 `1x` / `2x` / `640w` 这类描述符）。
 *
 * ⚠️ 这是独立复核抓到的漏项：`srcset` 是**响应式图片的唯一写法**，而初稿把它整条漏了
 * （实测返回 0 条）—— 一个为了「别让教师的图静默丢」而存在的扫描器不该漏这一支。
 */
function splitSrcset(value: string): string[] {
  return value.split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean);
}

/**
 * 这条引用是不是「包内本该有的文件」。
 *
 * 不算的：带 scheme 的（`http:` / `data:` / `blob:` / `mailto:` / `javascript:` / `tel:`）、
 * 协议相对的（`//cdn…`，那是 `scanExternalDeps` 的活）、纯片段（`#x`）、纯查询（`?v=2`）。
 */
function isLocalReference(ref: string): boolean {
  if (!ref) return false;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) return false;
  if (ref.startsWith('#') || ref.startsWith('?')) return false;
  return true;
}

/** 把引用按它所在的文件解析成包内相对路径（`..` 要能退回去）。 */
function resolveAgainst(baseFile: string, ref: string): string | null {
  // ⚠️ **判定前先剥掉 `?` 与 `#`，两个分支都要。** 上面那条绝对路径分支本来就剥了，
  //    下面那条相对分支初稿漏了 ⇒ `href="style.css?v=3"`（缓存串）与 `href="about.html#team"`
  //    （锚点）会被报成缺失，**而文件明明在场**（独立复核实测）。缓存串与锚点是常见写法，
  //    误报会让这条提醒整体失去可信度。⚠️ 剥的只是判定用的路径，**展示给教师的仍是原样**。
  const clean = ref.split('#')[0].split('?')[0];
  if (!clean) return null;
  if (clean.startsWith('/')) return clean.slice(1) || null;
  const slash = baseFile.lastIndexOf('/');
  const baseDir = slash === -1 ? '' : baseFile.slice(0, slash);
  const raw = baseDir ? `${baseDir}/${clean}` : clean;
  const stack: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') { stack.pop(); continue; }
    stack.push(segment);
  }
  return stack.length > 0 ? stack.join('/') : null;
}

export function scanMissingLocalRefs(
  files: readonly WebappSourceFile[],
  presentPaths: readonly string[],
): { count: number; refs: string[] } {
  const present = new Set(presentPaths.map(p => p.replace(/\\/g, '/')));
  const seen = new Set<string>();
  const refs: string[] = [];

  for (const file of files) {
    const source = stripComments(file.content);
    for (const match of source.matchAll(REFERENCE_PATTERN)) {
      // `srcset` 那一支（第 4 组）要展开成多个候选；其余三支各是一整条引用。
      const candidates = match[4] !== undefined
        ? splitSrcset(match[4])
        : [(match[1] ?? match[2] ?? match[3] ?? '').trim()];
      for (const raw of candidates) {
        if (!isLocalReference(raw)) continue;
        const target = resolveAgainst(file.path.replace(/\\/g, '/'), raw);
        if (target && present.has(target)) continue;
        if (seen.has(raw)) continue;
        seen.add(raw);
        refs.push(raw);
      }
    }
  }

  return { count: refs.length, refs };
}
