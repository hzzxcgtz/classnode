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

// 同步 src-tauri/resources/server/package.json（Tauri 捆绑的服务器版本）
const bundledPkgPath = path.join(root, 'src-tauri', 'resources', 'server', 'package.json');
if (fs.existsSync(bundledPkgPath)) {
    const bundledPkg = JSON.parse(fs.readFileSync(bundledPkgPath, 'utf-8'));
    bundledPkg.version = version;
    fs.writeFileSync(bundledPkgPath, JSON.stringify(bundledPkg, null, 2) + '\n');
    console.log(`[sync-version] src-tauri/resources/server/package.json → ${version}`);
}

// 同步 tauri.conf.json（仅在桌面应用打包时存在）
const tauriConfPath = path.join(root, 'src-tauri', 'tauri.conf.json');
if (fs.existsSync(tauriConfPath)) {
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
    tauriConf.version = version;
    fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
    console.log(`[sync-version] tauri.conf.json → ${version}`);
}

// 同步 Cargo.toml（仅在桌面应用打包时存在）
const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
if (fs.existsSync(cargoPath)) {
    let cargo = fs.readFileSync(cargoPath, 'utf-8');
    cargo = cargo.replace(/^version = ".*?"/m, `version = "${version}"`);
    fs.writeFileSync(cargoPath, cargo);
    console.log(`[sync-version] Cargo.toml → ${version}`);
}

// 同步 README.md（cd 命令中的版本号）
for (const file of ['README.md', 'README.en.md']) {
    const readmePath = path.join(root, file);
    if (fs.existsSync(readmePath)) {
        let content = fs.readFileSync(readmePath, 'utf-8');
        content = content.replace(/classnode-v[\d.]+/g, `classnode-v${version}`);
        fs.writeFileSync(readmePath, content);
        console.log(`[sync-version] ${file} → ${version}`);
    }
}

// 同步 portal/index.html（版本徽章 + 下载横幅中的版本号 + 日期）
const portalIndexPath = path.join(root, 'portal', 'index.html');
if (fs.existsSync(portalIndexPath)) {
    let content = fs.readFileSync(portalIndexPath, 'utf-8');
    content = content.replace(/>v\d+\.\d+\.\d+</g, `>v${version}<`);
    // 更新版本发布日期为今天
    const today = new Date().toISOString().slice(0, 10);
    content = content.replace(
        /(class="dl-version-banner-date"\s*>)\d{4}-\d{2}-\d{2}(<\/span>)/,
        `$1${today}$2`
    );
    fs.writeFileSync(portalIndexPath, content);
    console.log(`[sync-version] portal/index.html → ${version} (${today})`);
}

// 同步 portal/deploy.html（安装包文件名中的版本号）
const portalDeployPath = path.join(root, 'portal', 'deploy.html');
if (fs.existsSync(portalDeployPath)) {
    let content = fs.readFileSync(portalDeployPath, 'utf-8');
    content = content.replace(/classnode-v[\d.]+/g, `classnode-v${version}`);
    fs.writeFileSync(portalDeployPath, content);
    console.log(`[sync-version] portal/deploy.html → ${version}`);
}
