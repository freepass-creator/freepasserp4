/**
 * 외부 정제시트(차종마스터 정제본) → v4/products «한 번 원자화» 교정.
 *   사장님 2026-09-04 「외부시트/홈피를 차종마스터 기반 직접 원자화해두고 상태값만 반영하는 로직」 확인.
 *   색·주행·세부트림은 write-once 라 옛 시딩이 잘못/비어 있으면 정제시트가 맞아도 원자가 안 고쳐진다.
 *   정제시트의 «세부트림·외장색상·주행거리»(모두 차종마스터 정제칸)를 읽어, 원자가 비었거나 명백히 틀린 것만 채운다.
 *   ★기존 값은 덮지 않는다(비었을 때만). 상태값은 안 건드린다(상태는 매시간 연동이 소유).
 * 대상 = MIRROR_SOURCES 4곳(아이카·오토플러스·이안카·아이언). 기본 dry-run · --apply.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { JWT } from 'google-auth-library';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const NKEY = (c: unknown) => S(c).replace(/\s/g, '');
const NUM = /^[\d,]+(\.\d+)?$/;
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
/** ★원자 SSOT = Firestore. 이 스크립트는 RTDB 를 «아예» 열지 않는다(2026-09-10). */
const fsdb = getFirestore();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const api = async (u: string) => { const t = (await jwt.getAccessToken()).token; const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } }); return JSON.parse(await r.text()); };

/**
 * ⚠⚠⚠ **이 스크립트는 RTDB(`v4/products`)에 쓴다 — 원자 SSOT(Firestore `products`)가 아니다.**
 *   맨 아래가 「다음 미러가 Firestore 로 전파」인데, 그 전파가 끊기면 «고쳤는데 안 보인다».
 *   실측 2026-09-10 — 세부트림 규칙이 여기 있는데도 원자엔 **「기본형」인 차가 한 대도 없었고**
 *   빈 트림이 121대였다. 여기서 「교정 0」이라 나와도 원자는 비어 있을 수 있다(보는 곳이 다르다).
 * ⇒ **원자에 바로 쓰는 길**을 따로 세웠다 — `scripts/heal-atom-trim.mts`(규칙 = `lib/domain/trim-pick`).
 *   아래 피커는 RTDB 쪽 몫으로 남겨 둔다. 고칠 때 «둘 다» 보라 — 규칙이 갈리면 답이 갈린다.
 */
// ── 트림 피커(모든 공급사) — 세부모델의 마스터 trims[] 를 원문과 정규화 대조해 세부트림을 뽑는다.
//   사장님 2026-09-04 「원문에 세부트림 있으면 한 번 원자화하면 되지」. 마스터 trims 에서만 고르므로 지어내지 않는다.
const master = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const subTrims = new Map<string, string[]>();   // 세부모델 → 마스터 trims[](긴 것 먼저)
for (const e of master.entries as any[]) {
  const set = new Set<string>();
  for (const v of (e.variants || [])) for (const t of (v.trims || [])) { const s = S(t); if (s && s !== '(세부등급 없음)') set.add(s); }
  if (set.size) subTrims.set(S(e.sub_model), [...set].sort((a, b) => b.length - a.length));
}
// 한↔영·철자 정규화(원문·마스터트림 양쪽에 같은 함수).
const TR: [RegExp, string][] = [
  [/비지니스/g, '비즈니스'], [/iconic/gi, '아이코닉'], [/\bsport\b/gi, '스포츠'], [/premium/gi, '프리미엄'], [/standard/gi, '스탠다드'],
  [/signature/gi, '시그니처'], [/luxury/gi, '럭셔리'], [/prestige/gi, '프레스티지'], [/exclusive/gi, '익스클루시브'], [/modern/gi, '모던'],
  [/inspiration/gi, '인스퍼레이션'], [/noblesse/gi, '노블레스'], [/limited/gi, '리미티드'], [/dynamic/gi, '다이나믹'], [/smart/gi, '스마트'],
];
const normT = (s: string) => { let x = S(s).toLowerCase(); for (const [r, v] of TR) x = x.replace(r, v); return x.replace(/[\s()\/\-·.]/g, ''); };
// ★사람이 확인해 박는 식별 오버라이드(차번→제조사·모델·세부모델·세부트림) — 매처가 못 박은 것. 최우선.
const identOv: Record<string, Record<string, string>> = (() => { try { return JSON.parse(readFileSync('public/data/vehicle-identity-overrides.json', 'utf8')); } catch { return {}; } })();
/**
 * 세부트림 고르기 — 그 세부모델의 마스터 trims 풀에서만 고른다(지어내지 않는다).
 *
 * ★★**풀에 없으면 「기본형」이다** — `docs/차종명명-정제-매뉴얼.md` §3 「세부트림 없으면 「기본형」」 ·
 *   §3-1 ④ 「원문에 없거나 풀에 없으면 → 「기본형」」. 정본 모듈(`submodel-normalize-f03`)도 그렇게 돈다.
 *
 * ⚠ **실측 2026-09-08 — 여기가 빠져 있어 200대의 세부트림이 통째로 비어 나갔다.**
 *   (상품리스트 103 · 손오공구독 39 · 픽업구독 14 · 오플구독 44 — 원문에는 전부 글자가 있었다:
 *    「기본형」·「프레스티지」·「렌터카 스탠다드」·「Iconic」·「인스크립션」·「에어(Air)」…)
 *   못 고른 것을 «빈칸»으로 두면 영업자 표에 이가 나간다. 「기본형」은 «모른다»가 아니라
 *   **「그 세대에 트림 구분이 없다」는 답**이다 — 공급사 원문도 실제로 「기본형」이라 적는다.
 *
 * ⚠ 세부모델이 아직 안 정해졌으면(풀 자체가 없으면) 손대지 않는다 — 그건 정말 «모른다»다.
 */
const pickTrim = (sub: string, raw: string): string => {
  /**
   * ★**세부모델이 정해졌으면 트림은 «반드시 값이 있다»** — 못 고르면 「기본형」.
   *   ⚠ 마스터에 트림 풀이 «통째로 없는» 세부모델이 1,816개 중 579개다(G80 RG3 등 — 풀에
   *     「(세부등급 없음)」밖에 없는 것 포함). 예전엔 그런 차를 「미확정」으로 보고 건너뛰어
   *     세부트림이 영영 빈칸으로 남았다(사장님 2026-09-08 「G80 RG3 도 기본형으로 채워라」).
   *   ⇒ 풀이 없거나 원문과 안 맞으면 **기본형**. 세부모델 자체가 비었을 때만 손대지 않는다.
   */
  if (!S(sub)) return '';                                       // 세부모델 미확정 = 진짜 모른다
  const trims = subTrims.get(S(sub)) || [];
  const r = normT(raw);
  for (const t of trims) { const tn = normT(t); if (tn.length >= 2 && r.includes(tn)) return t; }   // 긴 것부터 → 가장 구체적
  return '기본형';
};

// 정제시트 → 차번별 {트림, 색, 주행} (공급사코드 붙여)
type Truth = { maker: string; model: string; sub: string; trim: string; color: string; mileage: string };
const truth = new Map<string, Truth>();   // `${code}|${car}` → Truth
for (const src of MIRROR_SOURCES) {
  try {
    const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${src.to}?fields=sheets.properties(title)`);
    for (const sh of meta.sheets) {
      const title = S(sh.properties.title);
      const vv = await api(`https://sheets.googleapis.com/v4/spreadsheets/${src.to}/values/${encodeURIComponent(`'${title}'!A1:BZ5000`)}`);
      const rows = vv.values || []; if (rows.length < 2) continue;
      const hd = (rows[0] || []).map(S);
      const ci = hd.indexOf('차량번호'), ti = hd.indexOf('세부트림'), coi = hd.indexOf('외장색상'), ki = hd.indexOf('주행거리');
      // 제조사·모델·세부모델 = 정제칸(차종마스터 행 복사). 제조사(정제) 우선, 없으면 원문 제조사.
      const mki = hd.indexOf('제조사(정제)') >= 0 ? hd.indexOf('제조사(정제)') : hd.indexOf('제조사');
      const moi = hd.indexOf('모델'), smi = hd.indexOf('세부모델');
      if (ci < 0) continue;
      for (const r of rows.slice(1)) {
        const car = NKEY(r[ci]); if (!car) continue;
        truth.set(`${src.code}|${car}`, {
          maker: mki >= 0 ? S(r[mki]) : '', model: moi >= 0 ? S(r[moi]) : '', sub: smi >= 0 ? S(r[smi]) : '',
          trim: ti >= 0 ? S(r[ti]) : '', color: coi >= 0 ? S(r[coi]) : '', mileage: ki >= 0 ? S(r[ki]) : '',
        });
      }
    }
    console.log(`${src.name}(${src.code}) 정제시트 읽음`);
  } catch (e) { console.warn(`${src.name} 실패:`, (e as Error).message); }
}
console.log(`정제시트 차번 총 ${truth.size}대`);

/**
 * ★**손오공(RP012) 구분 = 제공시트 「분류」가 정본이다.**
 *
 *   손오공은 MIRROR_SOURCES 에 없어(자체 API 유입) 위 `truth` 에 안 잡힌다. 그래서 아래 ⑤ 구분 규칙이
 *   RP023·재렌트 둘만 다루는 동안 **손오공 차의 `product_type` 이 통째로 비어 있었다**(실측 2026-09-08 · 289대).
 *
 *   그 빈칸 하나가 표를 통째로 흔들었다 —
 *   ⑯ 본시트 발행이 `product_type` 으로 탭을 가르는데(`픽업구독`·`손오공구독`·`오플구독`·나머지),
 *   구분이 비니 **픽업 265대가 「나머지」로 떨어져 상품리스트에 얹혔다.** 그래서
 *   상품리스트 325 → 652 · 픽업구독 269 → 6 이 되고, ⑥ 의 20% 감소 가드가 「절반이 사라졌다」고 멈췄다.
 *   ⇒ 시트가 09-07 12:44 에 얼어붙은 진짜 원인이 여기다.
 *
 * ★**빈 칸만 채운다.** 값이 있으면 안 덮는다 — 이 파일 전체의 규칙과 같다.
 * ★**상태는 안 건드린다.** 출고불가 판정은 매시간 상태연동이 소유한다(이 파일 머리 주석).
 */
const SONO_SHEET = '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA';
const sonoGubun = new Map<string, string>();   // 차번 → 분류
try {
  for (const tab of ['렌트재고', '구독재고', '픽업재고']) {
    const vv = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SONO_SHEET}/values/${encodeURIComponent(`'${tab}'!A1:BZ5000`)}`);
    const rows = vv.values || []; if (rows.length < 2) continue;
    const hd = (rows[0] || []).map(S);
    const ci = hd.indexOf('차량번호'); const gi = hd.indexOf('분류');
    if (ci < 0 || gi < 0) continue;
    for (const r of rows.slice(1)) {
      const car = NKEY(r[ci]); const g = S(r[gi]);
      if (car && g) sonoGubun.set(car, g);
    }
  }
  console.log(`손오공 제공시트 「분류」 ${sonoGubun.size}대 읽음`);
} catch (e) { console.warn('손오공 제공시트 실패:', (e as Error).message); }
/**
 * ⚠ **덜 읽고 그냥 지나가지 않는다.** 2026-09-08 실측 — 회차와 구글 쿼터를 다투다 손오공 분류를
 *   629대 중 «100대»만 읽고 그대로 진행해, 채워야 할 291대 중 25대만 채웠다.
 *   (같은 부류: 2026-08-18 429 로 빈 표를 읽어 60대가 빠진 표가 발행됐다.)
 *   못 읽은 것은 «없다»가 아니라 «모른다»다 — 확연히 모자라면 그 공급사 구분은 이번 회차에 손대지 않는다.
 */
const SONO_MIN = 300;
if (sonoGubun.size && sonoGubun.size < SONO_MIN) {
  console.warn(`  ⚠ 손오공 분류를 ${sonoGubun.size}대만 읽었다(평소 600+) — 덜 읽은 것이라 이번 회차는 구분을 안 건드린다`);
  sonoGubun.clear();
}
console.log('');

/**
 * ★★**원자는 Firestore 다 — 여기서 RTDB 를 읽지도 쓰지도 않는다.**
 *
 * > 사장님 2026-09-10 「너한테 지금 계속 얘기를 하는데도 **RTDB 를 왜 못 지우는지**」
 *
 * ⚠⚠ 실측 2026-09-10 — 회차가 부르는 스크립트 46개 중 **RTDB 에 «쓰는» 것은 이 하나뿐**이었다.
 *   나머지는 읽기만 한다. 그런데 이 하나 때문에 규칙이 SSOT 에 안 닿았다 —
 *   「기본형」 규칙이 이틀 전부터 코드에 있었는데 원자엔 기본형인 차가 **한 대도** 없었다.
 *   여기서 고친 값은 「다음 미러가 Firestore 로 전파」하기를 기다렸고, 그 다리가 끊겨 있었다.
 * ⇒ 읽기도 쓰기도 **Firestore `products`** 로 옮긴다. 이제 회차의 RTDB «쓰기»는 0 이다.
 */
const snap = await fsdb.collection('products').get();
const products: Record<string, any> = {};
for (const d of snap.docs) products[d.id] = d.data();
const updates: Record<string, any> = {};
const stat = { maker: 0, model: 0, sub: 0, trim: 0, color: 0, mileage: 0, gubun: 0 };
const rows: string[] = [];
for (const [key, v] of Object.entries(products)) {
  if (!v || typeof v !== 'object') continue;
  const code = S(v.provider_company_code); const car = NKEY(v.car_number);
  const changes: string[] = [];
  // ★식별 오버라이드(사람 확인값) — 최우선. 매처가 못 박은 차를 여기서 박는다. 값 있는 필드만.
  const ov = identOv[car];
  if (ov) for (const f of ['maker', 'model', 'sub_model', 'trim_name'] as const) {
    if (S(ov[f]) && S(v[f]) !== S(ov[f])) { updates[`v4/products/${key}/${f}`] = S(ov[f]); (stat as any)[f === 'sub_model' ? 'sub' : f === 'trim_name' ? 'trim' : f]++; changes.push(`${f}(확인)→「${S(ov[f])}」`); }
  }
  // ⑤ 상품구분(불변) 정규화 — 5개 캐논만. 오플(RP023)=오플구독 · 재랜트/재렌트=중고렌트. (모든 공급사)
  const curPt = S(v.product_type);
  const newPt = code === 'RP023' ? '오플구독'
    : (/재랜트|재렌트/.test(curPt) ? '중고렌트'
    /* ★손오공은 구분이 비었을 때만 제공시트 「분류」에서 가져온다(픽업구독·중고구독…). 있는 값은 안 덮는다. */
    : (code === 'RP012' && !curPt ? S(sonoGubun.get(car)) : ''));
  if (newPt && newPt !== curPt) { updates[`v4/products/${key}/product_type`] = newPt; stat.gubun++; changes.push(`구분 「${curPt}」→「${newPt}」`); }
  // ② 제원·스펙(불변) 채움 — 정제시트(차종마스터 정제본) 있는 공급사만, «비었을 때만».
  const t = truth.get(`${code}|${car}`);
  if (t) {
    if (t.maker && !S(v.maker)) { updates[`v4/products/${key}/maker`] = t.maker; stat.maker++; changes.push(`제조사→「${t.maker}」`); }
    if (t.model && !S(v.model)) { updates[`v4/products/${key}/model`] = t.model; stat.model++; changes.push(`모델→「${t.model}」`); }
    if (t.sub && !S(v.sub_model)) { updates[`v4/products/${key}/sub_model`] = t.sub; stat.sub++; changes.push(`세부모델→「${t.sub}」`); }
    if (t.trim && !S(v.trim_name)) { updates[`v4/products/${key}/trim_name`] = t.trim; stat.trim++; changes.push(`트림→「${t.trim}」`); }
    if (t.color && !S(v.ext_color)) { updates[`v4/products/${key}/ext_color`] = t.color; stat.color++; changes.push(`색→「${t.color}」`); }
    // 주행거리는 «변동»(사장님 2026-09-04 「대여료처럼 변동」) — 정제시트 현재값을 매번 따른다(비었을 때만이 아니라 다르면 갱신).
    if (t.mileage && S(v.mileage) !== t.mileage) { updates[`v4/products/${key}/mileage`] = t.mileage; stat.mileage++; changes.push(`주행 「${S(v.mileage)}」→「${t.mileage}」`); }
  }
  // ② 세부트림 피커(모든 공급사) — 정제시트로도 못 채운 빈 트림을, 세부모델 마스터 trims 에서 원문 대조로 뽑는다(손오공·아이언 등).
  const trimKey = `v4/products/${key}/trim_name`;
  const subM = updates[`v4/products/${key}/sub_model`] || S(v.sub_model);
  if (!S(v.trim_name) && !updates[trimKey] && subM) {
    // ★v4/products(RTDB)의 원문은 supplier_vehicle_name 이다(«원문」 객체는 미러가 Firestore 에 만든다).
    const raw = S(v.supplier_vehicle_name) || S(v['원문']?.['차명']);
    const picked = pickTrim(subM, raw);
    if (picked) { updates[trimKey] = picked; stat.trim++; changes.push(`트림(원문)→「${picked}」`); }
  }
  // ★외장/내장 색이 «한 칸에 붙은」 것 분리 — 「A / B」 → 외장=A · 내장=B (손오공구독 등, 사장님 2026-09-04).
  const ec = S(updates[`v4/products/${key}/ext_color`] || v.ext_color);
  if (ec.includes('/') && !S(v.int_color)) {
    const parts = ec.split('/').map((x) => S(x));
    if (parts[0]) updates[`v4/products/${key}/ext_color`] = parts[0];
    if (parts[1]) { updates[`v4/products/${key}/int_color`] = parts[1]; stat.color++; changes.push(`외장/내장 분리 「${ec}」→「${parts[0]}」·「${parts[1]}」`); }
  }
  if (changes.length && rows.length < 25) rows.push(`  ${code} ${car}: ${changes.join(' · ')}`);
}
console.log(`교정: 제조사 ${stat.maker} · 모델 ${stat.model} · 세부모델 ${stat.sub} · 세부트림 ${stat.trim} · 색 ${stat.color} · 주행 ${stat.mileage} · 구분 ${stat.gubun} (필드 ${Object.keys(updates).length})`);
for (const r of rows) console.log(r);
if (!APPLY) { console.log(`\n미리보기 — 실제: --apply`); process.exit(0); }
/**
 * ★**원자 문서별로 모아 쓴다.** 예전엔 `v4/products/<키>/<칸>` 경로 한 벌로 RTDB 에 밀어 넣었는데,
 *   그건 SSOT 가 아니었다. 같은 경로 문자열을 «문서 → 칸» 으로 되풀어 Firestore 에 쓴다.
 */
const 문서별 = new Map<string, Record<string, unknown>>();
for (const [path, val] of Object.entries(updates)) {
  const m = /^v4\/products\/([^/]+)\/(.+)$/.exec(path); if (!m) continue;
  const [, id, field] = m;
  (문서별.get(id) || 문서별.set(id, {}).get(id)!)[field] = val;
}
const ids = [...문서별.keys()];
for (let i = 0; i < ids.length; i += 400) {
  const batch = fsdb.batch();
  for (const id of ids.slice(i, i + 400)) batch.set(fsdb.collection('products').doc(id), { ...문서별.get(id), _refined_at: Date.now() }, { merge: true });
  await batch.commit();
}
console.log(`\n반영 완료 — 원자 ${ids.length}대 · ${Object.keys(updates).length} 칸 (Firestore 에 바로 썼다 · 미러를 안 기다린다).`);
process.exit(0);
