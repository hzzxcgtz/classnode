import { spawnSync } from 'node:child_process';

/** Tauri otherwise silently skips the modern icon when actool is unavailable. */
export function requireMacIconTools(execute = spawnSync) {
  const result = execute('xcrun', ['actool', '--version', '--output-format=human-readable-text'], { encoding: 'utf8' });
  const version = /^\s*short-bundle-version:\s*(\d+)(?:\.\d+)*\s*$/m.exec(result.stdout ?? '');
  if (result.error || result.status !== 0 || !version || Number(version[1]) < 26) {
    throw new Error('macOS 新版图标需要完整 Xcode 26 或更高版本的 actool。当前开发工具不可用或版本过旧；请安装并选用完整 Xcode 后重新打包，避免生成仍带系统兼容外框的安装包。');
  }
}
