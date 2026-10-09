import fs from 'node:fs';
import path from 'node:path';

/** Windows does not expose POSIX permission bits; also verify the requested mode. */
export async function withFileModeCapture<T>(operation: (writes: Map<string, unknown>) => Promise<T>): Promise<T> {
  const writes = new Map<string, unknown>();
  const original = fs.writeFileSync;
  fs.writeFileSync = ((...args: unknown[]) => {
    if (typeof args[0] === 'string') {
      const options = args[2];
      writes.set(path.resolve(args[0]), options && typeof options === 'object' && 'mode' in options ? options.mode : undefined);
    }
    return Reflect.apply(original, fs, args);
  }) as typeof fs.writeFileSync;
  try { return await operation(writes); }
  finally { fs.writeFileSync = original; }
}
