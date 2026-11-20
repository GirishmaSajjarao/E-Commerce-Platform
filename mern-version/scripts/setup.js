import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
for (const workspace of ['server', 'client', 'eval-service']) {
  const file = new URL(`../${workspace}/.env`, import.meta.url);
  let contents = await readFile(new URL('.env.example', file), 'utf8');
  if (workspace === 'server') contents = contents.replace('replace-with-a-random-value', randomBytes(32).toString('hex'));
  try {
    await writeFile(file, contents, { flag: 'wx' });
    console.log(`Created ${workspace}/.env`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}
