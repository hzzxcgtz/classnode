/**
 * ★ 2026-10-07（教师）：「线段两端的点只有当我选中这个线段的时候才会出现；
 *   我不选择的时候，它就是一根看不见端点的线条」。
 *
 * 🔴 为什么必须单独钉「待定点」和「独立的点」这两条例外：它们是**同一句需求的边界**。
 *   把 mkPoint 一刀切成 invisible，表现是「多击工具点下去没有任何反馈」
 *   （角弧要点三下，没有点就不知道点了两下）与「学生标了一个点，屏幕上什么都没有」——
 *   两种都不报错，只在真机上看得见。
 *
 * ⚠️ 源码级判据：证「接线在、形态对」，不证运行时画出来什么样。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SOURCE = stripComments(fs.readFileSync(path.join(HERE, 'math-drawing.tsx'), 'utf8'));

test('★ 图形端点视觉透明但仍参与命中，历史独立点保持可见', () => {
  assert.match(SOURCE, /const mkHandle = \(at: Pt\)/, '没有 mkHandle');
  assert.match(SOURCE, /const mkMark = \(at: Pt\)/, '没有 mkMark');
  // 不能用 visible:false：那会让 JSXGraph 同时取消端点的拖动命中。
  const handle = SOURCE.slice(SOURCE.indexOf('const mkHandle'), SOURCE.indexOf('const mkMark'));
  assert.match(handle, /visible: true/, 'mkHandle 没留在命中检测里 ⇒ 透明端点仍然拖不动');
  assert.match(handle, /strokeOpacity: 0/, '端点描边未透明 ⇒ 默认仍会露出圆圈');
  assert.match(handle, /fillOpacity: 0/, '端点填充未透明 ⇒ 默认仍会露出圆圈');
  assert.match(handle, /precision: \{ mouse: 8, pen: 12, touch: 30 \}/, '没有为透明端点保留鼠标与触控命中区');
  // 历史作答里的独立点必须继续看得见。
  const mark = SOURCE.slice(SOURCE.indexOf('const mkMark'), SOURCE.indexOf('const mkMark') + 400);
  assert.ok(!/fillOpacity: 0/.test(mark), 'mkMark 也透明了 ⇒ 历史独立点会消失');
});

test('★ 多边形改成拖动绘制后，不再保留多击待定点状态', () => {
  assert.doesNotMatch(SOURCE, /pending\.current|marks\.push\(/, '仍在维护已删除的多击作图状态');
});

test('★ 独立的「点」走 mkMark（那一个点就是学生的作答本身）', () => {
  const at = SOURCE.indexOf("entry.kind === 'point'");
  assert.notEqual(at, -1, '找不到 point 那一支');
  assert.match(SOURCE.slice(at, at + 260), /mkMark\(entry\.p\)/, '独立的点用了看不见的工厂 ⇒ 画上去什么都没有');
});

test('★ 选中时把端点露出来（重画之后、按选中那一条改）', () => {
  const at = SOURCE.indexOf('const applySelection = (');
  assert.notEqual(at, -1, '找不到 applySelection');
  const body = SOURCE.slice(at, SOURCE.indexOf('\n    };', at));
  assert.match(body, /renderAll\(/, '① 没有先重画 ⇒ 上一条选中的端点不会消失');
  assert.match(body, /visible: true/, '② 没有把选中那条的端点露出来');
  assert.match(body, /size: 3/, '③ 选中端点不是小控制点');
  assert.doesNotMatch(body, /size: 6/, '选中端点仍是两个大圆');
});

test('★ 再次按住已选图形时不重画，拖动对象不能在 pointerdown 中被替换', () => {
  const at = SOURCE.indexOf("if (toolRef.current === 'select')");
  assert.notEqual(at, -1, '找不到选择工具分支');
  const body = SOURCE.slice(at, SOURCE.indexOf('// 拖动既有控制点', at));
  assert.match(body, /index === selectedRef\.current\) return/, '重复选择仍会重画并打断端点拖动');
});

test('★ 多边形透明无闪烁，内部和每一条边都能稳定选中', () => {
  const at = SOURCE.indexOf("board.create('polygon'");
  assert.notEqual(at, -1, '找不到多边形创建分支');
  const body = SOURCE.slice(at, at + 2600);
  assert.match(body, /hasInnerPoints: true/, '多边形内部不能命中，仍然只能费力地点边');
  assert.match(body, /fillColor: 'none'/, '多边形仍有默认黄色填充');
  assert.match(body, /fillOpacity: 0/, '多边形填充仍可见');
  assert.match(body, /highlightFillColor: 'none'/, '点击/悬停仍会触发填充闪烁');
  assert.match(body, /hitObjects: \[\.\.\.points, shape, \.\.\.shape\.borders\]/,
    '多边形自动创建的各条边没有归到所属图形，点边时仍选不中');
  assert.match(SOURCE, /item\.hitObjects \?\? item\.objects/, '选择逻辑没有使用包含边的命中对象表');
});

test('★ 画布空白处可直接平移，滚轮缩放减速，多边形拖点启用几何吸附', () => {
  assert.match(SOURCE, /pan: \{ enabled: !disabled, needShift: false, needTwoFingers: false \}/,
    '空白处仍不能直接拖动画布');
  assert.match(SOURCE, /factorX: 1\.02, factorY: 1\.02/, '滚轮缩放倍率仍然过快');
  assert.match(SOURCE, /point\.on\('drag'/, '多边形顶点拖动时没有运行吸附');
  assert.match(SOURCE, /snapPolygonVertex\(/, '平行/垂直吸附没有接入画板');
  assert.match(SOURCE, /rightAngleCornerOf\(/, '吸成直角后没有自动显示小直角符号');
  assert.match(SOURCE, /dataset\.panCursor/, '空白区域没有手型指针反馈');
});

test('★ 闭合多边形支持整体移动，同时保留单顶点调整', () => {
  assert.match(SOURCE, /const onPolygonMoveDown = \(event: PointerEvent\)/, '没有多边形整体拖动入口');
  assert.match(SOURCE, /item\.points\.some\(\(point\) => point\.id === hit\.target\.id\)\) return/,
    '拖顶点也被当成整体移动，无法单独调整形状');
  assert.match(SOURCE, /movingItem\.points\.forEach/, '整体移动没有同步平移所有顶点');
  assert.match(SOURCE, /origin\[0\] \+ dx, origin\[1\] \+ dy/, '各顶点没有使用同一份位移量');
});

test('★ 选中多边形的顶点外圈支持整体旋转', () => {
  assert.match(SOURCE, /distance >= 12 && distance <= 28/, '顶点外侧没有独立的旋转命中环');
  assert.match(SOURCE, /rotatePolygonPoints\(/, '旋转没有走纯几何函数');
  assert.match(SOURCE, /addEventListener\('pointerdown', onRotationDown, \{ capture: true \}\)/,
    '旋转手势没有在画板拖动之前接管');
  assert.match(SOURCE, /dataset\.panCursor = polygonRotation \? 'rotating' : 'rotate'/,
    '进入旋转区域时没有切换指针反馈');
});

test('★ 选中数学对象后可用 Delete / Backspace 删除，且快捷键只作用于已聚焦画布', () => {
  assert.match(SOURCE, /tabIndex=\{disabled \? -1 : 0\}/, '数学画布不能获得键盘焦点');
  assert.match(SOURCE, /event\.key !== 'Delete' && event\.key !== 'Backspace'/,
    '没有同时支持 Delete 与 Backspace');
  assert.match(SOURCE, /selectedRef\.current === null\) return/, '没有选中对象时仍会误删');
  assert.match(SOURCE, /hostEl\.addEventListener\('keydown', onKeyDown\)/,
    '删除快捷键没有收在当前数学画布内');
  assert.match(SOURCE, /hostEl\.removeEventListener\('keydown', onKeyDown\)/,
    '卸载后仍残留删除快捷键监听');
});

test('★ 数学教师底图是独立锁定层，不进入学生作答与选择命中', () => {
  assert.match(SOURCE, /const starterObjects = new Set/, '没有教师底图对象集合');
  assert.match(SOURCE, /readEntries\(starterData\)\.map\(renderEntry\)/, '教师绘制底图没有单独渲染');
  assert.match(SOURCE, /!starterObjects\.has\(/, '教师底图仍会被学生选中');
  assert.match(SOURCE, /renderAll\(hasSavedMathData \? readEntries\(data\) : \[\]\)/,
    '学生作答仍把数学底图混进可编辑 runtime');
  assert.doesNotMatch(SOURCE, /aria-label="恢复初始图"/, '数学底图不应作为学生可恢复/覆盖的作答数据');
});

test('★ 坐标系与数轴有可拖动的尺寸控制柄、原点 0，并把调整后的尺寸存回作答', () => {
  const renderAt = SOURCE.indexOf("entry.kind === 'coordinateSystem' || entry.kind === 'numberLine'");
  assert.notEqual(renderAt, -1, '找不到坐标工具渲染分支');
  const renderBody = SOURCE.slice(renderAt, SOURCE.indexOf("entry.kind === 'equalMark'", renderAt));
  assert.match(renderBody, /const a = mkHandle\(entry\.a\)/, '坐标工具没有第一个尺寸控制柄');
  assert.match(renderBody, /const b = mkHandle\(entry\.b\)/, '坐标工具没有第二个尺寸控制柄');
  assert.match(renderBody, /points: \[a, b\]/, '选中坐标工具后不会露出两个控制柄');
  assert.match(renderBody, /centerY\(\) - 0\.42, '0'/, '坐标系和数轴没有标出原点 0');
  assert.match(renderBody, /keepHorizontal/, '拖动数轴端点后不能保持水平');

  const snapshotAt = SOURCE.indexOf("if (entry.kind === 'coordinateSystem' || entry.kind === 'numberLine')", SOURCE.indexOf('const snapshot'));
  assert.notEqual(snapshotAt, -1, '快照没有坐标工具分支');
  const snapshotBody = SOURCE.slice(snapshotAt, snapshotAt + 480);
  assert.match(snapshotBody, /item\.points\[0\]\.X\(\)/, '调整后的起点没有存回作答');
  assert.match(snapshotBody, /item\.points\[1\]\.X\(\)/, '调整后的终点没有存回作答');

  const preview = fs.readFileSync(path.resolve(HERE, '..', '..', '..', '..', 'teacher', 'classroom', 'drawing-document-preview.tsx'), 'utf8');
  assert.match(preview, />0<\/text>/, '教师预览没有显示坐标工具的原点 0');
});

test('★ 多图形重建是一次完整刷新事务，切换工具后不能等下一次点击才重新出现', () => {
  const at = SOURCE.indexOf('const renderAll = (entries: MathEntry[]) =>');
  assert.notEqual(at, -1, '找不到 renderAll');
  const body = SOURCE.slice(at, SOURCE.indexOf('/** 画板上现在真正是什么', at));
  assert.match(body, /board\.suspendUpdate\(\)/, '批量清理/重建前没有暂停中间帧');
  assert.match(body, /finally \{[\s\S]*board\.unsuspendUpdate\(\)/,
    '重建完成后没有一次性 fullUpdate，图形会等到下一次点击才出现');
  assert.match(SOURCE, /for \(let objectIndex = objects\.length - 1; objectIndex >= 0; objectIndex -= 1\)/,
    '依赖对象没有按 JSXGraph 建议的创建逆序清理');
});
