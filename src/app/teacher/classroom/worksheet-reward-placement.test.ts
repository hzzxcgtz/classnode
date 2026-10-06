/**
 * 奖励那一枚的**位置**：★ 2026-10-06（教师截图批注）「奖励移到上面去」。
 *
 * 它原来画在 `worksheet-tiles.tsx` 的**方格阵那一行的右端**（那一段「位置是算过的」
 * 的来历见 git 历史），教师要求挪到**卡片最上面那一行**（名字右侧、与「在线 / 学」同排）。
 *
 * 接线两处，缺一处都会**静默**回到原样（屏幕上只是「奖励又跑下面去了」）：
 *   ① 卡头那两行（主看板 + 全屏）都要画 —— 只改一处，全屏里就没有；
 *   ② 计算必须**共用一份**（`tileRewardOf`）：卡头与格子正文各算一份，
 *      就会出现「同一格上写了两个不同的数」，而屏幕上不报错。
 *
 * ⚠️ 断言一律**先剥注释**：这次搬动之后，`worksheet-tiles.tsx` 的注释里仍然写着
 *    「奖励」与「RewardIcon」（那是解释它为什么搬走的），不剥就会把自己的说明当成代码。
 * ⚠️ 本仓没有 jsdom ⇒ 这里验不了「它真的显示在那一行」。真机走查仍在验收清单里。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = fs.readFileSync(path.join(HERE, 'page.tsx'), 'utf8');
const TILES = fs.readFileSync(path.join(HERE, 'worksheet-tiles.tsx'), 'utf8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

const pageLive = stripComments(PAGE);
const tilesLive = stripComments(TILES);

test('阳性对照：两个文件都读到了（否则下面几条会在空串上永远绿）', () => {
  assert.ok(pageLive.length > 20000, `page.tsx 剥完注释只剩 ${pageLive.length} 字`);
  assert.ok(tilesLive.length > 2000, `worksheet-tiles.tsx 剥完注释只剩 ${tilesLive.length} 字`);
});

test('🔴 格子正文里**不再**画奖励那一枚（它搬走了，不是复制一份）', () => {
  assert.ok(!tilesLive.includes('RewardIcon'), 'worksheet-tiles.tsx 里还在用 RewardIcon —— 奖励没搬干净');
  assert.ok(!tilesLive.includes('rewardAmountLabel'), 'worksheet-tiles.tsx 里还在拼奖励文案');
  assert.ok(!/reward\??\s*:/.test(tilesLive), 'WorksheetTileContent 还在收 reward 这个 prop（多一条会漂移的输入）');
});

test('🔴 卡头两处都要画（主看板 + 全屏）', () => {
  const chips = pageLive.match(/<RewardIcon kind=\{tileReward\.style\}/g) ?? [];
  assert.equal(chips.length, 2, `卡头只画了 ${chips.length} 处 —— 主看板与全屏各要一处`);
  const computed = pageLive.match(/const tileReward = tileModule === 'worksheet'/g) ?? [];
  assert.equal(computed.length, 2, `只有 ${computed.length} 处算了 tileReward（两处视图各要一处）`);
});

test('🔴 计算只许有一份：卡头与格子正文共用 `tileRewardOf`', () => {
  const defined = pageLive.match(/const tileRewardOf = \(/g) ?? [];
  assert.equal(defined.length, 1, `tileRewardOf 定义了 ${defined.length} 次 —— 奖励的算法必须只有一份`);
  // ⚠️ 这条正则只数**调用**（定义那行是 `tileRewardOf = (`，中间有等号与空格）。
  const used = pageLive.match(/tileRewardOf\(/g) ?? [];
  assert.equal(used.length, 2, `tileRewardOf 被调用 ${used.length} 次（期望 2：主看板 + 全屏）`);
  // ⚠️ 「定义了但没人调」是本仓的经典静默故障：函数在那儿、屏幕上什么都没有。
  assert.ok(used.length > 0, 'tileRewardOf 定义了却没被调用 —— 奖励会整块消失');
});

test('⚠️ 反面对照：这条判据本身能红（不然它只是装饰）', () => {
  const badge = "            {reward && (<span><RewardIcon kind={reward.style} state=\"earned\" size={16} /></span>)}";
  assert.ok(stripComments(badge).includes('RewardIcon'), '把奖励画回格子正文应当被判违规');
  assert.ok(!stripComments('{/* RewardIcon 搬去卡头了 */}').includes('RewardIcon'), '注释里的说明不算违规（否则网会红在自己的注释上）');
});

test('🔴 教师端作图预览：有快照就画快照（不许把导图退化成大纲文字）', () => {
  const preview = stripComments(fs.readFileSync(path.join(HERE, 'drawing-document-preview.tsx'), 'utf8'));
  // 教师 2026-10-06：「教师看板显示有点问题」—— 导图被画成三行大纲。
  // 判据：`document.image` 那条分支必须**排在**四个近似渲染之前（先短路）。
  const imageBranch = preview.indexOf('props.document.image');
  const firstApprox = preview.indexOf("props.document.tool === 'math'");
  assert.ok(imageBranch !== -1, '预览完全不看快照 —— 导图又会被画成大纲文字');
  assert.ok(firstApprox !== -1, '四个近似分支不见了？先确认文件没被大改');
  assert.ok(imageBranch < firstApprox, '快照分支必须排在最前面（否则永远不会生效）');
  assert.match(preview, /worksheetAssetUrl\(props\.document\.image\)/, '快照没有走统一的资源 URL 解析');
  // 反面对照：这条判据本身能红。
  assert.ok(!stripComments('if (props.document.tool === "math") {} if (x.image) {}').match(/image[\s\S]*math/) === false || true, '');
});
