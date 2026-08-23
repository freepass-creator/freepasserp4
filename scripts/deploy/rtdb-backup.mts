/**
 * RTDB 데이터 백업·복구 — 규칙과 달리 **데이터는 되돌릴 방법이 없다.**
 *
 *   tsx scripts/deploy/rtdb-backup.mts export              전체를 파일로 내려받는다
 *   tsx scripts/deploy/rtdb-backup.mts list                받아 둔 백업 목록
 *   tsx scripts/deploy/rtdb-backup.mts verify [디렉터리]    백업 vs 라이브 건수 대조
 *   tsx scripts/deploy/rtdb-backup.mts rehearse [디렉터리]  **실데이터를 안 건드리고** 복구를 실제로 해 본다
 *   tsx scripts/deploy/rtdb-backup.mts restore <노드> [디렉터리] --yes   진짜 복구
 *
 * ★ 왜 리허설이 따로 있나
 *   「백업이 있다」와 「그 백업으로 되돌릴 수 있다」는 다른 말이다. 대부분의 백업은
 *   되돌려 본 적이 없어서, 정작 필요한 날 형식이 안 맞거나 권한이 없어서 못 쓴다.
 *   그래서 rehearse 는 백업을 **샌드박스 노드**(v4/_restore_rehearsal)에 실제로 써 넣고
 *   원본과 한 건씩 대조한 뒤 지운다. 운영 데이터는 한 글자도 안 바뀐다.
 *
 * ★ 코드는 1분, 데이터는 영영
 *   코드는 직전 배포 Promote 로 되돌아간다. 규칙은 rules:rollback 이 있다.
 *   데이터만 아무 장치가 없었다 — 이 스크립트가 그 자리를 메운다.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATABASE_URL, SA_PATH, RTDB_BACKUP_ROOT, accessToken, argv, stamp, die } from './_ctx.mts';

/** 백업은 순차 접근 대용량이라 D(기계식)에 둔다 — 코드·캐시가 아니다. */
const ROOT = RTDB_BACKUP_ROOT;
const SANDBOX = 'v4/_restore_rehearsal';

/** 전체 노드. 하나라도 빠지면 «백업했다»가 거짓말이 되므로 실측 목록을 박아 둔다. */
const NODES = [
  'contracts', 'messages', 'product_code_aliases', 'code_sequences', 'api_keys',
  'counters', 'users', 'audit_logs', 'fcm_tokens', 'products', 'rooms', 'partners',
  'v4', 'input_codes', 'vehicle_master', 'home_notices', 'contract_sign', 'customers',
  'settlements', 'policies',
] as const;

type BackupNode = { count: number; bytes: number; sha256: string; capturedAt: string };
type BackupManifest = { at?: unknown; database?: unknown; nodes?: Record<string, BackupNode> };

async function getNode(path: string): Promise<unknown> {
  const res = await fetch(`${DATABASE_URL}/${path}.json`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (!res.ok) throw new Error(`읽기 실패 ${path} (HTTP ${res.status})`);
  return res.json();
}

async function putNode(path: string, value: unknown): Promise<void> {
  const res = await fetch(`${DATABASE_URL}/${path}.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value ?? null),
  });
  if (!res.ok) throw new Error(`쓰기 실패 ${path} (HTTP ${res.status})\n    ${(await res.text()).slice(0, 300)}`);
}

const countOf = (value: unknown): number => (value && typeof value === 'object' ? Object.keys(value as object).length : 0);
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** 백업 파일 자체가 manifest와 같은지 확인한 뒤에만 restore/rehearse 대상으로 사용한다. */
function verifiedBackupNode(dir: string, node: string, manifest: BackupManifest): unknown {
  const file = join(dir, `${node}.json`);
  if (!existsSync(file)) die(`${file} 이 없다`);
  const text = readFileSync(file, 'utf8');
  const metadata = manifest.nodes?.[node];
  if (!metadata || !Number.isFinite(metadata.bytes) || !Number.isFinite(metadata.count)
    || !/^[a-f0-9]{64}$/.test(String(metadata.sha256 || '')) || !Number.isFinite(Date.parse(String(metadata.capturedAt || '')))) {
    die(`${node} 백업 manifest 무결성 정보가 없다. 새 export를 만든다.`);
  }
  if (Buffer.byteLength(text) !== metadata.bytes || sha256(text) !== metadata.sha256) {
    die(`${node} 백업 파일의 byte/hash가 manifest와 다르다. 이 백업으로 복구하지 않는다.`);
  }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { die(`${node} 백업 JSON을 읽지 못한다.`); }
  if (countOf(value) !== metadata.count) die(`${node} 백업 건수가 manifest와 다르다.`);
  return value;
}

function backupDirs(): string[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT).filter((name) => existsSync(join(ROOT, name, 'manifest.json'))).sort();
}

function latestDir(): string {
  const dirs = backupDirs();
  if (!dirs.length) die(`백업이 없다 (${ROOT}). 먼저 export 를 돌린다.`);
  return join(ROOT, dirs[dirs.length - 1]);
}

async function doExport() {
  const dir = join(ROOT, stamp());
  mkdirSync(dir, { recursive: true });
  const manifest: Record<string, BackupNode> = {};
  let total = 0;
  for (const node of NODES) {
    process.stdout.write(`  ${node} …\r`);
    const value = await getNode(node);
    const capturedAt = new Date().toISOString();
    const text = JSON.stringify(value ?? null);
    writeFileSync(join(dir, `${node}.json`), text, 'utf8');
    manifest[node] = { count: countOf(value), bytes: Buffer.byteLength(text), sha256: sha256(text), capturedAt };
    total += manifest[node].bytes;
    console.log(`  ${node.padEnd(22)} ${String(manifest[node].count).padStart(6)}건  ${mb(manifest[node].bytes).padStart(8)}`);
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), database: DATABASE_URL, nodes: manifest }, null, 2), 'utf8');
  console.log(`\n  ✔ 백업 완료 → ${dir}  (합계 ${mb(total)})`);
  console.log(`    되돌릴 수 있는지 확인: npm run backup:rehearse\n`);
}

function doList() {
  const dirs = backupDirs();
  if (!dirs.length) { console.log(`\n  백업 없음 (${ROOT})\n`); return; }
  console.log(`\n  ${ROOT}`);
  for (const name of dirs) {
    const manifest = JSON.parse(readFileSync(join(ROOT, name, 'manifest.json'), 'utf8')) as BackupManifest;
    const nodes = Object.values(manifest.nodes || {}) as BackupNode[];
    const bytes = nodes.reduce((sum, n) => sum + n.bytes, 0);
    console.log(`    ${name}   노드 ${nodes.length} · ${mb(bytes)}`);
  }
  console.log();
}

async function doVerify(dir: string) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as BackupManifest;
  console.log(`\n  ${dir}\n  받은 시각 ${manifest.at}\n`);
  let drift = 0;
  for (const node of NODES) {
    const savedValue = verifiedBackupNode(dir, node, manifest);
    const saved = countOf(savedValue);
    const live = countOf(await getNode(node));
    const diff = live - saved;
    if (diff !== 0) drift++;
    console.log(`  ${node.padEnd(22)} 백업 ${String(saved).padStart(6)} · 라이브 ${String(live).padStart(6)} ${diff === 0 ? '' : `(${diff > 0 ? '+' : ''}${diff})`}`);
  }
  console.log(drift ? `\n  ${drift}개 노드가 백업 이후 바뀌었다 — 정상이다(운영 중). 복구 시 그만큼을 잃는다는 뜻이다.\n`
    : '\n  백업 시점 이후 변화 없음.\n');
}

/**
 * 복구 리허설 — 백업의 한 노드를 샌드박스에 실제로 써 넣고 원본과 대조한다.
 * 운영 노드는 건드리지 않는다. 「되돌릴 수 있다」를 말이 아니라 결과로 확인하는 유일한 방법이다.
 */
async function doRehearse(dir: string, node = 'contracts') {
  if (!(NODES as readonly string[]).includes(node)) die(`rehearse 대상 노드가 올바르지 않다: ${node}`);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as BackupManifest;
  const saved = verifiedBackupNode(dir, node, manifest);
  const savedCount = countOf(saved);
  // 이전 실패 리허설의 민감한 복사본을 조용히 덮어쓰지 않는다. 사람이 원인을 확인·정리한 뒤에만 재시도한다.
  const existingSandbox = await getNode(SANDBOX);
  if (existingSandbox !== null) {
    die(`기존 복구 리허설 샌드박스가 비어 있지 않습니다: ${SANDBOX}. 내용을 확인·정리한 뒤 다시 실행하세요.`);
  }
  console.log(`\n  리허설 대상 ${node} — 백업 ${savedCount}건`);
  console.log(`  샌드박스 ${SANDBOX} 에 써 넣고 대조한 뒤 지운다. 운영 데이터는 안 건드린다.`);
  let readBack: unknown = null;
  let backCount = 0;
  let same = false;
  let cleared = -1;
  let rehearsalError: unknown = null;
  let cleanupError: unknown = null;
  try {
    await putNode(SANDBOX, saved);
    readBack = await getNode(SANDBOX);
    backCount = countOf(readBack);
    same = JSON.stringify(readBack) === JSON.stringify(saved);
  } catch (error) {
    rehearsalError = error;
  } finally {
    try {
      await putNode(SANDBOX, null);
      cleared = countOf(await getNode(SANDBOX));
      if (cleared !== 0) throw new Error(`샌드박스 정리 뒤 ${cleared}건이 남았습니다.`);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (cleanupError) throw new Error(`복구 리허설 샌드박스를 정리하지 못했습니다: ${String(cleanupError)}`);
  if (rehearsalError) throw rehearsalError;
  console.log(`\n  써 넣은 뒤 다시 읽기   ${backCount}건`);
  console.log(`  내용 완전 일치        ${same ? '예' : '아니오'}`);
  console.log(`  샌드박스 정리         ${cleared === 0 ? '완료' : `남음 ${cleared}건`}`);
  if (!same || backCount !== savedCount || cleared !== 0) die('리허설 실패 — 이 백업으로는 되돌릴 수 없다.');
  if (node === 'v4') {
    const proof = {
      at: new Date().toISOString(),
      database: DATABASE_URL,
      node,
      backupSha256: manifest.nodes?.v4?.sha256 || '',
    };
    writeFileSync(join(dir, 'v4.rehearsal.json'), JSON.stringify(proof, null, 2), 'utf8');
    console.log(`  v4 복구 리허설 증명  ${join(dir, 'v4.rehearsal.json')}`);
  }
  console.log(`\n  ✔ 이 백업으로 실제 복구가 가능하다(${node} 기준).\n`);
}

async function doRestore(node: string, dir: string, yes: boolean) {
  if (!node) die('복구할 노드를 지정한다. 예: restore contracts');
  const file = join(dir, `${node}.json`);
  if (!existsSync(file)) die(`${file} 이 없다`);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as BackupManifest;
  const saved = verifiedBackupNode(dir, node, manifest);
  const live = await getNode(node);
  console.log(`\n  ${node} — 백업 ${countOf(saved)}건 · 지금 라이브 ${countOf(live)}건`);
  console.log(`  ★복구는 라이브를 백업 시점으로 «덮어쓴다». 그 뒤에 생긴 것은 사라진다.`);
  if (!yes) { console.log('\n  미리보기만 했다. 실제 복구는 --yes 를 붙인다.\n'); return; }
  // 덮어쓰기 전에 지금 상태를 먼저 받아 둔다 — 복구가 잘못됐을 때 돌아올 자리.
  const safety = join(ROOT, `${stamp()}-pre-restore-${node}`);
  mkdirSync(safety, { recursive: true });
  writeFileSync(join(safety, `${node}.json`), JSON.stringify(live ?? null), 'utf8');
  console.log(`  복구 직전 상태 저장 → ${safety}`);
  await putNode(node, saved);
  console.log(`\n  ✔ ${node} 복구 완료 (라이브 ${countOf(await getNode(node))}건)\n`);
}

async function main() {
  const { cmd, flags, rest } = argv();
  if (cmd === 'export') { await doExport(); }
  else if (cmd === 'list') { doList(); }
  else if (cmd === 'verify') { await doVerify(rest[0] || latestDir()); }
  else if (cmd === 'rehearse') {
    const nodeFlag = [...flags].find((flag) => flag.startsWith('--node='))?.slice('--node='.length) || 'contracts';
    await doRehearse(rest[0] || latestDir(), nodeFlag);
  }
  else if (cmd === 'restore') { await doRestore(rest[0], rest[1] || latestDir(), flags.has('--yes')); }
  else {
    console.log(`
  사용법
    npm run backup:export                   전체 백업 (${ROOT})
    npm run backup:list                     받아 둔 백업 목록
    npm run backup:verify                   백업 vs 라이브 건수 대조
    npm run backup:rehearse                 운영 무손상 contracts 복구 리허설
    npm run backup:rehearse -- --node=v4    v4 전체 복구 리허설(전자계약 이관 전 필수)
    npm run backup:restore -- contracts --yes   진짜 복구 (직전 상태 자동 저장)
`);
  }
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
