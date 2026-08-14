import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BACKEND_DIR = path.join(ROOT, 'backend');
const OUTPUT_DIR = path.join(ROOT, 'src-tauri', 'binaries');
const TMP_DIR = path.join(ROOT, '.sidecar-build');
const BASE_NAME = 'chatplus-backend';

function getPlatformConfig() {
  const key = `${process.platform}-${process.arch}`;
  switch (key) {
    case 'darwin-arm64':
      return { pkgTarget: 'node22-macos-arm64', triple: 'aarch64-apple-darwin', ext: '' };
    case 'darwin-x64':
      return { pkgTarget: 'node22-macos-x64', triple: 'x86_64-apple-darwin', ext: '' };
    case 'linux-x64':
      return { pkgTarget: 'node22-linux-x64', triple: 'x86_64-unknown-linux-gnu', ext: '' };
    case 'linux-arm64':
      return { pkgTarget: 'node22-linux-arm64', triple: 'aarch64-unknown-linux-gnu', ext: '' };
    case 'win32-x64':
      return { pkgTarget: 'node22-win-x64', triple: 'x86_64-pc-windows-msvc', ext: '.exe' };
    case 'win32-arm64':
      return { pkgTarget: 'node22-win-arm64', triple: 'aarch64-pc-windows-msvc', ext: '.exe' };
    default:
      throw new Error(`Unsupported platform/arch for sidecar build: ${key}`);
  }
}

function ensureCleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

const platform = getPlatformConfig();
ensureCleanDir(TMP_DIR);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const tempOutput = path.join(TMP_DIR, `${BASE_NAME}${platform.ext}`);
const finalOutput = path.join(OUTPUT_DIR, `${BASE_NAME}-${platform.triple}${platform.ext}`);
const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const execShell = process.platform === 'win32';

execFileSync(pnpmExecutable, [
  'exec',
  'pkg',
  '.',
  '--targets',
  platform.pkgTarget,
  '--output',
  tempOutput,
], {
  cwd: BACKEND_DIR,
  stdio: 'inherit',
  shell: execShell,
});

fs.rmSync(finalOutput, { force: true });
fs.copyFileSync(tempOutput, finalOutput);
if (platform.ext === '') {
  fs.chmodSync(finalOutput, 0o755);
}

console.log(`Built sidecar: ${path.relative(ROOT, finalOutput)}`);
