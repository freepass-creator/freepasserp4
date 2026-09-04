/**
 * **환수 한 건을 원자에 박는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-03 「34호5297 김대운 7월 출고건입니다 리더스렌터카 -66만원 이라는데 환수」.
 *
 * ★★**환수는 «축이 둘»이다.** 공급사에서 토해내는 것(`supplierAmt`)과 영업채널에서 되돌려받는
 *   것(`agentAmt`)은 «다른 돈»이다. 한쪽만 적으면 다른 쪽 정산이 그대로 나간다.
 *   ⇒ 그래서 둘을 «따로» 받는다. 안 주면 0 — 짐작해서 채우지 않는다.
 *
 * ★★★**금액은 «공급가액»으로 적는다.** 부가세는 정산할 때 붙는다.
 *   「-66만원」처럼 부가세가 붙은 값을 그대로 넣으면 정산에서 한 번 더 붙어 72.6만이 된다.
 *   ⇒ `--gross` 를 주면 1.1로 나눠 공급가액으로 바꿔 넣는다.
 *
 * ⚠ 열쇠는 `<차번>_<달>` 이다 — 같은 차·같은 달에 두 번 적히지 않는다.
 *
 *   npx tsx scripts/add-clawback.mts --plate=34호5297 --month=2026-09 --supplier=600000
 *   npx tsx scripts/add-clawback.mts --plate=34호5297 --month=2026-09 --supplier=660000 --gross --apply
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const arg = (k: string) => S((process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('='));
const APPLY = process.argv.includes('--apply');
const GROSS = process.argv.includes('--gross');
const VAT = 0.1;

const PLATE = arg('plate').replace(/\s/g, '');
const MONTH = arg('month');
if (!PLATE || !/^\d{4}-\d{2}$/.test(MONTH)) {
  console.log('\n  차번과 달을 주세요 — --plate=34호5297 --month=2026-09 --supplier=600000 [--agent=500000] [--gross] [--apply]\n');
  process.exit(1);
}
/** ★적힌 값이 부가세를 담고 있으면 공급가액으로 되돌린다. */
const net = (v: number) => (GROSS ? Math.round(v / (1 + VAT)) : v);
const supplierAmt = net(N(arg('supplier')));
const agentAmt = net(N(arg('agent')));
const reason = arg('reason');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();

type Row = Record<string, unknown>;
const rows = Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[];
const hit = rows.filter((r) => S(r.plate).replace(/\s/g, '') === PLATE);
if (hit.length !== 1) { console.log(`\n  ✕ ${PLATE} 를 «하나»로 못 찾았습니다(${hit.length}건)\n`); process.exit(1); }
const r = hit[0];

const key = `${PLATE}_${MONTH}`;
const already = (await db.ref(`v4/settlement_clawbacks/${key}`).get()).val();

console.log(`\n■ 환수 ${key} ${APPLY ? '(반영)' : '(대조만)'}`);
console.log(`   차량 ${S(r.plate)} · ${S(r.customer)} · ${S(r.model)} · ${S(r.product)} ${N(r.term)}개월`);
console.log(`   공급사 ${S(r.supplier)} · 영업채널 ${S(r.channel)}`);
console.log(`   접수 ${S(r.receivedAt)} · 인도 ${S(r.deliveredAt)} · 청구월 ${S(r.billMonth) || '(비어 있음)'}`);
console.log(`   원래 청구 ${won(N(r.claimWritten))} · 지급 ${won(N(r.payWritten))}`);
console.log('');
console.log(`   공급사에서 토해내는 것  ${won(supplierAmt)}  (부가세 포함 ${won(supplierAmt + Math.round(supplierAmt * VAT))})`);
console.log(`   영업채널에서 되돌리는 것 ${agentAmt ? `${won(agentAmt)}  (부가세 포함 ${won(agentAmt + Math.round(agentAmt * VAT))})` : '0  — 안 주셔서 0으로 둡니다'}`);
if (already) console.log(`\n   ⚠ 이미 있습니다 — 공급사 ${won(N((already as Row).supplierAmt))} · 채널 ${won(N((already as Row).agentAmt))}. 덮어씁니다.`);
if (!supplierAmt && !agentAmt) { console.log('\n  ✕ 금액이 둘 다 0입니다\n'); process.exit(1); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 박았습니다. --apply 로 박습니다.\n'); process.exit(0); }

await db.ref(`v4/settlement_clawbacks/${key}`).set({
  plate: S(r.plate), supplier: S(r.supplier), channel: S(r.channel), month: MONTH,
  supplierAmt, agentAmt, reason, at: new Date().toISOString().slice(0, 10),
  by: 'add-clawback', updatedAt: Date.now(),
});
console.log(`\n   ✓ 박았습니다 — ${MONTH} 정산에 실립니다\n`);
process.exit(0);
