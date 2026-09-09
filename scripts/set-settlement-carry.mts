/**
 * **다음 달로 «넘길 것»을 줄에 박는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★★★사장님 2026-09-09 「**이런 거 다 남겨 둬**」
 *   · 「손오공은 8월에 50% 청구한 거 9월에 50% 청구로 가야 하고」
 *   · 「하허호는 9월에 환수 만 원 해야 함, 과청구 환수 1.5% 환수해야 함」
 *
 * 이런 것들은 **이 달 표에는 안 나오는데 다음 달에 반드시 해야 하는 일**이다.
 * 머릿속에 두면 다음 달에 사라진다 — 사라진 만큼이 못 받은 돈이거나 못 준 돈이다.
 * ⇒ 그 줄에 «금액과 함께» 박아 두고, `npm run settlement:ask 넘길것` 한 마디로 꺼낸다.
 *
 * ⚠ **청구만 넘기지 않는다.** 잔여를 받을 때 영업자에게 줄 몫도 같이 생긴다.
 *   `--claim` 만 주고 `--pay` 를 안 주면 물어본다 — 한쪽만 남기면 「받고도 안 주는」 사고다.
 *
 * ```
 * # 한 줄에 박기 — 차번(또는 코드)으로 찾는다. 달이 여럿이면 --month 로 좁힌다
 * npx tsx scripts/set-settlement-carry.mts --plate 161하1284 --month 2026-08 \
 *   --to 2026-09 --claim 616200 --pay 474000 --note "손오공 50% 잔여 — 2회차 입금분" --apply
 *
 * # 여러 줄을 한꺼번에 — JSON 파일로
 * npx tsx scripts/set-settlement-carry.mts --file tmp/carry.json --apply
 *
 * # 지우기
 * npx tsx scripts/set-settlement-carry.mts --plate 161하1284 --month 2026-08 --clear --apply
 * ```
 *
 * `--file` 의 모양 (배열):
 * ```json
 * [{ "plate": "161하1284", "month": "2026-08", "to": "2026-09",
 *    "claim": 616200, "pay": 474000, "note": "손오공 50% 잔여" }]
 * ```
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
/** ★쓰기 전에 «규격»으로 잰다 — 원자에 없는 밭이나 다른 형을 넣으면 그 줄이 조용히 썩는다. */
import { atomField } from '../lib/domain/settlement/engine';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => Number(S(v).replace(/[,\s원]/g, '')) || 0;
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? S(argv[i + 1]) : ''; };
const has = (k: string) => argv.includes(`--${k}`);
const APPLY = has('apply');
const CLEAR = has('clear');

type Job = { plate?: string; code?: string; month?: string; to?: string;
  claim?: number; pay?: number; prepaid?: number; note?: string; clear?: boolean };
let jobs: Job[] = [];
if (arg('file')) jobs = JSON.parse(readFileSync(arg('file'), 'utf8')) as Job[];
else if (arg('plate') || arg('code')) jobs = [{
  plate: arg('plate'), code: arg('code'), month: arg('month'), to: arg('to'),
  claim: arg('claim') ? N(arg('claim')) : undefined, pay: arg('pay') ? N(arg('pay')) : undefined,
  prepaid: arg('prepaid') ? N(arg('prepaid')) : undefined, note: arg('note'), clear: CLEAR,
}];
if (!jobs.length) { console.log('\n  무엇을 넘길까요 — --plate 161하1284 --month 2026-08 --to 2026-09 --claim … --pay … --note "…"\n'); process.exit(1); }

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const fsdb = getFirestore();

const snap = await fsdb.collection('settlement_rows').get();
const all = snap.docs.map((d) => ({ id: d.id, r: d.data() as Record<string, unknown> }));

console.log(`\n■ 넘길 것 ${jobs.length}가지 ${APPLY ? '(반영)' : '(대조만)'}\n`);
const writes: { id: string; patch: Record<string, unknown>; label: string }[] = [];
const bad: string[] = [];
for (const j of jobs) {
  const hit = all.filter(({ r }) => (j.code ? S(r.code) === S(j.code) : S(r.plate) === S(j.plate))
    && (!j.month || S(r.billMonth) === S(j.month)) && r.cancelled !== true);
  const who = `${S(j.plate) || S(j.code)}${j.month ? ` ${j.month}` : ''}`;
  if (!hit.length) { bad.push(`${who} — 원자에 없습니다`); continue; }
  if (hit.length > 1) { bad.push(`${who} — ${hit.length}줄이 걸립니다. --month 로 좁혀 주세요 (${hit.map((h) => S(h.r.billMonth)).join(' · ')})`); continue; }
  const { id, r } = hit[0];
  if (j.clear || CLEAR) {
    writes.push({ id, patch: { carryNote: '', carryMonth: '', carryClaim: 0, carryPay: 0, prepaid: 0, updatedAt: Date.now() },
      label: `${pad(who, 20)} 지움` });
    continue;
  }
  /** ⚠ 청구만 넘기면 «받고도 안 주는» 사고가 된다 — 짝을 확인한다. */
  if (j.claim && j.pay === undefined) bad.push(`${who} — 넘길 청구만 있고 지급이 없습니다. 정말 없으면 --pay 0 을 적어 주세요`);
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (j.note !== undefined) patch.carryNote = S(j.note);
  if (j.to !== undefined) patch.carryMonth = S(j.to);
  if (j.claim !== undefined) patch.carryClaim = N(j.claim);
  if (j.pay !== undefined) patch.carryPay = N(j.pay);
  if (j.prepaid !== undefined) patch.prepaid = N(j.prepaid);
  writes.push({ id, patch,
    label: `${pad(who, 20)} ${pad(S(r.customer), 8)} ${pad(S(r.supplier) || '-', 9)} → ${pad(S(j.to) || S(r.carryMonth) || '-', 8)}`
      + `${j.claim !== undefined ? ` 청구 ${won(N(j.claim)).padStart(10)}` : ''}${j.pay !== undefined ? ` · 지급 ${won(N(j.pay)).padStart(10)}` : ''}`
      + `${j.prepaid !== undefined ? ` · 선지급 ${won(N(j.prepaid)).padStart(10)}` : ''}   ${S(j.note)}` });
}
for (const w of writes) console.log(`   ${w.label}`);
if (bad.length) {
  console.log(`\n  ✕ ${bad.length}가지를 못 박습니다 — 하나라도 어긋나면 아무것도 안 씁니다.\n`);
  for (const x of bad) console.log(`     ${x}`);
  console.log('');
  process.exit(1);
}
const sum = writes.reduce((a, w) => ({ c: a.c + N(w.patch.carryClaim), p: a.p + N(w.patch.carryPay), pre: a.pre + N(w.patch.prepaid) }), { c: 0, p: 0, pre: 0 });
console.log(`\n   합계  넘길 청구 ${won(sum.c)} · 넘길 지급 ${won(sum.p)} · 선지급 ${won(sum.pre)}`);

/**
 * ★★**쓰기 전 규격 검증** — 사장님 2026-09-09 「**원자 검증을 잘해서 붙여.
 *   파이어스토어에 한 번만 잘 입력해 놓으면 되잖아**」
 *   한 번에 제대로 넣으려면 «넣기 전»에 재야 한다. 규격에 없는 밭·다른 형이 들어가면
 *   그 줄은 검사도 통과하고 화면에도 안 보이면서 조용히 썩는다.
 */
const wrong: string[] = [];
for (const w of writes) {
  for (const [k, v] of Object.entries(w.patch)) {
    const f = atomField(k);
    if (!f) { wrong.push(`「${k}」 는 원자 규격에 없는 밭입니다 (${w.label.trim().slice(0, 20)})`); continue; }
    const t = typeof v;
    const want = f.type === 'number' ? 'number' : f.type === 'boolean' ? 'boolean' : 'string';
    if (t !== want) wrong.push(`「${k}」 는 ${f.type} 인데 ${t} 를 넣으려 합니다`);
  }
}
if (wrong.length) {
  console.log(`\n  ✕ 규격에 안 맞는 것 ${wrong.length}가지 — 아무것도 안 씁니다.\n`);
  for (const x of wrong) console.log(`     ${x}`);
  console.log('');
  process.exit(1);
}
console.log('   ✓ 쓰기 전 규격 검증 통과 — 밭 이름·형이 원자 규격과 같습니다');

if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 박습니다.\n'); process.exit(0); }

/**
 * ★★**정본은 파이어스토어 하나다** — 사장님 2026-09-09 「**야 우리 파이어스토어를 쓰는데 뭐 RT 야**」·「RTDB 는 이제 아예 안 쓴다고」.
 *   두 곳에 쓰면 어느 쪽이 정본인지 다시 흐려진다. 여기서는 파이어스토어에만 한 번 «제대로» 쓴다.
 */
const batch = fsdb.batch();
for (const w of writes) batch.set(fsdb.collection('settlement_rows').doc(w.id), w.patch, { merge: true });
await batch.commit();

/**
 * ★★**쓴 뒤 되읽어 «한 밭씩» 맞대 본다.** 쓴 것과 박힌 것이 같다는 보장은 되읽기뿐이다.
 *   「썼습니다」가 거짓말이 된 적이 있다(2026-09-08 「✓ 5개 탭을 붙였습니다」 — 다섯 다 실패).
 */
let checked = 0; const gap: string[] = [];
for (const w of writes) {
  const back = (await fsdb.collection('settlement_rows').doc(w.id).get()).data() || {};
  for (const [k, v] of Object.entries(w.patch)) {
    if (k === 'updatedAt') continue;
    if (S(back[k]) !== S(v)) gap.push(`${w.label.trim().slice(0, 24)} — 「${k}」 넣은 값 ${S(v)} · 박힌 값 ${S(back[k])}`);
    else checked++;
  }
}
if (gap.length) {
  console.log(`\n  ✕ 되읽어 보니 ${gap.length}밭이 다릅니다 — 「썼다」고 말하지 않겠습니다.\n`);
  for (const x of gap) console.log(`     ${x}`);
  console.log('');
  process.exit(1);
}
console.log(`\n   ✓ 파이어스토어에 ${writes.length}줄 · ${checked}밭 — 되읽어 «한 밭씩» 같은 것을 확인했습니다`);

console.log('\n   꺼내 보기:  npm run settlement:ask 넘길것\n');
