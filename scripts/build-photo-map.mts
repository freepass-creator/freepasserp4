/**
 * 매물 차번 → 대표 사진(첫 이미지) URL 지도를 만든다. 결과는 파일로 캐시한다.
 *
 * 왜 필요한가: `photo_link` 는 이미지가 아니라 «드라이브 폴더·공급사 상세페이지» 링크라
 * 그대로는 `=IMAGE()` 에 못 쓴다. `/api/extract-photos` 가 그걸 이미지 URL로 푼다.
 *
 * ★읽는 곳은 **v4 뿐**이다. 재고는 v4 단독이 원칙이고(erp3 절연, `MIGRATION_PLAN.md`),
 *   erp3 는 «구현 참고»일 뿐 데이터 출처가 아니다. v3 에 남아 있던 photo_link 는
 *   `scripts/migrate-photo-links-to-v4.mts` 로 이미 v4 에 옮겼다(2026-08-08, 126건).
 *   여기서 v3 를 다시 읽으면 그 절연이 도로 풀린다.
 *
 * 폴더 하나당 스크래핑 1회라 느리다 → 캐시에 모아 두고 시트 내보내기가 읽어 쓴다.
 *
 *   npx tsx scripts/build-photo-map.mts            (캐시에 없는 것만)
 *   npx tsx scripts/build-photo-map.mts --refresh  (전부 다시)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const plate = (p: Rec) => S(p.car_number || p.car_number_snapshot).replace(/\s/g, '');
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const CACHE = 'tmp/photo-map.json';
const API = process.env.EXTRACT_PHOTOS_BASE || 'http://localhost:4004';
const SIZE = 320;
const CONCURRENCY = 4;

async function main() {
  const refresh = process.argv.includes('--refresh');
  const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });
  const token = (await getApps()[0].options.credential!.getAccessToken()).access_token;
  const get = async (node: string) => {
    const res = await fetch(`${DB}/${node}.json?access_token=${token}`);
    if (!res.ok) throw new Error(`${node} ${res.status}`);
    return (JSON.parse(await res.text()) || {}) as Record<string, Rec>;
  };

  const v4 = await get('v4/products');

  // 차번 → photo_link. 살아있는 것 우선, 없으면 삭제분에서도 줍는다(사진은 남아 있다).
  const linkByPlate = new Map<string, string>();
  for (const pass of [false, true]) {
    for (const p of Object.values(v4)) {
      if (!p || typeof p !== 'object' || dead(p) !== pass) continue;
      const k = plate(p);
      const link = S(p.photo_link);
      if (k && link && !linkByPlate.has(k)) linkByPlate.set(k, link);
    }
  }

  // 지금 시트에 나갈 차번만 뽑는다 — 전량을 긁으면 오래 걸리고 쓰이지도 않는다.
  const wanted = new Set<string>();
  for (const p of Object.values(v4)) {
    if (!p || typeof p !== 'object' || dead(p)) continue;
    const k = plate(p);
    if (k && linkByPlate.has(k)) wanted.add(k);
  }

  const cache: Record<string, { url: string; at: string; src: string }> = existsSync(CACHE)
    ? JSON.parse(readFileSync(CACHE, 'utf8'))
    : {};
  const todo = [...wanted].filter((k) => refresh || !cache[k]);
  console.log(`\n대상 차번 ${wanted.size} · 캐시 ${Object.keys(cache).length} · 이번에 조회 ${todo.length}\n`);
  if (!todo.length) { console.log('할 일 없음.\n'); return; }

  let done = 0, ok = 0, fail = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const k = queue.shift();
      if (!k) break;
      const link = linkByPlate.get(k) || '';
      try {
        const res = await fetch(`${API}/api/extract-photos?url=${encodeURIComponent(link)}&size=${SIZE}`, {
          signal: AbortSignal.timeout(30_000),
        });
        const body = await res.json() as { ok?: boolean; urls?: string[] };
        const url = body.ok && body.urls?.length ? body.urls[0] : '';
        if (url) { cache[k] = { url, at: new Date().toISOString(), src: link }; ok++; } else fail++;
      } catch { fail++; }
      done++;
      if (done % 20 === 0) console.log(`  ${done}/${todo.length} · 성공 ${ok} · 실패 ${fail}`);
    }
  }));

  mkdirSync('tmp', { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache, null, 2), 'utf8');
  console.log(`\n완료 — 성공 ${ok} · 실패 ${fail} · 캐시 총 ${Object.keys(cache).length}건`);
  console.log(`저장: ${CACHE}\n`);
}

main().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
