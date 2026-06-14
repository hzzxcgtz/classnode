/**
 * 文件日志：将 console 输出同时写入日志文件
 * 日志位置：CLASSNODE_DATA_DIR/logs/server-YYYY-MM-DD.log
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 获取日志目录 */
function getLogDir(): string {
  if (process.env.CLASSNODE_DATA_DIR) {
    return path.join(process.env.CLASSNODE_DATA_DIR, 'logs');
  }
  return path.join(__dirname, '../../logs');
}

function initFileLogger() {
  const logDir = getLogDir();
  fs.mkdirSync(logDir, { recursive: true });

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const logPath = path.join(logDir, `server-${dateStr}.log`);

  const stream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' });

  stream.write(`\n=== Server started at ${now.toISOString()} ===\n`);
  if (process.env.CLASSNODE_DATA_DIR) {
    stream.write(`CLASSNODE_DATA_DIR: ${process.env.CLASSNODE_DATA_DIR}\n`);
  }
  stream.write(`DATABASE_URL: ${process.env.DATABASE_URL || '(not set)'}\n`);
  stream.write(`Log file: ${logPath}\n\n`);

  function write(level: string, args: unknown[]) {
    const ts = new Date().toISOString();
    const msg = args.map(a =>
      typeof a === 'string' ? a :
      a instanceof Error ? `${a.message}\n${a.stack || ''}` :
      JSON.stringify(a)
    ).join(' ');
    stream.write(`[${ts}] [${level}] ${msg}\n`);
  }

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...args: unknown[]) => {
    write('LOG', args);
    origLog.apply(console, args);
  };

  console.warn = (...args: unknown[]) => {
    write('WARN', args);
    origWarn.apply(console, args);
  };

  console.error = (...args: unknown[]) => {
    write('ERR', args);
    origError.apply(console, args);
  };

  console.log(`[file-logger] Logging to ${logPath}`);

  // 捕获未处理异常和 Promise 拒绝
  process.on('uncaughtException', (err) => {
    write('FATAL', [`UNCAUGHT EXCEPTION: ${err.message}\n${err.stack || ''}`]);
    stream.end();
    // 保留默认行为
    process.stderr.write(`UNCAUGHT EXCEPTION: ${err.stack || err.message}\n`);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? `${reason.message}\n${reason.stack || ''}` : String(reason);
    write('FATAL', [`UNHANDLED REJECTION: ${msg}`]);
    origWarn.apply(console, [`[file-logger] Unhandled Rejection:`, reason]);
  });
}

initFileLogger();
