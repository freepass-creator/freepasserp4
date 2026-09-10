/**
 * **링크 사진을 한 번 풀어 «손님이 읽는 원장»에 저장해 둔다.** 기본 dry-run, 반영은 `--apply`.
 *
 * 왜 필요한가(2026-09-05 실측). 우리 사진의 절반 가까이는 «이미지 주소»가 아니라 **드라이브 폴더·
 * 공급사 상세페이지 링크**다. 지금은 그걸 **화면이 볼 때마다** 푼다 — 한 건에 드라이브 1.4초 ·
 * 모던렌트카 0.6초. 손님 첫 화면에 링크 매물이 서른이면 동시 6개로 묶어도 마지막 카드가 뜨기까지
 * 7초가 걸리고, **손님이 바뀔 때마다 처음부터 다시 긁는다.**
 * 그동안 카드는 회색 판이라 손님은 「사진 없는 차」로 보고 지나간다.
 *
 * ⇒ 한 번 풀어 `photo_cache` 에 넣어 둔다. 손님 공개 API 가 그걸 그대로 `image_urls` 로 내려 주므로
 *   카드가 **즉시** 그려진다.
 *
 * ★★★**«두 원장»에 다 쓴다 — 한쪽만 쓰면 손님한테는 없는 것이다**(2026-09-10 실측).
 *   2026-09-05 부터 이 스크립트는 RTDB `v4/products` 에만 썼는데, 손님 API(`/api/catalog/feed`,
 *   `/api/catalog/quote`, `/q/[code]`)는 `firestore-ref-shim` 을 거쳐 **파이어스토어를 먼저** 읽는다.
 *   그래서 실측이 이랬다:
 * ```
 *     RTDB      v4/products  1,441건 · photo_cache 있음  218
 *     Firestore products     1,467건 · photo_cache 있음    0   ← 손님이 보는 원장
 * ```
 *   **218대 분량을 이미 다 풀어 놓고도 손님 화면은 한 대도 못 쓰고 매번 다시 긁고 있었다.**
 *   문을 하나로 합치는 것(심 스왑)은 이관 세션 몫이라, 그때까지는 **양쪽에 같이 쓴다.**
 *   지금 손님은 파이어스토어를 보고, 나중에 RTDB 를 걷으면 남는 쪽이 이미 채워져 있다.
 *   ⚠ 한쪽에만 쓰면 **플립하는 날 사진이 통째로 사라진다.** 그게 이 규칙의 이유다.
 *   ★기계 검사 = `npm run check:photo-ledger`.
 *
 * ★두 원장의 «열쇠가 다르다» — RTDB 키는 `공급사_차번`, 파이어스토어 문서 id 는 «차번»이다.
 *   그래서 `product_code` 로 맞춘다(실측 캐시 218건 전부 이 열쇠로 닿았다). 코드가 없는 문서(193건)는
 *   차번으로 한 번 더 맞춘다. **파이어스토어에 짝이 없는 차에는 문서를 새로 만들지 않는다** —
 *   손님 원장에 없는 차를 여기서 만들면 재고가 두 군데서 세어진다.
 *
 * ★긁는 일은 **앱과 같은 길**로 한다 — `/api/extract-photos`(화면이 부르는 그 API)를 그대로 부른다.
 *   스크래핑 규칙을 여기 복붙하면 화면에 뜨는 사진과 저장해 둔 사진이 갈린다
 *   (`adopt-web-photos`·`audit-photo-resolve` 가 같은 이유로 그렇게 한다).
 * ★★**원본 `photo_link` 는 건드리지 않는다.** 이건 «캐시»지 정본이 아니다.
 *   그래서 캐시에 그때 푼 **출처 주소(`src`)를 같이 적는다** — 나중에 공급사가 사진링크를 바꾸면
 *   `src` 가 달라져 캐시가 저절로 무효가 된다. 안 그러면 «바뀐 링크 · 옛 사진»이 굳는다.
 * ★저장된 직접 사진(`image_urls` 등)이 있는 차는 손대지 않는다 — 그게 이미 정본이다.
 * ★두 번 돌려도 안전하다. 신선한 캐시(기본 14일)는 건너뛴다 — 다시 긁으려면 `--force`.
 *   ⚠ 신선한지는 **손님이 읽는 원장** 기준으로 본다. 그쪽이 비어 있고 다른 쪽에 같은 출처의
 *   신선한 캐시가 있으면 **긁지 않고 옮겨만 쓴다**(드라이브를 두 번 두드릴 이유가 없다).
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
const S = (v: unknown) => String(v ?? '').trim();

const BASE = arg('--base', 'http://localhost:4004');
const LIMIT = Number(arg('--limit', '0')) || 0;
const FRESH_DAYS = Number(arg('--days', '14')) || 14;
const APPLY = has('--apply');
const FORCE = has('--force');
/** 외부 사이트를 두드리므로 넷씩 묶는다 — 화면(동시 6)보다 낮게 잡아 손님 쪽을 밀어내지 않는다. */
const CONC = 4;
const SELLABLE = new Set(['즉시출고', '출고가능', '출고협의', '상품화중']);
/**
 * **몇 장까지 담나.**
 *
 * ⚠⚠ 2026-09-10 까지 **열두 장**에서 잘랐다. 「상세 갤러리가 그 이상은 안 쓴다」고 적어 뒀는데
 *   그게 틀렸다 — 갤러리는 화살표로 **끝까지** 넘어간다. 실측하니 캐시 218건 중 **205건이 정확히
 *   열두 장**이었다. 열두 장짜리 폴더가 205개일 리 없다. **잘린 것이다.**
 *   사장님 2026-09-09 「사진 10장 이상짜리로 테스트를 해야지」 · 「**다 눌러서 보여야 하는데**」 —
 *   손님이 못 본 사진은 「없는 사진」이다.
 * ⇒ 마흔으로 올린다. 레코드가 무거워지는 걱정은 재 보면 마흔 장이라도 3KB 남짓이라 문제가 아니다.
 *   마흔이라는 상한 자체는 남긴다 — 폴더 하나가 수백 장일 때 원장이 통째로 부푸는 것만 막는다.
 */
const PHOTO_CAP = 40;

type PhotoCache = { urls?: string[]; at?: string; src?: string };
/** 두 원장에서 같은 차를 가리키는 «한 줄». 열쇠가 서로 달라 둘 다 들고 다닌다. */
type Car = {
  code: string;
  plate: string;
  rtdbKey: string | null;
  fsDocId: string | null;
  /** 손님이 읽는 원장(파이어스토어)이 있으면 그것, 없으면 RTDB. 판정은 손님이 보는 것으로 한다. */
  guest: EntityRecord;
  /** 다른 원장에 이미 풀어 둔 캐시가 있으면 그걸 옮겨 쓴다(긁지 않는다). */
  otherCache: PhotoCache | null;
};

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const fs = getFirestore();

  const rtdb = ((await db.ref('v4/products').get()).val() || {}) as Record<string, EntityRecord>;
  const snap = await fs.collection('products').get();

  /* ── 두 원장을 «한 줄»로 맞춘다 ─────────────────────────────────────────
     열쇠가 다르다: RTDB 키 `공급사_차번` · 파이어스토어 문서 id 「차번」.
     그래서 `product_code` 로 먼저, 없으면 차번으로 맞춘다. */
  type Doc = { id: string; code: string; plate: string; rec: EntityRecord };
  const docs: Doc[] = [];
  snap.forEach((d) => {
    const rec = d.data() as EntityRecord;
    docs.push({ id: d.id, code: S(rec.product_code) || S(rec._key), plate: S(rec.car_number) || d.id, rec });
  });
  const byCode = new Map<string, Doc>();
  const byPlate = new Map<string, Doc>();
  for (const d of docs) {
    if (d.code && !byCode.has(d.code)) byCode.set(d.code, d);
    if (d.plate && !byPlate.has(d.plate)) byPlate.set(d.plate, d);
  }

  const cars: Car[] = [];
  const seenDoc = new Set<string>();
  for (const [key, p] of Object.entries(rtdb)) {
    if (!p || p._deleted === true) continue;
    const code = S(p.product_code) || key;
    const plate = S(p.car_number);
    const hit = byCode.get(code) || (plate ? byPlate.get(plate) : undefined) || null;
    if (hit) seenDoc.add(hit.id);
    cars.push({
      code,
      plate,
      rtdbKey: key,
      fsDocId: hit?.id ?? null,
      guest: (hit?.rec ?? p) as EntityRecord,
      otherCache: hit ? ((p.photo_cache || null) as PhotoCache | null) : null,
    });
  }
  /* 파이어스토어에만 있는 차 — RTDB 짝이 없어도 손님은 본다. 빠뜨리면 그 차만 계속 회색 판이다. */
  for (const d of docs) {
    if (seenDoc.has(d.id)) continue;
    if ((d.rec as EntityRecord)._deleted === true) continue;
    cars.push({ code: d.code || d.id, plate: d.plate, rtdbKey: null, fsDocId: d.id, guest: d.rec, otherCache: null });
  }

  const freshBefore = Date.now() - FRESH_DAYS * 86_400_000;
  type Job = { car: Car; src: string; copy: PhotoCache | null };
  const jobs: Job[] = [];
  let skipDirect = 0;
  let skipFresh = 0;

  for (const car of cars) {
    const p = car.guest;
    if (!SELLABLE.has(S(p.vehicle_status).replace(/\s+/g, ''))) continue;
    // 저장된 직접 사진이 있으면 그게 정본이다 — 캐시로 덮지 않는다.
    if (productImages(p).length) { skipDirect += 1; continue; }
    const src = scrapableSources(p)[0];
    if (!src) continue;
    const fresh = (c: PhotoCache | null | undefined) => !!c && c.src === src && !!c.at
      && Date.parse(c.at) > freshBefore && (c.urls || []).length > 0;
    // 같은 출처를 최근에 풀었으면 건너뛴다. 출처가 달라졌으면 다시 푼다(공급사가 링크를 바꾼 것이다).
    if (!FORCE && fresh((p.photo_cache || null) as PhotoCache)) { skipFresh += 1; continue; }
    /* 손님 원장은 비었는데 다른 원장에 «같은 출처»의 신선한 캐시가 있으면 옮겨만 쓴다. */
    const copy = !FORCE && fresh(car.otherCache) ? car.otherCache : null;
    jobs.push({ car, src, copy });
  }

  const list = LIMIT ? jobs.slice(0, LIMIT) : jobs;
  const copies = list.filter((j) => j.copy).length;
  console.log(`\n■ 링크 사진 캐시 ${APPLY ? '(반영)' : '(dry-run)'} — ${BASE}/api/extract-photos`);
  console.log(`  원장  RTDB ${Object.keys(rtdb).length}건 · 파이어스토어 ${docs.length}건 → 맞춘 차 ${cars.length}대`);
  console.log(`  할 일 ${list.length}건${LIMIT && jobs.length > LIMIT ? ` (전체 ${jobs.length})` : ''}`
    + ` — 긁을 것 ${list.length - copies} · 옮겨 쓸 것 ${copies}`);
  console.log(`  건너뜀 — 직접사진 ${skipDirect} · 캐시가 신선함 ${skipFresh}\n`);
  if (!list.length) {
    console.log('  풀 것이 없습니다.\n');
    return;
  }

  let ok = 0;
  let empty = 0;
  let fail = 0;
  let photos = 0;
  /** 차 한 대 → 넣을 캐시. 쓰는 곳이 둘이라 «차»로 들고 있다가 원장별로 나눈다. */
  const writes: { car: Car; cache: PhotoCache }[] = [];
  const failures: string[] = [];
  let idx = 0;

  const worker = async () => {
    for (;;) {
      const job = list[idx++];
      if (!job) return;
      const label = job.car.plate || job.car.code;
      if (job.copy) {
        // 이미 풀어 둔 것을 손님 원장으로 옮기는 것뿐이다 — 드라이브를 다시 두드리지 않는다.
        ok += 1;
        photos += (job.copy.urls || []).length;
        writes.push({ car: job.car, cache: job.copy });
        continue;
      }
      try {
        const res = await fetch(`${BASE}/api/extract-photos?url=${encodeURIComponent(job.src)}&size=640`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(30_000),
        });
        const body = await res.json().catch(() => ({})) as { ok?: boolean; urls?: string[] };
        const urls = (body.urls || []).filter((u) => typeof u === 'string' && u);
        if (!res.ok || body.ok === false) { fail += 1; failures.push(`오류    ${label}  ${job.src}`); continue; }
        if (!urls.length) { empty += 1; failures.push(`빈 결과 ${label}  ${job.src}`); continue; }
        ok += 1;
        photos += Math.min(urls.length, PHOTO_CAP);
        writes.push({ car: job.car, cache: { urls: urls.slice(0, PHOTO_CAP), at: new Date().toISOString(), src: job.src } });
      } catch (e) {
        fail += 1;
        failures.push(`오류    ${label}  ${String(e).slice(0, 60)}`);
      }
      if (idx % 25 === 0) console.log(`  … ${idx}/${list.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));

  const lens = writes.map((w) => (w.cache.urls || []).length).sort((a, b) => a - b);
  console.log(`\n  성공 ${ok} · 빈 결과 ${empty} · 오류 ${fail} · 받은 사진 ${photos}장`);
  if (lens.length) {
    console.log(`  장수 — 최소 ${lens[0]} · 중앙 ${lens[Math.floor(lens.length / 2)]} · 최대 ${lens[lens.length - 1]}`
      + ` · 상한(${PHOTO_CAP})에 걸린 것 ${lens.filter((n) => n === PHOTO_CAP).length}건`);
  }
  if (failures.length) {
    console.log('\n  못 푼 것 (앞 12건)');
    for (const f of failures.slice(0, 12)) console.log(`    ${f}`);
    console.log('  ※ 빈 결과 = 폴더는 있는데 사진이 없거나 공유가 안 걸린 것. 원천을 손봐야 한다.');
  }

  const noDoc = writes.filter((w) => !w.car.fsDocId).length;
  if (noDoc) {
    console.log(`\n  ⚠ 파이어스토어에 짝이 없는 차 ${noDoc}대 — RTDB 에만 넣는다(문서를 새로 만들지 않는다).`);
  }

  if (!APPLY) {
    console.log('\n※ dry-run. 실제 반영은 --apply\n');
    return;
  }

  /*
   * ── 쓰기 : «두 원장에 같이» ─────────────────────────────────────────────
   * ⚠ `updatedAt` 을 건드리지 않는다. 이건 사람이 고친 게 아니라 «우리가 미리 풀어 둔 것»이라,
   *   그걸 수정으로 세면 「누가 언제 바꿨나」가 흐려진다.
   * ⚠ RTDB 는 `v4/…` 에만 쓴다(CLAUDE.md — v3 구데이터 write 금지).
   */
  const rtdbWrites = writes.filter((w) => w.car.rtdbKey);
  for (let i = 0; i < rtdbWrites.length; i += 200) {
    const patch: Record<string, PhotoCache> = {};
    for (const w of rtdbWrites.slice(i, i + 200)) patch[`${w.car.rtdbKey}/photo_cache`] = w.cache;
    await db.ref('v4/products').update(patch);
    console.log(`  … RTDB 저장 ${Math.min(i + 200, rtdbWrites.length)}/${rtdbWrites.length}`);
  }

  /* 파이어스토어 = 손님이 읽는 원장. 여기 안 쓰면 손님 화면에는 «없는 것»이다. */
  const fsWrites = writes.filter((w) => w.car.fsDocId);
  for (let i = 0; i < fsWrites.length; i += 400) {
    const batch = fs.batch();
    for (const w of fsWrites.slice(i, i + 400)) {
      batch.set(fs.collection('products').doc(w.car.fsDocId!), { photo_cache: w.cache }, { merge: true });
    }
    await batch.commit();
    console.log(`  … 파이어스토어 저장 ${Math.min(i + 400, fsWrites.length)}/${fsWrites.length}`);
  }

  console.log(`\n✓ 사진 캐시를 넣었습니다 — 파이어스토어(손님 원장) ${fsWrites.length}대 · RTDB ${rtdbWrites.length}대\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
