import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const serverEnv = new URL('../server/.env', import.meta.url);
const existing = await readFile(serverEnv, 'utf8').catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return '';
});
const evaluationToken = existing.match(/^EVAL_SERVICE_TOKEN=(.+)$/m)?.[1].trim() || randomBytes(32).toString('hex');
for (const workspace of ['server', 'client', 'eval-service']) {
  const file = new URL(`../${workspace}/.env`, import.meta.url);
  let contents = await readFile(new URL('.env.example', file), 'utf8');
  contents = contents.replace(/^EVAL_SERVICE_TOKEN=$/m, `EVAL_SERVICE_TOKEN=${evaluationToken}`);
  if (workspace === 'server') contents = contents.replace('replace-with-a-random-value', randomBytes(32).toString('hex'));
  try {
    await writeFile(file, contents, { flag: 'wx' });
    console.log(`Created ${workspace}/.env`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}
