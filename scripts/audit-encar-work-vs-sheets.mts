/**
 * 엔카 작업 시트(차종·제원·배터리) 기준으로 공급사 정제칸·판매 상품시트가 맞는지 검수.
 * 읽기 전용. vehicle-master.json 안 씀. 추측으로 빈칸을 채운 것처럼 보지 않는다.
 *
 *   npx tsx scripts/audit-encar-work-vs-sheets.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isLegacySheetId } from '../lib/domain/legacy-sheets';
import { loadEncarWorkSheetGrids } from '../lib/domain/encar-master-sheet';
import { isMirrorSheet } from '../lib/domain/mirror-sources';
import { pickPublishedSalesTabs } from '../lib/domain/sales-published-tabs';
import {
  isOurNonInventoryTab,
  LEGACY_SHEET_PREFIX,
  SHEET_NAME_MATCH,
  SUPPLIER_PREVIEW_TAB,
  supplierSheetLabel,
} from '../lib/domain/supplier-template-sheet';
import { companyAlias, supplierNameKeys } from '../lib/domain/identity';
import { canonMakerDisplay } from '../lib/domain/maker-display';
import {
  attachFromEncarSheet,
  fold,
  selfCheckEncarMatch,
  workBookFromTabs,
  type EncarFillColumn,
  type WorkBook,
} from '../lib/domain/encar-work-sheet-match';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONLY = new Set(arg('who').split(/[,\s]+/).map(S).filter(Boolean));
const SALES_ID = arg('sheet', S(process.env.INVENTORY_EXPORT_SHEET_ID) || '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) {
      await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n)));
      continue;
    }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};

const MAKER_TO_SHEET: Record<string, string> = {
  르노: '르노코리아', 르노코리아: '르노코리아', 르노삼성: '르노코리아',
  kgm: 'KG모빌리티', kg모빌리티: 'KG모빌리티', 쌍용: 'KG모빌리티',
  쉐보레: '쉐보레', 한국gm: '쉐보레', gm대우: '쉐보레',
};

type NameIdx = {
  makers: Set<string>;
  models: Map<string, Set<string>>;
  subs: Map<string, Set<string>>;
  trims: Map<string, Set<string>>;
  origins: Map<string, Set<string>>;
  batBySub: Map<string, Set<string>>;
};

function sheetMakerOf(raw: string, book: WorkBook): string {
  const disp = canonMakerDisplay(raw) || S(raw);
  const mapped = MAKER_TO_SHEET[fold(disp)] || MAKER_TO_SHEET[fold(raw)] || '';
  if (mapped && book.names.some((r) => r.maker === mapped)) return mapped;
  const exact = book.names.find((r) => r.maker === disp || r.maker === raw)?.maker;
  if (exact) return exact;
  return book.names.find((r) => canonMakerDisplay(r.maker) === disp)?.maker || '';
}

function buildIdx(book: WorkBook): NameIdx {
  const idx: NameIdx = {
    makers: new Set(),
    models: new Map(),
    subs: new Map(),
    trims: new Map(),
    origins: new Map(),
    batBySub: new Map(),
  };
  const add = (m: Map<string, Set<string>>, k: string, v: string) => {
    if (!v) return;
    (m.get(k) || m.set(k, new Set()).get(k)!).add(v);
  };
  for (const r of book.names) {
    const mk = fold(r.maker);
    idx.makers.add(mk);
    add(idx.models, mk, r.model);
    add(idx.subs, `${mk}|${fold(r.model)}`, r.sub);
    add(idx.trims, `${mk}|${fold(r.model)}|${fold(r.sub)}`, r.trim);
    add(idx.origins, mk, r.origin);
  }
  for (const b of book.batteries) {
    add(idx.batBySub, `${fold(b.maker)}|${fold(b.model)}|${fold(b.sub)}`, b.kwh);
  }
  return idx;
}

function inSet(set: Set<string> | undefined, val: string): boolean {
  if (!set || !val) return false;
  const f = fold(val);
  for (const x of set) if (fold(x) === f) return true;
  return false;
}

function pickCc(raw: string): number | undefined {
  const s = S(raw).replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  const m = /(\d{3,5})/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 800 && n <= 8000 ? n : undefined;
}

function pickKwh(raw: string): string {
  const s = S(raw).replace(/,/g, '');
  const m = /(\d+(?:\.\d+)?)\s*(?:kwh)?/i.exec(s);
  return m ? m[1] : s;
}

function driveLabel(raw: string): string {
  const s = S(raw);
  const u = s.toUpperCase();
  if (/(4MATIC|XDRIVE|QUATTRO|HTRAC|콰트로)/i.test(s) || /\bAWD\b/.test(u) || /\b4WD\b/.test(u) || /사륜|4륜/.test(s)) return 'AWD';
  if (/\bRWD\b/.test(u) || /후륜/.test(s)) return 'RWD';
  if (/\bFWD\b/.test(u) || /전륜|2륜/.test(s) || /\b2WD\b/.test(u)) return '2WD';
  if (s === '2WD' || s === 'RWD' || s === 'AWD') return s;
  return '';
}

function fuelLabel(raw: string, allowed: Set<string>): string {
  const f = fold(raw);
  if (/phev|플러그인/.test(f)) return '';
  const map: Record<string, string> = {
    가솔린: '가솔린', 휘발유: '가솔린', gasoline: '가솔린',
    디젤: '디젤', 경유: '디젤', diesel: '디젤',
    lpg: 'LPG', lpi: 'LPG', 엘피지: 'LPG',
    하이브리드: '하이브리드', hev: '하이브리드',
    전기: '전기', ev: '전기',
    수소: '수소',
  };
  const hit = map[f] || [...allowed].find((x) => fold(x) === f) || '';
  return hit && allowed.has(hit) ? hit : '';
}

function sameLiter(a: number, b: number): boolean {
  return Number((a / 1000).toFixed(1)) === Number((b / 1000).toFixed(1));
}

type Verdict = '맞음' | '틀림' | '못정함' | '빈칸';
type Hit = { src: string; who: string; tab: string; plate: string; col: string; now: string; want: string; note: string; v: Verdict };

const hits: Hit[] = [];
const bump = (h: Hit) => { hits.push(h); };

function checkFilled(opts: {
  src: string; who: string; tab: string; plate: string;
  book: WorkBook; idx: NameIdx;
  makerRaw: string; origin: string; model: string; sub: string; trim: string;
  fuel: string; cc: string; drive: string; seats: string; bat: string;
  want: Partial<Record<EncarFillColumn, string>>;
}) {
  const { src, who, tab, plate, book, idx, want } = opts;
  const sm = sheetMakerOf(opts.makerRaw, book);
  const inScope = !!sm;
  const outOfBook = opts.makerRaw && !sm;

  const conflict = (col: EncarFillColumn, now: string) => {
    const w = S(want[col]);
    if (w && now && fold(w) !== fold(now)) {
      bump({ src, who, tab, plate, col, now, want: w, note: '원문이 하나로 모인 값과 다름', v: '틀림' });
      return true;
    }
    return false;
  };

  if (opts.makerRaw) {
    if (outOfBook) {
      bump({ src, who, tab, plate, col: '제조사(정제)', now: opts.makerRaw, want: '', note: '작업 시트 6사 밖(수입 등)', v: '못정함' });
    } else if (S(want['제조사(정제)']) && sheetMakerOf(opts.makerRaw, book) === sheetMakerOf(want['제조사(정제)'] || '', book)) {
      bump({ src, who, tab, plate, col: '제조사(정제)', now: opts.makerRaw, want: sm, note: '', v: '맞음' });
    } else if (!conflict('제조사(정제)', opts.makerRaw)) {
      bump({ src, who, tab, plate, col: '제조사(정제)', now: opts.makerRaw, want: sm, note: '', v: '맞음' });
    }
  } else {
    bump({ src, who, tab, plate, col: '제조사(정제)', now: '', want: '', note: '', v: '빈칸' });
  }

  const chainOk = inScope;
  const mk = fold(sm);

  if (opts.origin) {
    if (!inScope) bump({ src, who, tab, plate, col: '원산지', now: opts.origin, want: '', note: '제조사 범위 밖', v: '못정함' });
    else if (!conflict('원산지', opts.origin)) {
      if (!inSet(idx.origins.get(mk), opts.origin)) {
        bump({ src, who, tab, plate, col: '원산지', now: opts.origin, want: [...(idx.origins.get(mk) || [])].join('/'), note: '그 제조사 원산지와 다름', v: '틀림' });
      } else bump({ src, who, tab, plate, col: '원산지', now: opts.origin, want: opts.origin, note: '', v: '맞음' });
    }
  } else bump({ src, who, tab, plate, col: '원산지', now: '', want: S(want.원산지), note: '', v: '빈칸' });

  if (opts.model) {
    if (!inScope) bump({ src, who, tab, plate, col: '모델', now: opts.model, want: '', note: '제조사 없음·범위 밖', v: '못정함' });
    else if (!conflict('모델', opts.model)) {
      if (!inSet(idx.models.get(mk), opts.model)) {
        bump({ src, who, tab, plate, col: '모델', now: opts.model, want: '', note: `${sm} 마스터에 없는 모델`, v: '틀림' });
      } else bump({ src, who, tab, plate, col: '모델', now: opts.model, want: opts.model, note: '', v: '맞음' });
    }
  } else bump({ src, who, tab, plate, col: '모델', now: '', want: S(want.모델), note: '', v: '빈칸' });

  const modelOk = chainOk && !!opts.model && inSet(idx.models.get(mk), opts.model);
  if (opts.sub) {
    if (!inScope || !opts.model) bump({ src, who, tab, plate, col: '세부모델', now: opts.sub, want: '', note: '제조사·모델이 먼저', v: '못정함' });
    else if (!modelOk) bump({ src, who, tab, plate, col: '세부모델', now: opts.sub, want: '', note: '모델이 마스터에 없음', v: '못정함' });
    else if (!conflict('세부모델', opts.sub)) {
      if (!inSet(idx.subs.get(`${mk}|${fold(opts.model)}`), opts.sub)) {
        bump({ src, who, tab, plate, col: '세부모델', now: opts.sub, want: '', note: `${sm} ${opts.model} 아래 없는 세부모델`, v: '틀림' });
      } else bump({ src, who, tab, plate, col: '세부모델', now: opts.sub, want: opts.sub, note: '', v: '맞음' });
    }
  } else bump({ src, who, tab, plate, col: '세부모델', now: '', want: S(want.세부모델), note: '', v: '빈칸' });

  const subOk = modelOk && !!opts.sub && inSet(idx.subs.get(`${mk}|${fold(opts.model)}`), opts.sub);
  if (opts.trim) {
    if (!subOk) bump({ src, who, tab, plate, col: '세부트림', now: opts.trim, want: '', note: '세부모델이 확정돼야 트림 검수', v: '못정함' });
    else if (!conflict('세부트림', opts.trim)) {
      if (!inSet(idx.trims.get(`${mk}|${fold(opts.model)}|${fold(opts.sub)}`), opts.trim)) {
        bump({ src, who, tab, plate, col: '세부트림', now: opts.trim, want: '', note: `${opts.sub} 아래 없는 트림`, v: '틀림' });
      } else bump({ src, who, tab, plate, col: '세부트림', now: opts.trim, want: opts.trim, note: '', v: '맞음' });
    }
  } else bump({ src, who, tab, plate, col: '세부트림', now: '', want: S(want.세부트림), note: '', v: '빈칸' });

  if (opts.fuel) {
    if (outOfBook) bump({ src, who, tab, plate, col: '연료(정제)', now: opts.fuel, want: '', note: '제조사 범위 밖', v: '못정함' });
    else {
      const got = fuelLabel(opts.fuel, book.fuels);
      const w = S(want['연료(정제)']);
      if (got && w && got !== w) bump({ src, who, tab, plate, col: '연료(정제)', now: opts.fuel, want: w, note: '원문이 하나로 모인 값과 다름', v: '틀림' });
      else if (got) bump({ src, who, tab, plate, col: '연료(정제)', now: opts.fuel, want: got, note: fold(opts.fuel) === fold(got) ? '제원목록' : '표기(HEV→하이브리드 등)', v: '맞음' });
      else bump({ src, who, tab, plate, col: '연료(정제)', now: opts.fuel, want: [...book.fuels].join('/'), note: '제원마스터에 없음', v: '틀림' });
    }
  } else bump({ src, who, tab, plate, col: '연료(정제)', now: '', want: S(want['연료(정제)']), note: '', v: '빈칸' });

  if (opts.cc) {
    if (outOfBook) bump({ src, who, tab, plate, col: '배기량(정제)', now: opts.cc, want: '', note: '제조사 범위 밖', v: '못정함' });
    else {
      const n = pickCc(opts.cc);
      const w = pickCc(S(want['배기량(정제)']));
      if (n !== undefined && w !== undefined && n !== w && sameLiter(n, w)) {
        bump({ src, who, tab, plate, col: '배기량(정제)', now: opts.cc, want: String(w), note: '같은 리터 반올림(시트 정확값 유지)', v: '맞음' });
      } else if (n !== undefined && w !== undefined && n !== w) {
        bump({ src, who, tab, plate, col: '배기량(정제)', now: opts.cc, want: String(w), note: '원문이 하나로 모인 값과 다름', v: '틀림' });
      } else if (n !== undefined && book.ccs.has(n)) {
        bump({ src, who, tab, plate, col: '배기량(정제)', now: opts.cc, want: String(n), note: '제원목록', v: '맞음' });
      } else {
        bump({ src, who, tab, plate, col: '배기량(정제)', now: opts.cc, want: w !== undefined ? String(w) : '', note: '제원마스터에 없음', v: '틀림' });
      }
    }
  } else bump({ src, who, tab, plate, col: '배기량(정제)', now: '', want: S(want['배기량(정제)']), note: '', v: '빈칸' });

  if (opts.drive) {
    if (outOfBook) bump({ src, who, tab, plate, col: '구동방식', now: opts.drive, want: '', note: '제조사 범위 밖', v: '못정함' });
    else {
      const got = driveLabel(opts.drive);
      const w = S(want.구동방식) || got;
      if (got && S(want.구동방식) && got !== S(want.구동방식)) {
        bump({ src, who, tab, plate, col: '구동방식', now: opts.drive, want: S(want.구동방식), note: '원문이 하나로 모인 값과 다름', v: '틀림' });
      } else if (got && book.drives.has(got)) {
        bump({ src, who, tab, plate, col: '구동방식', now: opts.drive, want: got, note: fold(opts.drive) === fold(got) ? '제원목록' : '표기(FWD·2륜구동→2WD)', v: '맞음' });
      } else {
        bump({ src, who, tab, plate, col: '구동방식', now: opts.drive, want: w, note: '제원마스터에 없음', v: '틀림' });
      }
    }
  } else bump({ src, who, tab, plate, col: '구동방식', now: '', want: S(want.구동방식), note: '', v: '빈칸' });

  if (opts.seats) {
    bump({ src, who, tab, plate, col: '인승', now: opts.seats, want: '', note: '작업 시트에 인승 축 없음', v: '못정함' });
  } else bump({ src, who, tab, plate, col: '인승', now: '', want: S(want.인승), note: '', v: '빈칸' });

  if (opts.bat) {
    if (outOfBook) bump({ src, who, tab, plate, col: '배터리용량(정제)', now: opts.bat, want: '', note: '제조사 범위 밖', v: '못정함' });
    else if (!conflict('배터리용량(정제)', opts.bat)) {
      const kwh = pickKwh(opts.bat);
      if (!subOk) {
        bump({ src, who, tab, plate, col: '배터리용량(정제)', now: opts.bat, want: '', note: '세부모델 없이 kWh 검수 불가', v: '못정함' });
      } else {
        const allowed = idx.batBySub.get(`${mk}|${fold(opts.model)}|${fold(opts.sub)}`);
        const ok = allowed && [...allowed].some((x) => fold(x) === fold(kwh) || Number(x) === Number(kwh));
        bump({ src, who, tab, plate, col: '배터리용량(정제)', now: opts.bat, want: allowed ? [...allowed].join('/') : '', note: ok ? '' : '그 세부모델 배터리마스터에 없음', v: ok ? '맞음' : '틀림' });
      }
    }
  } else bump({ src, who, tab, plate, col: '배터리용량(정제)', now: '', want: S(want['배터리용량(정제)']), note: '', v: '빈칸' });
}

function findHeader(grid: string[][]): number {
  const n = Math.min(grid.length, 10);
  for (let i = 0; i < n; i++) if ((grid[i] || []).some((c) => S(c) === '차량번호')) return i;
  return -1;
}

function colMap(hdr: string[]): Map<string, number> {
  const at = new Map<string, number>();
  hdr.forEach((h, i) => { if (h && !at.has(h)) at.set(h, i); });
  return at;
}
function cell(row: string[], at: Map<string, number>, ...names: string[]): string {
  for (const n of names) {
    const i = at.get(n);
    if (i !== undefined) return S(row[i]);
  }
  return '';
}

function scanRows(opts: {
  src: string; who: string; tab: string; grid: string[][];
  book: WorkBook; idx: NameIdx; salesHeaders?: boolean;
}) {
  const { src, who, tab, grid, book, idx, salesHeaders } = opts;
  const hRow = findHeader(grid);
  if (hRow < 0) return 0;
  const at = colMap((grid[hRow] || []).map(S));
  if ((at.get('차량번호') ?? -1) < 0) return 0;
  let cars = 0;
  for (const row of grid.slice(hRow + 1)) {
    const plate = cell(row, at, '차량번호');
    if (!plate) continue;
    cars++;
    const maker = cell(row, at, '제조사(정제)', '제조사');
    const carName = cell(row, at, '차명(세부모델+트림)', '차명');
    const carKind = cell(row, at, '차종', '모델명');
    const want = attachFromEncarSheet({
      maker: cell(row, at, '제조사') || maker,
      kind: carKind,
      carName,
      fuel: cell(row, at, '연료'),
      cc: cell(row, at, '배기량'),
      drive: cell(row, at, '구동', '구동방식'),
      seats: cell(row, at, '승차인원', '인승'),
      year: cell(row, at, '연식'),
    }, book);
    checkFilled({
      src, who, tab, plate, book, idx, want,
      makerRaw: maker,
      origin: cell(row, at, '원산지'),
      model: cell(row, at, '모델'),
      sub: cell(row, at, '세부모델'),
      trim: cell(row, at, '세부트림'),
      fuel: salesHeaders ? cell(row, at, '연료', '연료(정제)') : cell(row, at, '연료(정제)', '연료'),
      cc: salesHeaders ? cell(row, at, '배기량', '배기량(정제)') : cell(row, at, '배기량(정제)', '배기량'),
      drive: salesHeaders ? cell(row, at, '구동', '구동방식') : cell(row, at, '구동방식', '구동'),
      seats: cell(row, at, '인승', '승차인원'),
      bat: salesHeaders ? cell(row, at, '배터리용량', '배터리용량(정제)') : cell(row, at, '배터리용량(정제)', '배터리용량'),
    });
  }
  return cars;
}

const grids = await loadEncarWorkSheetGrids(api);
const book = workBookFromTabs(grids);
const checks = selfCheckEncarMatch(book);
if (checks.length) {
  console.error('⛔ 매처 자가검증 실패\n' + checks.map((x) => `  ${x}`).join('\n'));
  process.exit(1);
}
const idx = buildIdx(book);
console.log(`■ 엔카 작업 시트 차종 ${book.names.length}행 · 연료 ${book.fuels.size} · cc ${book.ccs.size} · 구동 ${book.drives.size} · 배터리 ${book.batteries.length}`);
const showSubs = ['싼타페', '레이', 'K8', '니로', '아이오닉', '아이오닉5', 'GV80', '토레스', '아르카나', '쏘나타', '그랜저', '카니발', '셀토스', 'K7'];
for (const m of showSubs) {
  const rows = book.names.filter((r) => r.model === m);
  if (!rows.length) { console.log(`  · ${m} — 마스터에 모델 없음`); continue; }
  const subs = [...new Set(rows.map((r) => r.sub))];
  const trims = [...new Set(rows.map((r) => r.trim))].slice(0, 12);
  console.log(`  · ${rows[0].maker} ${m} 세부모델 ${subs.length} = ${subs.join(' · ')}`);
  if (m === 'GV80' || m === '아르카나' || m === '토레스') console.log(`      트림예 ${trims.join(' · ')}`);
}

const targets: { name: string; id: string }[] = [];
{
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) {
    const nm = S(f.name);
    const who = companyAlias(supplierSheetLabel(nm)) || supplierSheetLabel(nm);
    if (nm.startsWith(LEGACY_SHEET_PREFIX) || /구버전/.test(nm) || isLegacySheetId(S(f.id))) continue;
    if (ONLY.size && ![...supplierNameKeys(who)].some((k) => ONLY.has(k))) continue;
    targets.push({ name: who, id: S(f.id) });
  }
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;
const carsBySrc = new Map<string, number>();
const addCars = (k: string, n: number) => carsBySrc.set(k, (carsBySrc.get(k) || 0) + n);

console.log(`\n■ 공급사 ${targets.length}곳 (재고 탭 + 상품시트 탭)`);
for (const t of targets) {
  let meta: Rec;
  try {
    meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}?fields=${encodeURIComponent('sheets.properties(sheetId,title,hidden)')}`);
  } catch (e) {
    console.log(`  ✗ ${t.name} 열기 실패 ${String((e as Error).message).slice(0, 80)}`);
    continue;
  }
  const allTabs = ((meta.sheets || []) as Rec[])
    .filter((s) => !s.properties?.hidden)
    .map((s) => S(s.properties?.title)).filter(Boolean);
  const inv = allTabs.filter((x) => !isOurNonInventoryTab(x));
  const preview = allTabs.filter((x) => x === SUPPLIER_PREVIEW_TAB);
  const wantTabs = [...inv, ...preview];
  if (!wantTabs.length) continue;
  let got: Rec;
  try {
    const qs = wantTabs.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&');
    got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}/values:batchGet?${qs}&majorDimension=ROWS`);
  } catch (e) {
    console.log(`  ✗ ${t.name} 값 실패 ${String((e as Error).message).slice(0, 80)}`);
    continue;
  }
  let invCars = 0, prevCars = 0;
  ((got.valueRanges || []) as Rec[]).forEach((vr, i) => {
    const title = wantTabs[i];
    const grid = ((vr.values || []) as string[][]);
    const n = scanRows({
      src: title === SUPPLIER_PREVIEW_TAB ? '공급사상품시트' : '공급사재고',
      who: t.name, tab: title, grid, book, idx,
      salesHeaders: title === SUPPLIER_PREVIEW_TAB,
    });
    if (title === SUPPLIER_PREVIEW_TAB) prevCars += n; else invCars += n;
  });
  addCars('공급사재고', invCars);
  addCars('공급사상품시트', prevCars);
  console.log(`  ${t.name.padEnd(14)} 재고 ${String(invCars).padStart(4)}대  상품시트 ${String(prevCars).padStart(4)}대${isMirrorSheet(t.id) ? '  정제시트' : ''}`);
}

console.log('\n■ 판매 상품시트(발행 탭)');
{
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SALES_ID}?fields=sheets.properties(title,hidden)`);
  const titles = ((meta.sheets || []) as Rec[])
    .filter((s) => !s.properties?.hidden)
    .map((s) => S(s.properties?.title));
  const pubs = pickPublishedSalesTabs(titles);
  if (!pubs.length) throw new Error('발행 탭을 못 찾음');
  const qs = pubs.map((p) => `ranges=${encodeURIComponent(a1Tab(p.title))}`).join('&');
  const got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SALES_ID}/values:batchGet?${qs}&majorDimension=ROWS`);
  ((got.valueRanges || []) as Rec[]).forEach((vr, i) => {
    const p = pubs[i];
    const grid = ((vr.values || []) as string[][]);
    const n = scanRows({ src: '판매시트', who: p.prefix, tab: p.title, grid, book, idx, salesHeaders: true });
    addCars('판매시트', n);
    console.log(`  ${p.title}  ${n}대`);
  });
}

function carKey(h: Hit) { return `${h.src}|${h.who}|${h.tab}|${h.plate}`; }
const byCar = new Map<string, Hit[]>();
for (const h of hits) {
  (byCar.get(carKey(h)) || byCar.set(carKey(h), []).get(carKey(h))!).push(h);
}

const NAME_COLS = new Set(['제조사(정제)', '원산지', '모델', '세부모델', '세부트림']);
type CarV = '맞음' | '틀림' | '못정함' | '빈칸';
const carTally: Record<string, Record<CarV, number>> = {};
const ensure = (src: string) => {
  carTally[src] ||= { 맞음: 0, 틀림: 0, 못정함: 0, 빈칸: 0 };
  return carTally[src];
};
const badCars: { src: string; who: string; plate: string; bits: string[] }[] = [];
const nameGrouped = new Map<string, number>();
const whoTally: Record<string, Record<CarV, number>> = {};

for (const [, list] of byCar) {
  const src = list[0].src;
  const names = list.filter((h) => NAME_COLS.has(h.col));
  let v: CarV = '맞음';
  if (names.some((h) => h.v === '틀림')) v = '틀림';
  else if (names.some((h) => h.v === '못정함')) v = '못정함';
  else if (names.find((h) => h.col === '모델')?.v === '빈칸' && names.find((h) => h.col === '세부모델')?.v === '빈칸') v = '빈칸';
  ensure(src)[v]++;
  if (src === '공급사재고') {
    const w = list[0].who;
    whoTally[w] ||= { 맞음: 0, 틀림: 0, 못정함: 0, 빈칸: 0 };
    whoTally[w][v]++;
  }
  if (v === '틀림') {
    const bits = list.filter((h) => NAME_COLS.has(h.col) && h.v === '틀림').map((h) => `${h.col}=${h.now}${h.want ? `←${h.want}` : ''} (${h.note})`);
    badCars.push({ src, who: list[0].who, plate: list[0].plate, bits });
    for (const h of list.filter((x) => NAME_COLS.has(x.col) && x.v === '틀림')) {
      const key = `${h.src}|${h.col}|${h.note}|${h.now.slice(0, 48)}`;
      nameGrouped.set(key, (nameGrouped.get(key) || 0) + 1);
    }
  }
}

const specBad = hits.filter((h) => !NAME_COLS.has(h.col) && h.v === '틀림');
const specGrouped = new Map<string, number>();
for (const h of specBad) {
  const key = `${h.src}|${h.col}|${h.note}|${h.now.slice(0, 40)}`;
  specGrouped.set(key, (specGrouped.get(key) || 0) + 1);
}

console.log('\n■ 차 단위 판정 — 이름 축(제조사·원산지·모델·세부모델·세부트림)');
for (const src of ['공급사재고', '공급사상품시트', '판매시트']) {
  const t = carTally[src] || { 맞음: 0, 틀림: 0, 못정함: 0, 빈칸: 0 };
  const tot = t.맞음 + t.틀림 + t.못정함 + t.빈칸;
  console.log(`  ${src}  ${tot}대  맞음 ${t.맞음}  틀림 ${t.틀림}  못정함 ${t.못정함}  빈칸 ${t.빈칸}`);
}
console.log('\n■ 공급사 재고 정제칸 (이름 축)');
for (const who of Object.keys(whoTally).sort((a, b) => a.localeCompare(b, 'ko'))) {
  const t = whoTally[who];
  const tot = t.맞음 + t.틀림 + t.못정함 + t.빈칸;
  console.log(`  ${who.padEnd(14)} ${String(tot).padStart(4)}대  맞음 ${String(t.맞음).padStart(4)}  틀림 ${String(t.틀림).padStart(3)}  못정함 ${String(t.못정함).padStart(3)}  빈칸 ${String(t.빈칸).padStart(3)}`);
}

console.log('\n■ 이름 틀림 (같은 결손끼리)');
for (const [key, n] of [...nameGrouped].sort((a, b) => b[1] - a[1])) {
  const [src, col, note, now] = key.split('|');
  console.log(`  ${String(n).padStart(4)}  ${src}  ${col}  ${now}  ${note}`);
}

console.log('\n■ 제원 틀림 (표기·반올림은 맞음으로 뺀 뒤)');
for (const [key, n] of [...specGrouped].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  const [src, col, note, now] = key.split('|');
  console.log(`  ${String(n).padStart(4)}  ${src}  ${col}  ${now}  ${note}`);
}

const blankFillable = hits.filter((h) => h.v === '빈칸' && h.want && NAME_COLS.has(h.col));
const blankByCol = new Map<string, number>();
for (const h of blankFillable) blankByCol.set(`${h.src}|${h.col}`, (blankByCol.get(`${h.src}|${h.col}`) || 0) + 1);
console.log('\n■ 마스터가 하나로 모였는데 칸이 비어 있음 (안 들어감 ≠ 틀림)');
for (const [k, n] of [...blankByCol].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);

console.log('\n■ 틀림 예 (차)');
for (const c of badCars.slice(0, 40)) {
  console.log(`  ${c.src} ${c.who} ${c.plate}`);
  for (const b of c.bits.slice(0, 4)) console.log(`     ${b}`);
}
if (badCars.length > 40) console.log(`  … 그 밖 ${badCars.length - 40}대`);

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/audit-encar-work-vs-sheets.json', JSON.stringify({
  at: new Date().toISOString(),
  book: { names: book.names.length, fuels: [...book.fuels], ccs: [...book.ccs].sort((a, b) => a - b), drives: [...book.drives], batteries: book.batteries.length },
  cars: carTally,
  whoTally,
  carsBySrc: Object.fromEntries(carsBySrc),
  nameGrouped: [...nameGrouped].sort((a, b) => b[1] - a[1]),
  specGrouped: [...specGrouped].sort((a, b) => b[1] - a[1]),
  badCars,
  blankFillable: blankFillable.length,
}, null, 2));
console.log('\n  → tmp/audit-encar-work-vs-sheets.json');
