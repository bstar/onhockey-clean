const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { version, productName } = require('../package.json');
const dist = path.resolve(process.env.PACKAGED_DIST || 'dist');
const directories = fs.readdirSync(dist).filter(name => fs.statSync(path.join(dist, name)).isDirectory());
let executable;
if (process.platform === 'linux') {
  const folder = directories.find(name => name.startsWith('linux') && name.endsWith('unpacked'));
  assert.ok(folder, 'Linux package exists');
  executable = path.join(dist, folder, 'onhockey-clean');
} else if (process.platform === 'darwin') {
  const folder = directories.find(name => name === 'mac' || name.startsWith('mac-'));
  assert.ok(folder, 'macOS package exists');
  executable = path.join(dist, folder, `${productName}.app`, 'Contents', 'MacOS', productName);
} else if (process.platform === 'win32') {
  const folder = directories.find(name => name.startsWith('win') && name.endsWith('unpacked'));
  assert.ok(folder, 'Windows package exists');
  executable = path.join(dist, folder, `${productName}.exe`);
} else throw new Error(`Unsupported platform: ${process.platform}`);
assert.ok(fs.existsSync(executable), `Executable exists: ${executable}`);
const result = spawnSync(executable, [...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--version'], { encoding: 'utf8', timeout: 30000 });
if (result.error) throw result.error;
assert.equal(result.status, 0, `Packaged app exits successfully: ${result.stderr}`);
assert.ok(result.stdout.includes(`${productName} ${version}`), `Packaged app reports expected version: ${result.stdout}`);
console.log(`Packaged ${process.platform}/${process.arch} app launched and reported version ${version}.`);
