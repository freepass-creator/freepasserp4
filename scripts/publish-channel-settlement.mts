/**
 * **그 달 지급명세서를 «영업채널 시트»에 탭으로 붙인다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-03 「야 영업채널거는 구글시트로 만들어줘야지」 · 「하허호는 오플거 분리해주고」
 *
 * ★★**공급사와 «거울»이다 — 다만 축이 반대다.**
 * ```
 * 공급사 시트   우리가 «받을» 것    청구 공급가액 · 부가세 · 합계
 * 영업채널 시트  우리가 «줄» 것      지급 공급가액 · 부가세 · 합계
 * ```
 * ★★★**청구액은 영업채널 시트에 «절대» 안 들어간다.** 공급사 쪽 빗장의 거울이다 —
 *   영업채널이 우리 청구액을 보면 우리 몫이 그대로 드러나고, 그 자리에서 «우리를 건너뛴 값»이 선다.
 *   이 탭이 세는 축은 «지급» 하나뿐이다(`payWritten` · `f.pay`). 아래 빗장이 기계로 막는다.
 *
 * ★영업채널은 재고 시트가 없다 — 없으면 «만든다»(「[영업] ○○ 프리패스 정산」).
 *   ⚠ 만들기만 하고 «밖으로는 안 연다». 공유는 회사(teamjpk.com)까지다 — 채널에 주는 것은
 *     사람이 확인하고 누를 일이다.
 *
 * ★**공급사를 갈라야 하는 채널이 있다** — 하허호는 오토플러스 건을 따로 본다(SPLIT).
 *   탭을 「26년08월 지급 · 오토플러스」로 갈라 세운다.
 *
 *   npx tsx scripts/publish-channel-settlement.mts 2026-08
 *   npx tsx scripts/publish-channel-settlement.mts 2026-08 --apply --only=하허호
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { CORP } from '../lib/domain/corporate-ci';
import { payDate } from '../lib/domain/settlement-cycle';
import { settleTargetOf } from '../lib/domain/settlement-stage';
import { feeKindOf, feeRuleFor } from '../lib/domain/settlement-fee-table';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length);
if (!MONTH) { console.log('\n  달을 주세요 — npx tsx scripts/publish-channel-settlement.mts 2026-08 [--apply]\n'); process.exit(1); }

const VAT = 0.1;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const tabOf = (m: string) => `${m.slice(2, 4)}년${m.slice(5)}월 지급`;
const monthKo = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
const dayKo = (d: Date | null) => (d ? `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}` : '');
const key = (v: unknown) => S(v).toLowerCase().replace(/[\s()·\-_.]/g, '').replace(/(주식회사|㈜|무심사|모빌리티)/g, '');

/** ★**갈라 봐야 하는 채널** — 사장님 2026-09-03 「하허호는 오플거 분리해주고」. */
const SPLIT: Record<string, string[]> = { 하허호: ['오토플러스'] };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const tok = async () => (await jwt.getAccessToken()).token;

type Row = Record<string, unknown>;
const rows = (Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[])
  .filter((r) => r.cancelled !== true && S(r.billMonth) === MONTH);
/**
 * ★★**환수를 «빠뜨리면» 종이와 안 맞는다** — 실측 2026-09-03 하허호가 585,600 어긋났다.
 *   지급 쪽 환수 금액은 `agentAmt` 다(공급사 쪽은 `supplierAmt`). 축을 헷갈리면 남의 돈을 뺀다.
 */
const claws = (Object.values((await db.ref('v4/settlement_clawbacks').get()).val() || {}) as Row[])
  .filter((c) => S(c.month) === MONTH);

type Line = { plate: string; recv: string; deliv: string; model: string; cust: string; sup: string; product: string;
  term: number; rent: number; rule: string; how: string; net: number; vat: number; total: number };
/**
 * ★원장 청구탭·지급명세서와 «같은 규칙»으로 센다 — 정산 대상·비율·제외·부가세포함.
 * ★★**여기서 세는 것은 «지급» 한 축뿐이다.** `claimWritten` 은 이 파일이 읽지 않는다.
 */
const lineOf = (r: Row): Line => {
  const target = settleTargetOf(r.settleTarget);
  const ratio = N(r.settleRatio) || 1;
  const excl = r.settleExclude === true;
  const raw = excl || target === '공급' ? 0 : Math.round(N(r.payWritten) * ratio);
  const gross = r.vatIncluded === true;
  const net = gross ? Math.round(raw / (1 + VAT)) : raw;
  const vat = gross ? raw - net : Math.round(net * VAT);

  const product = S(r.product); const term = N(r.term); const model = S(r.model);
  const { kind, form, fallback } = feeKindOf(product, model);
  const f = feeRuleFor(S(r.supplier), kind, term, form, fallback);
  let rule = ''; let how = '';
  if (f) rule = `${f.supplier} · ${f.kind}${f.term ? ` ${f.term}개월` : ' 기간무관'}${f.form ? ` · ${f.form}` : ''}`;
  if (f && f.auto && typeof f.pay === 'number') {
    const rate = f.pay;
    const rs = rate < 1 ? `${(rate * 100).toFixed(2)}%` : won(rate);
    how = f.basis === '정액' ? `건당 ${won(rate)}`
      : f.basis === '차량가액' ? `차량가액 ${won(N(r.price))} × ${rs}`
        : `렌탈료 ${won(N(r.rent))} × ${term}개월 × ${rs}`;
    if (ratio !== 1) how += ` × 비율 ${ratio}`;
  } else if (f) how = `표 규칙 「${f.pay}」 — 개별 협의분`;
  else how = '개별 협의분';
  return {
    plate: S(r.plate) || '(차번없음)', recv: S(r.receivedAt), deliv: S(r.deliveredAt),
    model, cust: S(r.customer), sup: S(r.supplier) || '(미기재)', product, term, rent: N(r.rent), rule, how,
    net, vat, total: net + vat,
  };
};

const H = { Authorization: `Bearer ${await tok()}` };
const drive = async (q: string) => (((await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=60&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: H })).json()) as { files?: { id: string; name: string }[] }).files) || [];
const sheetName = (ch: string) => `[영업] ${ch} 프리패스 정산`;

const chans = [...new Set(rows.map((r) => S(r.channel)).filter(Boolean))];
console.log(`\n■ ${MONTH} — 영업채널 ${chans.length}곳 ${APPLY ? '(반영)' : '(대조만)'}\n`);

type Back = { plate: string; sup: string; amt: number; why: string };
type Job = { ch: string; tab: string; lines: Line[]; backs: Back[]; net: number; vat: number };
const jobs: Job[] = [];
for (const ch of chans) {
  if (ONLY && !ch.includes(ONLY)) continue;
  const mine = rows.filter((r) => S(r.channel) === ch).map(lineOf).filter((l) => l.total !== 0);
  const mineBacks: Back[] = claws.filter((c) => S(c.channel) === ch)
    .map((c) => ({ plate: S(c.plate), sup: S(c.supplier), amt: N(c.agentAmt), why: S(c.reason) }))
    .filter((b) => b.amt !== 0);
  if (!mine.length && !mineBacks.length) continue;
  const cut = Object.entries(SPLIT).find(([k]) => key(ch).includes(key(k)))?.[1] || [];
  const isCut = (sup: string) => cut.some((s) => key(sup).includes(key(s)));
  /** 갈라 볼 공급사는 «제 탭»으로, 나머지는 한 탭으로. 환수도 «제 공급사» 탭을 따라간다. */
  const groups: [string, Line[], Back[]][] = [];
  for (const sup of cut) {
    const g = mine.filter((l) => key(l.sup).includes(key(sup)));
    const gb = mineBacks.filter((b) => key(b.sup).includes(key(sup)));
    if (g.length || gb.length) groups.push([`${tabOf(MONTH)} · ${sup}`, g, gb]);
  }
  const rest = mine.filter((l) => !isCut(l.sup));
  const restBacks = mineBacks.filter((b) => !isCut(b.sup));
  if (rest.length || restBacks.length) groups.push([tabOf(MONTH), rest, restBacks]);
  for (const [tab, lines, backs] of groups) {
    const cl = backs.reduce((a, b) => a + b.amt, 0);
    jobs.push({ ch, tab, lines, backs,
      net: lines.reduce((a, b) => a + b.net, 0) - cl,
      vat: lines.reduce((a, b) => a + b.vat, 0) - Math.round(cl * VAT) });
  }
}
for (const j of jobs) console.log(`   ${j.ch.padEnd(12)} ${String(j.lines.length).padStart(2)}줄 · 지급 ${won(j.net + j.vat).padStart(12)}${j.backs.length ? `  (환수 -${won(j.backs.reduce((a, b) => a + b.amt, 0))})` : ''}  →  「${j.tab}」`);
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 만들고 안 썼습니다. --apply 로 붙입니다.\n'); process.exit(0); }

const NAVY = { red: 0.06, green: 0.11, blue: 0.21 };
const TINT = { red: 0.93, green: 0.95, blue: 0.98 };
const BASIS_HEAD = { red: 0.90, green: 0.87, blue: 0.96 };
const BASIS_BODY = { red: 0.975, green: 0.97, blue: 0.99 };
const BASIS = ['적용한 표 규칙', '산출근거 (이대로 계산했습니다)'];
const HEAD = ['No.', '차량번호', '접수일', '인도일', '공급사', '모델명', '임차인', '상품 구분', '계약 기간', '렌탈료',
  ...BASIS, '공급가액', '부가세', '합계'];
const WIDTH = [40, 92, 84, 84, 92, 150, 76, 112, 76, 92, 190, 250, 100, 88, 108];
/**
 * ★★★**청구액은 영업채널 시트에 «절대» 안 들어간다** — 공급사 쪽 빗장의 거울.
 *   말로 두지 않고 머리글을 기계가 본다. 걸리면 붙이기 전에 멈춘다.
 */
const FORBIDDEN = /청구|받을|이익|마진|claimWritten|supplierRate/;
const leak = HEAD.filter((h) => FORBIDDEN.test(h));
if (leak.length) { console.log(`\n  ✕ 멈춥니다 — 영업채널 시트에 못 넣는 칸이 있습니다: ${leak.join(' · ')}\n`); process.exit(1); }

const iB = HEAD.indexOf(BASIS[0]);
const iM = HEAD.indexOf('공급가액');
const LEFT = ['모델명', ...BASIS];
const MONEY = ['렌탈료', '공급가액', '부가세', '합계'];

/** 채널 시트 — 있으면 쓰고 없으면 «만든다». 만든 것은 회사 안까지만 연다. */
const bookOf = new Map<string, string>();
async function book(ch: string): Promise<string> {
  if (bookOf.has(ch)) return bookOf.get(ch)!;
  const name = sheetName(ch);
  const found = await drive(`name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  let id = found[0]?.id || '';
  if (!id) {
    const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title: name, locale: 'ko_KR', timeZone: 'Asia/Seoul' } }) });
    id = S((await r.json() as { spreadsheetId?: string }).spreadsheetId);
    // ★공유는 회사 사람까지. 채널에 주는 것은 사람이 확인하고 누른다.
    await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions?supportsAllDrives=true`, {
      method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'domain', domain: 'teamjpk.com', role: 'writer' }) });
    console.log(`   + 시트를 만들었습니다 — ${name}`);
  }
  bookOf.set(ch, id);
  return id;
}

for (const j of jobs) {
  const bookId = await book(j.ch);
  const tab = j.tab;
  const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
    sheets?: { properties: { sheetId: number; title: string } }[] };
  const all = meta.sheets || [];
  let id = all.find((s) => s.properties.title === tab)?.properties.sheetId;
  const rowsNeed = j.lines.length + 20;
  if (id === undefined) {
    const add = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, {
      method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab, index: all.length, gridProperties: { rowCount: rowsNeed, columnCount: HEAD.length } } } }] }),
    })).json() as { replies?: { addSheet?: { properties?: { sheetId?: number } } }[] };
    id = add.replies?.[0]?.addSheet?.properties?.sheetId;
  } else {
    /** ★★병합은 값을 쓰기 «전»에 푼다 — 병합 안쪽 칸에 쓰면 시트가 조용히 버린다. */
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, {
      method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [
        { updateSheetProperties: { properties: { sheetId: id, index: all.length, gridProperties: { rowCount: rowsNeed, columnCount: HEAD.length, frozenRowCount: 0, frozenColumnCount: 0 } }, fields: 'index,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)' } },
        { unmergeCells: { range: { sheetId: id } } },
      ] }),
    });
  }
  if (id === undefined) { console.log(`   x ${j.ch} — 탭을 못 만들었습니다`); continue; }

  const pad = (n: number) => Array.from({ length: n }, () => '');
  const body: (string | number)[][] = j.lines.map((l, i) => [i + 1, l.plate, l.recv, l.deliv, l.sup, l.model, l.cust,
    l.product, l.term || '', l.rent || '', l.rule, l.how, l.net, l.vat, l.total]);
  /** ★환수는 «같은 표»에 음수로 선다 — 표를 둘로 쪼개면 합계를 두 번 보게 된다. */
  for (const b of j.backs) {
    body.push(['', b.plate, '', '', b.sup, '지난 지급분 환수', '', '', '', '', '', b.why || '수수료표로 내는 값이 아니다',
      -b.amt, -Math.round(b.amt * VAT), -(b.amt + Math.round(b.amt * VAT))]);
  }
  const values: (string | number)[][] = [
    /** ★제목 띠는 C1 부터 병합 — 얼린 칸(A·B)을 가로지르면 시트가 통째로 거부한다. */
    ['', '', `${monthKo(MONTH)} 지급명세서    ·    ${j.ch} 귀중 · ${CORP.name} 발행`, ...pad(HEAD.length - 3)],
    [...pad(HEAD.length - 3), '공급가액', '부가세', '지급 금액'],
    [...pad(HEAD.length - 3), j.net, j.vat, j.net + j.vat],
    HEAD,
    ...body,
    ['', '합계', `${j.lines.length}건`, ...pad(iM - 3), j.net, j.vat, j.net + j.vat],
    [],
    [`${dayKo(payDate(MONTH))} 지급 예정입니다`, ...pad(HEAD.length - 1)],
    [`${CORP.staff} · ${S(CORP.staffPhone) || CORP.phone} · ${CORP.email}`, ...pad(HEAD.length - 1)],
    ['세금계산서 발행 부탁드립니다 · 한 달간 함께해 주셔서 감사합니다', ...pad(HEAD.length - 1)],
  ];
  const endCol = String.fromCharCode(64 + HEAD.length);
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}/values/${encodeURIComponent(`'${tab}'!A1:${endCol}${values.length + 5}`)}?valueInputOption=RAW`, {
    method: 'PUT', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });

  const r0 = 3;
  const last = r0 + 1 + body.length;
  const all1 = (a: number, b: number) => ({ sheetId: id, startRowIndex: a, endRowIndex: b, startColumnIndex: 0, endColumnIndex: HEAD.length });
  const bar = (row: number, right: boolean) => ({ repeatCell: { range: all1(row, row + 1),
    cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: right ? 'RIGHT' : 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } });
  const tint = (row: number) => ({ repeatCell: { range: all1(row, row + 1),
    cell: { userEnteredFormat: { backgroundColor: TINT, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });
  const col = (h: string, r: { startRowIndex: number; endRowIndex: number }, cell: Record<string, unknown>, fields: string) => ({
    repeatCell: { range: { sheetId: id, ...r, startColumnIndex: HEAD.indexOf(h), endColumnIndex: HEAD.indexOf(h) + 1 }, cell: { userEnteredFormat: cell }, fields } });
  const DATA = { startRowIndex: r0 + 1, endRowIndex: last + 1 };

  const reqs: Record<string, unknown>[] = [
    { unmergeCells: { range: { sheetId: id } } },
    { mergeCells: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 2, endColumnIndex: HEAD.length }, mergeType: 'MERGE_ALL' } },
    { repeatCell: { range: all1(0, 1),
      cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10, right: 10, top: 2, bottom: 2 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
    bar(1, true), bar(r0, false), tint(2), tint(last),
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r0, endIndex: r0 + 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r0 + 1, endIndex: last + 1 }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: r0, endRowIndex: r0 + 1, startColumnIndex: iB, endColumnIndex: iB + BASIS.length },
      cell: { userEnteredFormat: { backgroundColor: BASIS_HEAD, textFormat: { bold: true, fontSize: 10, foregroundColor: NAVY }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: r0 + 1, endRowIndex: last, startColumnIndex: iB, endColumnIndex: iB + BASIS.length },
      cell: { userEnteredFormat: { backgroundColor: BASIS_BODY, textFormat: { fontSize: 9 } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    ...HEAD.map((h, c) => ({ repeatCell: { range: { sheetId: id, ...DATA, startColumnIndex: c, endColumnIndex: c + 1 },
      cell: { userEnteredFormat: { horizontalAlignment: MONEY.includes(h) ? 'RIGHT' : LEFT.includes(h) ? 'LEFT' : 'CENTER', verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)' } })),
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: 3, startColumnIndex: iM, endColumnIndex: HEAD.length },
      cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
    ...MONEY.map((h) => col(h, { startRowIndex: 2, endRowIndex: last + 1 }, { numberFormat: { type: 'NUMBER', pattern: '#,##0' } }, 'userEnteredFormat.numberFormat')),
    col('계약 기간', DATA, { numberFormat: { type: 'NUMBER', pattern: '0"개월"' } }, 'userEnteredFormat.numberFormat'),
    col('차량번호', DATA, { numberFormat: { type: 'TEXT' } }, 'userEnteredFormat.numberFormat'),
    { repeatCell: { range: all1(last + 2, last + 5),
      cell: { userEnteredFormat: { textFormat: { fontSize: 10 }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(textFormat,horizontalAlignment)' } },
    ...WIDTH.map((w, c) => ({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
    { repeatCell: { range: { sheetId: id }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Roboto' } } }, fields: 'userEnteredFormat.textFormat.fontFamily' } },
    { updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: r0 + 1, frozenColumnCount: 2 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
  ];
  const fr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: reqs }),
  });
  console.log(`   ${fr.ok ? 'o' : '! 서식'} ${j.ch.padEnd(12)} ${String(j.lines.length).padStart(2)}줄 · ${won(j.net + j.vat).padStart(12)}  →  「${tab}」`);
  if (!fr.ok) console.log(`      ${(await fr.text()).slice(0, 200)}`);
}
/**
 * ★새로 만든 시트에는 빈 「시트1」이 딸려 온다 — 탭을 하나라도 붙였으면 걷어낸다.
 *   ⚠ 이름이 「시트1/Sheet1」이고 «값이 없는» 것만 지운다. 사람이 쓰던 탭은 건드리지 않는다.
 */
for (const [, id] of bookOf) {
  const m = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties&includeGridData=false`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
    sheets?: { properties: { sheetId: number; title: string } }[] };
  const list = m.sheets || [];
  const blank = list.find((s) => /^(시트1|Sheet1)$/.test(s.properties.title));
  if (!blank || list.length < 2) continue;
  const v = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${blank.properties.title}'!A1:C3`)}`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as { values?: unknown[][] };
  if ((v.values || []).length) continue;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: blank.properties.sheetId } }] }),
  });
}

console.log('\n■ 시트');
for (const [ch, id] of bookOf) console.log(`   ${ch.padEnd(12)} https://docs.google.com/spreadsheets/d/${id}`);
console.log(`\n   ✓ ${jobs.length}개 탭을 붙였습니다.\n`);
process.exit(0);
