/**
 * 看板上的**头像怎么画**（★ 2026-10-07 教师：「当我使用**自定义头像**的时候，会有这种闪烁」）。
 *
 * 🔴 根因：自定义头像（学生上传的图）存的是一个**外面套着 `<image href="/uploads/…">` 的 SVG**
 *    （见 `avatar-utils.ts` 那段注释）。看板原来把它**内联**进 DOM（`dangerouslySetInnerHTML`）——
 *    而看板每隔一两秒就重绘一次（学生那边每 300ms 推一次实时预览），
 *    重绘会让浏览器把那张**外链图重新解码** ⇒ **闪一下**。
 *    纯矢量头像（系统头像）没有外链图 ⇒ 看不出来 —— 正好对上教师「只有自定义头像会闪」。
 *
 * ✅ 改成走 `SvgAvatar`（学生端聊天头像的老做法，2026-10-07 挪到 `src/components/` 共用）：
 *    有内嵌图 ⇒ 当 `<img>` 画（复用浏览器**解码后**的位图，重绘不闪）；
 *    纯矢量 ⇒ data URL（根本不进网络）。
 *
 * ⚠️ 判据只钉**两条硬的**：看板里**不许再内联头像 SVG**（内联回去就是把闪烁请回来）、
 *    以及 `SvgAvatar` **确实把内嵌图当 `<img>` 画**（那才是「不闪」的那一半）。
 *    两条都配了变异（施工时验过：把任一条改回旧写法都当场红）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => fs.readFileSync(path.resolve(HERE, relative), 'utf8');
/** 判据必须落在**活代码**上：注释里写着不算（本仓的老规矩）。 */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('看板不再内联头像 SVG —— 内联自定义头像会隔几秒闪一下', () => {
  const page = stripComments(read('page.tsx'));
  assert.ok(
    !/dangerouslySetInnerHTML/.test(page),
    '看板又用 `dangerouslySetInnerHTML` 内联头像了 —— 自定义头像（SVG 里带外链图）会重新解码、隔几秒闪一下',
  );
  const uses = page.match(/<SvgAvatar /g) ?? [];
  assert.ok(uses.length >= 4, `看板里走 SvgAvatar 的头像只剩 ${uses.length} 处（网格卡 / 抽屉标签 / 对话气泡 / 全屏卡 四处都要走它）`);
});

test('SvgAvatar：**有内嵌图就当 `<img>` 画**（纯矢量才走 data URL）', () => {
  const src = stripComments(read('../../../components/svg-avatar.tsx'));
  assert.match(src, /getEmbeddedAvatarImageUrl\(svg\)/, '没有认「SVG 里嵌着的那张外链图」—— 那种头像就必须走 <img>');
  assert.match(src, /const src = embeddedImageUrl \|\| svgDataUrl\(svg\)/, '两种头像没有分流（内嵌图优先、矢量兜底）');
  assert.match(src, /<img src=\{src\}/, '两种都做成 <img> 才算数 —— 内联 SVG 就是闪烁的来源');
});
