/**
 * **그 달 정산서를 «공급사 시트»에 탭으로 붙인다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-03 「유레카!!! 공급사시트에 월별 정산서를 붙여 디자인넣어서 그러면 되잖아」
 *
 * ★★**왜 여기인가.** 공급사는 이미 「○○ 프리패스 재고」 시트를 열어 보고 있다.
 *   거기에 붙이면 링크를 새로 줄 일도, 파일을 보낼 일도 없고, 달마다 탭이 «쌓인다».
 *
 * ★★★**이 탭은 «종이(PDF)의 사본»이 아니다 — 시트는 «따져 보는 자리»다.**
 *   사장님 2026-09-03 「청구서 PDF랑 동일하게 하지말고 정산서는 탭 우측으로 하고
 *   산출조건도 있어야하고 매달매달 탭으로 줄거야 임차인정보도 있어야하고」
 * ```
 * 종이(PDF)   규격만 — 차량 · 금액. 읽고 결재하는 것
 * 이 탭        임차인정보 + 산출조건까지 — 「왜 이 금액인가」를 «따라 칠 수 있게»
 * ```
 *   ⇒ 열은 원장 청구탭과 «같은 이름»을 쓴다(적용한 표 규칙 · 산출근거). 이름이 갈리면
 *     공급사가 묻는 칸과 우리가 보는 칸이 달라져 통화가 길어진다.
 *
 * ★**탭은 «맨 오른쪽»에 선다.** 공급사가 매일 여는 것은 재고 탭이다 — 정산이 맨 앞에 서면
 *   자기 시트를 여는데 남의 서식이 먼저 뜬다. 달마다 오른쪽으로 쌓이면 차례가 곧 달력이 된다.
 *
 * ⚠ 이 시트들은 「링크 아는 사람 누구나」로 열려 있다(2026-09-03 실측 22곳 중 21곳).
 *   정산 금액에는 «요율»이, 이제는 «임차인 이름»까지 드러난다 — 링크가 새면 그대로 샌다.
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
import { feeKindOf, feeRuleFor, SUPPLIER_ALIAS } from '../lib/domain/settlement-fee-table';

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

type Line = { plate: string; recv: string; deliv: string; model: string; cust: string; product: string;
  term: number; rent: number; rule: string; how: string; net: number; vat: number; total: number };
/**
 * ★청구탭·정산서와 «같은 규칙»으로 센다 — 정산 대상·비율·보류·부가세포함.
 * ★★**산출조건은 원장 청구탭 `lineOf` 와 «같은 식»이다**(`적용한 표 규칙` · `산출근거`).
 *   갈리면 공급사가 보는 근거와 우리가 보는 근거가 달라진다.
 */
const lineOf = (r: Row): Line => {
  const target = settleTargetOf(r.settleTarget);
  const ratio = N(r.settleRatio) || 1;
  const hold = r.billHold === true; const excl = r.settleExclude === true;
  const raw = excl || target === '영업' || hold ? 0 : Math.round(N(r.claimWritten) * ratio);
  const gross = r.vatIncluded === true;
  const net = gross ? Math.round(raw / (1 + VAT)) : raw;
  const vat = gross ? raw - net : Math.round(net * VAT);

  const product = S(r.product); const term = N(r.term); const model = S(r.model);
  const { kind, form, fallback } = feeKindOf(product, model);
  const f = feeRuleFor(S(r.supplier), kind, term, form, fallback);
  let rule = ''; let how = '';
  if (f) rule = `${f.supplier} · ${f.kind}${f.term ? ` ${f.term}개월` : ' 기간무관'}${f.form ? ` · ${f.form}` : ''}`;
  if (f && f.auto) {
    const rate = Number(f.claim);
    const rs = rate < 1 ? `${(rate * 100).toFixed(2)}%` : won(rate);
    how = f.basis === '정액' ? `건당 ${won(rate)}`
      : f.basis === '차량가액' ? `차량가액 ${won(N(r.price))} × ${rs}`
        : `렌탈료 ${won(N(r.rent))} × ${term}개월 × ${rs}`;
    if (ratio !== 1) how += ` × 비율 ${ratio}`;
  } else if (f) how = `표 규칙 「${f.claim}」 — 개별 협의분`;
  else how = '개별 협의분';
  return {
    plate: S(r.plate) || '(차번없음)', recv: S(r.receivedAt), deliv: S(r.deliveredAt),
    model, cust: S(r.customer), product, term, rent: N(r.rent), rule, how,
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

const findSheet = (name: string) => live.filter((f) => {
  const a = key(aliasOf(f.name)); const b = key(name);
  return a && b && (a === b || a.startsWith(b) || b.startsWith(a));
});

type Job = { sup: string; sheetId: string; sheetName: string; tab: string; via: string; lines: Line[]; net: number; vat: number; claw: number };
const jobs: Job[] = []; const skip: string[] = [];
for (const sup of sups) {
  if (ONLY && !sup.includes(ONLY)) continue;
  let hit = findSheet(sup); let via = '';
  /**
   * ★★**시트를 «같이 쓰는» 곳이 있다** — 사장님 2026-09-03 「빌린카에 같이 쓰고 있잖아」.
   *   엘씨렌트는 제 재고 시트가 없고 빌린카 시트를 같이 쓴다(수수료표에서도 같은 회사).
   *   ⇒ 제 이름으로 못 찾으면 «별칭»으로 한 번 더 찾는다. 별칭도 SSOT(`SUPPLIER_ALIAS`)를 쓴다.
   */
  if (hit.length !== 1 && SUPPLIER_ALIAS[sup]) {
    const alt = findSheet(SUPPLIER_ALIAS[sup]);
    if (alt.length === 1) { hit = alt; via = SUPPLIER_ALIAS[sup]; }
  }
  const mine = rows.filter((r) => S(r.supplier) === sup).map(lineOf).filter((l) => l.total !== 0);
  const cl = claws.filter((c) => S(c.supplier) === sup).reduce((a, c) => a + N(c.supplierAmt), 0);
  if (!mine.length && !cl) continue;
  if (hit.length !== 1) { skip.push(`${sup} — 재고 시트를 ${hit.length === 0 ? '못 찾음' : `${hit.length}개나 찾음`}`); continue; }
  const net = mine.reduce((a, b) => a + b.net, 0) - cl;
  const vat = mine.reduce((a, b) => a + b.vat, 0) - Math.round(cl * VAT);
  jobs.push({ sup, sheetId: hit[0].id, sheetName: hit[0].name, tab: tabOf(MONTH), via, lines: mine, net, vat, claw: cl });
}
/**
 * ★★**한 시트에 두 곳이 들어오면 탭 이름에 «누구 것»을 붙인다.**
 *   청구서는 빌린카·엘씨 «두 장»이 따로 나간다. 금액을 한 탭에 합치면 어느 종이와도 안 맞는다.
 *   ⇒ 종이 한 장 = 탭 하나. 같은 시트에 둘이면 「26년08월 정산 · 엘씨렌트」로 갈라 세운다.
 */
for (const j of jobs) {
  if (jobs.filter((k) => k.sheetId === j.sheetId).length > 1) j.tab = `${tabOf(MONTH)} · ${j.sup}`;
}
for (const j of jobs) {
  console.log(`   ${j.sup.padEnd(11)} ${String(j.lines.length).padStart(2)}줄  합계 ${won(j.net + j.vat).padStart(12)}${j.claw ? `  (환수 -${won(j.claw)})` : ''}`);
  console.log(`   ${''.padEnd(11)}  → ${aliasOf(j.sheetName)} 시트 「${j.tab}」 (맨 오른쪽)${j.via ? `  ※ ${j.via} 시트를 같이 씀` : ''}`);
}
if (skip.length) { console.log('\n   ⚠ 건너뛴 곳 — 시트를 «하나»로 못 맞췄습니다'); for (const m of skip) console.log(`      ${m}`); }
if (!APPLY) { console.log('\n※ dry-run — 아무 시트도 안 건드렸습니다. --apply 로 붙입니다.\n'); process.exit(0); }

const NAVY = { red: 0.06, green: 0.11, blue: 0.21 };
const TINT = { red: 0.93, green: 0.95, blue: 0.98 };
/** ★산출조건은 «별도 영역» — 원장 청구탭과 같은 연보라를 쓴다. */
const BASIS_HEAD = { red: 0.90, green: 0.87, blue: 0.96 };
const BASIS_BODY = { red: 0.975, green: 0.97, blue: 0.99 };
/** 임차인정보 ── 산출조건 ── 금액. 이름은 원장 청구탭과 같게 둔다. */
const BASIS = ['적용한 표 규칙', '산출근거 (이대로 계산했습니다)'];
const HEAD = ['No.', '차량번호', '접수일', '인도일', '모델명', '임차인', '상품 구분', '계약 기간', '렌탈료',
  ...BASIS, '공급가액', '부가세', '합계'];
const WIDTH = [40, 92, 84, 84, 150, 76, 112, 76, 92, 190, 250, 100, 88, 108];
/**
 * ★★★**영업자 «지급» 수수료는 공급사 시트에 «절대» 안 들어간다** — 사장님 2026-09-03
 *   「절대 영업자 지급 수수료가 얼만지 공급사시트에는 반영되면 안돼」.
 *
 *   공급사가 우리 지급률을 보면 그 자리에서 «우리를 건너뛴 값»이 계산된다. 판이 깨진다.
 *   ⇒ 이 탭이 세는 것은 «청구» 한 축뿐이다 — `claimWritten` · `f.claim`. `payWritten`·
 *     `agentRate`·`channel`·`agent` 는 이 파일에서 «읽지 않는다».
 *   ⇒ 말로만 두지 않고 «기계가» 막는다. 아래 빗장에 걸리면 붙이기 전에 멈춘다.
 */
const FORBIDDEN = /지급|영업\s?채널|영업\s?담당|영업\s?수수료|이익|마진|payWritten|agentRate/;
const leak = HEAD.filter((h) => FORBIDDEN.test(h));
if (leak.length) { console.log(`\n  ✕ 멈춥니다 — 공급사 시트에 못 넣는 칸이 있습니다: ${leak.join(' · ')}\n`); process.exit(1); }

const iB = HEAD.indexOf(BASIS[0]);          // 산출조건 첫 칸
const iM = HEAD.indexOf('공급가액');          // 돈 첫 칸
const LEFT = ['모델명', ...BASIS];
const MONEY = ['렌탈료', '공급가액', '부가세', '합계'];

for (const j of jobs) {
  const tab = j.tab;
  const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${j.sheetId}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
    sheets?: { properties: { sheetId: number; title: string } }[] };
  const all = meta.sheets || [];
  let id = all.find((s) => s.properties.title === tab)?.properties.sheetId;
  const rowsNeed = j.lines.length + 20;
  /**
   * ★**이름을 «가른» 첫 달에는 이름 없는 옛 탭이 남는다** — 그것을 «고쳐 쓴다».
   *   지우지 않는다(남의 시트다). 이름만 바꿔 이어 쓰면 유령 탭이 안 생긴다.
   */
  if (id === undefined && tab !== tabOf(MONTH)) {
    const plain = all.find((s) => s.properties.title === tabOf(MONTH))?.properties.sheetId;
    if (plain !== undefined) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${j.sheetId}:batchUpdate`, {
        method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: plain, title: tab }, fields: 'title' } }] }),
      });
      id = plain;
    }
  }
  if (id === undefined) {
    const add = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${j.sheetId}:batchUpdate`, {
      method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab, index: all.length, gridProperties: { rowCount: rowsNeed, columnCount: HEAD.length } } } }] }),
    })).json() as { replies?: { addSheet?: { properties?: { sheetId?: number } } }[] };
    id = add.replies?.[0]?.addSheet?.properties?.sheetId;
  } else {
    /**
     * ★이미 있던 탭 — 칸을 넓히고 «맨 오른쪽»으로 옮긴다(예전 판은 맨 앞 7칸이었다).
     * ★★**옮길 때 index 는 «뺀 뒤» 기준이다** — `all.length - 1` 로 주면 끝에서 한 칸 당겨져
     *   「AI 운영 매뉴얼」 앞에 선다(실측 2026-09-03). 끝에 세우려면 `all.length`.
     * ★★**병합은 값을 쓰기 «전»에 푼다.** 병합 안쪽 칸에 값을 쓰면 시트가 «조용히 버린다» —
     *   서식 단계에서 풀면 이미 늦어서 제목 줄이 빈 채로 남는다(실측 2026-09-03).
     */
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${j.sheetId}:batchUpdate`, {
      method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [
        { updateSheetProperties: { properties: { sheetId: id, index: all.length, gridProperties: { rowCount: rowsNeed, columnCount: HEAD.length, frozenRowCount: 0, frozenColumnCount: 0 } }, fields: 'index,gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount)' } },
        { unmergeCells: { range: { sheetId: id } } },
      ] }),
    });
  }
  if (id === undefined) { console.log(`   x ${j.sup} — 탭을 못 만들었습니다`); continue; }

  const pad = (n: number) => Array.from({ length: n }, () => '');
  const body: (string | number)[][] = j.lines.map((l, i) => [i + 1, l.plate, l.recv, l.deliv, l.model, l.cust,
    l.product, l.term || '', l.rent || '', l.rule, l.how, l.net, l.vat, l.total]);
  if (j.claw) body.push(['', '환수', '', '', '지난 정산분 환수', '', '', '', '', '', '수수료표로 내는 값이 아니다',
    -j.claw, -Math.round(j.claw * VAT), -(j.claw + Math.round(j.claw * VAT))]);
  const values: (string | number)[][] = [
    /**
     * ★★**제목 띠는 «C1 부터» 병합한다** — 얼린 칸(A·B)을 가로지르면 시트가 통째로 거부한다
     *   (「병합된 셀의 일부만 포함된 열을 고정할 수 없습니다」 · 실측 2026-09-03 12곳 전부).
     *   A1:B1 은 글 없이 남색만 칠해 «한 줄 띠»로 보이게 한다 — 원장 청구탭과 같은 짜임.
     */
    ['', '', `${monthKo(MONTH)} 정산서    ·    ${j.sup} 귀중 · ${CORP.name} 발행`, ...pad(HEAD.length - 3)],
    [...pad(HEAD.length - 3), '공급가액', '부가세', '청구 금액'],
    [...pad(HEAD.length - 3), j.net, j.vat, j.net + j.vat],
    HEAD,
    ...body,
    ['', '합계', `${j.lines.length}건`, ...pad(iM - 3), j.net, j.vat, j.net + j.vat],
    [],
    [`${dayKo(dueDate(MONTH))} 까지 입금 부탁드립니다`, ...pad(HEAD.length - 1)],
    [`${CORP.staff} · ${S(CORP.staffPhone) || CORP.phone} · ${CORP.email}`, ...pad(HEAD.length - 1)],
    ['한 달간 함께해 주셔서 감사합니다 · 프리패스모빌리티 주식회사 임직원 일동', ...pad(HEAD.length - 1)],
  ];
  const endCol = String.fromCharCode(64 + HEAD.length);
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${j.sheetId}/values/${encodeURIComponent(`'${tab}'!A1:${endCol}${values.length + 5}`)}?valueInputOption=RAW`, {
    method: 'PUT', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });

  const r0 = 3;                        // 머리줄
  const last = r0 + 1 + body.length;   // 합계줄
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
    { updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: 0, frozenColumnCount: 0 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
    { mergeCells: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 2, endColumnIndex: HEAD.length }, mergeType: 'MERGE_ALL' } },
    { repeatCell: { range: all1(0, 1),
      cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10, right: 10, top: 2, bottom: 2 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
    bar(1, true), bar(r0, false), tint(2), tint(last),
    /** ★머리줄 40 — 「산출근거 (이대로 계산했습니다)」가 두 줄로 접혀야 안 잘린다. */
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r0, endIndex: r0 + 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r0 + 1, endIndex: last + 1 }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
    /** ★산출조건 영역 — 머리는 연보라, 줄은 아주 연하게. 금액 칸과 «눈으로» 갈린다. */
    { repeatCell: { range: { sheetId: id, startRowIndex: r0, endRowIndex: r0 + 1, startColumnIndex: iB, endColumnIndex: iB + BASIS.length },
      cell: { userEnteredFormat: { backgroundColor: BASIS_HEAD, textFormat: { bold: true, fontSize: 10, foregroundColor: NAVY }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: r0 + 1, endRowIndex: last, startColumnIndex: iB, endColumnIndex: iB + BASIS.length },
      cell: { userEnteredFormat: { backgroundColor: BASIS_BODY, textFormat: { fontSize: 9 } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    // 정렬 — 돈은 우측 · 글은 좌측 · 나머지 가운데
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
    /** ★머리 네 줄 + 차량번호까지 얼린다 — 산출조건까지 가로로 미는 표라 차번을 잃으면 못 읽는다. */
    { updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: r0 + 1, frozenColumnCount: 2 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
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
