/**
 * **채우려면 «누가» 무엇을 줘야 하나** — 두 목록을 뽑는다. 읽기 전용.
 *
 * 사장님 2026-09-02 「이빨 빠진 상태로 둘 수가 있냐」 → 채울 수 있는 건 다 채웠고(원산지 149칸·
 * 배터리 별칭·정책), **남은 둘은 내가 만들 수 없는 것**이다. 그래서 «받을 목록»으로 낸다.
 *
 *   ① 차종마스터 보강     세부트림이 빈 차 — 라이브 마스터에 그 행이 없어서다.
 *                        ★지어내면 안 된다(2026-09-01 규칙 · 과거 사고). 마스터에 행이 들어가야 채워진다.
 *   ② 공급사 옵션 요청     옵션이 빈 차 — 원문에 아예 없다. 공급사가 적어 줘야 한다.
 *
 * 결과는 `tmp/보강-차종마스터.tsv` · `tmp/요청-공급사옵션.tsv` (탭 구분 — 시트에 그대로 붙여넣기).
 *
 *   npx tsx scripts/report-fill-todo.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
import { pickPublishedSalesTabs } from '../lib/domain/sales-published-tabs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const call = async (u: string): Promise<Rec> => {
  for (let n = 1; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
    const x = await r.text();
    if (r.ok) return JSON.parse(x);
    if ((r.status === 429 || r.status >= 500) && n <= 5) { await sleep(15_000 * n); continue; }
    throw new Error(`${r.status} ${x.slice(0, 160)}`);
  }
};

const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${SALES_SHEET_ID}?fields=sheets.properties(title)`);
const tabs = pickPublishedSalesTabs(((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)));

type Row = { 탭: string; 공급사: string; 차번: string; 제조사: string; 모델: string; 세부모델: string; 차명원문: string; 연식: string };
const 트림없음: Row[] = [];
const 옵션없음: Row[] = [];

for (const t of tabs) {
  const v = await call(`https://sheets.googleapis.com/v4/spreadsheets/${SALES_SHEET_ID}/values/${encodeURIComponent(t.title)}`);
  const rows = ((v.values || []) as string[][]);
  const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차량번호')); if (hi < 0) continue;
  const hdr = rows[hi].map(norm);
  const at = (re: RegExp) => hdr.findIndex((h) => re.test(h));
  const pi = hdr.indexOf('차량번호');
  const idx = {
    공급사: at(/공급사|렌트사/), 제조사: hdr.indexOf('제조사'), 모델: hdr.indexOf('모델'),
    세부모델: hdr.indexOf('세부모델'), 세부트림: hdr.indexOf('세부트림'),
    차명: at(/^차명/), 옵션: at(/^옵션/), 연식: at(/^연식|^연형/),
  };
  for (const r of rows.slice(hi + 1)) {
    const 차번 = norm(r[pi]); if (!/\d{2,3}[가-힣]\d{4}/.test(차번)) continue;
    const g = (i: number) => (i >= 0 ? S(r[i]) : '');
    const row: Row = {
      탭: t.prefix, 공급사: g(idx.공급사), 차번, 제조사: g(idx.제조사), 모델: g(idx.모델),
      세부모델: g(idx.세부모델), 차명원문: g(idx.차명), 연식: g(idx.연식),
    };
    const 트림 = g(idx.세부트림);
    const 옵션 = g(idx.옵션);
    if (!트림 || 트림 === '-') 트림없음.push(row);
    if (!옵션 || 옵션 === '-') 옵션없음.push(row);
  }
}

mkdirSync('tmp', { recursive: true });
const tsv = (rows: Row[], cols: (keyof Row)[]) =>
  [cols.join('\t'), ...rows.map((r) => cols.map((c) => r[c]).join('\t'))].join('\n');

/** ① 마스터 보강 — «같은 차종»끼리 묶는다. 마스터는 차 한 대가 아니라 차종을 담는 표다. */
const 묶음 = new Map<string, { 제조사: string; 모델: string; 세부모델: string; 차명원문: string; 대수: number; 연식: Set<string>; 보기: string[] }>();
for (const r of 트림없음) {
  const k = `${r.제조사}|${r.모델}|${r.세부모델}|${r.차명원문}`;
  if (!묶음.has(k)) 묶음.set(k, { 제조사: r.제조사, 모델: r.모델, 세부모델: r.세부모델, 차명원문: r.차명원문, 대수: 0, 연식: new Set(), 보기: [] });
  const g = 묶음.get(k)!;
  g.대수 += 1; if (r.연식) g.연식.add(r.연식);
  if (g.보기.length < 3) g.보기.push(r.차번);
}
const 보강 = [...묶음.values()].sort((a, b) => b.대수 - a.대수);
writeFileSync('tmp/보강-차종마스터.tsv',
  ['제조사\t모델\t세부모델\t차명(원문 — 여기에 트림이 들어 있다)\t대수\t연식\t보기(차번)',
    ...보강.map((g) => [g.제조사, g.모델, g.세부모델, g.차명원문, g.대수, [...g.연식].sort().join(','), g.보기.join(' ')].join('\t'))].join('\n'));

/** ② 공급사 옵션 요청 — 공급사별로 나눠 그대로 보낼 수 있게. */
const 옵션별 = new Map<string, Row[]>();
for (const r of 옵션없음) { const k = r.공급사 || '(칸없음)'; if (!옵션별.has(k)) 옵션별.set(k, []); 옵션별.get(k)!.push(r); }
writeFileSync('tmp/요청-공급사옵션.tsv', tsv(옵션없음, ['공급사', '탭', '차번', '제조사', '모델', '세부모델', '차명원문']));

console.log(`■ ① 차종마스터에 넣을 것 — 세부트림이 빈 차 ${트림없음.length}대 · ${보강.length}가지 차종`);
console.log(`   ${'제조사'.padEnd(6)}${'모델'.padEnd(14)}${'세부모델'.padEnd(18)}대수  차명(원문)`);
for (const g of 보강.slice(0, 15)) {
  console.log(`   ${g.제조사.padEnd(6)}${g.모델.slice(0, 13).padEnd(14)}${g.세부모델.slice(0, 17).padEnd(18)}${String(g.대수).padStart(3)}   ${g.차명원문.slice(0, 40)}`);
}
if (보강.length > 15) console.log(`   … 그 밖 ${보강.length - 15}가지`);

console.log(`\n■ ② 공급사에 받을 것 — 옵션이 빈 차 ${옵션없음.length}대`);
for (const [k, v] of [...옵션별.entries()].sort((a, b) => b[1].length - a[1].length)) console.log(`   ${k.padEnd(12)} ${v.length}대`);

console.log('\n기록  tmp/보강-차종마스터.tsv · tmp/요청-공급사옵션.tsv  (탭 구분 — 시트에 그대로 붙여넣기)');
