import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ★ 2026-09-25：**用到的每一个 `styles.X` 都必须在那个 CSS 模块里真的有 `.X`。**
 *
 * 🔴 为什么要有它 —— 与 `css-module-animation.test.ts` 是同一族的**静默失效**，
 * 而且它**刚刚真的发生过一次**：课堂暂停的覆盖层写成 `className={styles.pauseCover}`，
 * 而那一下要是类名对不上（拼错 / 忘了写进 CSS / CSS 模块换了个文件名），
 * `styles.pauseCover` 求值就是 **`undefined`**：
 *
 *   - 构建**不报错**（`next build` 退出 0、`tsc --noEmit` 退出 0 —— CSS 模块的索引签名
 *     让任何键名都通得过类型检查）；
 *   - JSX 里**看得见**（`className={styles.pauseCover}` 明明写着）；
 *   - 但那个元素**一点样式都没有** —— 一个 `<div>` 退回浏览器默认样式。
 *
 * 教师真机上报的「顶部横幅没有出现」就是这一族的近亲（那次是 `position: fixed` 的栏
 * 把流内的横幅盖住了，不是类名错）—— **同一个现象、不同的成因，而两次都不报错**。
 * ⇒ 这条网把「类名有没有定义」这一半变成可判定的。
 *
 * ⚠️ 只读文本、不渲染任何东西 ⇒ 本机（无 jsdom、无浏览器）跑得起来。
 * ⚠️ 它**不查样式对不对、好不好看** —— 那只能在真机上看。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..'); // → src/

/** 递归收集目录下指定后缀的文件。 */
function collect(dir: string, suffix: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full, suffix));
    else if (entry.name.endsWith(suffix)) out.push(full);
  }
  return out;
}

/** 去掉注释与**字符串字面量**：注释里会引用被禁的写法，字符串里会出现假的 `styles.X`。 */
function stripNoise(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/`[^`]*`/g, '``')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

/** CSS 模块里定义的所有类名（顶层与嵌套里的 `.X` 都算 —— 嵌套也算定义）。 */
function definedClasses(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
    out.add(m[1]);
  }
  return out;
}

test('🔴 学生端每个 `styles.X` 都在它导入的那个 CSS 模块里有定义', () => {
  const violations: string[] = [];
  let checkedFiles = 0;
  let checkedRefs = 0;

  for (const file of collect(path.join(SRC, 'app', 'classroom'), '.tsx')) {
    const raw = fs.readFileSync(file, 'utf8');
    // 该文件从哪个 CSS 模块导入、用的什么局部名（可能是 `styles`，也可能是别的）。
    const importMatch = /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.module\.css)['"]/.exec(raw);
    if (!importMatch) continue;
    const [, localName, cssPath] = importMatch;
    const cssFile = path.resolve(path.dirname(file), cssPath);
    if (!fs.existsSync(cssFile)) {
      violations.push(`${path.relative(SRC, file)} 导入了不存在的 ${cssPath}`);
      continue;
    }
    const defined = definedClasses(fs.readFileSync(cssFile, 'utf8'));
    const source = stripNoise(raw);
    checkedFiles += 1;

    const re = new RegExp(`${localName}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g');
    for (const m of source.matchAll(re)) {
      checkedRefs += 1;
      if (!defined.has(m[1])) {
        violations.push(`${path.relative(SRC, file)} 用了 ${localName}.${m[1]}，而 ${path.basename(cssFile)} 里没有 .${m[1]}`);
      }
    }
  }

  // 阳性对照：真扫到了东西。少了它，「一个文件都没匹配上」与「全都没问题」都是空 violations。
  assert.ok(checkedFiles > 5, `只扫到 ${checkedFiles} 个文件 —— 匹配规则失效了`);
  assert.ok(checkedRefs > 20, `只数到 ${checkedRefs} 个 styles.X —— 匹配规则失效了`);
  assert.deepEqual(violations, [], `有 styles.X 指向不存在的类名（渲染出来是**没有样式**的元素，构建不报错）：\n${violations.join('\n')}`);
});
