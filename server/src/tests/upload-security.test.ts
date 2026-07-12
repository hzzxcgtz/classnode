import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { detectSafeChatFile, safeExtractZip, sanitizeSvg } from '../services/upload-security.js';

test('SVG sanitizer accepts basic shapes and rejects active content', () => {
  assert.ok(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="5"/></svg>'));
  assert.equal(sanitizeSvg('<svg><script>alert(1)</script></svg>'), null);
  assert.equal(sanitizeSvg('<svg><image href="https://example.com/a.png"/></svg>'), null);
  assert.equal(sanitizeSvg('<svg><rect onclick="alert(1)"/></svg>'), null);
});

test('chat file detection uses content signatures rather than filename alone', () => {
  assert.equal(detectSafeChatFile(Buffer.from('%PDF-1.7\n'), 'renamed.txt'), 'pdf');
  assert.equal(detectSafeChatFile(Buffer.from('plain UTF-8 text'), 'notes.txt'), 'txt');
  assert.equal(detectSafeChatFile(Buffer.from('<html>bad</html>'), 'document.pdf'), null);
});

test('safe ZIP extraction rejects traversal and enforces size limits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-zip-test-'));
  try {
    const traversalZip = {
      getEntries: () => [{ entryName: '../escape.txt', isDirectory: false, header: { size: 1 }, getData: () => Buffer.from('x') }],
    };
    assert.throws(() => safeExtractZip(traversalZip, root, { maxFiles: 5, maxTotalBytes: 100, maxSingleFileBytes: 100 }), /路径穿越/);

    const oversizedZip = {
      getEntries: () => [{ entryName: 'large.bin', isDirectory: false, header: { size: 101 }, getData: () => Buffer.alloc(101) }],
    };
    assert.throws(() => safeExtractZip(oversizedZip, root, { maxFiles: 5, maxTotalBytes: 100, maxSingleFileBytes: 100 }), /过大的单个文件/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
