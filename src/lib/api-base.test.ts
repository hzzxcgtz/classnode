import test from 'node:test';
import assert from 'node:assert/strict';
import { getApiBaseUrl, getClassroomPort } from './api-base.ts';

test('HTTPS student entry keeps API and sockets on its secure origin; HTTP development remains compatible', t => {
  const previous = process.env.NEXT_PUBLIC_API_PORT;
  t.after(() => { Reflect.deleteProperty(globalThis, 'window'); if (previous === undefined) delete process.env.NEXT_PUBLIC_API_PORT; else process.env.NEXT_PUBLIC_API_PORT = previous; });
  process.env.NEXT_PUBLIC_API_PORT = '4001';
  Object.defineProperty(globalThis, 'window', { value: { location: new URL('http://192.168.1.10:4000/classroom/') }, configurable: true });
  assert.equal(getApiBaseUrl(), 'http://192.168.1.10:4001'); assert.equal(getClassroomPort(), '4001');
  Object.defineProperty(globalThis, 'window', { value: { location: new URL('https://192.168.1.10:4003/classroom/') }, configurable: true });
  assert.equal(getApiBaseUrl(), ''); assert.equal(getClassroomPort(), '4003');
  delete process.env.NEXT_PUBLIC_API_PORT;
  assert.equal(getApiBaseUrl(), ''); assert.equal(getClassroomPort(), '4003');
});
