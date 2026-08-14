/**
 * **공급사 파트너 레코드의 시트 주소를 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-13 — 「영업자 시트는 공급사시트에 있는 걸 바로 갖고 오는 방식」)
 *   직행으로 읽으려면 «어느 시트를 볼지»가 파트너 레코드에 적혀 있어야 한다.
 *   비어 있으면 그 공급사는 통째로 빠진다 — 이안카 70대가 그렇게 사라져 있었다(실측 2026-08-13).
 *
 * ⚠ **지금 값이 예상과 다르면 건드리지 않는다.** 누가 일부러 바꿔 뒀을 수 있다.
 * ⚠ 고치기 전 값을 `tmp/` 에 남긴다.
 * ⚠ v3(`partners`)와 v4(`v4/partners`) **둘 다** 본다. 읽는 쪽이 둘을 병합하는데
 *   v4 의 빈 껍데기가 v3 의 값을 덮어 쓰기 때문이다.
 *
 *   npx tsx scripts/fix-partner-sheet-url.mts
 *   npx tsx scripts/fix-partner-sheet-url.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/** 근거는 「공급사시트정리」 문패(dudguq 소유)와 시트 실측이다. 짐작으로 넣지 않는다. */
const FIXES: { code: string; url: string; why: string }[] = [
  {
    code: 'RP031',
    url: 'https://docs.google.com/spreadsheets/d/1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs/edit',
    why: '문패에 적힌 주소 · 실측 「이안카_프리패스」 탭 2개(이안카 48행 · 이안카 재렌트 38행), 우리 40열 규격 그대로',
  },
];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const at = async (p: string) => JSON.parse(await (await fetch(`${DB}/${p}.json?access_token=${tok}`)).text()) || {};
const [t3, t4] = await Promise.all(['partners', 'v4/partners'].map(at));

console.log(`■ 공급사 시트 주소 채우기 ${APPLY ? '반영' : '미리보기(dry-run)'}\n`);
const todo: { path: string; before: string; url: string; label: string }[] = [];
for (const f of FIXES) {
  for (const [root, src] of [['partners', t3], ['v4/partners', t4]] as [string, Rec][]) {
    for (const [k, v] of Object.entries<Rec>(src)) {
      if (!v || typeof v !== 'object') continue;
      if ((S(v.partner_code) || S(k)) !== f.code) continue;
      const now = S(v.sheet_url);
      const label = `${root}/${k} (${f.code} ${S(v.partner_name || v.name) || '이름없음'})`;
      if (now === f.url) { console.log(`  = ${label} — 이미 같다`); continue; }
      if (now) { console.log(`  ⏭ ${label} — 이미 다른 주소가 있다, 건드리지 않는다\n       ${now}`); continue; }
      todo.push({ path: `${root}/${k}`, before: now, url: f.url, label });
      console.log(`  → ${label}`);
      console.log(`       (없음) → ${f.url}`);
      console.log(`       ${f.why}`);
    }
  }
}
console.log(`\n  채울 곳 ${todo.length}`);
if (!APPLY) { console.log('\n※ dry-run. 실제 쓰기는 --apply\n'); process.exit(0); }
if (!todo.length) process.exit(0);

mkdirSync('tmp', { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
const undo = `tmp/partner-sheet-url-undo-${stamp}.json`;
writeFileSync(undo, JSON.stringify(todo.map((t) => ({ path: t.path, before: t.before })), null, 2), 'utf8');
let done = 0;
for (const t of todo) {
  const res = await fetch(`${DB}/${t.path}.json?access_token=${tok}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheet_url: t.url, updatedAt: new Date().toISOString() }),
  });
  if (res.ok) done++; else console.log(`   ⚠ ${t.label} — ${res.status}`);
}
console.log(`\n  반영 ${done}곳 · 되돌리려면 ${undo}\n`);
