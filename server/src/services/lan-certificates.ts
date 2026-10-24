import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPair, randomBytes, randomUUID, X509Certificate, createPrivateKey } from 'node:crypto';
import { isIP } from 'node:net';
import forge from 'node-forge';

const DAY = 86_400_000;
export interface CertificatePair { key: string; cert: string }

function rsa(bits: number): Promise<{ publicKey: string; privateKey: string }> {
  return new Promise((resolve, reject) => generateKeyPair('rsa', {
    modulusLength: bits,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }, (error, publicKey, privateKey) => error ? reject(error) : resolve({ publicKey, privateKey })));
}
function serial() { return '01' + randomBytes(19).toString('hex'); }
function writePrivate(file: string, value: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}
function readPair(file: string): CertificatePair {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('证书文件必须是普通文件');
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as CertificatePair;
  const cert = new X509Certificate(value.cert);
  if (!cert.checkPrivateKey(createPrivateKey(value.key))) throw new Error('证书与私钥不匹配');
  return value;
}
export function certificateDirectory(dataRoot: string) { return path.join(dataRoot, 'lan-https'); }

/** A missing/corrupt existing CA is an error, never an excuse to rotate students' trust. */
export async function ensureRoot(directory: string): Promise<CertificatePair> {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('证书目录不能是符号链接');
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
  const file = path.join(directory, 'root.json');
  if (fs.existsSync(file)) {
    const pair = readPair(file);
    const cert = new X509Certificate(pair.cert);
    if (!cert.ca || !cert.verify(cert.publicKey) || Date.parse(cert.validTo) <= Date.now() + DAY) throw new Error('根证书无效或即将过期，请由管理员处理，未自动更换');
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
    return pair;
  }
  if (fs.existsSync(path.join(directory, 'initialized')) || fs.existsSync(path.join(directory, 'server.json'))) throw new Error('原有根证书缺失，请恢复教师端证书备份，未自动更换');
  const keys = await rsa(3072);
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(keys.publicKey);
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 5 * 60_000);
  cert.validity.notAfter = new Date(Date.now() + 3650 * DAY);
  const attrs = [{ name: 'commonName', value: 'ClassNode Local Root ' + cert.serialNumber.slice(-8) }, { name: 'organizationName', value: 'ClassNode' }];
  cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', critical: true, cA: true, pathLenConstraint: 0 },
    { name: 'keyUsage', critical: true, keyCertSign: true, cRLSign: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(forge.pki.privateKeyFromPem(keys.privateKey), forge.md.sha256.create());
  const pair = { key: keys.privateKey, cert: forge.pki.certificateToPem(cert) };
  // Exclusive creation protects the root against a second initializer.
  fs.writeFileSync(file, JSON.stringify(pair), { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(path.join(directory, 'initialized'), 'ClassNode root identity must be preserved\n', { mode: 0o600, flag: 'wx' });
  return pair;
}

export async function ensureServerCertificate(directory: string, root: CertificatePair, addresses: string[]): Promise<CertificatePair> {
  const ips = [...new Set(['127.0.0.1', '::1', ...addresses.filter(address => isIP(address))])].sort();
  const rootCert = new X509Certificate(root.cert);
  const file = path.join(directory, 'server.json');
  if (fs.existsSync(file)) {
    try {
      const pair = readPair(file);
      const cert = new X509Certificate(pair.cert);
      if (cert.verify(rootCert.publicKey) && Date.parse(cert.validTo) > Date.now() + 14 * DAY && cert.checkHost('localhost')
        && ips.every(ip => cert.checkIP(ip))
        && JSON.parse(fs.readFileSync(file, 'utf8')).addresses?.join(',') === ips.join(',')) return pair;
    } catch { /* Only the disposable server certificate may be reissued. */ }
  }
  const keys = await rsa(2048);
  const ca = forge.pki.certificateFromPem(root.cert);
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(keys.publicKey);
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 5 * 60_000);
  cert.validity.notAfter = new Date(Math.min(Date.now() + 90 * DAY, Date.parse(rootCert.validTo) - DAY));
  cert.setSubject([{ name: 'commonName', value: 'ClassNode LAN Server' }]);
  cert.setIssuer(ca.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', critical: true, cA: false },
    { name: 'keyUsage', critical: true, digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...ips.map(ip => ({ type: 7, ip }))] },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: ca.generateSubjectKeyIdentifier().getBytes() },
  ]);
  cert.sign(forge.pki.privateKeyFromPem(root.key), forge.md.sha256.create());
  const pair = { key: keys.privateKey, cert: forge.pki.certificateToPem(cert) };
  writePrivate(file, { ...pair, addresses: ips });
  return pair;
}

export function rootInfo(pair: CertificatePair) {
  const cert = new X509Certificate(pair.cert);
  return { fingerprint: cert.fingerprint256, expiresAt: new Date(cert.validTo).toISOString(), subject: cert.subject };
}
export function rootProfile(pair: CertificatePair): string {
  const cert = new X509Certificate(pair.cert);
  const hex = cert.fingerprint256.replaceAll(':', '').toLowerCase();
  const uuid = (offset: number) => `${hex.slice(offset, offset+8)}-${hex.slice(offset+8,offset+12)}-5${hex.slice(offset+13,offset+16)}-a${hex.slice(offset+17,offset+20)}-${hex.slice(offset+20,offset+32)}`;
  const identifier = `cn.classnode.lan.${hex.slice(0, 24)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>PayloadType</key><string>Configuration</string><key>PayloadVersion</key><integer>1</integer>
<key>PayloadIdentifier</key><string>${identifier}</string><key>PayloadUUID</key><string>${uuid(0)}</string>
<key>PayloadDisplayName</key><string>ClassNode 局域网证书</string><key>PayloadOrganization</key><string>ClassNode</string>
<key>PayloadDescription</key><string>用于信任教师电脑提供的 ClassNode HTTPS。只包含根证书，不包含设备管理、VPN或其他设置。请核对教师显示的证书指纹。</string>
<key>PayloadContent</key><array><dict><key>PayloadType</key><string>com.apple.security.root</string><key>PayloadVersion</key><integer>1</integer>
<key>PayloadIdentifier</key><string>${identifier}.root</string><key>PayloadUUID</key><string>${uuid(16)}</string>
<key>PayloadDisplayName</key><string>ClassNode Local Root ${hex.slice(-8)}</string><key>PayloadContent</key><data>${cert.raw.toString('base64')}</data>
</dict></array></dict></plist>`;
}
