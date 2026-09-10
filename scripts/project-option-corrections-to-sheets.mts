/** 이번 옵션 의미 교정 대상 원자의 선택옵션을 F01/F86 해당 셀에만 투영한다. 기본 드라이런. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

type Rec = Record<string, unknown>;
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const PLATES = [
  '154어1404', '264도8211', '387누8807', '349더2317',
  '35서5793', '169루1079', '390버9300', '241마8124', '317누8253', '176서2754', '282나2079',
  '146오7914', '07어4389', '133라1401', '138모8017', '192머7372', '25구1926', '311저1956',
];
const BOOKS = [
  { code: 'F01', id: '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs' },
  { code: 'F86', id: '1hQtshpWKL4L0zSR3H3UQ36atICtHv9Ka7dQh7d7K5Vg' },
];
const saPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(saPath, 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();
const options = new Map<string, string>();
for (const plate of PLATES) {
  const snap = await fs.collection('products').doc(plate).get();
  if (!snap.exists) throw new Error(`원자 없음: ${plate}`);
  options.set(plate, S(snap.data()!.options));
}

const jwt = new JWT({ email: sa.client_email, key: S(sa.private_key).replace(/\\n/g, '\n'), subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const api = async (url: string, init?: RequestInit): Promise<any> => {
  const token = (await jwt.getAccessToken()).token;
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};
const qtab = (v: string) => `'${v.replace(/'/g, "''")}'`;
const colA1 = (zero: number) => {
  let n = zero + 1, out = '';
  while (n) { n--; out = String.fromCharCode(65 + n % 26) + out; n = Math.floor(n / 26); }
  return out;
};
type Cell = { book: string; id: string; tab: string; range: string; plate: string; before: string; after: string };
const cells: Cell[] = [];

for (const book of BOOKS) {
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${book.id}?fields=sheets.properties.title`);
  const tabs = (meta.sheets || []).map((x: any) => S(x.properties?.title)).filter(Boolean);
  for (const tab of tabs) {
    if (book.code === 'F01' && !['상품리스트', '손오공구독', '픽업구독', '오플구독', '자체렌트'].some((p) => tab.startsWith(p))) continue;
    const got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${book.id}/values/${encodeURIComponent(`${qtab(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
    const rows = (got.values || []) as unknown[][];
    const headerAt = rows.slice(0, 5).findIndex((r) => r.map(S).includes('차량번호') && r.map(S).some((h) => h === '옵션' || h === '옵션(원문)'));
    if (headerAt < 0) continue;
    const head = rows[headerAt].map(S);
    const plateAt = head.indexOf('차량번호');
    const optionAt = head.indexOf('옵션') >= 0 ? head.indexOf('옵션') : head.indexOf('옵션(원문)');
    for (let i = headerAt + 1; i < rows.length; i++) {
      const plate = S(rows[i]?.[plateAt]);
      if (!options.has(plate)) continue;
      cells.push({ book: book.code, id: book.id, tab, range: `${qtab(tab)}!${colA1(optionAt)}${i + 1}`, plate, before: S(rows[i]?.[optionAt]), after: options.get(plate)! });
    }
  }
}

for (const c of cells) console.log(`${c.book} ${c.range} ${c.plate}: ${c.before || '(빈칸)'} → ${c.after || '(빈칸)'}`);
for (const plate of PLATES) {
  const hits = cells.filter((c) => c.plate === plate);
  console.log(`${plate}: 시트 위치 ${hits.length}곳 (${hits.map((x) => `${x.book}/${x.tab}`).join(', ') || '없음'})`);
}
if (cells.length > PLATES.length * BOOKS.length
  || PLATES.some((plate) => BOOKS.some((book) => cells.filter((c) => c.plate === plate && c.book === book.code).length > 1))) {
  throw new Error(`차량별 F01/F86 옵션 셀이 한 곳을 초과하여 중단: ${cells.length}개`);
}
if (!APPLY) { console.log(`\n[드라이런] 바뀔 옵션 셀 ${cells.filter((c) => c.before !== c.after).length}개. --apply 로 반영.`); process.exit(0); }

const writes = cells.filter((c) => c.before !== c.after);
mkdirSync('tmp', { recursive: true });
const backupPath = `tmp/option-sheet-projection-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(backupPath, JSON.stringify({ captured_at: new Date().toISOString(), cells }, null, 2));
console.log(`시트 셀 백업: ${backupPath}`);
for (const book of BOOKS) {
  const data = writes.filter((c) => c.id === book.id).map((c) => ({ range: c.range, values: [[c.after]] }));
  if (data.length) await api(`https://sheets.googleapis.com/v4/spreadsheets/${book.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
}
for (const c of writes) {
  const got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${c.id}/values/${encodeURIComponent(c.range)}?valueRenderOption=UNFORMATTED_VALUE`);
  const actual = S(got.values?.[0]?.[0]);
  if (actual !== c.after) throw new Error(`시트 재검증 실패 ${c.book} ${c.range}: ${actual}`);
  console.log(`✓ ${c.book} ${c.range} ${c.plate} 재검증`);
}
