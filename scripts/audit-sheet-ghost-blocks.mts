/**
 * **공급사 시트의 «떨어진 데이터 블록» 전수 조사.**
 *
 * 실측 발단(오토플러스): 전기차 프로모션 탭이 화면엔 11대인데 CSV 에는 25대였다.
 * 표 2~12행에 11대가 있고, **922행을 건너뛴 935~948행에 14대가 더** 있었다.
 * 그 14대는 전부 `할인판매` 라 코드가 정상 매물로 읽는다 — 그래서 재고가 부풀었다.
 * 공급사도 화면에선 안 보이니 모른다.
 *
 * 「떨어져 있다」가 곧 잘못은 아니다 — 같은 시트 본탭의 보류 3대도 떨어져 있지만
 * 상태가 `보류` 라 코드가 알아서 거른다. **떨어진 채 «팔 수 있는 상태»인 것**이 문제다.
 *
 * 그래서 판정은 둘을 같이 본다: ① 앞 블록과 떨어져 있고 ② 판매 가능 상태가 섞여 있다.
 *
 * 읽기 전용.
 *   npx tsx scripts/audit-sheet-ghost-blocks.mts
 *   ... --gap=20        블록 분리 기준(기본 20행)
 *   ... --code=RP004    한 곳만
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import { AUTOPLUS_GID_MAIN, AUTOPLUS_GID_PROMO } from '../lib/domain/sheet-autoplus';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: DB });
const db = getDatabase();
const S = (v: unknown) => String(v ?? '').trim();
const GAP = Number((process.argv.find((a) => a.startsWith('--gap=')) || '').slice('--gap='.length)) || 20;
const ONLY = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();
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

async function main() {
  const [t3, t4] = await Promise.all([db.ref('partners').get(), db.ref('v4/partners').get()]);
  const partners = mergeNodes(t3.val(), t4.val());
  const targets = Object.values(partners)
    .filter((p) => p && p._deleted !== true && S(p.sheet_url))
    .filter((p) => !ONLY || S(p.partner_code) === ONLY)
    .sort((a, b) => S(a.partner_code).localeCompare(S(b.partner_code)));

  console.log(`\n══ 시트 유령 블록 조사 (분리 기준 ${GAP}행) ══`);
  let ghostTotal = 0;
  const ghostRows: string[] = [];

  for (const p of targets) {
    const code = S(p.partner_code) || S(p._key);
    const name = S(p.name) || S(p.partner_name) || code;
    const id = (S(p.sheet_url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
    if (!id) continue;
    const adapter = resolveAdapter(p);
    const gids = (S(p.sheet_gid) || S(p.sheet_tab) || '').split(/[,\s|]+/).filter(Boolean);
    const tabs = gids.length ? gids : (adapter.id === 'autoplus' ? [AUTOPLUS_GID_MAIN, AUTOPLUS_GID_PROMO] : ['']);
    const lines: string[] = [];
    let providerGhost = 0;

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

        const rows: { line: number; st: string }[] = [];
        for (const [i, r] of table.slice(1).entries()) {
          const pl = S(r[iP]).replace(/\s/g, '');
          if (!pl || !PLATE.test(pl)) continue;
          rows.push({ line: i + 2, st: iS >= 0 ? (S(r[iS]) || '(빈값)') : '(상태열없음)' });
        }
        if (!rows.length) continue;

        // 연속 블록으로 자른다
        const blocks: { from: number; to: number; items: typeof rows }[] = [];
        let cur = { from: rows[0].line, to: rows[0].line, items: [rows[0]] };
        for (let i = 1; i < rows.length; i++) {
          if (rows[i].line - rows[i - 1].line > GAP) { blocks.push(cur); cur = { from: rows[i].line, to: rows[i].line, items: [rows[i]] }; }
          else { cur.to = rows[i].line; cur.items.push(rows[i]); }
        }
        blocks.push(cur);
        if (blocks.length < 2) continue; // 블록이 하나면 정상

        for (const [bi, b] of blocks.entries()) {
          if (bi === 0) continue; // 첫 블록은 본체
          const sellable = b.items.filter((x) => canonSheetVehicleStatus(x.st) !== '출고불가').length;
          const st = new Map<string, number>();
          b.items.forEach((x) => st.set(x.st, (st.get(x.st) || 0) + 1));
          const mark = sellable ? `★ 판매가능 ${sellable}` : '전부 출고불가(무해)';
          lines.push(`     gid ${(gid || '기본').padEnd(12)} 표 ${b.from}~${b.to}행  ${b.items.length}대  ${mark}`);
          lines.push(`        상태: ${[...st.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
          if (sellable) { providerGhost += sellable; ghostTotal += sellable; ghostRows.push(`  ${code.padEnd(10)} gid ${(gid || '기본').padEnd(12)} 표 ${b.from}~${b.to}행 · 판매가능 ${sellable}대`); }
        }
      } catch { /* 탭 하나 실패가 전체를 막지 않는다 */ }
    }
    if (lines.length) {
      console.log(`\n${code} ${name}${providerGhost ? `   ★ 유령 판매가능 ${providerGhost}대` : ''}`);
      lines.forEach((l) => console.log(l));
    }
  }

  console.log(`\n━━ 떨어진 블록의 «판매가능» 합계 ${ghostTotal}대`);
  if (ghostRows.length) { console.log('\n공급사에 알릴 목록:'); ghostRows.forEach((r) => console.log(r)); }
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
