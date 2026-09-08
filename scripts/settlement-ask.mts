/**
 * **정산을 «원자에게» 묻는다 — 시트를 안 연다.** — `npm run settlement:ask <말>`
 *
 * ★★★사장님 2026-09-08 「지금 정산에 있는 거 다 원자화해서 상태값으로 관리해야 해.
 *   **내가 시트 안 보고 너한테 물어봐도 니가 대답할 수 있어야지**」
 *
 * ★★**시트를 안 읽는다.** 파이어스토어 원자만 본다 — 그게 이 도구의 전부다.
 *   시트를 읽으면 「원자가 정본」이 거짓말이 되고, 느리고, 한도(429)에 걸린다.
 *
 * ```
 * npm run settlement:ask 161호1543       차번으로
 * npm run settlement:ask 송해민          이름으로
 * npm run settlement:ask 하허호          채널로 — 그 달 요약
 * npm run settlement:ask 웰릭스 2026-08  공급사 + 달
 * npm run settlement:ask 정정            지금 «정정» 걸린 것만
 * npm run settlement:ask 접수            아직 청구 안 나간 것만
 * ```
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const S = (v: unknown) => String(v ?? '').trim();
const P = (v: unknown) => S(v).replace(/\s/g, '');
const N = (v: unknown) => Number(S(v).replace(/[,\s원]/g, '')) || 0;
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const MONTH = args.find((a) => /^\d{4}-\d{2}$/.test(a)) || '';
const Q = args.filter((a) => a !== MONTH).join(' ').trim();
if (!Q && !MONTH) { console.log('\n  무엇을 물으실까요 — npm run settlement:ask 161호1543 · 송해민 · 하허호 · 정정\n'); process.exit(1); }

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const fs = getFirestore();

const all = (await fs.collection('settlement_rows').get()).docs.map((d) => d.data() as Record<string, unknown>);
const STAGES = ['보류', '취소', '접수', '청구', '정정', '확인'];

/** 무엇을 물었나 — 차번·이름·상대·상태 넷 중 하나로 읽는다. */
const q = P(Q);
const isStage = STAGES.includes(Q);
let hits = all.filter((r) => {
  if (MONTH && S(r.billMonth) !== MONTH) return false;
  if (!Q) return true;
  if (isStage) return S(r.stage) === Q;
  return P(r.plate).includes(q) || P(r.customer).includes(q)
    || P(r.supplier).includes(q) || P(r.channel).includes(q) || P(r.agent).includes(q);
});
hits = hits.sort((a, b) => `${S(b.billMonth)}${S(a.receivedAt)}`.localeCompare(`${S(a.billMonth)}${S(b.receivedAt)}`));

if (!hits.length) {
  console.log(`\n  「${Q}${MONTH ? ` ${MONTH}` : ''}」 — 원자에 없습니다.`);
  console.log('  ※ 원장(F04)에는 있는데 여기 없다면 그 달을 원자화해야 합니다:  npx tsx scripts/atomize-settlement-month.mts <달> --apply\n');
  process.exit(0);
}

/** 한 줄이면 «다» 보여 준다 — 물었으니 알고 싶은 것이다. */
if (hits.length === 1) {
  const r = hits[0];
  console.log(`\n■ ${S(r.plate) || '(차번없음)'} ${S(r.customer)}   —   ${S(r.stage) || '(상태없음)'}\n`);
  const line = (k: string, v: unknown) => { if (S(v)) console.log(`   ${pad(k, 12)} ${S(v)}`); };
  line('청구월', S(r.billMonth)); line('공급사', S(r.supplier)); line('영업채널', S(r.channel)); line('영업담당자', S(r.agent));
  line('상품구분', S(r.product)); line('계약기간', S(r.term) && `${S(r.term)}개월`);
  line('렌탈료', N(r.rent) && won(N(r.rent))); line('보증금', N(r.deposit) && won(N(r.deposit)));
  line('차량가액', N(r.price) && won(N(r.price))); line('납입방식', S(r.payKind));
  line('접수일', S(r.receivedAt)); line('인도일', S(r.deliveredAt));
  console.log('');
  console.log(`   ${pad('청구(공급사)', 12)} ${won(N(r.claimWritten) + N(r.claimIncentive))}`);
  console.log(`   ${pad('지급(영업)', 12)} ${won(N(r.payWritten) + N(r.payIncentive))}`);
  console.log('');
  console.log(`   ${pad('청구서 나감', 12)} ${r.billed === true ? `예 ${S(r.billedAt).slice(0, 10)}` : '아직'}`);
  console.log(`   ${pad('공급사', 12)} ${r.supplierFix === true ? `정정 요청${S(r.supplierFixAmt) ? ` ${won(N(r.supplierFixAmt))}` : ' (금액 안 적음)'}` : r.supplierOk === true ? '확인함' : '말 없음'}${S(r.supplierMemo) ? `  — ${S(r.supplierMemo)}` : ''}`);
  console.log(`   ${pad('영업채널', 12)} ${r.channelFix === true ? `정정 요청${S(r.channelFixAmt) ? ` ${won(N(r.channelFixAmt))}` : ' (금액 안 적음)'}` : r.channelOk === true ? '확인함' : '말 없음'}${S(r.channelMemo) ? `  — ${S(r.channelMemo)}` : ''}`);
  if (S(r.settleNote)) console.log(`\n   ${pad('산정 조건', 12)} ${S(r.settleNote)}`);
  if (S(r.note)) console.log(`   ${pad('비고', 12)} ${S(r.note)}`);
  console.log(`\n   ※ 「수금·지급완료」는 원자가 모릅니다 — 통장을 봐야 합니다.\n`);
  process.exit(0);
}

/** 여럿이면 «표»로. 물은 것이 사람인지 상대인지 상태인지에 따라 요약이 달라진다. */
console.log(`\n■ 「${Q}${MONTH ? ` · ${MONTH}` : ''}」 — ${hits.length}줄\n`);
for (const r of hits.slice(0, 60)) {
  console.log(`   ${pad(S(r.stage) || '-', 5)} ${pad(S(r.billMonth) || '(달없음)', 9)} ${pad(S(r.plate) || '(차번없음)', 11)} ${pad(S(r.customer), 16)}`
    + ` ${pad(S(r.supplier) || '-', 9)} ${pad(S(r.channel) || '-', 8)} 청구 ${won(N(r.claimWritten) + N(r.claimIncentive)).padStart(11)} · 지급 ${won(N(r.payWritten) + N(r.payIncentive)).padStart(11)}`);
}
if (hits.length > 60) console.log(`   … 그 밖 ${hits.length - 60}줄`);
const sum = hits.reduce((a, r) => ({ c: a.c + N(r.claimWritten) + N(r.claimIncentive), p: a.p + N(r.payWritten) + N(r.payIncentive) }), { c: 0, p: 0 });
console.log(`\n   합계   청구 ${won(sum.c)} · 지급 ${won(sum.p)} · 우리 몫 ${won(sum.c - sum.p)}`);
const st = new Map<string, number>();
for (const r of hits) st.set(S(r.stage) || '-', (st.get(S(r.stage) || '-') || 0) + 1);
console.log(`   상태   ${[...st].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`);
process.exit(0);
