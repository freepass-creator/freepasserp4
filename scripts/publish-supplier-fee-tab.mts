/**
 * **공급사 시트에 「수수료」 탭을 만들고, 원장에서 배운 값을 미리 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25 「수수료표 올리라고 할테니까 학습해서 공급사별로 공급사시트에 박아주고
 *   그걸 가지고 업무하자」.
 *
 * ★**빈 표를 주지 않는다.** 지금까지 실제로 준 값을 먼저 채워 놓고 «맞나 보라»고 한다.
 *   빈 표를 주면 공급사는 자기가 유리한 값을 새로 적는다. 채워 두면 «다르면 고쳐 달라»가 된다.
 * ★배운 값은 **가장 많이 쓰인 값**이다. 평균이 아니다 — 정률과 정액이 섞여 있어 평균은 뜻이 없다.
 *   여러 값이 쓰인 자리는 「비고」에 «원장 N건 중 M가지»로 적어 둔다. 숨기면 나중에 다툰다.
 *
 * ★탭은 **다섯째**로 둔다 — 재고·운영정책·공지사항·회사정보 뒤.
 *   2026-08-21 에 넷으로 줄였지만 수수료는 공급사가 올려야 하는 값이라 보이는 자리가 있어야 한다.
 *
 * ★규격 정본은 `lib/domain/supplier-fee-table.ts`.
 *
 *   npx tsx scripts/publish-supplier-fee-tab.mts
 *   npx tsx scripts/publish-supplier-fee-tab.mts --apply
 *   npx tsx scripts/publish-supplier-fee-tab.mts --apply --only=아이카,손오공
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { FEE_TAB_NAME, FEE_COLUMNS, FEE_BASIS, FEE_PRODUCT_KINDS, FEE_COLUMN_NOTES } from '../lib/domain/supplier-fee-table';

/**
 * ★**표만 주면 안 채운다** — 사장님 2026-08-25 「이걸 어떻게 설명하는게 좋은지가 관건」.
 *   공급사가 헷갈리는 건 «율이냐 금액이냐»가 아니라 **«무엇에 곱하느냐»**다.
 *   그래서 기준 셋마다 **숫자를 넣은 보기**를 같이 준다. 말로만 적으면 안 읽는다.
 * ★안내는 표 **오른쪽(H열)**에 둔다. 아래에 두면 줄이 늘 때마다 밀려 겹친다.
 */
const GUIDE: [string, string][] = [
  ['■ 이 표는 무엇인가', ''],
  ['', '프리패스가 이 회사에 드리는 수수료의 기준표입니다. 여기 적힌 값으로 매달 정산합니다.'],
  ['', '다르면 이 표를 고쳐 주세요. 고친 값이 다음 정산부터 그대로 쓰입니다.'],
  ['', ''],
  ['■ 한 줄이 «한 조건»입니다', ''],
  ['상품구분', '장기렌트 · 구독 · 선출고 · 견적출고 중 하나 (칸을 누르면 목록이 뜹니다)'],
  ['계약기간', '24 · 36 · 48 · 60. **비우면 그 상품구분의 모든 기간**에 걸립니다'],
  ['기준', '아래 셋 중 하나 (목록에서 고릅니다)'],
  ['공급사율', '이 회사가 받는 몫'],
  ['에이전시율', '프리패스가 영업채널에 주는 몫'],
  ['', ''],
  ['■ 기준 셋 — 무엇에 곱하나', ''],
  ['대여료×기간', '계약대여료 × 계약기간 × 요율'],
  ['   보기', '월 90만원 · 48개월 · 3.25%  →  900,000 × 48 × 0.0325 = 1,404,000원'],
  ['차량가액', '차량가액 × 요율'],
  ['   보기', '차량가액 4,000만원 · 3.5%  →  40,000,000 × 0.035 = 1,400,000원'],
  ['고정', '건당 정액입니다. **요율이 아닙니다**'],
  ['   보기', '1,000,000 이라고 적으면 건당 100만원'],
  ['', ''],
  ['■ 지금 채워진 값은', ''],
  ['', '프리패스 정산원장에서 «지금까지 실제로 드린 값»을 뽑아 미리 채워 뒀습니다.'],
  ['', '맞으면 그대로 두시고, 다르면 고쳐 주세요.'],
  ['', '비고에 «N건 중 M가지»라고 적힌 줄은 그동안 값이 갈렸던 자리입니다 — 꼭 확인 부탁드립니다.'],
  ['', ''],
  ['■ 찾는 차례 — 좁은 것이 이깁니다', ''],
  ['1)', '상품구분 + 계약기간이 다 맞는 줄'],
  ['2)', '없으면 계약기간이 빈 줄'],
  ['3)', '그래도 없으면 비워 둡니다 — 짐작해서 넣지 않습니다'],
];

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const ONLY = new Set(arg('only').split(',').map(S).filter(Boolean));
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => String.fromCharCode(65 + i);

type Learned = { 상품구분: string; 계약기간: string; 기준: string; 공급사율: string; 에이전시율: string; 건수: number; 갈림: number };
const LEARNED: Record<string, Learned[]> = existsSync('tmp/learned-fees.json')
  ? JSON.parse(readFileSync('tmp/learned-fees.json', 'utf8')) : {};
if (!Object.keys(LEARNED).length) {
  console.log('⛔ 배운 표가 없다 — `npx tsx scripts/learn-supplier-fees.mts` 를 먼저 돌려라.');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(30_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 200)}`);
  }
};

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const books = ((await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || [])
  .map((f: any) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) }))
  .filter((b: any) => !/구버전|폐기/.test(b.label))
  .sort((a: any, b: any) => a.label.localeCompare(b.label));

/** 배운 줄 중 표에 실을 것 — 상품구분이 있고, 율이든 금액이든 값이 있는 것만. */
const usable = (rows: Learned[]) => rows
  .filter((r) => r.상품구분 && !r.상품구분.startsWith('(') && (r.공급사율 || r.에이전시율))
  .sort((a, b) => a.상품구분.localeCompare(b.상품구분) || Number(a.계약기간 || 0) - Number(b.계약기간 || 0));

type Job = { label: string; id: string; rows: Learned[]; exists: boolean };
const jobs: Job[] = [];
for (const b of books) {
  if (ONLY.size && !ONLY.has(b.label)) continue;
  const meta = await api(`${SH}/${b.id}?fields=sheets.properties(title,sheetId,index)`);
  const exists = (meta.sheets || []).some((s: any) => S(s.properties.title) === FEE_TAB_NAME);
  jobs.push({ label: b.label, id: b.id, rows: usable(LEARNED[b.label] || []), exists });
}

console.log(`\n■ 공급사 「${FEE_TAB_NAME}」 탭 — ${APPLY ? '반영' : 'dry-run'} · 공급사 ${jobs.length}곳\n`);
for (const j of jobs) {
  console.log(`   ${j.label.slice(0, 12).padEnd(14)} ${j.exists ? '탭 있음' : '탭 만듦'} · 배운 줄 ${j.rows.length}${j.rows.length ? '' : ' (빈 표로 나간다 — 공급사가 채운다)'}`);
  for (const r of j.rows) {
    const warn = r.갈림 > 1 ? ` ⚠원장 ${r.건수}건에 ${r.갈림}가지` : '';
    console.log(`      ${r.상품구분.padEnd(9)} ${(r.계약기간 ? r.계약기간 + '개월' : '전기간').padEnd(7)} ${r.기준.padEnd(9)} 공급사 ${(r.공급사율 || '-').padEnd(11)} 에이전시 ${(r.에이전시율 || '-').padEnd(11)}${warn}`);
  }
}
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다. 반영은 --apply\n'); process.exit(0); }

let made = 0, filled = 0;
for (const j of jobs) {
  const meta = await api(`${SH}/${j.id}?fields=sheets.properties(title,sheetId,index)`);
  let sheetId = (meta.sheets || []).find((s: any) => S(s.properties.title) === FEE_TAB_NAME)?.properties?.sheetId;
  if (sheetId === undefined) {
    const made0 = await api(`${SH}/${j.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{
      addSheet: { properties: { title: FEE_TAB_NAME, index: 4, gridProperties: { rowCount: 60, columnCount: FEE_COLUMNS.length + 3, frozenRowCount: 1 } } },
    }] }) });
    sheetId = made0.replies[0].addSheet.properties.sheetId;
    made++;
  }
  sheetId = Number(sheetId);

  // 머리글 + 배운 줄. 값 칸은 공급사가 고칠 수 있게 열어 둔다.
  const values = [[...FEE_COLUMNS], ...j.rows.map((r) => [
    r.상품구분, r.계약기간, r.기준, r.공급사율, r.에이전시율,
    r.갈림 > 1 ? `원장 ${r.건수}건 중 ${r.갈림}가지가 쓰였다 — 맞는 값으로 고쳐 주세요` : `원장 ${r.건수}건에서 배운 값`,
  ])];
  await api(`${SH}/${j.id}/values/${encodeURIComponent(`'${FEE_TAB_NAME}'!A1:${colA1(FEE_COLUMNS.length - 1)}${values.length}`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', body: JSON.stringify({ values }),
  });
  filled += j.rows.length;

  // 안내는 H열부터 — 표(A~F)가 늘어도 안 겹친다. G는 사이 띄우는 빈 열.
  await api(`${SH}/${j.id}/values/${encodeURIComponent(`'${FEE_TAB_NAME}'!H1:I${GUIDE.length}`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: GUIDE.map(([k, v]) => [k, v]) }),
  });

  const reqs: Record<string, unknown>[] = [
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 10 }, horizontalAlignment: 'CENTER', backgroundColor: { red: 0.93, green: 0.95, blue: 0.99 } } }, fields: 'userEnteredFormat(textFormat,horizontalAlignment,backgroundColor)' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 3 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 5 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 330 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 560 }, fields: 'pixelSize' } },
    // 안내 제목(■)은 굵게 — 눈이 걸리는 자리가 있어야 읽는다.
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: GUIDE.length, startColumnIndex: 7, endColumnIndex: 8 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
    // 고르게 한다 — 손으로 적으면 글자가 갈린다(「대여료x기간」·「대여료＊기간」…).
    { setDataValidation: { range: { sheetId, startRowIndex: 1, endRowIndex: 60, startColumnIndex: 0, endColumnIndex: 1 },
      rule: { condition: { type: 'ONE_OF_LIST', values: FEE_PRODUCT_KINDS.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false } } },
    { setDataValidation: { range: { sheetId, startRowIndex: 1, endRowIndex: 60, startColumnIndex: 2, endColumnIndex: 3 },
      rule: { condition: { type: 'ONE_OF_LIST', values: FEE_BASIS.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: true } } },
  ];
  // 머리글 메모 — 칸을 짚으면 «여기 뭘 적나»가 뜬다.
  FEE_COLUMNS.forEach((name, i) => {
    const note = FEE_COLUMN_NOTES[name];
    if (note) reqs.push({ updateCells: { rows: [{ values: [{ note }] }], fields: 'note', start: { sheetId, rowIndex: 0, columnIndex: i } } });
  });
  await api(`${SH}/${j.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
}

const LOG = 'docs/수정이력-공급사시트.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const head = existsSync(LOG) ? readFileSync(LOG, 'utf8') : `# 수정이력 — 공급사 시트\n\n> 기계가 공급사 시트 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n`;
const body = [
  ``,
  `## ${when} · 「${FEE_TAB_NAME}」 탭 신설 — 원장에서 배운 값을 미리 채움`,
  ``,
  `도구 \`scripts/publish-supplier-fee-tab.mts --apply\` · 규격 \`lib/domain/supplier-fee-table.ts\``,
  `탭 만든 곳 **${made}** · 미리 채운 줄 **${filled}**. 빈 표를 주지 않고 «지금까지 준 값»을 채워 «맞나 보라»고 한다.`,
  `열 = ${FEE_COLUMNS.join(' · ')} · 기준 = ${FEE_BASIS.join(' / ')}`,
  `⚠ 원장에 여러 값이 쓰인 자리는 비고에 «N건 중 M가지»로 적어 뒀다 — 숨기면 나중에 다툰다.`,
  ``,
].join('\n');
const marker = '> 기계가 공급사 시트 구조를';
const cut = head.indexOf(marker);
const insertAt = cut >= 0 ? head.indexOf('\n', cut) + 1 : head.length;
writeFileSync(LOG, head.slice(0, insertAt) + body + head.slice(insertAt));

console.log(`\n■ 끝 — 탭 ${made}곳 신설 · 배운 줄 ${filled} 채움. 이력 ${LOG}\n`);
