/**
 * 아이언 홈페이지 → 우리 원자 변환 점검 + 반영 계획 미리보기. **쓰기 없음.**
 *
 * 반영 자체는 `/api/inventory/ironrentcar/apply` 가 스냅샷·CAS·확인문구로 보호한다.
 * 여기서는 그 API 와 «같은 계산»만 돌려 무엇이 바뀔지 먼저 눈으로 본다.
 *
 *   npx tsx scripts/sim-ironrentcar-plan.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { fetchIronRentcarCatalog } from '../lib/server/ironrentcar-source';
import { planIronRentcarReconcile } from '../lib/domain/ironrentcar-reconcile';
type Rec = Record<string, any>;
const S=(v:unknown)=>String(v??'').trim();
const DB='https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa=JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS)||'tmp/firebase-auth/sa.json','utf8'));
const jwt=new JWT({email:sa.client_email,key:sa.private_key,scopes:['https://www.googleapis.com/auth/firebase.database','https://www.googleapis.com/auth/userinfo.email']});
const token=(await jwt.getAccessToken()).token;
const prods=JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${token}`)).text())||{};
const existing=Object.entries(prods).map(([k,v])=>({ ...(v as Rec), _key:k })) as Rec[];

console.log('\n══ 아이언 홈페이지 → 우리 원자 ══\n');
const cat = await fetchIronRentcarCatalog({ cacheMs: 0, concurrency: 4 });
console.log(`  홈페이지 수집 ${cat.listings}건 (활성 ${cat.active} · 판매완료 ${cat.sold} · 신차 ${cat.newCount} · 중고 ${cat.usedCount}) · 오류 ${cat.errors.length} · 완전수집 ${cat.complete}`);

// ── 원자 변환 품질 ──────────────────────────────────────────────
const field = (f: string) => cat.items.filter((i) => S((i.product as Rec)[f])).length;
const n = cat.items.length;
console.log(`\n  원자 채움 (${n}대 기준)`);
for (const f of ['car_number','maker','model','sub_model','trim_name','year','fuel_type','mileage','ext_color','int_color','options','vehicle_status','product_type','photo_link'] as const) {
  const c = field(f);
  console.log(`    ${f.padEnd(18)} ${String(c).padStart(3)}/${n}${c===n?'':'   ← 비는 칸 있음'}`);
}
const priced = cat.items.filter((i) => Object.keys(((i.product as Rec).price)||{}).length).length;
const periods = new Set<string>();
for (const i of cat.items) for (const k of Object.keys(((i.product as Rec).price)||{})) periods.add(k);
console.log(`    price              ${priced}/${n} · 기간 ${[...periods].sort((a,b)=>Number(a)-Number(b)).join(' · ')}`);
const states = new Map<string, number>();
for (const i of cat.items) { const s=S((i.product as Rec).vehicle_status)||'(빈)'; states.set(s,(states.get(s)||0)+1); }
console.log(`    상태 분포          ${[...states].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v}`).join(' · ')}`);

// ── 반영 계획 ───────────────────────────────────────────────────
const plan = planIronRentcarReconcile({ webItems: cat.items, existing, sourceComplete: cat.complete });
console.log(`\n  반영 계획`);
console.log(`    기존과 짝지음      ${plan.matched}`);
console.log(`    값 바뀜(수정)      ${plan.patchCandidates.length}`);
console.log(`    변화 없음          ${plan.unchanged}`);
console.log(`    새로 만들 것       ${plan.createCandidates.length}`);
console.log(`    홈페이지에 없어짐   ${plan.webAbsentErp} → 출고불가 처리 대상 ${plan.absentBlockCandidates.length}`);
console.log(`    이미 출고불가       ${plan.alreadyUnavailableErpOnly} · 보호됨 ${plan.protectedErpOnly}`);
console.log(`    판매완료 신차 무시  ${plan.ignoredSoldNew} · 차번 중복 그룹 ${plan.duplicatePlateGroups} · 막힌 매물 ${plan.blockedExternalIds.length}`);
console.log(`    총 작업 ${plan.candidateOperations}건`);
// ── ★반영이 기존 재고의 세대를 뭉개는가 ─────────────────────────
const byKey = new Map(existing.map((r) => [S(r.product_code) || S(r._key), r]));
const worse: string[] = [];
for (const patch of plan.patchCandidates as Rec[]) {
  const key = S(patch.productCode) || S(patch.key) || S(patch.product_code);
  const before = byKey.get(key) || existing.find((r) => S(r.car_number) === S(patch.patch?.car_number));
  const after = (patch.patch || patch.fields || {}) as Rec;
  if (!before || after.sub_model === undefined) continue;
  const b = S(before.sub_model), a = S(after.sub_model);
  if (b && a && b !== a && a.length < b.length) worse.push(`${S(before.car_number)}  ${b} → ${a}`);
}
console.log(`
  세대 뭉개짐 검사 — 짧아지는 세부모델 ${worse.length}건`);
for (const w of worse.slice(0, 10)) console.log('    ▼ ' + w);

if (plan.createCandidates.length) {
  console.log('\n  새로 만들 예시');
  for (const c of plan.createCandidates.slice(0,5) as Rec[])
    console.log(`    ${S(c.car_number)||'(무번호)'} · ${S(c.maker)} ${S(c.model)} ${S(c.sub_model)} · ${S(c.year)}년 · ${S(c.vehicle_status)}`);
}
console.log('\n※ 읽기만 했다. 실제 반영은 관리자 화면의 「아이언 홈페이지 연동 적용」 버튼이 한다.\n');
process.exit(0);
