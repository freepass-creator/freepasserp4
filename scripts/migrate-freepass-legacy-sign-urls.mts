/**
 * 과거 v4 계약 목록의 raw `fps_` 고객 링크를 서버 전용 노드로 이관한다.
 *
 * 계약 목록의 링크는 bearer credential 이므로 담당 영업자/공급사에게 노출되면 안 된다.
 * 새 발행본은 `v4/esign_private/{contract}/{sessionHash}/internal_sign_url`에만 보관하지만,
 * 이전 링크는 `v4/contracts/<contractCode>/esign_sign_url`에 남아 있다.
 *
 * 안전 계약:
 *   - 배포 백업과 동일한 DB SSOT(`scripts/deploy/_ctx.mts`)만 사용한다.
 *   - 실제 backup manifest가 같은 DB의 v4 백업임을 확인하고, 2시간보다 오래된 백업은 거부한다.
 *   - token hash / contract session hash / session.contractCode / private token이 모두 맞아야 한다.
 *   - 각 private 복사와 public 제거는 ETag CAS로 실행한다. 중간에 링크가 바뀌면 그 계약은 건드리지 않는다.
 *   - 어느 계약이라도 경쟁·불일치가 있으면 exit 1로 끝내 재실행 또는 운영자 점검을 요구한다.
 *
 * 기본은 dry-run이며 계약번호·URL·token·hash 같은 식별값은 절대 출력하지 않는다.
 *
 *   npx tsx --env-file=.env.local scripts/migrate-freepass-legacy-sign-urls.mts
 *   npm run backup:export
 *   npx tsx --env-file=.env.local scripts/migrate-freepass-legacy-sign-urls.mts \
 *     --apply --confirm=clear-legacy-fps-links --backup-stamp=<backup-id>
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATABASE_URL, RTDB_BACKUP_ROOT, accessToken } from './deploy/_ctx.mts';

type Rec = Record<string, unknown>;
export type Versioned = { value: unknown; etag: string };
type TransactionResult = { status: 'written' | 'unchanged' | 'aborted'; reason?: string };
export type LegacySignUrlCandidate = { contractCode: string; hash: string; rawUrl: string; canonicalUrl: string };
type Candidate = LegacySignUrlCandidate;
export type CasDecision = { next?: unknown; status: 'unchanged' | 'aborted'; reason: string } | { next: unknown; status: 'write' };
export type CasIo = {
  readVersioned: (path: string) => Promise<Versioned>;
  putIfMatch: (path: string, value: unknown, etag: string) => Promise<'written' | 'conflict'>;
};

const BACKUP_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const ISSUE_CLAIM_TIMEOUT_MS = 30_000;
const S = (value: unknown) => String(value ?? '').trim();
const isRecord = (value: unknown): value is Rec => !!value && typeof value === 'object' && !Array.isArray(value);
const isRtdbKey = (value: string) => !!value && !/[.#$\[\]/]/.test(value);
const isHash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const canonicalDatabaseUrl = (value: unknown) => S(value).replace(/\/+$/, '');

export const freepassSignTokenFromUrl = (value: unknown) => S(value).match(/\/(?:sign\/)?(fps_[A-Za-z0-9_-]+)(?:[/?#]|$)/)?.[1] || '';
export const hashFreepassSignToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/** 운영 이관은 명시적으로 구성된 HTTPS 공개 주소만 신뢰한다. 원 URL의 도메인은 재사용하지 않는다. */
export function configuredFreepassPublicBase(value = process.env.FREEPASS_ESIGN_PUBLIC_BASE_URL): string {
  try {
    const url = new URL(S(value));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

export function canonicalLegacyFreepassSignUrl(token: string, publicBase = process.env.FREEPASS_ESIGN_PUBLIC_BASE_URL): string {
  const base = configuredFreepassPublicBase(publicBase);
  return base && /^fps_[A-Za-z0-9_-]+$/.test(token) ? `${base}/${token}` : '';
}

export function sameFreepassSignToken(first: unknown, second: unknown): boolean {
  const a = freepassSignTokenFromUrl(first);
  const b = freepassSignTokenFromUrl(second);
  return !!a && !!b && a === b;
}

let bearer = '';
async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  if (!bearer) bearer = await accessToken();
  return { Authorization: `Bearer ${bearer}`, ...extra };
}

function endpoint(path: string): string {
  return `${canonicalDatabaseUrl(DATABASE_URL)}/${path}.json`;
}

function pathLabel(path: string): string {
  if (path === 'v4/contracts') return '계약 목록';
  if (path.startsWith('v4/contracts/')) return '계약';
  if (path.startsWith('v4/esign_sessions/')) return '전자계약 세션';
  if (path.startsWith('v4/esign_private/')) return '전자계약 private 보관소';
  if (path.startsWith('v4/esign_issue_claims/')) return '전자계약 발행 잠금';
  return 'RTDB 노드';
}

async function read(path: string): Promise<unknown> {
  const response = await fetch(endpoint(path), { headers: await authHeaders() });
  if (!response.ok) throw new Error(`${pathLabel(path)} 읽기 실패 (HTTP ${response.status})`);
  return response.json();
}

async function readVersioned(path: string): Promise<Versioned> {
  const response = await fetch(endpoint(path), { headers: await authHeaders({ 'X-Firebase-ETag': 'true' }) });
  if (!response.ok) throw new Error(`${pathLabel(path)} 조건부 읽기 실패 (HTTP ${response.status})`);
  const etag = response.headers.get('etag') || '';
  if (!etag) throw new Error(`${pathLabel(path)} ETag를 받지 못했습니다.`);
  return { value: await response.json(), etag };
}

async function putIfMatch(path: string, value: unknown, etag: string): Promise<'written' | 'conflict'> {
  const response = await fetch(endpoint(path), {
    method: 'PUT',
    headers: await authHeaders({ 'Content-Type': 'application/json', 'if-match': etag }),
    body: JSON.stringify(value),
  });
  if (response.status === 412) return 'conflict';
  if (!response.ok) throw new Error(`${pathLabel(path)} 조건부 쓰기 실패 (HTTP ${response.status})`);
  return 'written';
}

export async function runCasTransaction(
  io: CasIo,
  path: string,
  mutate: (current: unknown) => CasDecision,
): Promise<TransactionResult> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await io.readVersioned(path);
    const decision = mutate(current.value);
    if (decision.status === 'unchanged' || decision.status === 'aborted') {
      return { status: decision.status, reason: decision.reason };
    }
    if (await io.putIfMatch(path, decision.next, current.etag) === 'written') return { status: 'written' };
  }
  return { status: 'aborted', reason: '동시 변경이 계속되어 안전하게 이관하지 못했습니다.' };
}

async function transaction(path: string, mutate: (current: unknown) => CasDecision): Promise<TransactionResult> {
  return runCasTransaction({ readVersioned, putIfMatch }, path, mutate);
}

export function verifyBackup(stamp: string, backupRoot = RTDB_BACKUP_ROOT): void {
  if (!/^[A-Za-z0-9._-]+$/.test(stamp)) throw new Error('백업 식별자가 올바르지 않습니다.');
  const directory = join(backupRoot, stamp);
  const manifestPath = join(directory, 'manifest.json');
  const v4Path = join(directory, 'v4.json');
  const rehearsalPath = join(directory, 'v4.rehearsal.json');
  if (!existsSync(manifestPath) || !existsSync(v4Path) || !existsSync(rehearsalPath)) {
    throw new Error('지정한 백업의 manifest·v4 백업 파일·v4 복구 리허설 증명을 모두 찾지 못했습니다.');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { at?: unknown; database?: unknown; nodes?: unknown };
  if (canonicalDatabaseUrl(manifest.database) !== canonicalDatabaseUrl(DATABASE_URL)) {
    throw new Error('백업 manifest의 DB가 이관 대상 DB와 다릅니다.');
  }
  if (!isRecord(manifest.nodes) || !isRecord(manifest.nodes.v4)) {
    throw new Error('백업 manifest에 v4 노드 백업 근거가 없습니다.');
  }
  const v4Meta = manifest.nodes.v4;
  const v4Text = readFileSync(v4Path, 'utf8');
  const v4Bytes = Buffer.byteLength(v4Text);
  const v4Sha256 = createHash('sha256').update(v4Text, 'utf8').digest('hex');
  let v4Value: unknown;
  try { v4Value = JSON.parse(v4Text); }
  catch { throw new Error('v4 백업 JSON을 읽지 못했습니다.'); }
  if (Number(v4Meta.bytes) !== v4Bytes || Number(v4Meta.count) !== (isRecord(v4Value) ? Object.keys(v4Value).length : 0)
    || S(v4Meta.sha256) !== v4Sha256) {
    throw new Error('v4 백업 파일이 manifest의 byte·건수·sha256과 일치하지 않습니다.');
  }
  const manifestAt = Date.parse(S(manifest.at));
  const capturedAt = Date.parse(S(v4Meta.capturedAt));
  if (!Number.isFinite(manifestAt) || !Number.isFinite(capturedAt)
    || capturedAt > manifestAt || capturedAt > Date.now() + 5 * 60 * 1000
    || Date.now() - capturedAt > BACKUP_MAX_AGE_MS) {
    throw new Error('v4 백업 시점이 없거나 2시간보다 오래되었습니다. 이관 직전에 새 백업을 만드세요.');
  }
  const rehearsal = JSON.parse(readFileSync(rehearsalPath, 'utf8')) as { at?: unknown; database?: unknown; node?: unknown; backupSha256?: unknown };
  const rehearsalAt = Date.parse(S(rehearsal.at));
  if (canonicalDatabaseUrl(rehearsal.database) !== canonicalDatabaseUrl(DATABASE_URL)
    || S(rehearsal.node) !== 'v4' || S(rehearsal.backupSha256) !== v4Sha256
    || !Number.isFinite(rehearsalAt) || rehearsalAt < capturedAt || rehearsalAt > Date.now() + 5 * 60 * 1000
    || Date.now() - rehearsalAt > BACKUP_MAX_AGE_MS) {
    throw new Error('v4 복구 리허설 증명이 현재 백업/DB와 일치하지 않습니다. 이관 직전에 v4 rehearse를 다시 실행하세요.');
  }
}

type Counts = {
  contracts: number;
  rawLinks: number;
  eligible: number;
  alreadyPrivate: number;
  nonFreepassLink: number;
  invalidContractKey: number;
  invalidSessionHash: number;
  tokenHashMismatch: number;
  missingSession: number;
  sessionContractMismatch: number;
  sessionProviderMismatch: number;
  privateConflict: number;
  publicBaseMissing: number;
};

function newCounts(): Counts {
  return {
    contracts: 0, rawLinks: 0, eligible: 0, alreadyPrivate: 0,
    nonFreepassLink: 0, invalidContractKey: 0, invalidSessionHash: 0,
    tokenHashMismatch: 0, missingSession: 0, sessionContractMismatch: 0, sessionProviderMismatch: 0, privateConflict: 0,
    publicBaseMissing: 0,
  };
}

async function scanCandidates(publicBase: string): Promise<{ candidates: Candidate[]; counts: Counts }> {
  const contracts = ((await read('v4/contracts')) || {}) as Record<string, Rec>;
  const counts = newCounts();
  const candidates: Candidate[] = [];
  for (const [contractCode, contract] of Object.entries(contracts)) {
    counts.contracts++;
    const rawUrl = S(contract?.esign_sign_url);
    if (!rawUrl) continue;
    counts.rawLinks++;
    if (!isRtdbKey(contractCode)) { counts.invalidContractKey++; continue; }
    const token = freepassSignTokenFromUrl(rawUrl);
    if (!token) { counts.nonFreepassLink++; continue; }
    const canonicalUrl = canonicalLegacyFreepassSignUrl(token, publicBase);
    if (!canonicalUrl) { counts.publicBaseMissing++; continue; }
    const hash = S(contract?.esign_session_hash).toLowerCase();
    if (!isHash(hash)) { counts.invalidSessionHash++; continue; }
    if (hashFreepassSignToken(token) !== hash) { counts.tokenHashMismatch++; continue; }

    const [session, privateRow] = await Promise.all([
      read(`v4/esign_sessions/${hash}`),
      read(`v4/esign_private/${contractCode}/${hash}`),
    ]);
    if (!isRecord(session)) { counts.missingSession++; continue; }
    if (S(session.contractCode) !== contractCode) { counts.sessionContractMismatch++; continue; }
    if (S(session.provider) !== 'freepass') { counts.sessionProviderMismatch++; continue; }
    const existingPrivateUrl = isRecord(privateRow) ? S(privateRow.internal_sign_url) : '';
    if (existingPrivateUrl && !sameFreepassSignToken(existingPrivateUrl, rawUrl)) {
      counts.privateConflict++;
      continue;
    }
    candidates.push({ contractCode, hash, rawUrl, canonicalUrl });
    counts.eligible++;
    if (existingPrivateUrl === canonicalUrl) counts.alreadyPrivate++;
  }
  return { candidates, counts };
}

function unsafeCount(counts: Counts): number {
  return counts.nonFreepassLink + counts.invalidContractKey + counts.invalidSessionHash
    + counts.tokenHashMismatch + counts.missingSession + counts.sessionContractMismatch + counts.sessionProviderMismatch
    + counts.privateConflict + counts.publicBaseMissing;
}

function printCounts(counts: Counts, apply: boolean) {
  const unsafe = unsafeCount(counts);
  console.log(`\n══ 프리패스 구형 고객 링크 ${apply ? '이관' : '미리보기(dry-run)'} ══\n`);
  console.log(`  v4 계약 스캔          ${counts.contracts}건`);
  console.log(`  공개 raw 링크          ${counts.rawLinks}건`);
  console.log(`  안전 이관 가능         ${counts.eligible}건 (이미 private ${counts.alreadyPrivate}건)`);
  console.log(`  안전성 보류 합계       ${unsafe}건`);
  console.log(`    비-FPS 링크          ${counts.nonFreepassLink}건`);
  console.log(`    세션 해시 이상       ${counts.invalidSessionHash + counts.tokenHashMismatch}건`);
  console.log(`    세션 연결 이상       ${counts.missingSession + counts.sessionContractMismatch + counts.sessionProviderMismatch}건`);
  console.log(`    private 충돌         ${counts.privateConflict}건`);
  console.log(`    정규 공개주소 미설정 ${counts.publicBaseMissing}건`);
}

export function privateLinkDecision(current: unknown, canonicalUrl: string): CasDecision {
  const row = isRecord(current) ? current : {};
  const existing = S(row.internal_sign_url);
  if (existing && !sameFreepassSignToken(existing, canonicalUrl)) {
    return { status: 'aborted', reason: 'private 링크가 스캔 뒤 바뀌었습니다.' };
  }
  if (existing === canonicalUrl) return { status: 'unchanged', reason: '정규 private 링크가 이미 있습니다.' };
  return { status: 'write', next: { ...row, internal_sign_url: canonicalUrl } };
}

export function publicLinkDecision(current: unknown, candidate: Candidate): CasDecision {
  if (!isRecord(current)) return { status: 'aborted', reason: '계약이 사라졌습니다.' };
  if (S(current.esign_sign_url) === '' && S(current.esign_session_hash).toLowerCase() === candidate.hash) {
    return { status: 'unchanged', reason: '다른 안전한 이관이 이미 공개 링크를 지웠습니다.' };
  }
  if (S(current.esign_sign_url) !== candidate.rawUrl || S(current.esign_session_hash).toLowerCase() !== candidate.hash) {
    return { status: 'aborted', reason: '계약 링크 또는 세션이 스캔 뒤 바뀌었습니다.' };
  }
  return { status: 'write', next: { ...current, esign_sign_url: null } };
}

async function migrateOne(candidate: Candidate): Promise<'migrated' | 'skipped'> {
  // 앱의 issue route와 같은 claim을 먼저 잡는다. 이후 route가 새 링크를 발행할 수 없고,
  // 각 CAS는 RTDB 직접 변경 또는 기존 writer와의 경쟁도 별도로 fail-closed 한다.
  const claimPath = `v4/esign_issue_claims/${candidate.contractCode}`;
  const claimId = `legacy-url-migration-${randomBytes(12).toString('hex')}`;
  const claimAt = Date.now();
  const claimed = await transaction(claimPath, (current) => {
    const row = isRecord(current) ? current : {};
    if (S(row.claimId) && Number(row.claimedAt || 0) > Date.now() - ISSUE_CLAIM_TIMEOUT_MS) {
      return { status: 'aborted', reason: '다른 고객 링크 발행이 진행 중입니다.' };
    }
    return { status: 'write', next: { claimId, claimedAt: claimAt, claimedBy: 'legacy-url-migration' } };
  });
  if (claimed.status !== 'written') return 'skipped';

  try {
    const contract = await read(`v4/contracts/${candidate.contractCode}`);
    if (!isRecord(contract) || S(contract.esign_session_hash).toLowerCase() !== candidate.hash) return 'skipped';
    const currentPublicUrl = S(contract.esign_sign_url);
    if (currentPublicUrl && currentPublicUrl !== candidate.rawUrl) return 'skipped';

    const session = await read(`v4/esign_sessions/${candidate.hash}`);
    if (!isRecord(session) || S(session.contractCode) !== candidate.contractCode || S(session.provider) !== 'freepass') return 'skipped';

    const privatePath = `v4/esign_private/${candidate.contractCode}/${candidate.hash}`;
    if (currentPublicUrl) {
      const privateResult = await transaction(privatePath, (current) => privateLinkDecision(current, candidate.canonicalUrl));
      if (privateResult.status === 'aborted') return 'skipped';
      const contractResult = await transaction(`v4/contracts/${candidate.contractCode}`, (current) => publicLinkDecision(current, candidate));
      if (contractResult.status === 'aborted') return 'skipped';
    }

    const [finalContract, finalSession, privateUrl] = await Promise.all([
      read(`v4/contracts/${candidate.contractCode}`),
      read(`v4/esign_sessions/${candidate.hash}`),
      read(`${privatePath}/internal_sign_url`),
    ]);
    return isRecord(finalContract) && isRecord(finalSession)
      && S(finalContract.esign_sign_url) === '' && S(finalContract.esign_session_hash).toLowerCase() === candidate.hash
      && S(finalSession.contractCode) === candidate.contractCode && S(finalSession.provider) === 'freepass'
      && S(privateUrl) === candidate.canonicalUrl
      ? 'migrated'
      : 'skipped';
  } finally {
    await transaction(claimPath, (current) => {
      if (!isRecord(current) || S(current.claimId) !== claimId) {
        return { status: 'unchanged', reason: 'claim 소유자가 바뀌어 정리하지 않습니다.' };
      }
      return { status: 'write', next: null };
    }).catch(() => {});
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const confirmed = process.argv.includes('--confirm=clear-legacy-fps-links');
  const backupStamp = process.argv.find((arg) => arg.startsWith('--backup-stamp='))?.slice('--backup-stamp='.length) || '';
  const publicBase = configuredFreepassPublicBase();
  if (apply && (!confirmed || !backupStamp)) {
    throw new Error('실반영은 백업 후 --apply --confirm=clear-legacy-fps-links --backup-stamp=<backup-id>를 함께 지정해야 합니다.');
  }
  if (apply && !publicBase) {
    throw new Error('실반영에는 FREEPASS_ESIGN_PUBLIC_BASE_URL의 HTTPS 공개 주소가 필요합니다. 원 URL 도메인은 재사용하지 않습니다.');
  }
  if (apply) verifyBackup(backupStamp);

  const { candidates, counts } = await scanCandidates(publicBase);
  printCounts(counts, apply);
  if (!apply) {
    console.log('\n※ dry-run입니다. URL·토큰·계약번호를 출력하거나 변경하지 않았습니다.');
    console.log('  실제 반영 전에는 `npm run backup:export` 후 같은 백업 식별자를 지정하세요.\n');
    return;
  }
  if (unsafeCount(counts)) {
    throw new Error(`안전성 보류 ${unsafeCount(counts)}건이 있어 전체 이관을 시작하지 않았습니다.`);
  }

  let migrated = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    if (await migrateOne(candidate) === 'migrated') migrated++;
    else skipped++;
  }
  // 최초 스캔 이후 다른 계약에 raw 링크가 생긴 경우도 성공으로 오인하면 안 된다.
  // 전체 재스캔이 0건이어야만 이관 완료를 보고한다. 남은 건은 다음 실행에서 새 후보로 잡는다.
  const after = await scanCandidates(publicBase);
  console.log(`\n  이관 및 재읽기 검증   ${migrated}건`);
  console.log(`  경쟁·변경으로 보류    ${skipped}건`);
  console.log(`  최종 공개 raw 링크    ${after.counts.rawLinks}건`);
  console.log(`  검증한 백업 식별자    ${backupStamp}`);
  if (skipped || after.counts.rawLinks || unsafeCount(after.counts)) {
    throw new Error('이관 중 변경되었거나 새 공개 링크가 생겨 완료를 선언하지 않습니다. 재점검 후 다시 실행하세요.');
  }
  console.log('  공개 계약 노드의 raw fps_ 링크는 제거했고, 일치한 링크만 서버 전용 private 노드에 보관했습니다.\n');
}

const invokedFile = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedFile) {
  main().catch((error) => {
    console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
