/**
 * v3-only 재고를 최신 공급사 Sheet·계약·채팅 참조와 읽기 전용으로 대조한다.
 * Firebase/Google Sheet/로컬 파일 write 없음.
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/audit-v3-only-sheet-coverage.mts
 */
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { allowedHost } from '../lib/net/proxy-hosts';
import { resolveGoogleSheetCsvUrl } from '../lib/domain/sheet-url';
import { parseDelimited } from '../lib/domain/sheet-import';
import {
  canonicalSheetProductsFromLines,
  fetchAllPartnerSheets,
  findSheetSyncExistingConflicts,
  sheetSyncCommitBlockReason,
} from '../lib/domain/sheet-sync-all';
import { planDailySheetSync } from '../lib/domain/sheet-daily-sync';
import { buildSheetConflictReportRows } from '../lib/domain/sheet-conflict-report';
import { toV4Record } from '../lib/firebase/rtdb-records';
import { splitProductPrivate } from '../lib/firebase/rtdb-products';
import { priceList } from '../lib/domain/product';
import { sheetProviderOf } from '../lib/domain/sheet-merge';
import {
  KEEP_EXISTING_PRICES,
  PRICE_PERIOD_CONFLICT,
  isPriceConflictProtected,
  sheetConflictFingerprint,
} from '../lib/domain/sheet-conflict-resolution';
import { planSheetIdentityConflictReview } from '../lib/domain/sheet-identity-conflict-review';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
type Row = [string, Rec];

const DB_URL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
  || process.env.FIREBASE_DATABASE_URL
  || 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const useFirebaseCli = process.argv.includes('--firebase-cli');
const firebaseProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'freepasserp3';
const firebaseInstance = process.env.FIREBASE_DATABASE_INSTANCE
  || new URL(DB_URL).hostname.split('.')[0];
const candidateRp023Rule = process.argv
  .find((arg) => arg.startsWith('--candidate-rp023='))
  ?.slice('--candidate-rp023='.length);
if (candidateRp023Rule && !['rent_multiple', 'months_per_year'].includes(candidateRp023Rule)) {
  throw new Error(`지원하지 않는 RP023 후보 규칙: ${candidateRp023Rule}`);
}
const skipDailyPlan = process.argv.includes('--skip-daily-plan');
const showProtected = process.argv.includes('--show-protected');
const showConflictProvider = process.argv
  .find((arg) => arg.startsWith('--show-conflicts='))
  ?.slice('--show-conflicts='.length)
  .trim();
let db: ReturnType<typeof getDatabase> | null = null;
if (!useFirebaseCli) {
  initializeApp({
    credential: serviceAccount ? cert(JSON.parse(serviceAccount)) : applicationDefault(),
    databaseURL: DB_URL,
  });
  db = getDatabase();
}

type SnapshotLike = { val: () => unknown };

function firebaseCliSnapshot(path: string): Promise<SnapshotLike> {
  return new Promise((resolve, reject) => {
    const npxArgs = [
      '--yes', 'firebase-tools@13', 'database:get', `/${path}`,
      '--project', firebaseProject,
      '--instance', firebaseInstance,
      '--non-interactive',
    ];
    const windowsNpx = process.env.NPX_CLI_JS
      || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    const command = process.platform === 'win32' ? process.execPath : 'npx';
    const args = process.platform === 'win32' ? [windowsNpx, ...npxArgs] : npxArgs;
    execFile(command, args, {
      encoding: 'utf8',
      env: { ...process.env, DEBUG: '' },
      maxBuffer: 128 * 1024 * 1024,
      timeout: 120_000,
    }, (error, stdout, stderr) => {
      try {
        const payload = String(stdout || '').trim();
        if (!payload) throw new Error('empty stdout');
        const value = JSON.parse(payload);
        // npx/firebase-tools가 Node engine 경고를 stderr와 비정상 종료코드로 남겨도
        // stdout에 완전한 JSON snapshot이 있으면 읽기 결과 자체는 유효하다.
        // JSON이 불완전하거나 비어 있으면 아래 catch에서 반드시 실패한다.
        resolve({ val: () => value });
      } catch {
        const detail = [String(stderr || '').trim(), error?.message || ''].filter(Boolean).join(' · ');
        reject(new Error(`Firebase CLI returned invalid JSON: ${path}${detail ? ` · ${detail}` : ''}`));
      }
    });
  });
}

function readSnapshot(path: string): Promise<SnapshotLike> {
  if (useFirebaseCli) return firebaseCliSnapshot(path);
  if (!db) throw new Error('Firebase Admin database is not initialized');
  return db.ref(path).get();
}

const S = (value: unknown) => String(value ?? '').trim();
const plate = (row: Rec) => S(row.car_number || row.car_number_snapshot || row.vehicle_number).replace(/\s/g, '');
const alive = (row: Rec) => row && typeof row === 'object'
  && row._deleted !== true && !row.deletedAt && S(row.status) !== 'deleted';
const productKey = (key: string, row: Rec) => S(row.product_code || row._key || key);

function rawRows(raw: unknown): Row[] {
  return Object.entries((raw || {}) as Rec)
    .filter(([, row]) => row && typeof row === 'object') as Row[];
}

function mergeRaw(v3: unknown, v4: unknown): Row[] {
  const merged = new Map<string, Rec>();
  for (const [key, row] of rawRows(v3)) merged.set(key, { ...row, _key: row._key || key });
  for (const [key, row] of rawRows(v4)) merged.set(key, { ...(merged.get(key) || {}), ...row, _key: row._key || key });
  return [...merged.entries()];
}

function normalize(entity: 'partner' | 'product', rows: Row[]): EntityRecord[] {
  return rows.map(([key, row]) => toV4Record(entity, key, row, 'freepass'));
}

/** 실제 앱·일일동기화와 동일하게 v3/v4를 정규화한 뒤 논리키(_key)로 overlay 병합한다. */
function mergeNormalized(entity: 'partner' | 'product', v3Rows: Row[], v4Rows: Row[]): EntityRecord[] {
  const merged = new Map<string, EntityRecord>();
  for (const row of normalize(entity, v3Rows)) merged.set(S(row._key), row);
  for (const row of normalize(entity, v4Rows)) {
    const key = S(row._key);
    const current: EntityRecord = { ...(merged.get(key) || {}) };
    for (const [field, value] of Object.entries(row)) if (value !== undefined) current[field] = value;
    merged.set(key, current);
  }
  return [...merged.values()];
}

async function fetchSheetTable(url: string, gid?: string): Promise<string[][]> {
  const csvUrl = resolveGoogleSheetCsvUrl(url, gid);
  if (!allowedHost(csvUrl, 'sheet')) throw new Error('허용되지 않은 Google Sheet 호스트');
  const response = await fetch(csvUrl, {
    headers: { 'User-Agent': 'freepasserp4-v3-gap-audit/1.0' },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`시트 로드 실패 ${response.status}`);
  const csv = await response.text();
  if (/^\s*<(!doctype|html)/i.test(csv)) throw new Error('시트 비공개 또는 로그인 HTML 응답');
  return parseDelimited(csv);
}

function referenceSummary(rows: Row[], keys: Set<string>, plates: Set<string>) {
  const seen = new Set<string>();
  let exact = 0;
  let byPlate = 0;
  let open = 0;
  for (const [key, row] of rows) {
    if (!alive(row) || seen.has(key)) continue;
    seen.add(key);
    const refs = [row.product_code, row.product_uid, row.product_id].map(S).filter(Boolean);
    let hit = '';
    if (refs.some((ref) => keys.has(ref))) hit = 'exact';
    else if (plates.has(plate(row))) hit = 'plate';
    if (!hit) continue;
    if (hit === 'exact') exact++; else byPlate++;
    const status = S(row.contract_status || row.status).toLowerCase();
    if (!['계약완료', '완료', '계약취소', '취소', 'completed', 'complete', 'cancelled', 'canceled'].includes(status)) open++;
  }
  return { exact, byPlate, open, total: exact + byPlate };
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const value = key(item) || '(없음)';
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

async function main() {
  const [p3, p4, partner3, partner4, contract3, contract4, room3, room4, quote3, quote4, productPrivate4] = await Promise.all([
    readSnapshot('products'), readSnapshot('v4/products'),
    readSnapshot('partners'), readSnapshot('v4/partners'),
    readSnapshot('contracts'), readSnapshot('v4/contracts'),
    readSnapshot('rooms'), readSnapshot('v4/rooms'),
    readSnapshot('quotes'), readSnapshot('v4/quotes'),
    readSnapshot('v4/products_private'),
  ]);

  const v3 = rawRows(p3.val()).filter(([, row]) => alive(row));
  const v4 = rawRows(p4.val()).filter(([, row]) => alive(row));
  const v4Plates = new Set(v4.map(([, row]) => plate(row)).filter(Boolean));
  const v3Only = v3.filter(([, row]) => plate(row) && !v4Plates.has(plate(row)));
  const v3OnlyPlates = new Set(v3Only.map(([, row]) => plate(row)));
  const v3OnlyKeys = new Set(v3Only.flatMap(([key, row]) => [key, productKey(key, row)]).filter(Boolean));

  const partnerRows = mergeNormalized('partner', rawRows(partner3.val()), rawRows(partner4.val()))
    .map((row) => candidateRp023Rule && S(row.partner_code || row._key) === 'RP023'
      ? { ...row, deposit_rule: candidateRp023Rule }
      : row);
  const masterJson = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
  const master = (Array.isArray(masterJson) ? masterJson : masterJson.entries) || [];
  const fetched = await fetchAllPartnerSheets('freepass', master, {
    partnerRows,
    fetchTable: fetchSheetTable,
  });
  const commitBlock = sheetSyncCommitBlockReason(fetched);
  const canonical = canonicalSheetProductsFromLines(fetched);
  const sheetRows = canonical.reason ? fetched.lines.flatMap((line) => line.products) : canonical.products;
  const sheetByPlate = new Map<string, EntityRecord>();
  const sheetOwnersByPlate = new Map<string, Set<string>>();
  for (const row of sheetRows) {
    const p = plate(row as Rec);
    if (p && !sheetByPlate.has(p)) sheetByPlate.set(p, row);
    if (p) {
      const owner = S(row.provider_company_code || row.partner_code);
      if (!sheetOwnersByPlate.has(p)) sheetOwnersByPlate.set(p, new Set());
      if (owner) sheetOwnersByPlate.get(p)!.add(owner);
    }
  }

  const contracts = mergeRaw(contract3.val(), contract4.val());
  const rooms = mergeRaw(room3.val(), room4.val());
  const quotes = mergeRaw(quote3.val(), quote4.val());
  const privateProductKeys = new Set<string>();
  for (const [key, row] of [...rawRows(p3.val()), ...rawRows(p4.val())]) {
    if (splitProductPrivate(row as EntityRecord).privateRecord) privateProductKeys.add(productKey(key, row));
  }
  for (const [key, row] of rawRows(productPrivate4.val())) {
    privateProductKeys.add(S(row.product_code || row._key || key));
  }
  const contractRefs = referenceSummary(contracts, v3OnlyKeys, v3OnlyPlates);
  const roomRefs = referenceSummary(rooms, v3OnlyKeys, v3OnlyPlates);
  const referencedPlates = new Set<string>();
  for (const [, row] of [...contracts, ...rooms]) {
    const refs = [row.product_code, row.product_uid, row.product_id].map(S).filter(Boolean);
    const p = plate(row);
    if (refs.some((ref) => v3OnlyKeys.has(ref)) && p) referencedPlates.add(p);
    else if (p && v3OnlyPlates.has(p)) referencedPlates.add(p);
  }

  const classified = v3Only.map(([key, row]) => {
    const p = plate(row);
    const sheet = sheetByPlate.get(p);
    return {
      key,
      row,
      plate: p,
      inSheet: !!sheet,
      referenced: referencedPlates.has(p),
      providerMatch: !sheet || S(sheet.provider_company_code) === S(row.provider_company_code),
    };
  });
  const category = (item: typeof classified[number]) => item.inSheet
    ? item.referenced ? '시트현재+참조보호' : '시트현재'
    : item.referenced ? '참조만' : '시트없음+참조없음';
  const categories = countBy(classified, category);
  const uniqueCategories = countBy(
    [...new Map(classified.map((item) => [item.plate, item])).values()],
    category,
  );
  const providerMismatch = classified.filter((item) => item.inSheet && !item.providerMatch);

  const reconcileState = skipDailyPlan ? null : (() => {
    const normalized = mergeNormalized('product', rawRows(p3.val()), rawRows(p4.val()));
    return {
      existing: normalized.filter((row) => alive(row as Rec)),
      deleted: normalized.filter((row) => !alive(row as Rec)),
    };
  })();
  const contractEntities = contracts.map(([key, row]) => ({ ...row, _key: row._key || key })) as EntityRecord[];
  const existingConflicts = reconcileState
    ? findSheetSyncExistingConflicts(fetched, reconcileState.existing, reconcileState.deleted)
    : null;
  const plan = reconcileState
    ? planDailySheetSync({ fetched, ...reconcileState, partners: partnerRows, contracts: contractEntities })
    : null;
  const overlayTargets = plan?.patches.filter((item) => v3OnlyKeys.has(item.key)) || [];
  const hypotheticalPriceApprovals = !reconcileState || !existingConflicts ? [] : existingConflicts.missingPricePeriods
    .filter((raw) => !isPriceConflictProtected(raw, reconcileState.existing, contractEntities))
    .map((raw) => ({
      fingerprint: sheetConflictFingerprint(PRICE_PERIOD_CONFLICT, raw),
      category: PRICE_PERIOD_CONFLICT,
      decision: KEEP_EXISTING_PRICES,
      status: 'approved' as const,
    }));
  const approvedPricePlan = reconcileState
    ? planDailySheetSync({
      fetched,
      ...reconcileState,
      partners: partnerRows,
      contracts: contractEntities,
      resolutions: hypotheticalPriceApprovals,
    })
    : null;
  const conflictReport = !reconcileState || !existingConflicts ? [] : buildSheetConflictReportRows({
      conflicts: existingConflicts,
      ...reconcileState,
      incoming: sheetRows,
      contracts: contractEntities,
      providerCodes: fetched.lines.map((line) => line.code),
    });
  const providerCodes = new Set(fetched.lines.map((line) => line.code));
  const ownershipDecisionClasses = !reconcileState || !existingConflicts ? {} : countBy(
    existingConflicts.crossProviderPlateConflicts,
    (raw) => {
      const targetPlate = raw.split(' (')[0].trim();
      const incomingOwners = sheetOwnersByPlate.get(targetPlate) || new Set<string>();
      const protectedByContract = conflictReport.some((row) => row.category === '공급사 소유 충돌'
        && row.carNumber === targetPlate && !!row.contractProtection);
      if (protectedByContract) return '계약보호 · 소유권 자동변경 금지';
      if (incomingOwners.size > 1) return '복수 공급사 Sheet 동시 주장 · 원본 정리 필요';
      return '단일 Sheet 공급사 vs 기존 타공급사 · 소유권 결정 필요';
    },
  );
  const deletedDecisionClasses = !reconcileState || !existingConflicts ? {} : countBy(
    existingConflicts.deletedCollisions,
    (targetPlate) => {
      const incomingRows = sheetRows.filter((row) => plate(row as Rec) === targetPlate);
      const deletedRows = reconcileState.deleted.filter((row) => plate(row as Rec) === targetPlate);
      const protectedByContract = conflictReport.some((row) => row.category === '삭제이력 재등장'
        && row.carNumber === targetPlate && !!row.contractProtection);
      if (protectedByContract) return '계약보호 삭제이력 · 자동복구 금지';
      if (deletedRows.some((row) => S(row._merged_into))) return '병합 별칭 tombstone · 복구 금지';
      const incomingKeys = new Set(incomingRows.flatMap((row) => [S(row._key), S(row.product_code)]).filter(Boolean));
      if (deletedRows.some((row) => [S(row._key), S(row.product_code)].some((key) => incomingKeys.has(key)))) {
        return '동일 상품키 삭제이력 · 복구/재등록 결정 필요';
      }
      const incomingOwners = new Set(incomingRows.map((row) => sheetProviderOf(row, providerCodes)).filter(Boolean));
      if (deletedRows.some((row) => incomingOwners.has(sheetProviderOf(row, providerCodes)))) {
        return '동일 공급사·차번 다른키 삭제이력 · 대표키 결정 필요';
      }
      return '삭제이력 연결 불명 · 수동 확인';
    },
  );
  const deletedCollisionPlates = new Set(existingConflicts?.deletedCollisions || []);
  const deletedProvenanceClasses = !reconcileState ? {} : countBy(
    [...new Map(reconcileState.deleted
      .filter((row) => deletedCollisionPlates.has(plate(row as Rec)))
      .map((row) => [S(row._key || row.product_code), row])).values()],
    (row) => {
      if (S(row._merged_into)) return '중복병합 별칭';
      const reason = S(row.deletedReason).toLowerCase();
      const actor = S(row.updatedBy || row.deletedBy || row.createdBy).toLowerCase();
      if (/sheet|시트|missing|removed/.test(reason) || /sheet[_-]?sync/.test(actor)) return '시트 자동처리 표식';
      if (/merge|duplicate|중복|병합/.test(reason)) return '중복정리 표식';
      if (reason || actor) return '운영자/기타 삭제 표식';
      return '삭제 출처 불명';
    },
  );
  const identityConflictReview = !reconcileState || !existingConflicts ? null : planSheetIdentityConflictReview({
    conflicts: existingConflicts,
    existing: reconcileState.existing,
    deleted: reconcileState.deleted,
    incoming: sheetRows,
    contracts: contractEntities,
    providerCodes,
  });

  const conflictPlates = new Set(conflictReport.map((row) => row.carNumber).filter(Boolean));
  const v3PlateByKey = new Map<string, string>();
  for (const item of classified) {
    v3PlateByKey.set(item.key, item.plate);
    v3PlateByKey.set(productKey(item.key, item.row), item.plate);
  }
  const terminalContractStatuses = new Set([
    '계약완료', '완료', '계약취소', '취소', 'completed', 'complete', 'cancelled', 'canceled',
  ]);
  const openContractPlates = new Set<string>();
  for (const [, row] of contracts) {
    if (!alive(row)) continue;
    const status = S(row.contract_status || row.status).toLowerCase();
    if (terminalContractStatuses.has(status)) continue;
    const directPlate = plate(row);
    if (directPlate && v3OnlyPlates.has(directPlate)) {
      openContractPlates.add(directPlate);
      continue;
    }
    for (const ref of [row.product_code, row.product_uid, row.product_id].map(S).filter(Boolean)) {
      const matchedPlate = v3PlateByKey.get(ref);
      if (matchedPlate) openContractPlates.add(matchedPlate);
    }
  }
  const uniqueClassified = [...new Map(classified.map((item) => [item.plate, item])).values()];
  const migrationGate = (item: typeof uniqueClassified[number]) => {
    if (openContractPlates.has(item.plate)) return '진행계약 보호 · 자동수정 금지';
    if (conflictPlates.has(item.plate)) return '시트 충돌 해결 필요';
    if (item.inSheet && item.providerMatch) return '승인 후 일일동기화 overlay 후보';
    if (item.referenced) return '시트 없음·이력참조 · 브리지 유지';
    return '시트·참조 없음 · 공급사 확인';
  };
  const migrationGates = countBy(uniqueClassified, migrationGate);

  console.log('=== v3-only × 최신 공급사 Sheet 읽기 전용 대조 ===');
  if (candidateRp023Rule) {
    console.log(`주의: RP023.deposit_rule=${candidateRp023Rule} 메모리 후보값만 적용(운영 write 없음)`);
  }
  console.log(`시트 공급사 ${fetched.partnerCount}곳 · 판독 ${fetched.lines.length}곳 · 올림 ${sheetRows.length}대`);
  for (const line of fetched.lines) {
    console.log(`  ${line.ok ? 'PASS' : 'FAIL'} ${line.code} · 원문 ${line.sourceRowCount} · 올림 ${line.imported} · 제외 ${line.excludedCount} · 가격없음 ${line.noPriceCount} · 무효 ${line.invalidCount} · 중복 ${line.duplicateCount}`);
  }
  console.log(`시트 커밋 게이트: ${commitBlock || 'PASS'}`);
  if (canonical.reason) console.log(`시트 정본 게이트: ${canonical.reason}`);

  console.log(`\nv3-only ${v3Only.length}건 / 차량번호 ${v3OnlyPlates.size}개`);
  for (const name of ['시트현재+참조보호', '시트현재', '참조만', '시트없음+참조없음']) {
    console.log(`  ${name}: ${categories[name] || 0}건 / ${uniqueCategories[name] || 0}대`);
  }
  console.log(`  시트와 공급사 귀속 불일치: ${providerMismatch.length}건`);
  console.log(`  계약 참조: 정확키 ${contractRefs.exact} · 차번 ${contractRefs.byPlate} · 진행중 ${contractRefs.open}`);
  console.log(`  채팅방 참조: 정확키 ${roomRefs.exact} · 차번 ${roomRefs.byPlate}`);

  console.log('\nv3-only 절연 dry-run 분류(차량번호 기준 · 운영 write 없음)');
  for (const name of [
    '진행계약 보호 · 자동수정 금지',
    '시트 충돌 해결 필요',
    '승인 후 일일동기화 overlay 후보',
    '시트 없음·이력참조 · 브리지 유지',
    '시트·참조 없음 · 공급사 확인',
  ]) {
    console.log(`  ${name}: ${migrationGates[name] || 0}대`);
  }

  console.log('\n현재 일일동기화 계획');
  if (!plan) {
    console.log('  생략(--skip-daily-plan): 시트 커버리지와 참조 분류만 실행');
  } else {
    console.log(`  판정 ${plan.ok ? 'PASS' : `BLOCKED — ${plan.blockReason}`}`);
    console.log(`  신규 ${plan.counts.created} · 수정 ${plan.counts.updated} · 부재차단 ${plan.counts.absentBlocked}`);
    console.log(`  v3-only legacy key에 v4 overlay 예정 ${overlayTargets.length}건`);
    if (approvedPricePlan) {
      console.log(`  가격 승인가능 ${hypotheticalPriceApprovals.length}건 전부 승인 가정: ${approvedPricePlan.ok ? 'PASS' : `BLOCKED — ${approvedPricePlan.blockReason}`}`);
    }
  }
  if (conflictReport.length) {
    const byCategory = countBy(conflictReport, (row) => row.category);
    const byProvider = countBy(conflictReport.filter((row) => row.provider), (row) => row.provider);
    const protectedRows = conflictReport.filter((row) => row.contractProtection).length;
    console.log('\n충돌 상세 작업량(중복 그룹은 레코드 행으로 확장)');
    for (const [name, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${name}: ${count}행`);
    }
    console.log(`  계약보호 자동수정금지: ${protectedRows}행`);
    if (Object.keys(ownershipDecisionClasses).length) {
      console.log(`  소유권 결정 분류: ${Object.entries(ownershipDecisionClasses).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}대`).join(' · ')}`);
    }
    if (Object.keys(deletedDecisionClasses).length) {
      console.log(`  삭제이력 결정 분류: ${Object.entries(deletedDecisionClasses).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}대`).join(' · ')}`);
      console.log(`  삭제이력 출처 분류(레코드): ${Object.entries(deletedProvenanceClasses).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}건`).join(' · ')}`);
    }
    if (identityConflictReview?.summary.total) {
      const summary = identityConflictReview.summary;
      console.log(`  신원·미확정 dry-run: 전체 ${summary.total}대 · 공급사 미확정 삭제 ${summary.unownedDeleted} · 단일연결후보 ${summary.unownedSingleCandidates} · 대상모호 ${summary.ambiguous} · 번호미정 식별변경 ${summary.pendingIdentityDrift} · 임시번호 신원불일치 ${summary.pendingSignature} · 계약보호 ${summary.protected} · 실행작업 ${summary.executableOperations}`);
      console.log(`  신원 변경원자: ${Object.entries(summary.changedAtomCounts).sort((a, b) => b[1] - a[1]).map(([atom, count]) => `${atom} ${count}`).join(' · ') || '없음'}`);
      for (const category of ['공급사 미확정 삭제이력', '번호미정 식별변경', '임시번호 신원불일치']) {
        const categoryRows = identityConflictReview.rows.filter((row) => row.category === category);
        const atomCounts = countBy(categoryRows.flatMap((row) => row.changedAtoms), (atom) => atom);
        console.log(`    ${category}: ${Object.entries(atomCounts).sort((a, b) => b[1] - a[1]).map(([atom, count]) => `${atom} ${count}`).join(' · ') || '변경원자 없음'}`);
      }
    }
    console.log(`  공급사 상위: ${Object.entries(byProvider).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([provider, count]) => `${provider} ${count}`).join(' · ')}`);
    if (existingConflicts?.missingPricePeriods.length) {
      const priceConflicts = existingConflicts.missingPricePeriods.map((raw) => {
        const head = raw.split(' (')[0];
        const separator = head.indexOf('|');
        const periodMatch = raw.match(/ \(([^()]*)\)$/);
        return {
          provider: separator > 0 ? head.slice(0, separator) : '미확정',
          carNumber: separator > 0 ? head.slice(separator + 1) : head,
          periods: periodMatch
            ? periodMatch[1].split(',').map((value) => value.trim()).filter(Boolean)
            : [],
        };
      });
      const priceProviders = countBy(priceConflicts, (row) => row.provider);
      const pricePeriods = countBy(priceConflicts.flatMap((row) => row.periods), (period) => period);
      const pricePatterns = countBy(priceConflicts, (row) => row.periods.join('+') || '(기간없음)');
      const resolvedPriceConflicts = priceConflicts.map((item) => {
        const reportRow = conflictReport.find((row) => row.category === '기존 가격기간 누락'
          && row.raw.startsWith(`${item.provider}|${item.carNumber} (`));
        const existingRow = reconcileState?.existing.find((row) => productKey(S(row._key), row as Rec) === reportRow?.productKey);
        const incomingRow = sheetRows.find((row) => plate(row as Rec) === item.carNumber
          && S(row.provider_company_code || row.partner_code) === item.provider);
        return { ...item, existingRow, incomingRow };
      });
      const priceTransitions = countBy(priceConflicts, (item) => {
        const resolved = resolvedPriceConflicts.find((row) => row.provider === item.provider
          && row.carNumber === item.carNumber);
        const keysOf = (row: EntityRecord | undefined) => Object.keys(
          row?.price && typeof row.price === 'object' ? row.price as Record<string, unknown> : {},
        ).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })).join(',') || '-';
        return `${item.provider}: [${keysOf(resolved?.existingRow)}] → [${keysOf(resolved?.incomingRow)}]`;
      });
      const semanticChanges = resolvedPriceConflicts.map((item) => {
        const before = new Map(priceList(item.existingRow || {}).map((entry) => [entry.m, entry]));
        const after = new Map(priceList(item.incomingRow || {}).map((entry) => [entry.m, entry]));
        const removedMonths = [...before.keys()].filter((month) => !after.has(month));
        const changedMonths = [...before.entries()].filter(([month, value]) => {
          const next = after.get(month);
          return !!next && (next.rent !== value.rent || next.deposit !== value.deposit);
        }).map(([month]) => month);
        const incomingKeys = new Set(Object.keys(
          item.incomingRow?.price && typeof item.incomingRow.price === 'object'
            ? item.incomingRow.price as Record<string, unknown>
            : {},
        ));
        const shadowedVariantKeys = item.periods.filter((key) => {
          const separator = key.indexOf('_');
          return separator > 0 && incomingKeys.has(key.slice(0, separator));
        });
        return { ...item, removedMonths, changedMonths, shadowedVariantKeys };
      });
      const semanticClasses = countBy(semanticChanges, (item) => item.removedMonths.length
        ? '시트 단독 기준 기간 누락'
        : item.changedMonths.length
          ? '시트 단독 기준 기본가격 변경'
          : '시트 단독 기준 기본가격 동일');
      const semanticByProvider = countBy(semanticChanges, (item) => {
        const impact = item.removedMonths.length
          ? '시트 누락기간 기존가 유지 필요'
          : item.changedMonths.length
            ? '새 기본가격 적용 확인 필요'
            : '표시 기본가격 동일';
        return `${item.provider} · ${impact}`;
      });
      const removedMonthCounts = countBy(semanticChanges.flatMap((item) => item.removedMonths), (month) => String(month));
      const changedMonthCounts = countBy(semanticChanges.flatMap((item) => item.changedMonths), (month) => String(month));
      const shadowedVariantVehicles = semanticChanges.filter((item) => item.shadowedVariantKeys.length > 0).length;
      const pricePlates = new Set(priceConflicts.map((row) => row.carNumber));
      const overlappedPlates = new Set(conflictReport
        .filter((row) => row.category !== '기존 가격기간 누락' && pricePlates.has(row.carNumber))
        .map((row) => row.carNumber));
      const protectedPricePlates = new Set(conflictReport
        .filter((row) => row.category === '기존 가격기간 누락' && row.contractProtection)
        .map((row) => row.carNumber));
      const approvableByGroup = countBy(
        semanticChanges.filter((item) => !protectedPricePlates.has(item.carNumber)),
        (item) => {
          const impact = item.removedMonths.length
            ? '시트 누락기간 기존가 유지 필요'
            : item.changedMonths.length
              ? '새 기본가격 적용 확인 필요'
              : '표시 기본가격 동일';
          return `${item.provider} · ${impact}`;
        },
      );
      console.log('  가격기간 누락 분해:');
      console.log(`    공급사: ${Object.entries(priceProviders).sort((a, b) => b[1] - a[1]).map(([provider, count]) => `${provider} ${count}대`).join(' · ')}`);
      console.log(`    누락기간: ${Object.entries(pricePeriods).sort((a, b) => b[1] - a[1]).map(([period, count]) => `${period}개월 ${count}대`).join(' · ')}`);
      console.log(`    조합: ${Object.entries(pricePatterns).sort((a, b) => b[1] - a[1]).map(([pattern, count]) => `${pattern}개월 ${count}대`).join(' · ')}`);
      console.log('    기존→현재 가격키:');
      for (const [transition, count] of Object.entries(priceTransitions).sort((a, b) => b[1] - a[1])) {
        console.log(`      ${count}대 · ${transition}`);
      }
      console.log(`    사용자 영향: ${Object.entries(semanticClasses).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}대`).join(' · ')}`);
      console.log(`    승인 묶음: ${Object.entries(semanticByProvider).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}대`).join(' · ')}`);
      console.log(`    계약보호 제외 승인가능: ${Object.entries(approvableByGroup).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}대`).join(' · ')}`);
      if (Object.keys(removedMonthCounts).length) console.log(`    삭제된 계약기간: ${Object.entries(removedMonthCounts).sort((a, b) => b[1] - a[1]).map(([month, count]) => `${month}개월 ${count}대`).join(' · ')}`);
      if (Object.keys(changedMonthCounts).length) console.log(`    기본가격 변경 기간: ${Object.entries(changedMonthCounts).sort((a, b) => b[1] - a[1]).map(([month, count]) => `${month}개월 ${count}대`).join(' · ')}`);
      console.log(`    표준키에 가려지는 과거 주행옵션 포함 ${shadowedVariantVehicles}대`);
      console.log(`    다른 충돌 중첩 ${overlappedPlates.size}대 · 진행계약/계약락 ${protectedPricePlates.size}대`);
    }
    if (showConflictProvider) {
      const byPlate = new Map<string, typeof conflictReport>();
      for (const row of conflictReport) {
        if (!row.carNumber) continue;
        const group = byPlate.get(row.carNumber) || [];
        group.push(row);
        byPlate.set(row.carNumber, group);
      }
      const openContract = (row: Rec) => {
        if (!alive(row)) return false;
        const status = S(row.contract_status || row.status).toLowerCase();
        return !['계약완료', '완료', '계약취소', '취소', 'completed', 'complete', 'cancelled', 'canceled'].includes(status);
      };
      const refsOf = (row: Rec) => [row.product_code, row.product_uid, row.product_id].map(S).filter(Boolean);
      const grouped = [...byPlate.entries()].map(([carNumber, rows]) => {
        const productKeys = new Set(rows.map((row) => row.productKey).filter(Boolean));
        const storageKeys = new Set(rows.map((row) => row.storageKey).filter(Boolean));
        const referenceKeys = new Set([...productKeys, ...storageKeys]);
        const recordProviders = new Set(rows.map((row) => row.provider).filter((value) => value && value !== '미확정'));
        const currentSheetOwners = [...(sheetOwnersByPlate.get(carNumber) || new Set<string>())].sort();
        const staleRows = rows.filter((row) => !currentSheetOwners.includes(row.provider));
        const staleProductKeys = new Set(staleRows.map((row) => row.productKey).filter(Boolean));
        const staleReferenceKeys = new Set(staleRows.flatMap((row) => [row.productKey, row.storageKey]).filter(Boolean));
        const linkedContracts = contracts.filter(([, row]) => openContract(row) && (
          plate(row) === carNumber || refsOf(row).some((ref) => referenceKeys.has(ref))
        ));
        const contractCodes = [...new Set(linkedContracts.map(([key, row]) => S(row.contract_code || key)).filter(Boolean))].sort();
        const historicalContractCodes = [...new Set(contracts.filter(([, row]) => !openContract(row)
          && refsOf(row).some((ref) => staleReferenceKeys.has(ref)))
          .map(([key, row]) => S(row.contract_code || key)).filter(Boolean))].sort();
        const linkedRooms = rooms.filter(([, row]) => alive(row)
          && refsOf(row).some((ref) => staleReferenceKeys.has(ref)));
        const linkedQuotes = quotes.filter(([, row]) => alive(row)
          && refsOf(row).some((ref) => staleReferenceKeys.has(ref)));
        const plateOnlyReferences = [...contracts, ...rooms, ...quotes].filter(([, row]) => (
          alive(row)
          && plate(row) === carNumber
          && !refsOf(row).some((ref) => referenceKeys.has(ref))
        )).length;
        const stalePrivateKeys = [...staleProductKeys].filter((key) => privateProductKeys.has(key)).sort();
        const categories = [...new Set(rows.map((row) => row.category))].sort();
        const missingPricePeriods = [...new Set(rows
          .filter((row) => row.category === '기존 가격기간 누락')
          .flatMap((row) => {
            const match = row.raw.match(/ \(([^()]*)\)$/);
            return match ? match[1].split(',').map((value) => value.trim()).filter(Boolean) : [];
          }))].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
        let classification = '운영확인 · 기타 충돌';
        if (contractCodes.length) classification = '운영확인 · 진행계약 보호';
        else if (categories.includes('공급사 소유 충돌') || currentSheetOwners.length !== 1) {
          classification = historicalContractCodes.length || linkedRooms.length || linkedQuotes.length || plateOnlyReferences
            ? '운영확인 · 기존 이력참조 보존'
            : stalePrivateKeys.length
              ? '운영확인 · 비공개 원가 보존'
              : 'Sheet 소유권 전환 dry-run 후보';
        }
        else if (categories.some((name) => name.includes('삭제이력'))) classification = '운영확인 · 복구/신규 승인';
        else if (categories.some((name) => name.includes('임시번호') || name.includes('식별'))) classification = '운영확인 · 차량 신원';
        else if (categories.includes('기존 가격기간 누락')) classification = '운영확인 · 가격기간';
        else if (categories.length === 1 && categories[0] === '활성 중복차번') {
          classification = linkedRooms.length
            ? '기술정리 dry-run 후보 · 채팅 참조이관 필요'
            : '기술정리 dry-run 후보';
        }
        return {
          carNumber,
          categories,
          currentSheetOwners,
          recordProviders: [...recordProviders].sort(),
          activeProductKeys: [...productKeys].sort(),
          storageKeys: [...storageKeys].sort(),
          openContracts: contractCodes,
          historicalContractsOnStaleKeys: historicalContractCodes,
          roomReferencesOnStaleKeys: linkedRooms.length,
          quoteReferencesOnStaleKeys: linkedQuotes.length,
          plateOnlyReferences,
          stalePrivateKeys,
          missingPricePeriods,
          classification,
        };
      }).filter((item) => (
        item.currentSheetOwners.includes(showConflictProvider)
        || item.recordProviders.includes(showConflictProvider)
      )).sort((a, b) => a.classification.localeCompare(b.classification, 'ko') || a.carNumber.localeCompare(b.carNumber, 'ko'));
      const groupedCounts = countBy(grouped, (item) => item.classification);
      console.log(`\n${showConflictProvider} 실제 차량 단위 충돌 ${grouped.length}대(운영 write 없음)`);
      for (const [name, count] of Object.entries(groupedCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${name}: ${count}대`);
      }
      for (const item of grouped) console.log(JSON.stringify(item));
    }
    if (showProtected && protectedRows) {
      console.log('\n계약보호 상세(PII·금액 미출력)');
      const protectedReportRows = conflictReport.filter((item) => item.contractProtection);
      for (const row of protectedReportRows) {
        console.log(JSON.stringify({
          category: row.category,
          carNumber: row.carNumber,
          provider: row.provider,
          productKey: row.productKey,
          storageKey: row.storageKey,
          vehicleStatus: row.vehicleStatus,
          source: row.source,
          contractProtection: row.contractProtection,
          decision: row.decision,
        }));
      }
      console.log('\n계약보호 원본 경로·Sheet 소유 대조(PII·금액 미출력)');
      const protectedPlates = new Set(protectedReportRows.map((row) => row.carNumber).filter(Boolean));
      for (const protectedPlate of protectedPlates) {
        const stepKeys = [
          'agent_delivery_inquiry', 'provider_delivery_response',
          'agent_docs_submitted', 'provider_docs_review',
          'agent_balance_paid', 'provider_agreement_sent',
          'provider_agreement_done', 'provider_balance_confirmed',
          'agent_handover_confirmed', 'provider_release_completed',
        ];
        const rawProducts = [
          ...rawRows(p3.val()).map(([key, row]) => ({ node: 'products', childKey: key, row })),
          ...rawRows(p4.val()).map(([key, row]) => ({ node: 'v4/products', childKey: key, row })),
        ].filter((item) => plate(item.row) === protectedPlate);
        const sheetOwners = fetched.lines
          .filter((line) => line.products.some((row) => plate(row as Rec) === protectedPlate))
          .map((line) => line.code);
        const linkedContracts = contracts
          .filter(([, row]) => {
            const refs = [row.car_number, row.car_number_snapshot, row.vehicle_number].map((value) => S(value).replace(/\s/g, ''));
            return refs.includes(protectedPlate);
          })
          .map(([key, row]) => ({
            childKey: key,
            contractCode: S(row.contract_code || key),
            contractStatus: S(row.contract_status || row.status),
            productRef: S(row.product_code || row.product_uid || row.product_id),
            provider: S(row.provider_company_code || row.partner_code),
            carNumber: plate(row),
            createdAt: S(row.createdAt || row.created_at || row.contract_date),
            updatedAt: S(row.updatedAt || row.updated_at),
            completedSteps: stepKeys.filter((step) => Boolean(row[step])),
            signStatus: S(row.sign_status),
          }));
        const linkedRooms = rooms
          .filter(([, row]) => {
            const refs = [row.car_number, row.car_number_snapshot, row.vehicle_number].map((value) => S(value).replace(/\s/g, ''));
            return refs.includes(protectedPlate);
          })
          .map(([key, row]) => ({
            childKey: key,
            productRef: S(row.product_code || row.product_uid || row.product_id),
            provider: S(row.provider_company_code || row.partner_code),
            status: S(row.room_status || row.status),
            createdAt: S(row.createdAt || row.created_at),
            updatedAt: S(row.updatedAt || row.updated_at || row.last_message_at),
            messageCount: Number(row.message_count || row.messages_count || 0),
          }));
        console.log(JSON.stringify({
          carNumber: protectedPlate,
          currentSheetOwners: sheetOwners,
          products: rawProducts.map(({ node, childKey, row }) => ({
            node,
            childKey,
            productCode: productKey(childKey, row),
            provider: S(row.provider_company_code || row.partner_code),
            vehicleStatus: S(row.vehicle_status || row.status),
            source: S(row.source || row.source_schema),
            lockedByContract: S(row.locked_by_contract),
            deleted: !alive(row),
          })),
          contracts: linkedContracts,
          rooms: linkedRooms,
        }));
      }
    }
  }
  console.log('\n권장 처리');
  console.log('  시트현재: 직접 복사하지 말고 승인된 일일동기화가 기존 legacy key에 v4 overlay');
  console.log('  참조만: 계약·채팅 보존정책 확정 전 브리지 유지, 자동 판매재고 이관 금지');
  console.log('  시트없음+참조없음: 공급사 확인 전 v4로 자동 이관 금지');
  console.log('  운영 write 0건');

  if (fetched.lines.some((line) => !line.ok) || canonical.reason) process.exit(2);
  process.exit(0);
}

main().catch((error) => {
  console.error('감사 실패:', String((error as Error)?.message || error));
  process.exit(1);
});
