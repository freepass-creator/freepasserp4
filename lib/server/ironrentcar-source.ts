import { load } from 'cheerio';
import { readFileSync } from 'node:fs';
import { snapToMaster, unpackVehicleSignals } from '@/lib/domain/vehicle-master-match';
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';
import type { EntityRecord } from '@/lib/intake/entities';

/**
 * 차종마스터 — 서버에서는 파일로 읽는다.
 * `vehicle-master-load` 는 브라우저용(`fetch('/data/...')`)이라 여기서는 못 쓴다.
 */
let masterCache: MasterEntry[] | null = null;
function masterEntries(): MasterEntry[] {
  if (masterCache) return masterCache;
  try {
    const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
    masterCache = (Array.isArray(raw) ? raw : raw.entries) || [];
  } catch {
    masterCache = [];      // 마스터를 못 읽으면 규격화만 건너뛴다 — 수집 자체를 막지는 않는다.
  }
  return masterCache;
}

export const IRONRENTCAR_BASE_URL = 'https://ironrentcar.com';
export const IRONRENTCAR_PROVIDER_CODE = 'RP006';

export type IronRentcarListing = {
  id: string;
  url: string;
  condition: 'new' | 'used';
  sold: boolean;
};

export type IronRentcarCatalogItem = {
  externalId: string;
  sourceUrl: string;
  condition: 'new' | 'used';
  sold: boolean;
  product: EntityRecord;
  /** ERP 공개 상품에 섞지 않는 관리자 전용 원자. */
  privateProduct: EntityRecord;
  /** 공용 정책 생성·연결 전 검토용 스냅샷. */
  policySnapshot: EntityRecord;
  fingerprint: string;
};

export type IronRentcarCatalog = {
  source: 'ironrentcar_web';
  providerCode: typeof IRONRENTCAR_PROVIDER_CODE;
  fetchedAt: number;
  complete: boolean;
  listings: number;
  active: number;
  sold: number;
  newCount: number;
  usedCount: number;
  items: IronRentcarCatalogItem[];
  errors: { id: string; message: string }[];
  revision: string;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const clean = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();

function absoluteUrl(value: string, baseUrl: string): string {
  return new URL(value, baseUrl).toString();
}

function originalImageUrl(value: string, baseUrl: string): string {
  if (!value) return '';
  const absolute = absoluteUrl(value, baseUrl);
  try {
    const url = new URL(absolute);
    if (url.pathname === '/_next/image') {
      const original = url.searchParams.get('url');
      return original ? absoluteUrl(original, baseUrl) : absolute;
    }
    return absolute;
  } catch {
    return '';
  }
}

function won(value: string): number {
  const text = clean(value).replace(/,/g, '');
  const man = text.match(/([\d.]+)\s*만원/);
  if (man) return Math.round(Number(man[1]) * 10_000);
  const plain = text.match(/([\d.]+)\s*원/);
  return plain ? Math.round(Number(plain[1])) : 0;
}

function yearOf(value: string): string {
  const match = clean(value).match(/(\d{2,4})\s*년식/);
  if (!match) return '';
  const number = Number(match[1]);
  return String(number < 100 ? 2000 + number : number);
}

function numberOf(value: string): number | undefined {
  const match = clean(value).replace(/,/g, '').match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function hash(value: unknown): string {
  const text = JSON.stringify(stable(value));
  let result = 2166136261;
  for (let index = 0; index < text.length; index++) {
    result ^= text.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function parseIronRentcarListingPage(
  html: string,
  pageUrl: string,
  condition: 'new' | 'used',
): { listings: IronRentcarListing[]; nextUrl: string | null } {
  const $ = load(html);
  const listings: IronRentcarListing[] = [];
  $('main article').each((_, element) => {
    const article = $(element);
    const href = article.find('a[href^="/vehicles/"]').attr('href') || '';
    const id = href.match(/\/vehicles\/([^?/#]+)/)?.[1] || '';
    if (!id) return;
    listings.push({
      id,
      url: absoluteUrl(href, pageUrl),
      condition,
      sold: article.hasClass('rental-product-card--sold'),
    });
  });
  let nextUrl: string | null = null;
  $('main a[href]').each((_, element) => {
    if (nextUrl || clean($(element).text()) !== '더보기') return;
    const href = $(element).attr('href');
    if (href) nextUrl = absoluteUrl(href, pageUrl);
  });
  return { listings, nextUrl };
}

export function parseIronRentcarDetail(
  html: string,
  listing: IronRentcarListing,
  providerCode = IRONRENTCAR_PROVIDER_CODE,
): IronRentcarCatalogItem {
  const $ = load(html);
  const title = clean($('main h1.product-detail-title').first().text());
  if (!title) throw new Error('차량 제목 없음');

  const facts = new Map<string, string>();
  $('main dt').each((_, element) => {
    const key = clean($(element).text());
    const value = clean($(element).next('dd').text());
    if (key && value && !facts.has(key)) facts.set(key, value);
  });

  const titleParts = title.split(/\s+/).filter(Boolean);
  const maker = titleParts[0] || '';
  const model = titleParts[1] || '';
  const trim = titleParts.slice(2).join(' ');
  const subtitle = clean($('.product-detail-subtitle').first().text());
  const variant = clean(subtitle.split('·')[0]);
  const year = yearOf(subtitle);
  const plate = clean(facts.get('차량번호')).replace(/\s/g, '');
  if (!/^\d{2,3}[가-힣]\d{4}$/.test(plate)) throw new Error(`차량번호 형식 오류: ${plate || '없음'}`);

  const deposit = won($('.product-detail-price-block--deposit').text());
  const price: Record<string, { rent: number; deposit: number }> = {};
  $('.product-detail-rent-row').each((_, element) => {
    const period = clean($(element).find('dt').text()).match(/\d+/)?.[0] || '';
    const rent = won($(element).find('dd').text());
    if (period && rent > 0) price[period] = { rent, deposit };
  });
  if (!Object.keys(price).length) throw new Error('기간별 대여료 없음');

  const badges = $('.product-detail-badges .badge-pill').map((_, element) => clean($(element).text())).get();
  const vehicleStatus = listing.sold || badges.includes('판매완료')
    ? '출고불가'
    : badges.includes('즉시출고') ? '즉시출고'
      : badges.includes('출고가능') ? '출고가능' : '출고협의';
  const options = $('.vehicle-option-chip').map((_, element) => clean($(element).text())).get().filter(Boolean);
  const images = [...new Set($('.product-detail-gallery img').map((_, element) =>
    originalImageUrl($(element).attr('src') || '', listing.url)).get().filter(Boolean))];
  const mileage = numberOf(facts.get('주행거리') || '');
  const sourceUrl = new URL(`/vehicles/${listing.id}?condition=${listing.condition}`, IRONRENTCAR_BASE_URL).toString();

  const product: EntityRecord = {
    _key: `${providerCode}_${plate}`,
    product_code: `${providerCode}_${plate}`,
    car_number: plate,
    maker,
    model,
    sub_model: model,
    variant,
    trim_name: trim,
    year,
    fuel_type: clean(facts.get('유종')),
    ...(mileage != null ? { mileage } : {}),
    ext_color: clean(facts.get('외장 색상')),
    int_color: clean(facts.get('내장 색상')),
    options: options.join(', '),
    vehicle_status: vehicleStatus,
    product_type: listing.condition === 'new' ? '신차렌트' : '중고렌트',
    provider_company_code: providerCode,
    provider_name: '아이언렌트카',
    price,
    image_urls: images,
    // 상세 HTML URL은 이미지가 아니다. 사진은 image_urls, 원본 추적은 source_url로 분리한다.
    photo_link: '',
    source: 'ironrentcar_web',
    source_schema: providerCode,
    source_external_id: listing.id,
    source_url: sourceUrl,
    _raw_vehicle: { title, subtitle, maker, model, trim_name: trim, variant, year },
  };

  /**
   * ★홈페이지 값을 **우리 원자로 규격화**한다 — 시트 유입과 같은 길(차종마스터 스냅)을 쓴다.
   *
   * 안 하면 `sub_model` 에 모델명이 그대로 복사돼 「아반떼」·「K5」 로 남는다. 그 값이 반영되면
   * 재고의 「더 뉴 아반떼 CN7」 이 「아반떼」 로 덮여 세대가 사라진다(실측 2026-08-08: 33대 대상).
   * 스냅이 세대를 못 찾으면 원본을 그대로 두어 «없던 정보를 지어내지» 않는다.
   */
  const entries = masterEntries();
  const snapped = entries.length ? snapToMaster(unpackVehicleSignals(product, entries), entries) : null;
  if (snapped) {
    product.maker = snapped.maker || product.maker;
    product.model = snapped.model || product.model;
    product.sub_model = snapped.sub_model || product.sub_model;
    if (snapped.gen_code) product.catalog_id = snapped.gen_code;
    product._snap_confidence = snapped.confidence;
  }

  const privateProduct: EntityRecord = {
    product_code: product.product_code,
    provider_company_code: providerCode,
    vehicle_price: won($('.product-detail-price-block--vehicle').text()),
  };
  const deductible = clean(facts.get('면책금'));
  const policySnapshot: EntityRecord = {
    policy_code: `${providerCode}_WEB`,
    policy_name: '아이언렌트카 웹 공개조건',
    provider_company_code: providerCode,
    basic_driver_age: clean(facts.get('운전자 연령')),
    injury_compensation_limit: clean(facts.get('대인 보상')),
    property_compensation_limit: clean(facts.get('대물 보상')),
    self_body_accident: clean(facts.get('자기신체사고')),
    annual_roadside_assistance: clean(facts.get('긴급출동')),
    own_damage_compensation: deductible,
    annual_mileage: clean($('.product-detail-rent-mileage-note').text()),
    deposit_installment: clean($('.product-detail-price-block--deposit').text()).replace(/^보증금\s*/, ''),
    insurance_included: '보험료 포함',
  };
  const fingerprint = hash({ product, privateProduct, policySnapshot });
  return { externalId: listing.id, sourceUrl, condition: listing.condition, sold: listing.sold, product, privateProduct, policySnapshot, fingerprint };
}

async function fetchHtml(fetchImpl: FetchLike, url: string): Promise<string> {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'FreepassERP/4 IronRentcar supplier sync' },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  if (!/<(?:!doctype|html)/i.test(html.slice(0, 300))) throw new Error('HTML 응답 아님');
  return html;
}

async function fetchListings(fetchImpl: FetchLike, condition: 'new' | 'used'): Promise<IronRentcarListing[]> {
  let pageUrl: string | null = `${IRONRENTCAR_BASE_URL}/vehicles?condition=${condition}`;
  const pages = new Set<string>();
  const found = new Map<string, IronRentcarListing>();
  while (pageUrl && pages.size < 10) {
    if (pages.has(pageUrl)) throw new Error(`${condition} 목록 페이지 순환`);
    pages.add(pageUrl);
    const parsed = parseIronRentcarListingPage(await fetchHtml(fetchImpl, pageUrl), pageUrl, condition);
    for (const listing of parsed.listings) found.set(listing.id, listing);
    pageUrl = parsed.nextUrl;
  }
  if (pageUrl) throw new Error(`${condition} 목록 10페이지 초과`);
  if (!found.size) throw new Error(`${condition} 목록 비어 있음`);
  return [...found.values()];
}

async function mapLimit<T, R>(values: T[], limit: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      output[index] = await worker(values[index]);
    }
  });
  await Promise.all(runners);
  return output;
}

let cached: { expiresAt: number; catalog: IronRentcarCatalog } | null = null;

export async function fetchIronRentcarCatalog(options: {
  fetchImpl?: FetchLike;
  concurrency?: number;
  cacheMs?: number;
} = {}): Promise<IronRentcarCatalog> {
  const now = Date.now();
  const cacheMs = Math.max(0, options.cacheMs ?? 300_000);
  if (!options.fetchImpl && cached && cached.expiresAt > now) return cached.catalog;
  const fetchImpl = options.fetchImpl || fetch;
  const listings = [...await fetchListings(fetchImpl, 'new'), ...await fetchListings(fetchImpl, 'used')];
  const unique = [...new Map(listings.map((listing) => [listing.id, listing])).values()];
  const errors: { id: string; message: string }[] = [];
  const parsed = await mapLimit(unique, Math.max(1, Math.min(options.concurrency ?? 4, 8)), async (listing) => {
    try {
      return parseIronRentcarDetail(await fetchHtml(fetchImpl, listing.url), listing);
    } catch (error) {
      errors.push({ id: listing.id, message: String((error as Error)?.message || error) });
      return null;
    }
  });
  const items = parsed.filter((item): item is IronRentcarCatalogItem => item != null)
    .sort((a, b) => a.externalId.localeCompare(b.externalId));
  const catalog: IronRentcarCatalog = {
    source: 'ironrentcar_web',
    providerCode: IRONRENTCAR_PROVIDER_CODE,
    fetchedAt: now,
    complete: errors.length === 0 && items.length === unique.length,
    listings: unique.length,
    active: items.filter((item) => !item.sold).length,
    sold: items.filter((item) => item.sold).length,
    newCount: items.filter((item) => item.condition === 'new').length,
    usedCount: items.filter((item) => item.condition === 'used').length,
    items,
    errors,
    revision: hash(items.map((item) => [item.externalId, item.fingerprint])),
  };
  if (!options.fetchImpl && catalog.complete && cacheMs > 0) cached = { expiresAt: now + cacheMs, catalog };
  return catalog;
}
