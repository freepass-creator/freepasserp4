/**
 * **링크 사진을 한 번 풀어 저장해 둔다.** 기본 dry-run, 반영은 `--apply`.
 *
 * 왜 필요한가(2026-09-05 실측). 우리 사진의 절반 가까이는 «이미지 주소»가 아니라 **드라이브 폴더·
 * 공급사 상세페이지 링크**다(팔 수 있는 697대 중 224건). 지금은 그걸 **화면이 볼 때마다** 푼다 —
 * 한 건에 드라이브 1.4초 · 모던렌트카 0.6초. 손님 첫 화면에 링크 매물이 서른이면 동시 6개로 묶어도
 * 마지막 카드가 뜨기까지 7초가 걸리고, **손님이 바뀔 때마다 처음부터 다시 긁는다.**
 * 그동안 카드는 회색 판이라 손님은 「사진 없는 차」로 보고 지나간다.
 *
 * ⇒ 한 번 풀어 `v4/products/{key}.photo_cache` 에 넣어 둔다. 손님 공개 API 가 그걸 그대로
 *   `image_urls` 로 내려 주므로 카드가 **즉시** 그려진다.
 *
 * ★긁는 일은 **앱과 같은 길**로 한다 — `/api/extract-photos`(화면이 부르는 그 API)를 그대로 부른다.
 *   스크래핑 규칙을 여기 복붙하면 화면에 뜨는 사진과 저장해 둔 사진이 갈린다
 *   (`adopt-web-photos`·`audit-photo-resolve` 가 같은 이유로 그렇게 한다).
 * ★★**원본 `photo_link` 는 건드리지 않는다.** 이건 «캐시»지 정본이 아니다.
 *   그래서 캐시에 그때 푼 **출처 주소(`src`)를 같이 적는다** — 나중에 공급사가 사진링크를 바꾸면
 *   `src` 가 달라져 캐시가 저절로 무효가 된다. 안 그러면 «바뀐 링크 · 옛 사진»이 굳는다.
 * ★저장된 직접 사진(`image_urls` 등)이 있는 차는 손대지 않는다 — 그게 이미 정본이다.
 * ★두 번 돌려도 안전하다. 신선한 캐시(기본 14일)는 건너뛴다 — 다시 긁으려면 `--force`.
 *
 *   npm run dev 를 띄운 뒤
 *   GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/cache-photo-urls.mts
 *   GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/cache-photo-urls.mts --apply
 *   … --limit 40 · --days 7 · --force · --base http://localhost:4004
 */
import { readFileSync } from 'node:fs';
import { productImages, scrapableSources } from '../lib/domain/product-photos';
import type { EntityRecord } from '../lib/intake/entities';

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const has = (name: string) => process.argv.includes(name);

const BASE = arg('--base', 'http://localhost:4004');
const LIMIT = Number(arg('--limit', '0')) || 0;
const FRESH_DAYS = Number(arg('--days', '14')) || 14;
const APPLY = has('--apply');
const FORCE = has('--force');
/** 외부 사이트를 두드리므로 넷씩 묶는다 — 화면(동시 6)보다 낮게 잡아 손님 쪽을 밀어내지 않는다. */
const CONC = 4;
const SELLABLE = new Set(['즉시출고', '출고가능', '출고협의', '상품화중']);

type PhotoCache = { urls?: string[]; at?: string; src?: string };

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const all = ((await db.ref('v4/products').get()).val() || {}) as Record<string, EntityRecord>;

  const freshBefore = Date.now() - FRESH_DAYS * 86_400_000;
  type Job = { key: string; plate: string; src: string };
  const jobs: Job[] = [];
  let skipDirect = 0;
  let skipFresh = 0;

  for (const [key, p] of Object.entries(all)) {
    if (!p || p._deleted === true) continue;
    if (!SELLABLE.has(String(p.vehicle_status || '').replace(/\s+/g, ''))) continue;
    // 저장된 직접 사진이 있으면 그게 정본이다 — 캐시로 덮지 않는다.
    if (productImages(p).length) { skipDirect += 1; continue; }
    const src = scrapableSources(p)[0];
    if (!src) continue;
    const cache = (p.photo_cache || {}) as PhotoCache;
    // 같은 출처를 최근에 풀었으면 건너뛴다. 출처가 달라졌으면 다시 푼다(공급사가 링크를 바꾼 것이다).
    if (!FORCE && cache.src === src && cache.at && Date.parse(cache.at) > freshBefore && (cache.urls || []).length) {
      skipFresh += 1;
      continue;
    }
    jobs.push({ key, plate: String(p.car_number || p.product_code || key), src });
  }

  const list = LIMIT ? jobs.slice(0, LIMIT) : jobs;
  console.log(`\n■ 링크 사진 캐시 ${APPLY ? '(반영)' : '(dry-run)'} — ${BASE}/api/extract-photos`);
  console.log(`  풀 대상 ${list.length}건${LIMIT && jobs.length > LIMIT ? ` (전체 ${jobs.length})` : ''}`
    + ` · 직접사진이라 건너뜀 ${skipDirect} · 캐시가 신선해 건너뜀 ${skipFresh}\n`);
  if (!list.length) {
    console.log('  풀 것이 없습니다.\n');
    return;
  }

  let ok = 0;
  let empty = 0;
  let fail = 0;
  let photos = 0;
  const writes: Record<string, PhotoCache> = {};
  const failures: string[] = [];
  let idx = 0;

  const worker = async () => {
    for (;;) {
      const job = list[idx++];
      if (!job) return;
      try {
        const res = await fetch(`${BASE}/api/extract-photos?url=${encodeURIComponent(job.src)}&size=640`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(30_000),
        });
        const body = await res.json().catch(() => ({})) as { ok?: boolean; urls?: string[] };
        const urls = (body.urls || []).filter((u) => typeof u === 'string' && u);
        if (!res.ok || body.ok === false) { fail += 1; failures.push(`오류    ${job.plate}  ${job.src}`); continue; }
        if (!urls.length) { empty += 1; failures.push(`빈 결과 ${job.plate}  ${job.src}`); continue; }
        ok += 1;
        photos += urls.length;
        // 열두 장이면 충분하다 — 상세 갤러리가 그 이상은 안 쓰고, 레코드만 무거워진다.
        writes[job.key] = { urls: urls.slice(0, 12), at: new Date().toISOString(), src: job.src };
      } catch (e) {
        fail += 1;
        failures.push(`오류    ${job.plate}  ${String(e).slice(0, 60)}`);
      }
      if (idx % 25 === 0) console.log(`  … ${idx}/${list.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));

  console.log(`\n  성공 ${ok} · 빈 결과 ${empty} · 오류 ${fail} · 받은 사진 ${photos}장`);
  if (failures.length) {
    console.log('\n  못 푼 것 (앞 12건)');
    for (const f of failures.slice(0, 12)) console.log(`    ${f}`);
    console.log('  ※ 빈 결과 = 폴더는 있는데 사진이 없거나 공유가 안 걸린 것. 원천을 손봐야 한다.');
  }

  if (!APPLY) {
    console.log('\n※ dry-run. 실제 반영은 --apply\n');
    return;
  }

  /*
   * 쓰기는 `v4/products/{key}/photo_cache` 한 곳뿐이다(CLAUDE.md — v3 구데이터 write 금지).
   * ⚠ `updatedAt` 을 건드리지 않는다. 이건 사람이 고친 게 아니라 «우리가 미리 풀어 둔 것»이라,
   *   그걸 수정으로 세면 「누가 언제 바꿨나」가 흐려진다.
   */
  const chunk = 200;
  const entries = Object.entries(writes);
  for (let i = 0; i < entries.length; i += chunk) {
    const patch: Record<string, PhotoCache> = {};
    for (const [key, value] of entries.slice(i, i + chunk)) patch[`${key}/photo_cache`] = value;
    await db.ref('v4/products').update(patch);
    console.log(`  … 저장 ${Math.min(i + chunk, entries.length)}/${entries.length}`);
  }
  console.log(`\n✓ ${entries.length}대에 사진 캐시를 넣었습니다.\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
