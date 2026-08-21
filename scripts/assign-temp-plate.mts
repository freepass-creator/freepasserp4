/**
 * **번호 전 신차에 임시번호(`100신0001`)를 붙여 시트에 박는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-21 「실제로 출고 확정되면 차량번호 없이 올린다고 · 차대번호는 안 넣는다고 봐야지」.
 *   출고는 확정됐는데 번호판이 아직 없고, 공급사는 차대번호(VIN)도 안 적는다.
 *   그러면 그 차를 **알아볼 근거가 아무것도 없다** — 그래서 우리가 번호를 하나 뽑아 시트에 적어 준다.
 *
 * ★**왜 시트에 박나** — 번호를 그때그때 계산하면 안 된다(`lib/domain/pending-plate.ts` 주석의 실측):
 *   · 행 위치로 만들면 위에서 한 줄만 지워도 아래가 밀려 **계약 걸린 매물이 다른 실물 차로 바뀐다**
 *   · 행 내용으로 만들면 셀 하나만 고쳐도 번호가 바뀌어 **같은 차가 계약중·출고가능 둘로 갈린다**(트윈 중복판매)
 *   한 번 뽑아 **시트에 적어 두면** 그 값이 곧 열쇠라 안 흔들린다.
 *
 * ★대상 — 「차량번호」가 비었거나 「미정」이고, **차명이 적혀 있는 줄**(빈 줄은 차가 아니다).
 *   차대번호가 있으면 대상이 아니다(그게 더 좋은 신원이다).
 * ★번호가 나오면 — 공급사가 차량번호 칸을 **실번호로 덮어쓴다**. 우리는 그때 같은 차로 잇는다.
 *   화면에는 임시번호 대신 「출고예정」으로 보인다(`product.TEMP_PLATE_RE`).
 *
 *   npx tsx scripts/assign-temp-plate.mts
 *   npx tsx scripts/assign-temp-plate.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, supplierSheetLabel, isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const REAL_PLATE = /^\d{2,3}[가-힣]\d{4}$/;
const TEMP_PLATE = /^100신(\d{4,})$/;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 120)}`);
  }
};
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const books = (((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as Rec[])
  .map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));

// ── 이미 쓰인 임시번호 — 전체에서 제일 큰 순번 뒤로 이어 붙인다(전역 유일)
type Target = { book: string; id: string; tab: string; row: number; col: number; 차명: string; 상태: string; 지금: string };
const targets: Target[] = [];
const typos: string[] = [];
let maxSeq = 0;
for (const b of books) {
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties(title,hidden)`);
  for (const p of ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec)) {
    const tab = S(p.title); if (p.hidden || isOurNonInventoryTab(tab) || !/재고/.test(tab) || /상품시트/.test(tab)) continue;
    let rows: string[][]; try { rows = (((await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${tab}!A1:BZ700`)}`)).values || []) as string[][]); } catch { continue; }
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차량번호')); if (hi < 0) continue;
    const h = rows[hi].map(norm);
    const pi = h.indexOf('차량번호'); const vi = h.indexOf('차대번호'); const si = h.indexOf('상태'); const cn = h.findIndex((x) => x.startsWith('차명'));
    rows.slice(hi + 1).forEach((r, k) => {
      const plate = norm(r[pi]);
      const m = TEMP_PLATE.exec(plate);
      if (m) { maxSeq = Math.max(maxSeq, Number(m[1])); return; }
      if (REAL_PLATE.test(plate)) return;
      if (vi >= 0 && norm(r[vi]).length >= 6) return;              // VIN 이 있으면 그게 더 좋은 신원이다
      const name = cn >= 0 ? S(r[cn]) : '';
      if (!name) return;                                            // 빈 줄은 차가 아니다
      /**
       * ★대상은 «비었거나 미정»인 칸뿐이다. 「870」처럼 **뭔가 적혀 있는데 번호꼴이 아닌 것**은
       *   번호 오기다 — 임시번호로 덮으면 원래 적힌 값을 잃는다. 목록에만 남기고 사람이 고친다.
       */
      if (plate && !/^미정$/.test(plate)) { typos.push(`${b.label} 「${tab}」 ${hi + 2 + k}줄 「${plate}」 ${name.slice(0, 24)}`); return; }
      targets.push({ book: b.label, id: b.id, tab, row: hi + 2 + k, col: pi, 차명: name, 상태: si >= 0 ? S(r[si]) : '', 지금: plate || '(빈칸)' });
    });
  }
}

console.log(`■ 임시번호를 붙일 신차 ${targets.length}대 (이미 쓰인 마지막 순번 ${maxSeq}) ${APPLY ? '(반영)' : '(dry-run)'}\n`);
const plan = targets.map((t, i) => ({ ...t, 임시번호: `100신${String(maxSeq + i + 1).padStart(4, '0')}` }));
for (const t of plan) console.log(`   ${t.book.slice(0, 10).padEnd(12)}「${t.tab.slice(0, 8)}」 ${String(t.row).padStart(3)}줄  ${t.지금.padEnd(8)} → ${t.임시번호}   ${t.상태.padEnd(6)} 「${t.차명.slice(0, 34)}」`);
if (typos.length) { console.log(`
  ⚠ 번호 오기로 보이는 줄 ${typos.length} — 임시번호를 안 준다(사람이 고칠 것)`); for (const t of typos) console.log(`     ${t}`); }
writeFileSync('tmp/temp-plate-plan.json', JSON.stringify(plan, null, 2));
if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply · 목록 tmp/temp-plate-plan.json\n'); process.exit(0); }

const byBook = new Map<string, { range: string; values: string[][] }[]>();
for (const t of plan) {
  const list = byBook.get(t.id) || [];
  list.push({ range: `'${t.tab.replace(/'/g, "''")}'!${colA1(t.col)}${t.row}`, values: [[t.임시번호]] });
  byBook.set(t.id, list);
}
for (const [id, data] of byBook) await call(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
console.log(`\n■ 끝 — ${plan.length}대에 임시번호를 적었다. 번호가 나오면 공급사가 그 칸을 실번호로 덮어쓴다.\n`);
