/**
 * 构建前同步版本号：从 package.json 读取版本，写入 tauri.conf.json 和 Cargo.toml
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const version = pkg.version;

// 同步 server/package.json
const serverPkgPath = path.join(root, 'server', 'package.json');
const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, 'utf-8'));
serverPkg.version = version;
fs.writeFileSync(serverPkgPath, JSON.stringify(serverPkg, null, 2) + '\n');
console.log(`[sync-version] server/package.json → ${version}`);

// 同步 tauri.conf.json
const tauriConfPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
console.log(`[sync-version] tauri.conf.json → ${version}`);

// 同步 Cargo.toml
const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
let cargo = fs.readFileSync(cargoPath, 'utf-8');
cargo = cargo.replace(/^version = ".*?"/m, `version = "${version}"`);
fs.writeFileSync(cargoPath, cargo);
console.log(`[sync-version] Cargo.toml → ${version}`);
