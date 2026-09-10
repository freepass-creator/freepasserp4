/** 차량 사진 원천은 보존하고, ERP 사진과 Google Sheet 링크를 서로 다른 출력으로 만든다. */
import { isScrapableHost } from './scrape-photos';

type PhotoAtom = Record<string, unknown>;

const S = (value: unknown): string => String(value ?? '').trim();
export const firstPhotoLink = (value: unknown): string => S(value).split(/\s*[\n,]\s*/)[0]?.trim() || '';

export function isPickupPhotoAtom(atom: PhotoAtom): boolean {
  return S(atom.provider_company_code) === 'RP012' && S(atom.product_type) === '픽업구독';
}

/** ERP 사진 해석기에 넘길 원천. 업무용 상세페이지 `tica_link`는 포함하지 않는다. */
export function erpPhotoSource(atom: PhotoAtom): string {
  return S(atom.photo_link);
}

/** 시트 차량번호 셀의 이동 대상: 픽업은 T카, 그 밖은 검증된 사진 링크다. */
export function sheetPlateLink(atom: PhotoAtom): string {
  return firstPhotoLink(isPickupPhotoAtom(atom) ? atom.tica_link : atom.photo_link);
}

const hostOf = (value: string): string => {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.hostname.replace(/^www\./, '').toLowerCase() : '';
  } catch { return ''; }
};
const isTicaHost = (host: string): boolean => /(^|\.)lotterentacar\.net$/.test(host);
const IMAGE_FILE_RE = /\.(jpe?g|png|webp|gif|avif|bmp)(\?|$)/i;

export function isServerPhotoSource(value: unknown): boolean {
  const raw = S(value);
  if (IMAGE_FILE_RE.test(raw)) return false;
  if (isScrapableHost(raw)) return true;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'drive.google.com') return /\/drive\/(?:u\/\d+\/)?folders\//.test(url.pathname);
    // 단축 URL은 최종 목적지가 사진 원천인지 여기서 증명할 수 없다.
    // 공급사 수집 단계에서 펼쳐 확정 URL로 원자화한 경우에만 통과시킨다.
    return false;
  } catch { return false; }
}

export function isDirectPhotoUrl(value: unknown): boolean {
  const raw = S(value);
  if (/^data:image\//i.test(raw) || /^blob:/i.test(raw) || /^\/api\/img(?:\?|$)/i.test(raw)) return true;
  if (/^\//.test(raw) && IMAGE_FILE_RE.test(raw)) return true;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return false;
    return IMAGE_FILE_RE.test(raw);
  } catch { return false; }
}

function collectPhotoValues(value: unknown): string[] {
  const out: string[] = [];
  const add = (item: unknown) => {
    if (item == null) return;
    if (Array.isArray(item)) { item.forEach(add); return; }
    if (typeof item === 'object') { Object.values(item).forEach(add); return; }
    const raw = S(item);
    if (!raw) return;
    if (raw.startsWith('[') || raw.startsWith('{')) {
      try { add(JSON.parse(raw)); return; } catch { /* 일반 문자열로 검사 */ }
    }
    out.push(raw);
  };
  add(value);
  return out;
}
export function photoProjectionViolations(atom: PhotoAtom): string[] {
  const problems: string[] = [];
  const link = sheetPlateLink(atom);
  const host = hostOf(link);
  if (isPickupPhotoAtom(atom)) {
    if (!link) problems.push('픽업구독 T카 링크 누락');
    else if (!isTicaHost(host)) problems.push('픽업구독 시트 링크가 T카가 아님');
  } else if (link && !host) {
    problems.push('일반 재고 시트 링크 형식 오류');
  }
  for (const source of S(atom.photo_link).split(/\s*[\n,]\s*/).filter(Boolean)) {
    if (!isDirectPhotoUrl(source) && !isServerPhotoSource(source)) problems.push('ERP에서 사진으로 해석할 수 없는 원천');
  }
  for (const source of collectPhotoValues([atom.image_urls, atom.images, atom.photos, atom.photo, atom.image_url, atom.doc_images])) {
    if (!isDirectPhotoUrl(source)) problems.push('ERP 직접 사진 필드가 이미지 주소가 아님');
  }
  return [...new Set(problems)];
}
