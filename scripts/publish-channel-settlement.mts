/**
 * **그 달 정산서를 «영업채널 시트»에 탭으로 붙인다.** 기본 dry-run, 반영은 `--apply`.
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
 * ★**지급일이 다른 공급사는 «탭을 가른다»** — 오토플러스는 익월 25일(나머지 15일).
 *   한 탭에 15일 몫과 25일 몫이 섞이면 종이에 찍힌 날이 절반은 틀린 말이 된다.
 *
 *   npx tsx scripts/publish-channel-settlement.mts 2026-08
 *   npx tsx scripts/publish-channel-settlement.mts 2026-08 --apply --only=하허호
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { CORP } from '../lib/domain/corporate-ci';
import { payDate, payDayOf, PAY_DAY_BY_SUPPLIER } from '../lib/domain/settlement-cycle';
import { settleTargetOf } from '../lib/domain/settlement-stage';
import { feeKindOf, feeRuleFor } from '../lib/domain/settlement-fee-table';
import { channelSheetName, CHANNEL_SETTLE_HEAD, CHANNEL_SETTLE_WIDTH, SETTLE_BASIS, SETTLE_NOTE, settleTabOf } from '../lib/server/channel-sheet-tabs';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length);
if (!MONTH) { console.log('\n  달을 주세요 — npx tsx scripts/publish-channel-settlement.mts 2026-08 [--apply]\n'); process.exit(1); }

const VAT = 0.1;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
/** ★탭 이름도 「정산」이다 — 공급사 시트와 같은 말을 쓴다(사장님 2026-09-03 「정산서가 맞을거 같은데」). */
const tabOf = (m: string) => `${m.slice(2, 4)}년${m.slice(5)}월 정산`;
const monthKo = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
const dayKo = (d: Date | null) => (d ? `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}` : '');
const key = (v: unknown) => S(v).toLowerCase().replace(/[\s()·\-_.]/g, '').replace(/(주식회사|㈜|무심사|모빌리티)/g, '');

/**
 * ★★**왜 가르나 — «지급일이 달라서»다.** 사장님 2026-09-03
 *   「하허호는 오플거 분리해주고」 → 「하허호보니까 **오플 지급일이 달라서** 따로 정리해놨어」.
 *
 *   그러니 가르는 기준을 손으로 적지 않는다. 지급일이 다른 공급사(`PAY_DAY_BY_SUPPLIER`)를
 *   그대로 «가를 목록»으로 쓴다 — 날짜가 바뀌면 가름도 같이 따라온다. 채널마다 적으면 또 어긋난다.
 *   ⚠ 한 탭에 15일 몫과 25일 몫이 섞이면 «종이에 찍힌 날이 절반은 틀린 말»이 된다.
 */
const SPLIT_SUPPLIERS = Object.keys(PAY_DAY_BY_SUPPLIER);

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
  term: number; rent: number; how: string; net: number; vat: number; total: number };
/**
 * ★원장 청구탭·정산서와 «같은 규칙»으로 센다 — 정산 대상·비율·제외·부가세포함.
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
  let how = '';
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
    model, cust: S(r.customer), sup: S(r.supplier) || '(미기재)', product, term, rent: N(r.rent), how,
    net, vat, total: net + vat,
  };
};

const H = { Authorization: `Bearer ${await tok()}` };
const drive = async (q: string) => (((await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=60&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: H })).json()) as { files?: { id: string; name: string }[] }).files) || [];
/**
 * ★★**우리 시트는 «파일 이름에 F코드»를 박는다** — 사장님 2026-09-03 「우리 시트들 지금 파일명에
 *   시트 코드박고 있지?」. `[F5N 사용중] ○○ 프리패스 재고` 와 같은 규칙이다.
 *   코드가 없으면 지도(`aiops/docs/SHEET_MAP.md`)에 못 올라가고, 다음 사람이 이 시트를 «없는 것»으로 안다.
 *
 *   F01~F05 뼈대 · F50~F70 공급사 재고 · **F80~ 영업채널 정산**(2026-09-03 새로 뗌).
 * ⚠ 번호는 «지도가 정본»이다 — 새 채널을 만들면 여기 표와 SHEET_MAP 을 «같이» 고친다.
 */
const sheetName = channelSheetName;

/** ★환수만 있는 달도 세다 — 공급사 쪽과 같은 이치다. */
const chans = [...new Set([...rows.map((r) => S(r.channel)), ...claws.map((c) => S(c.channel))].filter(Boolean))];
console.log(`\n■ ${MONTH} — 영업채널 ${chans.length}곳 ${APPLY ? '(반영)' : '(대조만)'}\n`);

type Back = { plate: string; sup: string; amt: number; why: string };
type Job = { ch: string; tab: string; lines: Line[]; backs: Back[]; net: number; vat: number };
/** 지급일이 다른 공급사인가 — 맨 아래로 내리는 기준이자 줄마다 찍는 날의 기준. */
const isLate = (sup: string) => SPLIT_SUPPLIERS.some((s) => key(sup).includes(key(s)));
const jobs: Job[] = [];
for (const ch of chans) {
  if (ONLY && !ch.includes(ONLY)) continue;
  const mine = rows.filter((r) => S(r.channel) === ch).map(lineOf).filter((l) => l.total !== 0);
  const mineBacks: Back[] = claws.filter((c) => S(c.channel) === ch)
    .map((c) => ({ plate: S(c.plate), sup: S(c.supplier), amt: N(c.agentAmt), why: S(c.reason) }))
    .filter((b) => b.amt !== 0);
  if (!mine.length && !mineBacks.length) continue;
  /**
   * ★★**탭은 «하나»다 — 가르지 않는다.** 사장님 2026-09-03
   *   「공급사를 나누지 말고 그냥 필터 잡게만 해줘」 · 「탭 하나로 합쳐서 구분만 해주면됨」
   *   「나중에 어디든 오토플러스는 맨 아래쪽에 접수일자 순으로 써주면 되고」
   *
   *   ⇒ 갈라야 했던 까닭(지급일이 다르다)은 «줄마다 지급 예정일을 찍어» 푼다.
   *     탭을 가르면 합계를 두 번 보게 되고, 공급사로 훑을 때마다 탭을 옮겨야 한다.
   *   ⇒ 차례 = «지급일이 늦은 공급사(오토플러스)를 맨 아래», 그 안에서 접수일 순.
   */
  const ord = (l: Line) => `${isLate(l.sup) ? '1' : '0'}|${l.recv || '9999-99-99'}|${l.plate}`;
  mine.sort((a, b) => ord(a).localeCompare(ord(b)));
  const cl = mineBacks.reduce((a, b) => a + b.amt, 0);
  jobs.push({ ch, tab: tabOf(MONTH), lines: mine, backs: mineBacks,
    net: mine.reduce((a, b) => a + b.net, 0) - cl,
    vat: mine.reduce((a, b) => a + b.vat, 0) - Math.round(cl * VAT) });
}
for (const j of jobs) console.log(`   ${j.ch.padEnd(12)} ${String(j.lines.length).padStart(2)}줄 · 지급 ${won(j.net + j.vat).padStart(12)}${j.backs.length ? `  (환수 -${won(j.backs.reduce((a, b) => a + b.amt, 0))})` : ''}  →  「${j.tab}」`);
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 만들고 안 썼습니다. --apply 로 붙입니다.\n'); process.exit(0); }

const NAVY = { red: 0.06, green: 0.11, blue: 0.21 };
const TINT = { red: 0.93, green: 0.95, blue: 0.98 };
const BASIS_HEAD = { red: 0.90, green: 0.87, blue: 0.96 };
const BASIS_BODY = { red: 0.975, green: 0.97, blue: 0.99 };
/** 얼룩 줄 · 구역 칸막이 · 환수 줄 — 읽는 결을 만드는 세 가지. */
const ZEBRA = { red: 0.972, green: 0.976, blue: 0.984 };
const LINE = { red: 0.78, green: 0.80, blue: 0.85 };
const BACK_ROW = { red: 0.99, green: 0.92, blue: 0.92 };
/**
 * ★**「적용한 표 규칙」은 뺀다** — 사장님 2026-09-03 「적용한 규칙이랑은 뺀도 된다고」.
 *   상대가 알 것은 «어떻게 나왔나»이지 우리 표의 줄 이름이 아니다. 산출근거 한 칸이면 족하다.
 */
const BASIS = ['수수료 산정 기준'];
/**
 * ★**「지급 예정일」을 줄마다 찍는다** — 사장님 2026-09-03 「지급일자 써주고」.
 *   탭을 가르지 않는 대신 이 칸이 날을 말한다. 오토플러스 익월 25일 · 그 밖 익월 15일.
 */
/**
 * ★★**「확인」·「메모」는 «상대가 적는 칸»이다** — 사장님 2026-09-03
 *   「에이전시가 체크한 내용 메모남길수 있게 해줘 공급사도 마찬가지고」.
 *   ⚠⚠ 매달 다시 찍을 때 «적어 둔 것을 덮으면 안 된다» — 차량번호로 찾아 그대로 되돌려 놓는다.
 */
const NOTE = SETTLE_NOTE;
const HEAD = CHANNEL_SETTLE_HEAD;
const WIDTH = CHANNEL_SETTLE_WIDTH;
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

/**
 * ★★**「공지사항」 탭 — 프로모션을 알리는 자리.** 사장님 2026-09-03
 *   「공지사항같은거 주면 좋을거 같아 프로모션하는거 알려주고하면 될거 같음」.
 *   공급사 재고 시트의 「공지사항」과 «같은 규격»이다(`publish-supplier-tabs`).
 *
 * ★**맨 왼쪽에 둔다** — 채널이 시트를 열면 이것이 먼저 보여야 알림이 알림 노릇을 한다.
 * ⚠⚠ **있으면 손대지 않는다.** 사람이 적는 칸이다 — 매달 돌 때마다 덮으면 적어 둔 공지가 날아간다.
 */
async function notice(bookId: string) {
  const m = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}?fields=sheets.properties(sheetId,title)`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
    sheets?: { properties: { sheetId: number; title: string } }[] };
  if ((m.sheets || []).some((s) => s.properties.title === '공지사항')) return;
  const add = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: '공지사항', index: 0, gridProperties: { rowCount: 200, columnCount: 3 } } } }] }),
  })).json() as { replies?: { addSheet?: { properties?: { sheetId?: number } } }[] };
  const id = add.replies?.[0]?.addSheet?.properties?.sheetId;
  if (id === undefined) return;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}/values/${encodeURIComponent("'공지사항'!A1:C2")}?valueInputOption=RAW`, {
    method: 'PUT', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[`프리패스 공지사항 · 프로모션 — ${CORP.name} 가 적는 칸입니다`, '', ''], ['날짜', '구분', '내용']] }),
  });
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [
      { mergeCells: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' } },
      { repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.06, green: 0.11, blue: 0.21 }, textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10, right: 10, top: 2, bottom: 2 } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
      { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
      { repeatCell: { range: { sheetId: id, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 3 },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.93, green: 0.95, blue: 0.98 }, textFormat: { bold: true, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)' } },
      ...[110, 90, 760].map((w, c) => ({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
      { repeatCell: { range: { sheetId: id, startRowIndex: 2, startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)' } },
      { repeatCell: { range: { sheetId: id }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Roboto' } } }, fields: 'userEnteredFormat.textFormat.fontFamily' } },
    ] }),
  });
  console.log('   + 「공지사항」 탭을 만들었습니다 (프로모션 알림용)');
}

/** 채널 시트 — 있으면 쓰고 없으면 «만든다». 만든 것은 회사 안까지만 연다. */
const bookOf = new Map<string, string>();
async function book(ch: string): Promise<string> {
  if (bookOf.has(ch)) return bookOf.get(ch)!;
  const name = sheetName(ch);
  /** ★찾을 때는 «코드를 뺀 몸통»으로 — 코드가 바뀌어도 두 벌이 생기지 않는다. */
  const found = (await drive(`name contains '${ch} 프리패스 정산' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`))
    .filter((f) => !/구버전|폐기|백업/.test(S(f.name)));
  let id = found[0]?.id || '';
  if (!id) {
    const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title: name, locale: 'ko_KR', timeZone: 'Asia/Seoul' } }) });
    id = S((await r.json() as { spreadsheetId?: string }).spreadsheetId);
    /**
     * ★공유는 «우리 쪽»까지. 채널에 주는 것은 사람이 확인하고 누른다.
     * ⚠ 회사 도메인만 열면 «대표님이 못 연다» — 재고 시트들은 링크 공개라 열렸을 뿐이고,
     *   이 시트는 아니다(실측 2026-09-03 「파일 안열리는데??」). 대표 계정도 같이 연다.
     */
    for (const perm of [{ type: 'domain', domain: 'teamjpk.com', role: 'writer' },
      { type: 'user', emailAddress: 'jpkpyh@gmail.com', role: 'writer' }]) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, {
        method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(perm) });
    }
    console.log(`   + 시트를 만들었습니다 — ${name}`);
  }
  await notice(id);
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
  /**
   * ★**옛 이름(「26년08월 지급」)은 «이름만 바꿔» 이어 쓴다** — 지우면 상대가 적어 둔 메모가 날아간다.
   *   사장님 2026-09-03 「정산서가 맞을거 같은데 지급명세서?? 이거 잘 생각해보고」.
   */
  if (id === undefined) {
    const old = all.find((s) => s.properties.title === tab.replace('정산', '지급'))?.properties.sheetId;
    if (old !== undefined) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, {
        method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: old, title: tab }, fields: 'title' } }] }) });
      id = old;
      console.log(`   ~ 탭 이름을 「${tab}」으로 고쳤습니다`);
    }
  }
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
  /**
   * ★**갈라 놨던 탭은 걷는다** — 이제 한 탭이다. 「26년08월 지급 · 오토플러스」가 남아 있으면
   *   같은 달이 두 벌이 되어 어느 쪽이 맞는지 아무도 모른다. 우리가 오늘 만든 탭만 지운다.
   */
  for (const s of all) {
    if (!s.properties.title.startsWith(`${tab} · `)) continue;
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, {
      method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: s.properties.sheetId } }] }) });
    console.log(`   - 갈라 놨던 탭을 걷었습니다 — ${s.properties.title}`);
  }

  /**
   * ★**적어 둔 「확인·메모」를 먼저 거둔다.** 머리글 이름으로 칸을 찾으므로 열이 늘거나 자리가 바뀌어도
   *   따라온다. 열쇠는 차량번호 — 줄 차례는 달마다 바뀐다(오플이 아래로 내려간다).
   */
  const kept = new Map<string, [boolean, string]>();
  /**
   * ★**「누락분」에 적어 둔 줄도 거둔다** — 사장님 2026-09-03
   *   「정산시트에 누락된거 있으면 몇개 넣을수 있게끔 몇줄 만들어 놓자」 ·
   *   「정산서 밑에 여백이 5개 넣어두면 추가하라고 빠진거 있으면 추가해달라고」.
   *   ⚠⚠ 다시 찍을 때 «적어 둔 줄을 덮으면» 그게 사고다 — 빠진 건을 적어 놨는데 지워지는 셈이다.
   */
  const missed: string[][] = [];
  {
    const got = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}/values/${encodeURIComponent(`'${tab}'!A1:AZ400`)}`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as { values?: unknown[][] };
    const g = got.values || [];
    const mi = g.findIndex((r) => S((r || [])[1]) === '합계');
    if (mi >= 0) {
      for (const r of g.slice(mi + 1)) {
        const cells = (r || []).map(S);
        if (cells.some((c) => c.startsWith('지급 예정일은') || c.startsWith('세금계산서') || c.includes(CORP.email))) break;
        if (cells.some((c) => c && !c.startsWith('빠진 건이'))) missed.push(cells);
      }
    }
    const hi = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호'));
    if (hi >= 0) {
      const h = (g[hi] || []).map(S);
      const [cp, cc, cm] = ['차량번호', '확인', '메모'].map((n) => h.indexOf(n));
      if (cp >= 0 && (cc >= 0 || cm >= 0)) {
        for (const r of g.slice(hi + 1)) {
          const p = S((r || [])[cp]);
          const chk = cc >= 0 && /^(TRUE|true|1|Y|O|v|✓)$/.test(S((r || [])[cc]));
          const memo = cm >= 0 ? S((r || [])[cm]) : '';
          if (p && (chk || memo)) kept.set(p, [chk, memo]);
        }
      }
    }
  }
  const note = (p: string): [boolean, string] => kept.get(p) || [false, ''];

  const pad = (n: number) => Array.from({ length: n }, () => '');
  /** 돈 세 칸이 서는 자리 — 뒤에 「지급 예정일」이 붙었으므로 «끝에서부터» 세지 않는다. */
  const tail = (a: string | number, b: string | number, c: string | number) =>
    [...pad(iM), a, b, c, ...pad(HEAD.length - iM - 3)];
  const payKo = (sup: string) => dayKo(payDate(MONTH, sup));
  const body: (string | number | boolean)[][] = j.lines.map((l, i) => [i + 1, l.plate, l.recv, l.deliv, l.sup, l.model, l.cust,
    l.product, l.term || '', l.rent || '', l.how, l.net, l.vat, l.total, payKo(l.sup), ...note(l.plate)]);
  /** ★환수는 «같은 표»에 음수로 선다 — 표를 둘로 쪼개면 합계를 두 번 보게 된다. */
  for (const b of j.backs) {
    body.push(['', b.plate, '', '', b.sup, '지난 지급분 환수', '', '', '', '', b.why,
      -b.amt, -Math.round(b.amt * VAT), -(b.amt + Math.round(b.amt * VAT)), payKo(b.sup), ...note(b.plate)]);
  }
  const values: (string | number | boolean)[][] = [
    /**
     * ★**제목은 «맨 앞»에서 시작한다** — 사장님 2026-09-03 「여기 제목을 앞으로 보내고 틀고정 필요없음」.
     *   ⚠ C1 부터 밀어 놓았던 것은 «틀고정 때문»이었다(병합이 얼린 칸을 가로지르면 시트가 거부한다).
     *     틀고정을 걷었으니 그 이유가 사라졌다 — A1 부터 한 줄로 병합한다.
     */
    [`${monthKo(MONTH)} 정산서    ·    ${j.ch} 귀중 · ${CORP.name} 발행`, ...pad(HEAD.length - 1)],
    tail('공급가액', '부가세', '지급 금액'),
    tail(j.net, j.vat, j.net + j.vat),
    HEAD,
    ...body,
    ['', '합계', `${j.lines.length}건`, ...pad(iM - 3), j.net, j.vat, j.net + j.vat, ...pad(HEAD.length - iM - 3)],
    /**
     * ★★**합계 아래에 «빈 다섯 줄»을 둔다** — 사장님 2026-09-03
     *   「정산서 밑에 여백이 5개 넣어두면 추가하라고 빠진거 있으면 추가해달라고」 ·
     *   「살짝 흐리게 써놔주면 되지」 · 「메모에 써도 되겄네」.
     *   빠진 건이 있을 때 «어디에 적나»를 묻지 않게, 자리를 먼저 내어 둔다.
     * ⚠⚠ 다시 찍을 때 «적어 둔 줄은 그대로 되돌려 놓는다»(missed) — 안 그러면 적어 놓은 게 지워진다.
     */
    ...missed.map((r) => [...r, ...pad(Math.max(0, HEAD.length - r.length))].slice(0, HEAD.length)),
    ...Array.from({ length: Math.max(0, 5 - missed.length) }, (_, k) => (k === 0 && !missed.length
      ? [...pad(HEAD.length - 1), '빠진 건이 있으면 이 줄부터 적어 주세요']
      : pad(HEAD.length))),
    [],
    /** ★날은 «줄마다» 적혀 있다 — 여기서는 규칙만 한 줄로 말한다. */
    [`지급 예정일은 줄마다 적었습니다 — ${SPLIT_SUPPLIERS.map((s) => `${s} 매월 ${payDayOf(s)}일`).join(' · ')} · 그 밖 매월 ${payDayOf('')}일`, ...pad(HEAD.length - 1)],
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
    { mergeCells: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEAD.length }, mergeType: 'MERGE_ALL' } },
    { repeatCell: { range: all1(0, 1),
      cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10, right: 10, top: 2, bottom: 2 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
    bar(1, true), bar(r0, false), tint(2), tint(last),
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r0, endIndex: r0 + 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r0 + 1, endIndex: last + 1 }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
    /** ★환수 줄은 연한 붉은빛 — «빼는 돈»이라 숫자만 음수면 눈에 안 들어온다. */
    ...j.backs.map((_, i) => ({ repeatCell: { range: all1(r0 + 1 + j.lines.length + i, r0 + 2 + j.lines.length + i),
      cell: { userEnteredFormat: { backgroundColor: BACK_ROW } }, fields: 'userEnteredFormat.backgroundColor' } })),
    /**
     * ★**「수수료 산정 기준」 머리도 «남색 그대로»** — 사장님 2026-09-03 「칸헤더 왜 색깔이 다르지??」
     *   한 칸만 보라로 칠해 두니 «다른 표»처럼 보였다. 같은 표의 한 칸이면 머리도 같아야 한다.
     *   ⇒ 구역을 가르는 것은 색이 아니라 «세로 칸막이»(updateBorders)로 충분하다.
     */
    { repeatCell: { range: { sheetId: id, startRowIndex: r0 + 1, endRowIndex: last, startColumnIndex: iB, endColumnIndex: iB + BASIS.length },
      cell: { userEnteredFormat: { textFormat: { fontSize: 9 } } }, fields: 'userEnteredFormat.textFormat' } },
    /**
     * ★**빈 다섯 줄 안내는 «흐린 기울임»** — 사장님 2026-09-03 「살짝 흐리게 써놓아주면 되지」.
     *   진하게 적으면 «정산 줄»로 오해한다. 적으시라는 자리표지지 내용이 아니다.
     */
    { repeatCell: { range: { sheetId: id, startRowIndex: last + 1, endRowIndex: last + 6, startColumnIndex: 0, endColumnIndex: HEAD.length },
      cell: { userEnteredFormat: { textFormat: { italic: true, fontSize: 10, foregroundColor: { red: 0.62, green: 0.65, blue: 0.70 } } } }, fields: 'userEnteredFormat.textFormat' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: last + 1, endIndex: last + 6 }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
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
    /**
     * ★★**구역 칸막이** — «차·임차인 │ 산정 기준 │ 금액 │ 확인» 사이에 생겨 줄 하나.
     *   색만으로 가르면 인쇄하거나 흑백으로 볼 때 구역이 사라진다. 선은 남는다.
     */
    ...[iB, iM, HEAD.indexOf('확인')].filter((c) => c > 0).map((c) => ({ updateBorders: {
      range: { sheetId: id, startRowIndex: r0, endRowIndex: last + 1, startColumnIndex: c, endColumnIndex: c + 1 },
      left: { style: 'SOLID', width: 1, color: LINE } } })),
    /** ★틀고정은 «안 건다» — 사장님 2026-09-03 「틀고정 필요없음」. 한 화면에 드는 표다. */
    /**
     * ★**틀고정 — 머리 네 줄**(사장님 2026-09-03 「채널시트에 틀고정 할거 재대로 해주고」).
     *   줄이 서른이 넘으면 내려가다 «어느 칸인지»를 잃는다. 제목·합계·머리글까지 얼린다.
     * ⚠ 열은 안 얼린다 — 제목 띄가 A:끝으로 병합돼 있어 열을 얼리면 시트가 거부한다.
     */
    { updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: 4, frozenColumnCount: 0 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
    /**
     * ★★**필터를 걸어 둔다** — 사장님 2026-09-03 「공급사를 나누지 말고 그냥 필터 잡게만 해줘」.
     *   탭을 가르는 대신 공급사·상품 구분으로 «그 자리에서» 추린다.
     *   ⚠ 범위는 머리줄~마지막 줄까지 — 합계줄이 들어가면 걸러도 합계가 따라 사라진다.
     */
    { setBasicFilter: { filter: { range: { sheetId: id, startRowIndex: r0, endRowIndex: last, startColumnIndex: 0, endColumnIndex: HEAD.length } } } },
    /** ★「확인」은 체크칸으로 — 상대가 누르기만 하면 된다. */
    { setDataValidation: { range: { sheetId: id, startRowIndex: r0 + 1, endRowIndex: last, startColumnIndex: HEAD.indexOf('확인'), endColumnIndex: HEAD.indexOf('확인') + 1 }, rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true } } },
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
