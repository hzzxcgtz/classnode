import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ArchiveError, archiveKindOf, parseSevenZipListing, safeExtractArchive } from '../services/archive-extract.js';

/**
 * 真实抓取：`7z-wasm` 对 `server/src/tests/fixtures/small-rar3.rar` 跑
 * `callMain(['l','-slt','-ba','/in/a'])` 的**逐字**输出。
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
