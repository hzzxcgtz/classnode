/**
 * ★ M7（独立审查抓到）：分析浮层那句「**是不是 404**」的判断。
 *
 * 为什么值得一条用例：浮层原先写的是 `catch {}` —— 把**一切**异常都当成「还没算过」，
 * 于是网络断 / 500 / 库坏都会**触发一次 POST**（会写库），而教师看到的是第二次调用的错误、
 * 第一次的真因被丢掉。修法就落在 `isNotFound` 这一个判断上。
 *
 * ⚠️ **这条用例测的是那个判断，不是 `api.ts` 的接线。** `api.ts` 里全是无扩展名的 import，
 * 前端 runner 加载不了它（`Cannot find module '…/src/lib/api-base'`）——
 * 所以「`request` 失败时真的抛 `HttpError` 且带上 `res.status`」那一步**没有自动化网**，
 * 只靠代码评审（它就一行，在 `request` 的 `if (!res.ok)` 里）。
 * 把它写在这里，是为了不让人以为这条用例覆盖了整条链。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, isNotFound } from './http-error.ts';

test('★ 只有 404 算「还没有」（浮层据此才去 POST；其余一律如实报错）', () => {
  assert.equal(isNotFound(new HttpError('这道题还没有生成过分析', 404)), true);
  assert.equal(isNotFound(new HttpError('生成分析载荷失败', 500)), false, '500 不是「还没有」—— 不许改写');
  assert.equal(isNotFound(new HttpError('', 403)), false);
  assert.equal(isNotFound(new HttpError('', 400)), false);
});

test('★ 不是 HttpError 的异常一律为假（网络断、fetch 自己抛的 TypeError 都不算 404）', () => {
  assert.equal(isNotFound(new Error('Failed to fetch')), false);
  assert.equal(isNotFound(new TypeError('fetch failed')), false);
  assert.equal(isNotFound(null), false);
  assert.equal(isNotFound(undefined), false);
  assert.equal(isNotFound('404'), false, '字符串 "404" 不是 404');
  assert.equal(isNotFound(404), false, '数字 404 也不是 —— 判据是那个错误对象，不是它的值');
  assert.equal(isNotFound({ status: 404 }), false, '长得像不算 —— 必须是 HttpError');
});

test('反证：把判据放宽成「有 status 就算」⇒ 上一条必须红', () => {
  // 不真改源码：把同一套输入喂给一个「宽松版」判据，看它会不会放过不该放的。
  const loose = (e: unknown) => (e as { status?: number } | null)?.status === 404;
  assert.equal(loose({ status: 404 }), true, '宽松版确实会放行一个普通对象');
  assert.equal(isNotFound({ status: 404 }), false, '而严格的判据不放行 —— 这就是两条的分歧点');
});

test('HttpError 是 Error 的子类（既有那些 `e instanceof Error` 的 catch 不受影响）', () => {
  const e = new HttpError('boom', 404);
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'HttpError');
  assert.equal(e.message, 'boom');
  assert.equal(e.status, 404);
});
