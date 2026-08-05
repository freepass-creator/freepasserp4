/**
 * **시트를 본다. 우리 화면과 번호판으로 맞춘다. 끝.**
 *
 * 중간 개념(트윈·dedup·v3/v4) 없이 두 목록만 비교한다 —
 *   ① 시트에서 «팔 수 있는» 차     = canonSheetVehicleStatus 가 출고불가가 아닌 행
 *   ② 우리가 «게시하는» 차          = isOfferableProduct 를 통과한 매물
 * 차이가 나면 어느 번호판인지 그대로 찍는다. 사장님이 시트를 열어 대조할 수 있어야 한다.
 *
 * 프로세스 하나 · DB 다운로드 한 번(캐시). 공급사별로 npx 를 반복 호출하지 않는다.
 *
 *   npx tsx scripts/sheet-vs-live.mts              전 공급사 요약
 *   npx tsx scripts/sheet-vs-live.mts --code=RP004 한 곳 번호판까지
 *   ... --refresh   DB 캐시 갱신
 */
import { snapshot, mergeNodes, liveProducts, type Rec } from './lib/db-snapshot.mts';
import { dedupeProductsByVehicle } from '../lib/firebase/rtdb-products';
import { isOfferableProduct } from '../lib/domain/product';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import { AUTOPLUS_GID_MAIN, AUTOPLUS_GID_PROMO } from '../lib/domain/sheet-autoplus';
import type { EntityRecord } from '../lib/intake/entities';

const REFRESH = process.argv.includes('--refresh');
const ONLY = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();
const S = (v: unknown) => String(v ?? '').trim();
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
const plateOf = (x: Rec) => { const c = S(x.car_number).replace(/\s/g, ''); return c && PLATE.test(c) ? c : ''; };

async function main() {
  const s = await snapshot({ refresh: REFRESH });
  const partners = mergeNodes(s.partners, s.v4Partners);
  const live = liveProducts(s);
  const shown = dedupeProductsByVehicle(live as EntityRecord[]).filter(isOfferableProduct);

  const targets = Object.values(partners)
    .filter((p) => p && p._deleted !== true && S(p.sheet_url))
    .filter((p) => !ONLY || S(p.partner_code) === ONLY || S(p._key) === ONLY)
    .sort((a, b) => S(a.partner_code).localeCompare(S(b.partner_code)));

  console.log('\n공급사              시트 판매가능   우리 게시   차이');
  console.log('─'.repeat(58));
  let sumSheet = 0, sumOurs = 0;
  const details: string[] = [];

  for (const p of targets) {
    const code = S(p.partner_code) || S(p._key);
    const name = S(p.name) || S(p.partner_name) || code;
    const id = (S(p.sheet_url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
    if (!id) continue;
    const adapter = resolveAdapter(p as never);
    const gids = (S(p.sheet_gid) || S(p.sheet_tab) || '').split(/[,\s|]+/).filter(Boolean);
    const tabs = gids.length ? gids : (adapter.id === 'autoplus' ? [AUTOPLUS_GID_MAIN, AUTOPLUS_GID_PROMO] : ['']);

    // ① 시트에서 팔 수 있는 차
    const sheetOk = new Set<string>();
    const sheetBlocked = new Set<string>();
    for (const gid of tabs) {
      try {
        const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`, { redirect: 'follow' });
        if (!res.ok) continue;
        const table = adapter.prepareTable(parseCsv(await res.text()), { headerRow: Math.max(0, Number(p.header_row) || 0) });
        if (table.length < 2) continue;
        const hdr = table[0].map(S);
        const iP = hdr.findIndex((h) => /차량번호|차번|번호판|등록번호/.test(h.replace(/\s/g, '')));
        const iS = hdr.findIndex((h) => /배차상태|판매상태|^상태$|재고상태|출고상태|출고현황|즉시출고/.test(h.replace(/\s/g, '')));
        if (iP < 0) continue;
        for (const r of table.slice(1)) {
          const pl = S(r[iP]).replace(/\s/g, '');
          if (!pl || !PLATE.test(pl)) continue;
          // 상태열이 없으면 판정 불가 — 있는 것만 거른다(없으면 전부 판매가능으로 본다).
          const blocked = iS >= 0 && canonSheetVehicleStatus(r[iS]) === '출고불가';
          if (blocked) sheetBlocked.add(pl); else sheetOk.add(pl);
        }
      } catch { /* 탭 하나 실패가 전체를 막지 않는다 */ }
    }

    // ② 우리가 게시하는 차
    const ours = new Set(shown.filter((x) => S(x.provider_company_code) === code || S(x._key).startsWith(`${code}_`)).map(plateOf).filter(Boolean));

    sumSheet += sheetOk.size; sumOurs += ours.size;
    const diff = ours.size - sheetOk.size;
    console.log(`${(name + ' (' + code + ')').padEnd(26)} ${String(sheetOk.size).padStart(8)} ${String(ours.size).padStart(11)} ${String(diff === 0 ? '✓' : diff > 0 ? '+' + diff : diff).padStart(6)}`);

    if (diff !== 0 || ONLY) {
      const onlyOurs = [...ours].filter((x) => !sheetOk.has(x));
      const onlySheet = [...sheetOk].filter((x) => !ours.has(x));
      const lines: string[] = [`\n■ ${name} (${code})  시트 ${sheetOk.size} · 우리 ${ours.size}   [시트 출고불가 ${sheetBlocked.size}]`];
      if (onlyOurs.length) {
        lines.push(`   우리만 띄우는 것 ${onlyOurs.length}대 — 시트에 없거나 시트가 출고불가로 적어둔 것`);
        onlyOurs.forEach((pl) => {
          const r = shown.find((x) => plateOf(x) === pl);
          lines.push(`      ${pl.padEnd(10)} ${S(r?.maker)} ${S(r?.sub_model) || S(r?.model)}${sheetBlocked.has(pl) ? '   ← 시트는 출고불가' : '   ← 시트에 없음'}`);
        });
      }
      if (onlySheet.length) {
        lines.push(`   시트엔 있는데 안 띄우는 것 ${onlySheet.length}대`);
        onlySheet.forEach((pl) => {
          const r = live.find((x) => plateOf(x) === pl);
          lines.push(`      ${pl.padEnd(10)} ${r ? `[${S(r.vehicle_status) || '빈값'}] 가격 ${r.price && Object.keys(r.price).length ? 'O' : 'X'}` : '우리 데이터에 아예 없음'}`);
        });
      }
      details.push(lines.join('\n'));
    }
  }

  console.log('─'.repeat(58));
  console.log(`${'합계'.padEnd(26)} ${String(sumSheet).padStart(8)} ${String(sumOurs).padStart(11)} ${String(sumOurs - sumSheet > 0 ? '+' + (sumOurs - sumSheet) : sumOurs - sumSheet).padStart(6)}`);
  details.forEach((d) => console.log(d));
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
