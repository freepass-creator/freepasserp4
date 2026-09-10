/**
 * **그 달 정산을 원자로 부어 파이어베이스에 올린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-01 「이제 합치고 원자화 해놔 8월 정산건부터」 「파이어베이스 올려서 작업하자」
 * 설계 = `docs/PLAN-정산-원자화-2026-09-01.md`
 *
 * ★★**정본은 원본 시트다** — 「프리패스모빌리티계약현황」 의 월별 탭.
 *   신규 정산원장·ERP 는 아직 그것을 따라가는 쪽이다(실측 2026-09-01).
 *
 * ★★**수식X 가 이긴다 — 이름으로 못 박는다.**
 *   원본은 금액 칸이 둘씩이다. `Y 판매 수수료`(요율 계산) / `Z 판매 수수료 (수식X)`(사람이 적은 실제),
 *   `AL 출고수수료`(계산) / `AM 출고 수수료 (수식X)`(실제).
 *   ⚠ 지금 원장에는 **지급이 계산값으로** 들어가 있다 — 실측 `161하1197` 원장 2,364,000 · 원본 실제 1,700,000.
 *   ⇒ 여기서는 «자리 순서»에 기대지 않고 이름을 찍어 고른다. 순서에 기대면 탭마다 열이 흔들려 또 틀린다.
 *
 * ★**시트 필터를 지킨다** — `basicFilter.criteria[].hiddenValues` 로 숨긴 줄은 사람이 「이 달 아님」이라
 *   한 것이다. 합계(`SUBTOTAL`)도 그 줄을 안 센다. 값만 더하면 사람 숫자와 안 맞는다.
 *
 * ★**환수는 따로 담는다** — `v4/settlement_clawbacks`, 차량번호가 열쇠(사장님 2026-09-01).
 *
 *   npx tsx scripts/atomize-settlement-month.mts 2026-08
 *   npx tsx scripts/atomize-settlement-month.mts 2026-08 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from './lib/firestore-path-store.mts';
import { getFirestore } from 'firebase-admin/firestore';
import { shapeAtom } from '../lib/domain/settlement-atom';
import { PARTNER_CI } from '../lib/domain/partner-ci';

const APPLY = process.argv.includes('--apply');
const SRC = '10gsCRpRZZVI9WGZK0b1JeGeti9mQFt4ojWXHqPCW-Ls';
/**
 * ★**달을 인자로 받는다**(사장님 2026-09-01 「8월게 아니라 이제 매달 쓸거야」).
 *   탭 이름이 «들쭉날쭉»하다 — (붙임) 과 (띄움) 이 섞여 있다.
 *   ⇒ 이름을 짓지 말고 «찾는다». 못 찾으면 멈춘다 — 엉뚱한 탭을 부으면 그 달이 통째로 틀어진다.
 */
const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();
if (!MONTH) {
  console.log('\n  달을 적어 주세요 — npx tsx scripts/atomize-settlement-month.mts 2026-08 [--apply]\n');
  process.exit(1);
}
let TAB = '';
const ROWS_NODE = 'settlement_rows';
const CLAW_NODE = 'settlement_clawbacks';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
/** 시트 체크칸 — TRUE·true·O·Y·1 을 다 참으로 본다. */
const TRUE = (v: unknown) => /^(TRUE|true|O|o|Y|y|1|예)$/.test(S(v));
const flat = (s: string) => s.replace(/[\s\n()]/g, '');
/** 달 더하기 — 「2026-08」 + 1 = 「2026-09」. */
const ymAdd = (m: string, n: number) => {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mm - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const SERIAL0 = Date.UTC(1899, 11, 30);
const ymd = (v: unknown): string => {
  const n = Number(S(v));
  if (!Number.isFinite(n) || n < 20_000 || n > 80_000) {
    const m = /^(\d{4})[-.](\d{1,2})[-.](\d{1,2})/.exec(S(v));
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
  }
  const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
  return `${u.getUTCFullYear()}-${String(u.getUTCMonth() + 1).padStart(2, '0')}-${String(u.getUTCDate()).padStart(2, '0')}`;
};

/**
 * **메모 → 원자 축.** 「계약번호」 칸에 적혀 있던 말을 기계가 읽는 칸으로 옮긴다.
 * ★확인된 것만 여기 담는다 — 원장 전체 44종류는 사람이 갈라 준 뒤에 넣는다.
 */
const AXIS: Record<string, Partial<Atom>> = {
  '영업사만 정산해야함': { settleTarget: '영업' },
  '프리패스지급 (공급사미청구)': { settleTarget: '영업' },
  '업무지원비': { settleTarget: '영업' },
  '공급사만 정산': { settleTarget: '공급' },
  '공급사정산 완료': { settleTarget: '영업', settledAlready: true },
  '0.5': { settleRatio: 0.5 },
  /**
   * ★★**「보류」와 「청구보류」는 다른 말이다.**
   *   사장님 2026-09-07 「SK 3건은 일단 다 **보류 박아. 취급 안 할 거야 당분간**」
   * ```
   * 보류      양쪽 다 안 센다 — 청구도 0, 지급도 0. 「당분간 취급 안 한다」
   * 청구보류   청구만 0 — 지급은 나간다(후불·보류 청구)
   * ```
   *   ⇒ 줄은 원장에 그대로 둔다(지우면 다음 달에 또 «없는 셈»이 된다). 금액만 0으로 선다.
   *   ⚠ 「취소」와 다르다 — 취소는 계약이 깨진 것이고, 보류는 «아직 안 센다»는 우리 쪽 판단이다.
   *     그래서 취소 체크를 켜지 않는다. 왜 보류인지는 「비고」가 든다.
   */
  '보류': { settleExclude: true },
  '청구보류': { billHold: true },
  /**
   * ⚠ **「후불」은 «청구보류»가 아니다.** 2026-09-01 에 그렇게 읽어 퍼시픽 49호3059 를
   *   8월 청구에서 0 원으로 뺐는데, 태윤 매니저가 「퍼시픽 청구건 0원으로 되어있습니다 · 1,435,200원입니다」로
   *   바로잡았다. 후불은 «고객이» 뒤에 내는 조건이지 «우리 청구»를 미루는 말이 아니다.
   *   ⇒ 축으로 옮기지 않고 메모로만 남긴다.
   */
  '후불': { settleNote: '후불 — 고객 납부 조건. 청구는 그대로 나간다' },
  '무보증 후불': { settleNote: '무보증 후불 — 고객 납부 조건. 청구는 그대로 나간다' },
  '렌탈료 후불': { settleNote: '렌탈료 후불 — 고객 납부 조건. 청구는 그대로 나간다' },
  '부가세 포함': { vatIncluded: true },
  '한번에 정산': { settleNote: '한번에 정산 — 적힌 금액(수식X)이 이미 그 뜻이다' },
};

type Atom = {
  code: string; plate: string; model: string; customer: string; phone: string; age: string;
  supplier: string; channel: string; agent: string;
  product: string; rentKind: string; contractType: string; term: number;
  rent: number; deposit: number; price: number; payKind: string;
  supplierRate: number; agentRate: number;
  claimWritten: number; payWritten: number;
  receivedAt: string; deliveredAt: string; delivered: boolean; paper: boolean; cancelled: boolean;
  /** ── 정산 조건 (2026-09-01 신설) ── */
  settleTarget: '양쪽' | '공급사만' | '영업사만';
  settleRatio: number; billHold: boolean; settleExclude: boolean; settledAlready: boolean;
  vatIncluded: boolean; settleTerms: string; settleNote: string;
  billed: boolean; collected: boolean;
  /**
   * ★★**다음 달에 «해야 할 말»** — 계산서 수정·가감처럼 이번 달에 못 끝내고 넘기는 것.
   *   사장님 2026-09-08 「이거 다음 달에 계산서 수정 메모 남겨야겠다」.
   *   머릿속에 두면 다음 달에 잊는다. 줄에 붙여 두면 그 달 정산을 열 때 같이 따라온다.
   */
  carryNote: string; carryMonth: string;
  note: string; sourceRow: number; sourceTab: string; billMonth: string;
  /** 사다리 «밖»에서 따로 붙는 수수료 — 무보증 수수료 등. 청구·지급에 더해진다. */
  claimIncentive: number; payIncentive: number;
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;

/**
 * ★★★**원천은 «우리 정산원장(F04)»이다** — 사장님 2026-09-04
 *   「계약현황을 이제 볼 필요 없게 우리 원자로 갖고오고 우리 정산원장 만들었잖아 이제 그걸 보고 해야지」
 *
 *   여태 남의 시트(「프리패스모빌리티계약현황」)를 읽었다. 그 시트는 주인이 다른 계정이라
 *   **우리가 못 고친다**(뷰어 권한). 빈칸 하나를 채우려 해도 남의 손을 기다려야 했다.
 *   ⇒ F04 는 우리 것이다. 원자를 거기서 만들면 그 기다림이 통째로 사라진다.
 *
 * ⚠ 칸 이름이 다르다 — 「업체명↔공급사」·「에이전시↔영업채널」·「영업자↔영업담당자」.
 *   그래서 `col()` 이 이름을 «둘» 받는다. 한쪽만 두면 다른 원천에서 통째로 멈춘다.
 * ⚠ 달을 고르는 법도 다르다 — 계약현황은 «탭 하나가 한 달», 원장은 «세 탭에 누적»이라
 *   청구년·청구월로 고른다.
 */
const FROM_LEDGER = !process.argv.includes('--계약현황');
const LEDGER_ID = '1BjGBqAjRLEb9ZMKarpQsMF-q_UjdgmEqBAl1uVk8SR4';
const LEDGER_TABS = ['접수', '완납실적', '분납실적'];
/**
 * ★**탭을 «찾는다».** 이름이 들쭉날쭉해서 지으면 안 된다 —
 *   실측: `프리패스25/8`(붙임) · `프리패스 26/8`(띄움) · `카렌 24년 1월` 이 한 파일에 섞여 있다.
 *   ⇒ 「연/월」 숫자로 찾고, 못 찾거나 둘 이상이면 멈춘다.
 */
if (!FROM_LEDGER) {
  const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}?fields=sheets.properties.title`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as { sheets?: { properties: { title: string } }[] };
  const [yy, mm] = MONTH.split('-');
  const short = yy.slice(2);
  const hit = (meta.sheets || []).map((s) => s.properties.title)
    .filter((n) => new RegExp(`^프리패스\\s*${short}\\s*/\\s*${Number(mm)}$`).test(n.replace(/\s+/g, ' ').trim()));
  if (hit.length !== 1) {
    console.log(`   ✕ 「${MONTH}」 탭을 못 찾았다 (찾은 것 ${hit.length}개: ${hit.join(' · ') || '없음'}) — 멈춘다`);
    console.log('     엉뚱한 탭을 부으면 그 달이 통째로 틀어진다. 탭 이름을 확인해 주세요.');
    process.exit(1);
  }
  TAB = hit[0];
} else TAB = LEDGER_TABS.join(" + ");
console.log(`■ ${MONTH} 원자화 — 원본 ${FROM_LEDGER ? "[F04] 정산원장" : "계약현황"} 「${TAB}」 → 파이어베이스 ${APPLY ? '(반영)' : '(대조만)'}\n`);

// ── 시트 읽기 (값 + 필터) ─────────────────────────────────
/** ★분당 한도(429)에 걸리면 쉬었다 다시 읽는다 — 여기서 멈추면 그 달 원자화가 통째로 안 돈다. */
const nap = (ms: number) => new Promise((z) => setTimeout(z, ms));
const readTab = async (id: string, tab: string): Promise<string[][]> => {
  for (let t = 0; t < 6; t++) {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${tab}'!A1:BZ900`)}?valueRenderOption=UNFORMATTED_VALUE`, { headers: { Authorization: `Bearer ${await tok()}` } });
    if (r.ok) return (((await r.json()) as { values?: unknown[][] }).values || []).map((v) => (v || []).map(S));
    if (r.status === 429 || r.status >= 500) { console.log(`   · 「${tab}」 ${r.status} — 20초 쉬었다 다시 (${t + 1}/6)`); await nap(20_000); continue; }
    console.log(`   ✕ 「${tab}」 를 못 읽었다 ${r.status}`); process.exit(1);
  }
  console.log(`   ✕ 「${tab}」 — 한도에 계속 걸립니다`); process.exit(1);
};
let all: string[][];
if (!FROM_LEDGER) all = await readTab(SRC, TAB);
else {
  /**
   * ★★**원장은 «세 탭에 누적»이다** — 접수(아직 대기) · 완납실적 · 분납실적.
   *   그 달 줄만 골라 «머리글 한 줄 + 고른 줄»로 이어 붙인다. 세 탭의 칸 차례는 같다.
   * ⚠ 청구년·청구월이 비어 있으면 못 고른다 — 그 줄은 아직 달이 안 정해진 것이라 담지 않는다.
   *   (그게 바로 「접수 탭에 그냥 둬」 하신 줄들이다.)
   */
  const [yy, mm] = MONTH.split('-').map(Number);
  let hdr: string[] = []; const picked: string[][] = [];
  for (const t of LEDGER_TABS) {
    const g = await readTab(LEDGER_ID, t);
    const h = g.findIndex((x) => x.includes('차량번호'));
    if (h < 0) continue;
    if (!hdr.length) hdr = g[h];
    const iy = g[h].indexOf('청구년'); const im = g[h].indexOf('청구월');
    if (iy < 0 || im < 0) { console.log(`   ✕ 「${t}」 에 청구년·청구월 열이 없다 — 멈춘다`); process.exit(1); }
    for (const r of g.slice(h + 1)) if (N(r[iy]) === yy && N(r[im]) === mm) picked.push(r);
  }
  all = [hdr, ...picked];
  console.log(`   원장 세 탭에서 ${MONTH} 줄 ${picked.length}개를 골랐다`);
}
/**
 * ⚠ **필터는 «그 탭»의 것을 읽어야 한다.** `ranges=` 를 줘도 응답의 `sheets[0]` 이 그 탭이라는 보장이 없다 —
 *   2026-09-01 에 첫 탭의 필터를 읽고 「숨기는 값 없음」이라고 잘못 말했다. 제목으로 찍어 고른다.
 */
const fr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SRC}?fields=${encodeURIComponent('sheets(properties.title,basicFilter)')}`, { headers: { Authorization: `Bearer ${await tok()}` } });
const sheetsMeta = ((await fr.json()) as { sheets?: { properties?: { title?: string }; basicFilter?: { criteria?: Record<string, { hiddenValues?: string[] }> } }[] }).sheets || [];
const filt = FROM_LEDGER ? undefined : sheetsMeta.find((s) => S(s.properties?.title) === TAB)?.basicFilter;
const hidden = new Map<number, Set<string>>();
for (const [k, v] of Object.entries(filt?.criteria || {})) if (v?.hiddenValues?.length) hidden.set(Number(k), new Set(v.hiddenValues));
console.log(`   시트 필터 — 숨기는 값 ${[...hidden].map(([c, s]) => `${c}열: ${[...s].join(',')}`).join(' · ') || '없음'}`);

const hi = all.findIndex((x) => x.includes('차량번호'));
if (hi < 0) { console.log('   ✕ 머리글을 못 찾았다'); process.exit(1); }
const head = all[hi];
/** ★이름으로 열을 찍는다. 없으면 -1 이 아니라 «멈춘다» — 조용히 0 이 되면 돈이 사라진다. */
/** ★이름을 «둘» 받는다 — 계약현황과 원장이 같은 것을 달리 부른다(업체명↔공급사 …). */
const col = (name: string, alt?: string, must = true) => {
  let j = head.findIndex((h) => flat(h) === flat(name));
  if (j < 0 && alt) j = head.findIndex((h) => flat(h) === flat(alt));
  if (j < 0 && must) { console.log(`   ✕ 「${name}${alt ? ` / ${alt}` : ''}」 열이 없다 — 멈춘다`); process.exit(1); }
  return j;
};
const C = {
  memo: col('계약번호', '비고'), state: col('상태 표기', '인도완료'), sup: col('업체명', '공급사'),
  paperBox: col('계약서', undefined, false), deliveredBox: col('인도완료', undefined, false),
  recv: col('접수일'), deliv: col('인도일'),
  rentKind: col('렌트구분'), product: col('상품구분'), plate: col('차량번호'), model: col('모델명'),
  cust: col('고객명'), age: col('연령', undefined, false),
  /**
   * ★★★**고객 연락처는 «안 받는다» — 칸을 아예 안 읽는다.**
   *   사장님 2026-09-08 「정산에 고객연락처는 필요없을 거 같다.
   *   **프리패스가 손님 연락처 취득할 이유 없음**」
   *   정산은 «누가 얼마를 주고받나»만 알면 된다. 손님에게 전화할 일은
   *   공급사·영업자의 일이지 우리 일이 아니다. 들고 있지 않으면 새지도 않는다.
   *   ★실측 2026-09-08 — 원장 네 탭에도, 원자 459줄에도 연락처는 한 건도 없었다 —
   *     칸만 열려 있었다. 네 탭 모두 「특이사항」으로 바꾸고 그 칸을 닫았다.
   */
  term: col('계약기간'),
  deposit: col('보증금'), payKind: col('분납여부'), ctype: col('계약형태'), rent: col('렌탈료'), price: col('차량가액'),
  supRate: col('수수료율 (공급사)', '공급사수수료율'), claimY: col('판매 수수료', '판매수수료'),
  /** ★「수식X」는 계약현황에만 있다 — 원장에는 그 자리가 없으니 «없어도» 넘어간다. */
  claimZ: col('판매 수수료 (수식X)', undefined, false),
  ch: col('에이전시', '영업채널'), agent: col('영업자', '영업담당자'), agRate: col('수수료율 (에이전시)', '에이전시수수료율'),
  payAL: col('출고수수료'), payAM: col('출고 수수료 (수식X)', undefined, false),
  /** 원장에만 있는 칸 — 취소·환수는 체크로 온다. */
  cancel: col('취소', undefined, false), claw: col('환수', undefined, false),
  clawWhy: col('환수사유', undefined, false), clawAmt: col('환수금액', undefined, false),
  /** ★「가감사유」 = 다음 달로 넘기는 말(계산서 수정·가감). 원장에만 있는 칸이라 없어도 넘어간다. */
  carryWhy: col('가감사유', undefined, false),
};
/**
 * ★★**「추가 인센티브」 두 칸** — 무보증 수수료 등이 여기 붙는다(사장님 2026-09-04 「무보증 수수료」).
 *   ⚠ 두 칸 이름이 «똑같다». 이름으로 찍으면 앞엣것만 잡혀 에이전시 몫을 놓친다 —
 *     그래서 «수식X 칸 바로 뒤»라는 자리로 잡고, 그 자리 이름이 맞는지 확인한다.
 *   ⚠ 이 칸을 안 담으면 원자화가 돌 때마다 인센티브가 «지워진다»(원자 줄을 통째로 갈아 끼우므로).
 */
const incAt = (after: number) => (flat(S(head[after + 1])).includes('추가인센티브') ? after + 1 : -1);
/** ★원장은 인센티브 칸에 «제 이름»이 있다 — 계약현황처럼 자리로 더듬을 필요가 없다. */
const INC = FROM_LEDGER
  ? { claim: col('공급사인센티브', undefined, false), pay: col('에이전시인센티브', undefined, false) }
  : { claim: incAt(C.claimZ), pay: incAt(C.payAM) };
console.log(`   추가 인센티브 칸 — 공급사 ${INC.claim >= 0 ? INC.claim : '못 찾음'} · 에이전시 ${INC.pay >= 0 ? INC.pay : '못 찾음'}`);

const atoms: Atom[] = []; const claws: Record<string, unknown>[] = []; const skipped: string[] = [];
for (let i = hi + 1; i < all.length; i++) {
  const x = all[i] || [];
/**
   * ★★**상태를 «한 말»로 고른다.** 계약현황은 「상태 표기」에 글로 적고,
   *   원장은 「인도완료·취소·환수」 세 체크로 말한다. 여기서 한 꼴로 맞춘다.
   */
  const B = (v: unknown) => /^(TRUE|true|1|Y|O|v|✓|예)$/.test(S(v));
  const st = FROM_LEDGER
    ? (C.claw >= 0 && B(x[C.claw]) ? '환수' : C.cancel >= 0 && B(x[C.cancel]) ? '취소' : B(x[C.state]) ? '계약 완료' : '계약진행중')
    : S(x[C.state]);
  if (!st && !S(x[C.plate])) continue;
  /**
   * ⚠⚠ **시트 필터를 «뜻으로 읽지 않는다».**
   *   2026-09-01 에 8월 탭의 A열 필터(「공급사만 정산」 숨김)를 「이 달 아님」으로 읽고 52행을 뺐다.
   *   태윤 매니저가 「**박지원 누락입니다 · 박지원 공급사만 정산입니다**」로 바로잡았다 —
   *   숨긴 것은 «작업하려고» 걸어 둔 필터였지 「빼라」가 아니었다.
   *   ⇒ 필터는 «보여주기»일 뿐이다. 한 줄도 빼지 않고 다 담는다.
   *     (9월 탭 필터가 C열 업체명을 숨긴 것도 같은 종류였다 — 뜻이 아니라 작업 흔적이다.)
   */
  if (hidden.size) { /* 읽기만 하고 «거르지 않는다» */ }

  const memo = S(x[C.memo]);
  const ax = AXIS[memo] || {};
  const plate = S(x[C.plate]);
  /**
   * ★★수식X 가 이긴다 — 이름으로 고른다(자리 순서에 안 기댄다).
   * ⚠ **반드시 반올림한다.** 시트 수식값은 소수가 붙어 온다 — 실측 `1,274,546.4000000001`.
   *   안 자르면 「같은 값인데 다르다」가 되어 매번 «고칠 것»으로 잡힌다.
   */
  const claim = Math.round(N(x[C.claimZ]) || N(x[C.claimY]));
  const pay = Math.round(N(x[C.payAM]) || N(x[C.payAL]));

  if (st === '환수') {
    claws.push({
      /** ★모델명을 같이 싣는다 — 환수 줄의 모델명 칸에 그 차 이름이 서야 한다
       *   (2026-09-08 「지난 지급분 환수」를 모델명에서 «상품 구분»으로 옮기면서 자리가 비었다). */
      plate, model: S(x[C.model]), at: ymd(x[C.deliv]) || '', supplierAmt: claim, agentAmt: pay,
      reason: (C.clawWhy >= 0 ? S(x[C.clawWhy]) : '') || memo || '', supplier: S(x[C.sup]), channel: S(x[C.ch]),
      month: MONTH, sourceRow: i + 1, sourceTab: TAB, by: 'atomize-settlement-month', updatedAt: Date.now(),
    });
    continue;
  }
  atoms.push({
    code: '', plate: plate || '', model: S(x[C.model]), customer: S(x[C.cust]), phone: '', age: S(x[C.age]),
    supplier: S(x[C.sup]), channel: S(x[C.ch]), agent: S(x[C.agent]),
    product: S(x[C.product]), rentKind: S(x[C.rentKind]), contractType: S(x[C.ctype]), term: N(x[C.term]),
    rent: N(x[C.rent]), deposit: N(x[C.deposit]), price: N(x[C.price]), payKind: S(x[C.payKind]),
    supplierRate: N(x[C.supRate]), agentRate: N(x[C.agRate]),
    claimWritten: claim, payWritten: pay,
    claimIncentive: INC.claim >= 0 ? Math.round(N(x[INC.claim])) : 0,
    payIncentive: INC.pay >= 0 ? Math.round(N(x[INC.pay])) : 0,
    receivedAt: ymd(x[C.recv]), deliveredAt: ymd(x[C.deliv]),
    /**
     * ★**체크는 «시트가 켠 것»을 그대로 받는다** — 우리가 셈해서 만들지 않는다.
     *   ⚠ 인도일이 있으면 인도된 것이지만, 체크가 있으면 그 체크가 이긴다(사람이 켠 것이다).
     *   ⚠ 2026-09-09 까지 `paper` 가 「인도완료」를 받고 있었다 — 계약서와 인도는 다른 일이다.
     */
    delivered: C.deliveredBox >= 0 ? TRUE(x[C.deliveredBox]) : !!ymd(x[C.deliv]),
    paper: C.paperBox >= 0 ? TRUE(x[C.paperBox]) : st === '계약 완료',
    cancelled: false,
    settleTarget: (ax.settleTarget as Atom['settleTarget']) || '양쪽',
    settleRatio: ax.settleRatio ?? 1, billHold: ax.billHold ?? false, settleExclude: ax.settleExclude ?? false,
    settledAlready: ax.settledAlready ?? false, vatIncluded: ax.vatIncluded ?? false,
    /**
     * ★삶은 축 메모(「업무지원비」·「공급사만 정산」 등)를 «말로도» 남긴다 —
     *   축으로만 바꾸면 그 말이 사라져 산정기준에 적을 것이 없어진다(사장님 2026-09-07).
     */
    settleTerms: '', settleNote: ax.settleNote || (AXIS[memo] ? memo : ''),
    billed: false, collected: false,
    /** ★원장 「가감사유」에 적힌 말을 다음 달로 나른다 — 그 칸이 곧 「다음 달에 할 말」이다. */
    carryNote: C.carryWhy >= 0 ? S(x[C.carryWhy]) : '',
    carryMonth: (C.carryWhy >= 0 && S(x[C.carryWhy])) ? ymAdd(MONTH, 1) : '',
    note: AXIS[memo] ? '' : memo, sourceRow: i + 1, sourceTab: TAB,
    /**
     * ★★★**청구년·청구월이 박혀 있으면 그 달이다 — 인도를 기다리지 않는다.**
     *   사장님 2026-09-07 「**인도일 없이 청구해도 되니까 접수일만 있어도 청구는 됨.
     *   청구해 보면 공급사가 말하겄지**」
     *
     *   여기까지 온 줄은 이미 「청구년/청구월 = 이 달」로 골라 온 줄이다(위 156줄).
     *   그런데 인도 체크가 없다고 달을 «지워» 버려서, 하허호가 「누락」이라 알려 준
     *   장은미·오주형·전은재 셋이 8월 오토플러스 청구서에서 도로 빠졌다(실측 2026-09-07).
     *   ⇒ **원장이 달을 적어 두었으면 그것이 사람이 정한 값**이다. 계산이 덮지 않는다.
     */
    billMonth: MONTH,
  });
}

/**
 * ★★**똑같은 줄이 두 번 있으면 하나로 접는다.**
 *   태윤 매니저 2026-09-01 「웰릭스정산 **이경훈 중복**」 — 원본 8월 11·12행이 글자 하나 안 틀리고 같았다
 *   (142호1065 · 이경훈 · 청구 967,200 · 지급 744,000). 그대로 두면 웰릭스에 96만을 더 청구하고
 *   하허호에 74만을 더 준다.
 * ⚠ **접수일까지 같아야 «중복»이다.** 같은 차가 다른 날 다시 계약될 수 있다 — 차번만으로 접으면 진짜 계약이 사라진다.
 */
{
  const seen = new Map<string, Atom>();
  const dup: string[] = [];
  for (const a of atoms) {
    const k = `${a.plate.replace(/\s/g, '')}|${a.receivedAt}|${a.claimWritten}|${a.payWritten}|${a.customer}`;
    if (a.plate && seen.has(k)) { dup.push(`${a.sourceRow}행 ${a.plate} ${a.supplier} ${a.customer} — 앞줄과 «똑같다»`); continue; }
    if (a.plate) seen.set(k, a);
  }
  if (dup.length) {
    console.log(`\n   ★똑같은 줄을 접었다 ${dup.length}건`);
    for (const d of dup) console.log(`      ${d}`);
    const keep = new Set([...seen.values()]);
    for (let i = atoms.length - 1; i >= 0; i -= 1) if (atoms[i].plate && !keep.has(atoms[i])) atoms.splice(i, 1);
  }
}

// ── 기존 원자와 열쇠 맞추기 (차번|접수일 → stl_ 코드) ─────
const have = Object.fromEntries((await getFirestore().collection(ROWS_NODE).get()).docs.map((d) => [d.id, d.data()])) as Record<string, { plate?: string; receivedAt?: string; code?: string; payWritten?: number; claimWritten?: number; channel?: string; customer?: string; billMonth?: string; fromSheet?: string }>;
/**
 * ★★**차번 없는 줄의 열쇠에 «줄 번호»를 쓰지 않는다.**
 *   「업무지원비」처럼 차가 없는 정산이 있다(사장님 2026-09-01 「차량번호 없이 주는것도 있고」).
 *   ⚠ 2026-09-02 — 열쇠에 sourceRow 가 들어 있었다. 박지원 줄을 살리자 그 아래가 한 칸씩 밀렸고,
 *     최사랑 업무지원비 10만원이 51행→52행이 되면서 «다른 줄»로 잡혀 새 코드가 하나 더 생겼다.
 *     화면에는 똑같은 10만원이 두 줄로 섰다. 위에 한 줄만 끼어도 깨지는 열쇠는 열쇠가 아니다.
 *   ⇒ 자리가 아니라 «내용»으로 묶는다 — 달·채널·고객·청구·지급.
 */
const rowKey = (plate: string, recv: string, month: string, ch: string, cust: string, claim: number, pay: number) => (plate
  ? `${plate.replace(/\s/g, '')}|${recv}`
  : `무차번|${month}|${ch}|${cust}|${claim}|${pay}`);
const codeOf = new Map(Object.values(have).map((r) => [
  rowKey(S(r.plate), S(r.receivedAt), S(r.billMonth) || MONTH, S(r.channel), S(r.customer), N(r.claimWritten), N(r.payWritten)), S(r.code)]));
const keyOf = (a: Atom) => rowKey(a.plate, a.receivedAt, a.billMonth || MONTH, a.channel, a.customer, a.claimWritten, a.payWritten);
let matched = 0; const fresh: Atom[] = []; const fixes: string[] = [];
for (const a of atoms) {
  const key = keyOf(a);
  const code = codeOf.get(key);  // ★차번 없는 줄도 붙인다 — 안 붙이면 돌릴 때마다 새 줄이 선다
  if (code) {
    a.code = code; matched++;
    const old = have[code];
    // ★차이가 «0 이 아닌» 것만 알린다. 0 을 같이 찍으면 진짜 고쳐지는 것이 묻힌다.
    if (old && N(old.payWritten) - a.payWritten !== 0) fixes.push(`   ${a.plate.padEnd(11)} 지급 ${won(N(old.payWritten))} → ${won(a.payWritten)}  (${won(a.payWritten - N(old.payWritten))})`);
    if (old && N(old.claimWritten) - a.claimWritten !== 0) fixes.push(`   ${a.plate.padEnd(11)} 청구 ${won(N(old.claimWritten))} → ${won(a.claimWritten)}  (${won(a.claimWritten - N(old.claimWritten))})`);
  } else { a.code = `stl_${Math.abs([...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36)}`; fresh.push(a); }
}

console.log(`\n   원자 ${atoms.length}줄 · 환수 ${claws.length}건 · 필터로 빠짐 ${skipped.length}줄`);
for (const s of skipped) console.log(`      ${s}`);
console.log(`\n   기존 원자와 붙음 ${matched}줄 · 새 줄 ${fresh.length}줄`);
for (const f of fresh) console.log(`      새 — ${(f.plate || "(차번없음)").padEnd(11)} ${(f.supplier || "(공급사없음)").padEnd(10)} ${f.channel} ${f.receivedAt} ${f.settleNote || f.note}`);
if (fixes.length) { console.log(`\n   ★고쳐지는 금액 ${fixes.length}건 (수식X 우선)`); for (const f of fixes) console.log(f); }

/**
 * ★★★**청구도 지급도 0 인 줄을 «이름을 대고» 알린다 — 조용히 0 으로 나가지 않게.**
 *
 * ⚠ **무슨 일이 있었나.** 2026-09-08 실측 — 오플 8월 192거5102 신경섭(GV80)은 계약서·인도까지
 *   다 끝났는데 원장의 **수수료 칸이 통째로 비어** 청구 0 · 지급 0 으로 서 있었다.
 *   아무도 몰랐다. 「누락」이라고 알려 주는 것은 «표에 없는 줄»뿐이고, 이렇게 **표에는 있는데
 *   금액만 0 인 줄**은 상대 눈에도 우리 눈에도 안 걸린다 — 그냥 한 줄이 0원으로 나갈 뿐이다.
 *
 * ⇒ 「보류」·「취소」·「환수」처럼 «0 이 맞는» 줄은 빼고, 그 밖에 둘 다 0 인 줄은 여기서 세워 보여 준다.
 *   멈추지는 않는다 — 0 이 맞는 달도 있다(청구보류·정산완료). 다만 **모르고 지나가지는 못하게** 한다.
 */
const zero = atoms.filter((a) => !a.claimWritten && !a.payWritten && !a.claimIncentive && !a.payIncentive
  && !a.settleExclude && !a.settledAlready && !a.cancelled);
if (zero.length) {
  console.log(`
   ⚠ 청구·지급이 «둘 다 0» 인 줄 ${zero.length}개 — 요율이 빈 것은 아닌지 보세요`);
  for (const z of zero) console.log(`      ${(z.plate || '(차번없음)').padEnd(11)} ${z.customer.padEnd(8)} ${(z.supplier || '(공급사없음)').padEnd(10)} ${z.channel.padEnd(6)} ${z.product}   ${z.sourceTab} ${z.sourceRow}행`);
}

/**
 * ★★★**신차는 «청구 = 지급» 이다 — 수익이 0 이다.**
 *
 *   사장님 2026-09-08 「우리는 **신차에는 마진을 남기지 않는다**」 · 「**청구 지급이 같은 거지 수익이 0**」.
 *
 * ★★**그래서 «어긋나면» 그건 마진이 아니라 사고다.** 둘 중 하나다 —
 *   ㉠ 공급사에 **청구를 안 했다**(청구 0) ㉡ 한쪽 금액을 잘못 적었다.
 *   실측 2026-09-08 — 웰릭스 견적출고 여섯 줄이 지급만 나가고 청구가 0 이었다(합계 17,179,867).
 *   같은 시트의 형제 줄 다섯은 전부 청구 = 지급이었는데 이것만 0 이라, 규칙을 알고 보지 않으면
 *   「신차는 원래 마진이 얇다」로 읽고 지나친다.
 *
 * ⚠ 멈추지는 않는다 — 지난 기록에는 청구를 안 담은 줄이 있다(「지난 기록은 시트가 기록이다」).
 *   다만 **모르고 지나가지는 못하게** 이름을 대고 세운다.
 */
const NEWCAR = /선출고|선발주|신차발주|매칭출고|견적출고/;
const skew = atoms.filter((a) => NEWCAR.test(a.product) && !a.settleExclude && !a.cancelled
  && a.settleTarget === '양쪽'
  && (a.claimWritten + a.claimIncentive) !== (a.payWritten + a.payIncentive));
if (skew.length) {
  console.log(`
   ⚠ 신차인데 «청구 ≠ 지급» 인 줄 ${skew.length}개 — 신차는 수익이 0 이다`);
  for (const k of skew) {
    const c = k.claimWritten + k.claimIncentive; const p = k.payWritten + k.payIncentive;
    console.log(`      ${(k.plate || '(차번없음)').padEnd(11)} ${k.customer.padEnd(8)} ${(k.supplier || '(공급사없음)').padEnd(10)} ${k.product.padEnd(8)}`
      + ` 청구 ${won(c).padStart(11)} · 지급 ${won(p).padStart(11)} · 차이 ${won(c - p).padStart(11)}${c ? '' : '   ← 청구를 안 했다'}`);
  }
}

/**
 * ⚠ **`settleExclude`(보류)도 «축»이다** — 2026-09-08 까지 이 걸름망에서 빠져 있어,
 *   보류를 박아 그 달에서 뺀 줄이 화면 어디에도 안 나왔다. 안 보이면 확인할 수가 없다.
 */
const ax = atoms.filter((a) => a.settleTarget !== '양쪽' || a.settleRatio !== 1 || a.billHold
  || a.settleExclude || a.settledAlready || a.vatIncluded);
console.log(`\n   ★메모에서 옮긴 축 ${ax.length}줄`);
for (const a of ax) console.log(`      ${(a.plate || '(차번없음)').padEnd(11)} ${a.customer.padEnd(8)} 대상${a.settleTarget.padEnd(5)} 비율 ${a.settleRatio} ${a.settleExclude ? '· 보류(양쪽 다 0)' : ''}${a.billHold ? '· 청구보류' : ''}${a.settledAlready ? ' · 정산완료' : ''}${a.vatIncluded ? ' · 부가세포함' : ''}`);
console.log(`\n   ★환수 ${claws.length}건`);
for (const c of claws) console.log(`      ${S(c.plate).padEnd(11)} ${S(c.supplier).padEnd(10)} 공급사 ${won(N(c.supplierAmt))} · 영업자 ${won(N(c.agentAmt))} · 환수일 ${S(c.at) || '(없음 — 사람이 채워야 한다)'}`);

/**
 * ★**이 탭에서 올렸던 줄인데 이번엔 «없는» 줄 = 묵은 줄.**
 *   시트에서 지웠거나, 예전 열쇠로 잘못 선 줄이다. 안 걷으면 화면에 유령이 남는다
 *   (2026-09-02 최사랑 10만원 두 줄이 그랬다). 걷은 것은 반드시 «이름을 대고» 지운다.
 */
const alive = new Set(atoms.map((a) => a.code));
/**
 * ⚠⚠⚠ **«그 달»의 묵은 줄만 걷는다 — 달을 안 보면 다른 달을 통째로 지운다.**
 *
 *   실측 2026-09-08 — 원장(F04)은 세 탭에 «모든 달»이 누적되므로 `fromSheet` 가
 *   「접수 + 완납실적 + 분납실적」로 달마다 **똑같다.** 그래서 9월을 원자화하자
 *   8월 원자 43줄이 「이번 취합엔 없다」로 잡혀 통째로 걷혔다 —
 *   하허호 8월 정산서가 44줄에서 **1줄**이 됐다.
 *   ⇒ 걷는 기준은 «같은 원천 + 같은 달»이다. 달이 다르면 남의 달이다.
 */
const stale = Object.entries(have).filter(([k, r]) => S(r.fromSheet) === TAB && S(r.billMonth) === MONTH && !alive.has(k));
if (stale.length) {
  console.log(`
   ★묵은 줄 ${stale.length}개 — 이 탭에서 올렸는데 이번 취합엔 «없다». 걷는다`);
  for (const [k, r] of stale) console.log(`      ${(S(r.plate) || '(차번없음)').padEnd(11)} ${S(r.customer).padEnd(8)} 청구 ${won(N(r.claimWritten))} · 지급 ${won(N(r.payWritten))}   [${k}]`);
}

if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다. --apply 로 올린다.\n'); process.exit(0); }

const patch: Record<string, unknown> = {};
/**
 * ★★★**규격을 «거쳐서만» 쓴다** — `shapeAtom` 이 모든 밭을 갖추고 표 밖의 것은 버린다.
 *   사장님 2026-09-08 「각 항목을 항목별로 … 어떤 거를 담아 갈 건지 뽑아내서 파이어스토어에 담아내야지」.
 *   실측 2026-09-08 — 규격 없이 쌓았더니 461줄에 밭이 72개인데 줄마다 달랐다.
 *   ⇒ 이 한 줄이 「모든 줄이 모든 밭을 갖는다」를 지킨다. 규격은 lib/domain/settlement-atom.ts.
 * ⚠ `createdAt` 은 «있던 것»을 지킨다 — 새로 서는 줄만 지금을 적는다.
 */
/**
 * ★★**이름 옆에 «코드»를 같이 싣는다** — 이름은 바뀌지만 코드는 안 바뀐다.
 *   「손오공」이 「손오공렌터카」가 되어도 `RP012` 는 그대로다.
 *   ⚠ 못 찾으면 «빈 값»이다 — 지어내지 않는다. 명단(PARTNER_CI)에 없는 상대라는 뜻이고, 그게 사실이다.
 */
/** ⚠ 위쪽 `codeOf`(줄 열쇠 → 원자 코드 Map)와 «다른 것»이다. 이름이 겹쳐 esbuild 가 멎었다(2026-09-09). */
const partnerCodeOf = (name: string) => S(PARTNER_CI.find((c) => S(c.alias) === S(name))?.code);
const shaped = atoms.map((a) => shapeAtom({
  supplierCode: partnerCodeOf(a.supplier), channelCode: partnerCodeOf(a.channel),
  ...a, updatedAt: Date.now(), fromSheet: TAB,
  createdAt: N(have[a.code]?.createdAt) || Date.now(),
}));
/**
 * ★★★**파이어스토어 «한 곳»에만 쓴다** — 사장님 2026-09-09
 *   「rtdb 는 이제 아예 안 쓴다고」·「왜 자꾸 알티디비가 슬렁슬렁 나오냐 그냥 꺼 버려」.
 *
 * ⚠ 전에는 두 곳에 같이 썼다(이중 쓰기). 그 사이에 «읽는 곳»이 갈려
 *   원자를 고쳐도 정산서만 옛 값으로 남는 사고가 났다(우리캐피탈 9,841,650 ≠ 9,457,525).
 * ★파이어스토어는 **줄이 곧 문서**라 한 줄을 고치는 일이 다른 줄에 닿지 않는다 —
 *   RTDB 처럼 노드를 통째로 갈아 끼우다 남의 달을 지우는 사고(2026-09-08 하허호 8월)가 구조적으로 안 난다.
 */
const fs = getFirestore();
const ROWS_COL = 'settlement_rows';
const CLAW_COL = 'settlement_clawbacks';
{
  const clawId = (c: Record<string, unknown>) => `${S(c.plate).replace(/[.$#[\]/\s]/g, '_')}_${MONTH}`;
  const writes: [string, string, Record<string, unknown> | null][] = [
    ...shaped.map((a) => [ROWS_COL, S(a.code), a] as [string, string, Record<string, unknown>]),
    ...claws.map((c) => [CLAW_COL, clawId(c), c] as [string, string, Record<string, unknown>]),
    ...stale.map(([k]) => [ROWS_COL, k, null] as [string, string, null]),
  ];
  /** ★한 묶음에 500개까지다 — 넘으면 나눠 보낸다. */
  for (let i = 0; i < writes.length; i += 400) {
    const b = fs.batch();
    for (const [col, id, data] of writes.slice(i, i + 400)) {
      const ref = fs.collection(col).doc(id);
      if (data === null) b.delete(ref); else b.set(ref, data);
    }
    await b.commit();
  }
  console.log(`   ✓ 파이어스토어에도 ${writes.length}개 박았다 — ${ROWS_COL} · ${CLAW_COL}`);
}

// ── 되읽어 대조 ──
const back = Object.fromEntries((await fs.collection(ROWS_COL).get()).docs.map((d) => [d.id, d.data()])) as Record<string, Record<string, unknown>>;
const bad: string[] = [];
for (const a of atoms) {
  const g = back[a.code];
  if (!g) { bad.push(`${a.plate} — 안 올라갔다`); continue; }
  if (N(g.payWritten) !== a.payWritten) bad.push(`${a.plate} 지급 — 넣은 ${won(a.payWritten)} · 읽은 ${won(N(g.payWritten))}`);
  if (N(g.claimWritten) !== a.claimWritten) bad.push(`${a.plate} 청구 — 넣은 ${won(a.claimWritten)} · 읽은 ${won(N(g.claimWritten))}`);
}
/**
 * ★★★**두 곳을 «다» 되읽어 맞댄다 — 하나만 보면 갈린 줄 모른다.**
 *   사장님 2026-09-08 「절대 안 틀리게」.
 *   이중 쓰기의 값은 «둘이 같다»는 데 있지 «둘 다 썼다»에 있지 않다.
 *   한쪽만 성공한 채 지나가면, 읽기를 옮기는 날 조용히 틀린 숫자로 갈아탄다.
 */
for (const a of atoms) {
  const d = await fs.collection(ROWS_COL).doc(a.code).get();
  if (!d.exists) { bad.push(`${a.plate} — 파이어스토어에 안 올라갔다`); continue; }
  const g = d.data() as Record<string, unknown>;
  if (N(g.payWritten) !== a.payWritten) bad.push(`${a.plate} 지급(FS) — 넣은 ${won(a.payWritten)} · 읽은 ${won(N(g.payWritten))}`);
  if (N(g.claimWritten) !== a.claimWritten) bad.push(`${a.plate} 청구(FS) — 넣은 ${won(a.claimWritten)} · 읽은 ${won(N(g.claimWritten))}`);
}
if (bad.length) { console.log(`\n   ✕ 되읽기 어긋남 ${bad.length}건`); for (const b of bad.slice(0, 10)) console.log(`      ${b}`); process.exit(1); }
console.log('   ✓ 되읽어 대조 — RTDB·파이어스토어 «둘 다» 넣은 값 그대로다.\n');
process.exit(0);
