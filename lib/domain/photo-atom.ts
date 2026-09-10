import { createHash } from 'node:crypto';

const S = (value: unknown): string => String(value ?? '').trim();

/** 원천이 준 순서를 유지하며 실제 HTTP 사진 주소 전체를 중복 없이 원자화한다. */
export function normalizePhotoUrls(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of source) {
    const url = S(item);
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

/** ERP가 쓰는 사진 배열과 그 배열을 다시 검증할 메타데이터. 파일 복사나 장수 제한은 하지 않는다. */
export function photoAtomFields(value: unknown, collectedAt?: unknown): Record<string, unknown> {
  const image_urls = normalizePhotoUrls(value);
  if (!image_urls.length) return {};
  const photo_source_hash = createHash('sha256').update(JSON.stringify(image_urls)).digest('hex');
  const at = Number(collectedAt);
  return {
    image_urls,
    photo_source_hash,
    ...(Number.isFinite(at) && at > 0 ? { photo_collected_at: at } : null),
  };
}

/** 원천 사진이 비어 온 회차에는 이전 원문 증거를 지우지 않는다. */
export function mergeRawPhotoEvidence(current: unknown, value: unknown): Record<string, unknown> {
  const merged = current && typeof current === 'object' && !Array.isArray(current)
    ? { ...(current as Record<string, unknown>) }
    : {};
  if (Array.isArray(value) && value.length) merged.사진 = value;
  return merged;
}
