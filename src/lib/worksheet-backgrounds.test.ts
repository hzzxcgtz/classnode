import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_WORKSHEET_BACKGROUND,
  WORKSHEET_BACKGROUND_OPTIONS,
  normalizeWorksheetBackgroundTheme,
  resolveWorksheetBackground,
} from './worksheet-backgrounds.ts';

test('十套插画主题都有唯一 id 与 WebP 资源，无背景选项不加载图片', () => {
  const illustrated = WORKSHEET_BACKGROUND_OPTIONS.filter(option => option.id !== 'none');
  assert.equal(illustrated.length, 10);
  assert.equal(new Set(WORKSHEET_BACKGROUND_OPTIONS.map(option => option.id)).size, WORKSHEET_BACKGROUND_OPTIONS.length);
  illustrated.forEach(option => assert.match(option.url ?? '', /^\/worksheet-backgrounds\/.+\.webp$/));
  assert.equal(WORKSHEET_BACKGROUND_OPTIONS.find(option => option.id === 'none')?.url, null);
});

test('背景主题归一化：合法值原样保留，坏值回落到默认主题', () => {
  assert.equal(normalizeWorksheetBackgroundTheme('ocean-observation'), 'ocean-observation');
  assert.equal(normalizeWorksheetBackgroundTheme('custom'), 'custom');
  assert.equal(normalizeWorksheetBackgroundTheme('未知主题'), DEFAULT_WORKSHEET_BACKGROUND);
  assert.equal(normalizeWorksheetBackgroundTheme(null), DEFAULT_WORKSHEET_BACKGROUND);
});

test('自定义主题读取上传地址，预设主题不受旧自定义地址干扰', () => {
  assert.equal(resolveWorksheetBackground('custom', '/uploads/chat/example.webp'), '/uploads/chat/example.webp');
  assert.equal(resolveWorksheetBackground('custom', null), null);
  assert.equal(resolveWorksheetBackground('cloud-playground', '/uploads/chat/old.webp'), '/worksheet-backgrounds/cloud-playground.webp');
  assert.equal(resolveWorksheetBackground('none', '/uploads/chat/old.webp'), null);
});
