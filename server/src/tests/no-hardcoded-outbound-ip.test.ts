/**
 * 🔴 **`server/src` 里不许出现「指向裸公网 IP 的外发地址」。**
 *
 * 立这条规矩的由头（2026-10-09 审计 §B30，教师当天拍板「`ping` 整个删掉」）：
 * `services/ping.ts` 在**每一次服务启动**时向一个硬编码的公网 IP
 * （`http://114.55.178.166:20601/ping`）**明文**上报：持久设备 ID（`Setting` 表里的
 * `instance_id`，每台机器一个、跨重启不变）、版本、平台、以及四种智能体的**数量**。
 *   · 文档（`CLAUDE.md`）写着「opt-in via setting」，而那个设置**全仓零引用** ——
 *     唯一真正的开关是 `NODE_ENV === 'development'`，也就是说**所有真实用户的每一次启动都在报**；
 *   · 数据是**明文 GET + query string**，没有 TLS，中间任何一跳都看得到。
 * 对一个装在中小学教室里的产品，这属于「学生隐私边界」那一类，所以整条路被删掉。
 *
 * 删掉一件事之后，**唯一能防止它以另一个名字回来**的东西就是一条能判定的规矩：
 * 外发地址要么是域名（可审、可换、有 TLS），要么是本机/内网（写死 IP 是合理的）。
 * ⚠️ 它**不**检查域名那一侧（`gitee.com` / `api.coze.cn` 都是正当的），
 * 也不检查「有没有外发」—— 只回答一个问题：**有没有指向裸公网 IP 的那一种**。
 *
 * ```bash
 * node --test dist/tests/no-hardcoded-outbound-ip.test.js   # 由 `pnpm test:server` 跑到
 * ```
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 从 `server/dist/tests/` 往上找**源码树**。
 *
 * 🔴 不能 `path.resolve(HERE, '..')` —— 编译后那是 `server/dist`，而下面的 `collect` 只收 `.ts`
 *    ⇒ **一个文件都没扫**、用例空着就绿（`agent-config-single-source.test.ts` 的头注释记着这个
 *    真实事故）。锚点用一个**必然存在**的源文件，别数 `..` 的层数。
 */
function findServerSrc(): string {
  let dir = HERE;
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(dir, 'src');
    if (fs.existsSync(path.join(candidate, 'services', 'ai-proxy.ts'))) return candidate;
    dir = path.resolve(dir, '..');
  }
  throw new Error('找不到 server/src —— 定位逻辑失效了，用例必须报错而不是空扫一遍');
}
const SERVER_SRC = findServerSrc();

/**
 * 去掉注释：说明里会**引用**被禁的写法，不去掉会自己把自己扫红。
 *
 * 🔴 **不能照搬本仓别处那个 `//[^\n]*`** —— 本用例扫的正是 URL，而 URL 里就有 `//`
 * （`http://…`）：那条正则会把地址**连头一起吃掉**，于是扫描器对**唯一的那个真阳性**瞎掉，
 * 而主用例**空着就绿**。这不是推演 —— 本文件第一次跑起来时，正是下面那条阳性对照报了
 * 「扫描器认不出那个地址」，主用例却已经绿了。
 * ⇒ 只把**前面不是 `:`** 的 `//` 当作注释开头（`http://` 因此保得住）。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** 外发地址 + 一个 IPv4 字面量。域名（`https://gitee.com`）与 `w3.org` 这类都不匹配。 */
const IP_URL = /https?:\/\/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/;

/**
 * 这个 IP 是**本机 / 内网 / 链路本地 / 保留**地址吗。
 *
 * 这些写死是**正当**的：`127.0.0.1`（文心上传走本机中转）、`0.0.0.0`（监听）、
 * `192.168.x` / `10.x`（教室里的局域网服务）。公网地址才是问题。
 */
function isLocal(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** 扫一段源码，返回其中所有**指向裸公网 IP** 的地址。 */
function publicIpUrls(source: string): string[] {
  const hits: string[] = [];
  for (const match of stripComments(source).matchAll(new RegExp(IP_URL.source, 'g'))) {
    const ip = `${match[1]}.${match[2]}.${match[3]}.${match[4]}`;
    if (!isLocal(ip)) hits.push(match[0]);
  }
  return hits;
}

test('阳性对照：扫描器认得出那个被删掉的地址，也放得过本机 / 内网地址', () => {
  // 🔴 没有这一条，把正则改坏（比如忘了 `g`）也能让下面那条全绿。
  assert.deepEqual(publicIpUrls("const PING_URL = 'http://114.55.178.166:20601/ping';"),
    ['http://114.55.178.166'], '扫描器认不出那个地址 ⇒ 下面那条是空的');
  for (const allowed of [
    "http://127.0.0.1:4001/x",
    "http://0.0.0.0:4001",
    'http://192.168.1.5:4001',
    'http://10.0.0.7',
    'http://172.16.3.9',
    'https://gitee.com/api',
    'https://api.coze.cn/v3/chat',
  ]) {
    assert.deepEqual(publicIpUrls(allowed), [], `这条不该被拦：${allowed}`);
  }
  // ⚠️ 注释里出现不算（本文件与源码里都会引用被禁的写法当说明）。
  assert.deepEqual(publicIpUrls("// 从前：http://114.55.178.166:20601/ping"), []);
});

test('🔴 `server/src` 里没有指向裸公网 IP 的外发地址', () => {
  const files = collect(SERVER_SRC);
  // 扫到东西的阳性对照（就是它抓出过「扫了 0 个文件却全绿」那个假绿）。
  assert.ok(files.length > 20, `只扫到 ${files.length} 个源文件 —— 定位错了，这条用例是空的`);

  const offenders: string[] = [];
  for (const file of files) {
    for (const url of publicIpUrls(fs.readFileSync(file, 'utf8'))) {
      offenders.push(`${path.relative(SERVER_SRC, file)}: ${url}`);
    }
  }
  assert.deepEqual(offenders, [],
    `发现指向裸公网 IP 的外发地址：\n  ${offenders.join('\n  ')}\n`
    + '（域名可以审、可以换、有 TLS；写死一个公网 IP 只会在换服务器那天静默失效，'
    + '而且没法在代码评审里看出它是谁。2026-10-09 删掉 `ping` 就是为了这一类。）');
});
