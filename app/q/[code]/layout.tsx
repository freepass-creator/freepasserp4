import type { Metadata } from 'next';
import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import { cheapestRent, isOfferableProduct, vehicleName } from '@/lib/domain/product';
import type { EntityRecord } from '@/lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

/**
 * 공유 링크 미리보기(OG) — 카톡·문자에 붙였을 때 차 사진과 차량명이 뜨게 한다.
 *
 * `/q` 페이지는 클라이언트 컴포넌트라 `generateMetadata` 를 export 할 수 없다. 그래서 이
 * 서버 레이아웃이 대신 맡는다. erp3 는 정적 HTML 의 og 태그를 서버리스 함수가 치환했지만
 * (`api/catalog-share.js`) Next 에서는 이 방식이 정석이다.
 *
 * 크롤러는 로그인하지 않으므로 데이터는 서비스계정으로 읽는다. 제목·가격 외에는 내보내지 않는다.
 */
/**
 * 상품 안내 링크는 **뿌리는 것**이지 **찾아지는 것**이 아니다.
 *
 * 담당자가 손님에게 보내는 링크다. 검색에 걸리면 그 손님에게 제시한 차·금액이 아무나
 * 검색해 볼 수 있는 것이 된다. noindex 는 검색 색인만 막고 **카톡·문자 미리보기(OG)는
 * 그대로 뜬다** — 위 openGraph 설정과 충돌하지 않는다.
 */
const NO_INDEX = { index: false, follow: false } as const;

async function loadProduct(code: string): Promise<EntityRecord | null> {
  try {
    const db = firebaseAdminDatabase();
    // 상품키는 `product_code` 이거나 RTDB child 키다 — 먼저 키로 찔러 보고 없으면 훑는다.
    const direct = await db.ref(`v4/products/${encodeURIComponent(code).replace(/\./g, '%2E')}`).get().catch(() => null);
    let key = code;
    let product: Rec | null = direct?.val() || null;
    if (!product) {
      const all = (await db.ref('v4/products').get()).val() || {};
      const hit = Object.entries(all as Record<string, Rec>)
        .find(([k, p]) => k === code || S(p?.product_code) === code);
      if (!hit) return null;
      [key, product] = hit;
    }
    if (!product || dead(product)) return null;
    const merged = { ...product, _key: key, product_code: S(product.product_code) || key } as EntityRecord;
    return isOfferableProduct(merged) ? merged : null;
  } catch {
    return null;
  }
}

/** 대표 사진 — `photo_link` 는 이미지가 아니라 폴더·상세페이지 링크라 extract-photos 로 푼다. */
async function firstImage(origin: string, link: string): Promise<string> {
  if (!link || !origin) return '';
  try {
    const res = await fetch(`${origin}/api/extract-photos?url=${encodeURIComponent(link)}&size=1200`, {
      signal: AbortSignal.timeout(6000),
    });
    const body = await res.json() as { ok?: boolean; urls?: string[] };
    return body.ok && body.urls?.length ? body.urls[0] : '';
  } catch {
    return '';
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ code: string }> },
): Promise<Metadata> {
  const { code } = await params;
  const key = decodeURIComponent(String(code));
  const product = await loadProduct(key);
  if (!product) return { title: '렌터카 상품 안내', robots: NO_INDEX };

  const name = vehicleName(product) || S((product as Rec).car_number);
  const rent = cheapestRent(product);
  const parts = [
    S((product as Rec).year) && `${S((product as Rec).year)}년식`,
    S((product as Rec).fuel_type),
    rent > 0 && `월 ${rent.toLocaleString('ko-KR')}원~`,
  ].filter(Boolean) as string[];

  const origin = S(process.env.INVENTORY_EXPORT_ORIGIN);
  const image = await firstImage(origin, S((product as Rec).photo_link));

  return {
    title: `${name} · 상품 안내`,
    description: parts.join(' · ') || '장기렌터카 상품 안내',
    robots: NO_INDEX,
    openGraph: {
      title: `${name} · 상품 안내`,
      description: parts.join(' · ') || '장기렌터카 상품 안내',
      type: 'website',
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

export default function QuoteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
