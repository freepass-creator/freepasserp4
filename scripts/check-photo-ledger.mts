/**
 * **사진을 «손님이 읽는 원장»에 넣고 있나.** 읽기 전용. 어긋나면 exit 1.
 *
 * ★★왜 있나 — 2026-09-10 실측. 링크 사진을 미리 풀어 두는 `scripts/cache-photo-urls.mts` 가
 *   **RTDB 에만** 썼는데, 손님 API 는 `firestore-ref-shim` 을 거쳐 **파이어스토어를 먼저** 읽는다.
 * ```
 *     RTDB      v4/products  1,441건 · photo_cache 있음  218
 *     Firestore products     1,467건 · photo_cache 있음    0   ← 손님이 보는 원장
 * ```
 *   **218대 분량을 이미 다 풀어 놓고도 손님 화면은 한 대도 못 썼다.** 스크립트는 매번 「성공 218」
 *   이라고 초록불을 냈고, 원장이 둘이라는 것을 아무도 세지 않았다. 사장님이 화면에서 잡으셨다.
 *   ⇒ **쓰는 문과 읽는 문이 같은지**를 기계가 센다. 이관이 끝나 문이 하나가 되면 이 검사도 줄인다.
 *
 * ★무엇을 보나 (셋 다 «파일을 읽어» 센다 — 실행하지 않는다)
 *   ① 채우는 쪽이 **두 원장에 다 쓴다** — RTDB `v4/products` · 파이어스토어 `products`
 *   ② 손님 쪽이 읽는 컬렉션과 **같은 이름**에 쓴다(심의 매핑표와 대조)
 *   ③ 사진을 «두 갈래»로 모으는 곳은 **합치는 자가 하나**다(`photoDedupKey`)
 *
 * ⚠ 「없으면 조용히 통과」하지 않는다. 파일이나 문구를 못 찾으면 **실패**다 —
 *   근거가 사라진 검사는 있으나 마나다(`check-finder-rows` 에서 같은 것을 배웠다).
 *
 *   npm run check:photo-ledger
 */
import { readFileSync } from 'node:fs';

const FILLER = 'scripts/cache-photo-urls.mts';
const GUEST = 'lib/domain/public-catalog.ts';
const SHIM = 'lib/server/firestore-ref-shim.ts';
const MERGE = 'components/use-product-photos.ts';
const MIRROR = 'scripts/mirror-to-firestore.mts';

/** 주석을 걷고 본다 — 「왜 그런지」 적어 둔 자리가 벌을 받으면 안 된다(사선 0 검사에서 배운 것). */
const code = (path: string): string => readFileSync(path, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let bad = 0;
const ok = (what: string, detail: string) => console.log(`  ✓ ${what} — ${detail}`);
const fail = (what: string, detail: string) => { bad++; console.log(`  ✗ ${what}\n      ${detail}`); };
const must = (cond: boolean, what: string, detail: string) => (cond ? ok(what, detail) : fail(what, detail));

console.log('\n사진 — 채우는 문과 손님이 읽는 문이 같은가\n');

/* ── ⓪ 손님이 읽는 컬렉션 이름을 «심의 매핑표»에서 읽는다 ─────────────────
   이름을 여기 적어 두면 심이 바뀔 때 이 검사가 거짓말을 한다. 심에서 읽는다. */
const shim = code(SHIM);
const colMap = /const COL:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\}/.exec(shim);
if (!colMap) {
  fail('심의 컬렉션 매핑표를 읽었다', `${SHIM} 에서 「const COL: Record<string, string> = {…}」 를 못 찾았습니다 — 심이 바뀌었으면 이 검사도 고칩니다`);
}
const guestCollection = colMap ? (/products\s*:\s*'([^']+)'/.exec(colMap[1])?.[1] ?? '') : '';
must(!!guestCollection, '손님이 읽는 재고 컬렉션 이름', guestCollection
  ? `\`${guestCollection}\` — 심(${SHIM}) 의 매핑표에서 읽었다`
  : `매핑표에 products 줄이 없습니다 — 재고를 어디서 읽는지 모르면 이 검사는 무의미합니다`);

/* ── ① 손님이 «캐시»를 실제로 쓰나 ─────────────────────────────────────
   쓰지 않는다면 채우는 일 자체가 헛일이다. 먼저 그것부터 확인한다. */
const guest = code(GUEST);
must(guest.includes('photo_cache') && /out\.image_urls\s*=/.test(guest), '손님 정제기가 캐시를 사진으로 내보낸다',
  `${GUEST} 가 \`photo_cache\` 를 읽어 \`image_urls\` 로 내보낸다`);

/* ── ② 채우는 쪽이 «두 원장»에 다 쓰나 ───────────────────────────────── */
const filler = code(FILLER);
const writesRtdb = /db\.ref\('v4\/products'\)\.update\(/.test(filler);
must(writesRtdb, '채우는 쪽이 RTDB 에 쓴다',
  writesRtdb ? `\`db.ref('v4/products').update(…)\``
    : `${FILLER} 에서 RTDB 쓰기가 사라졌습니다. 플립 전까지는 양쪽에 써야 합니다 —\n      한쪽만 쓰면 문을 옮기는 날 사진이 통째로 사라집니다.`);

const fsWrite = new RegExp(`collection\\('${guestCollection || 'products'}'\\)\\.doc\\(`).test(filler);
must(fsWrite, '채우는 쪽이 «손님이 읽는» 컬렉션에 쓴다',
  fsWrite ? `\`collection('${guestCollection}').doc(…)\` — 손님이 읽는 그 문이다`
    : `${FILLER} 가 파이어스토어 \`${guestCollection}\` 에 안 씁니다.\n      → 손님 화면에는 «없는 사진»이 됩니다(2026-09-10 실측 218대가 그랬다).`);

const fsMerge = /\{\s*merge:\s*true\s*\}/.test(filler);
must(fsMerge, '파이어스토어 쓰기가 «덮어쓰기»가 아니다',
  fsMerge ? '`{ merge: true }` — 사진칸만 얹고 나머지 재고 필드는 그대로 둔다'
    : `${FILLER} 의 파이어스토어 쓰기에 \`{ merge: true }\` 가 없습니다.\n      → 문서를 통째로 갈아치우면 재고 필드가 사라집니다.`);

/* ── ②′ 미러가 «푼 사진»도 나르나 ───────────────────────────────────────
 * ⚠⚠ 2026-09-10, 이 검사를 «되돌려» 시험해 보다가 찾은 구멍이다.
 *   옛 판을 얹었더니 ①②③ 은 잡았는데 **미러의 `CARRY` 에서 `photo_cache` 가 빠진 것은 그냥 넘겼다.**
 *   그 한 칸이 빠지면 RTDB 에 아무리 채워도 손님 원장에는 안 간다 — 원래 사고가 바로 그것이었다.
 *   (사진**링크**는 나르는데 **푼 사진**은 안 날랐다.)
 * ⇒ 매시간 도는 미러가 그 칸을 나르는지도 센다. **채우는 문이 둘이면 검사도 둘이어야 한다.**
 */
const mirror = code(MIRROR);
const carry = /const CARRY\s*=\s*\[([^\]]*)\]/.exec(mirror);
if (!carry) {
  fail('미러의 나르는 칸 목록을 읽었다', `${MIRROR} 에서 「const CARRY = [...]」 를 못 찾았습니다 — 이름이 바뀌었으면 이 검사도 고칩니다`);
} else {
  const carries = carry[1].includes(`'photo_cache'`);
  must(carries, '미러가 «푼 사진»도 나른다',
    carries ? `${MIRROR} 의 \`CARRY\` 에 \`photo_cache\` 가 있다`
      : `${MIRROR} 의 \`CARRY\` 에 \`photo_cache\` 가 없습니다(\`photo_link\` 만 나릅니다).\n      → RTDB 에 아무리 채워도 손님 원장에는 안 갑니다. 원래 사고가 그것이었습니다.`);
}

/* ── ③ 사진을 «두 갈래»로 모으는 곳은 합치는 자가 하나인가 ────────────────
   저장본은 `sz=w640`, 그 자리에서 푼 것은 `sz=w1280` 이라 글자로 견주면 한 장이 두 장이 된다.
   운영 실측(109호3438) — 실제 51장인데 화면이 「1 / 91」 이었다. */
/*
 * ⚠ **«들여온 것»과 «쓰는 것»은 다르다.** 처음엔 파일에 이름이 있기만 하면 통과시켰는데,
 *   합치는 줄을 글자비교로 되돌려도 `import` 줄이 남아 **그냥 통과**했다(대조군에서 잡았다).
 *   ⇒ import 줄을 걷고 «부르는» 자리를 센다.
 */
const merge = code(MERGE).split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n');
const usesKey = /photoDedupKey\s*\(/.test(merge);
must(usesKey, '사진을 합칠 때 «같은 자»를 쓴다',
  usesKey ? `${MERGE} 가 \`photoDedupKey\` 로 합친다`
    : `${MERGE} 가 사진 두 갈래를 글자 그대로 견줍니다.\n      → 같은 드라이브 파일이 \`sz=\` 만 달라 두 장으로 세어집니다(「1 / 91」 사고).`);

console.log('');
console.log(bad ? `✗ 어긋난 것 ${bad}건 — 채운 사진이 손님한테 안 갑니다.\n`
                : '✓ 사진을 채우는 문과 손님이 읽는 문이 같습니다.\n');
process.exit(bad ? 1 : 0);
