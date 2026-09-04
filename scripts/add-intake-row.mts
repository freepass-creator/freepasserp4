/**
 * **빠진 계약을 정산원장 「접수」 탭에 «우리가» 넣는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★★★사장님 2026-09-04 「영업자가 누락됐다고 한 건 **우리가 오플에다가 청구를 하면 되는 거니까
 *   우리가 넣어 가지고 청구를 하면 되지.**」
 *
 * ★**금액은 상대에게 묻지 않는다 — 요율표가 정본이다.**
 *   오플구독은 정액(청구 100만 · 지급 80만)이라 차와 손님만 알면 우리가 계산할 수 있다.
 *   ⇒ 채널이 「금액을 안 적어 줬다」고 멈출 일이 아니다. 우리 요율로 넣고 청구한다.
 *
 * ★★**원자에 직접 쓰지 않는다** — 사장님 2026-09-04 「우리가 앞으로 만들어 가는 게 원자임」.
 *   원장(F04) 「접수」 탭에 넣고 `npm run settlement:import` 가 원자로 올린다. 그것이 정해진 길이다.
 *
 * ⚠ **요율이 «개별 협의»(auto:false)면 넣지 않는다.** 손오공 구독·웰릭스 사다리처럼 기간·대여료가
 *   있어야 금액이 서는 것은 조건을 받아야 한다. 짐작으로 돈을 세우지 않는다.
 *
 * ```
 * npx tsx scripts/add-intake-row.mts --파일=tmp/누락.json
 * npx tsx scripts/add-intake-row.mts --파일=tmp/누락.json --apply
 * ```
 * 파일은 이런 꼴 — 아는 것만 적으면 된다.
 * ```json
 * [{ "plate":"05수5243","customer":"이지현","supplier":"오토플러스","channel":"하허호",
 *    "product":"오플구독","received":"2026-08-13","delivered":"2026-08-13","term":24,
 *    "rent":800000,"deposit":1600000,"payKind":"2회분납","model":"EV6","billMonth":"2026-08",
 *    "note":"하허호 8월 누락분" }]
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { feeKindOf, feeRuleFor } from '../lib/domain/settlement-fee-table';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const APPLY = process.argv.includes('--apply');
const FILE = (process.argv.find((a) => a.startsWith('--파일=')) || '').slice('--파일='.length);
if (!FILE) { console.log('\n  파일을 주세요 — npx tsx scripts/add-intake-row.mts --파일=tmp/누락.json [--apply]\n'); process.exit(1); }

type Item = { plate: string; customer: string; supplier: string; channel: string; product: string;
  received?: string; delivered?: string; term?: number; rent?: number; deposit?: number; price?: number;
  payKind?: string; model?: string; billMonth: string; note?: string; agent?: string };
const items = JSON.parse(readFileSync(FILE, 'utf8')) as Item[];

const LEDGER = '1BjGBqAjRLEb9ZMKarpQsMF-q_UjdgmEqBAl1uVk8SR4';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;

/** 엑셀 날짜 — 접수 탭은 날짜를 «수»로 담는다(46238 = 2026-08-04). */
const xl = (v: unknown): number | '' => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v));
  if (!m) return '';
  return Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86400000);
};

/**
 * **접수 탭 칸 차례** — 실측 2026-09-04. 수식은 없다(값만 담긴다).
 * ```
 * 0 접수일 · 1 차량번호 · 2 공급사 · 3 모델명 · 4 영업채널 · 5 영업담당자 · 7 고객명
 * 9 상품구분 · 10 계약기간 · 11 렌탈료 · 12 보증금 · 13 차량가액 · 14 분납여부
 * 15 계약서 · 16 인도완료 · 17 인도일 · 18 청구년 · 19 청구월 · 20 취소 · 22 환수
 * 26 렌트구분 · 27 공급사수수료율 · 28 판매수수료(=청구) · 32 에이전시수수료율 · 33 출고수수료(=지급)
 * 38 비고 · 46 원본탭
 * ```
 * ★정액 규칙이면 27·28 과 32·33 에 «같은 값»이 들어간다(실측 오플구독 1,000,000 / 800,000).
 */
const W = 54;
const rowOf = (it: Item, claim: number, pay: number, rate: { claim: number; pay: number }) => {
  const r: (string | number | boolean)[] = Array.from({ length: W }, () => '');
  r[0] = xl(it.received) || xl(it.billMonth ? `${it.billMonth}-01` : '') || '';
  r[1] = S(it.plate); r[2] = S(it.supplier); r[3] = S(it.model); r[4] = S(it.channel); r[5] = S(it.agent);
  r[7] = S(it.customer); r[9] = S(it.product);
  r[10] = N(it.term) || ''; r[11] = N(it.rent) || ''; r[12] = N(it.deposit) || ''; r[13] = N(it.price) || '';
  r[14] = S(it.payKind); r[15] = false; r[16] = !!it.delivered; r[17] = xl(it.delivered) || '';
  r[18] = Number(it.billMonth.slice(0, 4)); r[19] = Number(it.billMonth.slice(5));
  r[20] = false; r[22] = false;
  r[26] = /구독/.test(S(it.product)) ? '구독' : /선출고|신차/.test(S(it.product)) ? '신차렌트' : '재렌트';
  r[27] = rate.claim; r[28] = claim; r[32] = rate.pay; r[33] = pay; r[35] = 0;
  r[38] = S(it.note); r[46] = `프리패스 ${it.billMonth.slice(2, 4)}/${Number(it.billMonth.slice(5))}`;
  for (const c of [49, 50, 51, 52, 53]) r[c] = false;
  return r;
};

console.log(`\n■ 접수 탭에 넣을 줄 ${items.length}건 ${APPLY ? '(반영)' : '(대조만)'}\n`);
const ok: (string | number | boolean)[][] = [];
let claimSum = 0; let paySum = 0; let blocked = 0;
for (const it of items) {
  const { kind, form, fallback } = feeKindOf(S(it.product), S(it.model));
  const f = feeRuleFor(S(it.supplier), kind, N(it.term), form, fallback);
  /**
   * ★★**요율이 «개별 협의»면 넣지 않는다.** 기간·대여료가 있어야 금액이 서는 규칙(사다리·구독료 %)은
   *   짐작으로 세우면 그대로 청구서에 실린다. 조건을 받아 다시 부른다.
   */
  if (!f || !f.auto || typeof f.claim !== 'number' || typeof f.pay !== 'number') {
    console.log(`  ✕ ${S(it.plate).padEnd(10)} ${S(it.customer).padEnd(7)} ${S(it.supplier).padEnd(7)} — 요율이 «개별 협의»입니다${f ? ` (표 규칙 「${f.claim}」)` : ''}. 기간·대여료를 받아 다시 넣습니다.`);
    blocked++; continue;
  }
  const claim = f.basis === '정액' ? f.claim
    : f.basis === '차량가액' ? Math.round(N(it.price) * f.claim)
      : Math.round(N(it.rent) * N(it.term) * f.claim);
  const pay = f.basis === '정액' ? f.pay
    : f.basis === '차량가액' ? Math.round(N(it.price) * f.pay)
      : Math.round(N(it.rent) * N(it.term) * f.pay);
  if (!claim || !pay) {
    console.log(`  ✕ ${S(it.plate).padEnd(10)} ${S(it.customer).padEnd(7)} — 금액이 0 입니다(대여료·기간·차량가액이 없습니다).`);
    blocked++; continue;
  }
  claimSum += claim; paySum += pay;
  ok.push(rowOf(it, claim, pay, { claim: f.claim, pay: f.pay }));
  console.log(`  o ${S(it.plate).padEnd(10)} ${S(it.customer).padEnd(7)} ${S(it.supplier).padEnd(7)} ${S(it.product).padEnd(8)} ${it.billMonth} 청구 ${won(claim).padStart(10)} · 지급 ${won(pay).padStart(10)}   ${f.basis === '정액' ? '정액' : `${f.basis} 규칙`}`);
}

console.log(`\n   넣을 줄 ${ok.length}건${blocked ? ` · 못 넣는 줄 ${blocked}건` : ''}`);
console.log(`   청구 늘어남 ${won(claimSum)} (부가세 별도) · 지급 늘어남 ${won(paySum)}  → 우리 몫 ${won(claimSum - paySum)}`);
if (!ok.length) { console.log('\n  넣을 것이 없습니다.\n'); process.exit(blocked ? 1 : 0); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 넣습니다.\n'); process.exit(0); }

/** ★맨 아래에 «이어 붙인다» — 사람이 적어 둔 줄을 밀거나 덮지 않는다. */
const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent("'접수'!A3")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
  method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ values: ok }),
});
if (!r.ok) { console.log(`\n  ✕ 못 넣었습니다 — ${r.status} ${(await r.text()).slice(0, 200)}\n`); process.exit(1); }
console.log(`\n  ✓ 접수 탭에 ${ok.length}줄을 넣었습니다.`);
console.log('  ※ 이어서 — npm run settlement:import → 그 달 탭·정산서·시트를 다시 뽑습니다.\n');
process.exit(0);
