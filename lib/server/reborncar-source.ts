const BASE = 'https://www.reborncar.co.kr';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const S = (value: unknown) => String(value ?? '').trim();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type RebornCarSourceRow = {
  sourceUrl: string;
  externalId: string;
  raw: Record<string, unknown>;
  car: string;
  status: string;
  kind: string;
  maker: string;
  model: string;
  vname: string;
  trim: string;
  fuel: string;
  ext: string;
  int: string;
  km: string;
  opt: string;
  firstReg: string;
  cc: string;
  klass: string;
  price: Record<string, { rent: number; deposit: number }>;
};

async function bootstrap(pageUrl: string): Promise<{ cookie: string; token: string; csrf: string }> {
  const response = await fetch(pageUrl, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`Reborn 상세 HTML ${response.status}: ${pageUrl}`);
  const cookie = ((response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || [])
    .map((item) => item.split(';')[0]).join('; ');
  const html = await response.text();
  const token = html.match(/RB_TOKEN\s*=\s*"([^"]+)"/)?.[1] || '';
  const csrf = html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';
  if (!token || !csrf) throw new Error(`Reborn 인증 문맥 누락: ${pageUrl}`);
  return { cookie, token, csrf };
}

async function enumerate(): Promise<Array<{ productId: string; url: string }>> {
  const response = await fetch(`${BASE}/sitemap-ext.xml`, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`Reborn sitemap ${response.status}`);
  const xml = await response.text();
  const urls = [...new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]))];
  return urls
    .filter((url) => /\/rent\/[A-Z]{2}\d+\/C\d{11}/.test(url))
    .map((url) => ({ productId: url.match(/C\d{11}/)?.[0] || '', url }))
    .filter((item) => item.productId);
}

function caller(context: { cookie: string; token: string; csrf: string }) {
  return async (endpoint: string, productId: string, referer: string): Promise<Record<string, unknown>> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(`${BASE}/api/v1/car/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Ajax-call': 'true', Authorization: context.token, 'X-CSRF-TOKEN': context.csrf,
          Cookie: context.cookie, 'User-Agent': UA, Referer: referer,
        },
        body: `productId=${encodeURIComponent(productId)}`,
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      const header = body.header as Record<string, unknown> | undefined;
      if (String(header?.resultCode ?? '') === '1020' && typeof body.msg === 'string') {
        context.token = body.msg;
        await sleep(60);
        continue;
      }
      if (!response.ok) throw new Error(`Reborn ${endpoint} ${response.status}`);
      return body;
    }
    throw new Error(`Reborn ${endpoint} 재시도 초과: ${productId}`);
  };
}

function mapRow(detail: Record<string, unknown>, optionResponse: unknown, sourceUrl: string, productId: string): RebornCarSourceRow {
  const release = Number(detail.releaseDate);
  const firstReg = Number.isFinite(release) && release > 0 ? new Date(release).toISOString().slice(0, 10) : '';
  const price: RebornCarSourceRow['price'] = {};
  try {
    const terms = JSON.parse(S(detail.rentPriceObjs) || '[]') as Array<Record<string, number>>;
    for (const term of terms) {
      const months = Number(term.rentMonth);
      if (term.rentPrice2) price[`${months}_20000`] = { rent: Number(term.rentPrice2), deposit: 0 };
      if (term.rentPrice3) price[`${months}_30000`] = { rent: Number(term.rentPrice3), deposit: 0 };
    }
  } catch { /* 원문은 아래 raw에 보존하고 가격은 HOLD */ }

  // carOption.rb 응답은 모든 차량에서 같은 공통 카탈로그로 관측됐다.
  // 선택 여부가 입증되기 전에는 차량 옵션으로 승격하지 않고 raw에만 보존한다.
  return {
    sourceUrl, externalId: productId,
    raw: { detail, optionResponse },
    car: S(detail.carNumber), status: '출고가능', kind: '오플구독', maker: S(detail.bmname),
    model: S(detail.boname), vname: [S(detail.boname), S(detail.gradename)].filter(Boolean).join(' '),
    trim: S(detail.gradename), fuel: S(detail.carFuel), ext: S(detail.carColor), int: '',
    km: S(detail.carNavi), opt: '', firstReg, cc: S(detail.displace), klass: S(detail.shapeBgname), price,
  };
}

export async function rowsFromRebornCatalog(): Promise<{ rows: RebornCarSourceRow[]; listed: number; errors: string[] }> {
  const entries = await enumerate();
  const rows: RebornCarSourceRow[] = [];
  const errors: string[] = [];
  for (const entry of entries) {
    try {
      const context = await bootstrap(entry.url);
      const call = caller(context);
      const detailResponse = await call('getRentCarDetail.rb', entry.productId, entry.url);
      const detail = detailResponse.data as Record<string, unknown> | undefined;
      if (!detail) throw new Error('상세 data 없음');
      const optionResponse = await call('carOption.rb', entry.productId, entry.url);
      rows.push(mapRow(detail, optionResponse, entry.url, entry.productId));
    } catch (error) {
      errors.push(`${entry.productId}: ${(error as Error).message}`);
    }
    await sleep(150);
  }
  return { rows, listed: entries.length, errors };
}
