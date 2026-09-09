/**
 * **사슬 대조 — 원장(F04) → 원자 → 계산서(F06) 가 한 줄로 이어지는가.** 읽기만 한다.
 *
 * ★★★사장님 2026-09-09 「**ssot 관리 잘하고 이거 정산원장이랑도 맞춘 거야??**」
 *
 * 계산서(F06)는 **공급사 정산서**와 맞대 왔다(`publish-invoice-workbook` 이 그 자리에서 잰다).
 * 그런데 그 위 — **원장**과는 «직접» 맞댄 적이 없었다. 원자가 원장에서 나왔으니 이어져 «있을 것»이라
 * 믿고 있었을 뿐이다. 믿음은 SSOT 가 아니다. ⇒ 사슬을 **끝에서 끝까지** 잰다.
 *
 * ```
 *   [F04] 정산원장          원자(settlement_rows)        [F06] 계산서
 *   청구년·청구월로 고른 줄  ──▶  claimOf/payOf      ──▶  공급가액 + 부가세
 *          │                        │                        │
 *          └── ①그 달 공급사 청구 안 하는 줄 ─┘                │
 *                                   └── ②환수 ③부가세 포함분 ─┘
 * ```
 *
 * **다리 셋을 «이름 붙여» 넘는다.** 총액이 다른 것은 사고가 아니라 규칙일 수 있다 —
 * 다만 그 규칙이 **이름을 갖고 설명되어야** 사고와 구별된다. 이름 없는 차이는 전부 사고로 본다.
 *
 *   ① **그 달 공급사에 청구하지 않는 줄** — 원장 메모가 그렇게 적혀 있다
 *      (「영업사만 정산해야함」 · 「프리패스지급 (공급사미청구)」 · 「공급사정산 완료」 · 「업무지원비」)
 *      ⇒ 원장 「판매 수수료」 칸에 금액이 적혀 있어도 그 달 청구가 아니다. 지급만 나간다.
 *   ② **환수** — 계산서에서 빼고 끊는다
 *   ③ **부가세 포함으로 적힌 줄** — 계산서는 «공급가액»이라 1.1 로 나눈다
 *
 * ⚠ **지급 축은 다리가 없다.** 원장 지급 = 원자 지급이 그대로 같아야 한다.
 *   갈리면 그건 규칙이 아니라 사고다(영업자에게 줄 돈이 틀린 것).
 *
 * ```
 * npm run check:chain            이번 달
 * npm run check:chain 2026-08    그 달
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SETTLEMENT_LEDGER_ID as LEDGER, SETTLEMENT_INTAKE_TAB, SETTLEMENT_WATCH_TAB, SETTLEMENT_DONE_TAB } from '../lib/domain/settlement-ledger';
/** ★돈은 «엔진 문»으로만 센다 — 여기서 손으로 다시 셈하면 그 순간 정본이 둘이 된다. */
import { claimOf, payOf, invoiceMoneyOf, clawMoneyOf, type SettlementRow } from '../lib/domain/settlement/engine';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => Number(S(v).replace(/[,\s원]/g, '')) || 0;
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const now = new Date();
const MONTH = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const [YY, MM] = MONTH.split('-').map(Number);
/** ★원장은 «세 탭에 누적»이다 — 청구 탭이 아니라 이 셋에서 청구년·청구월로 고른다(원자화와 같은 길). */
const LEDGER_TABS = [SETTLEMENT_INTAKE_TAB, SETTLEMENT_DONE_TAB, SETTLEMENT_WATCH_TAB];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const fsdb = getFirestore();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;
const nap = (ms: number) => new Promise((z) => setTimeout(z, ms));
const readTab = async (id: string, tab: string): Promise<string[][]> => {
  for (let t = 0; t < 6; t++) {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${tab}'!A1:BZ900`)}?valueRenderOption=UNFORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${await tok()}` } });
    if (r.ok) return (((await r.json()) as { values?: unknown[][] }).values || []).map((v) => (v || []).map(S));
    if (r.status === 429 || r.status >= 500) { console.log(`   · 「${tab}」 ${r.status} — 20초 쉬었다 다시 (${t + 1}/6)`); await nap(20_000); continue; }
    console.log(`\n  ✕ 「${tab}」 를 못 읽었습니다 ${r.status}\n`); process.exit(1);
  }
  console.log(`\n  ✕ 「${tab}」 — 한도에 계속 걸립니다\n`); process.exit(1);
};

console.log(`\n■ ${MONTH} 사슬 대조 — 원장(F04) → 원자 → 계산서(F06)\n`);

/* ── ① 원장 F04 ───────────────────────────────────────────────────── */
type L = { plate: string; cust: string; sup: string; claim: number; pay: number; memo: string };
const led: L[] = []; let cancelled = 0;
for (const t of LEDGER_TABS) {
  const g = await readTab(LEDGER, t);
  const hi = g.findIndex((x) => x.includes('차량번호'));
  if (hi < 0) continue;
  const H = g[hi];
  const c = (...names: string[]) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return i; } return -1; };
  const iy = c('청구년'); const im = c('청구월');
  if (iy < 0 || im < 0) { console.log(`  ✕ 「${t}」 에 청구년·청구월 열이 없습니다 — 멈춥니다\n`); process.exit(1); }
  /** ★**「수식X」가 이긴다** — 손으로 적은 값이 정본이다(2026-09-01 사고). 비었을 때만 식 값을 쓴다. */
  const iY = c('판매 수수료', '판매수수료'); const iZ = c('판매 수수료 (수식X)');
  const iAL = c('출고수수료'); const iAM = c('출고 수수료 (수식X)');
  const iCI = c('공급사인센티브'); const iAI = c('에이전시인센티브');
  const iCan = c('취소'); const iSup = c('업체명', '공급사'); const iPl = c('차량번호');
  const iCu = c('고객명'); const iMemo = c('계약번호', '비고');
  for (const r of g.slice(hi + 1)) {
    if (N(r[iy]) !== YY || N(r[im]) !== MM) continue;
    if (/^(TRUE|true|O|o|Y|y|1|취소)$/.test(S(r[iCan]))) { cancelled++; continue; }
    led.push({
      plate: S(r[iPl]) || '(차번없음)', cust: S(r[iCu]), sup: S(r[iSup]), memo: iMemo >= 0 ? S(r[iMemo]) : '',
      claim: (iZ >= 0 && S(r[iZ]) ? N(r[iZ]) : N(r[iY])) + (iCI >= 0 ? N(r[iCI]) : 0),
      pay: (iAM >= 0 && S(r[iAM]) ? N(r[iAM]) : N(r[iAL])) + (iAI >= 0 ? N(r[iAI]) : 0),
    });
  }
}
const LC = led.reduce((a, r) => a + r.claim, 0); const LP = led.reduce((a, r) => a + r.pay, 0);

/* ── ② 원자 ───────────────────────────────────────────────────────── */
const atoms = (await fsdb.collection('settlement_rows').get()).docs.map((d) => d.data() as Record<string, unknown>)
  .filter((r) => S(r.billMonth) === MONTH && r.cancelled !== true);
const AC = atoms.reduce((a, r) => a + claimOf(r as unknown as SettlementRow), 0);
const AP = atoms.reduce((a, r) => a + payOf(r as unknown as SettlementRow), 0);
const claws = (await fsdb.collection('settlement_clawbacks').get()).docs.map((d) => d.data() as Record<string, unknown>)
  .filter((c) => S(c.month) === MONTH);
const claw = claws.reduce((a, c) => a + N(c.supplierAmt), 0);
/**
 * ③ 부가세 포함으로 적힌 줄 — 계산서는 공급가액이라 그만큼 내려간다.
 * ★가르는 셈은 «엔진»이 한다(`invoiceMoneyOf`). 여기서 총액에 1.1 을 걸면 발행기와 1원 갈린다.
 */
const paper = atoms.reduce((a, r) => { const m = invoiceMoneyOf(r as never); return { net: a.net + m.net, vat: a.vat + m.vat }; }, { net: 0, vat: 0 });
const vatCut = AC - paper.net;

console.log(`   ${pad('원장 F04', 12)} ${String(led.length).padStart(3)}줄${cancelled ? `(취소 ${cancelled} 뺌)` : ''}   청구 ${won(LC).padStart(13)} · 지급 ${won(LP).padStart(13)}`);
console.log(`   ${pad('원자', 12)} ${String(atoms.length).padStart(3)}줄            청구 ${won(AC).padStart(13)} · 지급 ${won(AP).padStart(13)}`);

/* ── ③ 다리 — 이름 붙여 넘는다 ────────────────────────────────────── */
const bad: string[] = [];
/** ⚠ 지급 축은 다리가 없다. 갈리면 사고다. */
if (Math.abs(LP - AP) > 1) bad.push(`지급이 갈립니다 — 원장 ${won(LP)} · 원자 ${won(AP)} (지급 축엔 다리가 없습니다)`);
if (led.length !== atoms.length) bad.push(`줄 수가 갈립니다 — 원장 ${led.length}줄 · 원자 ${atoms.length}줄`);

/** ①의 정체를 «줄로» 밝힌다 — 총액만 보면 어느 차인지 모른다(2026-09-08 149,999 사고). */
const byPlate = new Map<string, L>();
for (const r of led) { const e = byPlate.get(r.plate); if (e) { e.claim += r.claim; e.pay += r.pay; } else byPlate.set(r.plate, { ...r }); }
const aByPlate = new Map<string, { claim: number; target: string; why: string; cust: string; sup: string }>();
for (const r of atoms) {
  const k = S(r.plate) || '(차번없음)';
  const e = aByPlate.get(k);
  const c = claimOf(r as unknown as SettlementRow);
  if (e) e.claim += c;
  else aByPlate.set(k, { claim: c, target: S(r.settleTarget), cust: S(r.customer), sup: S(r.supplier), why: S(r.settleNote) || S(r.note) });
}
let bridge = 0; const named: string[] = [];
for (const k of [...new Set([...byPlate.keys(), ...aByPlate.keys()])].sort()) {
  const l = byPlate.get(k); const a = aByPlate.get(k);
  const d = (a?.claim || 0) - (l?.claim || 0);
  if (Math.abs(d) <= 1) continue;
  const why = S(a?.why);
  /** ★이름이 있으면 다리, 없으면 사고. */
  if (a && a.target && a.target !== '양쪽' && why) { bridge += -d; named.push(`${pad(k, 11)} ${pad(a.cust, 9)} ${pad(a.sup, 9)} ${won(-d).padStart(11)}  「${why}」`); }
  else bad.push(`${k} ${a?.cust || l?.cust || ''} — 원장 ${won(l?.claim || 0)} · 원자 ${won(a?.claim || 0)} (까닭이 안 적혀 있습니다)`);
}
if (named.length) {
  console.log(`\n   ① 그 달 공급사에 «청구하지 않는» 줄 ${named.length}개 — 원장 메모가 그렇게 적혀 있습니다`);
  for (const x of named) console.log(`      ${x}`);
}
console.log(`\n   ${pad('원장 청구', 14)} ${won(LC).padStart(13)}`);
if (bridge) console.log(`   ${pad('① 미청구', 14)} ${won(-bridge).padStart(13)}`);
console.log(`   ${pad('= 원자 청구', 14)} ${won(AC).padStart(13)}${Math.abs(LC - bridge - AC) > 1 ? '   ✕ 안 맞습니다' : ''}`);
if (claw) console.log(`   ${pad('② 환수', 14)} ${won(-claw).padStart(13)}`);
if (vatCut) console.log(`   ${pad('③ 부가세분', 14)} ${won(-vatCut).padStart(13)}   (부가세 포함으로 적힌 줄을 공급가액으로)`);
const paperNet = paper.net - claw;
const paperVat = paper.vat - clawMoneyOf(claw).vat;
console.log(`   ${pad('= 계산서 공급가액', 14)} ${won(paperNet).padStart(13)}`);
console.log(`   ${pad('  부가세', 14)} ${won(paperVat).padStart(13)}`);
console.log(`   ${pad('  합계', 14)} ${won(paperNet + paperVat).padStart(13)}`);
if (Math.abs(LC - bridge - AC) > 1) bad.push(`원장 청구에서 다리를 넘어도 원자와 안 맞습니다 — ${won(LC - bridge)} vs ${won(AC)}`);

if (bad.length) {
  console.log(`\n  ✕ ${bad.length}가지가 어긋납니다 — 원장과 계산서가 한 줄로 안 이어집니다.\n`);
  for (const x of bad) console.log(`     ${x}`);
  console.log('');
  process.exit(1);
}
console.log('\n   ✓ 원장 → 원자 → 계산서가 한 줄로 이어집니다. 넘은 다리는 전부 이름이 있습니다.\n');
