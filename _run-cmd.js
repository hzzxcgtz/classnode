const mod = process.argv[2];
const args = process.argv.slice(3);
try {
  const path = require.resolve(mod);
  require('child_process').spawnSync(process.execPath, [path, ...args], { stdio: 'inherit' });
} catch (e) {
  console.error(`Cannot find module: ${mod}`);
  process.exit(1);
}
