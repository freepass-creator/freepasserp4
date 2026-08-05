/**
 * **사장님이 아는 실제 대수 vs 우리 게시 대수** — 차이의 «사유»를 공급사별로 캔다.
 *
 * 대수가 맞는지가 이 시스템의 최종 검증이다. 레코드 정합·트윈 제거를 아무리 해도
 * 「실제 50대인데 화면에 72대」면 틀린 것이다.
 *
 * 넘치는 사유와 모자라는 사유를 각각 분해한다 —
 *   넘침: 이미 나간 차가 남음 · 아직 트윈 · 시트에 없는데 우리에만 있음
 *   모자람: 가격 없어 미게시 · 출고불가로 제외 · 시트에 있는데 우리에 없음
 *
 * 읽기 전용.
 *   npx tsx scripts/reconcile-expected-count.mts
 *   npx tsx scripts/reconcile-expected-count.mts --code=RP004    한 곳 상세
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { dedupeProductsByVehicle } from '../lib/firebase/rtdb-products';
import { isOfferableProduct, vehicleIdentity } from '../lib/domain/product';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: DB });
const db = getDatabase();
const S = (v: unknown) => String(v ?? '').trim();
const ONLY = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();
const PLATE = /^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;

/** 사장님이 준 실제 대수 (2026-08-05). 이게 정답 기준이다. */
const EXPECTED: Record<string, { name: string; n: number }> = {
  RP022: { name: '퍼시픽', n: 1 },
  RP008: { name: '리더스', n: 3 },
  RP010: { name: 'KH', n: 11 },
  RP018: { name: '스타', n: 19 },
  RP030: { name: '제이앤제이', n: 7 },
  'PT-0001': { name: '렌트존', n: 6 },
  'PT-0023': { name: '에스에이', n: 30 },
  RP013: { name: '웰릭스', n: 17 },
  RP012: { name: '손오공', n: 32 },
  RP015: { name: '경진렌트카', n: 1 },
  RP017: { name: '센트로', n: 2 },
  RP016: { name: '경진카', n: 0 },
  RP020: { name: '우리캐피탈', n: 19 },
  RP021: { name: '빌린카', n: 47 },
  RP023: { name: '오토플러스', n: 91 },
  RP006: { name: '아이언', n: 27 },
  RP004: { name: '아이카', n: 50 },
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let f = '', r: string[] = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
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
const priced = (x: EntityRecord) => !!(x.price && typeof x.price === 'object' && Object.keys(x.price).length);
const plateOf = (x: EntityRecord) => { const c = S(x.car_number).replace(/\s/g, ''); return c && PLATE.test(c) ? c : ''; };

async function main() {
  const [p3, p4, t3, t4] = await Promise.all([
    db.ref('products').get(), db.ref('v4/products').get(),
    db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const partners = mergeNodes(t3.val(), t4.val());
  const live = Object.values(mergeNodes(p3.val(), p4.val()))
    .filter((x) => x && x._deleted !== true && !x.deletedAt && S(x.status) !== 'deleted');
  const shownAll = dedupeProductsByVehicle(live).filter(isOfferableProduct);

  const codes = ONLY ? [ONLY] : Object.keys(EXPECTED);
  console.log('\n공급사        실제  우리  차이   진단');
  console.log('─'.repeat(78));
  let sumExp = 0, sumOurs = 0;

  for (const code of codes) {
    const exp = EXPECTED[code];
    if (!exp) { console.log(`${code} — EXPECTED 에 없음`); continue; }
    const mineAll = live.filter((x) => S(x.provider_company_code) === code || S(x._key).startsWith(`${code}_`));
    const shown = shownAll.filter((x) => S(x.provider_company_code) === code || S(x._key).startsWith(`${code}_`));
    sumExp += exp.n; sumOurs += shown.length;
    const diff = shown.length - exp.n;

    // 사유 분해
    const noPrice = mineAll.filter((x) => !priced(x));
    const blocked = mineAll.filter((x) => S(x.vehicle_status) === '출고불가');
    const identities = new Set(shown.map((x) => vehicleIdentity(x)).filter(Boolean));
    const dupLeft = shown.length - identities.size - shown.filter((x) => !vehicleIdentity(x)).length;

    const notes: string[] = [];
    if (diff > 0) {
      notes.push(`넘침 ${diff}`);
      if (dupLeft > 0) notes.push(`잔여중복 ${dupLeft}`);
    } else if (diff < 0) {
      notes.push(`모자람 ${-diff}`);
      if (noPrice.length) notes.push(`가격없어 미게시 ${noPrice.length}`);
      if (blocked.length) notes.push(`출고불가 ${blocked.length}`);
    } else notes.push('일치 ✓');

    console.log(
      `${(exp.name + '(' + code + ')').padEnd(20)} ${String(exp.n).padStart(4)} ${String(shown.length).padStart(5)} ${String(diff > 0 ? '+' + diff : diff).padStart(6)}   ${notes.join(' · ')}`,
    );

    if (ONLY) {
      console.log('\n── 우리가 게시중인 목록 ──');
      shown.sort((a, b) => S(a.car_number).localeCompare(S(b.car_number)))
        .forEach((x, i) => console.log(`  ${String(i + 1).padStart(3)}. ${S(x.car_number).padEnd(10)} ${S(x._key).padEnd(24)} ${S(x.maker)} ${S(x.sub_model) || S(x.model)} [${S(x.vehicle_status) || '빈값'}]`));
      // 시트와 대조
      const p = partners[code] || Object.values(partners).find((x) => S(x.partner_code) === code);
      const id = (S(p?.sheet_url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
      if (id) {
        const adapter = resolveAdapter(p!);
        const gids = (S(p?.sheet_gid) || S(p?.sheet_tab) || '').split(/[,\s|]+/).filter(Boolean);
        const sheetPlates = new Set<string>();
        for (const gid of (gids.length ? gids : [''])) {
          try {
            const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`, { redirect: 'follow' });
            if (!res.ok) continue;
            const table = adapter.prepareTable(parseCsv(await res.text()), { headerRow: Math.max(0, Number(p?.header_row) || 0) });
            const hdr = table[0]?.map(S) || [];
            const iP = hdr.findIndex((h) => /차량번호|차번|번호판|등록번호/.test(h.replace(/\s/g, '')));
            if (iP < 0) continue;
            for (const r of table.slice(1)) { const pl = S(r[iP]).replace(/\s/g, ''); if (pl && PLATE.test(pl)) sheetPlates.add(pl); }
          } catch { /* 탭 실패 무시 */ }
        }
        const ourPlates = new Set(shown.map(plateOf).filter(Boolean));
        const onlySheet = [...sheetPlates].filter((x) => !ourPlates.has(x));
        const onlyOurs = [...ourPlates].filter((x) => !sheetPlates.has(x));
        console.log(`\n시트 번호판 ${sheetPlates.size} · 우리 게시 ${ourPlates.size}`);
        console.log(`  시트에만 있음 ${onlySheet.length}: ${onlySheet.slice(0, 20).join(' ')}`);
        console.log(`  우리에만 있음 ${onlyOurs.length}: ${onlyOurs.slice(0, 20).join(' ')}`);
      }
    }
  }

  if (!ONLY) {
    console.log('─'.repeat(78));
    console.log(`${'합계'.padEnd(20)} ${String(sumExp).padStart(4)} ${String(sumOurs).padStart(5)} ${String(sumOurs - sumExp > 0 ? '+' + (sumOurs - sumExp) : sumOurs - sumExp).padStart(6)}`);
    console.log('\n한 곳 상세: --code=RP004');
  }
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
