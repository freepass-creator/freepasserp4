'use client';
import { useEffect, useState } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { productPhotos, scrapableSources, resolveServerPhotos } from '@/lib/domain/product-photos';

// 상품 사진 = 직접 이미지(image_urls 등) 즉시 + 드라이브 폴더(photo_link)는 서버해석 async 로 뒤이어 채움.
//  v3 동일 방식(image_urls 우선, 없으면 /api/extract-photos 스크래핑). 카드·상세 공용.
export function useProductPhotos(p: EntityRecord, size = 1280): string[] {
  const immediate = productPhotos(p);
  const [extra, setExtra] = useState<string[]>([]);
  const code = String(p?.product_code ?? p?._key ?? '');
  const link = String(p?.photo_link ?? '');
  useEffect(() => {
    let alive = true;
    setExtra([]);
    // 사진링크(드라이브폴더·모던렌트카·오플) 있으면 서버해석 — 직접사진과 "같이" 보이게(사용자 지시).
    if (scrapableSources(p).length) resolveServerPhotos(p, size).then((urls) => { if (alive) setExtra(urls); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, link, size]);
  // 직접 업로드 + 링크해석 합쳐서 표시(dedup).
  const seen = new Set<string>();
  return [...immediate, ...extra].filter((u) => { if (seen.has(u)) return false; seen.add(u); return true; });
}

export function useFirstPhoto(p: EntityRecord, size = 480): string {
  const photos = useProductPhotos(p, size);
  return photos[0] || '';
}
