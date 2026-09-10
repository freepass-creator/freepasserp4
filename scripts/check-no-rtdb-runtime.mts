import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOTS = ['app', 'components', 'lib'];
const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const FORBIDDEN = [
  { code: 'CLIENT_IMPORT', re: /from\s+['"]firebase\/database['"]|import\s*\(['"]firebase\/database['"]\)/ },
  { code: 'ADMIN_IMPORT', re: /from\s+['"]firebase-admin\/database['"]|require\(['"]firebase-admin\/database['"]\)/ },
  { code: 'CLIENT_FACTORY', re: /\bgetRtdb\s*\(|\bgetDatabase\s*\(/ },
  { code: 'BACKEND_BRANCH', re: /NEXT_PUBLIC_DATA_BACKEND[^\n]{0,80}rtdb|backend[^\n]{0,40}(?:===|startsWith\s*\()\s*['"]rtdb/i },
  { code: 'DATABASE_URL', re: /(?:NEXT_PUBLIC_)?FIREBASE_DATABASE_URL|firebasedatabase\.app|firebaseio\.com/i },
];

const files: string[] = [];
function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    else if (EXT.has(extname(path))) files.push(path);
  }
}
for (const root of ROOTS) walk(root);

const failures: string[] = [];
const isHardDisabled = (source: string) => /^\s*throw new Error\(['"]RTDB_REMOVED:/m.test(source)
  || /(?:from|import\s*\()['"][^'"]*disabled-rtdb\.mts['"]/.test(source);
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const rule of FORBIDDEN) {
      if (rule.re.test(lines[i])) failures.push(`${relative('.', file)}:${i + 1} ${rule.code} ${lines[i].trim()}`);
    }
  }
}

const retiredScripts: string[] = [];
function checkRetiredScripts(dir: string) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) checkRetiredScripts(path);
    else if (EXT.has(extname(path)) && !path.endsWith('check-no-rtdb-runtime.mts')) {
      const source = readFileSync(path, 'utf8');
      const hasConnection = /firebase(?:-admin)?\/database|(?:NEXT_PUBLIC_)?FIREBASE_DATABASE_URL|FIREBASE_DATABASE_EMULATOR_HOST|default-rtdb|\.json\?ns=|firebasedatabase\.app|firebaseio\.com|\bgetDatabase\s*\(/i.test(source);
      const hardDisabled = isHardDisabled(source);
      if (hasConnection && !hardDisabled) retiredScripts.push(relative('.', path));
    }
  }
}
checkRetiredScripts('scripts');
for (const file of retiredScripts) failures.push(`${file} SCRIPT_NOT_RETIRED RTDB 연결 코드가 차단되지 않음`);

const scriptTargets = (source: string) => [...source.matchAll(/\b(scripts\/[\w./-]+\.(?:mts|mjs|cjs))\b/g)]
  .map((match) => match[1]);
const runtimeScriptTargets = (source: string) => source.split(/\r?\n/)
  .filter((line) => /\b(?:run|spawn|spawnSync|execFile|execFileSync|execSync|runTsx)\s*\(/.test(line))
  .flatMap(scriptTargets);
const activeRoots: Array<{ target: string; caller: string }> = [];
for (const driver of ['scripts/hourly-sync.mts', 'scripts/run-daily.mts']) {
  activeRoots.push({ target: driver, caller: 'release-pipeline' });
}

for (const name of readdirSync('.github/workflows')) {
  if (!/\.ya?ml$/i.test(name)) continue;
  const workflow = `.github/workflows/${name}`;
  const source = readFileSync(workflow, 'utf8');
  if (/(?:NEXT_PUBLIC_)?FIREBASE_DATABASE_URL|FIREBASE_DATABASE_EMULATOR_HOST|default-rtdb|firebasedatabase\.app|firebaseio\.com/i.test(source)) {
    failures.push(`${workflow} WORKFLOW_RTDB_REFERENCE`);
  }
  for (const target of scriptTargets(source)) activeRoots.push({ target, caller: workflow });
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> };
for (const [name, command] of Object.entries(packageJson.scripts || {})) {
  for (const target of scriptTargets(command)) activeRoots.push({ target, caller: `package.json#${name}` });
}

const queue = [...activeRoots];
const visited = new Set<string>();
while (queue.length) {
  const { target, caller } = queue.shift()!;
  if (visited.has(target)) continue;
  visited.add(target);
  try {
    const source = readFileSync(target, 'utf8');
    if (isHardDisabled(source)) {
      failures.push(`${caller} ACTIVE_GRAPH_DISABLED_TARGET ${target}`);
      continue;
    }
    for (const child of runtimeScriptTargets(source)) queue.push({ target: child, caller: target });
  } catch { /* 대상 존재 여부는 해당 파이프라인/명령 검사가 담당 */ }
}

if (failures.length) {
  console.error(`FAIL — RTDB runtime reference ${failures.length}`);
  for (const row of failures) console.error(`  ${row}`);
  process.exit(1);
}
console.log(`PASS — runtime RTDB connection 0 (${files.length} app files); legacy RTDB scripts are hard-disabled`);
