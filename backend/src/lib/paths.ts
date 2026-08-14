import os from 'node:os';
import path from 'node:path';

export function getDataDir(): string {
  const configured = process.env.CHATPLUS_DATA_DIR;
  if (configured) {
    return expandPath(configured);
  }
  return path.join(process.cwd(), 'data');
}

export function expandPath(input: string): string {
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input === '~') {
    return os.homedir();
  }
  return input;
}

export function defaultExportDir(): string {
  return path.join(os.homedir(), 'Documents', 'chatplus', 'exports');
}
