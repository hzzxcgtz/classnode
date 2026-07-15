/**
 * Prepare a release without committing or pushing anything.
 * Usage: node scripts/prepare-release.mjs <x.y.z|major|minor|patch>
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const current = pkg.version;
const requested = process.argv[2];

function usage(message) {
  if (message) console.error(`错误: ${message}`);
  console.error('用法: pnpm prepare-release <x.y.z|major|minor|patch>');
  process.exit(2);
}

if (!requested) usage('缺少目标版本');
if (!/^\d+\.\d+\.\d+$/.test(current)) usage(`当前版本不是标准 SemVer: ${current}`);

function increment(version, part) {
  const values = version.split('.').map(Number);
  if (part === 'major') return `${values[0] + 1}.0.0`;
  if (part === 'minor') return `${values[0]}.${values[1] + 1}.0`;
  return `${values[0]}.${values[1]}.${values[2] + 1}`;
}

const next = ['major', 'minor', 'patch'].includes(requested)
  ? increment(current, requested)
  : requested;

if (!/^\d+\.\d+\.\d+$/.test(next)) usage(`无效版本: ${next}`);
if (next === current) usage(`版本没有变化: ${current}`);

pkg.version = next;
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

execFileSync(process.execPath, [path.join(root, 'scripts/sync-version.mjs')], {
  cwd: root,
  stdio: 'inherit',
});

const manifestPath = path.join(root, 'updater', 'latest.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = next;
  manifest.pub_date = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const changelogPath = path.join(root, 'server', 'changelogs', `v${next}.md`);
if (!fs.existsSync(changelogPath)) {
  const today = new Date().toISOString().slice(0, 10);
  let subjects = [];
  try {
    subjects = execFileSync('git', ['log', `v${current}..HEAD`, '--no-merges', '--pretty=%s'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('\n').filter(Boolean);
  } catch {
    // A missing previous tag is fine; the release note stays as a template.
  }

  const items = subjects.length
    ? subjects.map(subject => `- ${subject.replace(/^(feat|fix|docs|style|refactor|chore)(\([^)]*\))?:\s*/i, '')}`).join('\n')
    : '- 请补充本次版本变更';
  fs.writeFileSync(changelogPath, `# 更新日志\n\n## [${next}] — ${today}\n\n${items}\n`);
}

console.log(`\n[prepare-release] ${current} → ${next}`);
console.log(`[prepare-release] 更新日志: server/changelogs/v${next}.md`);
console.log('[prepare-release] 已准备文件，尚未执行 git commit 或 git push');
