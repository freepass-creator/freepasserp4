/**
 * **차종마스터에 엉뚱하게 붙은 매물을 제자리로 돌린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-13 — 「우리 상품에 있는 거는 다 있어야지」)
 *   마스터에 «없는» 게 아니라 매물이 **다른 차에 붙어 있던** 것이다. 마스터를 늘릴 일이 아니라
 *   매물을 고칠 일이다. 잘못 붙은 채로 마스터를 만들면 그 뒤로 들어오는 차가 전부 거기 붙는다
 *   — 「기아 로체」 밑에 아우디가 쌓인다.
 *
 * ★근거는 **그 차가 이미 들고 있는 값**이다. 지어내지 않았다.
 *     32루9318   「A6 C9」·「가솔린 2.0 콰트로」·「45 TFSI S line」 → 아우디 A6 말고 될 수 없다
 *     146호1686  세부모델이 「XT6」인데 모델 칸에 제조사 이름이 앉았다(한 칸 밀림)
 *     벤츠 2대    세부모델·트림이 전부 E-클래스인데 모델만 CLE 로 붙었다
 *     벤츠 2대    「200 2세대」는 세부모델 이름이 아니다. E200 은 트림이고, 최초등록이 24-12·25-03 이라 W214 다
 *
 * ⚠ **지금 값이 예상과 다르면 건드리지 않는다.** 그 사이 누가 고쳤을 수 있다.
 * ⚠ 고치기 전 값을 `tmp/` 에 남긴다.
 *
 *   npx tsx scripts/fix-missnapped-cars.mts
 *   npx tsx scripts/fix-missnapped-cars.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/** 차번 → {지금 이래야 한다, 이렇게 고친다}. 예상이 안 맞으면 건너뛴다. */
type Fix = { plate: string; expect: Rec; set: Rec; why: string };
const FIXES: Fix[] = [
  {
    plate: '32루9318',
    expect: { maker: '기아', model: '로체', sub_model: 'A6 C9' },
    set: { maker: '아우디', model: 'A6' },
    why: '세부모델 A6 C9 · 콰트로 · 45 TFSI S line — 아우디 A6 다',
  },
  {
    plate: '146호1686',
    expect: { maker: '캐딜락', model: '캐딜락', sub_model: 'XT6' },
    set: { model: 'XT6' },
    why: '모델 칸에 제조사 이름이 앉았다. 마스터에 캐딜락 XT6 가 있다',
  },
  {
    plate: '133하2383',
    expect: { maker: '벤츠', model: 'CLE', sub_model: 'E-클래스 W213' },
    set: { model: 'E-클래스' },
    why: '세부모델·트림(E250 아방가르드)이 전부 E-클래스다',
  },
  {
    plate: '109호3016',
    expect: { maker: '벤츠', model: 'CLE', sub_model: 'E-클래스 W213' },
    set: { model: 'E-클래스' },
    why: '세부모델·트림(E250 AMG Line)이 전부 E-클래스다',
  },
  {
    plate: '109호3892',
    expect: { maker: '벤츠', model: 'E-클래스', sub_model: '200 2세대' },
    set: { sub_model: 'E-클래스 W214' },
    why: '최초등록 24-12 — W214(2024~) 세대다. E200 은 트림이지 세부모델이 아니다',
  },
  {
    plate: '109호4117',
    expect: { maker: '벤츠', model: 'E-클래스', sub_model: '200 2세대' },
    set: { sub_model: 'E-클래스 W214' },
    why: '최초등록 25-03 — W214 세대다',
  },
  {
    /**
     * ★**근거는 공급사 원문이다.** 제이앤제이 시트에 「차종 E200 · 모델명 E200 AVANTGARDE
     *   KR3(25MY) · 유종 HEV · 최초등록 25-10」로 적혀 있다 — 벤츠 E200 아방가르드다.
     * ⚠ 한 번 틀렸다(2026-08-13). ERP 에 있던 「하이브리드 3.0 4MATIC」을 근거로 CLE450 이라
     *   판단했는데, 그 값 자체가 잘못 붙은 것이었다. **틀린 값을 근거로 삼으면 틀린 곳으로 간다.**
     *   차종을 정할 때는 ERP 가 아니라 공급사가 쓴 글자를 먼저 본다.
     */
    plate: '142호7629',
    expect: { maker: '벤츠', model: 'CLE-클래스', sub_model: 'CLE-클래스 C236' },
    set: { model: 'E-클래스', sub_model: 'E-클래스 W214', variant: '가솔린 2.0', trim_name: 'E200 아방가르드' },
    why: '공급사 원문 「E200 AVANTGARDE KR3(25MY)」 · 최초등록 25-10 → E-클래스 W214',
  },
];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${tok}`)).text()) || {};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

console.log(`■ 잘못 붙은 매물 되돌리기 ${APPLY ? '반영' : '미리보기(dry-run)'}\n`);
const todo: { key: string; set: Rec; before: Rec; plate: string }[] = [];
for (const f of FIXES) {
  const hits = Object.entries<Rec>(prods).filter(([, p]) => p && typeof p === 'object' && !dead(p) && norm(p.car_number) === norm(f.plate));
  if (!hits.length) { console.log(`  ✗ ${f.plate} — ERP 에 없다`); continue; }
  for (const [key, p] of hits) {
    const bad = Object.entries(f.expect).filter(([k, v]) => S(p[k]) !== S(v));
    if (bad.length) {
      console.log(`  ⏭ ${f.plate} (${key}) — 지금 값이 예상과 다르다, 건드리지 않는다`);
      for (const [k, v] of bad) console.log(`       ${k}: 지금 「${S(p[k])}」 · 예상 「${S(v)}」`);
      continue;
    }
    const before: Rec = {};
    for (const k of Object.keys(f.set)) before[k] = S(p[k]);
    todo.push({ key, set: f.set, before, plate: f.plate });
    console.log(`  ✓ ${f.plate} (${key})`);
    console.log(`       ${Object.keys(f.set).map((k) => `${k} 「${before[k]}」→「${S(f.set[k])}」`).join(' · ')}`);
    console.log(`       ${f.why}`);
  }
}
console.log(`\n  고칠 것 ${todo.length}대`);
if (!APPLY) { console.log('\n※ dry-run. 실제 쓰기는 --apply\n'); process.exit(0); }
if (!todo.length) process.exit(0);

mkdirSync('tmp', { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
const undo = `tmp/missnap-undo-${stamp}.json`;
writeFileSync(undo, JSON.stringify(todo.map((t) => ({ key: t.key, plate: t.plate, before: t.before })), null, 2), 'utf8');

let done = 0, failed = 0;
for (const t of todo) {
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(t.key)}.json?access_token=${tok}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...t.set, updatedAt: new Date().toISOString(), _fixed_by: 'missnap' }),
  });
  if (res.ok) done++; else { failed++; console.log(`   ⚠ ${t.plate} — ${res.status}`); }
}
console.log(`\n  반영 ${done}대${failed ? ` · 실패 ${failed}` : ''}`);
console.log(`  되돌리려면 ${undo} 의 before 값을 다시 넣어라\n`);
