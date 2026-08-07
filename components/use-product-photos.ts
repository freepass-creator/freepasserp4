'use client';
import { useEffect, useState } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { productPhotos, scrapableSources, resolveServerPhotos } from '@/lib/domain/product-photos';

// 상품 사진 = 직접 이미지(image_urls 등) 즉시 + 드라이브 폴더(photo_link)는 서버해석 async 로 뒤이어 채움.
//  v3 동일 방식(image_urls 우선, 없으면 /api/extract-photos 스크래핑). 카드·상세 공용.
export function useProductPhotos(p: EntityRecord, size = 1280): string[] {
  return useProductPhotoState(p, size).photos;
}

/**
 * 사진 + **아직 해석 중인가**.
 *
 * 사진이 링크(드라이브 폴더·모던렌트카·오플)로 오는 매물은 서버가 풀어줄 때까지 목록이 비어 있다.
 * 그 사이를 «사진 없음»이라고 단정하면 **있는 사진을 없다고 말하는 것**이다(2026-08-07 실사용 지적).
 * 「없다」와 「아직 모른다」는 화면에서 달리 말해야 한다.
 */
export function useProductPhotoState(p: EntityRecord, size = 1280): { photos: string[]; pending: boolean } {
  const immediate = productPhotos(p);
  const [extra, setExtra] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);
  const code = String(p?.product_code ?? p?._key ?? '');
  const link = String(p?.photo_link ?? '');
  useEffect(() => {
    let alive = true;
    setExtra([]);
    // 사진링크(드라이브폴더·모던렌트카·오플) 있으면 서버해석 — 직접사진과 "같이" 보이게(사용자 지시).
    const scrapable = scrapableSources(p).length > 0;
    setResolving(scrapable);
    if (!scrapable) return () => { alive = false; };
    resolveServerPhotos(p, size)
      .then((urls) => { if (alive) setExtra(urls); })
      // 실패해도 «불러오는 중»에 영원히 갇히지 않게 반드시 내린다.
      .catch(() => { /* 링크해석 실패 = 직접사진만으로 간다 */ })
      .finally(() => { if (alive) setResolving(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, link, size]);
  // 직접 업로드 + 링크해석 합쳐서 표시(dedup).
  const seen = new Set<string>();
  const photos = [...immediate, ...extra].filter((u) => { if (seen.has(u)) return false; seen.add(u); return true; });
  return { photos, pending: resolving && photos.length === 0 };
}

// 목록·상세 첫장. 표시 크기는 카드/상세 프레임(CSS cover)이 담당 — 여기 size는 Drive 요청폭만.
export function useFirstPhoto(p: EntityRecord, size = 1280): string {
  const photos = useProductPhotos(p, size);
  return photos[0] || '';
}

// 공급사 링크(드라이브·모던렌트카·오플) 해석 사진만 — ERP 매물편집서 "읽기전용"으로 보여주기(복사 아님).
export function useResolvedLinkPhotos(p: EntityRecord, size = 1280): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  const code = String(p?.product_code ?? p?._key ?? '');
  const link = String(p?.photo_link ?? '');
  useEffect(() => {
    let alive = true;
    setUrls([]);
    if (scrapableSources(p).length) resolveServerPhotos(p, size).then((u) => { if (alive) setUrls(u); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, link, size]);
  return urls;
}
