import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ArchiveError, archiveKindOf, parseSevenZipListing, safeExtractArchive } from '../services/archive-extract.js';

/**
 * 真实抓取：`7z-wasm` 对 `server/src/tests/fixtures/small-rar3.rar` 跑
 * `callMain(['l','-slt','-ba','/in/a'])` 的输出的**节选**。
 *
 * ⚠️ **是节选不是逐字** —— 初稿说成「逐字」是假的，独立复核对过真实输出：每个块里还有
 *    `Modified` / `Created` / `Accessed` / `Solid` / `Commented` / `Split Before` / `Split After` / `CRC` / `Host OS` / `Method` / `Version` / `Volume Index`
 *    等十几行。**结构是真的、字段是筛过的**；解析结果与真实输出一致（3 / 48 / 20）。
 *
 * ⚠️ 块以空行分隔；目录块是 `Folder = +`；文件块是 `Folder = -`。
 * ⚠️ 这份是全 ASCII 的，所以看不到那个已知问题：**含非 ASCII 路径时这段文本会乱码**
 *   （实测 `图片` → `￥ﾛﾾ￧ﾉﾇ`）。这正是「路径一律不从列表读」这条纪律的来由。
 */
const SEVEN_ZIP_LISTING_RAR3 = [
  'Path = test.txt\nFolder = -\nSize = 20\nPacked Size = 20\nEncrypted = -\n',
  'Path = testlink\nFolder = -\nSize = 8\nPacked Size = 8\nEncrypted = -\n',
  'Path = testdir/test.txt\nFolder = -\nSize = 20\nPacked Size = 20\nEncrypted = -\n',
  'Path = testdir\nFolder = +\nSize = 0\nAttributes = D\nEncrypted = -\n',
  'Path = testemptydir\nFolder = +\nSize = 0\nAttributes = D\nEncrypted = -\n',
].join('\n');

test('archiveKindOf：三种后缀都认，大小写不敏感', () => {
  for (const name of ['a.zip', 'a.ZIP', 'A.Rar', 'a.7Z']) {
    assert.notEqual(archiveKindOf(name), null, `${name} 应当被认出来`);
  }
  assert.equal(archiveKindOf('a.zip'), 'zip');
  assert.equal(archiveKindOf('a.rar'), 'rar');
  assert.equal(archiveKindOf('a.7z'), '7z');
});

test('archiveKindOf：认不出的回 null（不抛错）', () => {
  for (const name of ['a.tar', 'a.gz', 'a', 'a.html', '']) {
    assert.equal(archiveKindOf(name), null, `${name} 不该被认成压缩包`);
  }
});

test('parseSevenZipListing：目录不计入文件数', () => {
  // ⚠️ 用例名是**「文件数」不是「文件数与体积」** —— T2 复核变异过：删掉排除目录那一行，
  //    下面两条体积断言**照样通过**，因为捕获到的真实输出里目录块的 `Size` 就是 0。
  //    真正拦住目录的只有 `fileCount === 3` 这一条。**别把这个名字改回去。**
  const r = parseSevenZipListing(SEVEN_ZIP_LISTING_RAR3);
  assert.equal(r.fileCount, 3, 'test.txt / testlink / testdir/test.txt 三个文件，两个目录不算');
  assert.equal(r.declaredTotalBytes, 48, '20 + 8 + 20');
  assert.equal(r.declaredMaxFileBytes, 20);
  assert.equal(r.encrypted, false);
});

test('parseSevenZipListing：阳性对照 —— 认得出一条 Encrypted = +', () => {
  const text = 'Path = a.txt\nFolder = -\nSize = 5\nEncrypted = +\n';
  const r = parseSevenZipListing(text);
  assert.equal(r.encrypted, true, '加密标记读不出来 ⇒ 加密包会一路走到解压那一步');
  assert.equal(r.fileCount, 1, '同一条也要照常计入文件数（否则阳性对照只证明了一个字段）');
});

test('parseSevenZipListing：空输入回全零，不抛错', () => {
  assert.deepEqual(parseSevenZipListing(''), { fileCount: 0, declaredTotalBytes: 0, declaredMaxFileBytes: 0, encrypted: false });
});

test('★ CRLF 输入必须解析出与 LF 完全相同的结果（否则会静默返回全零、放行一切体积）', () => {
  // T2 复核实测出来的洞：`\r\n` 下 `'\n\n'` 不出现，整份输出塌成一个块、命中 `Folder = +`，
  // 于是返回全零 —— 而全零能静默通过每一条 declared-size 限值。
  const crlf = SEVEN_ZIP_LISTING_RAR3.replace(/\n/g, '\r\n');
  assert.deepEqual(
    parseSevenZipListing(crlf),
    parseSevenZipListing(SEVEN_ZIP_LISTING_RAR3),
    'CRLF 解析结果与 LF 不一致 —— 归一化那一步没生效',
  );
  // 阳性对照：上面那条断言不能靠「两边都返回全零」蒙过去。
  assert.equal(parseSevenZipListing(crlf).fileCount, 3, 'CRLF 下解析出全零 ⇒ 体积闸门被静默绕过');
});

test('★ 裸 CR（\\r）输入同样不能塌成全零', () => {
  // 与 CRLF 同一个机理：`'\n\n'` 不出现 ⇒ 整份输出塌成一个块 ⇒ 命中 `Folder = +` ⇒ 全零。
  const bareCR = SEVEN_ZIP_LISTING_RAR3.replace(/\n/g, '\r');
  assert.equal(parseSevenZipListing(bareCR).fileCount, 3, '裸 CR 下解析出全零 ⇒ 体积闸门被静默绕过');
});

const LIMITS = { maxFiles: 500, maxTotalBytes: 80 * 1024 * 1024, maxSingleFileBytes: 25 * 1024 * 1024 };

/** 把 zip 落到一个临时文件上，返回它的路径。`safeExtractArchive` 收的是**路径**（multer 的落盘产物）。 */
function writeTempArchive(zip: { toBuffer(): Buffer }, name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, zip.toBuffer());
  return file;
}

function makeZip(entries: Record<string, string>) {
  const AdmZip = createRequire(import.meta.url)('adm-zip');
  const zip = new AdmZip();
  for (const [p, content] of Object.entries(entries)) zip.addFile(p, Buffer.from(content));
  return zip;
}

test('zip 分支：正常包解出正确的树，返回 kind = zip', async () => {
  const source = writeTempArchive(makeZip({ 'index.html': '<h1>hi</h1>', 'css/s.css': 'body{}' }), 'site.zip');
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-out-'));
  const r = await safeExtractArchive({ sourcePath: source, originalName: 'site.zip', destination: dest, limits: LIMITS });
  assert.equal(r.kind, 'zip');
  assert.equal(fs.readFileSync(path.join(dest, 'index.html'), 'utf8'), '<h1>hi</h1>');
  assert.equal(fs.readFileSync(path.join(dest, 'css/s.css'), 'utf8'), 'body{}');
});

test('★ safeExtractZip 的拒绝必须被包成 ArchiveError（不然教师收到 500 而不是 400）', async () => {
  // ⚠️ 这条测的是**集成**，不是 safeExtractZip 本身 —— 它自己的拒绝行为由
  //    `upload-security.test.ts:25` 用桩对象覆盖（含 `../` 那条）。这里只问一件事：
  //    zip 分支抛出来的，是不是调用方能据以回 400 的那个类型。
  //
  // ⚠️ 为什么不用 `../` 条目来触发：**`AdmZip.addFile` 会自己把 `../` 规范化掉**
  //    （实测：`addFile('../escape.html')` 读回来是 `escape.html`），所以用 AdmZip 的 API
  //    根本造不出带 `..` 的条目。要造得出就只能手拼 zip 字节或落一个 fixture ——
  //    为了测「异常类型有没有被包一层」不值这个代价。（实测过：AdmZip **读**的时候
  //    是保留 `../` 的，所以那条判据在真实恶意包上仍然是活的，不是死代码。）
  const zip = makeZip({ 'index.html': '<h1>hi</h1>', 'big.bin': 'x'.repeat(4096) });
  const source = writeTempArchive(zip, 'toobig.zip');
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-out-'));
  await assert.rejects(
    () => safeExtractArchive({
      sourcePath: source, originalName: 'toobig.zip', destination: dest,
      limits: { ...LIMITS, maxSingleFileBytes: 1024 },   // 逼 safeExtractZip 抛「过大的单个文件」
    }),
    (error: unknown) => {
      assert.ok(error instanceof ArchiveError, `必须是 ArchiveError（回 400），实际是 ${String(error)}`);
      return true;
    },
  );
});

test('zip 分支：不是 zip 的文件 ⇒ ArchiveError，且文案不误导', async () => {
  // Review Focus 第 4 条：一个 rar 改名成 .zip 会走到这条路上来。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-'));
  const source = path.join(dir, 'notreally.zip');
  fs.writeFileSync(source, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-out-'));
  await assert.rejects(
    () => safeExtractArchive({ sourcePath: source, originalName: 'notreally.zip', destination: dest, limits: LIMITS }),
    (error: unknown) => {
      assert.ok(error instanceof ArchiveError);
      assert.match(error.message, /ZIP/, '文案要点名 ZIP —— 说「不支持的文件类型」会让教师去改后缀');
      return true;
    },
  );
});

test('认不出的后缀 ⇒ ArchiveError', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-'));
  const source = path.join(dir, 'a.tar');
  fs.writeFileSync(source, Buffer.from('x'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-out-'));
  await assert.rejects(
    () => safeExtractArchive({ sourcePath: source, originalName: 'a.tar', destination: dest, limits: LIMITS }),
    (error: unknown) => error instanceof ArchiveError,
  );
});

/**
 * 造一个**加密的 `.7z`**（口令 `hunter2`）。用 7z-wasm 自己压 —— 不依赖系统装没装 7z。
 *
 * 🔴 **后缀必须是 `.7z`，不能是 `.zip`。** `safeExtractArchive` 按后缀分派：叫 `enc.zip`
 * 就会走 AdmZip 那条路，于是这条用例「通过」却**根本没碰 7z-wasm 的加密检测** —— 假绿。
 *
 * `mode` 的两种取值对应**两条不同的拒绝路径**（两条都实测过，见下表）：

 *   · `'content'`（默认，不给 `-mhe`）：清单**读得出来**（返回码 0），条目标 `Encrypted = +`
 *     ⇒ 走 `assertWithinLimits` 里「不支持带密码的压缩包」那一条。
 *   · `'header'`（`-mhe=on`，头部也加密）：清单**根本读不出来**，`callMain` **抛一个裸数字**
 *     （实测 `262704`）⇒ 走「压缩包读不了」那一条。
 */
async function makeEncryptedArchive(mode: 'content' | 'header'): Promise<string> {
  const SevenZip = createRequire(import.meta.url)('7z-wasm');
  const sz = await SevenZip({ stdout() {}, stderr() {} });
  sz.FS.mkdir('/w'); sz.FS.chdir('/w');
  sz.FS.writeFile('/w/secret.txt', 'top secret');
  const args = ['a', '-phunter2'];
  if (mode === 'header') args.push('-mhe=on');
  args.push('/w/enc.7z', '/w/secret.txt');
  sz.callMain(args);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-'));
  const file = path.join(dir, 'enc.7z');
  fs.writeFileSync(file, Buffer.from(sz.FS.readFile('/w/enc.7z')));
  return file;
}

const RAR_FIXTURE = path.join(import.meta.dirname, '../../src/tests/fixtures/small-rar3.rar');

test('rar：真实样本能解，中文/嵌套无关的树逐条对上', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-out-'));
  const r = await safeExtractArchive({ sourcePath: RAR_FIXTURE, originalName: 'small.rar', destination: dest, limits: LIMITS });
  assert.equal(r.kind, 'rar');
  assert.equal(fs.readFileSync(path.join(dest, 'test.txt'), 'utf8').length, 20);
  assert.equal(fs.readFileSync(path.join(dest, 'testdir/test.txt'), 'utf8').length, 20);
  // ⚠️ 软链条目 `testlink` 在 **7z-wasm 这条路上**出来必须是**普通文件**（内容 = 链接目标），
  //    不能是真软链。⚠️ **但这是一次观察，不是 7-Zip 的契约** —— 本机原生 `7zz` 26.03 解同一个
  //    样本得到的是真软链。所以这条断言钉的是**当前这个 wasm 构建的行为**；它一旦变，
  //    兜底的是 `walkExtracted` 里那个 lstat 判据（那才是主保证，见 Task 5）。
  const st = fs.lstatSync(path.join(dest, 'testlink'));
  assert.equal(st.isSymbolicLink(), false, '软链穿透到真实磁盘了 —— 静态服务会跟随它');
  assert.equal(st.isFile(), true);
});

test('加密包（内容加密）：清单读得出、条目标了 Encrypted ⇒ 拒，且说得出「密码」', async () => {
  const source = await makeEncryptedArchive('content');
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-out-'));
  await assert.rejects(
    () => safeExtractArchive({ sourcePath: source, originalName: 'enc.7z', destination: dest, limits: LIMITS }),
    (error: unknown) => {
      assert.ok(error instanceof ArchiveError, `要 ArchiveError（回 400），实际是 ${String(error)}`);
      assert.match(error.message, /密码/, '文案要说出是密码的问题，不然教师只会反复重传');
      return true;
    },
  );
});

test('加密包（头部加密）：清单根本读不出来 ⇒ 拒，且不冒泡成 500', async () => {
  // 这条路实测是 `callMain` **抛一个裸数字**（262704）—— 不 catch 就是个 500。
  const source = await makeEncryptedArchive('header');
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-out-'));
  await assert.rejects(
    () => safeExtractArchive({ sourcePath: source, originalName: 'enc.7z', destination: dest, limits: LIMITS }),
    (error: unknown) => {
      assert.ok(error instanceof ArchiveError, `要 ArchiveError（回 400），实际是 ${String(error)}`);
      assert.match(error.message, /加密|损坏/, '头部加密的包要说得出「读不了」的可能原因');
      return true;
    },
  );
});

test('★ 超总量的包：**在解压之前**就拒，而且目标目录一个字节都没落', async () => {
  // 🔴 三条要点：
  //   ① 后缀必须是 `.7z` —— 叫 `bomb.zip` 就会走 AdmZip 那条路，**假绿**：它照样抛
  //      ArchiveError（safeExtractZip 也有体积闸门），但「先列表再解压」这个顺序根本没被测到。
  //   ② 文案要钉住「总体积过大」：解压后才判体积会走到另一条拒绝（`实际内容大于清单声明`）。
  //   ③ 🔴 **必须同时有内存判据 —— 这条初稿写反了。** 初稿说「判据是目标目录为空，
  //      不是内存涨了多少，因为内存阈值是概率性的」。**独立复核实测证伪了它**：把体积闸门
  //      从 `x` 之前挪到之后，`dest` 判据与断言**全部照样通过** —— 因为解压落在 wasm 的内存
  //      FS 里，目标目录根本看不见。那道闸门是 80MB 压缩包与实测 ~800MB 内存事件之间唯一的
  //      东西，而初稿那条用例在它本该挡住的变异下**不会红**。
  const SevenZip = createRequire(import.meta.url)('7z-wasm');
  const sz = await SevenZip({ stdout() {}, stderr() {} });
  sz.FS.mkdir('/w'); sz.FS.chdir('/w');
  sz.FS.writeFile('/w/big.bin', new Uint8Array(40 * 1024 * 1024));
  sz.FS.writeFile('/w/index.html', '<h1>oversize</h1>');
  sz.callMain(['a', '-t7z', '/w/big.7z', '/w/big.bin', '/w/index.html']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-'));
  const source = path.join(dir, 'big.7z');
  fs.writeFileSync(source, Buffer.from(sz.FS.readFile('/w/big.7z')));

  const before = process.memoryUsage().rss;
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-out-'));
  await assert.rejects(
    () => safeExtractArchive({
      sourcePath: source, originalName: 'big.7z', destination: dest,
      // ⚠️ 单个文件的上限**故意放宽到 100MB**：这样先命中的必然是「总体积」那一条，
      //    否则 40MB 会先撞上单文件闸门（默认 25MB），测的就不是这条用例名字说的那件事了。
      limits: { maxFiles: 500, maxTotalBytes: 1024 * 1024, maxSingleFileBytes: 100 * 1024 * 1024 },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ArchiveError, `要 ArchiveError，实际是 ${String(error)}`);
      // ⚠️ **光断言类型是不够的，这条会假绿。** Task 3 留的占位也抛 `ArchiveError`
      //    （`7Z 支持还没做`），于是「只查类型」的版本在 T4 实现之前就是绿的。
      assert.match(error.message, /总体积过大/, '要看到「第一关」那条体积闸门的文案');
      return true;
    },
  );
  assert.deepEqual(fs.readdirSync(dest), [], '拒绝之前落过盘 ⇒ 它是先解压再判体积的，顺序反了');

  // 🔴 **真正守住那个顺序的是这一条**（`dest` 判据看不见 wasm 内存 FS 里发生过什么）。
  //    40MB 展开在 wasm 里约吃 10x（实测比例）⇒ 若它先解压了，这里会看到数百 MB 的增长。
  const grew = (process.memoryUsage().rss - before) / 1024 / 1024;
  assert.ok(
    grew < 200,
    `拒一个超总量的包吃掉了 ${grew.toFixed(0)}MB —— 说明它**先解压了再判体积**，顺序反了`,
  );
});

test('加密的 zip ⇒ 中文文案说得出「密码」，不是 ADM-ZIP 的英文原文', async () => {
  // 独立复核实测：加密 zip 会以 `压缩包解压失败：ADM-ZIP: Incompatible password parameter`
  // 返回 —— 400 是对的，但把一个英文库内部串端给教师看不是。
  const SevenZip = createRequire(import.meta.url)('7z-wasm');
  const sz = await SevenZip({ stdout() {}, stderr() {} });
  sz.FS.mkdir('/w'); sz.FS.chdir('/w');
  sz.FS.writeFile('/w/secret.txt', 'top secret');
  sz.callMain(['a', '-phunter2', '/w/enc.zip', '/w/secret.txt']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-'));
  const source = path.join(dir, 'enc.zip');
  fs.writeFileSync(source, Buffer.from(sz.FS.readFile('/w/enc.zip')));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-out-'));
  await assert.rejects(
    () => safeExtractArchive({ sourcePath: source, originalName: 'enc.zip', destination: dest, limits: LIMITS }),
    (error: unknown) => {
      assert.ok(error instanceof ArchiveError, `要 ArchiveError，实际是 ${String(error)}`);
      assert.match(error.message, /密码/, '要说「密码」这件事，与 7z 那条路一致');
      assert.doesNotMatch(error.message, /ADM-ZIP|Incompatible password/, '不许把英文库内部串端给教师');
      return true;
    },
  );
});

test('把 .jpg 改名成 .rar ⇒ ArchiveError（**不是**静默成功、不是 500）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-'));
  const source = path.join(dir, 'faker.rar');
  fs.writeFileSync(source, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-out-'));
  await assert.rejects(
    () => safeExtractArchive({ sourcePath: source, originalName: 'faker.rar', destination: dest, limits: LIMITS }),
    (error: unknown) => {
      assert.ok(error instanceof ArchiveError, `要 ArchiveError，实际是 ${String(error)}`);
      // 同上：只查类型会被占位的 `RAR 支持还没做` 蒙过去。钉住文案。
      assert.match(error.message, /压缩包|读不了|有效/, '要看到「这不是一个有效压缩包」那类文案');
      return true;
    },
  );
});

test('7z：自己压一个包，解出来的树逐条对上', async () => {
  const SevenZip = createRequire(import.meta.url)('7z-wasm');
  const sz = await SevenZip({ stdout() {}, stderr() {} });
  sz.FS.mkdir('/w'); sz.FS.chdir('/w');
  sz.FS.mkdir('/w/site'); sz.FS.mkdir('/w/site/css');
  sz.FS.writeFile('/w/site/index.html', '<h1>hi</h1>');
  sz.FS.writeFile('/w/site/css/s.css', 'body{}');
  sz.callMain(['a', '-t7z', '/w/site.7z', '/w/site']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-'));
  const source = path.join(dir, 'site.7z');
  fs.writeFileSync(source, Buffer.from(sz.FS.readFile('/w/site.7z')));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-out-'));
  const r = await safeExtractArchive({ sourcePath: source, originalName: 'site.7z', destination: dest, limits: LIMITS });
  assert.equal(r.kind, '7z');
  assert.equal(fs.readFileSync(path.join(dest, 'site/index.html'), 'utf8'), '<h1>hi</h1>');
  assert.equal(fs.readFileSync(path.join(dest, 'site/css/s.css'), 'utf8'), 'body{}');
});

test('落盘权限必须是 0o600（与 safeExtractZip 逐字一致）', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-out-'));
  await safeExtractArchive({ sourcePath: RAR_FIXTURE, originalName: 'small.rar', destination: dest, limits: LIMITS });
  const mode = fs.statSync(path.join(dest, 'test.txt')).mode & 0o777;
  assert.equal(mode, 0o600, `解出来的文件是 ${mode.toString(8)} —— 与 zip 那条路的落盘权限不一致`);
});

test('只有空目录的包 ⇒ ArchiveError（不是「成功地」建出一个打不开的网页）', async () => {
  const SevenZip = createRequire(import.meta.url)('7z-wasm');
  const sz = await SevenZip({ stdout() {}, stderr() {} });
  sz.FS.mkdir('/w'); sz.FS.chdir('/w');
  sz.FS.mkdir('/w/empty'); sz.FS.mkdir('/w/empty/deeper');
  sz.callMain(['a', '-t7z', '/w/empty.7z', '/w/empty']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-'));
  const source = path.join(dir, 'empty.7z');
  fs.writeFileSync(source, Buffer.from(sz.FS.readFile('/w/empty.7z')));

  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-archive-out-'));
  await assert.rejects(
    () => safeExtractArchive({ sourcePath: source, originalName: 'empty.7z', destination: dest, limits: LIMITS }),
    (error: unknown) => {
      assert.ok(error instanceof ArchiveError, `要 ArchiveError，实际是 ${String(error)}`);
      // ⚠️ 与 T4 那两条同一个毛病：只查类型会被 `extractBody` 的占位（也抛 ArchiveError）蒙过去
      //    —— 施工时实测，这条在实现之前是绿的。钉住文案。
      assert.match(error.message, /没有文件|有效/, '要看到「包里没有文件」那类文案，而不是占位的错');
      return true;
    },
  );
  assert.deepEqual(fs.readdirSync(dest), [], '拒掉之后不许在目标目录里留东西（调用方会 rm，但这里先确认它没落盘）');
});

test('★ 打包脚本必须点名 7zz.wasm —— 否则「开发正常、安装包静默缺文件」', () => {
  // 照 webapp-vendor.test.ts:75 那条的形状。守的是同一个失败模式：
  // `package-server.mjs` 只检查它点名的那几个文件，漏一行就**只在打包版炸**。
  const packaging = fs.readFileSync(path.join(import.meta.dirname, '../../../scripts/package-server.mjs'), 'utf8');
  assert.match(
    packaging,
    /node_modules\/7z-wasm\/7zz\.wasm/,
    'package-server.mjs 的 requiredFiles 里没有 7zz.wasm —— 安装包里缺了它，教师上传 rar/7z 时才会报错',
  );
});

test('7z-wasm 确实被声明成了运行时依赖（不是 devDependency）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.ok(pkg.dependencies?.['7z-wasm'], '7z-wasm 必须在 dependencies 里 —— devDependencies 不会进安装包');
  assert.equal(pkg.devDependencies?.['7z-wasm'], undefined, '同时出现在两边说明声明是随手加的');
});
