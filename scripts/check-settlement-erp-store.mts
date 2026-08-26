/**
 * **ERP 저장소로 접수·수정이 실제로 되나.** 넣고 → 고치고 → 지운다(자국을 안 남긴다).
 *
 * ★사장님 2026-08-26 「시트는 데이터 한 번 가져갈 때만, 그 뒤엔 파이어베이스에 기입해서 정산」.
 *
 * ★★**돌아가는 서버에 대고 시험한다.** 저장 경계(`settlement-store.ts`)가 `server-only` 를
 *   물어서 스크립트에서 직접 못 부른다 — 그래서 API 를 통해 «화면이 가는 길»로 확인한다.
 *   ⇒ 저장소 스위치·인증·흰 목록까지 한 번에 지나간다.
 *
 * ★★**시험 줄은 반드시 치운다.** 원장에 「99시험0001」 이 남으면 그게 실적으로 세어진다.
 *
 * ⚠ 시험 기대를 «짐작»으로 적지 마라. 2026-08-26 에 세 번 헛짚었다 —
 *   당월접수는 인도돼도 그 달엔 자리를 안 옮기고(`bucketOf`·`stageOf`),
 *   갓 접수한 줄은 요율이 없어 수수료가 0 이 «정상»이다(요율은 별도 도구가 채운다).
 *
 *   npm run dev  가 떠 있어야 한다.
 *   npx tsx scripts/check-settlement-erp-store.mts
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const users = (await getDatabase().ref('users').get()).val() || {};
const [uid] = Object.entries(users as Record<string, any>).find(([, u]) => S(u?.role) === 'admin' && S(u?.status) !== 'deleted')!;
const custom = await getAuth().createCustomToken(uid);
const key = readFileSync('.env.local', 'utf8').split('\n').find((l) => l.startsWith('NEXT_PUBLIC_FIREBASE_API_KEY='))!.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
const tok: any = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) })).json();
const H = { Authorization: `Bearer ${tok.idToken}`, 'content-type': 'application/json' };
const API = 'http://localhost:4004/api/settlement/ledger';
const fail: string[] = [];
const ok = (why: string, c: boolean) => { console.log(`  ${c ? '○' : '✕'} ${why}`); if (!c) fail.push(why); };

const PLATE = '99시험0001';
console.log('\n■ ERP 저장소 — 접수·수정\n');

// ① 접수
const made: any = await (await fetch(API, { method: 'POST', headers: H, body: JSON.stringify({
  plate: PLATE, supplier: '손오공', model: '시험차', customer: '시험고객',
  channel: '하허호', agent: '시험영업', product: '장기렌트', term: '36', rent: '500000',
  payKind: '일시납', paper: '예', delivered: '아니오',
}) })).json();
ok('접수된다', made.ok === true);
const recv = S(made.receivedAt);

// ② 목록에 뜨나
const list1: any = await (await fetch(API, { headers: H })).json();
const mine = list1.rows?.find((r: any) => S(r.plate) === PLATE);
ok('목록에 뜬다', !!mine);
ok('계약서가 «예»로 들어갔다', mine?.paper === true);
ok('인도 전이라 접수 자리다', S(mine?.bucket).includes('접수'));
ok('인도 전이라 청구월이 없다', !S(mine?.billingMonth));

// ③ 인도일 없이 인도완료 → 막혀야 한다
const bad: any = await (await fetch(API, { method: 'PATCH', headers: H, body: JSON.stringify({ plate: PLATE, receivedAt: recv, patch: { 인도완료: 'TRUE' } }) })).json();
ok('★인도일 없이 인도완료는 막힌다', bad.ok === false && /인도일/.test(S(bad.reason)));

// ④ 인도일과 같이 → 통과 + 청구월이 선다
const good: any = await (await fetch(API, { method: 'PATCH', headers: H, body: JSON.stringify({ plate: PLATE, receivedAt: recv, patch: { 인도완료: 'TRUE', 인도일: recv } }) })).json();
ok('인도일과 같이 주면 켜진다', good.ok === true);
const list2: any = await (await fetch(API, { headers: H })).json();
const after = list2.rows?.find((r: any) => S(r.plate) === PLATE);
ok('★청구월이 선다', !!S(after?.billingMonth));
// ★「당월접수」는 인도돼도 이달이 끝날 때까지 거기 남는다(bucketOf 규칙). 옮겨지는 건 달이 바뀔 때다.
ok('이번 달 접수라 당월접수에 남는다', S(after?.bucket) === '당월접수');
// ★stage 도 「접수」로 남는다(settlement-stage.ts 195행) — 당월 실적은 달이 끝나야 옮겨진다.
//   시트가 그렇게 돌던 규칙 그대로다. ERP 로 옮겨도 답이 같아야 하므로 이게 맞다.
ok('★당월은 stage 도 접수로 남는다 (시트와 같은 규칙)', S(after?.stage) === '접수');
// ★요율은 접수 때 안 들어온다 — 별도 도구가 채운다. 그래서 갓 접수한 줄은 수수료 0 이 «정상»이다.
ok('요율이 없으니 수수료는 0 (정상)', Number(after?.money?.claim) === 0);

// ⑤ 못 고치는 칸은 막혀야
const nope: any = await (await fetch(API, { method: 'PATCH', headers: H, body: JSON.stringify({ plate: PLATE, receivedAt: recv, patch: { 판매수수료: '999' } }) })).json();
ok('★금액 칸은 화면에서 못 고친다', nope.ok === false);

// ⑥ 치운다
const snap = await getDatabase().ref('v4/settlement_rows').get();
const all = (snap.val() || {}) as Record<string, any>;
const code = Object.entries(all).find(([, r]) => S(r?.plate) === PLATE)?.[0];
if (code) await getDatabase().ref(`v4/settlement_rows/${code}`).remove();
const list3: any = await (await fetch(API, { headers: H })).json();
ok('시험 줄을 치웠다', !list3.rows?.some((r: any) => S(r.plate) === PLATE));
ok('원래 줄 수로 돌아왔다', list3.count === 431);

console.log(fail.length ? `\n✕ ${fail.length}건 어긋남\n` : '\n○ 다 맞음\n');
process.exit(fail.length ? 1 : 0);
