/**
 * 엔카 매물 전수 수집 → 분류 튜플만 쌓는다.
 * 설계: docs/PLAN-ENCAR-LEARN-2026-08-09.md
 *
 *   npx tsx scripts/encar-crawl.mts              # 이어서(재개)
 *   npx tsx scripts/encar-crawl.mts --fresh      # 처음부터
 *   npx tsx scripts/encar-crawl.mts --limit=500  # 시험(건수 상한, 매물 기준)
 *
 * 산출: tmp/encar/raw/raw-<offset>.json · tmp/encar/catalog.json · tmp/encar/crawl-state.json
 * Id·가격·사진·판매점은 저장하지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'tmp/encar';
const RAW_DIR = join(DIR, 'raw');
const STATE_PATH = join(DIR, 'crawl-state.json');
const CATALOG_PATH = join(DIR, 'catalog.json');
const PAGE = 100;
const GAP_MS = 1100;
const UA = 'Mozilla/5.0 (compatible; freepass-erp-research/1.0; +local-dev)';
const BASE = 'https://api.encar.com/search/car/list/general';
const Q = '(And.Hidden.N._.CarType.A.)';

type Tuple = {
  maker: string;
  sub_model: string;
  badge: string;
  badge_detail: string;
  fuel: string;
  green: string;
  year_min: number;
  year_max: number;
  n: number;
};

type State = {
  nextOffset: number;
  total: number | null;
  failed: number[];
  pages: number;
  updated_at: string;
};

const S = (v: unknown) => String(v ?? '').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const fresh = args.includes('--fresh');
const limitArg = args.find((a) => a.startsWith('--limit='));
const hardLimit = limitArg ? Number(limitArg.split('=')[1]) || 0 : 0;

mkdirSync(RAW_DIR, { recursive: true });

function yearOf(raw: unknown): number {
  const n = Number(raw) || 0;
  if (!n) return 0;
  // 201606 → 2016
  if (n >= 190001 && n <= 210012) return Math.floor(n / 100);
  if (n >= 1900 && n <= 2100) return n;
  return 0;
}

function tupleKey(t: Omit<Tuple, 'year_min' | 'year_max' | 'n'>): string {
  return [t.maker, t.sub_model, t.badge, t.badge_detail, t.fuel, t.green].join('\u0001');
}

function loadCatalog(): Map<string, Tuple> {
  const map = new Map<string, Tuple>();
  if (!existsSync(CATALOG_PATH)) return map;
  const rows = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as Tuple[];
  for (const row of rows || []) map.set(tupleKey(row), row);
  return map;
}

function saveCatalog(map: Map<string, Tuple>) {
  const rows = [...map.values()].sort((a, b) => b.n - a.n || a.maker.localeCompare(b.maker, 'ko'));
  writeFileSync(CATALOG_PATH, JSON.stringify(rows, null, 2), 'utf8');
}

function rebuildCatalogFromRaw(): Map<string, Tuple> {
  const map = new Map<string, Tuple>();
  const files = readdirSync(RAW_DIR).filter((f) => /^raw-\d+\.json$/.test(f));
  for (const file of files) {
    const chunk = JSON.parse(readFileSync(join(RAW_DIR, file), 'utf8')) as { results?: Rec[] };
    for (const row of chunk.results || []) ingest(map, row);
  }
  return map;
}

type Rec = Record<string, unknown>;

function ingest(map: Map<string, Tuple>, row: Rec) {
  const maker = S(row.Manufacturer);
  const sub_model = S(row.Model);
  if (!maker || !sub_model) return;
  const base = {
    maker,
    sub_model,
    badge: S(row.Badge),
    badge_detail: S(row.BadgeDetail),
    fuel: S(row.FuelType),
    green: S(row.GreenType),
  };
  const y = yearOf(row.Year);
  const key = tupleKey(base);
  const prev = map.get(key);
  if (!prev) {
    map.set(key, { ...base, year_min: y || 0, year_max: y || 0, n: 1 });
    return;
  }
  prev.n += 1;
  if (y) {
    if (!prev.year_min || y < prev.year_min) prev.year_min = y;
    if (!prev.year_max || y > prev.year_max) prev.year_max = y;
  }
}

function loadState(): State {
  if (!fresh && existsSync(STATE_PATH)) {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as State;
  }
  return { nextOffset: 0, total: null, failed: [], pages: 0, updated_at: new Date().toISOString() };
}

function saveState(state: State) {
  state.updated_at = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

async function fetchPage(offset: number, attempt = 1): Promise<{ count: number | null; results: Rec[] }> {
  const sr = `|ModifiedDate|${offset}|${PAGE}`;
  const url = `${BASE}?count=true&q=${encodeURIComponent(Q)}&sr=${encodeURIComponent(sr)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as Rec;
    const count = Number(json.Count ?? json.count) || null;
    const results = (json.SearchResults || json.searchResults || []) as Rec[];
    return { count, results };
  } catch (err) {
    if (attempt >= 3) throw err;
    const wait = 2000 * (2 ** (attempt - 1));
    console.warn(`offset ${offset} fail#${attempt}: ${String(err)} → wait ${wait}ms`);
    await sleep(wait);
    return fetchPage(offset, attempt + 1);
  }
}

const state = loadState();
let catalog = fresh ? new Map<string, Tuple>() : loadCatalog();
if (!fresh && catalog.size === 0 && existsSync(RAW_DIR)) {
  catalog = rebuildCatalogFromRaw();
  saveCatalog(catalog);
}

console.log(`encar crawl start offset=${state.nextOffset} catalog=${catalog.size} fresh=${fresh}`);

let fetchedCars = 0;
while (true) {
  if (hardLimit && fetchedCars >= hardLimit) {
    console.log(`--limit=${hardLimit} reached`);
    break;
  }
  if (state.total != null && state.nextOffset >= state.total) break;

  const offset = state.nextOffset;
  const rawPath = join(RAW_DIR, `raw-${offset}.json`);

  let results: Rec[] = [];
  let count: number | null = state.total;

  if (!fresh && existsSync(rawPath)) {
    const cached = JSON.parse(readFileSync(rawPath, 'utf8')) as { count?: number | null; results?: Rec[] };
    results = cached.results || [];
    if (cached.count != null) count = cached.count;
    console.log(`skip cached offset=${offset} n=${results.length}`);
  } else {
    try {
      const page = await fetchPage(offset);
      results = page.results;
      count = page.count;
      writeFileSync(rawPath, JSON.stringify({
        offset,
        count,
        // 분류 필드만 — Id/가격/사진/판매점 제외
        results: results.map((r) => ({
          Manufacturer: r.Manufacturer,
          Model: r.Model,
          Badge: r.Badge,
          BadgeDetail: r.BadgeDetail,
          FuelType: r.FuelType,
          GreenType: r.GreenType,
          Year: r.Year,
        })),
      }), 'utf8');
    } catch (err) {
      console.error(`offset ${offset} GIVE UP:`, err);
      state.failed.push(offset);
      state.nextOffset = offset + PAGE;
      saveState(state);
      await sleep(GAP_MS);
      continue;
    }
    await sleep(GAP_MS);
  }

  if (count != null) state.total = count;
  for (const row of results) ingest(catalog, row);
  fetchedCars += results.length;
  state.pages += 1;
  state.nextOffset = offset + PAGE;
  saveState(state);

  if (state.pages % 10 === 0 || results.length === 0) {
    saveCatalog(catalog);
    console.log(
      `progress offset=${state.nextOffset}/${state.total ?? '?'} pages=${state.pages} `
      + `tuples=${catalog.size} failed=${state.failed.length}`,
    );
  }

  if (results.length === 0) {
    console.log('empty page — stop');
    break;
  }
}

saveCatalog(catalog);
saveState(state);
console.log(`DONE catalog=${catalog.size} nextOffset=${state.nextOffset} total=${state.total} failed=${state.failed.length}`);
console.log(`→ ${CATALOG_PATH}`);
