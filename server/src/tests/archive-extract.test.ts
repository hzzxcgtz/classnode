import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveKindOf, parseSevenZipListing } from '../services/archive-extract.js';

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

test('parseSevenZipListing：目录不计入文件数与体积', () => {
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
