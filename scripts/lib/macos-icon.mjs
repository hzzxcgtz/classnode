import { spawnSync } from 'node:child_process';

/** Keep icon upgrades optional: missing Xcode must not block an otherwise valid build. */
export function macIconBuildOptions(iconPaths, execute = spawnSync) {
  if (!iconPaths.some(icon => icon.endsWith('.icon'))) return { args: [], warning: null };
  let available = false;
  try {
    const result = execute('xcrun', ['actool', '--version', '--output-format=human-readable-text'], { encoding: 'utf8', timeout: 5000 });
    const version = /^\s*short-bundle-version:\s*(\d+)(?:\.\d+)*\s*$/m.exec(result.stdout ?? '');
    available = !result.error && result.status === 0 && version !== null && Number(version[1]) >= 26;
  } catch { /* Fall back if the tool cannot even be launched. */ }
  if (available) return { args: [], warning: null };
  return {
    // CLI config overrides the platform config; leave source files and other bundle options alone.
    args: ['--config', JSON.stringify({ bundle: { icon: iconPaths.filter(icon => !icon.endsWith('.icon')) } })],
    warning: '未检测到完整 Xcode 26+ 的图标编译工具，本次使用原 macOS 图标继续打包；新版系统仍可能显示银白色兼容外框，不影响安装包使用。',
  };
}
