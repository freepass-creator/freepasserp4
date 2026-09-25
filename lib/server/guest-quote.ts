import { cache } from 'react';
import 'server-only';
import { channelSellsProduct } from '@/lib/whitelabel';
import { readFreepassCatalog } from '@/lib/server/freepass-catalog';
import { sanitizeAgentForGuest, sanitizeProductForGuest } from '@/lib/domain/public-catalog';
import { isOfferableProduct } from '@/lib/domain/product';
import { codeCandidates, matchAgentByShareCode, shareToken, splitShareSegment } from '@/lib/domain/product-share';
import type { EntityRecord } from '@/lib/intake/entities';

/**
 * 손님 공개 **상품 안내** 조회 — `/api/catalog/quote`(브라우저 fetch)와 `/q/{code}` 의
 * `generateMetadata`(카톡 미리보기용 서버 렌더)가 **같은 함수**를 쓴다.
 *
 * 예전엔 이 로직이 라우트 안에만 있어서, 링크 미리보기를 만들려면 서버가 자기 API 를 HTTP 로
 * 다시 부르거나 로직을 복붙해야 했다 — 둘 다 값이 갈릴 길을 하나 더 만든다.
 *
 * 브라우저에 RTDB 권한을 주지 않는다: 서버가 서비스계정으로 읽고 화이트리스트만 통과시킨다.
 */
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

export type GuestQuote = { product: EntityRecord; agent: Rec | null };
const readGuestCatalog = cache(readFreepassCatalog);

/** 한 조각으로 상품 찾기 — RTDB 키 · product_code · 짧은 토큰(shareToken) 순. */
function findProduct(all: Record<string, Rec>, raw: string): { key: string; product: Rec } | null {
  const codes = codeCandidates(raw, 'veh');
  if (!codes.length) return null;
  for (const [k, p] of Object.entries(all)) {
    if (codes.includes(k) || codes.includes(S(p?.product_code))) return { key: k, product: p };
  }
  // 토큰은 «키에서 계산한 값»이라 역으로 못 푼다 — 같은 계산을 전 상품에 돌려 맞춘다(상품은 이미 다 읽어 뒀다).
  const token = codes[0];
  if (/^[2-9a-z]{10}$/.test(token)) {
    for (const [k, p] of Object.entries(all)) {
      if (shareToken(S(p?.product_code) || k) === token || shareToken(k) === token) return { key: k, product: p };
    }
  }
  return null;
}

/**
 * **`/q/{조각}` → 원자 한 대.** 손님 화면도, 영업자 전용 칸도 «이 한 함수»로 찾는다.
 *
 * ★★찾는 규칙을 두 벌 두지 않는다. 조각은 세 가지로 올 수 있다 — RTDB 키 · `product_code` ·
 *   짧은 토큰(`shareToken`) — 게다가 `{토큰}-{담당자}` 로 붙어 오기도 한다.
 *   같은 링크가 화면마다 다르게 풀리면 「손님은 열리는데 영업자 칸만 없다」가 된다.
 * ⚠ **통째로 먼저 찾고, 못 찾을 때만 하이픈에서 가른다** — 반대로 하면 `PD-260506-020` 같은
 *   하이픈 품은 상품키 599건(2026-08-22 실측)이 전부 «없는 상품»이 되어 이미 나간 링크가 죽는다.
 * ★공개 상세도 목록과 같은 `FreePass Catalog Consumer Boundary`를 읽는다.
 *   현재 구현은 검증된 ERP5 reader에 위임하지만 저장소 세대 전환은 이 파일이 아니라 consumer boundary 한 곳에서만 한다.
 */
export async function resolveProduct(segment: string): Promise<{ key: string; product: Rec; share: string } | null> {
  const seg = S(segment);
  if (!seg) return null;
  /* ★재고는 «공용 캐시»에서 받는다(`guest-source`) — 목록·상세·미리보기가 같은 것을 본다. */
  const src = await readGuestCatalog();
  const all: Record<string, Rec> = {};
  for (const [docKey, v] of Object.entries(src.products)) {
    if (v && typeof v === 'object') all[S(v._key) || S(v.product_code) || docKey] = v;
  }
  const hit = findProduct(all, seg);
  if (hit) return { ...hit, share: '' };
  const split = splitShareSegment(seg);
  if (!split.share) return null;
  const second = findProduct(all, split.code);
  return second ? { ...second, share: split.share } : null;
}

/**
 * @param segment `/q/{여기}` 한 조각. 새 형식 `{토큰}-{담당자}` · 옛 형식 원본 키(하이픈 포함 가능).
 * @param shareFromQuery `?a=` 로 온 담당자 코드(옛 링크). 있으면 조각 안의 담당자보다 우선한다.
 *
 * ⚠ **통째로 먼저 찾고, 못 찾을 때만 하이픈에서 가른다.** 반대로 하면 `PD-260506-020` 같은
 *   하이픈 품은 상품키 599건(2026-08-22 실측)이 전부 «없는 상품»이 되어 이미 나간 링크가 죽는다.
 */
/**
 * ★★**한 요청 안에서는 «한 번만» 읽는다**(2026-09-07 — 상세가 느린 이유).
 *
 * 실측 — `v4/products` 통째 읽기가 **776ms**(첫 회)·400ms(이후)다. 한 대를 보여주려고
 * 1,375대를 통째로 읽는데, 그걸 **한 화면에 두 번** 하고 있었다:
 *   ㉠ `generateMetadata`(제목·og) ㉡ 브라우저가 다시 부르는 `/api/catalog/quote`
 * ⇒ `cache()` 로 감싸면 ㉠·㉡ 이 «같은 요청»일 때 한 번만 읽는다.
 * ⇒ 그리고 ㉡ 자체를 없앤다 — 서버가 이미 읽은 것을 화면에 «넘겨준다»(`app/q/[code]/page.tsx`).
 * ⚠ 캐시는 «요청 하나» 안에서만 산다. 다음 손님은 새로 읽는다 — 재고가 굳지 않는다.
 */
export const loadGuestQuote = cache(loadGuestQuoteUncached);

async function loadGuestQuoteUncached(segment: string, shareFromQuery: string, onlyProvider = ''): Promise<GuestQuote | null> {
  const seg = S(segment);
  if (!seg) return null;

  /*
   * 공개 상세는 목록과 같은 FreePass Catalog Consumer Boundary를 쓴다.
   * 현재 저장소 구현 세대와 관계없이 `findProduct`는 키 또는 `product_code`로 기존 공유 링크를 유지한다.
   */
  let share = S(shareFromQuery);
  const hit = await resolveProduct(seg);
  if (!hit) return null;
  if (hit.share && !share) share = hit.share;
  const src = await readGuestCatalog({ includeUsers: true });
  const { key, product } = hit;
  if (!product || dead(product)) return null;
  /*
   * ★★**공급사 전용 채널의 울타리는 «여기»다 — 정제 «전».**
   *
   * ⚠⚠ 처음엔 부르는 쪽(페이지·API)에서 `channelSellsProduct(found.product)` 로 막았다.
   *   **하나도 안 막혔다** — 이 함수가 돌려주는 것은 이미 `sanitizeProductForGuest` 를 지난
   *   값이라 공급사 칸(`provider_company_code`·`partner_code`)이 **지워져 있다.**
   *   그래서 남의 차는 그대로 열리고 **이안카 «자기 차»가 404** 가 났다(2026-09-10 실측으로 잡았다).
   * ⇒ 원본이 손에 있는 이 자리에서 판정한다. 규칙 자체는 표 한 곳(`channelSellsProduct`)이 갖는다.
   * ★코드가 없는 채널은 `onlyProvider` 가 비어 늘 통과한다 — 영업채널은 재고 전체를 판다.
   */
  if (onlyProvider && !channelSellsProduct({ providerCode: onlyProvider } as never, product)) return null;

  const merged = { ...product, _key: key, product_code: S((product as Rec).product_code) || key } as EntityRecord;
  // 판매 가능 여부는 서버가 판정한다 — 만료·출고불가 매물이 링크로 계속 열리면 안 된다.
  if (!isOfferableProduct(merged)) return null;

  /**
   * 정책은 목록과 같은 Firestore `policy` 원장을 본다.
   */
  const policyCode = S((product as Rec).policy_code);
  let policy: Rec | null = null;
  if (policyCode) {
    policy = Object.entries(src.policies).map(([policyKey, value]) => ({ ...(value || {}), _key: policyKey } as Rec))
      .find((value) => S(value.policy_code) === policyCode || S(value._key) === policyCode) || null;
  }

  let agent: Rec | null = null;
  const shares = codeCandidates(share, 'usr');
  if (shares.length) {
    const rows = Object.entries(src.users)
      .map(([id, value]) => ({ ...(value || {}), _key: S(value?._key) || id, uid: S(value?.uid) || id })) as EntityRecord[];
    for (const s of shares) {
      const found = matchAgentByShareCode(rows, s) as Rec | null;
      if (found) { agent = sanitizeAgentForGuest(found); break; }
    }
  }

  return { product: sanitizeProductForGuest(key, product as Rec, policy), agent };
}
