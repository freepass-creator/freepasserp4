/**
 * **계산서 «발행용» 한 권 — 거래처별로 얼마를 끊어야 하는가.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★★★사장님 2026-09-09 「정산 관리 그 **계산서 발행용 공급사** 하나 만들어 주고,
 *   계산서 얼마씩 발행해야 되는지 지금 쭉 수집된 내용으로 **시트 하나** 만들어 줘 봐.
 *   그러니까 한 시트에 내가 그 직원한테 «**야 거래처별로 이 금액으로 발행해**» 이렇게 말할 수 있는,
 *   거기에는 **정산 내역**이 나와야 될 거고 … 「26년09월 아이카」 이렇게 **규격 통일**해서」
 *
 * ★★**방향 — 우리가 공급사에 «끊는다».**
 * ```
 * 공급사 시트 꼬리   「입금 부탁드립니다」   ← 우리가 청구한다 = 우리가 계산서를 발행한다
 * 채널 시트 꼬리     「세금계산서 발행 부탁드립니다」 ← 우리가 지급한다 = 채널이 우리에게 발행한다
 * ```
 *   그래서 이 책은 **공급사 축**만 담는다. 채널 축은 우리가 받는 계산서라 여기 오면 방향이 섞인다.
 *
 * ★★★**시트를 다시 읽어 세지 않는다 — 원자에서 뽑는다.**
 *   공급사 시트를 또 읽으면 대수가 두 군데서 세어지던 그 사고와 같은 꼴이 된다(CLAUDE.md).
 *   ⇒ 원자(`settlement_rows`)가 정본이고, 다 뽑은 «뒤에» 공급사 시트 합계와 맞대 본다.
 *     한 곳이라도 갈리면 **멈춘다** — 계산서는 틀리면 세금이 틀린다.
 *
 * ★**칸은 공급사 정산서와 «같은 규격»이다**(`settleHeadFor('공급사')`).
 *   상대가 적는 넉 칸(확인·정정·정정금액·메모)만 뺀다 — 여기는 우리 책이라 상대가 적을 일이 없다.
 *
 * ⚠ **「발행」·「발행일」·「비고」는 사람이 적는 칸이다.** 다시 찍을 때 «되돌려 놓는다» —
 *   덮으면 직원이 켜 둔 것이 매번 사라진다(공급사 시트 「확인·메모」와 같은 처방).
 *
 * ```
 * npx tsx scripts/publish-invoice-workbook.mts 2026-08
 * npx tsx scripts/publish-invoice-workbook.mts 2026-08 --apply
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
/** ★돈·부가세·환수는 «엔진 문»으로만 — 여기서 다시 셈하면 정본이 둘이 된다. */
import { claimOf, invoiceMoneyOf, clawMoneyOf, VAT } from '../lib/domain/settlement/engine';
import type { SettlementRow } from '../lib/domain/settlement-stage';
import { feeKindOf, feeRuleFor, SUPPLIER_ALIAS } from '../lib/domain/settlement-fee-table';
import { PARTNER_CI } from '../lib/domain/partner-ci';
import { SETTLEMENT_BILLING_FROM } from '../lib/domain/settlement-ledger';
import { CORP } from '../lib/domain/corporate-ci';
import { NAVY, TINT, settleHeadFor, settleWidthFor, settleMoneyFor, settleLeftFor, SETTLE_NOTE } from '../lib/server/channel-sheet-tabs';

const S = (v: unknown) => String(v ?? '').trim();
const P = (v: unknown) => S(v).replace(/\s/g, '');
/**
 * ★★**되읽을 때 «우리가 쓴 글자»를 우리가 못 읽으면 안 된다.**
 *   2026-09-09 사고 — 「가감」에 `[Red]−#,##0` 서식을 걸었더니 되읽기가 «−600,000»(U+2212)을 받아
 *   `Number()` 가 NaN → 0 이 됐고, 환수가 통째로 사라져 합계가 139만 원 늘었다.
 *   ⇒ 유니코드 마이너스·전각 부호·괄호 음수까지 «사람이 쓰는 모양»을 다 받아 준다.
 */
const N = (v: unknown) => {
  let t = S(v).replace(/[,\s원]/g, '').replace(/[−–—－]/g, '-').replace(/＋/g, '+');
  if (/^\(.*\)$/.test(t)) t = `-${t.slice(1, -1)}`;
  return Number(t) || 0;
};
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const APPLY = process.argv.includes('--apply');
const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();
if (!MONTH) { console.log('\n  달을 적어 주세요 — npx tsx scripts/publish-invoice-workbook.mts 2026-08 [--apply]\n'); process.exit(1); }
/** ★탭 이름 규격 — 「26년09월 아이카」. 달이 앞이라야 달로 묶여 정렬된다(정산 탭과 같은 결). */
const MON = `${MONTH.slice(2, 4)}년${MONTH.slice(5)}월`;
/**
 * ★★**한 달에 책 한 권 — 탭은 «거래처 이름»만.**
 *   사장님 2026-09-09 「이게 그냥 월별 계산서니까 그냥 **시트명을 8월로 하고 탭에는 월 빼자**」
 *   달이 책 이름에 있으니 탭에 또 적을 까닭이 없다. 탭이 「아이카」면 그게 그 달 아이카다.
 */
const tabOf = (sup: string) => sup;
/**
 * ★★**F 코드가 아니라 «T» 다** — 사장님 2026-09-09
 *   「이거는 시트명 **F06 말고 완전 번외로 T 로 하든지 tax 의 약자로**」
 *   F 코드는 «일하는 표»(상품리스트·정산원장·재고)의 번호다. 세금계산서는 그 줄에 안 선다 —
 *   달마다 새로 나고, 세무·회계 쪽 물건이라 번외로 둔다.
 */
/**
 * ★**번호를 매긴다** — 사장님 2026-09-09 「T 로 하고 **번호는 매겨야지**」.
 *   F 코드가 그렇듯 이름만으로는 어느 것이 먼저인지, 빠진 달이 있는지 안 보인다.
 *   ⇒ **세금계산서를 처음 끊은 달(`SETTLEMENT_BILLING_FROM` = 2026-08)이 T01**, 한 달에 하나씩.
 *     달에서 «셈해» 내므로 표를 따로 안 든다 — 26년08월 T01 · 26년09월 T02 · 26년10월 T03 …
 */
const TNO = (() => {
  const [fy, fm] = SETTLEMENT_BILLING_FROM.split('-').map(Number);
  const [yy, mm] = MONTH.split('-').map(Number);
  const n = (yy - fy) * 12 + (mm - fm) + 1;
  if (n < 1) { console.log(`
  ✕ ${SETTLEMENT_BILLING_FROM} 부터가 세금계산서입니다 — ${MONTH} 은 그 전이라 번호가 없습니다
`); process.exit(1); }
  return String(n).padStart(2, '0');
})();
const BOOK = `[T${TNO} 사용중] 프리패스 세금계산서 ${MON}`;
/** ⚠ 옛 이름들 — ① 한 권에 모든 달 ② F06+달 ③ 번호 없는 T. 만나면 «이름만» 고쳐 이어 쓴다. */
const BOOK_WAS = ['[F06 사용중] 프리패스 계산서 발행', `[F06 사용중] 프리패스 계산서 발행 ${MON}`,
  `[T 사용중] 프리패스 세금계산서 ${MON}`];
const TAB_WAS = (sup: string) => `${MON} ${sup}`;
const SUMMARY = '발행 요약';

/** 요약 탭 칸 — 「야 이 금액으로 발행해」에 바로 쓰는 표. */
/**
 * ★**「가감」은 «금액» 칸이다** — 사장님 2026-09-09 「요약에 **환수 금액 넣는 칸**이 있으면 되지」·「**가감 칸**」.
 *   전에는 「-600,000 반영」이라고 «말»로 적었다. 말은 더할 수가 없다 — 숫자로 적어야 합계가 선다.
 *   ⚠ 이 금액은 왼쪽 「공급가액」에 **이미 빠져 있다**. 두 번 빼지 말 것.
 */
const SUM_HEAD = ['No.', '거래처', '정식 상호', '사업자등록번호', '대표자', '건수',
  '정산액', '가감', '가감 사유', '공급가액', '부가세', '합계', '발행', '발행일', '비고'] as const;
const SUM_WIDTH = [40, 110, 190, 124, 78, 48, 110, 100, 200, 110, 96, 120, 56, 96, 200];
/** ★사람이 적는 칸 — 다시 찍을 때 되돌려 놓는다. */
/**
 * ★사람이 적는 칸 — 다시 찍을 때 되돌려 놓는다.
 *   ★★**「가감」·「가감 사유」도 사람 칸이다** — 사장님 2026-09-09
 *   「정산 1000만원인데 **더 주는 거로 100 플러스**야, 그거 **사유를 써 주면 되고 최종 발행은 얼마다**」.
 *   환수는 우리가 셈해 «처음 값»으로 넣지만, 그 뒤 사람이 고치면 그것이 이긴다.
 */
const SUM_KEEP = ['가감', '가감 사유', '발행', '발행일', '비고'] as const;
/** 내역 칸 = 공급사 정산서와 같은 규격에서 «상대가 적는 넉 칸»만 뺀 것. */
const HEAD = settleHeadFor('공급사').filter((h) => !SETTLE_NOTE.includes(h));
const WIDTH = settleWidthFor('공급사').filter((_, i) => !SETTLE_NOTE.includes(settleHeadFor('공급사')[i]));
const MONEY = settleMoneyFor('공급사');
const LEFT = settleLeftFor('공급사');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const fsdb = getFirestore();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const tok = async () => (await jwt.getAccessToken()).token;
const nap = (ms: number) => new Promise((z) => setTimeout(z, ms));
/** ★쓰기든 읽기든 «답을 본다» — 429/5xx 는 쉬었다 다시. 조용히 실패하면 「발행했다」가 거짓말이 된다. */
const call = async (u: string, m?: string, b?: unknown): Promise<Record<string, unknown> | null> => {
  for (let t = 0; t < 6; t++) {
    const r = await fetch(u, { method: m || 'GET', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    if (r.ok) return r.json().catch(() => ({})) as Promise<Record<string, unknown>>;
    if (r.status === 429 || r.status >= 500) { console.log(`   · ${r.status} — 20초 쉬었다 다시 (${t + 1}/6)`); await nap(20_000); continue; }
    console.log(`\n  ✕ ${r.status} — ${(await r.text()).slice(0, 200)}\n`); return null;
  }
  console.log('\n  ✕ 한도에 계속 걸립니다 — 잠시 뒤 다시 돌려 주세요\n'); return null;
};

/* ── ① 원자에서 뽑는다 ────────────────────────────────────────────── */
const rows = (await fsdb.collection('settlement_rows').get()).docs.map((d) => d.data() as Record<string, unknown>)
  .filter((r) => S(r.billMonth) === MONTH && r.cancelled !== true);
const claws = (await fsdb.collection('settlement_clawbacks').get()).docs.map((d) => d.data() as Record<string, unknown>)
  .filter((c) => S(c.month) === MONTH);

type Line = { plate: string; recv: string; deliv: string; model: string; cust: string; product: string;
  term: number; rent: number; deposit: number; price: number; payKind: string; how: string;
  net: number; vat: number; total: number };

/** ★돈은 공급사 정산서와 «똑같이» 센다 — 갈리면 상대가 보는 종이와 우리 계산서가 달라진다. */
const lineOf = (r: Record<string, unknown>): Line => {
  const ratio = N(r.settleRatio) || 1;
  const raw = claimOf(r as unknown as SettlementRow);
  /** ★부가세 가르기는 «엔진»이 한다 — 여기서 또 나누면 사슬 검사와 1원씩 갈린다(2026-09-09). */
  const { net, vat } = invoiceMoneyOf(r as never);
  const product = S(r.product); const term = N(r.term);
  const { kind, form, fallback } = feeKindOf(product, S(r.model));
  const f = feeRuleFor(S(r.supplier), kind, term, form, fallback);
  let how = '';
  if (f && f.auto && typeof f.claim === 'number') {
    const rs = f.claim < 1 ? `${(f.claim * 100).toFixed(2)}%` : won(f.claim);
    how = f.basis === '정액' ? `건당 ${won(f.claim)}`
      : f.basis === '차량가액' ? `차량가액 ${won(N(r.price))} × ${rs}`
        : `렌탈료 ${won(N(r.rent))} × ${term}개월 × ${rs}`;
    /** ★표로 세어 본 값과 «적힌 금액»이 다르면 식을 지운다 — 종이가 스스로 틀린 말을 하면 안 된다. */
    const expect = Math.round((f.basis === '정액' ? f.claim
      : f.basis === '차량가액' ? N(r.price) * f.claim : N(r.rent) * term * f.claim) * ratio);
    const base = raw - N(r.claimIncentive);
    if (expect && Math.abs(expect - base) > 1) {
      how = Math.abs(expect * 0.5 - base) <= 1 ? `${how} × 비율 0.5 (분납 1회차)` : '개별 협의';
    } else if (ratio !== 1) how += ` × 비율 ${ratio}`;
  } else if (f) how = `수수료 정책 「${f.claim}」 — 개별 협의`;
  else how = '개별 협의';
  if (!S(r.supplier)) how = S(r.settleNote) || S(r.product) || '지원금';
  return { plate: S(r.plate) || '(차번없음)', recv: S(r.receivedAt), deliv: S(r.deliveredAt),
    model: S(r.model), cust: S(r.customer), product, term, rent: N(r.rent), deposit: N(r.deposit),
    price: N(r.price), payKind: S(r.payKind), how, net, vat, total: net + vat };
};

type Job = { sup: string; lines: Line[]; backs: { plate: string; model: string; amt: number; why: string }[];
  net: number; vat: number; claw: number };
const jobs: Job[] = [];
/**
 * ★★★**묶는 열쇠는 «사업자등록번호»다 — 계산서는 법인에 끊는다.**
 *
 *   사장님 2026-09-09 「**탭은 법인별로 해야 함**」
 *
 * ⚠⚠ **별칭(`SUPPLIER_ALIAS`)으로 묶으면 틀린다.** 실측 2026-09-09 —
 * ```
 * 빌린카     247-87-03117   주식회사 빌린카
 * 엘씨렌트   819-81-00849   주식회사 엘씨      ← 번호가 «다르다»
 * ```
 *   별칭 표는 둘을 한 회사로 보지만 **사업자번호가 다르니 다른 법인**이다.
 *   정산서(청구서)는 사장님 지시로 한 탭에 합쳐 내지만(2026-09-08 「정산탭 하나로 합쳐 빌린카 엘씨」),
 *   **세금계산서는 번호마다 한 장**이다 — 합치면 남의 법인 매출이 된다.
 *   ⇒ 여기서는 번호로만 묶는다. 번호가 같으면 한 장(리더스 · 리더스렌트카 = 215-87-46138).
 *
 * ⚠ 번호를 모르는 곳은 «묶지 않는다» — 지어서 합치면 그게 더 큰 사고다.
 */
const bizOf = (name: string) => S(PARTNER_CI.find((c) => S(c.alias) === S(name))?.bizNo);
const 한몸 = (a: string, b: string) => {
  if (a === b) return true;
  const x = bizOf(a); const y = bizOf(b);
  return !!x && !!y && x === y;
};
for (const sup of [...new Set(rows.map((r) => S(r.supplier)).filter(Boolean))].sort()) {
  const mine = rows.filter((r) => S(r.supplier) === sup).map(lineOf).filter((l) => l.total !== 0);
  mine.sort((a, b) => `${a.recv || '9999-99-99'}|${a.plate}`.localeCompare(`${b.recv || '9999-99-99'}|${b.plate}`));
  const backs = claws.filter((c) => S(c.supplier) === sup)
    .map((c) => ({ plate: S(c.plate), model: S(c.model), amt: N(c.supplierAmt), why: S(c.reason) }))
    .filter((b) => b.amt !== 0);
  const claw = backs.reduce((a, b) => a + b.amt, 0);
  if (!mine.length && !claw) continue;
  const net = mine.reduce((a, b) => a + b.net, 0) - claw;
  const vat = mine.reduce((a, b) => a + b.vat, 0) - clawMoneyOf(claw).vat;
  const 짝 = jobs.find((m) => 한몸(m.sup.split('·')[0], sup));
  if (짝) {
    짝.lines.push(...mine); 짝.backs.push(...backs); 짝.net += net; 짝.vat += vat; 짝.claw += claw;
    /** ★탭 이름은 «먼저 선 이름» 하나로 둔다 — 「26년08월 빌린카」. 어느 이름으로 온 줄인지는 표가 안다. */
    console.log(`   ○ 같은 회사라 한 장으로 — ${짝.sup} ← ${sup}`);
    continue;
  }
  jobs.push({ sup, lines: mine, backs, net, vat, claw });
}
/** ★합친 뒤 다시 «접수일 순»으로 세운다 — 두 이름이 섞이면 차례가 흐트러진다. */
for (const j of jobs) j.lines.sort((a, b) => `${a.recv || '9999-99-99'}|${a.plate}`.localeCompare(`${b.recv || '9999-99-99'}|${b.plate}`));

console.log(`\n■ ${MON} 계산서 발행 — 거래처 ${jobs.length}곳 ${APPLY ? '(반영)' : '(대조만)'}\n`);
const ci = (name: string) => PARTNER_CI.find((c) => S(c.alias) === S(name));
for (const j of jobs) {
  const c = ci(j.sup);
  console.log(`   ${pad(j.sup, 11)} ${String(j.lines.length).padStart(2)}건  공급가액 ${won(j.net).padStart(12)} · 부가세 ${won(j.vat).padStart(10)} · 합계 ${won(j.net + j.vat).padStart(12)}`
    + `${j.claw ? `  (환수 -${won(j.claw)})` : ''}   ${c?.bizNo || '★사업자번호 없음'}`);
}
const TOT = jobs.reduce((a, j) => ({ n: a.n + j.lines.length, net: a.net + j.net, vat: a.vat + j.vat, claw: a.claw + j.claw }), { n: 0, net: 0, vat: 0, claw: 0 });
console.log(`\n   ${pad('합계', 11)} ${String(TOT.n).padStart(2)}건  공급가액 ${won(TOT.net).padStart(12)} · 부가세 ${won(TOT.vat).padStart(10)} · 합계 ${won(TOT.net + TOT.vat).padStart(12)}`);

/* ── ② 공급사 시트 합계와 맞대 본다 — 갈리면 멈춘다 ────────────────── */
const files = ((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and (name contains '프리패스 재고' or name contains '프리패스 계산서' or name contains '프리패스 세금계산서')")}&fields=files(id,name)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`)) as { files?: { id: string; name: string }[] } | null)?.files || [];
/**
 * ★**시트 찾기는 발행기와 «같은» 방식이다** — 이름 부분일치로는 못 찾는다.
 *   실측 2026-09-09 — 「스타스카이」의 시트 이름은 「스타 프리패스 재고」였고,
 *   「엘씨렌트」는 제 시트 없이 빌린카 시트를 같이 쓴다. 둘 다 「못 찾음」으로 떨어졌다.
 */
const aliasOf = (name: string) => S(name).replace(/^\[[^\]]*\]\s*/, '').replace(/\s*프리패스 재고.*$/, '');
const key = (x: string) => P(x).replace(/\(.*?\)/g, '');
const findSheet = (name: string) => files.filter((f) => {
  if (!/사용중/.test(f.name) || !/재고/.test(f.name)) return false;
  const a = key(aliasOf(f.name)); const b = key(name);
  return !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a));
});
/**
 * ★★**맞대는 단위는 «시트»다 — 법인이 아니다.**
 *   정산서는 별칭으로 합쳐 한 탭에 내는데(빌린카+엘씨) 계산서는 법인마다 갈린다.
 *   그래서 법인 하나씩 맞대면 «둘 다 틀렸다»고 나온다 — 실제로는 합이 맞는데도.
 *   ⇒ 한 시트에 걸린 계산서들을 «다 더해» 그 시트의 그 달 합계와 맞댄다.
 */
console.log(`\n■ 공급사 정산서와 맞대 본다 — 갈리면 멈춥니다\n`);
const gap: string[] = [];
/**
 * ★★★**「곳마다 맞다」는 「총합이 맞다」가 아니다** — 사장님 2026-09-09 「**총 합이 맞아야 함**」.
 *
 *   곳마다 대조는 **맞댄 곳만** 본다. 시트를 못 찾거나 합계 줄을 못 읽으면 그 곳은 **조용히 빠지고**,
 *   남은 곳끼리는 전부 ✓ 라서 종이는 「다 맞다」고 말한다 — 그런데 총합은 그만큼 비어 있다.
 *   ⇒ 아래 셋을 **다** 본다. 하나라도 어긋나면 계산서를 만들지 않는다.
 *     ㉠ 못 맞댄 곳이 **하나도 없어야** 한다 (빠진 곳이 있으면 총합을 «잰 적이 없는» 것이다)
 *     ㉡ 곳마다 금액이 같아야 한다
 *     ㉢ **시트 총합 = 계산서 총합** — ㉠㉡ 이 맞아도 마지막으로 한 번 더 «통째로» 잰다
 */
const 못맞댐: string[] = [];
let bookNet = 0;   // 공급사 정산서에서 읽어 온 공급가액 총합
let paperNet = 0;  // 그 시트에 걸린 계산서들의 공급가액 총합
const byBook = new Map<string, { name: string; sups: string[]; net: number }>();
for (const j of jobs) {
  const one = j.sup.split('·')[0];
  const f = findSheet(one)[0] || (SUPPLIER_ALIAS[one] ? findSheet(SUPPLIER_ALIAS[one])[0] : undefined);
  if (!f) { console.log(`   ? ${pad(j.sup, 11)} 재고 시트를 못 찾았습니다 — 못 맞댐`); 못맞댐.push(`${j.sup} (재고 시트 없음) ${won(j.net)}`); continue; }
  const e = byBook.get(f.id) || { name: f.name, sups: [] as string[], net: 0 };
  e.sups.push(j.sup); e.net += j.net; byBook.set(f.id, e);
}
for (const [bookOfSup, e] of byBook) {
  const f = { id: bookOfSup, name: e.name };
  const j = { sup: e.sups.join(' + '), net: e.net };
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}?fields=sheets.properties(title)`) as { sheets?: { properties: { title: string } }[] } | null;
  /**
   * ⚠ 한 시트에 그 달 탭이 여럿일 수 있다 — 별칭이 «아닌» 두 곳이 한 시트를 쓰면
   *   발행기가 「… · 이름」으로 갈라 세운다. 한 장만 보면 남의 몫을 빠뜨린다.
   *   ⇒ 그 달 탭을 «다 더해» 맞댄다.
   */
  const tabs = (meta?.sheets || []).map((s) => s.properties.title).filter((t) => t.startsWith(`${MON} 정산`) && !/예시/.test(t));
  if (!tabs.length) { console.log(`   ? ${pad(j.sup, 11)} 「${MON} 정산」 탭이 없습니다 — 못 맞댐`); 못맞댐.push(`${j.sup} (${MON} 정산 탭 없음) ${won(j.net)}`); continue; }
  let sheetNet = 0; let read = 0;
  for (const tab of tabs) {
    const g = ((await call(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}/values/${encodeURIComponent(`'${tab}'!A1:AZ300`)}`)) as { values?: unknown[][] } | null)?.values || [];
    const hi = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호'));
    const h = hi >= 0 ? (g[hi] || []).map(S) : [];
    const sumRow = g.find((r, i) => i > hi && S((r || [])[1]).replace(/\s/g, '') === '합계');
    if (!sumRow) continue;
    sheetNet += N(sumRow[h.indexOf('공급가액')]); read++;
  }
  if (!read) { console.log(`   ? ${pad(j.sup, 11)} 합계 줄을 못 읽었습니다 — 못 맞댐`); 못맞댐.push(`${j.sup} (합계 줄 못 읽음) ${won(j.net)}`); continue; }
  bookNet += sheetNet; paperNet += j.net;
  const ok = Math.abs(sheetNet - j.net) <= 1;
  if (!ok) gap.push(`${j.sup} — 시트 ${won(sheetNet)} · 우리 ${won(j.net)}`);
  console.log(`   ${ok ? '✓' : '✕'} ${pad(j.sup, 11)} 시트 ${won(sheetNet || 0).padStart(12)} · 계산서 ${won(j.net).padStart(12)}`);
}
/* ── ②′ ★총합 — 곳마다가 아니라 «통째로» 한 번 더 잰다 ─────────────── */
console.log('');
console.log(`   ${pad('총합', 13)} 시트 ${won(bookNet).padStart(12)} · 계산서 ${won(paperNet).padStart(12)}`
  + `${못맞댐.length ? `   (못 맞댄 ${못맞댐.length}곳 ${won(TOT.net - paperNet)} 은 «안 센 것»)` : ''}`);
if (못맞댐.length) {
  console.log(`\n  ✕ ${못맞댐.length}곳을 못 맞댔습니다 — 총합을 «잰 적이 없으므로» 계산서를 만들지 않습니다.\n`);
  for (const x of 못맞댐) console.log(`     ${x}`);
  console.log('');
  process.exit(1);
}
if (gap.length) {
  console.log(`\n  ✕ ${gap.length}곳이 공급사 정산서와 갈립니다 — 계산서를 만들지 않습니다.\n`);
  for (const x of gap) console.log(`     ${x}`);
  console.log('\n  먼저 그 달을 다시 찍어 맞추세요:  npx tsx scripts/publish-supplier-settlement.mts ' + MONTH + ' --apply\n');
  process.exit(1);
}
/** ⚠ 곳마다 ✓ 라도 총합이 갈릴 수 있다 — 한 시트에 두 곳이 걸린 데(빌린카+엘씨)가 있어서다. */
if (Math.abs(bookNet - paperNet) > 1 || Math.abs(paperNet - TOT.net) > 1) {
  console.log(`\n  ✕ 총합이 갈립니다 — 시트 ${won(bookNet)} · 맞댄 계산서 ${won(paperNet)} · 발행 총합 ${won(TOT.net)}\n`);
  process.exit(1);
}
console.log('\n   ✓ 거래처마다, 그리고 «총합»이 공급사 정산서와 같습니다.');

if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 만들었습니다. --apply 로 시트를 냅니다.\n'); process.exit(0); }

/* ── ③ 책을 찾거나 만든다 ─────────────────────────────────────────── */
let bookId = files.find((f) => f.name === BOOK)?.id;
/**
 * ★옛 이름의 책을 만나면 **이름만 바꿔 이어 쓴다** — 새로 만들면 URL 도, 직원이 켜 둔 「발행」도 잃는다.
 *   단 그 책이 «이 달 것»일 때만이다. 다른 달 탭이 섞여 있으면 손대지 않는다.
 */
if (!bookId) {
  const was = files.find((f) => BOOK_WAS.includes(f.name));
  if (was) {
    const m = await call(`https://sheets.googleapis.com/v4/spreadsheets/${was.id}?fields=sheets.properties(title)`) as { sheets?: { properties: { title: string } }[] } | null;
    const tabs = (m?.sheets || []).map((x) => x.properties.title).filter((t) => t !== SUMMARY);
    const mine = tabs.every((t) => t.startsWith(`${MON} `) || !/^\d{2}년\d{2}월 /.test(t));
    if (mine) {
      await call(`https://www.googleapis.com/drive/v3/files/${was.id}?supportsAllDrives=true`, 'PATCH', { name: BOOK });
      bookId = was.id;
      console.log(`
   ~ 옛 책 「${was.name}」 을 「${BOOK}」 으로 고쳐 이어 씁니다`);
    }
  }
}
if (!bookId) {
  const made = await call('https://sheets.googleapis.com/v4/spreadsheets', 'POST', { properties: { title: BOOK } }) as { spreadsheetId?: string } | null;
  bookId = made?.spreadsheetId;
  if (!bookId) { console.log('\n  ✕ 책을 못 만들었습니다\n'); process.exit(1); }
  console.log(`\n   + 「${BOOK}」 을 새로 만들었습니다`);
  /** ★회사 도메인이 편집할 수 있게 — 사장님 「계정 승인해야 보이게」라 «링크 공개»는 안 한다. */
  await call(`https://www.googleapis.com/drive/v3/files/${bookId}/permissions?supportsAllDrives=true`, 'POST',
    { type: 'domain', domain: 'teamjpk.com', role: 'writer' });
}
console.log(`   책 — https://docs.google.com/spreadsheets/d/${bookId}`);

const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}?fields=sheets.properties(sheetId,title,index,gridProperties(columnCount))`) as {
  sheets?: { properties: { sheetId: number; title: string; index: number; gridProperties: { columnCount: number } } }[] } | null;
const all = (meta?.sheets || []).map((s) => s.properties);
const A1 = (n: number) => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };

/** 탭을 찾거나 만든다. */
const tabId = async (title: string, cols: number, rowsNeed: number): Promise<number | undefined> => {
  /** ★옛 이름(「26년08월 아이카」)의 탭이 있으면 이름만 바꾼다 — 지우고 다시 만들면 서식·메모가 날아간다. */
  const was = all.find((s) => s.title === TAB_WAS(title));
  if (was && !all.some((s) => s.title === title)) {
    await call(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, 'POST', { requests: [
      { updateSheetProperties: { properties: { sheetId: was.sheetId, title }, fields: 'title' } } ] });
    was.title = title;
  }
  const found = all.find((s) => s.title === title);
  if (found) {
    await call(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, 'POST', { requests: [
      { updateSheetProperties: { properties: { sheetId: found.sheetId, gridProperties: { rowCount: Math.max(rowsNeed, 40), columnCount: cols, frozenRowCount: 0 } }, fields: 'gridProperties(rowCount,columnCount,frozenRowCount)' } },
      { unmergeCells: { range: { sheetId: found.sheetId } } },
    ] });
    return found.sheetId;
  }
  const add = await call(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, 'POST', { requests: [
    { addSheet: { properties: { title, index: all.length, gridProperties: { rowCount: Math.max(rowsNeed, 40), columnCount: cols } } } } ] }) as { replies?: { addSheet?: { properties?: { sheetId?: number; title?: string; index?: number } } }[] } | null;
  const p = add?.replies?.[0]?.addSheet?.properties;
  if (p?.sheetId !== undefined) all.push({ sheetId: p.sheetId, title, index: all.length, gridProperties: { columnCount: cols } });
  return p?.sheetId;
};

const put = async (title: string, values: (string | number | boolean)[][], formula = false) => {
  const end = `${A1(Math.max(...values.map((v) => v.length)))}${values.length}`;
  /**
   * ★**먼저 걷고 쓴다.** 줄 수가 «줄면» 우리가 덮는 자리 밖에 옛 줄이 남는다 —
   *   2026-09-09 에 안내문이 한 줄 겹쳐 두 번 찍혔다. 우리 표는 우리가 통째로 다시 그린다.
   */
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}/values/${encodeURIComponent(`'${title}'!A1:Z400`)}:clear`, 'POST', {});
  /** ★요약은 «수식»을 쓴다(USER_ENTERED) — 가감을 손대면 최종이 따라 움직여야 한다. */
  const r = await call(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}/values/${encodeURIComponent(`'${title}'!A1:${end}`)}?valueInputOption=${formula ? 'USER_ENTERED' : 'RAW'}`, 'PUT', { values });
  return !!r;
};

const bar = (id: number, row: number, cols: number, right = false) => ({ repeatCell: {
  range: { sheetId: id, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: cols },
  cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: right ? 'RIGHT' : 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
  fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } });

/* ── ④ 거래처별 «내역» 탭 ─────────────────────────────────────────── */
const failed: string[] = [];
for (const j of jobs) {
  const title = tabOf(j.sup);
  const body: (string | number)[][] = j.lines.map((l, i) => {
    const m: Record<string, string | number> = {
      'No.': i + 1, 접수일: l.recv, 차량번호: l.plate, 모델명: l.model, 임차인: l.cust,
      '상품 구분': l.product, '계약 기간': l.term || '', 렌탈료: l.rent || '', 보증금: l.deposit || '',
      '차량 가격(신차)': l.price || '', '납입 방식': l.payKind, 인도일: l.deliv, 청구월: MON,
      '수수료 산정 기준': l.how, 공급가액: l.net, 부가세: l.vat, 합계: l.total,
    };
    return HEAD.map((h) => m[h] ?? '');
  });
  for (const b of j.backs) {
    const m: Record<string, string | number> = { 차량번호: b.plate, 모델명: b.model, '상품 구분': b.plate ? '환수' : '환수 지원금',
      청구월: MON, '수수료 산정 기준': b.why || '지난 청구분 환수',
      공급가액: -b.amt, 부가세: -clawMoneyOf(b.amt).vat, 합계: -(b.amt + clawMoneyOf(b.amt).vat) };
    body.push(HEAD.map((h) => m[h] ?? ''));
  }
  const iM = HEAD.indexOf('공급가액');
  const blank = (n: number) => Array.from({ length: n }, () => '');
  const values: (string | number)[][] = [
    [`${MON} 계산서 발행 내역   ·   ${j.sup} 앞   ·   ${CORP.name} 발행`, ...blank(HEAD.length - 1)],
    [...blank(iM), '공급가액', '부가세', '합계', ...blank(HEAD.length - iM - 3)],
    [...blank(iM), j.net, j.vat, j.net + j.vat, ...blank(HEAD.length - iM - 3)],
    HEAD,
    ...body,
    ['', '합계', `${j.lines.length}건`, ...blank(iM - 3), j.net, j.vat, j.net + j.vat, ...blank(HEAD.length - iM - 3)],
  ];
  const id = await tabId(title, HEAD.length, values.length + 6);
  if (id === undefined) { failed.push(j.sup); continue; }
  if (!(await put(title, values))) { failed.push(j.sup); continue; }
  const last = values.length - 1;
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, 'POST', { requests: [
    { mergeCells: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEAD.length }, mergeType: 'MERGE_ALL' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEAD.length },
      cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10, right: 10 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
    bar(id, 1, HEAD.length, true), bar(id, 3, HEAD.length),
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: HEAD.length },
      cell: { userEnteredFormat: { backgroundColor: TINT, textFormat: { bold: true }, horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: last, endRowIndex: last + 1, startColumnIndex: 0, endColumnIndex: HEAD.length },
      cell: { userEnteredFormat: { backgroundColor: TINT, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    ...HEAD.map((h, c) => ({ repeatCell: { range: { sheetId: id, startRowIndex: 4, endRowIndex: last + 1, startColumnIndex: c, endColumnIndex: c + 1 },
      cell: { userEnteredFormat: { horizontalAlignment: MONEY.includes(h) ? 'RIGHT' : LEFT.includes(h) ? 'LEFT' : 'CENTER', verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)' } })),
    ...MONEY.filter((h) => HEAD.includes(h)).map((h) => ({ repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: last + 1, startColumnIndex: HEAD.indexOf(h), endColumnIndex: HEAD.indexOf(h) + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } }, fields: 'userEnteredFormat.numberFormat' } })),
    { repeatCell: { range: { sheetId: id, startRowIndex: 4, endRowIndex: last + 1, startColumnIndex: HEAD.indexOf('차량번호'), endColumnIndex: HEAD.indexOf('차량번호') + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } },
    ...WIDTH.map((w, c) => ({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
    { repeatCell: { range: { sheetId: id }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Roboto' } } }, fields: 'userEnteredFormat.textFormat.fontFamily' } },
  ] });
  console.log(`   o ${pad(j.sup, 11)} ${String(j.lines.length).padStart(2)}건 · ${won(j.net + j.vat).padStart(12)}  →  「${title}」`);
}

/* ── ⑤ 「발행 요약」 — 사람이 적은 칸은 되돌려 놓는다 ──────────────── */
const sumId = await tabId(SUMMARY, SUM_HEAD.length, jobs.length + 11);
if (sumId === undefined) { console.log('\n  ✕ 「발행 요약」 탭을 못 만들었습니다\n'); process.exit(1); }
/** ★직원이 켜 둔 「발행·발행일·비고」를 거둔다 — 열쇠는 거래처 이름. */
const kept = new Map<string, (string | number | boolean)[]>();
{
  /** ★**날값(UNFORMATTED_VALUE)으로 읽는다** — 서식 입은 글자를 읽으면 위 사고가 또 난다. */
  const g = ((await call(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}/values/${encodeURIComponent(`'${SUMMARY}'!A1:Z200`)}?valueRenderOption=UNFORMATTED_VALUE`)) as { values?: unknown[][] } | null)?.values || [];
  const hi = g.findIndex((r) => (r || []).some((c) => S(c) === '거래처'));
  if (hi >= 0) {
    const h = (g[hi] || []).map(S);
    for (const r of g.slice(hi + 1)) {
      const who = S((r || [])[h.indexOf('거래처')]); if (!who || who === '합계') continue;
      kept.set(who, SUM_KEEP.map((k) => { const i = h.indexOf(k); return i >= 0 ? S((r || [])[i]) : ''; }));
    }
  }
}
/**
 * ★★**청구서와 «같은 짜임»** — 정산액 → 가감(±) → 사유 → «최종 발행액».
 *   사장님 2026-09-09 「우리 청구서가 그렇게 되어 있잖아」.
 *   ★최종 셋(공급가액·부가세·합계)은 **수식**이다 — 가감을 손대면 그 자리에서 따라 움직인다.
 *     숫자로 박아 두면 사람이 고친 가감과 최종이 어긋나 «어느 쪽이 발행액인지» 모르게 된다.
 */
const sumBody = jobs.map((j, i) => {
  const c = ci(j.sup); const k = kept.get(j.sup) || [];
  const row = 3 + i;  // 제목 1줄 + 머리 1줄 뒤
  const base = j.net + j.claw;                       // 가감 «전» 정산액
  /**
   * ★**가감 — 우리 셈이 바탕, 사람이 고치면 그것이 이긴다.**
   *   환수는 우리가 셈해 넣지만, 「더 주는 것 +100만」처럼 사람이 적는 것도 여기 온다.
   *   ⇒ «우리가 넣었던 값 그대로»면 다시 셈해 덮고, 다르면 사람이 만진 것이라 살린다.
   */
  const mine = j.claw ? -j.claw : 0;
  /** ⚠ «0» 은 사람이 고친 값이 아니라 «빈 칸»이다 — 0 을 사람 값으로 보면 환수가 통째로 사라진다(2026-09-09). */
  const had = S(k[0]) === '' || N(k[0]) === 0 ? null : N(k[0]);
  const adj = had === null || had === mine ? (mine || '') : had;
  const why = S(k[1]) || (j.backs.length ? `환수 — ${[...new Set(j.backs.map((b) => S(b.why) || S(b.plate)))].join(' · ')}` : '');
  return [i + 1, j.sup, c?.legal || '★법인 확인 필요', c?.bizNo || '★사업자번호 없음', c?.ceo || '',
    j.lines.length, base, adj, why,
    `=G${row}+H${row}`, `=ROUND(J${row}*0.1)`, `=J${row}+K${row}`,
    k[2] === 'TRUE' || k[2] === true, k[3] || '', k[4] || ''];
});
const sumRows = sumBody.length;
const sumValues: (string | number | boolean)[][] = [
  [`${MON} 세금계산서 발행 목록   ·   ${CORP.name} → 공급사   ·   거래처 ${jobs.length}곳`, ...Array.from({ length: SUM_HEAD.length - 1 }, () => '')],
  [...SUM_HEAD],
  ...sumBody,
  ['', '합계', '', '', '', TOT.n, `=SUM(G3:G${2 + sumRows})`, `=SUM(H3:H${2 + sumRows})`, '',
    `=SUM(J3:J${2 + sumRows})`, `=SUM(K3:K${2 + sumRows})`, `=SUM(L3:L${2 + sumRows})`, '', '', ''],
  Array.from({ length: SUM_HEAD.length }, () => ''),
  ['「정산액 + 가감 = 공급가액」이고 「합계」가 «최종 발행액»입니다. 가감을 고치면 최종이 따라 움직입니다 — 더 주는 것은 «플러스», 환수는 «마이너스»로 적고 사유를 적어 주세요. ★계산서는 «사업자등록번호» 하나가 한 장입니다.', ...Array.from({ length: SUM_HEAD.length - 1 }, () => '')],
  ['발행하면 「발행」을 켜고 「발행일」을 적어 주세요 — 다시 뽑아도 그 칸은 그대로 둡니다.', ...Array.from({ length: SUM_HEAD.length - 1 }, () => '')],
  [`내역은 「${MON} 거래처이름」 탭에 있습니다.`, ...Array.from({ length: SUM_HEAD.length - 1 }, () => '')],
];
if (!(await put(SUMMARY, sumValues, true))) { console.log('\n  ✕ 「발행 요약」 을 못 썼습니다\n'); process.exit(1); }
/** 합계 줄 자리 — 제목 1줄 + 머리 1줄 + 본문. (위쪽 총합 줄은 «아래와 겹쳐» 없앴다) */
const sLast = 2 + sumBody.length;
await call(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, 'POST', { requests: [
  { mergeCells: { range: { sheetId: sumId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: SUM_HEAD.length }, mergeType: 'MERGE_ALL' } },
  { repeatCell: { range: { sheetId: sumId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: SUM_HEAD.length },
    cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10 } } },
    fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
  { updateDimensionProperties: { range: { sheetId: sumId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
  bar(sumId, 1, SUM_HEAD.length),
  ...['정산액', '가감', '공급가액', '부가세', '합계'].map((h) => ({ repeatCell: { range: { sheetId: sumId, startRowIndex: 2, endRowIndex: sLast + 1, startColumnIndex: SUM_HEAD.indexOf(h as typeof SUM_HEAD[number]), endColumnIndex: SUM_HEAD.indexOf(h as typeof SUM_HEAD[number]) + 1 },
    cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } })),
  { repeatCell: { range: { sheetId: sumId, startRowIndex: 2, endRowIndex: sLast, startColumnIndex: 1, endColumnIndex: 2 },
    cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', textFormat: { bold: true } } }, fields: 'userEnteredFormat(horizontalAlignment,textFormat)' } },
  ...['가감 사유', '비고'].map((h) => ({ repeatCell: { range: { sheetId: sumId, startRowIndex: 2, endRowIndex: sLast, startColumnIndex: SUM_HEAD.indexOf(h as typeof SUM_HEAD[number]), endColumnIndex: SUM_HEAD.indexOf(h as typeof SUM_HEAD[number]) + 1 },
    cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat.horizontalAlignment' } })),
  /**
   * ★★**구간마다 «연한» 바탕을 깔고, 정렬을 구간에 맞춘다** — 사장님 2026-09-09
   *   「구간별로 색깔을 좀 연하게라도 다르게 하면 **직원이 보기 편할 듯**」·「**정렬도 신경써 주고**」
   *
   *   칸 열다섯이 한 줄로 서면 눈이 어디서 끊어 읽어야 할지 모른다. 뜻으로 넷을 묶는다.
   * ```
   *   ① 누구        No.·거래처·상호·사업자번호·대표자   흰 바탕      — 이름은 왼쪽, 번호는 가운데
   *   ② 셈          건수·정산액·가감·가감 사유           연한 크림    — 돈은 오른쪽, 사유는 왼쪽
   *   ③ ★최종      공급가액·부가세·합계                 연한 남색    — 여기가 «발행할 금액»
   *   ④ 사람이 적는 발행·발행일·비고                    연한 노랑    — 우리가 안 덮는 칸
   * ```
   *   ★**「합계」가 이 표의 답**이라 거기만 진하고 남색이다. 「공급가액」도 진하게 둔다.
   */
  /**
   * ★**표 «아래»는 흰 바탕으로 되돌린다.** 값은 걷어도 서식은 남는다 —
   *   줄 수가 바뀌면 옛 합계줄 색이 빈 줄에 묻어 있다(2026-09-09 실측 17행).
   */
  { repeatCell: { range: { sheetId: sumId, startRowIndex: sLast + 1, endRowIndex: sLast + 9, startColumnIndex: 0, endColumnIndex: SUM_HEAD.length },
    cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { bold: false, italic: false, foregroundColor: { red: 0.35, green: 0.35, blue: 0.35 } }, horizontalAlignment: 'LEFT' } },
    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' } },
  /**
   * ★★**본문 글자꼴을 «명시»한다.** 칸·줄을 끼우거나 빼면 옛 머리줄(남색 바탕 · 흰 글자) 자리에
   *   본문이 내려앉아 **흰 바탕에 흰 글자**가 된다 — 2026-09-09 경진카 줄이 그렇게 안 보였다.
   *   ⇒ 바탕만 칠하지 말고 글자색·굵기·크기를 늘 다시 적는다. «남은 서식»은 늘 우리 탓이다.
   */
  { repeatCell: { range: { sheetId: sumId, startRowIndex: 2, endRowIndex: sLast + 1, startColumnIndex: 0, endColumnIndex: SUM_HEAD.length },
    cell: { userEnteredFormat: { textFormat: { bold: false, italic: false, fontSize: 10, foregroundColor: { red: 0, green: 0, blue: 0 } }, verticalAlignment: 'MIDDLE' } },
    fields: 'userEnteredFormat(textFormat,verticalAlignment)' } },
  ...[
    { from: 'No.', to: '대표자', bg: { red: 1, green: 1, blue: 1 } },
    { from: '건수', to: '가감 사유', bg: { red: 0.99, green: 0.98, blue: 0.94 } },
    { from: '공급가액', to: '합계', bg: { red: 0.93, green: 0.96, blue: 1 } },
    { from: '발행', to: '비고', bg: { red: 1, green: 0.99, blue: 0.90 } },
  ].map((g) => ({ repeatCell: { range: { sheetId: sumId, startRowIndex: 2, endRowIndex: sLast + 1,
      startColumnIndex: SUM_HEAD.indexOf(g.from as typeof SUM_HEAD[number]), endColumnIndex: SUM_HEAD.indexOf(g.to as typeof SUM_HEAD[number]) + 1 },
    cell: { userEnteredFormat: { backgroundColor: g.bg } }, fields: 'userEnteredFormat.backgroundColor' } })),
  /** ★**가감은 «색으로» 말한다** — 더 주는 것은 파랑 +, 환수는 빨강 −. 0 이면 아무것도 안 쓴다. */
  { repeatCell: { range: { sheetId: sumId, startRowIndex: 2, endRowIndex: sLast + 1, startColumnIndex: SUM_HEAD.indexOf('가감'), endColumnIndex: SUM_HEAD.indexOf('가감') + 1 },
    cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '[Blue]+#,##0;[Red]−#,##0;""' }, horizontalAlignment: 'RIGHT', textFormat: { bold: true } } },
    fields: 'userEnteredFormat(numberFormat,horizontalAlignment,textFormat)' } },
  /**
   * ★최종 셋 — 공급가액은 진하게, «합계»는 진하고 남색. 눈이 마지막 칸에 멎게 한다.
   * ⚠ **글자 크기는 안 키운다**(사장님 2026-09-09 「야 폰트를 누가 키우냐」).
   *   표는 줄이 나란해야 읽힌다 — 한 칸만 커지면 그 줄이 들뜬다. 강조는 «굵기와 색»으로 한다.
   */
  { repeatCell: { range: { sheetId: sumId, startRowIndex: 2, endRowIndex: sLast + 1, startColumnIndex: SUM_HEAD.indexOf('공급가액'), endColumnIndex: SUM_HEAD.indexOf('공급가액') + 1 },
    cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
  { repeatCell: { range: { sheetId: sumId, startRowIndex: 2, endRowIndex: sLast + 1, startColumnIndex: SUM_HEAD.indexOf('합계'), endColumnIndex: SUM_HEAD.indexOf('합계') + 1 },
    cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: NAVY } } }, fields: 'userEnteredFormat.textFormat' } },
  /** ★정렬 — 이름은 왼쪽, 번호·날짜는 가운데. 돈은 위에서 이미 오른쪽으로 맞췄다. */
  ...['사업자등록번호', '대표자', '건수', '발행', '발행일'].map((h) => ({ repeatCell: { range: { sheetId: sumId, startRowIndex: 2, endRowIndex: sLast + 1,
      startColumnIndex: SUM_HEAD.indexOf(h as typeof SUM_HEAD[number]), endColumnIndex: SUM_HEAD.indexOf(h as typeof SUM_HEAD[number]) + 1 },
    cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } })),
  { repeatCell: { range: { sheetId: sumId, startRowIndex: 2, endRowIndex: sLast + 1, startColumnIndex: SUM_HEAD.indexOf('정식 상호'), endColumnIndex: SUM_HEAD.indexOf('정식 상호') + 1 },
    cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
  /** ★줄 높이를 조금 띄운다 — 열다섯 칸이 붙어 있으면 줄을 헛짚는다. */
  { updateDimensionProperties: { range: { sheetId: sumId, dimension: 'ROWS', startIndex: 2, endIndex: sLast + 1 }, properties: { pixelSize: 26 }, fields: 'pixelSize' } },
  /**
   * ★★**체크칸은 «걷고 나서» 다시 단다.** 칸을 하나 끼우면 옛 규칙이 그 자리에 남아
   *   엉뚱한 칸(가감)에 체크박스가 뜬다 — 2026-09-09 사장님 화면에서 실제로 그랬다.
   *   ⇒ 우리가 쓰는 자리를 «통째로» 걷고, 「발행」에만 다시 건다.
   */
  { setDataValidation: { range: { sheetId: sumId, startRowIndex: 0, endRowIndex: sLast + 6, startColumnIndex: 0, endColumnIndex: SUM_HEAD.length } } },
  { setDataValidation: { range: { sheetId: sumId, startRowIndex: 2, endRowIndex: sLast, startColumnIndex: SUM_HEAD.indexOf('발행'), endColumnIndex: SUM_HEAD.indexOf('발행') + 1 },
    rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true } } },
  { repeatCell: { range: { sheetId: sumId, startRowIndex: sLast, endRowIndex: sLast + 1, startColumnIndex: 0, endColumnIndex: SUM_HEAD.length },
    cell: { userEnteredFormat: { backgroundColor: TINT, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
  ...SUM_WIDTH.map((w, c) => ({ updateDimensionProperties: { range: { sheetId: sumId, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
  { repeatCell: { range: { sheetId: sumId }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Roboto' } } }, fields: 'userEnteredFormat.textFormat.fontFamily' } },
  { updateSheetProperties: { properties: { sheetId: sumId, index: 0 }, fields: 'index' } },
] });
console.log(`   o ${pad('발행 요약', 11)} ${jobs.length}곳 · ${won(TOT.net + TOT.vat)}  →  「${SUMMARY}」 (맨 앞)`);

/* ── ⑥ 탭 차례 — 요약이 맨 앞, 달은 내림차순, 그 안에서 거래처 이름순 ─ */
{
  const m = await call(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}?fields=sheets.properties(sheetId,title,index)`) as {
    sheets?: { properties: { sheetId: number; title: string; index: number } }[] } | null;
  const t = (m?.sheets || []).map((s) => s.properties);
  /** 요약이 맨 앞, 그 뒤는 거래처 «이름순». 달은 책 이름에 있으니 탭 차례에 안 쓴다. */
  const names = new Set(jobs.map((j) => tabOf(j.sup)));
  const rest = t.filter((s) => s.title !== SUMMARY && names.has(s.title)).sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  const want = [...t.filter((s) => s.title === SUMMARY), ...rest, ...t.filter((s) => s.title !== SUMMARY && !names.has(s.title))];
  for (let k = 0; k < want.length; k++) {
    if (want[k].index === k) continue;
    await call(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, 'POST', { requests: [
      { updateSheetProperties: { properties: { sheetId: want[k].sheetId, index: k }, fields: 'index' } } ] });
  }
}

/* ── ⑦ ★원자에 되쓴다 — 어느 법인 장에 실렸나 · 사람이 켠 「발행」 ───── */
/**
 * ★★★사장님 2026-09-09 「공급사 계산서 발행해야 할 것들 명확하게 **정산원장이랑 연동**하고
 *   **SSOT 원자에 잘 반영**해서」
 *
 *   지금까지 계산서는 **시트에만** 있었다. 원자는 「이 줄이 어느 계산서에 실렸는지」도,
 *   「그 계산서를 끊었는지」도 몰랐다. 그러면 `settlement:ask` 로 물어도 대답을 못 하고,
 *   「보냈는데 안 끊은」 달이 아무 데도 안 보인다 — 그게 매출 누락이다.
 * ⇒ 낼 때마다 줄에 **사업자등록번호**를 박고, 요약 탭에서 사람이 켠 「발행·발행일」을 거둬 온다.
 *
 * ⚠ **발행 여부는 우리가 «정하지» 않는다.** 시트에서 직원이 켠 것만 가져온다 —
 *   우리가 켜면 「끊었다」가 거짓말이 된다(수금을 우리가 못 적는 것과 같은 이치).
 */
{
  const bizByJob = new Map<string, string>();
  for (const j of jobs) bizByJob.set(j.sup, bizOf(j.sup.split('·')[0]));
  const jobOf = (sup: string) => jobs.find((j) => 한몸(j.sup.split('·')[0], sup));
  const patches: { id: string; patch: Record<string, unknown> }[] = [];
  for (const d of (await fsdb.collection('settlement_rows').get()).docs) {
    const r = d.data() as Record<string, unknown>;
    if (S(r.billMonth) !== MONTH || r.cancelled === true) continue;
    const j = S(r.supplier) ? jobOf(S(r.supplier)) : undefined;
    /** 계산서에 안 실린 줄(청구 0·공급사 없음)은 «빈 값»으로 둔다 — 남은 표시가 거짓이 되지 않게. */
    const biz = j && invoiceMoneyOf(r as never).total !== 0 ? S(bizByJob.get(j.sup)) : '';
    const k = j ? kept.get(j.sup) : undefined;
    const on = /^(TRUE|true|O|o|Y|y|1|예|발행)$/.test(S(k?.[0]));
    const at = S(k?.[1]);
    const patch: Record<string, unknown> = {};
    if (S(r.invoiceBiz) !== biz) patch.invoiceBiz = biz;
    if ((r.invoiceIssued === true) !== on) patch.invoiceIssued = on;
    if (S(r.invoiceAt) !== at) patch.invoiceAt = at;
    if (Object.keys(patch).length) { patch.updatedAt = Date.now(); patches.push({ id: d.id, patch }); }
  }
  if (patches.length) {
    for (let i = 0; i < patches.length; i += 400) {
      const b = fsdb.batch();
      for (const p of patches.slice(i, i + 400)) b.set(fsdb.collection('settlement_rows').doc(p.id), p.patch, { merge: true });
      await b.commit();
    }
    /** ★되읽어 «한 밭씩» 맞대 본다 — 「반영했다」가 거짓말이 되지 않게. */
    const gapA: string[] = [];
    for (const p of patches) {
      const back = (await fsdb.collection('settlement_rows').doc(p.id).get()).data() || {};
      for (const [k2, v] of Object.entries(p.patch)) if (k2 !== 'updatedAt' && S(back[k2]) !== S(v)) gapA.push(`${p.id}.${k2}`);
    }
    if (gapA.length) { console.log(`\n  ✕ 원자 되읽기에서 ${gapA.length}밭이 다릅니다 — ${gapA.slice(0, 5).join(' · ')}\n`); process.exit(1); }
  }
  const issued = patches.filter((p) => p.patch.invoiceIssued === true).length;
  console.log(`   o ${pad('원자 반영', 11)} ${patches.length}줄 고침${issued ? ` · 「발행」 켜진 줄 ${issued}` : ''} — 되읽어 확인`);
}

if (failed.length) {
  console.log(`\n  ✕ ${failed.length}곳을 못 냈습니다 — ${failed.join(' · ')}`);
  console.log('  잠시 뒤 다시 돌려 주세요(분당 한도일 수 있습니다).\n');
  process.exit(1);
}
console.log(`\n  ✓ ${MON} 계산서 발행 목록을 냈습니다 — 거래처 ${jobs.length}곳 · 합계 ${won(TOT.net + TOT.vat)}`);
console.log(`  https://docs.google.com/spreadsheets/d/${bookId}\n`);
process.exit(0);
