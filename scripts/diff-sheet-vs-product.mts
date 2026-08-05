/**
 * **시트 원본 차명 vs 우리 데이터 차명** — 행별 대조.
 *
 * 왜: 대수가 맞아도 «내용»이 맞는다는 뜻이 아니다. 실제로 이런 게 있다 —
 *   시트 「벤츠 S클래스 S 350d 4MATIC」  →  우리 「인피니티 M30d」
 *   시트 「팰리세이드 LX3 하이브리드」    →  우리 「기아 더 뉴 EV6」
 * 차종마스터 매칭이 트림 문자열에 낚이면 이렇게 된다. 영업자는 우리 화면을 보고 팔고,
 * 고객은 다른 차를 받는다. 대수 검증만으로는 절대 안 잡힌다.
 *
 * 판정 방법: 시트 「차종」의 핵심 토큰이 우리 차명에 들어 있는가.
 *   표기 차이(셀토스 2세대 ↔ 셀토스 SP2, SM7 뉴아트 ↔ SM7)는 걸러내려고
 *   세대 코드·수식어를 떼고 본다. 그래도 걸리는 것은 사람이 봐야 한다.
 *
 * 읽기 전용.
 *   npx tsx scripts/diff-sheet-vs-product.mts               전 공급사
 *   npx tsx scripts/diff-sheet-vs-product.mts --code=RP021  한 곳만
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: DB });
const db = getDatabase();

const ONLY = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();
const S = (v: unknown) => String(v ?? '').trim();
const PLATE = /^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;

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

/** 표기 차이를 걷어낸 비교용 형태. 세대코드·수식어·공백을 떼고 한글/영숫자만 남긴다. */
const norm = (s: string) => s
  .replace(/\(([^)]*)\)/g, ' ')
  .replace(/더뉴|더\s*뉴|올뉴|올\s*뉴|디올뉴|디\s*올\s*뉴|신형|뉴|the\s*new|all\s*new/gi, ' ')
  .replace(/\d+세대|\d+기|하이브리드|가솔린|디젤|전기|lpg|hev|phev|ev/gi, ' ')
  .replace(/클래스|시리즈|series|class/gi, ' ')
  .replace(/[^0-9A-Za-z가-힣]/g, '')
  .toLowerCase();

async function main() {
  const [t3, t4, p3, p4] = await Promise.all([
    db.ref('partners').get(), db.ref('v4/partners').get(),
    db.ref('products').get(), db.ref('v4/products').get(),
  ]);
  const partners = mergeNodes(t3.val(), t4.val());
  const prods = Object.values(mergeNodes(p3.val(), p4.val()))
    .filter((x) => x && x._deleted !== true && !x.deletedAt && S(x.status) !== 'deleted');
  const byPlate = new Map<string, EntityRecord[]>();
  for (const x of prods) {
    const pl = S(x.car_number).replace(/\s/g, '');
    if (!pl || !PLATE.test(pl)) continue;
    if (!byPlate.has(pl)) byPlate.set(pl, []);
    byPlate.get(pl)!.push(x);
  }

  const targets = Object.values(partners)
    .filter((p) => p && p._deleted !== true && S(p.sheet_url))
    .filter((p) => !ONLY || S(p.partner_code) === ONLY)
    .sort((a, b) => S(a.partner_code).localeCompare(S(b.partner_code)));

  let totalRows = 0, totalHit = 0;
  const suspects: { code: string; plate: string; sheet: string; ours: string }[] = [];
  const missing: { code: string; plate: string; sheet: string }[] = [];

  for (const p of targets) {
    const code = S(p.partner_code) || S(p._key);
    const id = (S(p.sheet_url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
    if (!id) continue;
    const adapter = resolveAdapter(p);
    const headerRow = Math.max(0, Number(p.header_row) || 0);
    const gids = (S(p.sheet_gid) || S(p.sheet_tab) || '').split(/[,\s|]+/).filter(Boolean);
    let rows = 0, hit = 0, sus = 0, miss = 0;
    for (const gid of (gids.length ? gids : [''])) {
      try {
        const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`, { redirect: 'follow' });
        if (!res.ok) continue;
        const table = adapter.prepareTable(parseCsv(await res.text()), { headerRow });
        if (table.length < 2) continue;
        const hdr = table[0].map(S);
        const iPlate = hdr.findIndex((h) => /차량번호|차번|번호판|등록번호/.test(h.replace(/\s/g, '')));
        const iCar = hdr.findIndex((h) => /^(차종|모델|차명)$/.test(h.replace(/\s/g, '')));
        const iTrim = hdr.findIndex((h) => /모델명|트림/.test(h.replace(/\s/g, '')));
        if (iPlate < 0 || iCar < 0) continue;
        for (const r of table.slice(1)) {
          const pl = S(r[iPlate]).replace(/\s/g, '');
          if (!pl || !PLATE.test(pl)) continue;
          const sheetName = `${S(r[iCar])} ${iTrim >= 0 ? S(r[iTrim]) : ''}`.trim();
          rows++; totalRows++;
          const ours = byPlate.get(pl);
          if (!ours?.length) { miss++; missing.push({ code, plate: pl, sheet: sheetName }); continue; }
          const o = ours[0];
          const ourName = `${S(o.maker)} ${S(o.sub_model) || S(o.model)}`.trim();
          const key = norm(S(r[iCar]));
          // 시트 차종의 앞 토큰이 우리 차명에 들어 있으면 같은 차로 본다.
          const ok = key.length >= 2 && norm(ourName).includes(key.slice(0, Math.min(5, key.length)));
          if (ok) { hit++; totalHit++; } else { sus++; suspects.push({ code, plate: pl, sheet: sheetName, ours: ourName }); }
        }
      } catch { /* 탭 하나 실패가 전체를 막지 않는다 */ }
    }
    if (rows) console.log(`${code.padEnd(10)} 시트 ${String(rows).padStart(4)}행 · 일치 ${String(hit).padStart(4)} · 의심 ${String(sus).padStart(3)} · 우리에 없음 ${miss}`);
  }

  console.log(`\n━━ 시트 ${totalRows}행 · 차명 일치 ${totalHit} · ★ 의심 ${suspects.length} · 우리에 없음 ${missing.length}`);
  if (suspects.length) {
    console.log('\n── 차명 의심 (사람이 봐야 한다) ───────────────────────');
    for (const s of suspects.slice(0, 60)) {
      console.log(`  ${s.code.padEnd(9)} ${s.plate.padEnd(10)} 시트「${s.sheet.slice(0, 34).padEnd(36)}」 우리「${s.ours}」`);
    }
    if (suspects.length > 60) console.log(`  … 외 ${suspects.length - 60}건`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
