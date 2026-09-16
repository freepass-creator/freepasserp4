/**
 * **원자만으로 정산서 한 장이 다 채워지는가.** 읽기만 한다.
 *
 * ★★★사장님 2026-09-10 「원자로 다 정산내역도 다 맞출 수 있나??? 내역에 있는 거 맞출 수 있어?」
 *
 * 정산서 칸의 정본은 `lib/server/channel-sheet-tabs.ts` 의 `SETTLE_COLUMNS`
 * (영업채널 25칸 · 공급사 21칸). **그 칸이 원자에서 나오는지 한 칸씩 센다.**
 *
 * ── 세 갈래로 가른다
 *   ① 원자 밭에서 «그대로» 온다        — plate·customer·rent …
 *   ② 원자에서 «셈해서» 나온다          — 공급가액·부가세·합계(엔진이 낸다) · No.(줄 번호)
 *   ③ 상대가 «적는» 칸                  — 확인·정정요청·정정금액·메모 (원자에 자리는 있다)
 *   ✕ 어디서도 안 나온다                 — 이게 있으면 «시트 없이는 못 만든다»
 *
 * ⚠ **밭이 규격에 있다고 «차 있는» 것은 아니다.** 그래서 달마다 «실제로 빈 줄»도 같이 센다.
 *   규격만 보면 「다 된다」가 나오고, 실물을 보면 「이 칸이 절반 비었다」가 나온다.
 *
 *   npm run check:complete
 *   npx tsx scripts/check-settlement-complete.mts 2026-08
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SETTLE_COLUMNS, settleColumnsFor } from '../lib/server/channel-sheet-tabs';
import { SETTLEMENT_FIELDS } from '../lib/domain/settlement-atom';
import { invoiceMoneyOf, claimOf, payOf, type SettlementRow } from '../lib/domain/settlement/engine';

const S = (v: unknown) => String(v ?? '').trim();
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const MONTH = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-08';

/**
 * ★정산서 칸 ↔ 원자 밭. **여기 적는 것이 「어디서 오나」의 정본**이다.
 *   `field` = 원자 밭 열쇠 · `calc` = 셈해서 나옴 · `theirs` = 상대가 적는 칸
 */
type 어디 = { field?: string; calc?: string; theirs?: string };
const 출처: Record<string, 어디> = {
  'No.': { calc: '줄 번호 — 시트가 매긴다' },
  접수일: { field: 'receivedAt' },
  차량번호: { field: 'plate' },
  공급사: { field: 'supplier' },
  모델명: { field: 'model' },
  영업채널: { field: 'channel' },
  영업담당자: { field: 'agent' },
  임차인: { field: 'customer' },
  '상품 구분': { field: 'product' },
  '계약 기간': { field: 'term' },
  렌탈료: { field: 'rent' },
  보증금: { field: 'deposit' },
  '차량 가격(신차)': { field: 'price' },
  '납입 방식': { field: 'payKind' },
  인도일: { field: 'deliveredAt' },
  청구월: { field: 'billMonth' },
  공급가액: { calc: 'invoiceMoneyOf(원자).net — 엔진' },
  부가세: { calc: 'invoiceMoneyOf(원자).vat — 엔진' },
  합계: { calc: 'invoiceMoneyOf(원자).total — 엔진' },
  '지급 예정일': { calc: '달 규칙 — settlement-billing-month' },
  확인: { theirs: 'supplierOk / channelOk' },
  정정: { theirs: 'supplierFix / channelFix' },
  정정금액: { theirs: 'supplierFixAmt / channelFixAmt' },
  '메모(정정사유)': { theirs: 'supplierMemo / channelMemo' },
};

const 밭있나 = new Set(SETTLEMENT_FIELDS.map((f) => f.key));
const 산정칸 = SETTLE_COLUMNS.map((c) => c.name).find((n) => /산정|근거|조건/.test(n)) || '';
if (산정칸) 출처[산정칸] = { field: 'settleNote' };

/* ── ① 규격 대조 ─────────────────────────────────────────────── */
console.log(`\n■ 정산서 칸이 원자에서 나오는가 — 정본 SETTLE_COLUMNS ${SETTLE_COLUMNS.length}칸\n`);
const 없는: string[] = [];
for (const c of SETTLE_COLUMNS) {
  const w = 출처[c.name];
  let 표 = ''; let 말 = '';
  if (!w) { 표 = '✕'; 말 = '어디서 오는지 안 적혀 있다'; 없는.push(c.name); }
  else if (w.field) {
    if (밭있나.has(w.field)) { 표 = '①'; 말 = `원자 밭 ${w.field}`; }
    else { 표 = '✕'; 말 = `원자에 밭이 없다 — ${w.field}`; 없는.push(c.name); }
  } else if (w.calc) { 표 = '②'; 말 = w.calc; }
  else { 표 = '③'; 말 = `상대가 적는다 — ${w.theirs}`; }
  const 쪽 = c.hide ? `  (${c.hide} 시트엔 없음)` : '';
  console.log(`   ${표} ${pad(c.name, 18)} ${말}${쪽}`);
}
console.log(`\n   ① 원자 밭 그대로 · ② 셈해서 나옴 · ③ 상대가 적음 · ✕ 안 나옴 ${없는.length}개`);
console.log(`   영업채널 ${settleColumnsFor('영업채널').length}칸 · 공급사 ${settleColumnsFor('공급사').length}칸`);

/* ── ② 실물 대조 — 그 달 줄에서 «실제로 빈» 칸 ──────────────── */
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();
const rows = (await db.collection('settlement_rows').get()).docs.map((d) => d.data() as Record<string, unknown>)
  .filter((r) => S(r.billMonth) === MONTH && r.cancelled !== true);

console.log(`\n■ ${MONTH} 실물 ${rows.length}줄 — 그 칸이 «실제로» 차 있나\n`);
if (!rows.length) { console.log('   그 달 줄이 없습니다.\n'); process.exit(없는.length ? 1 : 0); }

const 빈칸: { 칸: string; n: number }[] = [];
for (const c of SETTLE_COLUMNS) {
  const w = 출처[c.name];
  if (!w?.field) continue;
  const n = rows.filter((r) => !S(r[w.field!]) || S(r[w.field!]) === '0').length;
  if (n) 빈칸.push({ 칸: c.name, n });
}
for (const { 칸, n } of 빈칸.sort((a, b) => b.n - a.n)) {
  const 몫 = Math.round((n / rows.length) * 100);
  console.log(`   ${pad(칸, 18)} ${String(n).padStart(3)} / ${rows.length} 줄이 빔  (${몫}%)`);
}
if (!빈칸.length) console.log('   ✓ 모든 칸이 다 차 있습니다.');

/** 돈은 «엔진이» 낸다 — 한 줄이라도 못 내면 정산서를 못 만든다. */
const 못셈 = rows.filter((r) => {
  const m = invoiceMoneyOf(r as never);
  return !Number.isFinite(m.net) || !Number.isFinite(m.vat);
}).length;
const 청구합 = rows.reduce((a, r) => a + claimOf(r as unknown as SettlementRow), 0);
const 지급합 = rows.reduce((a, r) => a + payOf(r as unknown as SettlementRow), 0);
console.log(`\n   돈 — 청구 ${청구합.toLocaleString('ko-KR')} · 지급 ${지급합.toLocaleString('ko-KR')} · 못 셈한 줄 ${못셈}`);

console.log(`\n  ${없는.length || 못셈 ? '✕ 원자만으로는 정산서를 다 못 채웁니다.' : '✓ 정산서 칸이 원자에서 다 나옵니다 — 시트 없이 만들 수 있습니다.'}\n`);
process.exit(없는.length || 못셈 ? 1 : 0);
