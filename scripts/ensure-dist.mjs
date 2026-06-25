import { accessSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const distIndex = join(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');

try {
  accessSync(distIndex);
} catch {
  execSync('npm run build', { stdio: 'inherit', cwd: join(dirname(fileURLToPath(import.meta.url)), '..') });
}
