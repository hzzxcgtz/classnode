import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ALGORITHM = 'aes-256-gcm';

/** 获取密钥存储目录 */
function getKeyDir(): string {
  if (process.env.CLASSNODE_DATA_DIR) {
    return process.env.CLASSNODE_DATA_DIR;
  }
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, '../..');
}

/** 读取或生成加密密钥 */
function resolveEncryptionKey(): string {
  // 1. 优先使用环境变量
  if (process.env.ENCRYPTION_KEY) {
    if (Buffer.byteLength(process.env.ENCRYPTION_KEY, 'utf8') !== 32) {
      throw new Error('ENCRYPTION_KEY 必须是恰好 32 字节的字符串');
    }
    return process.env.ENCRYPTION_KEY;
  }

  // 2. 尝试读取本地密钥文件
  const keyFile = path.join(getKeyDir(), '.encryption.key');
  if (fs.existsSync(keyFile)) {
    const key = fs.readFileSync(keyFile, 'utf8').trim();
    if (Buffer.byteLength(key, 'utf8') !== 32) throw new Error('本地加密密钥文件格式无效');
    return key;
  }

  // 3. 首次运行：自动生成随机密钥并持久化
  try {
    const newKey = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(getKeyDir(), { recursive: true });
    fs.writeFileSync(keyFile, newKey, 'utf8');
    // 仅所有者可读写（Unix）
    try { fs.chmodSync(keyFile, 0o600); } catch {}
    console.log(`[Crypto] 已自动生成加密密钥: ${keyFile}`);
    return newKey;
  } catch (e) {
    throw new Error(`[Crypto] 无法安全创建加密密钥文件: ${e instanceof Error ? e.message : String(e)}`);
  }
}

let _encryptionKey: string | null = null;

function getEncryptionKey(): string {
  if (_encryptionKey) return _encryptionKey;
  _encryptionKey = resolveEncryptionKey();
  return _encryptionKey;
}

/** 重新加载加密密钥（恢复操作后调用） */
export function reloadEncryptionKey(): void {
  _encryptionKey = null;
  getEncryptionKey();
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(getEncryptionKey(), 'utf8'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(getEncryptionKey(), 'utf8'), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/** 判断字符串是否为已加密格式（iv:authTag:ciphertext） */
export function isEncrypted(text: string): boolean {
  return /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i.test(text);
}
