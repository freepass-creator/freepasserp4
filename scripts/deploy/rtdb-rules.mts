/**
 * RTDB 보안규칙 배포기 — 백업 → 대조 → 게시 → 되돌리기.
 *
 *   tsx scripts/deploy/rtdb-rules.mts status            라이브 vs 로컬 파일이 같은가
 *   tsx scripts/deploy/rtdb-rules.mts diff              달라진 규칙경로를 줄단위로
 *   tsx scripts/deploy/rtdb-rules.mts backup            라이브 규칙을 파일로 내려받기
 *   tsx scripts/deploy/rtdb-rules.mts deploy --yes      백업 뜨고 로컬 파일을 게시
 *   tsx scripts/deploy/rtdb-rules.mts rollback --yes    최근 백업으로 되돌리기
 *
 * ★ 왜 firebase CLI 가 아니라 REST 인가
 *   `firebase deploy --only database` 는 CLI 로그인 상태에 매달린다. 서비스계정은 이미
 *   있는데 로그인이 만료돼서 배포가 막히는 상황이 **되돌려야 할 때** 오면 최악이다.
 *   여기서는 서비스계정 토큰으로 직접 쏜다 — 되돌리기가 로그인에 기대지 않는다.
 *
 * ★ 되돌리기는 «직전 백업»이 아니라 «게시 직전 백업»이다
 *   deploy 는 게시 전에 반드시 라이브를 먼저 내려받는다. 그래서 rollback 은 항상
 *   «방금 내가 덮어쓴 그것»으로 돌아간다.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RULES_URL, PROJECT_ID, accessToken, argv, stamp, die } from './_ctx.mts';

const LOCAL = 'database.rules.json';
const BACKUP_DIR = 'tmp/deploy/rules';

async function fetchLive(): Promise<string> {
  const res = await fetch(RULES_URL, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) die(`라이브 규칙을 못 읽었다 (HTTP ${res.status}). 서비스계정에 Firebase 권한이 있는지 확인.\n    ${(await res.text()).slice(0, 300)}`);
  return res.text();
}

async function putRules(text: string): Promise<void> {
  const res = await fetch(RULES_URL, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: text,
  });
  if (!res.ok) die(`게시 실패 (HTTP ${res.status})\n    ${(await res.text()).slice(0, 500)}`);
}

/** 규칙 트리를 «경로 → 식» 평면 지도로. 줄바꿈·들여쓰기 차이를 지우고 의미만 비교하기 위함. */
function flatten(node: unknown, path = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const next = path ? `${path}/${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [k, v] of flatten(value, next)) out.set(k, v);
      } else {
        out.set(next, JSON.stringify(value));
      }
    }
  }
  return out;
}

function parse(text: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    die(`${label} 이 JSON 이 아니다 — ${(error as Error).message}`);
  }
}

/**
 * 게시 전 안전장치. 「형식이 맞다」가 아니라 「이걸 올리면 사고인가」를 본다.
 * 규칙 사고는 조용하다 — 열려 버려도 화면은 멀쩡하고, 새는 건 나중에 안다.
 */
function guard(text: string): void {
  const parsed = parse(text, LOCAL);
  const rules = parsed.rules as Record<string, unknown> | undefined;
  if (!rules || typeof rules !== 'object') die(`${LOCAL} 최상위에 "rules" 가 없다`);
  if (rules['.read'] === true || rules['.write'] === true) {
    die('루트가 전면 개방(.read/.write = true)이다. 이건 게시하지 않는다.');
  }
  const flat = flatten(rules);
  const open = [...flat].filter(([path, value]) => /\/\.(read|write)$/.test(`/${path}`) && value === 'true');
  if (open.length) {
    console.log(`\n  ⚠ 무조건 허용(true) 규칙 ${open.length}건 — 의도한 것인지 확인:`);
    for (const [path] of open.slice(0, 12)) console.log(`      ${path}`);
  }
  if (flat.size < 50) die(`규칙 항목이 ${flat.size}개뿐이다. 파일이 잘린 것 아닌지 확인 후 다시.`);
}

function diffPaths(liveText: string, localText: string) {
  const live = flatten((parse(liveText, '라이브 규칙').rules || {}) as object);
  const local = flatten((parse(localText, LOCAL).rules || {}) as object);
  const added = [...local.keys()].filter((k) => !live.has(k));
  const removed = [...live.keys()].filter((k) => !local.has(k));
  const changed = [...local.keys()].filter((k) => live.has(k) && live.get(k) !== local.get(k));
  return { live, local, added, removed, changed };
}

function saveBackup(text: string, tag: string): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = join(BACKUP_DIR, `${stamp()}-${tag}.json`);
  writeFileSync(file, text, 'utf8');
  return file;
}

function latestBackup(): string {
  let files: string[] = [];
  try {
    files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json')).sort();
  } catch {
    die(`백업이 없다 (${BACKUP_DIR}). 되돌릴 대상이 없다.`);
  }
  if (!files.length) die(`백업이 없다 (${BACKUP_DIR}). 되돌릴 대상이 없다.`);
  return join(BACKUP_DIR, files[files.length - 1]);
}

async function main() {
  const { cmd, flags, rest } = argv();
  const localText = readFileSync(LOCAL, 'utf8');

  if (cmd === 'backup') {
    const file = saveBackup(await fetchLive(), 'manual');
    console.log(`\n  라이브 규칙 백업 → ${file}\n`);
    return;
  }

  if (cmd === 'status' || cmd === 'diff') {
    const liveText = await fetchLive();
    const { live, local, added, removed, changed } = diffPaths(liveText, localText);
    console.log(`\n  프로젝트 ${PROJECT_ID}`);
    console.log(`  라이브 ${live.size}항목 · 로컬 ${local.size}항목`);
    if (!added.length && !removed.length && !changed.length) {
      console.log('\n  ✔ 라이브와 로컬이 같다 — 게시할 것이 없다.\n');
      return;
    }
    console.log(`\n  추가 ${added.length} · 삭제 ${removed.length} · 변경 ${changed.length}`);
    const show = cmd === 'diff' ? 200 : 10;
    for (const path of added.slice(0, show)) console.log(`    + ${path}`);
    for (const path of removed.slice(0, show)) console.log(`    - ${path}`);
    for (const path of changed.slice(0, show)) {
      console.log(`    ~ ${path}`);
      if (cmd === 'diff') {
        console.log(`        라이브 ${String(live.get(path)).slice(0, 150)}`);
        console.log(`        로컬   ${String(local.get(path)).slice(0, 150)}`);
      }
    }
    const total = added.length + removed.length + changed.length;
    if (total > show) console.log(`    … 외 ${total - show}건 (diff 로 전체 보기)`);
    console.log(`\n  게시하려면: npm run rules:deploy -- --yes\n`);
    return;
  }

  if (cmd === 'deploy') {
    guard(localText);
    const liveText = await fetchLive();
    const { added, removed, changed } = diffPaths(liveText, localText);
    if (!added.length && !removed.length && !changed.length) {
      console.log('\n  ✔ 이미 같다 — 게시하지 않았다.\n');
      return;
    }
    console.log(`\n  프로젝트 ${PROJECT_ID}`);
    console.log(`  추가 ${added.length} · 삭제 ${removed.length} · 변경 ${changed.length}`);
    // 삭제는 «권한이 사라지는» 방향이라 사고가 크다. 항상 전부 보여 준다.
    for (const path of removed) console.log(`    - ${path}`);
    if (!flags.has('--yes')) {
      console.log('\n  미리보기만 했다. 실제 게시는 --yes 를 붙인다.\n');
      return;
    }
    const backup = saveBackup(liveText, 'pre-deploy');
    console.log(`  게시 직전 백업 → ${backup}`);
    await putRules(localText);
    const after = await fetchLive();
    const verify = diffPaths(after, localText);
    if (verify.added.length || verify.removed.length || verify.changed.length) {
      die(`게시했지만 라이브가 로컬과 다르다. 되돌리기: npm run rules:rollback -- --yes`);
    }
    console.log(`\n  ✔ 게시 완료 · 라이브 재확인 일치`);
    console.log(`    되돌리려면: npm run rules:rollback -- --yes\n`);
    return;
  }

  if (cmd === 'rollback') {
    const file = rest[0] || latestBackup();
    const text = readFileSync(file, 'utf8');
    guard(text);
    console.log(`\n  되돌릴 대상 ${file}`);
    const liveText = await fetchLive();
    const { added, removed, changed } = diffPaths(liveText, text);
    console.log(`  추가 ${added.length} · 삭제 ${removed.length} · 변경 ${changed.length}`);
    if (!flags.has('--yes')) {
      console.log('\n  미리보기만 했다. 실제 되돌리기는 --yes 를 붙인다.\n');
      return;
    }
    saveBackup(liveText, 'pre-rollback');
    await putRules(text);
    console.log(`\n  ✔ 되돌리기 완료\n`);
    return;
  }

  console.log(`
  사용법
    npm run rules:status                  라이브 vs 로컬 요약
    npm run rules:diff                    달라진 규칙경로 상세
    npm run rules:backup                  라이브 규칙 백업
    npm run rules:deploy                  미리보기 (게시 안 함)
    npm run rules:deploy -- --yes         실제 게시 (직전 백업 자동)
    npm run rules:rollback -- --yes       최근 백업으로 되돌리기
`);
}

main().catch((error) => { console.error(error); process.exit(1); });
