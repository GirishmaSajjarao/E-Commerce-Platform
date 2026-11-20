import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function check(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), folder);
    if (entry.isDirectory()) await check(url);
    else if (/\.[cm]?js$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', fileURLToPath(url)], { stdio: 'inherit', windowsHide: true });
      if (result.status !== 0) process.exitCode = 1;
    }
  }
}
for (const folder of ['server/src/', 'server/test/', 'server/qa/promptfoo/', 'client/src/', 'e2e/tests/', 'scripts/']) {
  await check(new URL('../' + folder, import.meta.url));
}
if (!process.exitCode) console.log('JavaScript syntax checks passed.');
