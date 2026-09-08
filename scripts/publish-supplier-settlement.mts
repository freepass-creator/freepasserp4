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
 *   ⇒ 산출근거는 원장 청구탭과 «같은 이름·같은 식»이다. 이름이 갈리면
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
import { settleTargetOf, billingMonthIn, lockedMonthsOf, type SettlementRow } from '../lib/domain/settlement-stage';
/** ★공급사 발행기는 «청구»만 센다 — payOf 는 부러 안 들여온다(지급액 빗장). */
import { claimOf, incentiveOf, claimBaseOf } from '../lib/domain/settlement-money';
import { settlementMonthOf } from '../lib/domain/settlement-billing-month';
import { SETTLE_NOTE, settleHeadFor, settleWidthFor, settleMoneyFor, settleLeftFor, settleTabBase } from '../lib/server/channel-sheet-tabs';
import { editId } from '../lib/server/sheet-edits';

/** 공급사가 적는 넉 칸 — [확인, 정정, 정정금액, 메모(정정사유)]. */
type Keep = [boolean, boolean, number | '', string];
import { feeKindOf, feeRuleFor, SUPPLIER_ALIAS } from '../lib/domain/settlement-fee-table';
import { outwardText, maskName } from '../lib/domain/outward-text';

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
/**
 * ★★★**달을 세는 규칙은 «원장과 같은 것»을 쓴다** — 사장님 2026-09-04
 *   「정산원장에 잘 반영해서 그거 기반으로 각자 시트에 뿌려질수 있도록 해줘고」.
 *
 *   ⚠ 여태 시트는 `billMonth` «적힌 값»만 보고, 원장·정산서는 `billingMonthIn`
 *     (적힌 값이 이기되, 없으면 인도일에서 계산)을 봤다. 그래서 2026-09 원장엔
 *     줄이 다섯 공급사나 있는데 시트는 «0줄»이었다. 같은 달을 두 규칙으로 세면 어느 것도 못 믿는다.
 *   ⇒ 원장·정산서·시트가 «한 규칙»을 본다. 정본은 `settlement-stage`.
 */
/**
 * ★★★**달을 세는 규칙은 «종이와 같은 것»을 쓴다** — `billingMonthIn`.
 *   시트는 상대가 받은 청구서·정산서와 «줄 수까지» 같아야 한다. 어긋나면 그 자리에서 묻는다.
 * ⚠ 원장(`publish-settlement-month`)은 아직 제 규칙(`settlementMonthOf`)을 쓴다 —
 *   그것을 씨우면 2026-08 이 34줄 → 50줄로 불어 이미 나간 종이와 갈라졌다(실측 2026-09-04).
 *   둘을 합치는 것은 «이미 나간 청구서»를 흔드는 일이라 사람 확인이 먼저다.
 */
const D = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v)); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
const asRow = (r: Row) => ({ ...r, receivedAt: D(r.receivedAt), deliveredAt: D(r.deliveredAt) } as unknown as SettlementRow);
const allRows = Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[];
const locked = lockedMonthsOf(allRows.map(asRow));
/**
 * ★★★**아직 안 끝난 달은 «예정»으로 미리 채운다** — 사장님 2026-09-04
 *   「**영업자랑 공급사에** 9 10 11월꺼 정산할거 미리 반영해두자고 분납건들」.
 *   영업채널 시트와 «같은 규칙»이다 — 마감된 달은 billingMonthIn 그대로,
 *   앞으로 올 달에만 분납완료 규칙(접수월 + 회차−1)을 더한다.
 * ⚠ 마감된 달에 씌우면 이미 나간 청구서와 갈라진다.
 * ⚠ settlementMonthOf 에 asRow(r) 를 넘기지 마라 — 그건 날짜가 Date 로 바뀐 것이고
 *   저 함수는 「2026-08-18」 «글»을 본다. 넘기면 조용히 빈 값이 나와 예정 줄이 하나도 안 잡힌다.
 */
const ymAdd = (v: string, n: number) => { const y = Number(v.slice(0, 4)); const m = Number(v.slice(5)) + n;
  return `${y + Math.floor((m - 1) / 12)}-${String(((m - 1) % 12 + 12) % 12 + 1).padStart(2, '0')}`; };
const today = new Date();
const CLOSED = ymAdd(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`, -1);
const FORECAST = MONTH > CLOSED;
const soonMonth = (r: Row) => (S(r.billMonth) ? '' : settlementMonthOf(r));
const rows = allRows.filter((r) => r.cancelled !== true
  && (billingMonthIn(asRow(r), locked) === MONTH || (FORECAST && soonMonth(r) === MONTH)));
/** 이 줄이 «예정»인가 — 마감 규칙으로는 아직 이 달에 안 잡히는 줄. */
const isSoon = (r: Row) => FORECAST && billingMonthIn(asRow(r), locked) !== MONTH;
const claws = (Object.values((await db.ref('v4/settlement_clawbacks').get()).val() || {}) as Row[])
  .filter((c) => S(c.month) === MONTH);

type Line = { plate: string; recv: string; deliv: string; model: string; cust: string; product: string;
  term: number; rent: number; deposit: number; price: number; payKind: string; how: string; net: number; vat: number; total: number };
/**
 * ★청구탭·정산서와 «같은 규칙»으로 센다 — 정산 대상·비율·보류·부가세포함.
 * ★★**산출조건은 원장 청구탭 `lineOf` 와 «같은 식»이다**(`산출근거`).
 *   갈리면 공급사가 보는 근거와 우리가 보는 근거가 달라진다.
 */
const lineOf = (r: Row): Line => {
  const ratio = N(r.settleRatio) || 1;
  /** ★돈은 «한 함수»가 센다 — 인센티브(무보증 수수료 등)까지 포함한다. */
  const raw = claimOf(r);
  const gross = r.vatIncluded === true;
  const net = gross ? Math.round(raw / (1 + VAT)) : raw;
  const vat = gross ? raw - net : Math.round(net * VAT);

  const product = S(r.product); const term = N(r.term); const model = S(r.model);
  const { kind, form, fallback } = feeKindOf(product, model);
  const f = feeRuleFor(S(r.supplier), kind, term, form, fallback);
  let how = '';
  if (f && f.auto) {
    const rate = Number(f.claim);
    const rs = rate < 1 ? `${(rate * 100).toFixed(2)}%` : won(rate);
    how = f.basis === '정액' ? `건당 ${won(rate)}`
      : f.basis === '차량가액' ? `차량가액 ${won(N(r.price))} × ${rs}`
        : `렌탈료 ${won(N(r.rent))} × ${term}개월 × ${rs}`;
    if (ratio !== 1) how += ` × 비율 ${ratio}`;
  /**
   * ★**상대에게 나가는 종이에는 «수수료 정책»이라고 적는다** — 사장님 2026-09-08
   *   「표 규칙 이런 거 창피하다 · **수수료 정책**이라고 하든지」.
   *   「표 규칙」은 우리끼리 부르는 말이다. 남의 회사가 받는 청구서에 우리 내부 말이 서면 안 된다.
   */
  } else if (f) how = `수수료 정책 「${f.claim}」 — 개별 협의`;
  else how = '개별 협의';
  /**
   * ★★★**문구가 «적힌 금액»과 안 맞으면 그 문구를 쓰지 않는다.**
   *
   * ⚠ **무슨 일이 있었나.** 2026-09-08 카핑이 133호1997 을 「선출고」로 바로잡아 상품구분을 고쳤더니,
   *   공급사(우리캐피탈) 청구서의 산정기준만 «차량가액 × 3.50%»로 바뀌고 **금액은 사다리 값
   *   1,228,500 그대로**였다. 종이 위에서 식과 금액이 서로 다른 말을 하게 된 것이다.
   *   상대가 그 식으로 검산하면 우리 청구서가 틀린 것이 된다.
   *
   * ⇒ 표 규칙으로 «세어 본 값»과 적힌 금액(인센티브 뺀 사다리분)이 다르면 식을 지우고
   *   「개별 협의분」이라고만 적는다. 모르는 것을 아는 척하지 않는 것이 정확한 것이다.
   */
  const expect = f && f.auto ? Math.round((f.basis === '정액' ? Number(f.claim)
    : f.basis === '차량가액' ? N(r.price) * Number(f.claim)
      : N(r.rent) * term * Number(f.claim)) * ratio) : 0;
  const got = claimBaseOf(r);
  if (expect && Math.abs(expect - got) > 1) {
    /**
     * ★★**절반이면 「절반」이라고 말한다** — 2회분납의 1회차는 표 값의 0.5 다.
     *   실측 2026-09-08 — 카핑 133호1997(723,750 = 1,447,500 × 0.5) · 하허호 161하1266(462,000 = 924,000 × 0.5).
     *   여기서 뭉뚱그려 「개별 협의분」이라 하면, 상대는 «왜 절반인지»를 물으러 전화해야 한다.
     */
    how = Math.abs(expect * 0.5 - got) <= 1 ? `${how} × 비율 0.5 (분납 1회차)` : '개별 협의';
  }
  /**
   * ★★**예정 줄은 «예정»이라고 적는다.** 금액이 0 이면 아직 인도 전이라 수수료가 안 정해진 것이다 —
   *   빈칸으로 두면 「0원 청구한다」로 읽힌다. 왜 0 인지를 그 자리에 적어야 묻지 않는다.
   */
  if (isSoon(r)) how = raw ? `예정 · ${how}` : `예정 · 인도 뒤 정해집니다 (${S(r.payKind) || '분납'} · 접수 ${S(r.receivedAt) || '-'})`;
  return {
    plate: S(r.plate) || '(차번없음)', recv: S(r.receivedAt), deliv: S(r.deliveredAt),
    model, cust: S(r.customer), product, term, rent: N(r.rent), deposit: N(r.deposit), price: N(r.price), payKind: S(r.payKind), how,
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

/**
 * ★**환수만 있는 달도 세다** — 사장님 2026-09-04 「리더스에 저거 환수 정산시트에 반영해줘」.
 *   공급사 목록을 «정산 줄»에서만 돌렸더니, 그 달에 정산 줄은 없고 환수만 있는 곳이 통째로 빠졌다.
 *   ⇒ 환수에만 이름이 있는 공급사도 목록에 넣는다. 환수도 «그 달에 오가는 돈»이다.
 */
const sups = [...new Set([...rows.map((r) => S(r.supplier)), ...claws.map((c) => S(c.supplier))].filter(Boolean))];
console.log(`\n■ ${MONTH} — 공급사 ${sups.length}곳 · 재고 시트 ${sheets.length}개 ${APPLY ? '(반영)' : '(대조만)'}\n`);

const findSheet = (name: string) => live.filter((f) => {
  const a = key(aliasOf(f.name)); const b = key(name);
  return a && b && (a === b || a.startsWith(b) || b.startsWith(a));
});

/** `backs` — 환수를 «줄로» 든다. 합산만 들고 있으면 어느 차인지를 못 적는다. */
type Back = { plate: string; model: string; amt: number; why: string };
type Job = { sup: string; sheetId: string; sheetName: string; tab: string; via: string; lines: Line[]; backs: Back[]; net: number; vat: number; claw: number };
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
  /** ★예정 달에는 금액 0 인 줄도 싣는다 — 「이 건이 옵니다」가 알려 줄 값이다. */
  const mine = rows.filter((r) => S(r.supplier) === sup).map(lineOf).filter((l) => FORECAST || l.total !== 0);
  /** ★차례는 «접수일 순» — 영업채널 시트와 같은 규칙이다(사장님 2026-09-03 「접수일자 순으로」). */
  mine.sort((a, b) => `${a.recv || '9999-99-99'}|${a.plate}`.localeCompare(`${b.recv || '9999-99-99'}|${b.plate}`));
  const backs: Back[] = claws.filter((c) => S(c.supplier) === sup)
    /**
     * ★★★**사유에서 «우리끼리 하는 말»을 걷는다** — 사장님 2026-09-04
     *   「공급사에 보여지는건 내부 문서가 아닌데」.
     *   ⚠ 사람 이름·내부 처리 말뿐 아니라 **남의 상호**가 새는 것이 사고다 —
     *     리더스가 「하허호」를 볼 이유가 없다. 지급 요율을 가린 것과 같은 까닭이다.
     */
    .map((c) => ({ plate: S(c.plate), model: S(c.model), amt: N(c.supplierAmt),
      why: outwardText(c.reason, [S(c.channel), ...[...new Set(rows.map((r) => S(r.channel)))]]) }))
    .filter((b) => b.amt !== 0);
  const cl = backs.reduce((a, b) => a + b.amt, 0);
  if (!mine.length && !cl) continue;
  if (hit.length !== 1) { skip.push(`${sup} — 재고 시트를 ${hit.length === 0 ? '못 찾음' : `${hit.length}개나 찾음`}`); continue; }
  const net = mine.reduce((a, b) => a + b.net, 0) - cl;
  const vat = mine.reduce((a, b) => a + b.vat, 0) - Math.round(cl * VAT);
  jobs.push({ sup, sheetId: hit[0].id, sheetName: hit[0].name, tab: tabOf(MONTH), via, lines: mine, backs, net, vat, claw: cl });
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
/** 구역 칸막이 · 환수 줄 — 읽는 결을 만드는 둘. ★얼룩(지브라)은 쓰지 않는다(사장님 2026-09-08). */
const LINE = { red: 0.78, green: 0.80, blue: 0.85 };
/**
 * ★★**상대가 「정정」을 켠 줄 — «손보는 중»이라 눈에 띄어야 한다**(사장님 2026-09-08
 *   「청구 만지고 있는 거를 색깔 해 주고」). 체크 하나는 스무 칸 너머에 있어,
 *   색이 없으면 어느 줄이 걸렸는지 스무 줄을 훑어야 안다.
 */
const FIX_ROW = { red: 1, green: 0.96, blue: 0.80 };
/** ★환수 줄 — «연한 분홍 바탕»만(사장님 2026-09-04 「두껍게 이런건 하지마」). */
const BACK_ROW = { red: 1, green: 0.945, blue: 0.955 };
/** 임차인정보 ── 산출조건 ── 금액. 이름은 원장 청구탭과 같게 둔다. */
/**
 * ★**「적용한 표 규칙」은 뺀다** — 사장님 2026-09-03 「적용한 규칙이랑은 뺀도 된다고」.
 *   상대가 알 것은 «어떻게 나왔나»이지 우리 표의 줄 이름이 아니다. 산출근거 한 칸이면 족하다.
 */
const BASIS = ['수수료 산정 기준'];
/**
 * ★★**「확인」·「메모」는 «공급사가 적는 칸»이다** — 사장님 2026-09-03
 *   「에이전시가 체크한 내용 메모남길수 있게 해줘 공급사도 마찬가지고」.
 *   ⚠⚠ 매달 다시 찍을 때 «적어 둔 것을 덮으면 안 된다» — 차량번호로 찾아 그대로 되돌려 놓는다.
 */
const NOTE = SETTLE_NOTE;
/**
 * ★★**렌탈료 뒤에 보증금이 선다** — 사장님 2026-09-07
 *   「렌탈료 뒤에 보증금 있어야 하고 근데 우리 8월 정산서에 보증금 자체가 없네」
 *   — 「우리 접수 양식에는 다 있었네」. 원장에는 있는데 나가는 종이에만 없었다.
 *   ★보증금은 «계약 조건»이지 정산 금액이 아니다 — 공급사도 영업자도 본다(사장님 2026-08-26).
 *   ⚠ 영업채널 시트는 이미 «렌탈료 · 보증금 · 납입 방식» 순서다. 거울이니 같은 자리에 선다.
 */
/**
 * ★★★**칸은 «한 곳»이 짓는다** — `channel-sheet-tabs`의 `SETTLE_COLUMNS`.
 *   사장님 2026-09-08 「최대한 양식을 같이 써야 함」.
 *   여기서 다시 적지 않는다 — 따로 적으면 칸을 하나 더할 때 한쪽만 고쳐 갈라진다.
 *   공급사가 보면 안 되는 칸(공급사·영업채널·영업담당자·지급 예정일)은 그 표가 걸러 낸다.
 */
const HEAD = settleHeadFor('공급사');
const WIDTH = settleWidthFor('공급사');
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
const LEFT = settleLeftFor('공급사');
const MONEY = settleMoneyFor('공급사');

for (const j of jobs) {
  const tab = j.tab;
  const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${j.sheetId}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
    sheets?: { properties: { sheetId: number; title: string } }[] };
  const all = meta.sheets || [];
  /**
   * ★건수는 달마다 바뀜다 — 앞글로 찾는다.
   * ⚠⚠ 칸을 읽고 쓸 때는 «지금 붙어 있는 이름»(`tabRef`)을 쓴다 — 채널 발행기와 같은 사고.
   */
  /**
   * ★★**앞글이 같은 탭이 둘일 수 있다** — 예전 한 번 쓰기가 실패했을 때
   *   「26년08월 정산」과 「26년08월 정산 (2건)」이 같이 남았다(실측 경진카·에스에이).
   *   ⇒ 건수가 붙은 쪽을 고른다 — 그것이 우리가 마지막으로 찍은 탭이다.
   */
  const cands = all.filter((s) => settleTabBase(s.properties.title) === tab);
  const hit0 = cands.find((s) => s.properties.title !== tab) || cands[0];
  let id = hit0?.properties.sheetId;
  let tabRef = hit0?.properties.title || tab;
  const rowsNeed = j.lines.length + 20;
  /**
   * ★**이름을 «가른» 첫 달에는 이름 없는 옛 탭이 남는다** — 그것을 «고쳐 쓴다».
   *   지우지 않는다(남의 시트다). 이름만 바꿔 이어 쓰면 유령 탭이 안 생긴다.
   */
  if (id === undefined && tab !== tabOf(MONTH)) {
    const plain = all.find((s) => settleTabBase(s.properties.title) === tabOf(MONTH))?.properties.sheetId;
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

  /**
   * ★**적어 둔 「확인·메모」를 먼저 거둔다.** 머리글 이름으로 칸을 찾으므로 열이 늘거나 자리가 바뀌어도
   *   따라온다. 열쇠는 차량번호 — 줄 차례는 접수일 순이라 달마다 바뀐다.
   */
  /** 공급사가 적는 넉 칸 — [확인, 정정, 정정금액, 메모(정정사유)]. */
  const kept = new Map<string, Keep>();
  /**
   * ★★**합계 아래 「빠진 건」 줄** — 공급사가 거기 적어 준 것. 채널 시트와 «같은 양식»이다
   *   (사장님 2026-09-08 「10줄씩 넣자 예비줄」 · 「최대한 양식을 같이 써야 함」).
   *   ⚠⚠ 자리를 내어 주었으면 **적힌 것을 읽어 와야** 한다. 안 읽고 다시 찍으면 적어 둔 것이 지워진다 —
   *     자리만 내어 주고 지우는 것이 자리를 안 내는 것보다 나쁘다.
   */
  const missed: Record<string, string>[] = [];
  {
    const got = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${j.sheetId}/values/${encodeURIComponent(`'${tabRef}'!A1:AZ400`)}`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as { values?: unknown[][] };
    const g = got.values || [];
    const hi = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호'));
    /**
     * ★**적어 둔 줄은 «칸 이름»으로 거둔다** — 자리로 거두면 칸 차례가 바뀔 때 통째로 밀린다
     *   (실측 2026-09-07 채널 시트에서 차번이 공급사 칸으로 밀렸다).
     */
    {
      const hNames = hi >= 0 ? (g[hi] || []).map(S) : [];
      const mi = g.findIndex((r, i) => i > hi && (r || []).some((c) => S(c).replace(/\s/g, '') === '합계'));
      if (hi >= 0 && mi >= 0) for (const r of g.slice(mi + 1)) {
        const cells = (r || []).map(S);
        if (cells.some((c) => c.startsWith('맞으면 「확인」') || c.startsWith(`${Number(MONTH.slice(5))}월은 아직`)
          || c.includes('입금 부탁드립니다') || c.includes(CORP.email) || c.startsWith('한 달간'))) break;
        if (!cells.some((c) => c && !c.startsWith('빠진 건이'))) continue;
        const m: Record<string, string> = {};
        cells.forEach((v, c) => { const n = hNames[c]; if (n && v) m[n] = v; });
        missed.push(Object.keys(m).length ? m : Object.fromEntries(cells.map((v, c) => [hNames[c] || `열${c + 1}`, v])));
      }
    }
    if (hi >= 0) {
      const h = (g[hi] || []).map(S);
      const [cp, cc, cx, cf, cm] = ['차량번호', '확인', '정정', '정정금액', '메모(정정사유)'].map((n) => h.indexOf(n));
      const on = (v: unknown) => /^(TRUE|true|1|Y|O|v|✓)$/.test(S(v));
      if (cp >= 0 && [cc, cx, cf, cm].some((i) => i >= 0)) {
        /** ★★표는 「합계」에서 끝난다 — 그 아래 「누락」 블록은 여기서 거두지 않는다(채널 발행기와 같은 사고). */
        const end = g.findIndex((r, i) => i > hi && S((r || [])[1]).replace(/\s/g, '') === '합계');
        for (const r of g.slice(hi + 1, end >= 0 ? end : undefined)) {
          const p = S((r || [])[cp]);
          const chk = cc >= 0 && on((r || [])[cc]);
          const fixOn = cx >= 0 && on((r || [])[cx]);
          /**
           * ★「정정금액」은 공급사가 적는 «숫자»다 — 빈칸은 빈칸으로 둔다(0 을 찍으면 0원이 된다).
           * ⚠ 숫자가 아닌 «글자»도 빈칸이다 — `N('누락')` 은 0 이라 그대로 받으면 0원이 된다.
           */
          const raw = cf >= 0 ? S((r || [])[cf]) : '';
          const fix = raw && /\d/.test(raw) ? N(raw) : '';
          const memo = cm >= 0 ? S((r || [])[cm]) : '';
          if (p && (chk || fixOn || memo || fix !== '')) kept.set(p, [chk, fixOn, fix, memo]);
        }
      }
    }
  }
  /**
   * ★합계 아래 예비줄 수 — 영업채널 시트와 같은 열 줄(사장님 2026-09-08 「10줄씩 넣자 예비줄」).
   * ⚠ **값을 짓기 «전»에 선언한다** — 옷 짜는 곳에 두었다가 TDZ 로 터졌다(2026-09-08).
   */
  const BLANKS = 10;
  const note = (p: string): Keep => kept.get(p) || [false, false, '', ''];

  const pad = (n: number) => Array.from({ length: n }, () => '');
  /**
   * ★★**줄은 «머리글 이름»으로 짓는다 — 자릿수를 세지 않는다.**
   *   칸을 하나 붙일 때마다 빈칸을 손으로 세는 방식은 칸이 늘 때마다 환수 줄에서 어긋난다.
   */
  const rowOf = (m: Record<string, string | number | boolean>): (string | number | boolean)[] =>
    HEAD.map((h) => (m[h] === undefined ? '' : m[h]));
  const body: (string | number | boolean)[][] = j.lines.map((l, i) => rowOf({
    'No.': i + 1, 차량번호: l.plate, 접수일: l.recv, 인도일: l.deliv, 청구월: monthKo(MONTH), 모델명: l.model, 임차인: maskName(l.cust),
    '상품 구분': l.product, '계약 기간': l.term || '', 렌탈료: l.rent || '', 보증금: l.deposit || '', '차량 가격(신차)': l.price || '', '납입 방식': l.payKind, [BASIS[0]]: l.how,
    공급가액: l.net, 부가세: l.vat, 합계: l.total,
    확인: note(l.plate)[0], 정정: note(l.plate)[1], 정정금액: note(l.plate)[2], '메모(정정사유)': note(l.plate)[3],
  }));
  /** ★환수 줄은 «차번을 적는다» — 어느 차인지 못 보면 상대가 바로 묻는다. */
  /**
   * ★★**환수는 «상품 구분»에 적는다** — 사장님 2026-09-08
   *   「환수 상품구분에 넣으면 되겠다 · 환수 지원금 이런 거」.
   *   여태 모델명 칸에 「지난 지급분 환수」라고 적었는데, 그러면 **어느 차인지**를 적을 자리를 잃는다.
   *   상품 구분은 원래 「이 줄이 무슨 줄이냐」를 말하는 칸이다 — 환수도 거기가 제자리다.
   *
   * ★차가 없는 환수(지원금을 되돌려 받는 것)는 «환수 지원금»이라고 적는다.
   */
  for (const b of j.backs) {
    body.push(rowOf({
      차량번호: b.plate, 모델명: b.model, '상품 구분': b.plate ? '환수' : '환수 지원금',
      [BASIS[0]]: b.why || '지난 정산분 환수',
      공급가액: -b.amt, 부가세: -Math.round(b.amt * VAT), 합계: -(b.amt + Math.round(b.amt * VAT)),
      확인: note(b.plate)[0], 정정: note(b.plate)[1], 정정금액: note(b.plate)[2], '메모(정정사유)': note(b.plate)[3],
    }));
  }
  /**
   * ★★★**크로스체크 — 공급사가 적은 「정정」·「정정금액」을 우리 청구액과 맞대 본다.**
   *   사장님 2026-09-04 「그래서 우리거랑 크로스체크해보고」. 영업채널 쪽과 «같은 짜임»이다.
   *   ⚠ 여기서 «자동으로 고치지 않는다». 돈은 이미 나간 청구서의 근거다 —
   *     올라온 것을 사람이 보고(`review-sheet-edits`) 정한다.
   */
  {
    const [iPl, iNet, iOn, iFix, iMemo] = ['차량번호', '공급가액', '정정', '정정금액', '메모(정정사유)'].map((n) => HEAD.indexOf(n));
    const known = (Object.values((await db.ref('v4/sheet_edits').get()).val() || {}) as Record<string, unknown>[])
      .filter((e) => S(e.channel) === j.sup && S(e.month) === MONTH && ['공급가액', '누락'].includes(S(e.column)));
    const patch: Record<string, Record<string, unknown>> = {};
    for (const r of body) {
      const plate = S(r[iPl]); if (!plate) continue;
      const on = r[iOn] === true; const fix = S(r[iFix]);
      if (!on && !fix) continue;
      const ours = S(r[iNet]);
      if (!on && fix && N(fix) === N(ours)) continue;
      /** ★열쇠는 `editId` 한 곳에서 만든다 — 손으로 짠 정규식이 틀려 있었다(2026-09-08). */
      const id = editId(j.sup, MONTH, plate, '공급가액');
      /**
       * ⚠⚠ **금액을 안 적었으면 `theirs` 는 «빈 값»이다.** 여기에 안내문을 넣으면
       *   그 글자가 `applyPending` 을 타고 **상대에게 나가는 종이의 돈 칸**에 그대로 찍힌다
       *   — 채널 쪽에서 실제로 났던 사고다(2026-09-07 하허호 161허1334).
       *   ⇒ 안내문은 «왜»에 적는다. 돈 칸에 들어갈 수 있는 것은 수뿐이다.
       */
      const theirs = fix;
      const was = known.find((e) => editId(S(e.channel), S(e.month), S(e.key), S(e.column)) === id);
      if (was && S(was.theirs) === theirs) continue;
      patch[id] = { channel: j.sup, kind: '공급사', month: MONTH, key: plate, column: '공급가액',
        ours, theirs, seenAt: new Date().toISOString(), status: '대기',
        why: [S(r[iMemo]) ? `그쪽 메모 — ${S(r[iMemo])}` : '', fix ? '' : '금액 안 적음 · 「정정」만 켜짐'].filter(Boolean).join(' · ') };
    }
    /**
     * ★★★**합계 아래 「빠진 건」 줄도 올린다 — 그게 «우리가 놓친 차»를 알려 주는 말이다.**
     *   공급사는 자기가 내보낸 차를 안다. 자리를 내어 주었으면 적힌 것을 읽어 와야 자리를 낸 값을 한다.
     */
    for (const cells of missed) {
      const plate = S(cells['차량번호']); if (!plate) continue;
      const who = [S(cells['임차인']), S(cells['모델명'])].filter(Boolean).join(' · ');
      const amt = N(cells['공급가액']) || N(cells['정정금액']);
      const said = [S(cells['메모(정정사유)']), amt ? `공급가액 ${won(amt)}` : '금액 안 적힘']
        .filter(Boolean).join(' · ') || Object.values(cells).filter(Boolean).join(' ');
      const id = editId(j.sup, MONTH, plate, '누락');
      if (known.some((e) => editId(S(e.channel), S(e.month), S(e.key), S(e.column)) === id && S(e.theirs) === said)) continue;
      patch[id] = { channel: j.sup, kind: '공급사', month: MONTH, key: plate, column: '누락',
        ours: '(이 달 표에 없음)', theirs: said, seenAt: new Date().toISOString(), status: '대기',
        why: who ? `그쪽이 적음 — ${who}` : '' };
    }
    if (Object.keys(patch).length) {
      await db.ref('v4/sheet_edits').update(patch);
      console.log(`   ↑ ${j.sup} — 정정 요청 ${Object.keys(patch).length}건을 받아 놓았습니다(크로스체크 대기)`);
    }
  }

  /** 본표에 이미 선 차번 — 누락 블록에서 걷어낼 기준이다. */
  const onTable = new Set(body.map((r) => S(r[HEAD.indexOf('차량번호')])).filter(Boolean));
  const onlyMissed = missed.filter((m) => !onTable.has(S(m['차량번호'])));
  if (missed.length !== onlyMissed.length) console.log(`   · 누락 블록에서 ${missed.length - onlyMissed.length}줄을 걷었습니다 — 본표에 올랐습니다`);
  const values: (string | number | boolean)[][] = [
    /**
     * ★**제목은 «맨 앞»에서 시작한다** — 사장님 2026-09-03 「여기 제목을 앞으로 보내고 틀고정 필요없음」.
     *   ⚠ C1 부터 밀어 놓았던 것은 «틀고정 때문»이었다 — 병합이 얼린 칸을 가로지르면 시트가 통째로
     *     거부한다(「병합된 셀의 일부만 포함된 열을 고정할 수 없습니다」 · 실측 12곳 전부).
     *     틀고정을 걷었으니 그 이유가 사라졌다. 병합을 A1 부터 한 줄로 편다.
     */
    [`${monthKo(MONTH)} 정산서    ·    ${j.sup} 귀중 · ${CORP.name} 발행`, ...pad(HEAD.length - 1)],
    /** 돈 세 칸은 «자리로» 놓는다 — 뒤에 「확인·메모」가 붙었으므로 끝에서부터 세면 안 된다. */
    [...pad(iM), '공급가액', '부가세', '청구 금액', ...pad(HEAD.length - iM - 3)],
    [...pad(iM), j.net, j.vat, j.net + j.vat, ...pad(HEAD.length - iM - 3)],
    HEAD,
    ...body,
    ['', '합계', `${j.lines.length}건`, ...pad(iM - 3), j.net, j.vat, j.net + j.vat, ...pad(HEAD.length - iM - 3)],
    /**
     * ★★**합계 아래 «빈 열 줄»** — 사장님 2026-09-03 「정산서 밑에 여백을 열 줄 놓아 두면
     *   추가하라고 빠진 거 있으면 추가해 달라고」 · 2026-09-08 「10줄씩 넣자 예비줄」.
     *   영업채널 시트와 **같은 양식**이다 — 「최대한 양식을 같이 써야 함」(2026-09-08).
     * ⚠⚠ 다시 찍을 때 «적어 둔 줄은 그대로 되돌려 놓는다»(missed).
     */
    /**
     * ★★★**본표에 오른 차는 누락 블록에서 «걷는다».** 사장님 2026-09-08 「정산 위에 칸에 반영하라고」.
     *   적어 주신 줄을 본표에 세워 놓고 아래에도 그대로 두면 **같은 차가 두 번** 보인다 —
     *   실측 161호1543 송해민이 15행(본표)과 51행(누락)에 같이 서 있었다.
     *   상대는 「반영이 된 건가 안 된 건가」를 우리한테 물어야 한다.
     *   ⇒ 되돌려 놓는 것은 «아직 본표에 없는» 줄뿐이다. 올라간 줄은 위에서 보면 된다.
     */
    ...onlyMissed.map((m) => HEAD.map((h) => S(m[h]))),
    ...Array.from({ length: Math.max(0, BLANKS - onlyMissed.length) }, (_, k) => (k === 0 && !onlyMissed.length
      /**
       * ★**안내문은 «첫 칸»에 둔다** — 사장님 2026-09-08 「빠진 거 입력하는 거에 박스랑 이거 밀려서 안 맞네」.
       *   맨 끝 칸(메모)에 넣었더니 표 오른쪽 끝에 붙어 «밀려» 보였다.
       *   적기 시작하는 자리에 있어야 「이 줄부터 적어 주세요」가 말이 된다.
       */
      ? ['빠진 건이 있으면 이 줄부터 적어 주세요 — 차량번호·임차인과 «공급가액»까지 적어 주시면 그대로 청구에 넣습니다', ...pad(HEAD.length - 1)]
      : pad(HEAD.length))),
    /**
     * ★빈 줄도 «칸 수만큼» 적는다 — `[]` 로 두면 그 줄을 안 건드려 «옷 글이 남는다».
     *   실측 2026-09-04 — 환수 줄이 늘면서 꼬리가 한 칸 밀렸는데 옷 꼬리가 그대로 남아
     *   「입금 부탁드립니다」가 두 줄 나왔다.
     */
    pad(HEAD.length),
    /**
     * ★★**「어디에 적으시라」를 적어 둔다.** 칸을 만들어 놓고 말을 안 하면 상대는 우리 칸을
     *   직접 고친다 — 그러면 다음 발행 때 덮이는 그 사고가 또 난다(2026-09-04 하허호에서 났다).
     * ★예정 달에는 대신 «아직 마감 전»이라고 말한다. 확정본으로 알고 계산서를 끊으면 그게 사고다.
     */
    [FORECAST
      ? `${Number(MONTH.slice(5))}월은 아직 마감 전입니다 — 분납이 끝나는 달로 «미리» 잡아 둔 예정분입니다. 인도 전인 건은 금액이 인도 뒤에 정해집니다. 마감 때 확정본으로 바뀝니다.`
      : '맞으면 「확인」을 켜 주세요. 다를 때는 「정정」을 켜고 「정정금액」에 공급가액(부가세 별도)을, 「메모(정정사유)」에 까닭을 적어 주시면 저희가 원장과 맞대 보고 고칩니다.', ...pad(HEAD.length - 1)],
    [FORECAST ? '' : `${dayKo(dueDate(MONTH))} 까지 입금 부탁드립니다`, ...pad(HEAD.length - 1)],
    [`${CORP.staff} · ${S(CORP.staffPhone) || CORP.phone} · ${CORP.email}`, ...pad(HEAD.length - 1)],
    ['한 달간 함께해 주셔서 감사합니다 · 프리패스모빌리티 주식회사 임직원 일동', ...pad(HEAD.length - 1)],
  ];
  /** ★칸이 26개를 넘으면 한 글자로 못 적는다 — AA 꼴까지 센다. */
  const colName = (n: number) => { let t = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) t = String.fromCharCode(65 + ((x - 1) % 26)) + t; return t; };
  const endCol = colName(HEAD.length);
  /**
   * ★★★**범위만 넓히면 지워지지 않는다 — «빈 줄»을 같이 보내야 지워진다.**
   *   지난달보다 줄이 줄어들면 아래에 남은 옆 줄이 그대로 살아있는다 — 실측 2026-09-07
   *   웰릭스 8월 탭이 5줄→4줄로 줄면서 「한 달간 함께해 주셔서 감사합니다」가 세 번 찍혔다.
   *   구글 values.update 는 «보낸 칸»만 쓴다. 범위를 넓게 적는 것으로는 아무것도 안 지워진다.
   */
  const wipe = Array.from({ length: 5 }, () => Array.from({ length: HEAD.length }, () => ''));
  /**
   * ★★★**값을 쓰는 이 한 번을 «안 보고» 있었다.**
   *   실측 2026-09-08 — 분당 한도(429)에 걸려 이 PUT 이 조용히 실패했는데,
   *   서식 요청만 성공해 「✓ 붙였습니다」가 찍혔다. 시트는 옆 판 그대로인데
   *   화면은 새 줄 수를 말해 «올라간 줄이 안 보인다»가 됐다(161호1543 송해민).
   *   ⇒ 쓰기는 반드시 답을 본다. 429 는 쌀었다 다시 쓴다.
   */
  for (let t = 0; ; t++) {
    const wr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${j.sheetId}/values/${encodeURIComponent(`'${tabRef}'!A1:${endCol}${values.length + 5}`)}?valueInputOption=RAW`, {
      method: 'PUT', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [...values, ...wipe] }),
    });
    if (wr.ok) break;
    if ((wr.status === 429 || wr.status >= 500) && t < 5) { await new Promise((z) => setTimeout(z, wr.status === 429 ? 20_000 : 2_000)); continue; }
    console.log(`
  ✕ 값을 못 썼습니다 ${wr.status} — ${(await wr.text()).slice(0, 160)}
`);
    process.exit(1);
  }

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
    { mergeCells: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEAD.length }, mergeType: 'MERGE_ALL' } },
    { repeatCell: { range: all1(0, 1),
      cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10, right: 10, top: 2, bottom: 2 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
    /**
     * ★★★**얼룩(지브라)을 걷는다** — 사장님 2026-09-08 「그리고 얼룩이 하지 말자고 했고」.
     *   («얼룩무늬 뺀다»는 화면 쪽에서 이미 정해진 규격이다 — `check-design-locked`.)
     * ⚠ **흰색을 «명시»해야 걷힌다.** 지금 코드는 얼룩을 안 칠하지만, 예전에 칠한 것은
     *   값처럼 지워지지 않고 시트에 그대로 남는다 — 기울임 때와 같은 종류다.
     *   ⇒ 본문 줄을 흰 바탕으로 먼저 깔고, 합계·환수처럼 «색이 있어야 하는» 줄은 뒤에서 덮는다.
     */
    { repeatCell: { range: all1(r0 + 1, last), cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } }, fields: 'userEnteredFormat.backgroundColor' } },
    bar(1, true), bar(r0, false), tint(2), tint(last),
    /** ★머리줄 40 — 「수수료 산정 기준」이 안 잘리게 두 줄 자리를 준다. */
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r0, endIndex: r0 + 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r0 + 1, endIndex: last + 1 }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
    /** ★환수 줄은 연한 붉은빛 — «빼는 돈»이라 숫자만 음수면 눈에 안 들어온다. */
    /** ★「정정」 켠 줄 — 환수보다 «먼저» 칠한다. 겹치면 환수 색이 이긴다. */
    ...body.map((r, i) => (r[HEAD.indexOf('정정')] === true ? i : -1)).filter((i) => i >= 0)
      .map((i) => ({ repeatCell: { range: all1(r0 + 1 + i, r0 + 2 + i),
        cell: { userEnteredFormat: { backgroundColor: FIX_ROW } }, fields: 'userEnteredFormat.backgroundColor' } })),
    ...(j.claw ? [body.length - 1] : []).map((i: number) => ({ repeatCell: { range: all1(r0 + 1 + i, r0 + 2 + i),
      cell: { userEnteredFormat: { backgroundColor: BACK_ROW, textFormat: { bold: false } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } })),
    // 정렬 — 돈은 우측 · 글은 좌측 · 나머지 가운데
    ...HEAD.map((h, c) => ({ repeatCell: { range: { sheetId: id, ...DATA, startColumnIndex: c, endColumnIndex: c + 1 },
      cell: { userEnteredFormat: { horizontalAlignment: MONEY.includes(h) ? 'RIGHT' : LEFT.includes(h) ? 'LEFT' : 'CENTER', verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)' } })),
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: 3, startColumnIndex: iM, endColumnIndex: HEAD.length },
      cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
    ...MONEY.map((h) => col(h, { startRowIndex: 2, endRowIndex: last + 1 }, { numberFormat: { type: 'NUMBER', pattern: '#,##0' } }, 'userEnteredFormat.numberFormat')),
    col('계약 기간', DATA, { numberFormat: { type: 'NUMBER', pattern: '0"개월"' } }, 'userEnteredFormat.numberFormat'),
    col('차량번호', DATA, { numberFormat: { type: 'TEXT' } }, 'userEnteredFormat.numberFormat'),
    /**
     * ★**예비줄 띠** — 흐린 글씨로 두어 «적으라고 낸 자리»임이 보이게. 줄 높이는 표와 같은 24.
     */
    { repeatCell: { range: all1(last + 1, last + 1 + BLANKS),
      cell: { userEnteredFormat: { textFormat: { fontSize: 10, foregroundColor: { red: 0.55, green: 0.58, blue: 0.63 } }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: last + 1, endIndex: last + 1 + BLANKS }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
    /**
     * ★★★**예비줄에서 체크박스를 «걷는다».** 지난 달에 본표였던 줄이 이번 달엔 예비줄이 되는데,
     *   데이터 검증은 값처럼 지워지지 않아 «적으라고 낸 빈 줄»에 확인·정정 체크박스가 남는다
     *   (사장님 2026-09-08 스크린샷 — 안내문 옆에 박스 둘이 떠 있었다).
     *   ⇒ 범위 전체에 «규칙 없는» setDataValidation 을 보내 걷는다. 가감사유 때와 같은 처방이다.
     */
    { setDataValidation: { range: all1(last + 1, last + 1 + BLANKS) } },
    /** ★꼬리 넉 줄 — 예비줄만큼 내려온다. 범위를 같이 늘리지 않으면 마지막 줄이 헐벗는다. */
    { repeatCell: { range: all1(last + 2 + BLANKS, last + 6 + BLANKS),
      cell: { userEnteredFormat: { textFormat: { fontSize: 10 }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(textFormat,horizontalAlignment)' } },
    ...WIDTH.map((w, c) => ({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
    { repeatCell: { range: { sheetId: id }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Roboto' } } }, fields: 'userEnteredFormat.textFormat.fontFamily' } },
    /** ★머리 네 줄 + 차량번호까지 얼린다 — 산출조건까지 가로로 미는 표라 차번을 잃으면 못 읽는다. */
    /**
     * ★**필터를 걸어 둔다** — 상품 구분·모델로 그 자리에서 추린다(영업채널 시트와 같은 규격).
     *   ⚠ 범위는 머리줄~마지막 줄까지 — 합계줄이 들어가면 걸러도 합계가 따라 사라진다.
     */
    { setBasicFilter: { filter: { range: { sheetId: id, startRowIndex: r0, endRowIndex: last, startColumnIndex: 0, endColumnIndex: HEAD.length } } } },
    /** ★「확인」은 체크칸으로 — 공급사가 누르기만 하면 된다. */
    /** ★「확인」·「정정」은 체크칸 — 상대가 누르기만 하면 된다. */
    /**
     * ★★★**체크칸을 새로 걸기 «전»에 표 전체의 데이터 확인을 걷는다.**
     *
     * ⚠ 실측 2026-09-08 — 「청구월/지급월」 칸을 넣으면서 확인·정정이 한 칸씩 밀렸는데,
     *   체크박스 규칙은 **옛 자리에 그대로 남았다.** 그래서 「지급월·합계·지급 예정일」 칸에
     *   BOOLEAN 규칙이 걸린 채 글자가 들어 시트가 **「잘못된 입력」** 이라고 빨간 표시를 냈다
     *   (사장님 「잘못 입력이라고 오류 뜨는 거 체크해 주고」).
     *   `setDataValidation` 은 «건 자리»에만 걸고 옛 자리를 안 걷는다.
     *   ⇒ 칸이 늘거나 줄 때마다 이 사고가 난다. 먼저 통째로 걷고 다시 건다.
     */
    /**
     * ⚠ **본문만 걷으면 «합계 줄»에 남는다** — 합계 칸에 체크박스 규칙이 남아
     *   「잘못된 입력」으로 빨갛게 뜬다(실측 2026-09-08).
     *   ⇒ 우리가 쓰는 자리 전부를 걷고 체크칸만 다시 건다.
     */
    { setDataValidation: { range: all1(r0 + 1, last + BLANKS + 8) } },
    ...['확인', '정정'].map((h) => HEAD.indexOf(h)).filter((c) => c >= 0).map((c) => ({
      setDataValidation: { range: { sheetId: id, startRowIndex: r0 + 1, endRowIndex: last, startColumnIndex: c, endColumnIndex: c + 1 }, rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true } } })),
    /**
     * ★★**구역 칸막이** — «차·임차인 │ 산정 기준 │ 금액 │ 확인» 사이에 생겨 줄 하나.
     *   색만으로 가르면 인쇄하거나 흑백으로 볼 때 구역이 사라진다. 선은 남는다.
     */
    ...[iB, iM, HEAD.indexOf('확인')].filter((c) => c > 0).map((c) => ({ updateBorders: {
      range: { sheetId: id, startRowIndex: r0, endRowIndex: last + 1, startColumnIndex: c, endColumnIndex: c + 1 },
      left: { style: 'SOLID', width: 1, color: LINE } } })),
    /** ★틀고정은 «안 건다» — 사장님 2026-09-03 「틀고정 필요없음」. 한 화면에 드는 표다. */
    { updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: 0, frozenColumnCount: 0 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
  ];
  /**
   * ★★**탭 이름에 건수를 달아 둔다** — 「26년08월 정산 (41건)」.
   *   사장님 2026-09-08 「각 탭에는 건수 표시하자」 — 열어보기 전에 규모가 보인다.
   *   ⚠ 찾기는 `settleTabBase` 로 «앞글»만 맞춘다 — 안 그러면 달마다 탭이 새로 생긴다.
   */
  const fr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${j.sheetId}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: reqs }),
  });
  console.log(`   ${fr.ok ? 'o' : '! 서식'} ${j.sup.padEnd(11)} ${String(j.lines.length).padStart(2)}줄 · ${won(j.net + j.vat).padStart(12)}  →  ${aliasOf(j.sheetName)} 시트`);
  if (!fr.ok) console.log(`      ${(await fr.text()).slice(0, 160)}`);
}
console.log(`\n   ✓ ${jobs.length}곳에 붙였습니다.\n`);
process.exit(0);
