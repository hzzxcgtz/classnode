// 只做静态检查，不启动服务、连接数据库或调用外部 AI。
import fs from 'node:fs';
import path from 'node:path';
import { root, requireRuntime, run } from './lib/project.mjs';

requireRuntime();
function filesAt(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesAt(file) : [file];
  });
}
const files = [
  ...filesAt(path.join(root, 'scripts')),
  ...fs.readdirSync(root).filter(name => name.endsWith('.sh')).map(name => path.join(root, name)),
].filter(file => /\.(mjs|js|sh|py)$/.test(file)).sort();
let failed = 0;
for (const file of files) {
  try {
    if (/\.(mjs|js)$/.test(file)) run(process.execPath, ['--check', file]);
    else if (file.endsWith('.sh')) run('bash', ['-n', file]);
    else run(process.env.CLASSNODE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', 'import ast,sys; ast.parse(open(sys.argv[1],encoding="utf-8").read(),filename=sys.argv[1])', file]);
  } catch (error) { failed++; console.error(`${path.relative(root, file)}: ${error.message}`); }
}
console.log(`[check-scripts] ${files.length} 个脚本，${failed} 个失败`);
if (failed) process.exitCode = 1;
