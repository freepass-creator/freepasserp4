/**
 * **사람이 「안 판다」고 판단해 내린 차에 `deleted_source: 'judgement'` 를 박는다.**
 *
 * ★왜(2026-08-11)
 *   내림에는 두 종류가 있다 — 「시트에서 사라져서」(sheet-absence)와 「사람이 보고 판단해서」(judgement).
 *   전자는 시트에 다시 올라오면 되살아나야 하고, 후자는 시트에 남아 있어도 되살아나면 안 된다.
 *   구분이 없던 탓에 오플 프로모션 탭 하단 EV6 13대가 아침 동기화마다 되살아날 뻔했다.
 *   `create-missing-from-sheets` 가 이 값만 보고 가른다.
 *
 *   npx tsx scripts/mark-judgement-holds.mts            # dry-run
 *   npx tsx scripts/mark-judgement-holds.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/** 사장님이 보고 「판매 아닌 것 같다」고 한 차 — 오플 프로모션 탭 하단(2026-08-10). */
const JUDGEMENT: { plate: string; reason: string }[] = [
  '11오1623', '05수5200', '05수5243', '35서5719', '11오0571', '11오0650', '11오0331',
  '63주0724', '05수4826', '52마4320', '63주0741', '11오0434', '05수4983', '63주0598',
].map((plate) => ({ plate, reason: '오플 프로모션 탭 하단 — 판매 대상 아님(2026-08-10 확인)' }));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${dbT}`)).text()) || {};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

console.log(`■ 사람이 내린 차에 표시를 박는다 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
const want = new Map(JUDGEMENT.map((j) => [norm(j.plate), j.reason]));
const todo: { key: string; plate: string; reason: string }[] = [];
const live: string[] = [];
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object') continue;
  const pl = norm(p.car_number);
  const reason = want.get(pl);
  if (!reason) continue;
  // ★살아있는 차에는 손대지 않는다 — 내리는 건 이 스크립트가 할 일이 아니다.
  if (!dead(p)) { live.push(pl); continue; }
  if (S(p.deleted_source) === 'judgement') { want.delete(pl); continue; }
  todo.push({ key: k, plate: pl, reason });
  want.delete(pl);
}
for (const t of todo) console.log(`   ${t.plate.padEnd(11)} ${t.key.slice(0, 28).padEnd(30)} ${t.reason.slice(0, 44)}`);
console.log(`\n  표시할 차 ${todo.length}대`);
if (live.length) console.log(`  △ 아직 살아있어 손대지 않은 차 ${live.length}대 — ${live.join(' · ')}`);
if (want.size) console.log(`  △ RTDB 에 레코드가 없는 차 ${want.size}대 — ${[...want.keys()].join(' · ')}`);

if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

const at = new Date().toISOString();
let done = 0; let bad = 0;
for (const t of todo) {
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(t.key)}.json?access_token=${dbT}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleted_source: 'judgement', deleted_reason: t.reason, updatedAt: at }),
  });
  if (res.ok) done++; else { bad++; console.log(`  △ ${t.plate} — ${res.status} ${(await res.text()).slice(0, 80)}`); }
}
console.log(`\n  표시함 ${done}대 · 실패 ${bad}대\n`);
