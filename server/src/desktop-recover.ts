import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDedicatedNode, nativeRecoveryAdapter, recoverDesktopPorts } from './services/desktop-port-recovery.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const result = await recoverDesktopPorts({platform:process.platform, nodePath:process.execPath, serverDir,
    dedicatedRuntime:isDedicatedNode(process.execPath, serverDir)}, nativeRecoveryAdapter(process.platform));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error('检查或回收旧课堂服务失败：' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
