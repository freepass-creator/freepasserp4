/**
 * **모델 ↔ 세부모델 정합성 검사.** 읽기 전용.
 *
 * ★불변식 — 세부모델은 **그 모델의 세대**여야 한다.
 *   「기아 K8」인데 세부모델이 「더 2026 셀토스 SP3」인 상태는 존재할 수 없다.
 *   5단계(제조사 → 모델 → 세부모델 → 파워트레인 → 세부트림)는 계단이라
 *   윗 칸을 어기는 아랫 칸이 붙으면 그 아래가 전부 남의 것이 된다 —
 *   파워트레인·트림까지 셀토스 것으로 붙어 영업자가 다른 차를 판다.
 *
 * 공급사는 모델을 거의 안 틀린다(차종 칸에 「K8」이라고 적는다).
 * 그러니 어긋남이 보이면 **우리 매칭이 틀린 것**이지 시트가 틀린 게 아니다.
 *
 * 실측(2026-08-10): 이안카 4대가 K8 인데 셀토스 SP3 세대가 붙어 있었다.
 * 원인은 마스터의 「K8 GL3」이 2024 로 끊겨 2026 연식을 받을 K8 세대가 없었던 것.
 * 연식이 안 맞으면 **모델을 넘어가 버린다** — 넘어가면 안 된다.
 *
 *   npx tsx scripts/audit-model-submodel-integrity.mts
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
/** 세부모델 → 그 세부모델이 속한 모델·제조사. */
const owner = new Map<string, { model: string; maker: string }>();
for (const e of entries) if (S(e.sub_model)) owner.set(S(e.sub_model), { model: S(e.model), maker: S(e.maker) });

const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${t}`)).text()) || {};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const live = Object.entries<Rec>(prods).filter(([, p]) => p && typeof p === 'object' && !dead(p))
  .map(([k, p]) => ({ ...p, _key: k, product_code: p.product_code || k } as EntityRecord));

type Bad = { plate: string; code: string; key: string; maker: string; model: string; sub: string; owns: string; listed: boolean };
const bad: Bad[] = [];
const unknownSub: Bad[] = [];
for (const p of live) {
  const r = p as Rec;
  const sub = S(r.sub_model);
  if (!sub) continue;
  const own = owner.get(sub);
  const row: Bad = {
    plate: S(r.car_number) || '(무번호)', code: S(r.provider_company_code), key: S(r._key),
    maker: S(r.maker), model: S(r.model), sub, owns: own ? `${own.maker} / ${own.model}` : '',
    listed: !isHiddenFromCatalog(r) && priceList(p).length > 0,
  };
  // 마스터에 없는 세부모델 — 규격 밖 자유입력이라 계단이 성립하지 않는다.
  if (!own) { unknownSub.push(row); continue; }
  if (S(r.model) && own.model && S(r.model) !== own.model) bad.push(row);
  else if (S(r.maker) && own.maker && S(r.maker) !== own.maker) bad.push(row);
}

console.log('■ 모델 ↔ 세부모델 정합성\n');
console.log(`  활성 ${live.length}대 · 세부모델이 다른 모델의 것 ${bad.length}대 · 마스터에 없는 세부모델 ${unknownSub.length}대\n`);
if (bad.length) {
  console.log(`  ★어긋남 — 세부모델이 남의 모델 것이다`);
  for (const b of bad) {
    console.log(`   ${b.plate.padEnd(11)} ${b.code.padEnd(9)} 「${b.maker} ${b.model}」인데 세부모델 「${b.sub}」 (이건 ${b.owns} 것)${b.listed ? ' · 목록에 섬' : ''}`);
  }
}
if (unknownSub.length) {
  const by = new Map<string, number>();
  for (const u of unknownSub) by.set(u.sub, (by.get(u.sub) || 0) + 1);
  console.log(`\n  마스터에 없는 세부모델 ${by.size}종`);
  for (const [k, n] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${String(n).padStart(4)}대  「${k}」`);
}
if (!bad.length) console.log('  ✓ 어긋남 없음');
process.exit(bad.length ? 1 : 0);
