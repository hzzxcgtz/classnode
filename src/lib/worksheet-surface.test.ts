/**
 * 卡片透度（★ 2026-09-27，教师：「增加几档透明度供选择」）。
 *
 * 🔴 这个文件守的是**两条最容易静默出错的规矩**：
 *   ① **默认档必须与改动之前逐像素相同**（卡片 .96 / 任务容器 .90）——
 *      反过来的话，所有历史学习单上的字会一起变淡，而教师没有改过任何设置；
 *   ② **选项表里每一档都要在 `surfaceAlphas` 里接上**。加了第四档却忘了加分支时，
 *      它会**静默落到最后一个 `return`**（= 默认档）：教师选了「极透」而屏幕上一点变化
 *      都没有，两处都不报错。这条用例专门盯它。
 *
 * ⚠️ 本文件跑在 `node --test`（`pnpm test:client`）—— import 必须带 `.ts` 后缀，
 *    且被加载的文件不能有运行时 import。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WORKSHEET_SURFACE,
  WORKSHEET_SURFACE_OPTIONS,
  normalizeWorksheetSurfaceOpacity,
  surfaceAlphas,
} from './worksheet-surface.ts';

test('🔴 默认档 = **改动之前的样子**（卡片 .96 / 任务容器 .90 / 正在写 .98）', () => {
  assert.equal(DEFAULT_WORKSHEET_SURFACE, 'opaque');
  assert.deepEqual(surfaceAlphas(DEFAULT_WORKSHEET_SURFACE), { card: 0.96, container: 0.9, cardActive: 0.98 });
  // ⚠️ 这三个数是 `worksheet.module.css` 里 `.question`（常态与「正在写」）与
  //    `.group[data-container='1']` 原来的字面量，**逐字**搬过来的。
  //    改它们 = 改所有历史学习单的外观。
  assert.equal(surfaceAlphas(DEFAULT_WORKSHEET_SURFACE).cardActive, 0.98, '「正在写」那一档');
});

test('🔴 认不出的值一律回默认档（老数据没有这个字段 ⇒ 屏幕不许变）', () => {
  for (const bad of [undefined, null, '', 'OPAQUE', '极透', 0, 1, {}, [], true]) {
    assert.equal(normalizeWorksheetSurfaceOpacity(bad), 'opaque', JSON.stringify(bad));
  }
  for (const good of ['opaque', 'soft', 'clear']) {
    assert.equal(normalizeWorksheetSurfaceOpacity(good), good);
  }
});

test('🔴 选项表里每一档都必须在 `surfaceAlphas` 里有自己的分支', () => {
  // 加一档只改「联合 + 选项表」的后果：它静默落到默认数值 ⇒ 教师选了那一档、屏幕上毫无变化。
  const pairs = WORKSHEET_SURFACE_OPTIONS.map((option) => JSON.stringify(surfaceAlphas(option.id)));
  assert.equal(
    new Set(pairs).size,
    WORKSHEET_SURFACE_OPTIONS.length,
    '有两档拿到了同一组数值 ⇒ 其中一档没接上（或者重复了）',
  );
  // 阳性对照：选项表本身不是空的，否则上面那条对空集合恒真。
  assert.ok(WORKSHEET_SURFACE_OPTIONS.length >= 2);
});

test('越透的档两个面都更透，且**卡片永远比任务容器更实**（层次不许翻转）', () => {
  // 任务容器比卡片再淡一档是这一页的层次规矩（题目装在任务里，容器是「内嵌块」那一档）。
  // 让两档各自随便取值的后果是「卡片比容器还透明」—— 那时题目看起来浮在任务外面。
  const levels = WORKSHEET_SURFACE_OPTIONS.map((option) => surfaceAlphas(option.id));
  levels.forEach((pair, index) => {
    assert.ok(pair.card > pair.container, `第 ${index + 1} 档：卡片要比容器实`);
    assert.ok(pair.cardActive > pair.card, `第 ${index + 1} 档：「正在写」要比常态更亮`);
    assert.ok(pair.cardActive <= 1, `第 ${index + 1} 档：「正在写」不许超过 1`);
    assert.ok(pair.card > 0 && pair.card <= 1 && pair.container > 0 && pair.container <= 1);
    if (index === 0) return;
    assert.ok(pair.card < levels[index - 1].card, `第 ${index + 1} 档要比上一档更透`);
    assert.ok(pair.container < levels[index - 1].container);
    // ⚠️ 「正在写」也要跟着更透，否则最透那一档上它反而比旁边的常态更不透明（层次反了）。
    assert.ok(pair.cardActive < levels[index - 1].cardActive);
  });
});

test('每一档都有名字与说明 —— 设置面板直接渲染它们', () => {
  for (const option of WORKSHEET_SURFACE_OPTIONS) {
    assert.ok(option.name.length > 0, option.id);
    assert.ok(option.description.length > 0, option.id);
  }
});
