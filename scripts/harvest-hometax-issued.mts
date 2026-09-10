/**
 * **홈택스가 「끊었다」고 한 것을 원자에 거둔다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★★★사장님 2026-09-09 「오토플러스는 이미 발행했다네」
 *
 * 우리 표(T01)는 「발행 0」이라고 알고 있었는데 실제로는 넉 곳이 이미 나가 있었다.
 * **발행 여부를 우리가 «정하면» 거짓말이 된다** \u2014 그래서 사람이 시트에 켜기를 기다렸는데,
 * 사람도 켜는 것을 잊는다. ⇒ **홈택스 목록이 정본이다.** 국세청이 준 종이라 우리 기억보다 세다.
 *
 * ```
 * # 홈택스 → 조회/발급 → 매출 전자세금계산서 목록조회 → 엑셀 내려받기
 * npx tsx scripts/harvest-hometax-issued.mts 2026-08 "C:/…/FR_매출세금계산서_26년1기.xls"
 * npx tsx scripts/harvest-hometax-issued.mts 2026-08 "…" --apply
 * ```
 *
 * 하는 일 셋.
 *   ① 그 달 «작성일자» 건만 골라 **사업자등록번호로 묶는다**(수정계산서 마이너스도 같이 더한다)
 *   ② 우리 계산(원자)과 맞대 본다 \u2014 갈리면 **어느 법인이 얼마나** 갈리는지 말한다
 *   ③ 원자에 `invoiceIssued`·`invoiceAt` 을 켠다 (그 달 · 그 법인 줄만)
 *
 * ⚠ **금액이 갈려도 «발행 사실»은 켠다.** 나간 것은 나간 것이다 \u2014 갈린 금액은 따로 본다.
 *   ⚠ 우리가 «안 켜는» 것 하나 \u2014 수금(`collected`). 그건 통장을 봐야 안다.
 */
import { readFileSync } from 'node:fs';
import XLSX from 'xlsx';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { invoiceMoneyOf } from '../lib/domain/settlement/engine';
import { PARTNER_CI } from '../lib/domain/partner-ci';

const S = (v: unknown) => String(v ?? '').trim();
const P = (v: unknown) => S(v).replace(/[^0-9]/g, '');
const N = (v: unknown) => Number(S(v).replace(/[,\s원]/g, '')) || 0;
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const APPLY = process.argv.includes('--apply');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const MONTH = args.find((a) => /^\d{4}-\d{2}$/.test(a)) || '';
const FILE = args.find((a) => /\.xlsx?$/i.test(a)) || '';
if (!MONTH || !FILE) { console.log('\n  달과 파일을 적어 주세요 — npx tsx scripts/harvest-hometax-issued.mts 2026-08 "…/FR_매출세금계산서_26년1기.xls" [--apply]\n'); process.exit(1); }

/** ★홈택스 목록의 칸 자리 — 이름이 아니라 «자리»다(상호·종사업장번호가 공급자·공급받는자에 두 번 나온다). */
const COL = { 작성일자: 0, 발급일자: 2, 받는자번호: 9, 받는자상호: 11, 합계: 14, 공급가액: 15, 세액: 16 } as const;

const wb = XLSX.read(readFileSync(FILE), { type: 'buffer' });
const sheet = wb.Sheets[wb.SheetNames.find((n) => /세금계산서/.test(n)) || wb.SheetNames[0]];
const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
const hi = grid.findIndex((r) => (r || []).some((c) => S(c) === '작성일자'));
if (hi < 0) { console.log('\n  ✕ 「작성일자」 머리를 못 찾았습니다 — 홈택스 목록 파일이 맞나요?\n'); process.exit(1); }

/** ①그 달 작성분만 · 사업자번호로 묶는다. 수정계산서(마이너스)도 «같은 묶음»에 더한다. */
type Bag = { biz: string; name: string; net: number; vat: number; sheets: number; last: string };
const bag = new Map<string, Bag>();
for (const r of grid.slice(hi + 1)) {
  const made = S(r[COL.작성일자]);
  if (!made.startsWith(MONTH)) continue;
  const k = P(r[COL.받는자번호]); if (!k) continue;
  const e = bag.get(k) || { biz: S(r[COL.받는자번호]), name: S(r[COL.받는자상호]), net: 0, vat: 0, sheets: 0, last: '' };
  e.net += N(r[COL.공급가액]); e.vat += N(r[COL.세액]); e.sheets++;
  const at = S(r[COL.발급일자]); if (at > e.last) e.last = at;
  bag.set(k, e);
}
if (!bag.size) { console.log(`\n  ${MONTH} 작성분이 그 파일에 없습니다.\n`); process.exit(0); }

/* ── ② 우리 계산과 맞대 본다 ─────────────────────────────────────── */
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const fsdb = getFirestore();
const docs = (await fsdb.collection('settlement_rows').get()).docs
  .filter((d) => { const r = d.data(); return S(r.billMonth) === MONTH && r.cancelled !== true; });
const bizOf = (name: string) => P(PARTNER_CI.find((c) => S(c.alias) === S(name))?.bizNo);
const ours = new Map<string, number>();
for (const d of docs) {
  const r = d.data(); const k = P(r.invoiceBiz) || bizOf(S(r.supplier)); if (!k) continue;
  ours.set(k, (ours.get(k) || 0) + invoiceMoneyOf(r as never).net);
}
/**
 * ★★**환수를 빼야 «같은 금액»이 된다.** 홈택스에 나간 것은 환수까지 반영된 값이다
 *   (오토플러스는 아예 마이너스 계산서 한 장을 따로 끊었다).
 *   ⚠ 안 빼면 멀쩡한 곳이 「갈린다」고 나온다 — 2026-09-09 에 오토플러스·리더스가 그렇게 잡혔다.
 */
for (const c of (await fsdb.collection('settlement_clawbacks').get()).docs) {
  const r = c.data(); if (S(r.month) !== MONTH) continue;
  const k = bizOf(S(r.supplier)); if (!k || !ours.has(k)) continue;
  ours.set(k, (ours.get(k) || 0) - N(r.supplierAmt));
}

console.log(`\n■ ${MONTH} 홈택스가 끊었다고 한 것 — 법인 ${bag.size}곳\n`);
console.log(`   ${pad('거래처', 24)} ${pad('사업자번호', 15)} 장  ${pad('홈택스 공급가액', 15)} ${pad('우리 계산', 14)} 발급일`);
const gap: string[] = [];
for (const [k, e] of [...bag].sort((a, b) => b[1].net - a[1].net)) {
  const mine = ours.get(k);
  const same = mine !== undefined && Math.abs(mine - e.net) <= 1;
  if (mine !== undefined && !same) gap.push(`${e.name} — 홈택스 ${won(e.net)} · 우리 ${won(mine)} (차 ${won(e.net - mine)})`);
  console.log(`   ${same ? '✓' : mine === undefined ? '?' : '✕'} ${pad(e.name, 22)} ${pad(e.biz, 15)} ${String(e.sheets).padStart(2)}  ${won(e.net).padStart(15)} ${(mine === undefined ? '(우리 표에 없음)' : won(mine)).padStart(14)}  ${e.last}`);
}

/* ── ③ 원자에 「발행」을 켠다 ──────────────────────────────────────── */
const writes: { id: string; patch: Record<string, unknown>; who: string }[] = [];
for (const d of docs) {
  const r = d.data(); const k = P(r.invoiceBiz) || bizOf(S(r.supplier));
  const e = k ? bag.get(k) : undefined; if (!e) continue;
  const at = e.last.replace(/[^\d]/g, '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  if (r.invoiceIssued === true && S(r.invoiceAt) === at) continue;
  writes.push({ id: d.id, patch: { invoiceIssued: true, invoiceAt: at, invoiceBiz: e.biz, updatedAt: Date.now() }, who: `${S(r.plate) || '(차번없음)'} ${S(r.supplier)}` });
}
console.log(`\n   원자에 「발행」을 켤 줄 ${writes.length}개`);
if (gap.length) { console.log(`\n   ⚠ 금액이 갈리는 곳 ${gap.length}`); for (const x of gap) console.log(`      ${x}`); console.log('   ※ 나간 것은 나간 것이라 «발행 사실»은 켭니다 — 갈린 금액은 따로 봐야 합니다.'); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 켭니다.\n'); process.exit(0); }
for (let i = 0; i < writes.length; i += 400) {
  const b = fsdb.batch();
  for (const w of writes.slice(i, i + 400)) b.set(fsdb.collection('settlement_rows').doc(w.id), w.patch, { merge: true });
  await b.commit();
}
/** ★되읽어 «한 밭씩» 맞대 본다 — 「켰다」가 거짓말이 되지 않게. */
const bad: string[] = [];
for (const w of writes) {
  const back = (await fsdb.collection('settlement_rows').doc(w.id).get()).data() || {};
  for (const [k2, v] of Object.entries(w.patch)) if (k2 !== 'updatedAt' && S(back[k2]) !== S(v)) bad.push(`${w.who}.${k2}`);
}
if (bad.length) { console.log(`\n  ✕ 되읽기에서 ${bad.length}밭이 다릅니다 — ${bad.slice(0, 5).join(' · ')}\n`); process.exit(1); }
console.log(`\n   ✓ ${writes.length}줄에 「발행」을 켰습니다 — 되읽어 확인`);
console.log('   시트에도 실으려면:  npx tsx scripts/publish-invoice-workbook.mts ' + MONTH + ' --apply\n');
