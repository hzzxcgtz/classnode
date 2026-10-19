import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../lib/project.mjs';
import { requireMacIconTools } from '../lib/macos-icon.mjs';

test('图标构建预检拒绝缺失、旧版及无法确认版本的工具，接受26及更新版本', () => {
  for (const result of [{error:new Error('missing')},{status:1,stdout:''},{status:0,stdout:'bundle-version: 24411'}, {status:0,stdout:'short-bundle-version: 16.4'}]) {
    assert.throws(() => requireMacIconTools(() => result), /完整 Xcode 26/);
  }
  for (const version of ['26.0', '26.1', '27.0.1']) {
    assert.doesNotThrow(() => requireMacIconTools(() => ({status:0,stdout:`/* com.apple.actool.version */\nshort-bundle-version: ${version}\n`})));
  }
});

test('macOS新图标和传统图标并存，所有图层资产存在且Windows不引用新格式', () => {
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const config = read('src-tauri/tauri.macos.conf.json');
  assert.ok(config.bundle.icon.includes('icons/icon.icns'));
  assert.ok(config.bundle.icon.includes('icons/ClassNode.icon'));
  assert.equal(config.bundle.macOS?.minimumSystemVersion, undefined);
  for (const icon of config.bundle.icon) assert.ok(fs.existsSync(path.join(root, 'src-tauri', icon)));
  const source = read('src-tauri/icons/ClassNode.icon/icon.json');
  for (const group of source.groups) for (const layer of group.layers) {
    assert.ok(fs.existsSync(path.join(root, 'src-tauri/icons/ClassNode.icon/Assets', layer['image-name'])));
    assert.equal(layer.glass, false);
  }
  for (const file of ['src-tauri/tauri.conf.json','src-tauri/tauri.windows.conf.json']) assert.doesNotMatch(JSON.stringify(read(file)), /ClassNode\.icon/);
});
