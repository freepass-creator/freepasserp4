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
    if (!immediate.length && scrapableSources(p).length) {
      resolveServerPhotos(p, size).then((urls) => { if (alive) setExtra(urls); });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, link, size]);
  return immediate.length ? immediate : extra;
}

export function useFirstPhoto(p: EntityRecord, size = 480): string {
  const photos = useProductPhotos(p, size);
  return photos[0] || '';
}
