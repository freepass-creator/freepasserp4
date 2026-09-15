/**
 * 오플구독(오토플러스) «메인 원천» = reborncar.co.kr — 당겨와 Firestore 원자에 박는다.
 *
 * ★사장님 2026-09-08 「오토플러스 상품 reborncar 에 있어 · 우리거랑 비교해봐 → 메인을 리본카에서 당겨오는 걸로,
 *   어떻게 당겨올건지랑 지금 안 맞는 거 업데이트 보완해」.
 *
 * ── 어떻게 당겨오나 (실측으로 뚫은 recipe) ────────────────────────────────────────────
 *  ① 부트스트랩: 상세 HTML 을 GET → 세션쿠키(JSESSIONID…) + `RB_TOKEN`(JWT, 페이지 인라인) + `_csrf`(input) 확보.
 *  ② 목록(전수): `sitemap-ext.xml` 의 `/rent/…/C########### ` URL = 렌트/구독 전 상품(실측 75). LP API(rentCarLpData)는
 *     «추천 20» 고정이라 페이징이 안 된다 — 그래서 사이트맵으로 전수를 잡는다.
 *  ③ 상세: `POST /api/v1/car/getRentCarDetail.rb` (form-urlencoded `productId=…`) + `carOption.rb` 로 옵션.
 *     헤더: `X-Ajax-call:true` · `Authorization:<RB_TOKEN>` · `X-CSRF-TOKEN:<_csrf>` · `Cookie:<세션>`.
 *     resultCode 1020 = 토큰만료 → msg 의 새 토큰으로 재시도(내장).
 *
 * ── 필드 매핑(reborncar → 우리 오플구독 원자) ─────────────────────────────────────────
 *  carNumber→차번 · bmname→제조사 · boname→모델 · gradename→세부트림 · carYear→연식 · releaseDate(epoch)→최초등록 ·
 *  carNavi→Km · carFuel→연료 · carColor→외장 · displace→배기량 · seaterInfo→인승 · ideNumber→VIN · mainImage→사진 ·
 *  rentPriceObjs→대여료(rentMonth 별 rentPrice2=2만km·rentPrice3=3만km·originPriceN=정가) · carOption.codeNm→옵션.
 *  정책은 reborncar 약관이 «전 상품 동일»: 대인 무제한·대물/자손 1억·세금·보험 포함·보증금(국산 2개월·수입 3~6개월)·
 *  약정초과 1km당 100원·중도해지 잔여 30%.
 *
 *   npx tsx scripts/ingest-reborncar-to-firestore.mts            # dry-run: 전수 당겨 tmp 저장 + 우리 원자와 대조 리포트
 *   npx tsx scripts/ingest-reborncar-to-firestore.mts --apply    # Firestore products(오플) 빈칸 보완 + reborncar-only 신규 표시
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { snapToMaster, makerGroup } from '../lib/domain/vehicle-master-match';
import { cleanTrim } from '../lib/domain/clean-trim';
import { resolveStatus } from '../lib/domain/atom-status';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';

const APPLY = process.argv.includes('--apply');
const BASE = 'https://www.reborncar.co.kr';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const S = (v: unknown) => String(v ?? '').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── ① 부트스트랩 (상품별) ────────────────────────────────────
//   ★RB_TOKEN 은 «페이지별» 이다 — 그 상품 상세 HTML 을 GET 해야 그 상품용 토큰/세션이 선다(실측: 남의 토큰=1010).
async function bootstrap(pageUrl: string): Promise<{ cookie: string; token: string; csrf: string }> {
  const res = await fetch(pageUrl, { headers: { 'User-Agent': UA } });
  const cookie = ((res.headers as any).getSetCookie?.() || []).map((c: string) => c.split(';')[0]).join('; ');
  const html = await res.text();
  const token = (html.match(/RB_TOKEN\s*=\s*"([^"]+)"/) || [])[1] || '';
  const csrf = (html.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1] || '';
  if (!token || !csrf) throw new Error('부트스트랩 실패 — RB_TOKEN/_csrf 를 HTML 에서 못 찾음(페이지 구조 변경?)');
  return { cookie, token, csrf };
}

// ── ② 전수 productId (사이트맵) ──────────────────────────────
async function enumerateRentIds(): Promise<Array<{ productId: string; url: string }>> {
  const xml = await (await fetch(`${BASE}/sitemap-ext.xml`, { headers: { 'User-Agent': UA } })).text();
  const urls = [...new Set((xml.match(/<loc>([^<]+)<\/loc>/g) || []).map((m) => m.replace(/<\/?loc>/g, '')))];
  return urls.filter((u) => /\/rent\/[A-Z]{2}\d+\/C\d{11}/.test(u)).map((u) => ({ productId: (u.match(/C\d{11}/) || [])[0] as string, url: u })).filter((x) => x.productId);
}

// ── ③ 상세·옵션 (1020 토큰갱신 내장) ─────────────────────────
const form = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v))).join('&');
function makeCaller(ctx: { cookie: string; token: string; csrf: string }) {
  // ★Referer 는 그 차 «자기 상세 URL» 이어야 한다 — /rent 로 부르면 1010 Invalid Token(실측). 서버가 상품별 referer 를 검증.
  return async function call(ep: string, obj: Record<string, unknown>, referer: string): Promise<any> {
    for (let k = 0; k < 4; k++) {
      let j: any;
      try {
        const r = await fetch(`${BASE}/api/v1/car/${ep}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Ajax-call': 'true', Authorization: ctx.token, 'X-CSRF-TOKEN': ctx.csrf, Cookie: ctx.cookie, 'User-Agent': UA, Referer: referer },
          body: form(obj),
        });
        const t = await r.text();
        try { j = JSON.parse(t); } catch { return { __err: t.slice(0, 60), __status: r.status }; }
      } catch (e) { return { __err: String(e).slice(0, 60) }; }
      if (j?.header?.resultCode === 1020) { ctx.token = j.msg; await sleep(60); continue; }  // 토큰 갱신
      return j;
    }
    return { __err: 'retry-exhausted' };
  };
}

// ── 매핑: reborncar 상세+옵션 → 우리 오플 원자 필드 ────────────
function mapCar(detail: Record<string, unknown>, options: Array<Record<string, unknown>>): Record<string, unknown> {
  const rel = Number(detail.releaseDate);
  const firstReg = Number.isFinite(rel) && rel > 0 ? new Date(rel).toISOString().slice(0, 10) : '';
  // 대여료: rentPriceObjs (JSON string) → { "<개월>_2만": rent, "<개월>_3만": rent } (특가=rentPriceN, 정가=originPriceN)
  let price: Record<string, { rent?: number; deposit?: number; origin?: number }> = {};
  try {
    const arr = JSON.parse(S(detail.rentPriceObjs) || '[]') as Array<Record<string, number>>;
    for (const p of arr) {
      const m = p.rentMonth;
      // ★키 형식 = F01/F86 표준(sales-atom-row.ts)이 읽는 「<개월>_2만」・「<개월>_3만」 — 주석은 원래 이랬는데
      //   코드가 「_20000」으로 어긋나 있었다(실측 2026-09-16: 신규 21대 등록 후 요금이 시트에서 통째로 빔).
      if (p.rentPrice2) price[`${m}_2만`] = { rent: p.rentPrice2, origin: p.originPrice2 || undefined };
      if (p.rentPrice3) price[`${m}_3만`] = { rent: p.rentPrice3, origin: p.originPrice3 || undefined };
    }
  } catch { /* 대여료 없음 */ }
  return {
    car_number: S(detail.carNumber),
    reborncar_product_id: S(detail.productId),
    ap_car_id: S(detail.apCarId),
    maker: S(detail.bmname),
    model: S(detail.boname),
    trim_name: S(detail.gradename),
    vehicle_class: S(detail.shapeBgname),
    year: S(detail.carYear),
    first_registration_date: firstReg,
    mileage: S(detail.carNavi),
    fuel_type: S(detail.carFuel),
    ext_color: S(detail.carColor),
    engine_cc: S(detail.displace),
    seats: S(detail.seaterInfo),
    vin: S(detail.ideNumber),
    photo_link: S(detail.mainImage),
    price,
    options: options.map((o) => S(o.codeNm)).filter(Boolean).join(', '),
    product_type: '오플구독',
    provider_name: '오토플러스',
  };
}

// ── 실행 ─────────────────────────────────────────────────────
const ids = await enumerateRentIds();
console.log(`■ reborncar 렌트/구독 전수 ${ids.length}대 (sitemap-ext)`);

const cars: Array<Record<string, unknown>> = [];
let fail = 0;
for (let i = 0; i < ids.length; i++) {
  const { productId, url } = ids[i];
  try {
    const ctx = await bootstrap(url);                       // 상품별 토큰/세션
    const call = makeCaller(ctx);
    const d = await call('getRentCarDetail.rb', { productId }, url);
    if (d?.__err || !d?.data) { fail++; await sleep(150); continue; }
    const o = await call('carOption.rb', { productId }, url);
    cars.push(mapCar(d.data, Array.isArray(o?.data) ? o.data : []));
  } catch (e) { fail++; }
  if ((i + 1) % 10 === 0) process.stdout.write(`.${i + 1}`);
  await sleep(150);
}
console.log(`\n  당김 완료 — ${cars.length}대 성공 · ${fail}대 실패`);

/**
 * ★★**«모든 차가 같은 옵션»이면 그건 그 차의 옵션이 아니라 «카탈로그»다 — 안 싣는다.**
 *
 * > 사장님 2026-09-10 「지금 옵션이 손오공거 왜 다 이상한거를 찍냐」 ·
 * >  「**옵션을 갖고 오는 곳이 잘못돼 있어**」 — 손오공에서 잡은 그 병이 오플에도 있었다.
 *
 * ⚠⚠ 실측 2026-09-10 — `carOption.rb` 가 «그 차에 달린 옵션»이 아니라 **고를 수 있는 옵션 목록 전부**를
 *   돌려준다. 당긴 68대의 옵션 문자열이 **한 가지**였다(75개짜리 「블랙박스, 하이패스, 전동접이식…」).
 *   그게 원자로 새어 들어가 오플 14대가 시트에 75개짜리 옵션을 달고 서 있었다.
 * ★**한 가지인지로 가른다** — 필드 이름이나 깃발에 기대지 않는다. 원천이 이름을 바꿔도 이 판정은 산다.
 *   ⚠ 진짜로 온 차들이 우연히 같을 수는 있어도 «절반 넘게» 같을 수는 없다. 그러면 카탈로그다.
 * ⇒ 그런 문자열은 통째로 비운다. 무엇을 비웠는지 찍어 사람이 원천 필드를 보러 갈 수 있게 한다.
 */
{
  const 셈 = new Map<string, number>();
  for (const c of cars) { const o = S(c.options); if (o) 셈.set(o, (셈.get(o) || 0) + 1); }
  const [흔한, n] = [...셈].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  if (흔한 && n > cars.length * 0.5) {
    for (const c of cars) if (S(c.options) === 흔한) c.options = '';
    console.log(`  ⚠ 옵션 ${n}대가 «같은 문자열»이었다 — 카탈로그로 보고 비웠다(${흔한.split(',').length}개짜리).`);
    console.log(`     원천 필드를 보라: carOption.rb 가 «그 차의» 옵션을 주는 깃발이 따로 있는지.`);
  }
}
writeFileSync('tmp/reborncar-cars.json', JSON.stringify(cars, null, 2), 'utf8');
console.log('  → tmp/reborncar-cars.json');

// ── 대조: 우리 Firestore 오플 원자와 차번으로 맞대 ───────────
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const db = getFirestore();
const ours = new Map<string, { id: string; x: Record<string, unknown> }>();
for (const dcmt of (await db.collection('products').get()).docs) {
  const x = dcmt.data() as Record<string, unknown>;
  const isOpl = S(x.product_type).includes('오플') || /오토플러스|autoplus/i.test(S(x.provider_name));
  if (isOpl || S(x.car_number)) ours.set(S(x.car_number), { id: dcmt.id, x });
}
const rbNums = new Set(cars.map((c) => S(c.car_number)));
const oplOurs = [...ours.values()].filter((o) => S(o.x.product_type).includes('오플'));
const onlyReborn = cars.filter((c) => !ours.has(S(c.car_number)));
const matched = cars.filter((c) => ours.has(S(c.car_number)));
console.log(`\n── 대조 ──`);
console.log(`reborncar ${cars.length} · 우리 오플 ${oplOurs.length}`);
console.log(`차번 매칭 ${matched.length} · reborncar에만(우리 재고에 없음) ${onlyReborn.length}: ${onlyReborn.slice(0, 12).map((c) => S(c.car_number)).join(', ')}`);
// 매칭된 것 중 우리 원자의 빈칸을 reborncar 가 채울 수 있는 것
const fillable = { seats: 0, options: 0, ext_color: 0, mileage: 0, price: 0, vin: 0 };
for (const c of matched) {
  const o = ours.get(S(c.car_number))!.x;
  if (!S(o.seats) && S(c.seats)) fillable.seats++;
  if (!S(o.options) && S(c.options)) fillable.options++;
  if (!S(o.ext_color) && S(c.ext_color)) fillable.ext_color++;
  if (!S(o.mileage) && S(c.mileage)) fillable.mileage++;
  if (!Object.keys((o.price as object) || {}).length && Object.keys(c.price as object).length) fillable.price++;
  if (!S((o as any).vin) && S(c.vin)) fillable.vin++;
}
console.log('매칭 차 중 reborncar 로 «채울 수 있는» 빈칸:', JSON.stringify(fillable));

if (!APPLY) {
  console.log('\n미리보기(dry-run). 반영 = --apply: 매칭 차의 빈칸 보완 + reborncar-only 신규 표시.');
  process.exit(0);
}
// ── --apply: 매칭 차 빈칸만 보완(덮어쓰기 아님 — 있는 값은 존중) ──
let filled = 0;
let batch = db.batch(), inB = 0;
for (const c of matched) {
  const { id, x } = ours.get(S(c.car_number))!;
  const patch: Record<string, unknown> = {};
  for (const k of ['seats', 'ext_color', 'mileage', 'vin', 'fuel_type', 'first_registration_date', 'photo_link']) {
    if (!S(x[k]) && S(c[k])) patch[k] = c[k];
  }
  if (!S(x.options) && S(c.options)) patch.options = c.options;
  /** ★이미 원자에 박힌 «카탈로그»는 걷어낸다 — 빈칸 보완만으로는 옛 쓰레기가 안 지워진다(실측 14대). */
  if (S(x.options) && !S(c.options) && S(x.options).split(/\s*,\s*/).filter(Boolean).length >= 10) patch.options = '';
  if (!Object.keys((x.price as object) || {}).length && Object.keys(c.price as object).length) patch.price = c.price;
  patch.reborncar_product_id = c.reborncar_product_id;
  if (Object.keys(patch).length) { batch.set(db.collection('products').doc(id), patch, { merge: true }); inB++; filled++; }
  if (inB >= 300) { await batch.commit(); batch = db.batch(); inB = 0; }
}
if (inB > 0) await batch.commit();
console.log(`\n■ --apply — 매칭 오플 ${filled}대 빈칸 보완(merge, 기존값 존중).`);

/**
 * ★★**reborncar-only 신규 매물 원자화** — 사장님 2026-09-16 「마음대로 하세요 추천받아서」로 착수.
 *
 * 다른 공급사(ingest-supplier-to-firestore.mts atomize())와 «같은 마스터 매칭 규칙»을 쓴다 —
 * 두 벌이 되면 손으로 넣은 차만 다른 규칙으로 선다(register-car.mts 경고). 세부트림은 마스터
 * «복사 or 공란»(지어내지 않는다) · 상품구분은 canonProductType('오플구독') 그대로.
 * ⚠ 새 차번은 자동으로 안 들인다는 원칙(사장님 2026-09-08)에 따라, 이 15대는 사람이 목록을
 * 보고 확인한 뒤 이 실행으로 들인 것이다 — 자동 회차가 앞으로 이 로직을 매번 돌리지 않는다.
 */
if (onlyReborn.length) {
  const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as unknown;
  const MASTER = ((Array.isArray(masterRaw) ? masterRaw : (masterRaw as { entries?: MasterEntry[] }).entries) || []) as MasterEntry[];
  const SUB = new Map<string, { maker: string; model: string; sub_model: string }>();
  for (const e of MASTER) {
    const mk = S(e.maker), mo = S(e.model), sm = S(e.sub_model);
    if (!mk || !mo || !sm) continue;
    for (const a of makerGroup(mk.replace(/\s/g, ''))) SUB.set(`${a}|${mo.replace(/\s/g, '')}|${sm.replace(/\s/g, '')}`, { maker: mk, model: mo, sub_model: sm });
  }
  const N2 = (v: unknown) => S(v).replace(/\s/g, '');
  const validCanon = (maker: unknown, model: unknown, sub: unknown) => {
    const mo = N2(model), sm = N2(sub); if (!mo || !sm) return null;
    for (const a of makerGroup(N2(maker))) { const hit = SUB.get(`${a}|${mo}|${sm}`); if (hit) return hit; }
    return null;
  };
  const TRIMS = new Map<string, string[]>();
  for (const e of MASTER) { if (!e.trims?.length) continue; for (const a of makerGroup(N2(e.maker))) TRIMS.set(`${a}|${N2(e.model)}|${N2(e.sub_model)}`, e.trims); }
  const trimsFor = (maker: unknown, model: unknown, sub: unknown) => { for (const a of makerGroup(N2(maker))) { const t = TRIMS.get(`${a}|${N2(model)}|${N2(sub)}`); if (t) return t; } return []; };
  const BASEDEF = new Set<string>();
  for (const e of MASTER) { if (e.base_default) for (const a of makerGroup(N2(e.maker))) BASEDEF.add(`${a}|${N2(e.model)}|${N2(e.sub_model)}`); }
  const baseTrimFor = (maker: unknown, model: unknown, sub: unknown) => { for (const a of makerGroup(N2(maker))) { if (BASEDEF.has(`${a}|${N2(model)}|${N2(sub)}`)) return '기본형'; } return ''; };

  // ★Firestore는 undefined 필드를 거부한다 — price.*.origin이 없는 기간이 있으면 그 키를 통째로 뺀다.
  const sanitizePrice = (price: unknown): Record<string, { rent?: number; deposit?: number; origin?: number }> => {
    const out: Record<string, { rent?: number; deposit?: number; origin?: number }> = {};
    for (const [k, v] of Object.entries((price as Record<string, Record<string, unknown>>) || {})) {
      const entry: Record<string, number> = {};
      for (const [k2, v2] of Object.entries(v || {})) if (v2 !== undefined) entry[k2] = v2 as number;
      out[k] = entry;
    }
    return out;
  };

  let created = 0, reviewNeeded = 0;
  let batch2 = db.batch(), inB2 = 0;
  for (const c of onlyReborn) {
    const car = S(c.car_number);
    const vname = [S(c.model), S(c.trim_name)].filter(Boolean).join(' ');
    const snap = snapToMaster({ maker: S(c.maker), model: S(c.model), vehicle_name: vname, sub_model: vname, fuel_type: S(c.fuel_type), year: S(c.year) } as EntityRecord, MASTER) as
      { maker?: string; model?: string; sub_model?: string; trim_name?: string; origin?: string; confidence?: string } | null;
    const canon = snap ? validCanon(snap.maker, snap.model, snap.sub_model) : null;
    const confirmed = !!canon && snap?.confidence === 'high';
    const identity = canon
      ? { maker: canon.maker, model: canon.model, sub_model: canon.sub_model, origin: S(snap?.origin) }
      : { maker: S(c.maker), model: S(c.model), sub_model: '', origin: '' };
    const trim_name = cleanTrim(S(snap?.trim_name) || S(c.trim_name), identity.maker, identity.model, identity.sub_model, trimsFor(identity.maker, identity.model, identity.sub_model), baseTrimFor(identity.maker, identity.model, identity.sub_model));
    if (!confirmed || !identity.sub_model) reviewNeeded++;

    // ★상태 한 벌은 resolveStatus() «한 곳»에서만 — 손으로 계산하면 status_kind 가 시스템 기대와 어긋난다
    //   (실측: 21대 직접 계산 시 status_kind 드리프트 21로 재고 계약 위반).
    const statusBundle = resolveStatus({ base: '', raw: '출고가능', locked: '' });
    const atom: Record<string, unknown> = {
      car_number: car,
      provider_company_code: 'RP023',
      provider_name: '오토플러스',
      maker: identity.maker, model: identity.model, sub_model: identity.sub_model, trim_name, origin: identity.origin,
      vin: S(c.vin), year: S(c.year), first_registration_date: S(c.first_registration_date),
      mileage: S(c.mileage), fuel_type: S(c.fuel_type), ext_color: S(c.ext_color), engine_cc: S(c.engine_cc),
      seats: S(c.seats), photo_link: S(c.photo_link), options: S(c.options),
      price: sanitizePrice(c.price), reborncar_product_id: c.reborncar_product_id,
      product_type: '오플구독', ...statusBundle,
      source: 'reborncar', source_schema: 'reborncar-v1',
      _direct_ingest_at: Date.now(), erp_first_seen_date: new Date().toISOString().slice(0, 10),
      ...(confirmed ? {} : { legacy_confirmed: false, status_reason: '마스터 매칭 검수필요(low/no confidence) — 신규등록' }),
    };
    batch2.set(db.collection('products').doc(`RP023_${car.replace(/\s/g, '')}`), atom, { merge: true });
    inB2++; created++;
    if (inB2 >= 300) { await batch2.commit(); batch2 = db.batch(); inB2 = 0; }
  }
  if (inB2 > 0) await batch2.commit();
  console.log(`\n■ reborncar-only 신규 등록 — ${created}대 원자 생성(마스터 확정 ${created - reviewNeeded} · 검수필요 ${reviewNeeded})`);
  for (const c of onlyReborn) console.log(`  ${S(c.car_number)} — ${S(c.maker)} ${S(c.model)} ${S(c.trim_name)}`);
} else {
  console.log('  reborncar-only 신규 매물 없음.');
}
console.log('  이어서: npx tsx scripts/materialize-product-list-atom.mts (상품리스트용 원자 재생성)');
process.exit(0);
