const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { parseEnv } = require('node:util');

const [, , envFile, command, ...args] = process.argv;
if (!envFile || !command) {
  console.error('usage: node scripts/run-with-env-file.cjs <env-file> <command> [...args]');
  process.exit(2);
}
const env = { ...process.env, ...parseEnv(readFileSync(envFile, 'utf8')) };
const result = spawnSync(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
