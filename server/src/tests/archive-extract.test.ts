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
