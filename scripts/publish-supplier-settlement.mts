/**
 * **그 달 정산서를 «공급사 시트»에 탭으로 붙인다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-03 「유레카!!! 공급사시트에 월별 정산서를 붙여 디자인넣어서 그러면 되잖아」
 *
 * ★★**왜 여기인가.** 공급사는 이미 「○○ 프리패스 재고」 시트를 열어 보고 있다.
 *   거기에 붙이면 링크를 새로 줄 일도, 파일을 보낼 일도 없고, 달마다 탭이 «쌓인다».
 *
 * ★★**그 공급사 줄만 담는다.** 남의 정산이 섞이면 그 순간 사고다 —
 *   시트 이름의 별칭과 원장 공급사 이름을 맞춰 «하나»로 떨어질 때만 붙이고, 아니면 건너뛴다.
 *
 * ⚠ 이 시트들은 「링크 아는 사람 누구나」로 열려 있다(2026-09-03 실측 22곳 중 21곳).
 *   정산 금액에는 «요율»이 드러난다 — 링크가 새면 다른 공급사가 그 요율을 안다.
 *   그래서 기본이 dry-run 이다. 사람이 알고 눌러야 쓴다.
 *
 *   npx tsx scripts/publish-supplier-settlement.mts 2026-08
 *   npx tsx scripts/publish-supplier-settlement.mts 2026-08 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { CORP } from '../lib/domain/corporate-ci';
import { dueDate } from '../lib/domain/settlement-cycle';
import { settleTargetOf } from '../lib/domain/settlement-stage';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length);
if (!MONTH) { console.log('\n  달을 주세요 — npx tsx scripts/publish-supplier-settlement.mts 2026-08 [--apply]\n'); process.exit(1); }

const VAT = 0.1;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const tabOf = (m: string) => `${m.slice(2, 4)}년${m.slice(5)}월 정산`;
const monthKo = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
const dayKo = (d: Date | null) => (d ? `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}` : '');
/** 이름 맞추기 — 「스타」와 「스타스카이」, 「에스에이」와 「에스에이렌터카」가 같은 곳으로 떨어지게. */
const key = (v: unknown) => S(v).toLowerCase().replace(/[\s()·\-_.]/g, '')
  .replace(/(주식회사|㈜|렌터카|렌트카|모빌리티)/g, '');
/**
 * ★**고객 이름은 가린다** — 종이(PDF)와 «같은 규칙»이다. 「이해원」 → 「이*원」.
 *   ⚠ 이 시트는 「링크 아는 사람 누구나」로 열려 있다. 종이는 가리는데 시트만 온전히 두면
 *     가린 뜻이 없어진다. 공급사는 차량번호로 그 건을 찾으므로 이름은 곁다리다.
 */
const mask = (v: unknown) => { const t = S(v); return t.length < 2 ? t : t.length === 2 ? `${t[0]}*` : `${t[0]}${'*'.repeat(t.length - 2)}${t[t.length - 1]}`; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const tok = async () => (await jwt.getAccessToken()).token;

type Row = Record<string, unknown>;
const rows = (Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[])
  .filter((r) => r.cancelled !== true && S(r.billMonth) === MONTH);
const claws = (Object.values((await db.ref('v4/settlement_clawbacks').get()).val() || {}) as Row[])
  .filter((c) => S(c.month) === MONTH);

type Line = { plate: string; recv: string; what: string; net: number; vat: number; total: number };
/** ★청구탭·정산서와 «같은 규칙»으로 센다 — 정산 대상·비율·보류·부가세포함. */
const lineOf = (r: Row): Line => {
  const target = settleTargetOf(r.settleTarget);
  const ratio = N(r.settleRatio) || 1;
  const hold = r.billHold === true; const excl = r.settleExclude === true;
  const raw = excl || target === '영업' || hold ? 0 : Math.round(N(r.claimWritten) * ratio);
  const gross = r.vatIncluded === true;
  const net = gross ? Math.round(raw / (1 + VAT)) : raw;
  const vat = gross ? raw - net : Math.round(net * VAT);
  return {
    plate: S(r.plate) || '(차번없음)', recv: S(r.receivedAt),
    what: [S(r.model), mask(r.customer), S(r.product), N(r.term) ? `${N(r.term)}개월` : ''].filter(Boolean).join(' · '),
    net, vat, total: net + vat,
  };
};

const H = { Authorization: `Bearer ${await tok()}` };
const q = encodeURIComponent("name contains '프리패스 재고' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
const sheets = (((await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=60&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: H })).json()) as { files?: { id: string; name: string }[] }).files) || [];
/** ★「구버전·폐기」로 이름 붙은 시트는 안 본다 — 경진카가 그것 때문에 «둘»로 잡혔다. */
const live = sheets.filter((f) => !/구버전|폐기|백업/.test(S(f.name)));
/** 「[F50 사용중] 손오공 프리패스 재고」에서 「손오공」만 뽑는다. */
const aliasOf = (name: string) => S(name).replace(/^\[[^\]]*\]\s*/, '').replace(/\s*프리패스 재고.*$/, '');

const sups = [...new Set(rows.map((r) => S(r.supplier)).filter(Boolean))];
console.log(`\n■ ${MONTH} — 공급사 ${sups.length}곳 · 재고 시트 ${sheets.length}개 ${APPLY ? '(반영)' : '(대조만)'}\n`);

type Job = { sup: string; sheetId: string; sheetName: string; lines: Line[]; net: number; vat: number; claw: number };
const jobs: Job[] = []; const skip: string[] = [];
for (const sup of sups) {
  if (ONLY && !sup.includes(ONLY)) continue;
  const hit = live.filter((f) => {
    const a = key(aliasOf(f.name)); const b = key(sup);
    return a && b && (a === b || a.startsWith(b) || b.startsWith(a));
  });
  const mine = rows.filter((r) => S(r.supplier) === sup).map(lineOf).filter((l) => l.total !== 0);
  const cl = claws.filter((c) => S(c.supplier) === sup).reduce((a, c) => a + N(c.supplierAmt), 0);
  if (!mine.length && !cl) continue;
  if (hit.length !== 1) { skip.push(`${sup} — 재고 시트를 ${hit.length === 0 ? '못 찾음' : `${hit.length}개나 찾음`}`); continue; }
  const net = mine.reduce((a, b) => a + b.net, 0) - cl;
  const vat = mine.reduce((a, b) => a + b.vat, 0) - Math.round(cl * VAT);
  jobs.push({ sup, sheetId: hit[0].id, sheetName: hit[0].name, lines: mine, net, vat, claw: cl });
}
for (const j of jobs) {
  console.log(`   ${j.sup.padEnd(11)} ${String(j.lines.length).padStart(2)}줄  합계 ${won(j.net + j.vat).padStart(12)}${j.claw ? `  (환수 -${won(j.claw)})` : ''}`);
  console.log(`   ${''.padEnd(11)}  → ${aliasOf(j.sheetName)} 시트 「${tabOf(MONTH)}」`);
}
if (skip.length) { console.log('\n   ⚠ 건너뛴 곳 — 시트를 «하나»로 못 맞췄습니다'); for (const m of skip) console.log(`      ${m}`); }
if (!APPLY) { console.log('\n※ dry-run — 아무 시트도 안 건드렸습니다. --apply 로 붙입니다.\n'); process.exit(0); }

const NAVY = { red: 0.06, green: 0.11, blue: 0.21 };
const TINT = { red: 0.93, green: 0.95, blue: 0.98 };
const HEAD = ['No.', '차량번호', '접수일', '차량 · 계약조건', '공급가액', '부가세', '합계'];
const WIDTH = [46, 92, 88, 250, 100, 88, 108];

for (const j of jobs) {
  const tab = tabOf(MONTH);
  const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${j.sheetId}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
    sheets?: { properties: { sheetId: number; title: string } }[] };
  let id = (meta.sheets || []).find((s) => s.properties.title === tab)?.properties.sheetId;
  if (id === undefined) {
    const add = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${j.sheetId}:batchUpdate`, {
      method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab, index: 0, gridProperties: { rowCount: j.lines.length + 30, columnCount: HEAD.length } } } }] }),
    })).json() as { replies?: { addSheet?: { properties?: { sheetId?: number } } }[] };
    id = add.replies?.[0]?.addSheet?.properties?.sheetId;
  }
  if (id === undefined) { console.log(`   x ${j.sup} — 탭을 못 만들었습니다`); continue; }

  const body: (string | number)[][] = j.lines.map((l, i) => [i + 1, l.plate, l.recv, l.what, l.net, l.vat, l.total]);
  if (j.claw) body.push(['', '환수', '', '지난 정산분 환수', -j.claw, -Math.round(j.claw * VAT), -(j.claw + Math.round(j.claw * VAT))]);
  const values: (string | number)[][] = [
    [`${monthKo(MONTH)} 정산서`, `${j.sup} 귀중 · ${CORP.name} 발행`, '', '', '', '', ''],
    ['', '', '', '', '공급가액', '부가세', '청구 금액'],
    ['', '', '', '', j.net, j.vat, j.net + j.vat],
    HEAD,
    ...body,
    ['', '합계', `${j.lines.length}건`, '', j.net, j.vat, j.net + j.vat],
    [],
    [`${dayKo(dueDate(MONTH))} 까지 입금 부탁드립니다`, '', '', '', '', '', ''],
    [`${CORP.staff} · ${S(CORP.staffPhone) || CORP.phone} · ${CORP.email}`, '', '', '', '', '', ''],
    ['한 달간 함께해 주셔서 감사합니다 · 프리패스모빌리티 주식회사 임직원 일동', '', '', '', '', '', ''],
  ];
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${j.sheetId}/values/${encodeURIComponent(`'${tab}'!A1:G${values.length + 5}`)}?valueInputOption=RAW`, {
    method: 'PUT', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });

  const r0 = 3;                        // 머리줄
  const last = r0 + 1 + body.length;   // 합계줄
  const bar = (row: number, right: boolean) => ({ repeatCell: {
    range: { sheetId: id, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: HEAD.length },
    cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: right ? 'RIGHT' : 'CENTER', verticalAlignment: 'MIDDLE' } },
    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)' } });
  const tint = (row: number) => ({ repeatCell: { range: { sheetId: id, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: HEAD.length },
    cell: { userEnteredFormat: { backgroundColor: TINT, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });

  const reqs: Record<string, unknown>[] = [
    { unmergeCells: { range: { sheetId: id } } },
    { updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: 0 } }, fields: 'gridProperties.frozenRowCount' } },
    { mergeCells: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: HEAD.length }, mergeType: 'MERGE_ALL' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEAD.length },
      cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10, right: 10, top: 2, bottom: 2 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
    bar(1, true), bar(r0, false), tint(2), tint(last),
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: last + 1, startColumnIndex: 4, endColumnIndex: 7 },
      cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: r0 + 1, endRowIndex: last, startColumnIndex: 1, endColumnIndex: 4 },
      cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: r0 + 1, endRowIndex: last, startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: last + 2, endRowIndex: last + 5, startColumnIndex: 0, endColumnIndex: HEAD.length },
      cell: { userEnteredFormat: { textFormat: { fontSize: 10 }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(textFormat,horizontalAlignment)' } },
    ...WIDTH.map((w, c) => ({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
    { repeatCell: { range: { sheetId: id }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Roboto' } } }, fields: 'userEnteredFormat.textFormat.fontFamily' } },
    { updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: r0 + 1 } }, fields: 'gridProperties.frozenRowCount' } },
  ];
  const fr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${j.sheetId}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: reqs }),
  });
  console.log(`   ${fr.ok ? 'o' : '! 서식'} ${j.sup.padEnd(11)} ${String(j.lines.length).padStart(2)}줄 · ${won(j.net + j.vat).padStart(12)}  →  ${aliasOf(j.sheetName)} 시트`);
  if (!fr.ok) console.log(`      ${(await fr.text()).slice(0, 160)}`);
}
console.log(`\n   ✓ ${jobs.length}곳에 붙였습니다.\n`);
process.exit(0);
