import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOTS = ['app', 'components', 'lib'];
const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts']);
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
    else if (EXT.has(extname(path))
      && !path.endsWith('check-no-rtdb-runtime.mts')
      && !path.endsWith('check-release.mts')) {
      const source = readFileSync(path, 'utf8');
      const hasDirectConnection = /firebase(?:-admin)?\/database|(?:NEXT_PUBLIC_)?FIREBASE_DATABASE_URL|FIREBASE_DATABASE_EMULATOR_HOST|default-rtdb|\.json\?ns=|firebasedatabase\.app|firebaseio\.com/i.test(source);
      const hasLegacyFactory = /\bgetDatabase\s*\(/.test(source) && !/firestore-path-store/.test(source);
      const hasConnection = hasDirectConnection || hasLegacyFactory;
      if (hasConnection) retiredScripts.push(relative('.', path));
    }
  }
}
checkRetiredScripts('scripts');
for (const file of retiredScripts) failures.push(`${file} SCRIPT_NOT_RETIRED RTDB 연결 코드가 차단되지 않음`);

const scriptTargets = (source: string) => [...source.matchAll(/\b(scripts\/[\w./-]+\.(?:mts|mjs|cjs))\b/g)]
  .map((match) => match[1]);
// 오케스트레이터는 실행할 파일을 steps의 cmd 배열에 적고 spawnSync는 뒤에서 간접 호출한다.
// 단순 문서·검사 목록의 파일명은 실행 간선이 아니므로 cmd 배열과 직접 실행 호출만 따라간다.
const runtimeScriptTargets = (source: string) => [
  ...[...source.matchAll(/\bcmd\s*:\s*\[([^\]]+)\]/g)].flatMap((match) => scriptTargets(match[1])),
  ...[...source.matchAll(/\bfile\s*:\s*['"](scripts\/[\w./-]+\.(?:mts|mjs|cjs))['"]/g)].map((match) => match[1]),
  ...[...source.matchAll(/\b(?:run|spawn|spawnSync|execFile|execFileSync|execSync|runTsx)\s*\(([\s\S]{0,500}?)\)/g)]
    .flatMap((match) => scriptTargets(match[1])),
];
const npmScriptTargets = (source: string) => [...source.matchAll(/['"]npm(?:\.cmd)?['"]\s*,\s*['"]run['"]\s*,\s*['"]([^'"]+)['"]/g)]
  .map((match) => match[1]);
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
    for (const child of runtimeScriptTargets(source)) queue.push({ target: child, caller: target });
    for (const npmName of npmScriptTargets(source)) {
      const command = packageJson.scripts?.[npmName];
      if (!command) {
        failures.push(`${target} ACTIVE_GRAPH_MISSING_NPM_SCRIPT ${npmName}`);
        continue;
      }
      for (const child of scriptTargets(command)) queue.push({ target: child, caller: `package.json#${npmName}` });
    }
  } catch { /* 대상 존재 여부는 해당 파이프라인/명령 검사가 담당 */ }
}

if (failures.length) {
  console.error(`FAIL — RTDB runtime reference ${failures.length}`);
  for (const row of failures) console.error(`  ${row}`);
  process.exit(1);
}
console.log(`PASS — runtime RTDB connection 0 (${files.length} app files); executable RTDB scripts 0`);
