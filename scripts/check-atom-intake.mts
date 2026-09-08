/**
 * **원자 문지기 — 발행 «전»에 원자를 검사한다.** 읽기 전용 · 걸리면 종료코드 1.
 *
 * ★사장님 2026-09-08 「원자 데이터를 갖고 가는 데 있어서 문제 생길 거 사전에 예방해 보자」.
 *   2026-09-08 하루에 터진 사고를 갈래로 세운 것이다 — 하나하나가 실제로 시트까지 나갔던 것들이다.
 *
 * ```
 * ① 차가 아닌 줄        오플 배너 「★★★ 전기차 프로모션(수수료 150만원) …」이 차번 칸에 앉아 실렸다
 * ② 우리 몫이 샌다      그 배너에 «수수료 150만원»이 적혀 영업채널 시트까지 나갔다
 * ③ 값이 사라졌다       어제 있던 칸이 오늘 비었다 — 오늘 사고 대부분이 「없어진 걸 아무도 몰랐다」였다
 * ④ 대수가 확 줄었다    한 공급사가 통째로 0이 되는 것은 «없다»가 아니라 «못 읽었다»다
 * ⑤ 이름이 두 벌        RP031 과 이안카 · SA 와 에스에이 — 한 회사가 둘로 세어진다
 * ⑥ 구분이 비었다       그 한 칸이 비어 픽업 265대가 상품리스트로 흘렀다(탭 가르기가 구분을 본다)
 * ⑦ 요금이 통째로 없다  팔 수 있는데 값이 없으면 영업자가 견적을 못 낸다
 * ```
 *
 * ★**막는 것과 알리는 것을 가른다.**
 *   ①②④ = **멈춘다**(그대로 나가면 사고). ③⑤⑥⑦ = **알린다**(고칠 목록이지 발행을 막을 일은 아니다).
 *   ⚠ 다 멈추게 만들면 아무도 안 본다 — 멈춤은 «그대로 나가면 안 되는 것»에만 쓴다.
 *
 * ★③은 **어제 스냅과 견준다.** 스냅이 없으면 첫 회차라 만들고 지나간다(없는 것을 사고라 하지 않는다).
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/check-atom-intake.mts
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/check-atom-intake.mts --snap   # 스냅 갱신
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { isPlate } from '../lib/domain/plate-registry';
import { companyAlias } from '../lib/domain/identity';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const SNAP = 'tmp/원자-문지기-스냅.json';
const SNAP_ONLY = process.argv.includes('--snap');
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });

const docs = (await getFirestore().collection('products').get()).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
/** 팔 수 있는 차만 본다 — 출고불가는 목록에 안 서므로 그 칸이 비어도 사고가 아니다. */
const live = docs.filter((v) => !/출고불가/.test(S(v.vehicle_status)));
const 멈춤: string[] = [];
const 알림: string[] = [];
console.log(`원자 ${docs.length}건 · 팔 수 있는 차 ${live.length}\n`);

// ── ① 차가 아닌 줄 ──────────────────────────────────────────
{
  const bad = docs.filter((v) => { const c = S(v.car_number); return !c || !isPlate(c); });
  if (bad.length) 멈춤.push(`차번이 아닌 원자 ${bad.length}건 — ${bad.slice(0, 5).map((v) => `${v.id}「${S(v.car_number).slice(0, 30)}」`).join(' · ')}`);
  console.log(`① 차가 아닌 줄 ${bad.length}`);
}

// ── ② 우리 몫이 샌다 ────────────────────────────────────────
{
  const 샘 = /수수료|커미션|마진|원가/;
  const bad = docs.filter((v) => 샘.test(`${S(v.car_number)} ${S(v.supplier_vehicle_name)} ${S(v.options)} ${S(v.note)}`));
  if (bad.length) 멈춤.push(`우리 몫(수수료·원가)이 적힌 원자 ${bad.length}건 — ${bad.slice(0, 3).map((v) => S(v.car_number)).join(' · ')}`);
  console.log(`② 우리 몫이 새는 줄 ${bad.length}`);
}

/** 검사에 쓰는 칸 — 영업자가 «그 차를 말하는 데» 꼭 쓰는 것들. */
const FIELDS = ['product_type', 'maker', 'model', 'sub_model', 'trim_name', 'vehicle_status',
  'ext_color', 'year', 'mileage', 'fuel_type', 'provider_company_code', 'price'] as const;
const 있음 = (v: any, f: string) => (f === 'price'
  ? !!(v.price && typeof v.price === 'object' && Object.keys(v.price).length)
  : !!S(v[f]));
const 지금: Record<string, number> = {};
for (const f of FIELDS) 지금[f] = live.filter((v) => 있음(v, f)).length;
지금['_대수'] = live.length;

// ── ③ 값이 사라졌다 (어제 스냅과 견줌) ──────────────────────
{
  let prev: Record<string, number> | null = null;
  try { prev = JSON.parse(readFileSync(SNAP, 'utf8')).칸 as Record<string, number>; } catch { /* 첫 회차 */ }
  if (!prev) console.log('③ 어제 스냅 없음 — 이번 것을 스냅으로 남긴다');
  else {
    const 준 = Object.entries(지금).filter(([f, n]) => f !== '_대수' && (prev![f] ?? 0) - n >= Math.max(5, Math.round((prev![f] ?? 0) * 0.1)));
    for (const [f, n] of 준) 알림.push(`값이 사라졌다 — ${f} ${prev![f]} → ${n} (${prev![f] - n}개)`);
    console.log(`③ 어제보다 확 줄어든 칸 ${준.length}`);
  }
}

// ── ④ 대수가 확 줄었다 ─────────────────────────────────────
{
  let prev = 0;
  try { prev = Number(JSON.parse(readFileSync(SNAP, 'utf8')).칸?.['_대수'] || 0); } catch { /* 첫 회차 */ }
  if (prev && live.length < prev * 0.8) 멈춤.push(`팔 수 있는 차가 ${prev} → ${live.length} (${Math.round((1 - live.length / prev) * 100)}% 줄었다) — 못 읽은 것인지 먼저 보라`);
  /** 공급사 하나가 통째로 0이 되는 것도 «못 읽었다»다 — 총 대수만으로는 안 잡힌다. */
  let prevBy: Record<string, number> = {};
  try { prevBy = JSON.parse(readFileSync(SNAP, 'utf8')).공급사 || {}; } catch { /* 첫 회차 */ }
  const nowBy: Record<string, number> = {};
  for (const v of live) { const k = S(v.provider_company_code) || '(없음)'; nowBy[k] = (nowBy[k] || 0) + 1; }
  const 사라짐 = Object.entries(prevBy).filter(([k, n]) => n >= 3 && !nowBy[k]).map(([k, n]) => `${k} ${n}→0`);
  if (사라짐.length) 멈춤.push(`공급사가 통째로 0대 — ${사라짐.join(' · ')}`);
  console.log(`④ 대수 ${prev || '첫 회차'} → ${live.length} · 0대가 된 공급사 ${사라짐.length}`);
  지금['_공급사'] = Object.keys(nowBy).length;
  writeFileSyncSnap(nowBy);
}
function writeFileSyncSnap(nowBy: Record<string, number>) {
  mkdirSync('tmp', { recursive: true });
  writeFileSync(SNAP, JSON.stringify({ 잰날: new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 16).replace('T', ' '), 칸: 지금, 공급사: nowBy }, null, 1), 'utf8');
}

// ── ⑤ 이름이 두 벌 ────────────────────────────────────────
{
  const codes = new Set<string>();
  const names = new Map<string, Set<string>>();
  for (const v of live) {
    const c = S(v.provider_company_code); if (/^(RP|PT)[-_]?\d+/i.test(c)) codes.add(c);
    const raw = S(v.provider_name) || S(v.partner_name);
    if (raw) { const k = companyAlias(raw) || raw; const set = names.get(k) || new Set(); set.add(raw); names.set(k, set); }
  }
  const 갈림 = [...names].filter(([, set]) => set.size > 1).map(([k, set]) => `${k}(${[...set].join('/')})`);
  if (갈림.length) 알림.push(`한 회사가 여러 이름 — ${갈림.join(' · ')}`);
  console.log(`⑤ 이름이 갈린 회사 ${갈림.length}`);
}

// ── ⑥ 구분이 비었다 ───────────────────────────────────────
{
  const bad = live.filter((v) => !S(v.product_type));
  if (bad.length) {
    const by = new Map<string, number>();
    for (const v of bad) { const k = S(v.provider_company_code) || '(없음)'; by.set(k, (by.get(k) || 0) + 1); }
    알림.push(`상품구분이 빈 차 ${bad.length} — ${[...by].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}`
      + '  ⚠ 탭 가르기가 이 칸을 보므로, 비면 그 차가 상품리스트로 흘러간다');
  }
  console.log(`⑥ 구분이 빈 차 ${bad.length}`);
}

// ── ⑦ 요금이 통째로 없다 ───────────────────────────────────
{
  const bad = live.filter((v) => !있음(v, 'price'));
  if (bad.length) {
    const by = new Map<string, number>();
    for (const v of bad) { const k = S(v.provider_company_code) || '(없음)'; by.set(k, (by.get(k) || 0) + 1); }
    알림.push(`팔 수 있는데 요금이 한 칸도 없는 차 ${bad.length} — ${[...by].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  }
  console.log(`⑦ 요금 없는 차 ${bad.length}`);
}

// ── ⑧ 상태가 두 벌 ─────────────────────────────────────────
/**
 * ⚠ 2026-09-08 — `status`(출고가능)와 `vehicle_status`(출고불가)가 한 문서에 같이 있었다(149대).
 *   시트·문지기는 `vehicle_status`, ERP 일부는 `status` 를 읽으니 **판 차가 목록에 다시 설 수 있었다.**
 *   ★멈춘다 — 그대로 나가면 이미 팔린 차를 또 판다.
 */
{
  const bad = docs.filter((v) => S(v.status) && S(v.vehicle_status) && S(v.status) !== S(v.vehicle_status));
  const blank = docs.filter((v) => !S(v.vehicle_status));
  if (bad.length >= 5) 멈춤.push(`상태가 두 벌인 차 ${bad.length}건 — ${bad.slice(0, 4).map((v) => `${S(v.car_number)}(${S(v.status)}↔${S(v.vehicle_status)})`).join(' · ')}  ⚠ 판 차가 다시 설 수 있다. heal-atom-status 로 아물려라`);
  else if (bad.length) 알림.push(`상태가 두 벌인 차 ${bad.length}건 — ${bad.map((v) => `${S(v.car_number)}(${S(v.status)}↔${S(v.vehicle_status)})`).join(' · ')}`);
  if (blank.length) 알림.push(`배차상태가 빈 차 ${blank.length}건 — 시트 「배차상태」 칸이 빈다`);
  console.log(`⑧ 상태 두 벌 ${bad.length} · 빈 상태 ${blank.length}`);
}

// ── 결과 ──────────────────────────────────────────────────
console.log('');
for (const x of 알림) console.log(`  ▲ ${x}`);
for (const x of 멈춤) console.log(`  ⛔ ${x}`);
if (SNAP_ONLY) { console.log('\n※ --snap — 스냅만 남겼다.\n'); process.exit(0); }
if (멈춤.length) { console.log(`\n⛔ 문지기가 막는다 — ${멈춤.length}건. 발행하지 마라.\n`); process.exit(1); }
console.log(`\n✓ 문지기 통과${알림.length ? ` — 알림 ${알림.length}건(고칠 목록)` : ''}\n`);
process.exit(0);
