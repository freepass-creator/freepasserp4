/**
 * **정산원장 「청구」 탭 — 청구월로 쌓는 장부.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25
 *   「접수를 받을때 거기에 청구월이 생성될거고 그 청구월기준으로 청구서에 반영하면 되는거고」
 *   「그럼 청구를 가면 청구월이 있는거지 그럼 청구와 분납 완료에 대한게 매칭이 되어야겠네」
 *   「분납에 환수는 마이너스청구니까 그냥 월별로 청구를 계속 쌓으면서 관리하면 되겄다」
 *   「청구와 환수는 공존할 수 있고」 「청구는 변동없는거고」
 *
 * ★**돈이 어디에 있나** — 원장 실측(2026-08-25).
 * ```
 * 판매수수료 = 렌탈료 × 계약기간 × 공급사요율    → 공급사에 청구한다
 * 출고수수료 = 렌탈료 × 계약기간 × 에이전시요율  → 영업자에게 지급한다
 * 우리 몫    = 판매수수료 − 출고수수료          (부가세는 통과금이라 뺀다)
 *   검산 49호3059  920,000 × 48 × 3.25% = 1,435,200 ✓
 * ```
 * ⚠ 원장의 「청구금액」·「지급액」은 **부가세 포함 총액**인데 세금계산서를 실제로 끊은 줄에만
 *   들어 있다(2026-07 33줄 중 6줄·8줄). 그래서 **적혀 있으면 그 값을 쓰고, 없으면 계산한다** —
 *   한 번 나간 청구는 안 고친다는 뜻이다(사장님 「청구는 변동없는거고」).
 *
 * ★**청구 줄의 짝은 분납실적이나 완납실적에 있다.** 접수·취소에는 있으면 안 된다 — 검산한다.
 * ★**2026-08부터만 쌓는다.** 그 전은 이미 청구가 끝났다(사장님 「기존거는 다 청구했고 이거는
 *   따로 맞출게 나는 이번달거랑 앞으로 어떻게 할지만 볼거야」). 과거는 완납실적에 그대로 있다.
 * ★**환수 줄의 청구월은 비워 둔다.** 환수가 몇 월에 잡혔는지는 원장에 없다 —
 *   사람이 채우는 칸이라 주황으로 칠한다. 비어 있으면 그 달 합계에 안 들어간다.
 * ★되돌릴 일이 생기면 줄을 고치지 말고 **마이너스 한 줄을 더한다**.
 *
 *   npx tsx scripts/build-settlement-billing.mts
 *   npx tsx scripts/build-settlement-billing.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { readLedger, sheetsToken, iso } from '../lib/server/settlement-ledger-read';
import { billingMonth, moneyOf } from '../lib/domain/settlement-stage';

const TAB = '청구';
const PAY = '분납실적', DONE = '완납실적', CUR = '접수', CANCEL = '취소';
const FROM = '2026-08'; // 이 달부터 쌓는다
/**
 * ★**공급사마다 청구 시점이 다르다**(사장님 2026-08-25
 *   「스타랑 아이카는 분납 완료되면 청구야 · 나머지는 선납으로 주고 · 회차별로 부러지면 분할해서주고」).
 * ```
 * 스타 · 아이카   분납건은 **선지급이 없다.** 분납이 다 들어와야 청구한다
 *                 → 청구월 = 마지막 납입월(인도일 + (회차−1)개월)
 * 그 밖           선납이다 → 인도되는 달에 바로 전액 청구·지급한다
 * 부러지면        **받은 회차만큼만** 준다 — 2회분납에서 1회차만 받고 부러지면 «50% 청구·50% 지급»
 *                 (사장님 2026-08-25 「2회분납인데 1회차납부하고 부러지면 50% 지급이고 청구이고」)
 * ```
 * ⚠ 일시납은 이 규칙과 상관없다 — 나눌 회차가 없다.
 * ⚠ **받은 회차는 기계가 모른다**(회차별 입금 자료가 없다). 실적 탭에서 「환수」에 체크하고
 *   못 받은 몫을 환수금액에 적으면 그만큼 빠진다 — 2회분납 1회차만 받았으면 «절반»이 환수액이다.
 */
/** ★분납 부러지면 «지급»이 아예 없는 공급사. 청구월은 이제 이 목록과 무관하다(위 주석). */
const NO_PAY_IF_BROKEN = [/스타/, /아이카/];
const BLANK = 40;
const VAT = 0.1;
/** ★탭 머리에 붙는 설명. A1 은 탭 이름, B1 부터가 설명이다 — 고정 열과는 합칠 수 없다. */
const ABOUT = '청구 — 청구월로 쌓는 장부입니다. **분납실적 + 완납실적**에서 만듭니다. 2026-08부터 담습니다(그 전은 이미 청구가 끝났습니다). '
  + '한 계약이 한 줄이고, 환수가 있으면 그 줄이 주황이 되며 순액 = 우리 몫 − 환수금액입니다. '
  + '⚠ **환수는 여기서 적지 않습니다** — 분납실적·완납실적에서 「환수」에 체크하고 환수일·환수금액을 적으면 여기에 따라옵니다. '
  + '이 탭에서 사람이 적는 칸은 「비고」 하나뿐이고 나머지는 잠겨 있습니다.';

/**
 * 청구 장부 열. 왼쪽은 누구 건인지, 가운데는 받을 돈, 그다음이 줄 돈, 끝이 «되돌린 돈»이다.
 *
 * ★**청구 줄과 환수 줄은 따로다**(사장님 2026-08-25 「청구한거는 변함이 없게하고 ·
 *   나중에 환수가 터지면 환수실적이 생기는거로 해야할거 같은데?? · 기존줄에 체크하고 환수금액을 넣는게 맞나??」).
 *   ⚠ **기존 줄에 넣으면 안 된다.** 10월에 환수가 터졌는데 8월 줄을 고치면 **이미 계산서를 끊은 8월 장부가 바뀐다.**
 *     한 번 나간 청구는 안 고친다는 규칙과 정면으로 부딪힌다.
 * ```
 * 26년08월  316라1593  청구  +2,095,000   ← 영원히 안 변한다
 * 26년10월  316라1593  환수  −1,200,000   ← 환수일이 10월이면 10월 탭에 새 줄
 * ```
 *   같은 차가 두 탭에 서지만 **다른 사건**이라 맞다. 「구분」 칸이 그 둘을 가른다.
 * ★환수는 **실적 탭에서만** 체크한다(환수·환수사유·환수일·환수금액). 여기는 그걸 읽어 줄을 만들 뿐이다.
 */
const OUT = [
  // ── 앞자리는 실적 탭과 같은 차례다(사장님 2026-08-25 「청구탭도 규격 통일해야지」)
  //    연·월은 칸을 나눈다 — 「2026년만」·「8월만」을 필터로 고를 수 있게(「연 월을 칸으로 관리해야함」)
  '접수일', '차량번호', '공급사', '고객명', '영업채널', '영업담당자', '상품구분',
  '계약기간', '보증금', '렌탈료', '차량가액', '분납여부', '인도일', '청구년', '청구월', '구분', '분납만료',
  // ── 받을 돈
  '공급사요율', '청구액', '청구부가세', '청구합계',
  // ── 줄 돈
  '영업자요율', '지급액', '지급부가세', '지급합계',
  '우리몫',
  // ── 되돌린 돈 (실적 탭에서 적은 것이 따라온다)
  '환수사유', '비고'] as const;
/**
 * ★**여기서는 환수를 적지 않는다.** 환수 체크·환수일·환수금액은 **실적 탭(분납실적·완납실적)**에서
 *   적고, 이 장부는 그걸 읽어 순액만 낸다(사장님 2026-08-25 「환수도 체크박스로」 —
 *   체크하는 자리가 둘이면 반드시 어긋난다. 실제로 옛 값 「FALSE」가 원장의 참을 덮어 환수가 0으로 셌다).
 *   그래서 사람이 적는 칸은 「비고」 하나뿐이고, 그 값만 다시 만들 때 지켜진다.
 */
const HUMAN = ['비고'];
/** 줄의 갈래 — 청구(+) 인가 환수(−) 인가. */
const KIND_BILL = '청구';
const KIND_CLAW = '환수';
const CLAW_BOX = '환수';
const ON = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));
const BOOL = (on: boolean) => (on ? 'TRUE' : 'FALSE');
/** 원장에서 이름 그대로 떠 오는 것. */
const COPY: Partial<Record<(typeof OUT)[number], string>> = {
  차량번호: '차량번호', 접수일: '접수일', 고객명: '고객명', 공급사: '공급사',
  영업채널: '영업채널', 영업담당자: '영업담당자', 상품구분: '상품구분', 계약기간: '계약기간',
  보증금: '보증금', 렌탈료: '렌탈료', 차량가액: '차량가액', 분납여부: '분납여부', 인도일: '인도일',
  환수사유: '환수사유',
  공급사요율: '공급사수수료율', 영업자요율: '에이전시수수료율',
};

const APPLY = process.argv.includes('--apply');
/**
 * 월을 지정하면 그 탭만 갱신한다. 월 마감 검토 중에 다른 달 장부까지 다시 쓰면
 * 이미 확인한 값·비고가 엉킬 수 있으므로, 운영 반영은 이 제한 경로를 사용한다.
 */
const MONTH_ARG = process.argv.find((v) => v.startsWith('--month='))?.slice('--month='.length) || '';
if (MONTH_ARG && !/^\d{4}-\d{2}$/.test(MONTH_ARG)) throw new Error('--month 는 YYYY-MM 형식이어야 합니다.');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
/** ★열 이름 — Z 를 넘으면 두 글자가 된다(AA·AB…). `fromCharCode` 하나로는 깨진다. */
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const p2 = (n: number) => String(n).padStart(2, '0');
const SERIAL0 = Date.UTC(1899, 11, 30);
/** ★구글 날짜는 숫자로 온다 — `45301` 을 그냥 `new Date` 에 넣으면 45301년이 된다. */
const d = (v: string) => {
  const t = S(v);
  if (!t) return null;
  const n = Number(t);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const x = new Date(t);
  return Number.isNaN(+x) ? null : x;
};
const addM = (x: Date, n: number) => new Date(x.getFullYear(), x.getMonth() + n, x.getDate());
const fmt = (x: Date) => `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(30_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 180)}`);
  }
};

const read = async (tab: string) => {
  const got = await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const all = ((got?.values || []) as unknown[][]).map((r) => (r || []).map(S));
  // ★머리글은 1행이 아니라 «「차량번호」가 있는 줄»이다. 1행에는 탭 설명이 붙어 있다.
  const hi = all.findIndex((r) => r.includes('차량번호'));
  const rows = hi < 0 ? all : all.slice(hi);
  if (rows.length < 2) return { head: [] as string[], body: [] as string[][] };
  return { head: rows[0], body: rows.slice(1).filter((r) => S(r[rows[0].indexOf('차량번호')])) };
};

/**
 * ★**청구서의 원천은 「분납실적 + 완납실적」이다**(사장님 「분납과 완납실적을 기반으로 청구서를 만드는거지」).
 *   ⚠ 다만 **당월 건은 인도돼도 이달이 마무리될 때까지 접수 탭에 머문다.**
 *     청구는 인도되는 즉시 나가야 하므로 접수 탭도 같이 읽는다 —
 *     거기 남은 «인도 전» 줄은 청구월이 비어 있어 아래 `bill < FROM` 에 저절로 걸러진다.
 */
const rows: { tab: string; head: string[]; r: string[] }[] = [];
for (const tab of [CUR, PAY, DONE]) {
  const { head, body } = await read(tab);
  for (const r of body) rows.push({ tab, head, r });
  console.log(`   ${tab.padEnd(6)} ${String(body.length).padStart(4)}줄`);
}
if (!rows.length) { console.log('⛔ 분납실적·완납실적이 비었다 — build-settlement-tabs 를 먼저 돌려라.'); process.exit(1); }

type Row = { head: string[]; r: string[] };
/** ★자리가 아니라 이름으로 꺼낸다. */
const get = (x: Row, name: string) => { const i = x.head.indexOf(name); return i >= 0 ? S(x.r[i]) : ''; };
/**
 * ★청구월은 `YYYY-MM` 글자여야 한다. 시트에 날짜값으로 들어 있으면 `46235` 로 읽히고
 *   `'46235' > '2026-08'` 이 참이 돼 달 가르기가 망가진다 — 읽는 쪽에서도 한 번 더 막는다.
 */
const monthOf = (v: string) => {
  const t = S(v);
  if (/^\d{4}-\d{2}$/.test(t)) return t;
  const x = d(t);
  return x ? `${x.getFullYear()}-${p2(x.getMonth() + 1)}` : '';
};

/**
 * ★**사람이 적어 둔 값을 먼저 거둬 온다.** 이 탭은 매번 새로 그리므로,
 *   거두지 않으면 환수 체크와 금액이 **다시 만들 때마다 지워진다.**
 *   열쇠는 차량번호 + 접수일 — 같은 차가 다시 나가기 때문이다.
 */
const saved = new Map<string, Record<string, string>>();
{
  const metaPre = await api(`${SH}/${LEDGER}?fields=sheets.properties(title)`);
  const tabs = ((metaPre.sheets || []) as any[]).map((x) => S(x.properties.title)).filter((t) => t === TAB || /^\d{2}년\d{2}월$/.test(t));
  for (const tb of tabs) {
  const { head, body } = await read(tb);
  if (head.length) {
    const iP = head.indexOf('차량번호'), iR = head.indexOf('접수일');
    for (const r of body) {
      const rec: Record<string, string> = {};
      for (const c of HUMAN) { const i = head.indexOf(c); if (i >= 0 && S(r[i])) rec[c] = S(r[i]); }
      if (Object.keys(rec).length) saved.set(`${S(r[iP])}|${S(r[iR])}`, rec);
    }
  }
  }
  if (saved.size) console.log(`   사람이 적어 둔 줄 ${saved.size} — 그대로 지킨다`);
}

const out: string[][] = [];
let refund = 0, skipped = 0, cancelled = 0, undelivered = 0, computed = 0, kept = 0, clawRows = 0;
/** 환수인데 달을 못 정한 줄 — 환수일이 없거나 시작 달보다 앞이다. */
const noClawMonth: string[] = [];
for (const x of rows) {
  // 취소 체크가 남은 탭에 아직 이동되지 않았더라도 청구 장부에는 절대 올리지 않는다.
  // `settlement-stage.ts`와 같은 우선순위다. 탭 위치보다 계약취소 원자가 이긴다.
  if (ON(get(x, '계약취소'))) { cancelled++; continue; }
  // 청구의 관문은 인도완료 체크다. 인도일 글자만 남은 행은 과거 입력 흔적일 수 있으므로
  // 청구 대상에 넣지 않는다. 직원 검토 탭과 ERP 정산서가 같은 기준을 보게 한다.
  if (!ON(get(x, '인도완료'))) { undelivered++; continue; }
  // ★열쇠는 「2026-08」 — 나뉜 두 칸(청구년·청구월)을 이어 붙여 만든다.
  const ymKey = (y: string, m: string) => (S(y) && S(m) ? `${S(y)}-${String(Number(m)).padStart(2, '0')}` : '');
  let bill = ymKey(get(x, '청구년'), get(x, '청구월')) || monthOf(get(x, '청구월'));
  const back = ON(get(x, '환수')) || /환수/.test(get(x, '상태'));
  /**
   * ★**환수도 같은 기준으로 자른다**(사장님 2026-08-25 「청구에는 25년도거 있는데」).
   *   예전엔 환수만 예외로 다 담아서 2025년 줄이 섞여 보였다. 「기존거는 다 청구했고」니
   *   과거 환수도 이미 정산이 끝난 것으로 본다 — 남아 있으면 완납실적에서 여전히 보인다.
   *   환수일이 적혀 있으면 **그 달**로 자르고, 없으면 원래 청구월로 자른다.
   */
  // ★청구 줄은 청구월로, 환수 줄은 환수일로 각각 자른다. 아래에서 따로 판정한다.
  const clawWhen = (() => { const t = d(get(x, '환수일')); return t ? `${t.getFullYear()}-${p2(t.getMonth() + 1)}` : ''; })();
  if (bill < FROM && (!back || !clawWhen || clawWhen < FROM)) { skipped++; continue; }
  const del = d(get(x, '인도일'));
  const m = /(\d)\s*회/.exec(get(x, '분납여부'));
  const due = m && del && Number(m[1]) >= 2 ? addM(del, Number(m[1])) : null;
  /**
   * ★스타·아이카의 분납건은 **만료월**이 청구월이다. 분납이 다 들어와야 청구하기 때문이다.
   *   만료가 아직 안 왔으면 청구 자체를 미룬다 — 그 줄은 이번 달 장부에 안 선다.
   */
  /**
   * ★**2026-08부터는 «인도월»이 청구월을 정한다**(사장님 2026-08-25 「이거 기준으로 가자」).
   *   원본은 월별 탭이라 8월 인도분을 9·10월 탭에 넣어 둔 것이 19건 있었다 —
   *   청구는 인도가 관문이라고 정했으니 우리 규칙이 원본 표기를 이긴다.
   *   ⚠ **과거(2026-08 앞)는 안 건드린다.** 이미 계산서를 끊었고 「청구는 안 고친다」가 위다.
   */
  if (del) {
    const byDel = `${del.getFullYear()}-${p2(del.getMonth() + 1)}`;
    if (byDel >= FROM) bill = byDel;
  }
  /**
   * ★★**분납건은 공급사를 가리지 않고 «완료시점»이 청구월이다**(사장님 2026-09-01).
   *   2026-08-31 까지는 스타·아이카만 그랬는데, 원본 정산시트는 «모든» 분납건을 그렇게 하고 있었다.
   *   ⚠ 정본은 `lib/domain/settlement-stage.ts` `claimsOnComplete` 다 — 여기는 시트 발행용 사본이다.
   *     둘이 갈리면 화면과 시트가 다른 달을 말한다. 바꿀 때 같이 바꾼다.
   */
  const late = !!due;
  // ★**마지막 납입은 인도일 + (회차−1)개월**이다 — 1회차를 인도 때 내기 때문이다.
  const lastPay = m && del && Number(m[1]) >= 2 ? addM(del, Number(m[1]) - 1) : null;
  if (late && lastPay) bill = `${lastPay.getFullYear()}-${p2(lastPay.getMonth() + 1)}`;

  /**
   * ★**적혀 있으면 그 값이 이긴다** — 실제로 계산서를 끊은 금액이다.
   *   ⚠ 환수 줄에는 「판매수수료」·「출고수수료」가 아예 없고 **부가세 포함 총액**만 있다(21줄 전부).
   *     그때는 총액에서 공급가를 역산한다 — 검산 122하2972 755,040 ÷ 1.1 = 686,400 = 880,000×48×1.625% ✓
   */
  const claimTot = N(get(x, '청구금액')), payTot = N(get(x, '지급액'));
  const claimNet = N(get(x, '판매수수료')) || (claimTot ? Math.round(claimTot / (1 + VAT)) : 0);
  const payNet = N(get(x, '출고수수료')) || (payTot ? Math.round(payTot / (1 + VAT)) : 0);
  const claimVat = N(get(x, '공급사부가세')) || (claimTot ? claimTot - claimNet : Math.round(claimNet * VAT));
  const payVat = N(get(x, '에이전시부가세')) || (payTot ? payTot - payNet : Math.round(payNet * VAT));
  const claimSum = claimTot || claimNet + claimVat;
  const paySum = payTot || payNet + payVat;
  if (claimTot || payTot) kept++; else if (claimNet || payNet) computed++;

  if (back) refund++;   // 환수 줄 수
  const n = (v: number) => (v ? String(v) : '');
  const key = `${get(x, '차량번호')}|${d(get(x, '접수일')) ? fmt(d(get(x, '접수일'))!) : get(x, '접수일')}`;
  const was = saved.get(key) || {};
  /**
   * ★**사람이 적은 값이 늘 이긴다.** 처음 그릴 때만 원장의 「환수」 상태로 체크를 켜 주고
   *   환수금액에 청구액을 넣어 둔다 — 되돌릴 금액이 그것부터라는 뜻일 뿐, 다르면 사람이 고친다.
   * ★환수월은 원장에 없다. **비워 두고 사람이 채운다** — 채워야 그 달 합계에 들어간다.
   */
  // ★환수 셋은 원장 줄에서 그대로 떠 온다. 환수월은 환수일이 정한다.
  const claw = ON(get(x, '환수'));
  const clawDay = d(get(x, '환수일'));
  const clawAmt = N(get(x, '환수금액'));
  const made: Partial<Record<(typeof OUT)[number], string>> = {
    청구년: bill ? bill.slice(0, 4) : '',
    청구월: bill ? String(Number(bill.slice(5, 7))) : '',
    구분: KIND_BILL,
    분납만료: due ? fmt(due) : '',
    청구액: n(claimNet), 청구부가세: n(claimVat), 청구합계: n(claimSum),
    지급액: n(payNet), 지급부가세: n(payVat), 지급합계: n(paySum),
    우리몫: n(claimNet - payNet),
    비고: was.비고 ?? '',
  };
  // ★날짜 칸은 글자로 바꿔 담는다. 원장에서 `46248` 같은 숫자로 읽혀 오기 때문이다.
  for (const c of ['접수일', '인도일'] as const) { const t = d(get(x, c)); if (t) made[c] = fmt(t); }
  if (bill >= FROM) out.push(OUT.map((c) => (c in made ? made[c]! : COPY[c] ? get(x, COPY[c]!) : '')));
  /**
   * ★**환수는 «그 달»에 새 줄로 선다.** 원래 청구 줄은 손대지 않는다.
   *   환수일이 없으면 어느 달에 넣을지 모른다 — 짚어만 주고 안 넣는다(「없다」가 아니라 「모른다」).
   */
  if (claw && clawAmt && clawDay) {
    const ck = `${clawDay.getFullYear()}-${p2(clawDay.getMonth() + 1)}`;
    if (ck >= FROM) {
      const cVat = Math.round(clawAmt * VAT);
      const cm: Partial<Record<(typeof OUT)[number], string>> = {
        청구년: String(clawDay.getFullYear()), 청구월: String(clawDay.getMonth() + 1),
        구분: KIND_CLAW,
        청구액: String(-clawAmt), 청구부가세: String(-cVat), 청구합계: String(-(clawAmt + cVat)),
        우리몫: String(-clawAmt),
        비고: `${get(x, '환수사유') || '환수'} — ${bill} 청구분을 되돌림`,
      };
      out.push(OUT.map((c) => (c in cm ? cm[c]! : COPY[c] ? get(x, COPY[c]!) : '')));
      clawRows++;
    } else noClawMonth.push(`${get(x, '차량번호')} — 환수일 ${fmt(clawDay)} 이 ${FROM} 앞이다`);
  } else if (claw && clawAmt) noClawMonth.push(`${get(x, '차량번호')} — 환수일이 비어 있다`);
}
const col = (n: (typeof OUT)[number]) => OUT.indexOf(n);
/** ★한 줄의 청구월 열쇠 — 나뉜 두 칸을 이어 붙인다. */
const key = (o: string[]) => (S(o[col('청구년')]) && S(o[col('청구월')]) ? `${o[col('청구년')]}-${String(Number(o[col('청구월')])).padStart(2, '0')}` : '');
/**
 * 월별 검토 탭은 현재 정산 정본과 한 줄·한 금액까지 같아야 한다. 이 스크립트의 옛 탭
 * 해석은 보조일 뿐이고, 인도완료·취소·분납 규칙은 `settlement-stage.ts` 한 곳이 이긴다.
 */
const canonicalToken = await sheetsToken();
if (!canonicalToken) throw new Error('정산 정본 시트를 읽을 토큰이 없습니다.');
const canonicalRows = await readLedger(canonicalToken);
const canonical = new Map(canonicalRows
  .filter((x) => x.row.delivered && !x.row.cancelled && (billingMonth(x.row) || '') >= FROM)
  .map((x) => {
    const month = billingMonth(x.row)!;
    const money = moneyOf(x.row);
    return [`${x.row.plate}|${iso(x.row.receivedAt)}`, { month, money }] as const;
  }));
const canonicalized = out.filter((o) => {
  if (S(o[col('구분')]) !== KIND_BILL) return false;
  const hit = canonical.get(`${S(o[col('차량번호')])}|${S(o[col('접수일')])}`);
  if (!hit) return false;
  const { month, money } = hit;
  o[col('청구년')] = month.slice(0, 4);
  o[col('청구월')] = String(Number(month.slice(5, 7)));
  o[col('청구액')] = String(money.claim);
  o[col('청구부가세')] = String(money.claimVat);
  o[col('청구합계')] = String(money.claimTotal);
  o[col('지급액')] = String(money.pay);
  o[col('지급부가세')] = String(money.payVat);
  o[col('지급합계')] = String(money.payTotal);
  o[col('우리몫')] = String(money.margin);
  return true;
});
out.splice(0, out.length, ...canonicalized);
console.log(`   정본 대조 — 인도완료 청구 ${canonicalized.length}줄만 남김`);
/**
 * ★**월별로 모은다**(사장님 2026-08-25 「청구는 월별로 모으자」).
 *   청구월 ↓ → 공급사 → 차량번호. 그러면 «그 달 그 공급사» 줄들이 한 덩어리로 붙어
 *   그대로 계산서 한 장이 된다. 달이 바뀌는 자리에는 굵은 선을 긋는다.
 */
out.sort((a, b) => key(b).localeCompare(key(a))
  || S(a[OUT.indexOf('공급사')]).localeCompare(S(b[OUT.indexOf('공급사')]))
  || S(a[OUT.indexOf('차량번호')]).localeCompare(S(b[OUT.indexOf('차량번호')])));

// ── 검산: 청구 줄의 짝이 접수·취소에 있으면 안 된다 ──────────────────
/**
 * ★키는 **차량번호 + 접수일**이다. 차번만 보면 재렌트를 겹친 걸로 오해한다 —
 *   316라1593 은 8/6 이부연(인도 전)과 8/13 유보람(인도 완료)이 **다른 계약**이다.
 */
const iPlateOut = OUT.indexOf('차량번호'), iRecvOut = OUT.indexOf('접수일');
const bad: string[] = [];
for (const tab of [CUR, CANCEL]) {
  const { head, body } = await read(tab);
  const i = head.indexOf('차량번호'), j = head.indexOf('접수일'), k = head.indexOf('청구월');
  // ★접수 탭에서 겹치면 안 되는 것은 **「인도 전」 줄**뿐이다. 인도 완료 줄은 청구가 나가는 게 맞다.
  const keys = new Set(body.filter((r) => tab !== CUR || !S(r[k])).map((r) => `${S(r[i])}|${S(r[j])}`));
  for (const o of out) if (keys.has(`${o[iPlateOut]}|${o[iRecvOut]}`)) bad.push(`${o[iPlateOut]} 접수 ${o[iRecvOut]} — ${tab}에도 있다`);
}

/**
 * ★**인도월과 청구월이 다른 줄**은 짚어만 준다. 원본이 월별 탭이라 인도한 달과
 *   실제로 계산서를 끊은 달이 다른 건이 있다 — 고치지 않는다(「청구는 변동없는거고」).
 */
const gap = out.filter((o) => {
  const del = d(o[OUT.indexOf('인도일')]);
  return del && key(o) && `${del.getFullYear()}-${p2(del.getMonth() + 1)}` !== key(o);
});

const sum = (c: (typeof OUT)[number], mm?: string) => out.filter((o) => !mm || key(o) === mm).reduce((a, o) => a + N(o[col(c)]), 0);
const won = (n: number) => n.toLocaleString('ko-KR');
const months = [...new Set(out.map(key).filter(Boolean))].sort().reverse();
if (MONTH_ARG && !months.includes(MONTH_ARG)) {
  throw new Error(`${MONTH_ARG} 청구내역이 없습니다. 시트 원장과 청구월을 확인하세요.`);
}

console.log(`\n■ 청구 장부 — ${FROM} 부터 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`   청구 ${out.length - refund}줄 · 환수 ${refund}줄 = 모두 ${out.length}줄`);
if (cancelled) console.log(`   계약취소 ${cancelled}줄은 청구에서 뺐다.`);
if (undelivered) console.log(`   인도완료 전 ${undelivered}줄은 청구에서 뺐다.`);
console.log(`   과거(${FROM} 앞) ${skipped}줄은 안 담았다 — 이미 청구가 끝났고 완납실적에 그대로 있다.`);
console.log(`   금액 — 계산서 끊은 값 그대로 ${kept}줄 · 요율로 계산 ${computed}줄\n`);
console.log(`   ${'월'.padEnd(9)}${'줄'.padStart(4)}   ${'청구액'.padStart(12)} ${'지급액'.padStart(12)} ${'우리몫'.padStart(11)}`);
for (const mm of months) {
  const n = out.filter((o) => key(o) === mm).length;
  console.log(`   ${mm.padEnd(9)}${String(n).padStart(4)}   ${won(sum('청구액', mm)).padStart(12)} ${won(sum('지급액', mm)).padStart(12)} ${won(sum('우리몫', mm)).padStart(11)}`);
}
{
  const back = out.filter((o) => ON(o[col(CLAW_BOX)]));
  const noMonth = back.filter((o) => !S(o[col('환수년')])).length;
  const amt = back.reduce((a, o) => a + N(o[col('환수금액')]), 0);
  if (back.length) {
    console.log(`\n   환수 ${back.length}줄 · 되돌릴 돈 ${won(amt)}${noMonth ? ` · 그중 ${noMonth}줄은 환수월이 비어 있다(주황 칸 — 사람이 채운다)` : ''}`);
  }
}
if (gap.length) {
  console.log(`
  ⚠ 인도월과 청구월이 다른 줄 ${gap.length}건 — 원본이 그렇게 적혀 있다. 고치지 않는다.`);
  for (const o of gap.slice(0, 6)) console.log(`     ${o[iPlateOut].padEnd(10)} 인도 ${o[OUT.indexOf('인도일')].padEnd(11)} → 청구월 ${key(o)}  ${o[OUT.indexOf('고객명')]}`);
  if (gap.length > 6) console.log(`     … 외 ${gap.length - 6}줄`);
}
if (bad.length) { console.log(`\n  ⛔ 짝이 어긋난다 ${bad.length}건 — 청구가 나갔는데 접수·취소에도 있다`); for (const b of bad.slice(0, 10)) console.log(`     ${b}`); }
else console.log('\n   ✓ 검산 — 청구 줄 가운데 접수·취소에 겹치는 것 없다');

writeFileSync('tmp/settlement-billing.json', JSON.stringify({ rows: out.length, refund, skipped, kept, computed, months, bad, gap: gap.length }, null, 2));
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다.\n'); process.exit(0); }
if (bad.length) { console.log('\n⛔ 짝이 어긋난 채로는 안 쓴다.\n'); process.exit(1); }

// ── 쓴다 — **월별 탭으로 나눈다** ──────────────────────────────────
/**
 * ★**청구는 월별 탭이다**(사장님 2026-08-25 「청구는 월별로 탭으로 관리하자 ·
 *   26년08월 이렇게 해서 탭으로 쭉쭉 옆으로 · 실적은 그냥 한줄 한줄 쌓아도 되지만」).
 *   실적은 계속 쌓는 표라 한 장이 맞지만, 청구는 **그 달에 끊고 닫는 일**이라 달마다 장이 따로다.
 *   7월에 청구한 것과 8월에 청구할 것이 탭으로 갈려야 «무엇이 아직 안 나갔나»가 보인다.
 * ★탭 이름은 `26년08월`. 옆으로 쭉 붙어서 시간이 왼쪽에서 오른쪽으로 흐른다.
 */
const tabOf = (k: string) => `${k.slice(2, 4)}년${k.slice(5, 7)}월`;
const meta = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`);
const byMonth = new Map<string, string[][]>();
for (const o of out) {
  const k = key(o);
  if (!k || (MONTH_ARG && k !== MONTH_ARG)) continue;
  const a = byMonth.get(k) || [];
  a.push(o);
  byMonth.set(k, a);
}
let wroteTabs = 0;
for (const [mk, outM] of [...byMonth].sort()) {
  const MTAB = tabOf(mk);
    // ★찾는 것도 월별 탭 이름이어야 한다 — 옛 「청구」를 찾으면 있는 걸로 알고 안 만든다.
  let gid = ((await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`)).sheets || []).find((x: any) => S(x.properties.title) === MTAB)?.properties?.sheetId;
  if (gid === undefined) {
    const made = await api(`${SH}/${LEDGER}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: MTAB, gridProperties: { rowCount: outM.length + BLANK + 10, columnCount: OUT.length, frozenRowCount: 1 } } } }] }),
    });
    gid = made.replies[0].addSheet.properties.sheetId;
  }
  await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(MTAB)}!A1:BZ3000`)}:clear`, { method: 'POST', body: '{}' });
  // ★합친 칸을 먼저 푼다. 안 그러면 다음 번 머리글이 합쳐진 채로 덮인다.
  await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ unmergeCells: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1 } } }] }) });
  await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(MTAB)}!A1`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    // ★월별 탭에는 그 달 줄만 쓴다. `out` 전체를 쓰면 8월 탭에도 9월·12월 줄이 섞인다.
    body: JSON.stringify({ values: [[MTAB, ABOUT], [...OUT], ...outM] }),
  });
  // ★월 칸은 RAW 로 — USER_ENTERED 는 "2026-08" 을 날짜로 바꿔 버린다. 값은 3행부터다.
  for (const c of [] as (typeof OUT)[number][]) {   // 연·월이 숫자 칸이 돼 RAW 손질이 필요 없다
    const i = col(c);
    if (i < 0 || !outM.length) continue;
    const cl = colA1(i);
    await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(MTAB)}!${cl}3:${cl}${outM.length + 2}`)}?valueInputOption=RAW`, {
      method: 'PUT', body: JSON.stringify({ values: outM.map((o) => [o[i]]) }),
    });
  }

  const FONT = 'Noto Sans KR';
  /**
   * ★**너비는 손으로 정한다. `autoResizeDimensions` 를 쓰면 안 된다.**
   *   1행 설명이 B열부터 병합돼 있어서, 자동 맞춤이 그 긴 글에 맞춰 **B열을 화면 절반까지 늘린다**
   *   (실측 2026-08-25 · 사장님 「이렇게 칸 벌어지는거좀 막고」).
   */
  const widthOf = (h: string) => (
    /년$/.test(h) ? 56 : /월$/.test(h) ? 46
    : /일$|만료$/.test(h) ? 80
    : /요율$/.test(h) ? 72
    : /금액$|액$|료$|보증금|차량가액|부가세|합계|우리몫|순액/.test(h) ? 98
    : /^환수$|^계약서$|^인도완료$|^계약취소$/.test(h) ? 62
    : /^비고$/.test(h) ? 170
    : /^차량번호$/.test(h) ? 90
    : /^계약기간$|^건수$/.test(h) ? 54
    : 86);
  /**
   * ★**조건부 서식은 걸기 전에 지운다.** `addConditionalFormatRule` 은 쌓이기만 한다 —
   *   실측 2026-08-25 접수 탭에 19개가 쌓여 죽은 규칙이 색을 칠하고 있었다.
   */
  {
    const got = await api(`${SH}/${LEDGER}?fields=sheets(properties(sheetId),conditionalFormats)`);
    const cnt = ((got.sheets || []) as any[]).find((x) => Number(x.properties?.sheetId) === Number(gid))?.conditionalFormats?.length || 0;
    if (cnt) {
      await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({
        requests: Array.from({ length: cnt }, (_, i) => ({ deleteConditionalFormatRule: { sheetId: Number(gid), index: cnt - 1 - i } })),
      }) });
      console.log(`   옛 조건부 서식 ${cnt}개 지움`);
    }
  }
  const money = (['보증금', '렌탈료', '차량가액', '청구액', '청구부가세', '청구합계', '지급액', '지급부가세', '지급합계', '우리몫'] as const).map(col);
  const rate = (['공급사요율', '영업자요율'] as const).map(col);
  /** ★연·월은 그냥 숫자다 — 옛 서식이 남아 「2,026」으로 보이던 것을 못 박는다. */
  const plain = (['청구년', '청구월', '계약기간'] as const).map(col).filter((i) => i >= 0);
  /** ★날짜는 `yy-mm-dd` — 실적 탭과 같은 규격이다. */
  const dates = (['접수일', '인도일', '분납만료'] as const).map(col).filter((i) => i >= 0);
  const claw = col(CLAW_BOX);
  const clawMonth = col('환수월');
  const clawAmount = col('환수금액');
  const net = col('순액');
  const last = Math.max(outM.length + 2, 3);
  const band = (c0: number, c1: number, r: number, g: number, b: number) => ({
    repeatCell: { range: { sheetId: Number(gid), startRowIndex: 1, endRowIndex: 2, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: { backgroundColor: { red: r, green: g, blue: b } } }, fields: 'userEnteredFormat.backgroundColor' },
  });
  await api(`${SH}/${LEDGER}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        { repeatCell: { range: { sheetId: Number(gid) }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat(fontFamily,fontSize)' } },
        // ★탭 색깔 — 남색. 돈을 다루는 탭이라 다른 넷과 갈라 놓는다.
        { updateSheetProperties: { properties: { sheetId: Number(gid), gridProperties: { frozenRowCount: 2, frozenColumnCount: 1 }, tabColor: { red: 0.35, green: 0.25, blue: 0.7 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount),tabColor' } },
        // 1행 — 설명. A1 은 탭 이름, B1 부터 합친다.
        { mergeCells: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: OUT.length }, mergeType: 'MERGE_ROWS' } },
        { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, foregroundColor: { red: 0.25, green: 0.29, blue: 0.35 } }, backgroundColor: { red: 0.97, green: 0.98, blue: 1 }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment,wrapStrategy)' } },
        { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 11, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
        { updateDimensionProperties: { range: { sheetId: Number(gid), dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 62 }, fields: 'pixelSize' } },
        // 2행 — 머리글
        { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 1, endRowIndex: 2 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 0.99 }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)' } },
        // 머리글에 띠를 둘러 «받을 돈 / 줄 돈 / 우리 몫»을 눈으로 가른다
        band(col('공급사요율'), col('청구합계') + 1, 0.9, 0.96, 0.9),
        band(col('영업자요율'), col('지급합계') + 1, 1, 0.95, 0.88),
        band(col('우리몫'), col('우리몫') + 1, 0.99, 0.92, 0.96),
        ...(claw >= 0 && net >= claw ? [band(claw, net + 1, 1, 0.9, 0.88)] : []),
        // ★환수 셋은 사람 칸 — 연노랑으로 «여기만 적으세요»를 말한다.
        ...(claw >= 0 && clawAmount >= claw ? [{ repeatCell: { range: { sheetId: Number(gid), startRowIndex: 2, endRowIndex: last, startColumnIndex: claw, endColumnIndex: clawAmount + 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.98, blue: 0.88 } } }, fields: 'userEnteredFormat.backgroundColor' } }] : []),
        { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 2, endRowIndex: last, startColumnIndex: col('비고'), endColumnIndex: col('비고') + 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.98, blue: 0.88 } } }, fields: 'userEnteredFormat.backgroundColor' } },
        // 환수 — 체크박스
        ...(claw >= 0 ? [{ setDataValidation: { range: { sheetId: Number(gid), startRowIndex: 2, endRowIndex: last, startColumnIndex: claw, endColumnIndex: claw + 1 }, rule: { condition: { type: 'BOOLEAN' }, showCustomUi: true } } }] : []),
        ...money.map((c) => ({
          repeatCell: { range: { sheetId: Number(gid), startRowIndex: 2, startColumnIndex: c, endColumnIndex: c + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0;[Red]-#,##0;""' }, horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' },
        })),
        ...dates.map((c) => ({
          repeatCell: { range: { sheetId: Number(gid), startRowIndex: 2, startColumnIndex: c, endColumnIndex: c + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yy-mm-dd' }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' },
        })),
        ...plain.map((c) => ({
          repeatCell: { range: { sheetId: Number(gid), startRowIndex: 2, startColumnIndex: c, endColumnIndex: c + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0;;""' }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' },
        })),
        ...rate.map((c) => ({
          repeatCell: { range: { sheetId: Number(gid), startRowIndex: 2, startColumnIndex: c, endColumnIndex: c + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.00%' }, horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' },
        })),
        /**
         * ★줄 색 — 환수 체크된 줄은 붉다. 그중 **환수월이 비면 그 칸만 주황**으로 더 짚는다.
         *   주황이 먼저 걸려야 붉은색에 안 덮인다(구글은 먼저 걸린 규칙이 이긴다).
         */
        ...(claw >= 0 && clawMonth >= 0 ? [{ addConditionalFormatRule: { rule: {
          ranges: [{ sheetId: Number(gid), startRowIndex: 2, endRowIndex: last, startColumnIndex: col('환수월'), endColumnIndex: col('환수월') + 1 }],
          booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=AND($${colA1(col(CLAW_BOX))}3=TRUE,$${colA1(col('환수월'))}3="")` }] }, format: { backgroundColor: { red: 1, green: 0.85, blue: 0.6 } } },
        }, index: 0 } }] : []),
        ...(claw >= 0 ? [{ addConditionalFormatRule: { rule: {
          ranges: [{ sheetId: Number(gid), startRowIndex: 2, endRowIndex: last, startColumnIndex: 0, endColumnIndex: OUT.length }],
          booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=$${colA1(col(CLAW_BOX))}3=TRUE` }] }, format: { backgroundColor: { red: 0.99, green: 0.9, blue: 0.9 } } },
        }, index: 1 } }] : []),
        { setBasicFilter: { filter: { range: { sheetId: Number(gid), startRowIndex: 1, startColumnIndex: 0, endColumnIndex: OUT.length } } } },
        /**
         * ★달이 바뀌는 줄 위에 굵은 선 — 월 덩어리가 눈으로 갈린다.
         *   줄을 더 만들지 않는다(가짜 소계 줄은 필터·합계를 흐린다). 소계는 「청구요약」에 있다.
         */
        ...outM.flatMap((o, i) => (i > 0 && key(o) !== key(outM[i - 1])
          ? [{ updateBorders: { range: { sheetId: Number(gid), startRowIndex: i + 2, endRowIndex: i + 3, startColumnIndex: 0, endColumnIndex: OUT.length }, top: { style: 'SOLID_MEDIUM', color: { red: 0.35, green: 0.4, blue: 0.5 } } } }]
          : [])),
        ...OUT.map((h, i) => ({ updateDimensionProperties: {
          range: { sheetId: Number(gid), dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
          properties: { pixelSize: widthOf(h) }, fields: 'pixelSize',
        } })),
      ],
    }),
  });
  /**
   * ★**사람 칸만 열고 나머지는 잠근다.** 청구액·지급액은 기계가 산식으로 낸 값이라
   *   손으로 고치면 다음 실행에 덮인다 — 고쳐 봐야 헛일이니 아예 못 고치게 한다.
   *   ⚠ 옛 잠금을 먼저 지운다. 안 그러면 돌릴 때마다 겹쳐 쌓인다.
   */
  {
    const cur0 = await api(`${SH}/${LEDGER}?fields=sheets(protectedRanges(protectedRangeId,range(sheetId)))`);
    const old = ((cur0.sheets || []) as any[]).flatMap((x) => x.protectedRanges || [])
      .filter((r: any) => Number(r.range?.sheetId) === Number(gid)).map((r: any) => Number(r.protectedRangeId));
    const cols = HUMAN.map((h) => col(h as (typeof OUT)[number])).filter((i) => i >= 0).sort((a, b) => a - b);
    const runs: [number, number][] = [];
    for (const i of cols) { const lastRun = runs[runs.length - 1]; if (lastRun && lastRun[1] === i) lastRun[1] = i + 1; else runs.push([i, i + 1]); }
    await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
      ...old.map((id) => ({ deleteProtectedRange: { protectedRangeId: id } })),
      { addProtectedRange: { protectedRange: {
        range: { sheetId: Number(gid) },
        description: '기계가 채우는 칸 — 사람은 환수·환수월·환수금액·비고만 적습니다',
        warningOnly: false,
        editors: { users: ['pyh@teamjpk.com', 'kjs@teamjpk.com'] },
        unprotectedRanges: runs.map(([a, b]) => ({ sheetId: Number(gid), startRowIndex: 2, endRowIndex: last, startColumnIndex: a, endColumnIndex: b })),
      } } },
    ] }) });
  }

  console.log(`   ✓ ${MTAB} ${outM.length}줄`);
  wroteTabs++;
}
/** ★옛 한 장짜리 「청구」 탭은 지운다 — 두 벌이 되면 어느 쪽이 맞는지 알 수 없다. */
{
  const after = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`);
  const old1 = !MONTH_ARG && ((after.sheets || []) as any[]).map((x) => x.properties).find((x: any) => S(x.title) === TAB);
  if (old1) { await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: old1.sheetId } }] }) }); console.log(`   ✓ 옛 「${TAB}」 탭 지움`); }
}
console.log(`   ✓ 월별 탭 ${wroteTabs}개 · 사람 칸 ${HUMAN.join('·')} (환수는 실적 탭에서 적습니다)`);

const LOG = 'docs/수정이력-정산원장.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const h0 = existsSync(LOG) ? readFileSync(LOG, 'utf8') : '# 수정이력 — 정산원장\n\n> 기계가 정산원장 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n';
const entry = `\n## ${when} · 「${TAB}」 탭 — ${out.length}줄 (청구 ${out.length - refund} · 환수 ${refund})\n\n도구 \`scripts/build-settlement-billing.mts --apply\`\n청구월로 쌓는 장부. **${FROM} 부터**만 담는다 — 그 전 ${skipped}줄은 이미 청구가 끝났고 완납실적에 그대로 있다.\n금액은 **판매수수료(공급사에 청구) · 출고수수료(영업자에 지급) · 그 차액(우리 몫)**이고,\n계산서를 실제로 끊은 줄은 원장 값을 그대로 쓴다(${kept}줄), 나머지는 요율로 계산한다(${computed}줄).\n환수는 마이너스 한 줄로 같이 쌓는다. **환수 줄의 청구월은 비어 있고 주황으로 짚어 준다** — 사람이 환수월을 채운다.\n검산: 청구 줄 가운데 접수·취소에 겹치는 것 ${bad.length}건.\n`;
const marker = '> 기계가 정산원장 구조를';
const cut = h0.indexOf(marker);
const insertAt = cut >= 0 ? h0.indexOf('\n', cut) + 1 : h0.length;
writeFileSync(LOG, h0.slice(0, insertAt) + entry + h0.slice(insertAt));

console.log(`\n■ 끝\n   https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
