/**
 * **사진 원칙 감사** — 사진이 «어디 것»이어야 하는지의 규칙을 지키는지 본다. 읽기 전용.
 *
 * ★사장님 2026-09-01 「구글시트에는 그냥 **티카 링크**를 걸자고 했고 그게 이제 **픽업구독**이지?
 *   그게 아니면 **다 우리 사진화해서 구글드라이브 사진**을 보여주자고 했거든.
 *   그 원칙도 안 지켜지는 거 같아.」
 *   같은 날 보탬 — 「**오토플러스는 구글드라이브에 똑같이 같이 써.** 굳이 우리 걸로 안 갖고 와도 된다는 거야.」
 *   → 그래서 예외는 **픽업구독 하나뿐**이다. 오토플러스도 ②로 간다.
 *
 * ```
 *   ① 픽업구독(RP012 픽업재고 · T카)  →  티카 링크 그대로
 *   ② 그 밖 전부(오토플러스 포함)      →  우리 구글드라이브
 * ```
 *
 * ⚠ **구글 시트를 읽지 않는다** — ERP(RTDB)만 본다. 자동동기와 할당량을 다투지 않기 위해
 *   (`audit-supplier-health` 와 같은 이유. 2026-08-30 실측으로 배운 것).
 *
 * ★**있는 감사기와 겹치지 않는다** — `audit-photo-coverage` 는 「사진이 **있나 없나**」를 센다.
 *   이 자는 「**어디 것이냐**(원칙대로냐)」와 「**화면에 뜨느냐**」를 본다. 둘은 다른 물음이다:
 *   주소가 있어도 그게 사진이 아니라 «상세페이지»면 있는데 안 뜬다(실측 — 아이언렌트카 4대).
 *
 * 여기서 **고치지 않는다.** 사진을 시트에 쓰는 문지기는 따로 있다 —
 * `restore-photo-links-from-backup` · `adopt-web-photos` · `sync-plate-cell-links`
 * (`sheet-import.ts:937` 「검증은 «시트에 넣을 때» 한다」).
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/audit-photo-policy.mts
 */
import nextEnv from '@next/env';
import { mkdirSync, writeFileSync } from 'node:fs';

nextEnv.loadEnvConfig(process.cwd());
process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';

const [{ firebaseAdminDatabase }, { readProducts, readPartners }, photos] = await Promise.all([
  import('../lib/server/firebase-admin'),
  import('../lib/server/sheet-daily-sync'),
  import('../lib/domain/product-photos'),
]);

const S = (v: unknown) => String(v ?? '').trim();
const db = firebaseAdminDatabase();
const companyId = S(process.env.SHEET_SYNC_COMPANY_ID || 'freepass');
const [partners, products] = await Promise.all([readPartners(db, companyId), readProducts(db, companyId)]);

const nameOf = new Map<string, string>();
for (const p of partners as unknown as Record<string, unknown>[]) {
  const code = S(p.provider_company_code || p.company_code || p.partner_code);
  const name = S(p.company_name || p.name);
  if (code && name) nameOf.set(code, name);
}

/**
 * 사진 주소가 «어디 것»인가.
 *
 * ⚠ **`/tcar|lotte/` 로 가르면 틀린다** — 2026-09-01 에 이걸로 22대를 「티카」로 잘못 찍었다.
 *   `moderen**tcar**.co.kr` · `ironren**tcar**.com` 안에 「tcar」가 들어 있어서다.
 *   실제 티카는 롯데렌터카의 이미지 서버 `img-mycarsave.lotterentacar.net` 이다.
 *   **호스트로 가른다. 글자 조각으로 가르지 않는다.**
 */
type Src = '드라이브' | '티카' | '없음' | string;
const hostOf = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const srcOf = (url: string): Src => {
  if (!url) return '없음';
  const h = hostOf(url.split(/[\s,]+/)[0] || url);
  if (!h) return '(주소아님)';
  if (/(^|\.)(drive\.google\.com|googleusercontent\.com|googleapis\.com|firebasestorage\.app)$/.test(h)) return '드라이브';
  if (/(^|\.)lotterentacar\.net$/.test(h)) return '티카';
  return h;
};

/**
 * ★픽업인가 — **소스탭으로 가른다.** 공급사 코드로는 못 가른다.
 *   `sales-block.ts:28` 「RP012 이면서 탭 이름에 「픽업」 → 픽업구독」.
 *   RP012 하나가 손오공구독·픽업구독 둘을 함께 대므로(2026-08-27 합침), 코드만 보면 331대를
 *   통째로 「티카 써도 되는 차」로 봐 버린다. 그러면 위반이 0으로 보인다.
 */
const isPickup = (p: Record<string, unknown>): boolean =>
  /픽업/.test(S(p.sheet_source_tab)) || /픽업/.test(S(p.product_type));

/**
 * ★**화면에 뜨나** — 원자와 «같은 함수»로 판정한다(`audit-photo-coverage` 머리의 규칙과 같은 이유:
 *   리포트와 화면이 기준을 달리 쓰면 「여긴 있다는데 화면엔 없다」가 된다).
 *   · 바로     = productPhotos 가 주소를 준다(이미지 파일)
 *   · 서버해석 = 드라이브 폴더·상세페이지 — `use-product-photos` 가 /api/extract-photos 로 푼다
 *   · **못뜬다** = 주소는 있는데 이미지도 아니고 해석 대상도 아니다 ← 여기가 진짜 고장이다
 */
const renderOf = (p: Record<string, unknown>): '바로' | '서버해석' | '깨진다' | '못뜬다' | '주소없음' => {
  if (!S(p.photo_link) && !photos.productImages(p as never).length) return '주소없음';
  const direct = photos.productPhotos(p as never);
  if (direct.length) {
    /**
     * ★**원자는 「https 면 이미지」로 친다** — 그림 파일인지 «페이지»인지 못 가린다.
     *   실측 2026-09-01 — 아이언렌트카 4대의 사진칸은 `ironrentcar.com/vehicles/<uuid>?condition=used`,
     *   즉 상세페이지다. `<img src=페이지>` 는 브라우저에서 깨진다. 원자 기준으로만 세면
     *   「다 뜬다 ✓」가 나와 **고장이 초록불로 보인다.** 그래서 여기서 한 겹 더 본다.
     */
    const looksImage = direct.some((u) => /\.(jpe?g|png|webp|gif|avif|bmp)(\?|$)/i.test(u.replace(/^\/api\/img\?url=/, '')));
    return looksImage ? '바로' : '깨진다';
  }
  if (photos.scrapableSources(p as never).length) return '서버해석';
  return '못뜬다';
};

type Bad = { 차번: string; 공급사: string; 탭: string; 출처: string; 상태: string; 화면: string };
const 위반: Record<string, Bad[]> = {
  '★주소는 있는데 화면에 못 뜬다': [],
  '②인데 드라이브가 아니다': [],
  '①인데 티카가 아니다': [],
  '사진이 아예 없다': [],
};
const 정상 = { 픽업티카: 0, 드라이브: 0 };
const 없음별공급사 = new Map<string, number>();

for (const raw of products.active as unknown as Record<string, unknown>[]) {
  const p = raw;
  const code = S(p.provider_company_code) || '(공급사없음)';
  const bad: Bad = {
    차번: S(p.vehicle_no) || S(p.car_number),
    공급사: `${code} ${nameOf.get(code) || ''}`.trim(),
    탭: S(p.sheet_source_tab) || '(탭없음)',
    출처: srcOf(S(p.photo_link)),
    상태: S(p.vehicle_status),
    화면: renderOf(p),
  };
  const 픽업 = isPickup(p);

  if (bad.출처 === '없음') {
    위반['사진이 아예 없다'].push(bad);
    없음별공급사.set(code, (없음별공급사.get(code) ?? 0) + 1);
    continue;
  }
  /** ★«안 뜨는 것»이 «원칙에 어긋난 것»보다 급하다 — 원칙 밖이어도 뜨면 손님은 차를 본다. */
  if (bad.화면 === '못뜬다' || bad.화면 === '깨진다') { 위반['★주소는 있는데 화면에 못 뜬다'].push(bad); continue; }
  if (픽업) {
    if (bad.출처 === '티카') 정상.픽업티카 += 1;
    else 위반['①인데 티카가 아니다'].push(bad);
    continue;
  }
  if (bad.출처 === '드라이브') { 정상.드라이브 += 1; continue; }
  위반['②인데 드라이브가 아니다'].push(bad);
}

const pad = (v: unknown, n: number) => String(v).padEnd(n);
console.log('■ 사진 원칙 감사 — ERP 활성 ' + products.active.length + '대');
console.log('   ① 픽업구독 → 티카 링크   ② 그 밖 전부(오토플러스 포함) → 우리 구글드라이브');
console.log(`\n■ 원칙대로인 것   픽업·티카 ${정상.픽업티카}대 · 드라이브 ${정상.드라이브}대`);

for (const [제목, list] of Object.entries(위반)) {
  if (!list.length) { console.log(`\n■ ${제목} — 없다 ✓`); continue; }
  console.log(`\n■ ★${제목} — ${list.length}대`);
  /** 공급사·출처로 묶어 보여 준다. 한 대씩 찍으면 292줄이 되어 아무도 안 본다. */
  const g = new Map<string, Bad[]>();
  for (const b of list) {
    const k = `${b.공급사} ‖ ${b.탭} ‖ ${b.출처} ‖ ${b.화면}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k)!.push(b);
  }
  for (const [k, v] of [...g.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const [sup, tab, src, view] = k.split(' ‖ ');
    console.log(`   ${pad(sup, 16)} ${pad(tab.slice(0, 12), 13)} ${pad(src, 26)} ${pad(view, 6)} ${String(v.length).padStart(4)}대   ${v.slice(0, 3).map((x) => x.차번).join(' ')}`);
  }
}

/** ★출고가능인데 사진이 없는 차 = 곧 «못 파는 차»다. 여기가 돈이 새는 자리다. */
const 팔건데없다 = 위반['사진이 아예 없다'].filter((b) => b.상태 === '출고가능');
console.log(`\n■ ★출고가능인데 사진이 없다 — ${팔건데없다.length}대 (이게 곧 못 파는 차다)`);
{
  const g = new Map<string, number>();
  for (const b of 팔건데없다) g.set(b.공급사, (g.get(b.공급사) ?? 0) + 1);
  for (const [sup, n] of [...g.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${pad(sup, 18)} ${String(n).padStart(4)}대`);
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/photo-policy.json', JSON.stringify({
  at: new Date().toISOString(), 활성: products.active.length, 정상, 위반, 출고가능인데없음: 팔건데없다,
}, null, 1));
console.log('\n기록 tmp/photo-policy.json · 여기서 고치지 않는다 — 어긋난 곳을 보여만 준다');
