import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

interface Upstream {
  version?: string;
  fail?: boolean;
  timeout?: boolean;
  status?: number;
  invalidJson?: boolean;
  delay?: number;
}

interface Scenario {
  rounds: Array<{ gitee: Upstream; github: Upstream }>;
  retry?: boolean;
  concurrent?: boolean;
  proxy?: boolean;
}

// Run the actual route module in a fresh process: an unhandled rejection must
// fail the test, even when the preferred request already returned successfully.
const childScript = `
  import assert from 'node:assert/strict';
  import { createServer } from 'node:http';
  const scenario = JSON.parse(process.argv[1]);
  let round = 0;
  const calls = [];
  AbortSignal.timeout = () => {
    const controller = new AbortController();
    // Give the real loopback proxy room to run under parallel test load.
    setTimeout(() => controller.abort(), scenario.proxy ? 250 : 15);
    return controller.signal;
  };
  let proxyServer = null;
  if (scenario.proxy) {
    proxyServer = createServer((request, response) => {
      const host = request.url.includes('gitee.com') ? 'gitee' : 'github';
      calls.push(host);
      const spec = scenario.rounds[round][host];
      if (spec.timeout) return;
      if (spec.fail) { request.socket.destroy(); return; }
      response.writeHead(spec.status || 200);
      response.end(JSON.stringify({ version: spec.version || '3.0.0' }));
    });
    await new Promise(resolve => proxyServer.listen(0, '127.0.0.1', resolve));
    process.env.https_proxy = 'http://127.0.0.1:' + proxyServer.address().port;
  } else globalThis.fetch = async (url, options) => {
    const host = url.includes('gitee.com') ? 'gitee' : 'github';
    calls.push(host);
    const spec = scenario.rounds[round][host];
    if (spec.timeout) {
      await new Promise((_, reject) => {
        const abort = () => reject(new DOMException('Timed out', 'AbortError'));
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      });
    }
    if (spec.delay) await new Promise(resolve => setTimeout(resolve, spec.delay));
    if (spec.fail) throw new Error(host + ' unavailable');
    return new Response(spec.invalidJson ? '{broken' : JSON.stringify({ version: spec.version || '3.0.0' }), {
      status: spec.status || 200,
    });
  };
  const { checkForUpdateOnStartup } = await import(${JSON.stringify(new URL('../routes/upgrade.js', import.meta.url).href)});
  let firstError = null;
  if (scenario.retry) {
    try { await checkForUpdateOnStartup(); }
    catch (error) { firstError = error.message; }
    assert.ok(firstError, 'first check should fail');
    round = 1;
  }
  const first = checkForUpdateOnStartup();
  const shared = scenario.concurrent ? first === checkForUpdateOnStartup() : null;
  let result = null, error = null;
  try { result = await first; }
  catch (failure) { error = failure.message; }
  // Allow the unused request to fail after the selected one has completed.
  await new Promise(resolve => setTimeout(resolve, 45));
  if (proxyServer) {
    proxyServer.closeAllConnections();
    await new Promise(resolve => proxyServer.close(resolve));
  }
  process.stdout.write('RESULT ' + JSON.stringify({ result, error, firstError, shared, calls }));
`;

function run(scenario: Scenario) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript, JSON.stringify(scenario)], {
    env: { ...process.env, https_proxy: '', http_proxy: '' },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(child.status, 0, `version check crashed or hung: ${child.error ?? ''}\n${child.stdout}\n${child.stderr}`);
  const marker = child.stdout.lastIndexOf('RESULT ');
  assert.ok(marker >= 0, child.stdout);
  return JSON.parse(child.stdout.slice(marker + 7)) as {
    result: { latestVersion: string; hasUpdate: boolean } | null;
    error: string | null;
    firstError: string | null;
    shared: boolean | null;
    calls: string[];
  };
}

const cases: Array<[string, Upstream, Upstream, string | null]> = [
  ['both succeed: prefer Gitee', { version: '3.0.0' }, { version: '4.0.0' }, '3.0.0'],
  ['GitHub fails immediately while Gitee succeeds later', { delay: 25 }, { fail: true }, '3.0.0'],
  ['GitHub fails after Gitee has succeeded', {}, { fail: true, delay: 25 }, '3.0.0'],
  ['Gitee fails: use GitHub', { fail: true }, { version: '4.0.0' }, '4.0.0'],
  ['both fail, GitHub first', { fail: true, delay: 25 }, { fail: true }, null],
  ['both fail, Gitee first', { fail: true }, { fail: true, delay: 25 }, null],
  ['Gitee times out: use GitHub', { timeout: true }, { version: '4.0.0' }, '4.0.0'],
  ['GitHub times out after Gitee succeeds', {}, { timeout: true }, '3.0.0'],
  ['both time out', { timeout: true }, { timeout: true }, null],
  ['Gitee HTTP failure: use GitHub', { status: 503 }, { version: '4.0.0' }, '4.0.0'],
  ['unused GitHub JSON failure does not crash', {}, { invalidJson: true }, '3.0.0'],
  ['Gitee JSON failure: use GitHub', { invalidJson: true }, { version: '4.0.0' }, '4.0.0'],
];

for (const [name, gitee, github, expected] of cases) {
  test(`upgrade: ${name}`, () => {
    const actual = run({ rounds: [{ gitee, github }] });
    if (expected) {
      assert.equal(actual.result?.latestVersion, expected);
      assert.equal(actual.result?.hasUpdate, true);
      assert.equal(actual.error, null);
    } else {
      assert.equal(actual.result, null);
      assert.match(actual.error!, /无法连接到版本服务器/);
    }
    assert.deepEqual(actual.calls.sort(), ['gitee', 'github']);
  });
}

test('upgrade: failed startup check can be retried successfully', () => {
  const actual = run({
    retry: true,
    rounds: [
      { gitee: { fail: true }, github: { fail: true } },
      { gitee: { version: '3.0.0' }, github: { fail: true } },
    ],
  });
  assert.equal(actual.result?.latestVersion, '3.0.0');
  assert.equal(actual.error, null);
  assert.equal(actual.calls.length, 4);
});

test('upgrade: concurrent checks share one in-flight request pair', () => {
  const actual = run({ concurrent: true, rounds: [{ gitee: { delay: 10 }, github: {} }] });
  assert.equal(actual.shared, true);
  assert.equal(actual.calls.length, 2);
});

const proxyCases: Array<[string, Upstream, Upstream, string]> = [
  ['Gitee empty HTTP 204 falls back safely', { status: 204 }, { version: '4.0.0' }, '4.0.0'],
  ['unused GitHub HTTP 204 does not crash', {}, { status: 204 }, '3.0.0'],
  ['Gitee connection failure falls back', { fail: true }, { version: '4.0.0' }, '4.0.0'],
  ['Gitee proxy request times out', { timeout: true }, { version: '4.0.0' }, '4.0.0'],
];

for (const [name, gitee, github, expected] of proxyCases) {
  test(`upgrade proxy: ${name}`, () => {
    const actual = run({ proxy: true, rounds: [{ gitee, github }] });
    assert.equal(actual.result?.latestVersion, expected);
    assert.equal(actual.error, null);
    assert.deepEqual(actual.calls.sort(), ['gitee', 'github']);
  });
}
