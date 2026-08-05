/**
 * **시트 동기화를 «반영하면» 어떻게 되는지 미리 계산한다. 쓰기 없음.**
 *
 * fp4 는 시트 동기화를 사실상 한 번도 반영하지 않았다 —
 * `partner.lastSyncedAt` 16곳 중 14곳이 없음, 부재차단 표식(`sheet_block_reason`) 0건.
 * 그래서 지금 매물은 erp3 가 v3 에 넣어 준 낡은 스냅샷이고, 대수가 실제와 어긋난다.
 *
 * 첫 반영은 **대량 상태변경**이 된다(계약중·보류 → 출고불가, 시트에서 빠진 차 → 부재차단).
 * 계약이 걸린 차를 잘못 내리면 사고다. 그래서 돌리기 전에 이 스크립트로 결과를 본다.
 *
 * 실제 동기화 경로(`sheet-merge.planProductUpsert` · `planAbsentBlocked`)를 그대로 쓴다 —
 * 여기서 나온 숫자와 실제 반영 결과가 달라지면 이 미리보기가 무의미하다.
 *
 * 읽기 전용.
 *   npx tsx scripts/preview-sheet-sync.mts --code=RP023
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { importSheetTable, parseMappingProfile, parseMappingHeaderSignature, canonSheetVehicleStatus, parseDepositRule } from '../lib/domain/sheet-import';
import { importAutoplusMerged } from '../lib/domain/sheet-autoplus';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import { AUTOPLUS_GID_MAIN, AUTOPLUS_GID_PROMO } from '../lib/domain/sheet-autoplus';
import { planProductUpsert, planAbsentBlocked } from '../lib/domain/sheet-merge';
import { isOfferableProduct } from '../lib/domain/product';
import { dedupeProductsByVehicle } from '../lib/firebase/rtdb-products';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: DB });
const db = getDatabase();
const S = (v: unknown) => String(v ?? '').trim();
const CODE = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();
const PLATE = /^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;

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
const mergeNodes = (a: unknown, b: unknown) => {
  const m: Record<string, EntityRecord> = {};
  for (const [k, v] of Object.entries((a || {}) as Record<string, EntityRecord>)) m[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((b || {}) as Record<string, EntityRecord>)) m[k] = { ...(m[k] || {}), ...v, _key: k };
  return m;
};
const plateOf = (x: EntityRecord) => { const c = S(x.car_number).replace(/\s/g, ''); return c && PLATE.test(c) ? c : ''; };

async function main() {
  if (!CODE) { console.log('--code=<공급사코드> 필요'); return; }
  const [t3, t4, p3, p4, m3, m4, c3, c4] = await Promise.all([
    db.ref('partners').get(), db.ref('v4/partners').get(),
    db.ref('products').get(), db.ref('v4/products').get(),
    db.ref('vehicle_master').get(), db.ref('v4/vehicle_master').get(),
    db.ref('contracts').get(), db.ref('v4/contracts').get(),
  ]);
  const partners = mergeNodes(t3.val(), t4.val());
  const p = partners[CODE] || Object.values(partners).find((x) => S(x.partner_code) === CODE);
  if (!p) { console.log(`${CODE} 없음`); return; }
  const master = Object.values(mergeNodes(m3.val(), m4.val())).filter(Boolean);
  const allLive = Object.values(mergeNodes(p3.val(), p4.val()))
    .filter((x) => x && x._deleted !== true && !x.deletedAt && S(x.status) !== 'deleted');
  const existing = allLive.filter((x) => S(x.provider_company_code) === CODE || S(x._key).startsWith(`${CODE}_`));
  const liveContracts = Object.values(mergeNodes(c3.val(), c4.val()))
    .filter((c) => c && c._deleted !== true && S(c.contract_status) !== '계약취소');
  const contractedCodes = new Set(liveContracts.map((c) => S(c.product_code)).filter(Boolean));

  console.log(`\n══ ${CODE} ${S(p.name) || S(p.partner_name)} — 동기화 반영 미리보기 (쓰기 없음) ══\n`);

  // ── 시트 유입
  const adapter = resolveAdapter(p);
  const id = (S(p.sheet_url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
  const gids = (S(p.sheet_gid) || S(p.sheet_tab) || '').split(/[,\s|]+/).filter(Boolean);
  const tabs = gids.length ? gids : (adapter.id === 'autoplus' ? [AUTOPLUS_GID_MAIN, AUTOPLUS_GID_PROMO] : ['']);
  const incoming: EntityRecord[] = [];
  const sheetStatusCount = new Map<string, number>();
  let srcRows = 0, excluded = 0, noPrice = 0, invalid = 0, dup = 0;
  for (const gid of tabs) {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`, { redirect: 'follow' });
    if (!res.ok) { console.log(`  gid ${gid}: ❌ ${res.status}`); continue; }
    const table = adapter.prepareTable(parseCsv(await res.text()), { headerRow: Math.max(0, Number(p.header_row) || 0) });
    if (table.length < 2) continue;
    // 시트 원문 상태 분포 — 사장님 기준(판매중·할인판매=출고가능)과 대조용
    const hdr = table[0].map(S);
    const iS = hdr.findIndex((h) => /배차상태|판매상태|^상태$|재고상태|출고상태/.test(h.replace(/\s/g, '')));
    const iP = hdr.findIndex((h) => /차량번호|차번|번호판/.test(h.replace(/\s/g, '')));
    if (iS >= 0 && iP >= 0) {
      for (const r of table.slice(1)) {
        const pl = S(r[iP]).replace(/\s/g, ''); if (!pl || !PLATE.test(pl)) continue;
        const raw = S(r[iS]) || '(빈값)';
        const key = `${raw} → ${canonSheetVehicleStatus(r[iS])}`;
        sheetStatusCount.set(key, (sheetStatusCount.get(key) || 0) + 1);
      }
    }
    if (adapter.id === 'autoplus') continue; // 아래에서 전용 경로로 한 번에 처리한다
    const r = importSheetTable(table, {
      providerCode: CODE, entries: master as never,
      profile: parseMappingProfile(p.mapping_profile),
      profileHeaders: parseMappingHeaderSignature(p.mapping_header_signature),
      depositRule: parseDepositRule(p.deposit_rule),
    });
    srcRows += r.total; excluded += r.excludedCount; noPrice += r.noPriceCount;
    invalid += r.invalidCount; dup += r.duplicateCount;
    incoming.push(...r.products);
  }

  // 오토플러스는 본탭∪프로모션을 «한 번에» 병합하는 전용 경로가 정본이다(sheet-sync-all.ts:705).
  //  탭별로 importSheetTable 을 돌리면 프로모션 전용 가격이 안 붙어 전량 «가격없음»이 된다.
  //  depositRule 도 반드시 넘겨야 한다 — 미설정이면 금액을 추정하지 않고 가격없음으로 차단한다.
  if (adapter.id === 'autoplus') {
    const r = await importAutoplusMerged({
      url: S(p.sheet_url), providerCode: CODE, entries: master as never,
      profile: parseMappingProfile(p.mapping_profile),
      profileHeaders: parseMappingHeaderSignature(p.mapping_header_signature),
      headerRow: Math.max(0, Number(p.header_row) || 0),
      depositRule: parseDepositRule(p.deposit_rule),
      fetchTable: async (url: string, gid?: string) => {
        const sid = (url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
        const res = await fetch(`https://docs.google.com/spreadsheets/d/${sid}/export?format=csv${gid ? `&gid=${gid}` : ''}`, { redirect: 'follow' });
        if (!res.ok) throw new Error(`CSV ${res.status}`);
        return parseCsv(await res.text());
      },
    });
    srcRows += r.total; excluded += r.excludedCount; noPrice += r.noPriceCount;
    invalid += r.invalidCount; dup += r.duplicateCount;
    incoming.push(...r.products);
  }

  console.log('── 시트 원문 상태 → 우리 상태 ──');
  [...sheetStatusCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${String(v).padStart(4)}건  ${k}`));
  console.log(`\n── 유입 ──`);
  console.log(`   원본 행 ${srcRows} → 올림 ${incoming.length}`);
  console.log(`   출고불가라 제외 ${excluded} · 가격없어 제외 ${noPrice} · 무효 ${invalid} · 중복 ${dup}`);

  // ── 반영 계획 (실제 경로)
  const upsert = planProductUpsert(incoming, existing);
  const presentKeys = new Set(incoming.map((x) => S(x.product_code) || S(x._key)).filter(Boolean));
  const presentPlates = new Set(incoming.map(plateOf).filter(Boolean));
  const absent = planAbsentBlocked({ existing, providerCode: CODE, presentKeys, presentPlates });

  console.log(`\n── 반영하면 ──`);
  console.log(`   신규 ${upsert.creates.length} · 수정 ${upsert.patches.length} · 변화없음 ${upsert.unchanged ?? '-'}`);
  console.log(`   부재차단(시트에서 빠짐) ${absent.patches.length} · 계약락으로 보류 ${absent.skipped_locked} · 이미 출고불가 ${absent.already_blocked}`);

  // 부재차단 대상 중 계약이 걸린 게 있는지 — 사고 방지 확인
  const risky = absent.patches.filter((x) => contractedCodes.has(S(x.key)) || contractedCodes.has(S(x.expected?.product_code)));
  console.log(`   ★ 부재차단 대상 중 살아있는 계약이 가리키는 것 ${risky.length}${risky.length ? ' ← 위험, 확인 필요' : ' ✓'}`);
  risky.slice(0, 10).forEach((x) => console.log(`        ${S(x.key)}`));

  // ── 반영 후 예상 게시 대수
  const afterMap = new Map<string, EntityRecord>();
  for (const e of existing) afterMap.set(S(e._key), { ...e });
  for (const c of upsert.creates) afterMap.set(S(c.product_code) || S(c._key), c);
  for (const pt of upsert.patches) { const k = S(pt.key); const cur = afterMap.get(k); if (cur) afterMap.set(k, { ...cur, ...pt.patch }); }
  for (const ab of absent.patches) { const k = S(ab.key); const cur = afterMap.get(k); if (cur) afterMap.set(k, { ...cur, ...ab.patch }); }
  const after = dedupeProductsByVehicle([...afterMap.values()]).filter(isOfferableProduct);
  const before = dedupeProductsByVehicle(existing).filter(isOfferableProduct);
  console.log(`\n── 게시 대수 ──`);
  console.log(`   지금 ${before.length}  →  반영 후 ${after.length}   (${after.length - before.length >= 0 ? '+' : ''}${after.length - before.length})`);
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
