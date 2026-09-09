import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const classroomHtmlPath = path.join(root, 'out', 'classroom', 'index.html');

if (!fs.existsSync(classroomHtmlPath)) {
  throw new Error(`缺少学生端构建产物: ${classroomHtmlPath}`);
}

const html = fs.readFileSync(classroomHtmlPath, 'utf8');
const scriptPaths = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((source) => source.startsWith('/'));

const unsupportedLookbehinds = ['/(?<=', '/(?<!', 'RegExp("(?<=', 'RegExp("(?<!', "RegExp('(?<=", "RegExp('(?<!"];
const failures = [];

for (const source of scriptPaths) {
  const filePath = path.join(root, 'out', source);
  if (!fs.existsSync(filePath)) {
    failures.push(`${source}: 文件不存在`);
    continue;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const pattern = unsupportedLookbehinds.find((candidate) => content.includes(candidate));
  if (pattern) failures.push(`${source}: 包含 Safari 15 不支持的正则后行断言 ${pattern}`);
}

if (failures.length > 0) {
  throw new Error(`学生端浏览器兼容性检查失败:\n${failures.join('\n')}`);
}

console.log(`[browser-compat] 学生端首屏 ${scriptPaths.length} 个脚本通过 Safari 15 语法检查`);
