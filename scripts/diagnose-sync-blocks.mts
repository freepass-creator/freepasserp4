/**
 * **연동이 왜 안 되나 — 막는 조건을 공급사별로 실측한다. 쓰기 없음.**
 *
 * 화면은 「검증 차단 — …」 한 줄만 보여준다. 그 한 줄이 어느 공급사 때문인지,
 * 그 공급사만 빼면 나머지는 반영할 수 있는지가 안 보인다. 그래서 «전부 막힌 것»처럼 느껴진다.
 *
 * 실제 차단 함수(`sheetSyncCommitBlockReason`)는 fetched.lines 전체를 훑는다 —
 * 한 곳의 무효 차번 한 건이 «모든» 공급사의 반영을 막는다. 이 스크립트는 그걸 눈으로 확인시킨다:
 *   ① 전체를 한 번에 검증했을 때의 차단 사유
 *   ② 공급사를 하나씩만 검증했을 때의 차단 사유 — 즉 지금 당장 반영 가능한 곳이 어디인지
 *
 *   npx tsx scripts/diagnose-sync-blocks.mts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import {
  fetchAllPartnerSheets, sheetSyncCommitBlockReason,
  findSheetSyncExistingConflicts, sheetSyncExistingConflictReason,
} from '../lib/domain/sheet-sync-all';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import { buildSheetConflictReportRows } from '../lib/domain/sheet-conflict-report';
import {
  buildMasterIndex, classifyMasterMisfit,
  MASTER_MISFIT_LABEL, MASTER_MISFIT_OWNER, type MasterMisfitKind,
} from '../lib/domain/master-misfit';
import type { MasterEntry } from '../lib/domain/vehicle-master-match';
import { applySheetConflictResolutions } from '../lib/domain/sheet-conflict-resolution';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

const GRID_FIELDS = [
  'sheets(properties(sheetId,title,hidden)',
  'data(startRow,rowData(values(formattedValue,effectiveValue,hyperlink,chipRuns(chip(richLinkProperties(uri))))),rowMetadata(hiddenByFilter,hiddenByUser)))',
].join(',');

function parseCsv(t: string): string[][] {
  const rows: string[][] = []; let f = '', r: string[] = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows;
}

async function main() {
  const db = getDatabase();
  const [t3, t4, m3, m4] = await Promise.all([
    db.ref('partners').get(), db.ref('v4/partners').get(),
    db.ref('vehicle_master').get(), db.ref('v4/vehicle_master').get(),
  ]);
  const merge = (a: unknown, b: unknown) => {
    const m: Record<string, Rec> = {};
    for (const [k, v] of Object.entries((a || {}) as Record<string, Rec>)) m[k] = { ...v, _key: k };
    for (const [k, v] of Object.entries((b || {}) as Record<string, Rec>)) m[k] = { ...(m[k] || {}), ...v, _key: k };
    return m;
  };
  const partnerRows = Object.values(merge(t3.val(), t4.val())) as EntityRecord[];
  // ⚠ 차종마스터는 RTDB 가 아니라 `public/data/vehicle-master.json` 이 정본이다(화면도 여기서 읽는다).
  //   RTDB 노드로 재면 전량 «검수»로 나와 진단이 통째로 거짓이 된다 — 실제로 그렇게 한 번 틀렸다.
  const masterFile = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: unknown[] };
  const master = (masterFile.entries || []) as unknown[];
  if (!master.length) throw new Error('차종마스터 로드 실패');

  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;

  // 화면(브라우저 /api/sheet)과 같은 계약의 fetchTable — 숨김행 제외 경로는 Sheets API, 그 외는 CSV export.
  const fetchTable = async (url: string, gid?: string, options: Rec = {}) => {
    const id = (url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1] || '';
    if (options.visibleRowsOnly) {
      const meta = await (await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden))')}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )).json() as SheetsGridResponse;
      const target = meta.sheets?.find((s) => s.properties?.sheetId === Number(gid || 0));
      if (!target?.properties) throw new Error(`탭 없음(gid ${gid})`);
      const a1 = `'${String(target.properties.title || '').replace(/'/g, "''")}'`;
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&ranges=${encodeURIComponent(a1)}&fields=${encodeURIComponent(GRID_FIELDS)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const body = await res.json() as SheetsGridResponse & { error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message || `Sheets API ${res.status}`);
      const grid = visibleRowsFromGridResponse(body, String(gid || '0'));
      options.onPhotoByPlate?.(grid.photoByPlate || {});
      return grid.rows;
    }
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`, { redirect: 'follow' });
    if (!res.ok) throw new Error(`CSV ${res.status}`);
    return parseCsv(await res.text());
  };

  console.log('\n══ 연동을 막는 게 무엇인가 (쓰기 없음) ══\n');

  // 기존 ERP 재고·삭제이력 — 2관문(충돌 게이트)이 이걸 상대로 판정한다.
  const [pr3, pr4] = await Promise.all([db.ref('products').get(), db.ref('v4/products').get()]);
  const allProducts = Object.values(merge(pr3.val(), pr4.val())) as EntityRecord[];
  const isDead = (r: Rec) => r._deleted === true || !!r.deletedAt || S(r.status) === 'deleted';
  const existing = allProducts.filter((r) => !isDead(r as Rec));
  const deletedRows = allProducts.filter((r) => isDead(r as Rec));

  // ① 전체 한 번에
  const all = await fetchAllPartnerSheets('default', master as never, { partnerRows, fetchTable: fetchTable as never });
  const allBlock = sheetSyncCommitBlockReason(all);

  // ② 2관문 — 기존 ERP 충돌. 여기서 막히면 «검증은 됐는데 반영 버튼이 안 켜진다».
  const conflicts = findSheetSyncExistingConflicts(all, existing, deletedRows);
  const conflictReason = sheetSyncExistingConflictReason(conflicts);
  const cats: Array<[string, string[]]> = [
    ['활성 중복차번', conflicts.activeTwins],
    ['공급사 간 차번 소유 충돌', conflicts.crossProviderPlateConflicts],
    ['삭제매물 재등장', conflicts.deletedCollisions],
    ['공급사 미확정 삭제이력', conflicts.unownedDeletedMatches],
    ['수기 출고불가 해제 후보', conflicts.manualReactivations],
    ['임시번호→실차번', conflicts.pendingIdentityTransitions],
    ['번호미정 식별자 변경', conflicts.pendingIdentityDrifts],
    ['임시번호 신원서명 불일치', conflicts.pendingSignatureConflicts],
    ['기존 가격기간 누락', conflicts.missingPricePeriods],
    ['공급사 미확정 기존차', conflicts.unownedLegacyMatches],
  ];
  // 화면은 여기서 한 번 더 걸러낸다 — 「반영해도 손님 금액이 안 바뀌는」 가격기간 건은 승인 없이 통과.
  // 그 완화를 적용한 뒤 «실제로» 남는 차단이 얼마인지가 운영자가 마주하는 숫자다.
  const [ct3, ct4] = await Promise.all([db.ref('contracts').get(), db.ref('v4/contracts').get()]);
  const contracts = Object.values(merge(ct3.val(), ct4.val())) as EntityRecord[];
  const reportRows = buildSheetConflictReportRows({
    conflicts, existing, deleted: deletedRows, incoming: all.products, contracts,
    providerCodes: all.lines.map((l) => l.code),
  });
  const byRaw = new Map(reportRows.map((r) => [r.raw, r]));
  const priceChangesValue = (raw: string) => String(byRaw.get(raw)?.priceImpact || '').includes('새 기본가격 적용');
  const resolved = applySheetConflictResolutions({
    conflicts, resolutions: [], existing, contracts, priceChangesValue,
  });
  const realReason = sheetSyncExistingConflictReason(resolved.conflicts);

  console.log(`② 2관문 — 기존 ERP 충돌  ${conflictReason ? `❌ 차단 · ${conflictReason}` : '✅ 통과'}`);
  for (const [nm, rows] of cats) {
    if (!rows.length) continue;
    console.log(`     · ${nm.padEnd(22)} ${String(rows.length).padStart(4)}건   예: ${rows.slice(0, 2).join(' / ').slice(0, 90)}`);
  }
  console.log(`   ⤷ 무변화 가격건을 통과시킨 뒤 «실제로» 남는 차단: ${realReason || '✅ 없음'}`);
  // 남은 가격건은 화면에서 «공급사 + 영향» 단위로 묶어 한 번에 승인한다 — 몇 번 눌러야 하는지가 곧 난이도다.
  const groups = new Map<string, number>();
  for (const raw of conflicts.missingPricePeriods) {
    if (!priceChangesValue(raw)) continue;
    const r = byRaw.get(raw);
    const k = `${r?.provider || '미확정'} · ${r?.priceImpact || '가격 구조 확인 필요'}`;
    groups.set(k, (groups.get(k) || 0) + 1);
  }
  if (groups.size) {
    console.log(`   ⤷ 남은 가격건은 ${groups.size}번 승인하면 끝난다:`);
    for (const [k, n] of [...groups.entries()].sort((a, b) => b[1] - a[1])) console.log(`        ${String(n).padStart(3)}건  ${k}`);
  }
  console.log('');

  // 차종마스터 통과 현황 — 저장은 commitSupplierProducts 하나뿐이라 여기를 거치지 않고 들어오는 길은 없다.
  // high·medium 만 규격 확정이고 low·미매칭은 `_needs_master_review`(목록에서 빠진다).
  const conf = (r: EntityRecord) => S((r as Rec)._snap_confidence);
  const review = (r: EntityRecord) => (r as Rec)._needs_master_review === true;
  console.log('★ 차종마스터 통과 현황 (반영되면 이렇게 등록된다)');
  console.log(`   확정 ${all.products.filter((r) => !review(r)).length}대 (high ${all.products.filter((r) => conf(r) === 'high').length} · medium ${all.products.filter((r) => conf(r) === 'medium').length})`);
  console.log(`   검수대기 ${all.products.filter(review).length}대 (low ${all.products.filter((r) => conf(r) === 'low').length} · 미매칭 ${all.products.filter((r) => !conf(r)).length}) — 목록에는 안 뜬다`);
  for (const line of all.lines) {
    const rv = line.products.filter(review).length;
    if (!rv) continue;
    console.log(`      ${line.label.padEnd(18).slice(0, 18)} 검수 ${rv}/${line.products.length}`);
  }
  // 트림 확보율 — 확신도를 끌어올리는 마지막 신호다. 트림이 비면 세대까지 붙고도 low 로 떨어지고,
  // 손님에게는 같은 차가 등급 구분 없이 나간다. «어디서» 비는지가 곧 고칠 자리다.
  const trimOf = (r: EntityRecord) => S((r as Rec).trim_name) || S((r as Rec).variant);
  const noTrim = all.products.filter((r) => !trimOf(r));
  console.log(`   트림 있음 ${all.products.length - noTrim.length}대 · 트림 없음 ${noTrim.length}대`);
  for (const line of all.lines) {
    const nt = line.products.filter((r) => !trimOf(r)).length;
    if (!nt) continue;
    const rv = line.products.filter((r) => !trimOf(r) && review(r)).length;
    console.log(`      ${line.label.padEnd(18).slice(0, 18)} 트림없음 ${nt}/${line.products.length}  (그중 검수 ${rv})`);
  }
  // 검수대기를 «한 덩어리»로 두면 아무도 손을 못 댄다. 손볼 사람이 다른 축으로 가른다
  // (master-misfit SSOT — DB 감사 audit-master-misfit 과 같은 규칙).
  const index = buildMasterIndex(master as MasterEntry[]);
  const kinds = new Map<MasterMisfitKind, EntityRecord[]>();
  for (const r of all.products.filter(review)) {
    const kind = classifyMasterMisfit(r, index, S((r as Rec)._snap_confidence) || undefined);
    kinds.set(kind, [...(kinds.get(kind) || []), r]);
  }
  if (kinds.size) {
    console.log('   검수대기를 갈라 보면:');
    for (const [kind, rows] of [...kinds.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`      ${String(rows.length).padStart(3)}대  ${MASTER_MISFIT_LABEL[kind].padEnd(30).slice(0, 30)} [손볼 곳: ${MASTER_MISFIT_OWNER[kind]}]`);
    }
  }

  if (process.argv.includes('--review')) {
    console.log('\n   검수대기 실물 — 무엇이 모자라 low 인지:');
    for (const line of all.lines) {
      const rows = line.products.filter(review);
      if (!rows.length) continue;
      console.log(`
   [${line.label}]`);
      for (const r of rows) {
        const g = r as Rec;
        console.log(`     ${S(g.car_number).padEnd(10)} 제조사=${S(g.maker) || '(없음)'} 모델=${S(g.model) || '(없음)'} 세부=${S(g.sub_model) || '-'} 트림=${S(g.trim_name) || '-'} 연식=${S(g.year) || '-'} 연료=${S(g.fuel_type) || '-'}`);
        const raw = S(g._raw_vehicle);
        if (raw) console.log(`                원문: ${raw.slice(0, 120)}`);
      }
    }
  }
  console.log('');

  console.log(`① 전체 ${all.lines.length}곳 한 번에 검증`);
  console.log(`   올림 ${all.products.length}대 → ${allBlock ? `❌ 차단 · ${allBlock}` : '✅ 반영 가능'}\n`);

  // ② 공급사 하나씩
  console.log('③ 공급사를 하나씩만 검증하면 (1관문 기준)');
  const okList: string[] = [];
  const ngList: Array<{ label: string; reason: string }> = [];
  for (const line of all.lines) {
    const row = partnerRows.find((p) => S(p.partner_code) === line.code || S(p._key) === line.code);
    if (!row) continue;
    let one;
    try {
      one = await fetchAllPartnerSheets('default', master as never, { partnerRows: [row], fetchTable: fetchTable as never });
    } catch (e) { ngList.push({ label: line.label, reason: `조회 실패 — ${String((e as Error).message || e)}` }); continue; }
    const reason = sheetSyncCommitBlockReason(one);
    if (reason) ngList.push({ label: line.label, reason });
    else okList.push(`${line.label} ${one.products.length}대`);
    console.log(`   ${reason ? '❌' : '✅'} ${line.label.padEnd(18).slice(0, 18)} ${String(one.products.length).padStart(3)}대  ${reason || ''}`);
  }

  console.log(`\n  지금 그대로 반영 가능 ${okList.length}곳 · 막힌 곳 ${ngList.length}곳`);
  console.log(`  ✅ ${okList.join(' · ') || '없음'}`);
  if (ngList.length) {
    console.log('\n  막힌 곳이 요구하는 것:');
    for (const n of ngList) console.log(`   · ${n.label} — ${n.reason}`);
  }
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
