import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWebappPort, webappsRoot } from '../services/webapp-host.js';

test('resolveWebappPort 默认是服务端口 + 1', () => {
  const saved = process.env.CLASSNODE_WEBAPP_PORT;
  delete process.env.CLASSNODE_WEBAPP_PORT;
  assert.equal(resolveWebappPort(4001), 4002);
  assert.equal(resolveWebappPort(3001), 3002);
  if (saved === undefined) delete process.env.CLASSNODE_WEBAPP_PORT;
  else process.env.CLASSNODE_WEBAPP_PORT = saved;
});

test('resolveWebappPort 可被环境变量覆盖', () => {
  const saved = process.env.CLASSNODE_WEBAPP_PORT;
  process.env.CLASSNODE_WEBAPP_PORT = '5555';
  assert.equal(resolveWebappPort(4001), 5555);
  if (saved === undefined) delete process.env.CLASSNODE_WEBAPP_PORT;
  else process.env.CLASSNODE_WEBAPP_PORT = saved;
});

test('resolveWebappPort 忽略非法值（回落到默认）', () => {
  const saved = process.env.CLASSNODE_WEBAPP_PORT;
  process.env.CLASSNODE_WEBAPP_PORT = 'abc';
  assert.equal(resolveWebappPort(4001), 4002);
  process.env.CLASSNODE_WEBAPP_PORT = '70000';  // 超出端口范围
  assert.equal(resolveWebappPort(4001), 4002);
  if (saved === undefined) delete process.env.CLASSNODE_WEBAPP_PORT;
  else process.env.CLASSNODE_WEBAPP_PORT = saved;
});
