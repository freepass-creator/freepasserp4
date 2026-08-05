/**
 * **차종마스터 오매칭 전수** — 벤츠를 크라이슬러로 광고하고 있지 않은가.
 *
 * 실측으로 확인된 유형 둘.
 *   ① 트림 문자열에 낚임 — 시트 「E200 아방가르드」 → maker 크라이슬러 · model 200
 *      (마스터에 크라이슬러가 0건인데도 그리로 붙었다)
 *   ② 마스터에 없는 제조사를 가리킴 — 르노코리아·인피니티·KG모빌리티.
 *      명칭 드리프트(르노삼성→르노코리아, 쌍용→KG모빌리티)로 보인다.
 *
 * 대수 검증으로는 절대 안 잡힌다. 영업자는 우리 화면을 보고 팔고 고객은 다른 차를 받는다.
 *
 * 읽기 전용.
 *   npx tsx scripts/audit-maker-mismatch.mts
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { dedupeProductsByVehicle } from '../lib/firebase/rtdb-products';
import { isOfferableProduct } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: DB });
const db = getDatabase();
const S = (v: unknown) => String(v ?? '').trim();

const mergeNodes = (a: unknown, b: unknown) => {
  const m: Record<string, EntityRecord> = {};
  for (const [k, v] of Object.entries((a || {}) as Record<string, EntityRecord>)) m[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((b || {}) as Record<string, EntityRecord>)) m[k] = { ...(m[k] || {}), ...v, _key: k };
  return m;
};

/** 트림 문자열이 «다른 브랜드»를 가리키는지 — 브랜드 고유 표기로만 판정한다(추측 금지). */
const BRAND_TELLS: { re: RegExp; maker: string }[] = [
  { re: /4MATIC|아방가르드|AVANTGARDE|AMG|E\s?\d{3}\s?d|C\s?\d{3}\s?d|S\s?\d{3}\s?d/i, maker: '벤츠' },
  { re: /xDrive|M\s?스포츠|\b\d{3}i\b|\b\d{2}0d\b/i, maker: 'BMW' },
  // ⚠ TDI 는 뺐다 — 폭스바겐 골프에도 TDI 가 있어서 정상 매물을 오탐으로 잡았다(133호5389·5390).
  //   브랜드 «고유» 표기만 남긴다. 애매하면 안 잡는 쪽이 낫다 — 오탐이 쌓이면 목록을 아무도 안 본다.
  { re: /콰트로|quattro|TFSI/i, maker: '아우디' },
];

async function main() {
  const [p3, p4, m3, m4] = await Promise.all([
    db.ref('products').get(), db.ref('v4/products').get(),
    db.ref('vehicle_master').get(), db.ref('v4/vehicle_master').get(),
  ]);
  const master = Object.values(mergeNodes(m3.val(), m4.val())).filter(Boolean);
  const masterMakers = new Set(master.map((m) => S(m.maker)).filter(Boolean));

  const live = Object.values(mergeNodes(p3.val(), p4.val()))
    .filter((x) => x && x._deleted !== true && !x.deletedAt && S(x.status) !== 'deleted');
  const shown = dedupeProductsByVehicle(live).filter(isOfferableProduct);

  console.log(`\n══ 차종마스터 오매칭 ══`);
  console.log(`마스터 ${master.length}건 · 제조사 ${masterMakers.size}종`);
  console.log(`게시중 상품 ${shown.length}대 (전체 살아있음 ${live.length})\n`);

  // ① 마스터에 없는 제조사를 가리키는 상품
  const orphan = new Map<string, { shown: number; live: number }>();
  for (const x of live) {
    const mk = S(x.maker);
    if (!mk || masterMakers.has(mk)) continue;
    const cur = orphan.get(mk) || { shown: 0, live: 0 };
    cur.live++; orphan.set(mk, cur);
  }
  for (const x of shown) {
    const mk = S(x.maker);
    if (!mk || masterMakers.has(mk)) continue;
    const cur = orphan.get(mk) || { shown: 0, live: 0 };
    cur.shown++; orphan.set(mk, cur);
  }
  console.log('── ① 마스터에 없는 제조사 ─────────────────────────');
  const orphanRows = [...orphan.entries()].sort((a, b) => b[1].shown - a[1].shown);
  let orphanShown = 0;
  for (const [mk, v] of orphanRows) { orphanShown += v.shown; console.log(`  ${mk.padEnd(12)} 게시 ${String(v.shown).padStart(3)} · 살아있음 ${v.live}`); }
  console.log(`  합계 게시 ${orphanShown}대`);

  // ② 트림이 다른 브랜드를 가리키는 상품 — 브랜드 고유 표기만 신뢰
  console.log('\n── ② 트림이 다른 브랜드를 가리킴 ─────────────────────');
  const suspects: EntityRecord[] = [];
  for (const x of shown) {
    const trim = `${S(x.trim_name)} ${S(x.trim_extra)} ${S(x.variant)}`;
    const mk = S(x.maker);
    for (const t of BRAND_TELLS) {
      if (t.re.test(trim) && mk && mk !== t.maker) { suspects.push({ ...x, _tell: t.maker } as EntityRecord); break; }
    }
  }
  if (!suspects.length) console.log('  없음');
  for (const s of suspects.slice(0, 30)) {
    console.log(`  ${S(s.car_number).padEnd(10)} ${S(s.provider_company_code).padEnd(9)} 우리「${S(s.maker)} ${S(s.sub_model) || S(s.model)}」 트림「${(S(s.trim_name) || S(s.trim_extra)).slice(0, 30)}」 → ${S(s._tell)} 로 보임`);
  }
  if (suspects.length > 30) console.log(`  … 외 ${suspects.length - 30}건`);
  console.log(`  합계 ${suspects.length}대`);

  console.log(`\n━━ 게시중 오매칭 의심 ${orphanShown + suspects.length}대 / ${shown.length}대\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
