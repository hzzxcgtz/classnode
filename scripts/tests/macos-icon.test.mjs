import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from '../lib/project.mjs';
import { macIconBuildOptions } from '../lib/macos-icon.mjs';

test('缺少或旧版图标工具自动回退原图标，有26及更新工具时保留新图标配置', () => {
  const icons = ['icons/32x32.png', 'icons/icon.icns', 'icons/ClassNode.icon'];
  for (const result of [{error:new Error('missing')},{status:1,stdout:''},{status:0,stdout:'bundle-version: 24411'}, {status:0,stdout:'short-bundle-version: 16.4'}]) {
    const options = macIconBuildOptions(icons, () => result);
    assert.match(options.warning, /使用原 macOS 图标继续打包/);
    assert.equal(options.args[0], '--config');
    assert.deepEqual(JSON.parse(options.args[1]), {bundle:{icon:['icons/32x32.png','icons/icon.icns']}});
    assert.deepEqual(icons, ['icons/32x32.png', 'icons/icon.icns', 'icons/ClassNode.icon']);
  }
  for (const version of ['26.0', '26.1', '27.0.1']) {
    assert.deepEqual(macIconBuildOptions(icons, () => ({status:0,stdout:`short-bundle-version: ${version}\n`})), {args:[],warning:null});
  }
  assert.ok(macIconBuildOptions(icons, () => { throw new Error('launch failed'); }).warning);
  assert.deepEqual(macIconBuildOptions(['icons/icon.icns'], () => { throw new Error('should not run'); }), {args:[],warning:null});
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
