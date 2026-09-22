import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createRequire } from 'module';
import {
  findSymlinks,
  hoistSingleRoot,
  removeWebappDir,
  resolveInsideWebappsRoot,
  validateWebappUpload,
  WEBAPP_LIMITS,
  webappRoutes,
} from '../routes/webapps.js';
import { createTeacherSession, requireTeacher } from '../middleware/auth.js';
import { createStudentToken } from '../middleware/student-auth.js';

const f = (path: string, size = 1024) => ({ path, size });

// ── 纯函数：上传校验（brief Step 1）────────────────────────────────────

test('必须有入口 HTML', () => {
  const r = validateWebappUpload([f('style.css'), f('app.js')]);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /入口/);
});

test('单个 index.html 即可通过', () => {
  const r = validateWebappUpload([f('index.html')]);
  assert.deepEqual(r, { ok: true, entry: 'index.html' });
});

test('多个 HTML 时取第一个（按传入顺序），除非给了 entryHint', () => {
  const r = validateWebappUpload([f('a.html'), f('b.html')]);
  assert.deepEqual(r, { ok: true, entry: 'a.html' });
  const r2 = validateWebappUpload([f('a.html'), f('b.html')], 'b.html');
  assert.deepEqual(r2, { ok: true, entry: 'b.html' });
});

test('entryHint 指向不存在的文件时拒绝', () => {
  const r = validateWebappUpload([f('a.html')], 'nope.html');
  assert.equal(r.ok, false);
});

test('拒绝服务端脚本（本模块只做静态托管）', () => {
  for (const bad of ['x.php', 'x.jsp', 'x.asp', 'x.aspx', 'x.cgi', 'x.pl', 'x.py', 'x.rb']) {
    const r = validateWebappUpload([f('index.html'), f(bad)]);
    assert.equal(r.ok, false, `${bad} 应当被拒绝`);
  }
});

test('拒绝扩展名白名单之外的（含无扩展名）', () => {
  const r = validateWebappUpload([f('index.html'), f('evil.exe')]);
  assert.equal(r.ok, false);
  assert.equal(validateWebappUpload([f('index.html'), f('Makefile')]).ok, false);
});

test('白名单内的扩展名一律放行', () => {
  const ok = ['index.html', 's.css', 's.js', 's.mjs', 'd.json', 'i.png', 'i.jpg', 'i.svg',
    'f.woff2', 'f.ttf', 'a.mp3', 'a.mp4', 'w.wasm', 'i.webp', 'i.gif'];
  assert.equal(validateWebappUpload(ok.map((p) => f(p))).ok, true);
});

test('路径穿越一律拒绝（ZIP 里的 ../ 与绝对路径）', () => {
  for (const bad of ['../evil.html', '/etc/passwd', 'a/../../index.html', 'C:\\x.html']) {
    assert.equal(validateWebappUpload([f('index.html'), f(bad)]).ok, false, `${bad} 应被拒绝`);
  }
});

test('三项上限：文件数 / 单文件 / 总量', () => {
  assert.equal(validateWebappUpload(
    [f('index.html'), ...Array.from({ length: 600 }, (_, i) => f(`a${i}.css`))]).ok, false);
  assert.equal(validateWebappUpload([f('index.html', 30 * 1024 * 1024)]).ok, false);
  assert.equal(validateWebappUpload([f('index.html'), f('big.js', 90 * 1024 * 1024)]).ok, false);
});

test('大小写不敏感（.HTML 也是入口）', () => {
  assert.deepEqual(validateWebappUpload([f('INDEX.HTML')]), { ok: true, entry: 'INDEX.HTML' });
});

// ── 入口启发式：优先 index.html（裁定 9）──────────────────────────────
// 「第一个 .html」在 ZIP 路径上其实是「字母序第一个」，而常规站点天然有多个 .html。

test('多个 HTML 时优先挑 index.html，而不是字典序第一个', () => {
  // 常规站点：字典序 about < contact < index，旧行为会判成 about.html ⇒ 学生看到「关于」页
  assert.deepEqual(
    validateWebappUpload([f('about.html'), f('contact.html'), f('index.html')]),
    { ok: true, entry: 'index.html' },
  );
  // 大小写不敏感，与既有 .HTML 的处理一致
  assert.deepEqual(
    validateWebappUpload([f('about.html'), f('INDEX.HTML')]),
    { ok: true, entry: 'INDEX.HTML' },
  );
  // .htm 同属入口后缀
  assert.deepEqual(
    validateWebappUpload([f('about.html'), f('index.htm')]),
    { ok: true, entry: 'index.htm' },
  );
  // 子目录里的 index.html 同样认得（提升没发生时它还在深层）
  assert.deepEqual(
    validateWebappUpload([f('site/about.html'), f('site/index.html')]),
    { ok: true, entry: 'site/index.html' },
  );
});

// ⚠️ 阴性对照：**不能**因为新规则把「没有 index.html 的包」判成没有入口。
test('没有 index.html 时仍退回第一个 .html（阴性对照）', () => {
  assert.deepEqual(
    validateWebappUpload([f('about.html')]),
    { ok: true, entry: 'about.html' },
  );
  assert.deepEqual(
    validateWebappUpload([f('about.html'), f('contact.html')]),
    { ok: true, entry: 'about.html' },
  );
  // 名字里含 index 但不是 index.html，不算入口
  assert.deepEqual(
    validateWebappUpload([f('index-old.html'), f('about.html')]),
    { ok: true, entry: 'index-old.html' },
  );
});

// entryHint 是教师显式指定的，必须压过 index.html 启发式。
test('entryHint 指定的入口优先于 index.html', () => {
  assert.deepEqual(
    validateWebappUpload([f('about.html'), f('index.html')], 'about.html'),
    { ok: true, entry: 'about.html' },
  );
});

// 上限值必须集中在一处导出，否则 T7 的教师端提示会和服务端各写一个数字。
test('WEBAPP_LIMITS 是可导入的常量', () => {
  assert.equal(WEBAPP_LIMITS.maxFiles, 500);
  assert.equal(WEBAPP_LIMITS.maxSingleFileBytes, 25 * 1024 * 1024);
  assert.equal(WEBAPP_LIMITS.maxTotalBytes, 80 * 1024 * 1024);
});

// ── 符号链接闸门 ────────────────────────────────────────────────────

function makeTempRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `cn-webapp-${label}-`));
  return root;
}

test('findSymlinks 能识别文件符号链接与目录符号链接（含嵌套）', () => {
  const root = makeTempRoot('symlink');
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(root, 'OUTSIDE.html'), 'OUTSIDE-LEAKED');
    fs.symlinkSync(path.join(root, 'OUTSIDE.html'), path.join(root, 'link.html'));
    fs.mkdirSync(path.join(root, 'assets'));
    fs.symlinkSync(os.tmpdir(), path.join(root, 'assets', 'dirlink'));

    const links = findSymlinks(root).sort();
    assert.deepEqual(links, ['assets/dirlink', 'link.html']);

    // 阴性对照：把符号链接换成普通文件后，同一个函数必须报空 —— 否则「报出来了」
    // 可能只是它对所有东西都报警，而不是真的识别了符号链接。
    fs.unlinkSync(path.join(root, 'link.html'));
    fs.unlinkSync(path.join(root, 'assets', 'dirlink'));
    fs.writeFileSync(path.join(root, 'link.html'), 'not a link');
    fs.writeFileSync(path.join(root, 'assets', 'dirlink'), 'not a link');
    assert.deepEqual(findSymlinks(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ⚠️ 本用例记录的是一条**实测出来的事实**，不是设计意图：
// safeExtractZip 用 fs.writeFileSync 落盘，于是 ZIP 里 mode=0o120777 的条目会被
// **摊平成普通文件**（内容是链接目标那串文本），根本进不了 webappsRoot。
// 所以「含 symlink 的 ZIP 会被上传路径拒绝」这条断言**不成立** ——
// 拒绝发生在更早的一层（链接压根没被创建出来），而不是在本模块的闸门上。
// 闸门本身由上一个用例（真实符号链接）与 webapp-host 的 T1 结论共同覆盖。
test('实测记录：ZIP 里的符号链接条目会被 safeExtractZip 摊平成普通文件', async () => {
  const root = makeTempRoot('ziptest');
  try {
    const AdmZip = createRequire(import.meta.url)('adm-zip');
    const zipPath = path.join(root, 'evil.zip');
    const zip = new AdmZip();
    zip.addFile('index.html', Buffer.from('<html></html>'));
    // 0o120777 << 16 = 符号链接的 unix mode，存在 external attributes 的高 16 位
    zip.addFile('link.html', Buffer.from('../../OUTSIDE.html'), '', 0o120777 << 16);
    zip.writeZip(zipPath);

    const { safeExtractZip } = await import('../services/upload-security.js');
    const dest = path.join(root, 'dest');
    fs.mkdirSync(dest, { recursive: true });
    safeExtractZip(new AdmZip(zipPath), dest, WEBAPP_LIMITS);

    assert.deepEqual(findSymlinks(dest), [], '解压后不应存在任何符号链接');
    assert.equal(fs.lstatSync(path.join(dest, 'link.html')).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(dest, 'link.html'), 'utf8'), '../../OUTSIDE.html');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── ZIP 多层根目录提升 ───────────────────────────────────────────────

test('唯一顶层项是目录且内含 HTML 时提升一层（教师压缩文件夹的常态）', () => {
  const root = makeTempRoot('hoist');
  try {
    const dest = path.join(root, 'dest');
    fs.mkdirSync(path.join(dest, 'myproject', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'myproject', 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(dest, 'myproject', 'assets', 'app.js'), '1');

    const r = hoistSingleRoot(dest);
    assert.deepEqual(r, { hoisted: true, prefix: 'myproject' });
    assert.equal(fs.existsSync(path.join(dest, 'index.html')), true);
    assert.equal(fs.existsSync(path.join(dest, 'assets', 'app.js')), true);
    assert.equal(fs.existsSync(path.join(dest, 'myproject')), false);

    // 提升后入口必须能在**提升后的树**里被找到 —— 这才是「上传成功且打得开」。
    const files: { path: string; size: number }[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), rel);
        else files.push({ path: rel, size: fs.statSync(path.join(dir, e.name)).size });
      }
    };
    walk(dest, '');
    assert.deepEqual(validateWebappUpload(files), { ok: true, entry: 'index.html' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('多项顶层时不提升（避免把有意义的结构拆散）', () => {
  const root = makeTempRoot('nohoist');
  try {
    const dest = path.join(root, 'dest');
    fs.mkdirSync(path.join(dest, 'site'), { recursive: true });
    fs.mkdirSync(path.join(dest, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'site', 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(dest, 'docs', 'a.md'), 'x');
    assert.deepEqual(hoistSingleRoot(dest), { hoisted: false, prefix: '' });
    assert.equal(fs.existsSync(path.join(dest, 'site', 'index.html')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('唯一顶层项是目录但不含 HTML 时不提升', () => {
  const root = makeTempRoot('nohtml');
  try {
    const dest = path.join(root, 'dest');
    fs.mkdirSync(path.join(dest, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'assets', 'a.css'), 'x');
    assert.deepEqual(hoistSingleRoot(dest), { hoisted: false, prefix: '' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── macOS 元数据清理（登记为 T3 交付内容：不清会把入口判成 AppleDouble 二进制块 ⇒ 白屏）

/**
 * 走真实路由上传一个 zip，返回响应体。
 * 用真 multer + 真解压 + 真落盘，只有 prisma 是 mock —— 清元数据的行为发生在文件系统上，
 * mock 掉文件系统就等于什么都没测。
 */
async function uploadZip(
  t: { after: (fn: () => void) => void },
  dataDir: string,
  zipBuffer: Buffer,
  name: string,
) {
  const harness = createHarness(SAMPLE, 0);
  const app = express();
  app.set('prisma', harness.prisma);
  app.use('/api/webapps', webappRoutes);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address() as AddressInfo;

  const form = new FormData();
  form.append('archive', new Blob([new Uint8Array(zipBuffer)]), 'site.zip');
  form.append('name', name);
  const res = await fetch(`http://127.0.0.1:${address.port}/api/webapps`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json() as Record<string, unknown>, dataDir };
}

/** 把解压目录里的树列成相对路径（排序，便于逐字断言）。 */
function listTree(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(`${rel}/`, ...listTree(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

test('含 __MACOSX 的 ZIP：入口仍是真 HTML，元数据不落盘', async (t) => {
  await withTempDataDir(async (dataDir) => {
    const AdmZip = createRequire(import.meta.url)('adm-zip');
    const zip = new AdmZip();
    zip.addFile('myproject/index.html', Buffer.from('<html>REAL-ENTRY</html>'));
    zip.addFile('myproject/s.css', Buffer.from('body{}'));
    // Finder「压缩」带进来的东西：顶层 __MACOSX/ 与 ._* 的 AppleDouble 块。
    // ⚠️ `._index.html` 也以 .html 结尾，**会参与入口判定** —— 这正是必须清掉的理由。
    zip.addFile('__MACOSX/myproject/._index.html', Buffer.from('\x00\x05\x16\x07MAC-DOUBLE'));
    zip.addFile('__MACOSX/._myproject', Buffer.from('junk'));
    const buf = zip.toBuffer();

    const res = await uploadZip(t, dataDir, buf, '含元数据的包');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.entryPath, 'index.html', '入口必须是真的 index.html（提升 + 清理都生效）');

    const dir = path.join(dataDir, 'webapps', String(res.body.id));
    assert.deepEqual(listTree(dir), ['index.html', 's.css'], '__MACOSX 与 ._* 都不得落盘');
    assert.equal(
      fs.readFileSync(path.join(dir, 'index.html'), 'utf8'),
      '<html>REAL-ENTRY</html>',
      '入口内容必须是真的网页，不是 AppleDouble 块',
    );
  });
});

// 阴性对照：清理逻辑**不能误伤**不含元数据的包。
// 没有这一条，「入口正确」有可能只是碰巧 —— 比如清理顺手把整个 myproject/ 也删了。
test('不含 __MACOSX 的 ZIP：树必须一个文件不少（阴性对照）', async (t) => {
  await withTempDataDir(async (dataDir) => {
    const AdmZip = createRequire(import.meta.url)('adm-zip');
    const zip = new AdmZip();
    zip.addFile('myproject/index.html', Buffer.from('<html>REAL-ENTRY</html>'));
    zip.addFile('myproject/s.css', Buffer.from('body{}'));
    zip.addFile('myproject/assets/app.js', Buffer.from('console.log(1)'));
    zip.addFile('myproject/assets/img/logo.svg', Buffer.from('<svg/>'));

    const res = await uploadZip(t, dataDir, zip.toBuffer(), '干净的包');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.entryPath, 'index.html', '没有元数据可清时，提升与入口判定照常');

    const dir = path.join(dataDir, 'webapps', String(res.body.id));
    assert.deepEqual(
      listTree(dir),
      ['assets/', 'assets/app.js', 'assets/img/', 'assets/img/logo.svg', 'index.html', 's.css'],
      '一个文件都不能少：清理逻辑误伤会让「入口正确」变成碰巧',
    );
  });
});

// ── 删目录前的路径校验（照 agents.ts deleteManagedLogo 手法）───────────

test('删目录前的路径校验：越界一律拒绝，且磁盘不被触碰', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-webapp-guard-'));
  const previous = process.env.CLASSNODE_DATA_DIR;
  process.env.CLASSNODE_DATA_DIR = dataDir;
  try {
    const root = path.join(dataDir, 'webapps');
    fs.mkdirSync(root, { recursive: true });
    // 哨兵：位于 webappsRoot **之外**，任何越界删除都会把它抹掉。
    const sentinel = path.join(dataDir, 'SENTINEL.txt');
    fs.writeFileSync(sentinel, 'must survive');

    const uuid = '11111111-2222-4333-8444-555555555555';
    assert.equal(resolveInsideWebappsRoot(uuid), path.join(root, uuid));

    for (const evil of ['../../etc', '..', '../', '/etc/passwd', 'a/../../b', '', './x']) {
      assert.equal(resolveInsideWebappsRoot(evil), null, `${evil} 必须被拒绝`);
      assert.equal(removeWebappDir(evil), false, `removeWebappDir(${evil}) 必须拒绝`);
    }
    // 形状不对的 id 同样拒绝（防的是「将来某次改成从请求里取目录名」）
    assert.equal(removeWebappDir('not-a-uuid'), false);
    assert.equal(removeWebappDir('../SENTINEL.txt'), false);

    assert.equal(fs.existsSync(sentinel), true, '哨兵文件必须原封不动');
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'must survive');

    // 阳性对照：合法 id 必须**真的**删掉 —— 否则上面的「拒绝」可能只是这个函数从不干活。
    const okDir = path.join(root, uuid);
    fs.mkdirSync(okDir, { recursive: true });
    fs.writeFileSync(path.join(okDir, 'index.html'), '<html></html>');
    assert.equal(removeWebappDir(uuid), true);
    assert.equal(fs.existsSync(okDir), false);
  } finally {
    if (previous === undefined) delete process.env.CLASSNODE_DATA_DIR;
    else process.env.CLASSNODE_DATA_DIR = previous;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// ── 路由层：鉴权与关联删除拦截 ────────────────────────────────────────

function createHarness(webapp: unknown, usageCount = 0, groupMaterialCount = 0) {
  const deleted: unknown[] = [];
  const prisma: Record<string, unknown> = {
    webapp: {
      findUnique: async () => webapp,
      create: async (args: { data: unknown }) => args.data,
      update: async (args: unknown) => { deleted.push({ update: args }); return webapp; },
      delete: async (args: unknown) => { deleted.push({ delete: args }); return webapp; },
      findMany: async () => [],
    },
    classroomWebapp: {
      // 删除守卫用它**数**（`routes/webapps.ts` 的 DELETE 分支仍是 count）。
      count: async () => usageCount,
      // usage 端点用它**取清单**（响应里的 `classrooms`）。
      // ⚠️ 形状必须与端点真实读到的结构一致：`include: { classroom: … }` 出来的是
      // `{ classroom: {...} }` 的包装，不是裸的关联行。桩在这里简化了行数之外的东西
      // （id/title 是编的），但**包装层级不能简化** —— 简化掉的话，端点里
      // `link.classroom.id` 这类取法就会在真库上炸，而这里照样绿。
      findMany: async () => Array.from({ length: usageCount }, (_, index) => ({
        classroom: { id: `classroom-${index + 1}`, title: `课堂${index + 1}`, status: 'active', mode: 'standard' },
      })),
    },
    // 网页在「按组的课堂材料」之后有**两条**关联路径：课堂级（上）与组级（这里，
    // 高级模式每组一份）。删除守卫与 usage 端点都要 union 两者 ——
    // 这个桩缺了这一支时端点是 500（`Cannot read properties of undefined`），
    // 而那正是「漏一处就删出悬空引用」在生产里的形态。
    classroomGroupMaterial: {
      count: async () => groupMaterialCount,
      // ⚠️ 比课堂级那条**多一层包装**：`include: { group: { select: { classroom } } }`
      // 出来的是 `{ group: { classroom: {...} } }`。简化掉这一层，端点里
      // `material.group.classroom.id` 的取法就会在真库上炸而这里照样绿
      // （同上面那条包装层级的告诫）。
      findMany: async () => Array.from({ length: groupMaterialCount }, (_, index) => ({
        group: {
          classroom: { id: `group-classroom-${index + 1}`, title: `小组课堂${index + 1}`, status: 'active', mode: 'advanced' },
        },
      })),
    },
  };
  return { prisma, deleted };
}

function createAuthedApp(prisma: unknown) {
  const app = express();
  app.use(express.json());
  app.set('prisma', prisma);
  app.use('/api/webapps', requireTeacher, webappRoutes);
  return app;
}

async function startServer(
  t: { after: (fn: () => void) => void },
  webapp: unknown,
  usageCount = 0,
  groupMaterialCount = 0,
) {
  const harness = createHarness(webapp, usageCount, groupMaterialCount);
  const server = createServer(createAuthedApp(harness.prisma));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address() as AddressInfo;
  return { ...harness, baseUrl: `http://127.0.0.1:${address.port}` };
}

const WEBAPP_ID = '11111111-2222-4333-8444-555555555555';
const SAMPLE = { id: WEBAPP_ID, name: '光合作用', entryPath: 'index.html', createdAt: new Date(), updatedAt: new Date() };

/** 借 middleware/auth 的会话表造一个真教师 cookie —— 阳性对照不能靠「路由看起来挂了」。 */
function teacherCookie(): string {
  let header = '';
  const res = { setHeader: (name: string, value: string) => { if (name === 'Set-Cookie') header = value; } };
  createTeacherSession(res as unknown as import('express').Response);
  return header.split(';')[0];
}

/** 把 webappsRoot() 指到一个临时目录，并返回该目录。 */
async function withTempDataDir<T>(fn: (dataDir: string) => Promise<T> | T): Promise<T> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-webapp-route-'));
  const previous = process.env.CLASSNODE_DATA_DIR;
  process.env.CLASSNODE_DATA_DIR = dataDir;
  try {
    return await fn(dataDir);
  } finally {
    if (previous === undefined) delete process.env.CLASSNODE_DATA_DIR;
    else process.env.CLASSNODE_DATA_DIR = previous;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// ⚠️ 本用例证明的是「没有给学生开这条通道」：一旦开了，学生就能列出全库网页。
// 阳性对照（同一路径用教师 cookie 必须 200）紧跟在后面 —— 否则一个「所有请求都 401」
// 的错误挂载也会让本用例通过。
test('学生 token 打 GET /api/webapps 必须被拒（401/403）；教师 cookie 必须 200', async (t) => {
  const { baseUrl } = await startServer(t, SAMPLE);
  const token = createStudentToken('classroom-1', 'student-1');
  const studentRes = await fetch(`${baseUrl}/api/webapps`, { headers: { Authorization: `Bearer ${token}` } });
  assert.ok(studentRes.status === 401 || studentRes.status === 403, `期望 401/403，实际 ${studentRes.status}`);

  const teacherRes = await fetch(`${baseUrl}/api/webapps`, { headers: { Cookie: teacherCookie() } });
  assert.equal(teacherRes.status, 200, '阳性对照：教师 cookie 必须能列出网页');
});

test('无凭据打 GET /api/webapps 同样被拒', async (t) => {
  const { baseUrl } = await startServer(t, SAMPLE);
  const res = await fetch(`${baseUrl}/api/webapps`);
  assert.equal(res.status, 401);
});

test('学生 token 打 DELETE /api/webapps/:id 必须被拒，且不触发删除', async (t) => {
  const { baseUrl, deleted } = await startServer(t, SAMPLE);
  const token = createStudentToken('classroom-1', 'student-1');
  const res = await fetch(`${baseUrl}/api/webapps/${WEBAPP_ID}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.ok(res.status === 401 || res.status === 403, `期望 401/403，实际 ${res.status}`);
  assert.deepEqual(deleted, []);
});

test('删除被课堂引用的网页必须 400 + 中文文案，且不删库不删盘', async (t) => {
  await withTempDataDir(async (dataDir) => {
    const dir = path.join(dataDir, 'webapps', WEBAPP_ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');

    const { baseUrl, deleted } = await startServer(t, SAMPLE, 3);
    const usage = await fetch(`${baseUrl}/api/webapps/${WEBAPP_ID}/usage`, { headers: { Cookie: teacherCookie() } });
    // `classrooms` 是新增的课堂清单（卡片上的「关联课堂」入口与「无法删除」弹窗要用）。
    // 逐字段断言而不是只挑一个看：`used`/`classroomCount` 仍必须是删除守卫的判据口径。
    const usageBody = await usage.json() as {
      used: boolean; classroomCount: number;
      classrooms: { id: string; title: string; status: string; mode: string }[];
    };
    assert.equal(usageBody.used, true);
    assert.equal(usageBody.classroomCount, 3);
    assert.equal(usageBody.classrooms.length, 3, JSON.stringify(usageBody));
    assert.deepEqual(usageBody.classrooms.map(row => row.title), ['课堂1', '课堂2', '课堂3']);

    const res = await fetch(`${baseUrl}/api/webapps/${WEBAPP_ID}`, {
      method: 'DELETE',
      headers: { Cookie: teacherCookie() },
    });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.match(body.error, /无法删除/);
    assert.deepEqual(deleted, [], '被引用时绝不能走到删库');
    assert.equal(fs.existsSync(path.join(dir, 'index.html')), true, '被引用时绝不能删盘');
  });
});

test('无人引用的网页：DELETE 删库并删盘（阳性对照）', async (t) => {
  await withTempDataDir(async (dataDir) => {
    const dir = path.join(dataDir, 'webapps', WEBAPP_ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');

    const { baseUrl, deleted } = await startServer(t, SAMPLE, 0);
    const res = await fetch(`${baseUrl}/api/webapps/${WEBAPP_ID}`, {
      method: 'DELETE',
      headers: { Cookie: teacherCookie() },
    });
    assert.equal(res.status, 200);
    assert.equal(deleted.length, 1, '无人引用时必须删库');
    assert.equal(fs.existsSync(dir), false, '无人引用时必须删盘');
  });
});

/**
 * 🔴 只被**组级材料**引用的网页（高级模式每组一份）：同样删不掉。
 *
 * 夹具里课堂级关联是 **0**（`usageCount = 0`），唯一挡住删除的是组级那一支 ——
 * 所以「只查 `ClassroomWebapp`」的实现会让这条 404/200 地放开删除，
 * 留下一行读不到的 `targetId`（多态、没有真外键，数据库不会拦）。
 * 上一节的阳性对照（`usageCount = 0` 时删得掉）保证这条红的不是别的原因。
 */
test('🔴 只被组级材料引用的网页：usage 的 used 为真、DELETE 被 400 拦下', async (t) => {
  await withTempDataDir(async (dataDir) => {
    const dir = path.join(dataDir, 'webapps', WEBAPP_ID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');

    // usageCount = 0（课堂级一条都没有），groupMaterialCount = 1（组级一行）。
    const { baseUrl, deleted } = await startServer(t, SAMPLE, 0, 1);

    const usage = await fetch(`${baseUrl}/api/webapps/${WEBAPP_ID}/usage`, { headers: { Cookie: teacherCookie() } });
    const usageBody = await usage.json() as { used: boolean; classroomCount: number; classrooms: { title: string }[] };
    assert.equal(usageBody.used, true, `组级引用也算「被使用」：${JSON.stringify(usageBody)}`);
    assert.equal(usageBody.classroomCount, 1);
    assert.deepEqual(usageBody.classrooms.map(row => row.title), ['小组课堂1']);

    const res = await fetch(`${baseUrl}/api/webapps/${WEBAPP_ID}`, {
      method: 'DELETE',
      headers: { Cookie: teacherCookie() },
    });
    assert.equal(res.status, 400, '只被组级材料引用的网页必须删不掉');
    const body = await res.json() as { error: string };
    assert.match(body.error, /无法删除/);
    // 文案要念出「小组」那一项 —— 网页这一侧从一条路径变成两条，教师得知道
    // 是谁在挡（去课堂里改那个小组的配置，而不是去找课堂级关联）。
    assert.match(body.error, /小组/);
    assert.deepEqual(deleted, [], '被引用时绝不能走到删库');
    assert.equal(fs.existsSync(path.join(dir, 'index.html')), true, '被引用时绝不能删盘');
  });
});
