import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 使用指南的**结构判据**（★ 2026-10-09 随 2.0 改版新增）。
 *
 * 🔴 为什么指南需要判据 —— 它坏起来是**静默**的：
 *   · 侧栏写了一个指向不存在小节的按钮 ⇒ 点下去什么都不动；
 *   · 正文引用了样式件里没有的类名 ⇒ 那一块**只是没样式**，不报错；
 *   · 别处链过来的锚点对不上 ⇒ 跳到页面顶部，而点的人只会以为自己点歪了。
 *   这三种都在本仓真实发生过（2026-10-09 改版前，`agents/platform-selector.tsx:12`
 *   链的是 `/teacher/guide#ai-agents`，而指南里那一节的 id 是 `agents` —— 坏了很久没人发现）。
 *
 * ⚠️ **这一层只证明「接线在、形态对」**，不证明「渲染出来好看」。
 *    版式、间距、换行这些必须用眼睛看，判据替不了。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const PAGE = fs.readFileSync(path.join(HERE, 'page.tsx'), 'utf8');
const CSS = fs.readFileSync(path.join(HERE, 'guide.module.css'), 'utf8');

/** 去掉注释再判 —— 注释里出现类名/锚点是正常的，不该被当成引用。 */
const stripComments = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const code = stripComments(PAGE);

test('侧栏每一项都指向一个真实存在的小节', () => {
  const navIds = [...code.matchAll(/\{ id: "([a-z-]+)", label:/g)].map((m) => m[1]);
  const sectionIds = [...code.matchAll(/<GuideSection id="([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(navIds.length >= 10, `侧栏只解析出 ${navIds.length} 项，正则大概没跟上写法`);
  for (const id of navIds) {
    assert.ok(sectionIds.includes(id), `侧栏有「${id}」这一项，但正文里没有 <GuideSection id="${id}"> —— 点它不会动`);
  }
  assert.equal(new Set(navIds).size, navIds.length, '侧栏有两项用了同一个 id');
  for (const id of sectionIds) {
    assert.ok(navIds.includes(id), `正文有 <GuideSection id="${id}">，但侧栏里没有它 —— 这一节永远高亮不到`);
  }
});

test('别处链进指南的锚点，每一个都能落到真实小节上', () => {
  // 全仓扫 `/teacher/guide#xxx`。这条判据就是为 `platform-selector.tsx` 那个坏链写的。
  const anchors = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(tsx?|ts)$/.test(entry.name) || entry.name.endsWith('.test.ts')) continue;
      if (full === path.join(HERE, 'page.tsx')) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const m of text.matchAll(/\/teacher\/guide#([a-z-]+)/g)) anchors.add(m[1]);
    }
  };
  walk(path.join(ROOT, 'src'));

  const sectionIds = [...code.matchAll(/<GuideSection id="([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(anchors.size > 0, '一个外链锚点都没扫到 —— 扫描根大概写错了（这条判据会因此变成空转）');
  for (const anchor of anchors) {
    assert.ok(sectionIds.includes(anchor), `全仓有人链到 #${anchor}，但指南里没有这一节 —— 那个链接会跳到页面顶部`);
  }
});

test('页面引用的样式类名与样式件一一对得上', () => {
  const used = new Set([...code.matchAll(/styles\.([A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1]));
  // 动态拼的两处：note 的 tone / platform 的颜色，名字是拼出来的，按取值域补上。
  for (const tone of ['Blue', 'Amber', 'Green']) used.add(`note${tone}`);
  for (const tone of ['Blue', 'Green', 'Purple', 'Orange']) used.add(`platform${tone}`);

  // ⚠️ 判据不能用「行首的 .类名」：`.sidebar .navActive` 这类复合选择器会被漏掉，
  //    于是真写错的类名混在假阳性里，反而看不清。用「.类名 后面跟非标识符字符」。
  const defined = new Set([...CSS.matchAll(/\.([A-Za-z][A-Za-z0-9_]*)(?![A-Za-z0-9_-])/g)].map((m) => m[1]));

  const missing = [...used].filter((name) => !defined.has(name)).sort();
  assert.deepEqual(missing, [], `页面引用了样式件里没有的类名（会静默变成没样式）：${missing.join('、')}`);

  const unused = [...defined].filter((name) => !used.has(name)).sort();
  assert.deepEqual(unused, [], `样式件里定义了但页面没用到的类名（改版后的残留）：${unused.join('、')}`);
});

test('每个截图占位都归属一个真实小节，且 id 不重', () => {
  const shotKeys = [...code.matchAll(/^  "([a-z][a-z-]*)": \{ title: "/gm)].map((m) => m[1]);
  const shotRefs = [...code.matchAll(/<Screenshot id="([a-z-]+)" \/>/g)].map((m) => m[1]);
  assert.ok(shotKeys.length >= 15, `SHOTS 只解析出 ${shotKeys.length} 张，正则大概没跟上写法`);
  assert.equal(new Set(shotRefs).size, shotRefs.length, '同一张截图在正文里出现了两次');

  const known = new Set(shotKeys);
  for (const id of shotRefs) {
    assert.ok(known.has(id), `正文引用了不存在的截图 id「${id}」`);
  }
  // 反向：定义了却没在正文里出现的，教师看清单时会找不到它在哪一节。
  const orphan = shotKeys.filter((id) => !shotRefs.includes(id));
  assert.deepEqual(orphan, [], `SHOTS 里这些截图没有出现在正文任何位置：${orphan.join('、')}`);
});

test('每张截图都有对应文件，每个文件也有对应截图', () => {
  /*
   * 🔴 路径现在是**由 id 推**的（`shotSrc`），所以判据要双向：
   *   · 表里写了、磁盘上没有 ⇒ `<img>` 静默破图；
   *   · 磁盘上有、表里没写 ⇒ 图白截了，页面上根本不是它。
   *   两条都只能靠这条判据发现 —— 两种失败都不报错。
   */
  const ids = [...code.matchAll(/^  "([a-z][a-z-]*)": \{ title: "/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 15, `SHOTS 只解析出 ${ids.length} 张，正则大概没跟上写法`);
  assert.match(code, /const shotSrc = \(id: keyof typeof SHOTS\) => `\/images\/guide\/\$\{id\}\.png`/,
    'shotSrc 的拼法变了 —— 下面那条「磁盘上的文件」判据是照它写的');

  const dir = path.join(ROOT, 'public', 'images', 'guide');
  for (const id of ids) {
    assert.ok(fs.existsSync(path.join(dir, `${id}.png`)), `SHOTS 里有「${id}」，但 public/images/guide/${id}.png 不存在`);
  }
  const onDisk = fs.readdirSync(dir).map((name) => name.replace(/\.[a-z0-9]+$/i, ''));
  const missing = onDisk.filter((name) => !ids.includes(name));
  assert.deepEqual(missing, [], `这些图在 public/images/guide/ 里，但 SHOTS 没登记：${missing.join('、')}`);
});

/*
 * ⊘ 2026-10-09 删掉的一条：`截图清单与正文读的是同一份数据`（原先断言清单遍历 `SHOTS`）。
 *   清单本身随「22 张截齐」一起删了，而**「只有一份真源」现在由结构保证**：
 *   路径从 `SHOTS` 的键推出来，没有第二处可以写错的地方 —— 不需要再拿判据守一件做不到的事。
 */

test('改版修掉的那 5 处错文案没有悄悄回来', () => {
  // 每一条都是 2026-10-09 对着源码核过的（见 page.tsx 文件头的改版记录）。
  const banned: Array<[RegExp, string]> = [
    [/至少\s*8\s*位/, '管理密码已改为不限长度（teacher/layout.tsx:276-281）'],
    [/导出报表/, '界面上没有「导出报表」这个按钮（history/page.tsx:406 是「导出学习单与探究空间」）'],
    [/屏蔽管理/, '侧栏与页标题都叫「课堂安全」（teacher/layout.tsx:38）'],
    [/智能体管理/, '侧栏叫「AI智能体」（teacher/layout.tsx:31）'],
  ];
  for (const [pattern, why] of banned) {
    assert.doesNotMatch(code, pattern, `指南里又出现了旧文案「${pattern.source}」：${why}`);
  }
  // 文心的「流式输出」是不支持的（agent-card.tsx:106 的 `非流式` 标签）。
  const wenxin = code.slice(code.indexOf('文心智能体'));
  assert.match(wenxin.slice(0, 260), /capabilities: \[true, false, false, false, false\]/, '文心那一行的能力位又改回「支持流式」了');
});
