/**
 * 节点形状的**描边粗细**：菱形必须跟其它形状一样（★ 2026-10-06 教师批图）。
 *
 * 🔴 教师原话（图上批注）：「**菱形的框太粗了，要跟其它图形一样。**」
 *
 * 根因：其它形状的描边是 CSS 里的 `border`，而菱形是**画出来的** SVG —— 它的
 * `strokeWidth` 被单独写成了 `3`，正好是 CSS 那 1.5 的两倍。分叉还不止这一处：
 * **选中时**两边也走两套路 —— 矩形只换边框颜色，菱形却把描边加粗到 3。
 *
 * ⚠️ 本仓没有 jsdom ⇒ 这一条是**源码级**的网（读 CSS 与 TSX 的文本对拍）。
 *    它挡的是「又有一边被单独改粗」，挡不住「渲染出来其实不一样」。
 * 🔴 两个值都**从文本里现读**再比，谁也不许写死 —— 写死 1.5 的话，将来整体调粗细时
 *    这条判据会**假绿**（它比的就成了「1.5 是不是 1.5」）。
 * ⚠️ 快照 `worksheet-flowchart-svg.ts` **不在**这条判据里：那边所有形状共用同一个
 *    `stroke-width` 常量，本来就齐（它画的是另一张图，不是屏幕）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TSX = fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8');

/**
 * 按**代码标记**切一段出来（与 `flowchart-history-wiring.test.ts` 里那个同名同形 ——
 * 那个是这个文件私有的，这边要用就得自己有一份）。
 * ⚠️ 找不到标记时返回**空串**、不泄漏到文件末尾：泄漏出来的那一大坨会让「长度 > N」的下界断言
 * 反而更容易过，判据就静默泡软了。
 */
function blockBetween(source: string, startMarker: string, endMarker: string): string {
  const at = source.indexOf(startMarker);
  if (at === -1) return '';
  const end = source.indexOf(endMarker, at + startMarker.length);
  return end === -1 ? '' : source.slice(at, end);
}
const CSS = fs.readFileSync(path.resolve(HERE, '..', '..', 'worksheet.module.css'), 'utf8');

/** 其它形状的描边粗细 —— 唯一真源是 CSS 的 `.flowNode` 那条规则。 */
function baseBorderWidth(): string {
  const block = /\.flowNode\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(block, '找不到 `.flowNode` 那条 CSS 规则（样式表改结构了？）');
  const width = /border:\s*([\d.]+)px/.exec(block[1]);
  assert.ok(width, '`.flowNode` 里没写 border 宽度 —— 判据无源可比');
  return width[1];
}

/** 菱形那个 polygon（它是 `FlowNodeEditor` 里唯一一个 points 以 `50,` 开头的多边形）。 */
function diamondPolygon(): string {
  const at = TSX.indexOf('points="50,');
  assert.ok(at > 0, '找不到菱形 polygon —— 形状改画法了？');
  const end = TSX.indexOf('/>', at);
  return TSX.slice(at, end === -1 ? at + 300 : end);
}

test('菱形的描边与其它形状一样粗', () => {
  const stroke = /strokeWidth="([\d.]+)"/.exec(diamondPolygon());
  assert.ok(stroke, '菱形的 polygon 上没有 strokeWidth');
  assert.equal(
    stroke[1],
    baseBorderWidth(),
    '菱形是画出来的 SVG、其它是 CSS border，两处写死了不同的数 ⇒ 眼睛看得出的粗细差。'
      + '教师 2026-10-06 报过一次：「菱形的框太粗了，要跟其它图形一样。」',
  );
});

/*
  ★ 2026-10-06（教师批图：「**文字要包在框内**」）：**菱形里的文字必须落在内接矩形里**。

  判断框是**画出来的**菱形（`<polygon>`），它的内接矩形只有外框的**一半宽、一半高**
  —— 顶点落在四条边的中点上。而文字盒 `.flowNodeLabel` 的 `max-width` 是按**整个外框**给的，
  所以条件一长就必然探出斜边。

  ⚠️ 这里还有个**循环**：菱形宽度本来是被文字**撑开**的（`min-width` 只是下限），
  所以「只把文字限窄」单独做不管用 —— 两边要**一起**钉：菱形给足确定的尺寸、
  label 的 `max-width` 收到内接半宽以内。
*/
test('菱形里的文字必须落在内接矩形内 —— 半宽是硬上限', () => {
  const diamond = blockBetween(CSS, '.flowNode_decision {', '}');
  assert.ok(diamond.length > 20, '找不到 `.flowNode_decision` 那条规则');
  const minW = /min-width:\s*([\d.]+)px/.exec(diamond);
  assert.ok(minW, '判断框要有确定的 min-width（否则宽度被文字撑开，下面的上限就失去意义）');

  const labelRule = blockBetween(CSS, '.flowNode_decision .flowNodeLabel', '}');
  assert.ok(labelRule.length > 10, '找不到「判断框里的 label」那条规则');
  const maxW = /max-width:\s*([\d.]+)px/.exec(labelRule);
  assert.ok(maxW, '判断框里的 label 要有自己的 max-width（外框那条 220px 对它太大）');

  const halfWidth = Number(minW[1]) / 2;
  assert.ok(
    Number(maxW[1]) <= halfWidth,
    `label 的 max-width ${maxW[1]}px 超过了内接半宽 ${halfWidth}px ⇒ 字会探出斜边（教师批图报的就是这个）`,
  );
});

/*
  ★ 2026-10-06（教师真机截图，红框圈着那一团）：「**那个点的问题**」。

  连接点上挂着**四个** `12×12` 的 Handle（上/右/下/左），而这个节点本身只有 **`8×8`**。
  桌面上它们 `opacity: 0` 看不见；**触屏（`@media (hover: none)`）下改成 `opacity: .5` 半透明显形**
  —— 于是四个方块的中心分别往上下左右各偏 10px，**并起来正好是一个「十字」**，
  把真正的空心小圆整个盖住。教师拍到的就是那一团。

  ✅ 连接点的句柄**不需要露出来**：它不是「拖出连线」的入口（线是接在它上/下那两段上的），
  而那条「触屏必须留着句柄」的理由（见 `worksheet.module.css` 里的长注释）是**对普通框**说的
  —— 学生要能从框的四个点拖出线来。连接点没有这个需要。
  ⚠️ `opacity: 0` 的元素**仍然可点**，连线判定不受影响。

  🔴 **位置要紧**：这条规则必须排在 `@media (hover: none)` **之后** —— 同特异性、后写的赢，
  否则压不住里面那条 `opacity: .5`。
*/
test('连接点的句柄不许露出来 —— 4 个 12x12 挤在 8x8 的节点上会糊成一个十字', () => {
  const mediaAt = CSS.indexOf('@media (hover: none)');
  assert.ok(mediaAt > -1, '找不到触屏那段媒体查询（样式表改结构了？）');
  const ruleAt = CSS.indexOf('.flowNode_junction :global(.react-flow__handle)');
  assert.ok(ruleAt > -1, '缺「连接点的句柄」那条规则');
  assert.ok(
    ruleAt > mediaAt,
    '这条规则必须排在 @media (hover: none) 之后 —— 同特异性下后写的才赢，否则压不住那条 opacity: .5',
  );
  const rule = blockBetween(CSS.slice(ruleAt), '{', '}');
  assert.match(rule, /opacity:\s*0/, '连接点的句柄要彻底隐形（那一团十字的来源）');
});

test('菱形选中时只换颜色，不加粗 —— 与其它形状同一套', () => {
  // ⚠️ 只认「命中 polygon」的那条规则：`.flowNode_decision[data-selected='1'] { … }` 本身
  //    不含 stroke-width，混进来会假绿。
  const rule = /\.flowNode_decision\[data-selected='1'\][^{]*\.flowNodeShape[^{]*\{([^}]*)\}/.exec(CSS);
  assert.ok(rule, '找不到「菱形选中」那条 CSS 规则');
  assert.ok(
    !/stroke-width/.test(rule[1]),
    '其它形状选中只换边框颜色（`.flowNode[data-selected=\'1\']` 里没有 border-width）⇒'
      + ' 菱形也不许在选中时加粗，否则一选中就比旁边粗一圈。',
  );
});
