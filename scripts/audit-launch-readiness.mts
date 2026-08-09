/**
 * 오픈 전 재고·상품시트 점검 — **손님·영업자에게 보이는 것**만 본다. 읽기 전용.
 *
 * 묻는 것은 하나다: 「지금 이대로 열면 누가 무엇을 잘못 보는가.」
 *   · 팔 수 없는 차가 목록에 서 있나
 *   · 값이 없어 판단 못 할 차가 있나 (가격·차종·사진)
 *   · 같은 차가 두 번 보이나
 *   · 밖에 나가면 안 되는 값이 섞였나 (원가·수수료·차대번호·계좌)
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isListableProduct, isOfferableProduct, priceList } from '../lib/domain/product';
import { attachPolicy, dedupeForSales, exportRow, HEADERS, policyMap, resnapForSales, sortForSales } from '../lib/domain/inventory-sheet-export';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const token = (await jwt.getAccessToken()).token;
const [prodRaw, polRaw, conRaw] = await Promise.all(['v4/products', 'v4/policies', 'v4/contracts'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${token}`)).text()) || {}));
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const master: MasterEntry[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const all = Object.entries(prodRaw as Record<string, Rec>)
  .filter(([, p]) => p && typeof p === 'object' && !dead(p))
  .map(([key, p]) => ({ ...p, _key: key, product_code: p.product_code || key } as EntityRecord));

let blockers = 0; let warns = 0;
const BLOCK = (name: string, n: number, detail?: unknown) => {
  if (n > 0) { blockers++; console.log(`  ✗ ${name} — ${n}건`); if (detail) console.log(`      ${detail}`); }
  else console.log(`  ✓ ${name}`);
};
const WARN = (name: string, n: number, detail?: unknown) => {
  if (n > 0) { warns++; console.log(`  △ ${name} — ${n}건`); if (detail) console.log(`      ${detail}`); }
  else console.log(`  ✓ ${name}`);
};

console.log('■ 오픈 전 점검 — 재고 · 상품시트\n');
console.log(`  활성 매물 ${all.length}대`);

const listable = all.filter(isListableProduct);
const offerable = all.filter(isOfferableProduct);
console.log(`  목록에 서는 것 ${listable.length}대 · 견적 가능 ${offerable.length}대\n`);

// ── 1. 팔 수 없는 차가 서 있나 ─────────────────────────────
console.log('── 1. 목록에 서면 안 되는 차');
BLOCK('출고불가가 목록에 있다', listable.filter((p) => S(p.vehicle_status).replace(/\s/g, '') === '출고불가').length);
BLOCK('삭제된 차가 목록에 있다', listable.filter((p) => dead(p as Rec)).length);
const openContract = new Set(Object.values(conRaw as Record<string, Rec>)
  .filter((c) => c && !dead(c) && !/취소|해지|종료|반납완료/.test(S(c.contract_status || c.status)))
  .map((c) => S(c.product_code)).filter(Boolean));
WARN('계약이 걸린 차가 목록에 있다(마크로 알림)', listable.filter((p) => openContract.has(S(p.product_code))).length);

// ── 2. 값이 없어 판단 못 할 차 ─────────────────────────────
console.log('\n── 2. 손님·영업이 판단할 값이 있나');
BLOCK('대여료가 하나도 없다', listable.filter((p) => priceList(p).length === 0).length);
const noPlate = listable.filter((p) => !S(p.car_number));
WARN('차량번호가 없다(번호미정 신차)', noPlate.length, noPlate.slice(0, 3).map((p) => S(p.model)).join(' · '));
const noModel = listable.filter((p) => !S(p.model) && !S(p.sub_model));
BLOCK('차종을 알 수 없다(모델·세부모델 둘 다 없음)', noModel.length,
  noModel.slice(0, 3).map((p) => S(p.car_number)).join(' · '));
const noYear = listable.filter((p) => !S(p.year) && !S(p.first_registration_date));
WARN('연식을 알 수 없다', noYear.length, noYear.slice(0, 3).map((p) => `${S(p.car_number)} ${S(p.model)}`).join(' · '));

// ── 3. 같은 차가 두 번 ─────────────────────────────────────
console.log('\n── 3. 같은 차가 두 번 보이나');
const plateCount = new Map<string, number>();
for (const p of listable) {
  const plate = S(p.car_number).replace(/\s/g, '');
  if (plate) plateCount.set(plate, (plateCount.get(plate) || 0) + 1);
}
const dupPlates = [...plateCount.entries()].filter(([, n]) => n > 1);
WARN('재고 목록에 같은 차번이 둘 이상', dupPlates.length,
  dupPlates.slice(0, 5).map(([pl, n]) => `${pl}×${n}`).join(' · '));

const sheetRows = dedupeForSales(listable);
const sheetDup = new Map<string, number>();
for (const p of sheetRows) {
  const plate = S(p.car_number).replace(/\s/g, '');
  if (plate) sheetDup.set(plate, (sheetDup.get(plate) || 0) + 1);
}
BLOCK('★상품시트에 같은 차번이 둘 이상', [...sheetDup.values()].filter((n) => n > 1).length);
console.log(`      상품시트 반영 대수 ${sheetRows.length}대 (재고 ${listable.length}건에서 ${listable.length - sheetRows.length}건 접음)`);

// ── 4. 밖에 나가면 안 되는 값 ──────────────────────────────
console.log('\n── 4. 상품시트에 새면 안 되는 값');
const LEAK = ['차대번호', 'VIN', '원가', '차량가격', '수수료', '계좌', '매칭상태', '매칭메모', '내부메모'];
BLOCK('시트 머리행에 금지 항목', LEAK.filter((k) => HEADERS.includes(k)).length,
  LEAK.filter((k) => HEADERS.includes(k)).join(' · '));

const policies = policyMap(polRaw as Record<string, EntityRecord>);
const built = sortForSales(resnapForSales(sheetRows, master)).map((p) => attachPolicy(p, policies));
const sample = built.slice(0, 200).map((p) => exportRow(p, '공급사'));
const vinLike = sample.filter((row) => row.some((c) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(S(c))));
BLOCK('시트 값에 차대번호처럼 보이는 것', vinLike.length);
const bigMoney = sample.filter((row) => row.some((c) => typeof c === 'number' && c > 50_000_000));
WARN('시트 값에 5천만원 넘는 숫자(차량가 혼입 의심)', bigMoney.length);

// ── 5. 차종 매칭 상태 ──────────────────────────────────────
console.log('\n── 5. 차종이 얼마나 채워졌나 (목록 기준)');
const has = (k: string) => listable.filter((p) => S((p as Rec)[k])).length;
const pct = (n: number) => `${Math.round((n / listable.length) * 100)}%`;
console.log(`      세부모델 ${has('sub_model')}대 (${pct(has('sub_model'))})`);
console.log(`      파워트레인 ${has('variant')}대 (${pct(has('variant'))})`);
console.log(`      세부트림 ${has('trim_name')}대 (${pct(has('trim_name'))})`);
WARN('차종 검수 대기 표식이 남은 차', listable.filter((p) => (p as Rec)._needs_master_review === true).length);

console.log(`\n━━ 막는 것 ${blockers}건 · 살펴볼 것 ${warns}건`);
if (blockers) process.exit(1);
