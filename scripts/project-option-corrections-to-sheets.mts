/** 이번 옵션 의미 교정 대상 원자의 선택옵션을 F01/F86 해당 셀에만 투영한다. 기본 드라이런. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

type Rec = Record<string, unknown>;
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const FIXED_PLATES = [
  '154어1404', '264도8211', '387누8807', '349더2317',
  '35서5793', '169루1079', '390버9300', '241마8124', '317누8253', '176서2754', '282나2079',
  '146오7914', '07어4389', '133라1401', '138모8017', '192머7372', '25구1926', '311저1956',
];
const TCAR_DESCRIPTION_MODE = process.argv.includes('--tcar-description');
const TCAR_DIRECT_MODE = process.argv.includes('--tcar-direct');
if (TCAR_DESCRIPTION_MODE && TCAR_DIRECT_MODE) throw new Error('T카 원천 모드는 하나만 선택');
const SOURCE_MODE = TCAR_DESCRIPTION_MODE || TCAR_DIRECT_MODE;
const sourceRows = SOURCE_MODE
  ? ((JSON.parse(readFileSync('sonokong/lib/wonja/손오공차량.json', 'utf8')) as { 차량?: Rec[] }).차량 || [])
  : [];
const PLATES = SOURCE_MODE
  ? sourceRows.filter((row) => TCAR_DIRECT_MODE
    ? S(row.유료옵션출처) === 'tcar:jsonData.paidOptList' && Array.isArray(row.유료옵션원문)
    : S(row.유료옵션출처) === 'carDescription:추가옵션' && S(row.유료옵션)).map((row) => S(row.차번))
  : FIXED_PLATES;
if (!PLATES.length || new Set(PLATES).size !== PLATES.length) throw new Error(`대상 차번 비정상: ${PLATES.length}`);
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
  const tabs = (meta.sheets || []).map((x: any) => S(x.properties?.title)).filter(Boolean)
    .filter((tab: string) => book.code !== 'F01' || ['상품리스트', '손오공구독', '픽업구독', '오플구독', '자체렌트'].some((p) => tab.startsWith(p)));
  const got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${book.id}/values:batchGetByDataFilter`, {
    method: 'POST',
    body: JSON.stringify({
      valueRenderOption: 'UNFORMATTED_VALUE',
      dataFilters: tabs.map((tab: string) => ({ a1Range: `${qtab(tab)}!A1:BZ3000` })),
    }),
  });
  const valueRanges = got.valueRanges || [];
  if (valueRanges.length !== tabs.length) throw new Error(`${book.code} 탭 일괄조회 수 불일치: ${valueRanges.length}/${tabs.length}`);
  for (const item of valueRanges) {
    const returnedRange = S(item?.valueRange?.range);
    const rawTab = returnedRange.slice(0, returnedRange.lastIndexOf('!'));
    const tab = rawTab.startsWith("'") && rawTab.endsWith("'")
      ? rawTab.slice(1, -1).replace(/''/g, "'")
      : rawTab;
    if (!tabs.includes(tab)) throw new Error(`${book.code} 예상하지 않은 탭 응답: ${tab}`);
    const rows = (item?.valueRange?.values || []) as unknown[][];
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

for (const c of cells.filter((cell) => cell.before !== cell.after)) console.log(`${c.book} ${c.range} ${c.plate}: ${c.before || '(빈칸)'} → ${c.after || '(빈칸)'}`);
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
for (const book of BOOKS) {
  const selected = writes.filter((c) => c.id === book.id);
  if (!selected.length) continue;
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${book.id}/values:batchGet`);
  url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
  for (const c of selected) url.searchParams.append('ranges', c.range);
  const got = await api(url.toString());
  const values = got.valueRanges || [];
  if (values.length !== selected.length) throw new Error(`${book.code} 재검증 범위 수 불일치: ${values.length}/${selected.length}`);
  selected.forEach((c, index) => {
    const actual = S(values[index]?.values?.[0]?.[0]);
    if (actual !== c.after) throw new Error(`시트 재검증 실패 ${c.book} ${c.range}: ${actual}`);
    console.log(`✓ ${c.book} ${c.range} ${c.plate} 재검증`);
  });
}
