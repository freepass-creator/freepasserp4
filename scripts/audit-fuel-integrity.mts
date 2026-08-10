/**
 * **연료 정합성 검사.** 읽기 전용.
 *
 * ★불변식 — 매물의 연료는 **붙은 파워트레인의 연료**와 같아야 한다.
 *   같은 세대에 가솔린·디젤·하이브리드·전기가 함께 사는 차가 많다(쏘렌토·니로·카니발).
 *   연료가 어긋나면 파워트레인·트림·배기량이 전부 남의 것이 되고,
 *   전기차에 「가솔린 2.0」이 붙으면 손님에게 다른 차를 판다.
 *
 * 세 가지를 본다.
 *   ① 매물 연료 ↔ 파워트레인 연료가 다른가
 *   ② 전기·수소인데 배기량이 붙어 있나 (전기차에 cc 는 없다)
 *   ③ 마스터에 그 파워트레인이 실재하나 (세부모델 아래에 있는 label 인가)
 *
 *   npx tsx scripts/audit-fuel-integrity.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isHiddenFromCatalog, priceList } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const t = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const entries = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

/** 세부모델 → 파워트레인 라벨 → 연료. */
const fuelOf = new Map<string, Map<string, string>>();
for (const e of entries) {
  const m = new Map<string, string>();
  for (const v of e.variants || []) if (S(v.label)) m.set(S(v.label), S(v.fuel));
  if (S(e.sub_model)) fuelOf.set(S(e.sub_model), m);
}
/** 표기 흔들림을 접는다 — 「가솔린1.6」·「휘발유」·「EV」가 같은 말이다. */
const fold = (v: unknown): string => {
  const s = S(v).replace(/\s|\d|\./g, '').toLowerCase();
  if (/전기|ev|electric/.test(s)) return '전기';
  if (/수소|fcev/.test(s)) return '수소';
  if (/하이브리드|hev|hybrid/.test(s)) return '하이브리드';
  if (/디젤|경유|diesel/.test(s)) return '디젤';
  if (/lpg|엘피지/.test(s)) return 'LPG';
  if (/가솔린|휘발유|gasoline/.test(s)) return '가솔린';
  return s;
};

const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${t}`)).text()) || {};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const live = Object.entries<Rec>(prods).filter(([, p]) => p && typeof p === 'object' && !dead(p))
  .map(([k, p]) => ({ ...p, _key: k, product_code: p.product_code || k } as EntityRecord));

type Bad = { plate: string; code: string; car: string; variant: string; want: string; got: string; listed: boolean };
const mismatch: Bad[] = []; const ccOnEv: Bad[] = []; const unknownVariant: Bad[] = [];
for (const p of live) {
  const r = p as Rec;
  const sub = S(r.sub_model); const variant = S(r.variant);
  const listed = !isHiddenFromCatalog(r) && priceList(p).length > 0;
  const row = (want: string, got: string): Bad => ({
    plate: S(r.car_number) || '(무번호)', code: S(r.provider_company_code),
    car: `${S(r.maker)} ${sub || S(r.model)}`.trim(), variant, want, got, listed,
  });
  const vf = sub ? fuelOf.get(sub) : undefined;
  if (sub && variant && vf) {
    if (!vf.has(variant)) unknownVariant.push(row('-', variant));
    else {
      const want = fold(vf.get(variant));
      const got = fold(r.fuel_type);
      if (got && want && got !== want) mismatch.push(row(S(vf.get(variant)), S(r.fuel_type)));
    }
  }
  const f = fold(r.fuel_type);
  if ((f === '전기' || f === '수소') && Number(S(r.engine_cc).replace(/[^\d]/g, '')) > 0) {
    ccOnEv.push(row('배기량 없음', `${S(r.engine_cc)}cc`));
  }
}

const show = (title: string, rows: Bad[], note: string) => {
  console.log(`\n${title} — ${rows.length}대${note ? ` (${note})` : ''}`);
  for (const b of rows.slice(0, 14)) {
    console.log(`   ${b.plate.padEnd(11)} ${b.code.padEnd(9)} ${b.car.slice(0, 22).padEnd(24)} 파워「${b.variant}」  마스터 ${b.want} ↔ 매물 ${b.got}${b.listed ? ' · 목록에 섬' : ''}`);
  }
  if (rows.length > 14) console.log(`   … 외 ${rows.length - 14}대`);
};

console.log(`■ 연료 정합성 — 활성 ${live.length}대`);
show('★연료가 파워트레인과 다르다', mismatch, '차가 통째로 바뀐다');
show('★전기·수소인데 배기량이 있다', ccOnEv, '전기차에 cc 는 없다');
show('마스터에 없는 파워트레인', unknownVariant, '세부모델 아래에 그 label 이 없다');
const total = mismatch.length + ccOnEv.length + unknownVariant.length;
console.log(`\n${total ? `★확인할 것 ${total}대` : '✓ 어긋남 없음'}`);
process.exit(mismatch.length ? 1 : 0);
