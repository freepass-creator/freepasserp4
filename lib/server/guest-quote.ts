import 'server-only';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseAdminApp } from '@/lib/server/firebase-admin';
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
 * @param segment `/q/{여기}` 한 조각. 새 형식 `{토큰}-{담당자}` · 옛 형식 원본 키(하이픈 포함 가능).
 * @param shareFromQuery `?a=` 로 온 담당자 코드(옛 링크). 있으면 조각 안의 담당자보다 우선한다.
 *
 * ⚠ **통째로 먼저 찾고, 못 찾을 때만 하이픈에서 가른다.** 반대로 하면 `PD-260506-020` 같은
 *   하이픈 품은 상품키 599건(2026-08-22 실측)이 전부 «없는 상품»이 되어 이미 나간 링크가 죽는다.
 */
export async function loadGuestQuote(segment: string, shareFromQuery: string): Promise<GuestQuote | null> {
  const seg = S(segment);
  if (!seg) return null;

  /*
   * ★★**파이어스토어만 읽는다**(사장님 2026-09-05 「RTDB 안 쓴다니까? 파이어스토어만 갖고 와」).
   *   재고 `products` · 정책 `policy` · 사용자 `user`.
   * ⚠ 문서 id 는 «차번»이고 RTDB 키는 「공급사_차번」이었다 — 키는 `_key || product_code || id` 차례로 잡는다.
   *   `findProduct` 가 키 «또는» `product_code` 로 찾으므로 이미 나간 공유 링크가 그대로 열린다.
   */
  const fs = getFirestore(firebaseAdminApp());
  const snap = await fs.collection('products').get();
  const all: Record<string, Rec> = {};
  for (const d of snap.docs) {
    const v = d.data() as Rec;
    all[S(v._key) || S(v.product_code) || d.id] = v;
  }

  let share = S(shareFromQuery);
  let hit = findProduct(all, seg);
  if (!hit) {
    const split = splitShareSegment(seg);
    if (split.share) {
      hit = findProduct(all, split.code);
      if (hit && !share) share = split.share;
    }
  }
  if (!hit) return null;
  const { key, product } = hit;
  if (!product || dead(product)) return null;

  const merged = { ...product, _key: key, product_code: S((product as Rec).product_code) || key } as EntityRecord;
  // 판매 가능 여부는 서버가 판정한다 — 만료·출고불가 매물이 링크로 계속 열리면 안 된다.
  if (!isOfferableProduct(merged)) return null;

  /**
   * 정책은 v3 ∪ v4 를 함께 본다.
   * erp3 절연은 **재고(products)에만** 적용된다 — 회원·정책·계약 이력은 승계한다.
   * 실측 2026-08-08: 정책 54건 중 v3 53 · v4 26 — v4 만 읽으면 대부분 매물이 보험·연령·심사를 잃는다.
   */
  const policyCode = S((product as Rec).policy_code);
  let policy: Rec | null = null;
  if (policyCode) {
    /* 코드로 바로 찾고, 없으면 문서 id 가 곧 코드인 경우를 본다(`FP-RP004-RENT` 꼴). */
    const byCode = await fs.collection('policy').where('policy_code', '==', policyCode).limit(1).get();
    if (!byCode.empty) policy = byCode.docs[0].data() as Rec;
    else {
      const byId = await fs.collection('policy').doc(policyCode).get();
      if (byId.exists) policy = byId.data() as Rec;
    }
  }

  let agent: Rec | null = null;
  const shares = codeCandidates(share, 'usr');
  if (shares.length) {
    const userSnap = await fs.collection('user').get();
    const rows = userSnap.docs.map((d) => {
      const v = d.data() as Rec;
      return { ...v, _key: S(v._key) || d.id, uid: S(v.uid) || d.id };
    }) as EntityRecord[];
    for (const s of shares) {
      const found = matchAgentByShareCode(rows, s) as Rec | null;
      if (found) { agent = sanitizeAgentForGuest(found); break; }
    }
  }

  return { product: sanitizeProductForGuest(key, product as Rec, policy), agent };
}
