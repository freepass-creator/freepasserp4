/**
 * 엔카 작업 시트(차종·제원·배터리)에 원문을 붙인다. 하나로 모일 때만. 추측 없음.
 * 라이브 ERP 원장·vehicle-master.json 을 읽지 않는다.
 */
import { readFileSync, existsSync } from 'node:fs';
import { applyLatinBrandTokens } from './vehicle-master-lock';
import { canonMakerDisplay } from './maker-display';

const S = (v: unknown) => String(v ?? '').trim();

export const ENCAR_FILL_COLUMNS = [
  '원산지', '제조사(정제)', '모델', '세부모델', '세부트림',
  '연료(정제)', '배기량(정제)', '구동방식', '인승', '배터리용량(정제)',
] as const;
export type EncarFillColumn = (typeof ENCAR_FILL_COLUMNS)[number];

export type NameRow = { origin: string; maker: string; model: string; sub: string; trim: string };
export type BatteryRow = { maker: string; model: string; sub: string; kwh: string; note: string };
export type WorkBook = {
  names: NameRow[];
  fuels: Set<string>;
  ccs: Set<number>;
  drives: Set<string>;
  batteries: BatteryRow[];
};

const REPORTS = [
  'C:/Users/admin/encar-market-survey/reports',
  '../encar-market-survey/reports',
  'C:/Users/admin/encar-market-survey/reports',
];

function reportsDir(): string {
  for (const p of REPORTS) if (existsSync(`${p}/vehicle_name_master.json`)) return p;
  throw new Error('엔카 작업 시트 json 없음 (vehicle_name_master.json)');
}

function hdrIndex(hdr: string[], ...cands: string[]): number {
  const n = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const folded = hdr.map(n);
  for (const c of cands) {
    const i = folded.indexOf(n(c));
    if (i >= 0) return i;
  }
  return -1;
}

function looksLikeNameHeader(row: string[]): boolean {
  const f = row.map((c) => c.replace(/\s+/g, ''));
  return f.includes('제조사') && f.includes('모델') && f.includes('세부모델');
}

function looksLikeYearMonth(v: string): boolean {
  return /^(?:\d{4}-\d{2}|현재|보류)$/.test(S(v));
}

/** 구글 시트(머리글) · 로컬 json(열 차례 두 가지) 모두. 생산시작·종료는 매칭에 안 쓴다. */
export function workBookFromTabs(input: {
  names: unknown[][];
  specs: unknown[][];
  batteries: unknown[][];
}): WorkBook {
  const namesGrid = (input.names || []).map((r) => (r || []).map(S));
  const specGrid = (input.specs || []).map((r) => (r || []).map(S));
  const batGrid = (input.batteries || []).map((r) => (r || []).map(S));
  if (!namesGrid.length) throw new Error('차종마스터 비어 있음');

  let nameStart = 0;
  let originI = 0, makerI = 1, modelI = 2, subI = 3, trimI = 4;
  if (looksLikeNameHeader(namesGrid[0])) {
    const hdr = namesGrid[0];
    originI = hdrIndex(hdr, '원산지');
    makerI = hdrIndex(hdr, '제조사');
    modelI = hdrIndex(hdr, '모델');
    subI = hdrIndex(hdr, '세부모델');
    trimI = hdrIndex(hdr, '세부트림');
    if (makerI < 0 || modelI < 0 || subI < 0 || trimI < 0) {
      throw new Error(`차종마스터 헤더가 다름: ${hdr.join('|')}`);
    }
    nameStart = 1;
  } else {
    const sample = namesGrid.find((r) => S(r[4]));
    if (sample && looksLikeYearMonth(sample[4])) trimI = 6;
  }

  const names: NameRow[] = namesGrid.slice(nameStart).map((r) => ({
    origin: S(r[originI]), maker: S(r[makerI]), model: S(r[modelI]), sub: S(r[subI]), trim: S(r[trimI]),
  })).filter((r) => r.maker && r.model);
  if (names.length < 50) throw new Error(`차종마스터 행이 너무 적음 (${names.length})`);

  let specStart = 0;
  let kindI = 0, valI = 1;
  if (specGrid.length && hdrIndex(specGrid[0], '구분') >= 0) {
    kindI = hdrIndex(specGrid[0], '구분');
    valI = hdrIndex(specGrid[0], '값');
    if (valI < 0) throw new Error(`제원마스터 헤더가 다름: ${specGrid[0].join('|')}`);
    specStart = 1;
  }
  const fuels = new Set<string>();
  const ccs = new Set<number>();
  const drives = new Set<string>();
  for (const r of specGrid.slice(specStart)) {
    const kind = S(r[kindI]);
    const val = S(r[valI]);
    if (kind === '연료') fuels.add(val);
    else if (kind === '배기량(cc)' || kind === '배기량') {
      const n = Number(val);
      if (n >= 800) ccs.add(n);
    } else if (kind === '구동방식') drives.add(val);
  }

  let batStart = 0;
  let bMaker = 0, bModel = 1, bSub = 2, bKwh = 3, bNote = 4;
  if (batGrid.length && hdrIndex(batGrid[0], '제조사') >= 0 && hdrIndex(batGrid[0], '세부모델') >= 0) {
    const hdr = batGrid[0];
    bMaker = hdrIndex(hdr, '제조사');
    bModel = hdrIndex(hdr, '모델');
    bSub = hdrIndex(hdr, '세부모델');
    bKwh = hdrIndex(hdr, '배터리(kWh)', '배터리용량(kWh)', '배터리용량', 'kWh');
    bNote = hdrIndex(hdr, '비고');
    if (bMaker < 0 || bModel < 0 || bSub < 0 || bKwh < 0) {
      throw new Error(`전기차배터리마스터 헤더가 다름: ${hdr.join('|')}`);
    }
    batStart = 1;
  }
  const batteries: BatteryRow[] = batGrid.slice(batStart).map((r) => ({
    maker: S(r[bMaker]), model: S(r[bModel]), sub: S(r[bSub]), kwh: S(r[bKwh]), note: bNote >= 0 ? S(r[bNote]) : '',
  })).filter((r) => r.maker && r.kwh);

  return { names, fuels, ccs, drives, batteries };
}

export function loadEncarWorkBook(): WorkBook {
  const dir = reportsDir();
  const namesJson = JSON.parse(readFileSync(`${dir}/vehicle_name_master.json`, 'utf8')) as { values: string[][] };
  const specJson = JSON.parse(readFileSync(`${dir}/spec_value_master.json`, 'utf8')) as { values: (string | number)[][] };
  const batJson = JSON.parse(readFileSync(`${dir}/ev_battery_master.json`, 'utf8')) as { values: string[][] };
  return workBookFromTabs({
    names: namesJson.values || [],
    specs: specJson.values || [],
    batteries: batJson.values || [],
  });
}

export function fold(v: unknown): string {
  return S(v).toLowerCase()
    .replace(/[-_\s·./]/g, '')
    .replace(/[()[\]（）]/g, '');
}

const MAKER_TO_SHEET: Record<string, string> = {
  르노: '르노코리아', 르노코리아: '르노코리아', 르노삼성: '르노코리아',
  kgm: 'KG모빌리티', kg모빌리티: 'KG모빌리티', 쌍용: 'KG모빌리티',
  쉐보레: '쉐보레', 한국gm: '쉐보레', gm대우: '쉐보레',
};

/** 기아만 N세대 → 개발코드. 시트 세부모델과 같음. */
const KIA_GEN: Record<string, Record<number, string>> = {
  K5: { 1: 'TF', 2: 'JF', 3: 'DL3' },
  K3: { 2: 'BD', 3: 'BC' },
  K7: { 1: 'VG', 2: 'YG' },
  K8: { 1: 'GL3' },
  K9: { 1: 'KH', 2: 'RJ' },
  카니발: { 3: 'YP', 4: 'KA4' },
  쏘렌토: { 3: 'UM', 4: 'MQ4' },
  스포티지: { 4: 'QL', 5: 'NQ5' },
  셀토스: { 1: 'SP2' },
  모닝: { 3: 'JA' },
  레이: { 1: 'TAM' },
  니로: { 1: 'DE', 2: 'SG2' },
  EV6: { 1: 'CV' },
  EV9: { 1: 'MV' },
  EV3: { 1: 'SV' },
};

const GRADE_EN: [string, string][] = [
  ['inspiration', '인스퍼레이션'],
  ['premium', '프리미엄'],
  ['prestige', '프레스티지'],
  ['exclusive', '익스클루시브'],
  ['inscription', '인스크립션'],
  ['calligraphy', '캘리그래피'],
  ['signature', '시그니처'],
  ['noblesse', '노블레스'],
  ['trendy', '트렌디'],
  ['standard', '스탠다드'],
  ['modern', '모던'],
  ['smart', '스마트'],
];

const FUEL_MAP: Record<string, string> = {
  가솔린: '가솔린', 휘발유: '가솔린', gasoline: '가솔린',
  디젤: '디젤', 경유: '디젤', diesel: '디젤',
  lpg: 'LPG', lpi: 'LPG', lpgi: 'LPG', 엘피지: 'LPG',
  하이브리드: '하이브리드', hev: '하이브리드', '가솔린+전기': '하이브리드',
  전기: '전기', ev: '전기',
  수소: '수소', 수소전기: '수소',
};

export type Source = {
  maker: string;
  kind: string;
  carName: string;
  fuel: string;
  cc: string;
  drive: string;
  seats: string;
  year: string;
};

export type Attach = Partial<Record<EncarFillColumn, string>>;

function uniqueLongest(cands: string[], hay: string): string {
  const hits = [...new Set(cands.filter((c) => c && hay.includes(fold(c))))];
  return uniqueLongestHits(hits);
}

function uniqueLongestHits(hits: string[]): string {
  const u = [...new Set(hits.filter(Boolean))];
  if (!u.length) return '';
  u.sort((a, b) => fold(b).length - fold(a).length || b.length - a.length);
  const best = u[0];
  const bf = fold(best);
  for (const h of u) {
    if (h === best) continue;
    const hf = fold(h);
    if (hf === bf) return '';
    if (!bf.includes(hf) && !hf.includes(bf)) return '';
  }
  return best;
}

function expandKia(model: string, text: string): string {
  const table = KIA_GEN[model];
  if (!table) return text;
  return text.replace(/(\d+)\s*세대/g, (_, n) => table[Number(n)] || `${n}세대`);
}

function sheetMaker(raw: string, book: WorkBook): string {
  const disp = canonMakerDisplay(raw) || S(raw);
  const mapped = MAKER_TO_SHEET[fold(disp)] || MAKER_TO_SHEET[fold(raw)] || '';
  if (mapped && book.names.some((r) => r.maker === mapped)) return mapped;
  const exact = book.names.find((r) => r.maker === disp || r.maker === raw)?.maker;
  if (exact) return exact;
  const byDisp = book.names.find((r) => canonMakerDisplay(r.maker) === disp)?.maker;
  return byDisp || '';
}

function peelEngine(text: string): string {
  let s = S(text);
  s = s.replace(/\b(?:2WD|4WD|AWD|FWD|RWD|HTRAC|4MATIC|xDrive|quattro)\b/gi, '');
  s = s.replace(/\d{1,2}\s*인승/g, '');
  const lead = /^(?:(?:가솔린|디젤|하이브리드|플러그인\s*하이브리드|LPG|LPI|전기|수소)\s+)?(?:\d(?:\.\d)?\s*D\b|\d(?:\.\d)?\s*(?:T-?GDI|GDI|터보|T)?|\d{3,4}\s*cc)\s*(?:T-?GDI|GDI|LPG|LPI|가솔린|디젤)?(?:\([^)]+\))?\s*/i;
  let prev = '';
  while (prev !== s) { prev = s; s = s.replace(lead, '').trim(); }
  s = s.replace(/^(?:가솔린|디젤|하이브리드|플러그인\s*하이브리드|LPG|LPI|전기|수소|T-?GDI|GDI|D)\s+/i, '').trim();
  s = s.replace(/[（(]([^）)]*)[）)]/g, (_, inner: string) => {
    const t = String(inner || '').replace(/\+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || /^(?:택시형?|렌터카용?|영업용|장애인용?|수출형|특장업체)$/.test(t) || /^\d{1,2}\s*인승$/.test(t)) return ' ';
    return ` ${t} `;
  }).replace(/[()（）]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:렌터카용?|택시형?|영업용|법인|개인|자가용)\s+/, '').replace(/\s+(?:렌터카용?|택시형?|장애인용?|영업용|특장업체)$/, '').trim();
  if (!s || /^(?:터보|T|LPG|LPI|가솔린|디젤|D|GDI|T-?GDI|e)$/i.test(s) || /^\d(?:\.\d)?$/.test(s)) return '';
  return applyLatinBrandTokens(s);
}

function trimInHay(trim: string, hay: string, hayRaw: string): boolean {
  if (!trim) return false;
  const t = fold(trim);
  if (t.length <= 2) {
    const token = applyLatinBrandTokens(trim).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9가-힣])${token}(?=[^A-Za-z0-9가-힣]|$)`, 'i').test(hayRaw);
  }
  if (t && hay.includes(t)) return true;
  const lat = fold(applyLatinBrandTokens(trim));
  if (lat && hay.includes(lat)) return true;
  for (const [en, ko] of GRADE_EN) {
    if (fold(trim) === fold(ko) && (hay.includes(en) || fold(hayRaw).includes(en))) return true;
  }
  return false;
}

function canonFuel(blob: string, allowed: Set<string>): string {
  const raw = S(blob);
  if (!raw) return '';
  if (/플러그인/.test(raw) || /phev/i.test(raw)) return '';
  const f = fold(raw);
  const hits = new Set<string>();
  for (const [src, dst] of Object.entries(FUEL_MAP)) {
    if (f.includes(fold(src)) && allowed.has(dst)) hits.add(dst);
  }
  if (hits.size === 1) return [...hits][0];
  return '';
}

function litersIn(text: string): number[] {
  const blob = S(text);
  const found: number[] = [];
  for (const m of blob.matchAll(/(?:가솔린|디젤|LPG|lpg|하이브리드)\s*(\d(?:\.\d)?)/gi)) found.push(Number(m[1]));
  if (!found.length) {
    const m = /\b([1-6]\.\d)\b/.exec(blob);
    if (m) found.push(Number(m[1]));
  }
  return [...new Set(found.filter((n) => n >= 0.8 && n < 10))];
}

function ccMatchesLiter(cc: number, liter: number): boolean {
  return Number((cc / 1000).toFixed(1)) === Number(liter.toFixed(1));
}

function canonCc(ccCell: string, carName: string, allowed: Set<number>, fuel: string): string {
  if (fuel === '전기' || fuel === '수소') return '';
  const blob = [S(ccCell), S(carName)].filter(Boolean).join(' ');
  if (!blob) return '';
  const exact = [...new Set([...blob.matchAll(/(\d{3,5})\s*(?:cc)?/gi)].map((m) => Number(m[1])).filter((n) => allowed.has(n)))];
  const liters = litersIn(carName);
  if (liters.length > 1) return '';
  if (liters.length === 1) {
    const ok = exact.filter((n) => ccMatchesLiter(n, liters[0]));
    return ok.length === 1 ? String(ok[0]) : '';
  }
  return exact.length === 1 ? String(exact[0]) : '';
}

function canonDrive(blob: string, allowed: Set<string>): string {
  const s = S(blob);
  if (!s) return '';
  const u = s.toUpperCase();
  const hits = new Set<string>();
  if (/(4MATIC|XDRIVE|QUATTRO|HTRAC|\bAWD\b|\b4WD\b|사륜)/i.test(s) || /\bAWD\b/.test(u) || /\b4WD\b/.test(u)) hits.add('AWD');
  if (/\bRWD\b/.test(u) || /후륜/.test(s)) hits.add('RWD');
  if (/\bFWD\b/.test(u) || /전륜/.test(s) || /\b2WD\b/.test(u)) hits.add('2WD');
  const ok = [...hits].filter((d) => allowed.has(d));
  return ok.length === 1 ? ok[0] : '';
}

function canonSeats(blob: string): string {
  const found = [...S(blob).matchAll(/(\d{1,2})\s*인승/g)].map((m) => Number(m[1])).filter((n) => n >= 2 && n <= 15);
  const u = [...new Set(found)];
  return u.length === 1 ? String(u[0]) : '';
}

function packKwh(book: WorkBook, maker: string, model: string, sub: string, blob: string, fuel: string): string {
  if (fuel && fuel !== '전기') return '';
  const packs = book.batteries.filter((b) => b.maker === maker && b.model === model && b.sub === sub && b.kwh);
  if (!packs.length) return '';
  const hay = fold(blob);
  const byKwh = packs.filter((p) => hay.includes(fold(p.kwh)));
  if (byKwh.length === 1) return byKwh[0].kwh;
  const std = /스탠다드|저용량|standard/.test(hay) || /standard/i.test(blob);
  const lr = /롱레인지|항속|longrange|long range/.test(hay) || /\blr\b/i.test(blob);
  const gt = /\bgt\b|퍼포먼스/.test(hay);
  const noted = packs.filter((p) => {
    const n = fold(p.note);
    if (std && /스탠다드|저용량|기본/.test(n)) return true;
    if (lr && /롱레인지|항속/.test(n)) return true;
    if (gt && /gt|퍼포먼스|n\b/.test(n)) return true;
    return false;
  });
  if (noted.length === 1) return noted[0].kwh;
  if (packs.length === 1) return packs[0].kwh;
  return '';
}

export function attachFromEncarSheet(src: Source, book: WorkBook): Attach {
  const carName = S(src.carName);
  const kind = S(src.kind);
  const left = [kind, carName, S(src.fuel), S(src.cc), S(src.drive), S(src.seats)].filter(Boolean).join(' ');
  const maker = sheetMaker(src.maker, book);
  if (!maker) return {};

  const ofMaker = book.names.filter((r) => r.maker === maker);
  const models = [...new Set(ofMaker.map((r) => r.model))];
  const hayModel = fold([kind, carName].filter(Boolean).join(' '));
  const model = uniqueLongest(models, hayModel);
  if (!model) return { '제조사(정제)': canonMakerDisplay(maker), 원산지: ofMaker[0]?.origin || '' };

  const ofModel = ofMaker.filter((r) => r.model === model);
  const expanded = expandKia(model, carName);
  const haySub = fold([kind, expanded].filter(Boolean).join(' '));
  const subs = [...new Set(ofModel.map((r) => r.sub).filter(Boolean))];
  const sub = uniqueLongest(subs, haySub);

  const origin = ofModel[0]?.origin || '';
  const out: Attach = {
    원산지: origin,
    '제조사(정제)': canonMakerDisplay(maker),
    모델: model,
  };
  if (sub) out['세부모델'] = sub;

  if (sub) {
    const trims = [...new Set(ofModel.filter((r) => r.sub === sub).map((r) => r.trim).filter(Boolean))];
    const hayTrim = fold(expanded);
    const NOT_TRIM = new Set(['d', 'gdi', 'tgdi', 't-gdi', 'e']);
    const hits = trims.filter((t) => {
      if (NOT_TRIM.has(fold(t))) return false;
      return trimInHay(t, hayTrim, expanded);
    });
    const trim = uniqueLongestHits(hits);
    if (trim) out['세부트림'] = applyLatinBrandTokens(trim);
    else if (trims.length === 1 && trims[0] === '기본형') out['세부트림'] = '기본형';
  }

  const fuelBlob = [S(src.fuel), carName].filter(Boolean).join(' ');
  const fuel = canonFuel(fuelBlob, book.fuels);
  if (fuel) out['연료(정제)'] = fuel;

  const cc = canonCc(S(src.cc), carName, book.ccs, fuel);
  if (cc) out['배기량(정제)'] = cc;

  const drive = canonDrive([S(src.drive), carName, kind].join(' '), book.drives);
  if (drive) out['구동방식'] = drive;

  const seats = canonSeats([S(src.seats), carName, kind].join(' '));
  if (seats) out['인승'] = seats;

  if (sub) {
    const kwh = packKwh(book, maker, model, sub, left, fuel);
    if (kwh) out['배터리용량(정제)'] = kwh;
  }

  void peelEngine;
  return out;
}

export function selfCheckEncarMatch(book: WorkBook): string[] {
  const bad: string[] = [];
  const chk = (src: Source, want: Attach, label: string) => {
    const got = attachFromEncarSheet(src, book);
    for (const [k, v] of Object.entries(want) as [EncarFillColumn, string][]) {
      if (S(got[k]) !== v) bad.push(`${label} ${k}: ${JSON.stringify(got[k])} ≠ ${JSON.stringify(v)}`);
    }
    if (want['세부트림'] === undefined && got['세부트림']) bad.push(`${label} 트림을 지어냄 ${got['세부트림']}`);
  };
  chk({ maker: '기아', kind: 'K5', carName: 'K5 3세대 시그니처', fuel: '가솔린', cc: '', drive: '', seats: '', year: '' },
    { 모델: 'K5', 세부모델: 'K5 DL3', 세부트림: '시그니처' }, 'K5 3세대');
  chk({ maker: 'KG모빌리티', kind: '티볼리', carName: '티볼리 아머 VX', fuel: '', cc: '', drive: '', seats: '', year: '' },
    { 모델: '티볼리', 세부모델: '티볼리 아머', 세부트림: 'VX' }, '티볼리 아머');
  chk({ maker: '현대', kind: '캐스퍼', carName: '캐스퍼 터보 스마트', fuel: '가솔린', cc: '', drive: '', seats: '', year: '' },
    { 모델: '캐스퍼', 세부모델: '캐스퍼', 세부트림: '터보 스마트' }, '캐스퍼 터보');
  chk({ maker: '현대', kind: '아이오닉5', carName: '아이오닉5 롱레인지', fuel: '전기', cc: '', drive: '', seats: '', year: '' },
    { 모델: '아이오닉5', 세부모델: '아이오닉5', '배터리용량(정제)': '77.4' }, '아이오닉5 LR');
  chk({ maker: '기아', kind: 'K5', carName: 'K5 시그니처', fuel: '', cc: '', drive: '', seats: '', year: '' },
    { 모델: 'K5' }, 'K5 세대없음');
  const k5bare = attachFromEncarSheet({ maker: '기아', kind: 'K5', carName: 'K5 시그니처', fuel: '', cc: '', drive: '', seats: '', year: '' }, book);
  if (k5bare['세부모델']) bad.push(`K5 세대없이 세부모델 ${k5bare['세부모델']}`);
  const nTrim = attachFromEncarSheet({ maker: '현대', kind: '아반떼', carName: '아반떼 CN7 자가용 가솔린 1.6 법인전용', fuel: '가솔린', cc: '', drive: '', seats: '', year: '' }, book);
  if (nTrim['세부트림'] === 'N') bad.push('CN7 안에서 트림 N');
  if (nTrim['배기량(정제)']) bad.push(`1.6을 cc로 찍음 ${nTrim['배기량(정제)']}`);
  const fakeCc = attachFromEncarSheet({ maker: '현대', kind: '쏘나타', carName: '쏘나타 디 엣지 LPG 2.0 비즈니스', fuel: 'LPG', cc: '999', drive: '', seats: '', year: '' }, book);
  if (fakeCc['배기량(정제)']) bad.push(`차명 2.0인데 배기량 999를 받음 ${fakeCc['배기량(정제)']}`);
  return bad;
}
