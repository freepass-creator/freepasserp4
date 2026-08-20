/**
 * **공급사 재고에 엔카 트림행키만 박는다.** 제원 칸은 원자 수집 시트.
 *
 *   차종트림코드 = T-0001 (모델×세부모델×세부트림이 하나로 모일 때만)
 *   모델 · 세부모델 · 세부트림 — 차명+연식+연료+배기량으로 변환(정제칸이 있으면)
 *   못 정하면 점검사항에 「뭘 적어 달라」를 남긴다. 이미 있는 트림행키는 안 지운다.
 * ★ERP 「차종코드」는 안 건드린다.
 *
 *   npx tsx scripts/stamp-encar-codes-on-supplier.mts
 *   npx tsx scripts/stamp-encar-codes-on-supplier.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonMakerDisplay } from '../lib/domain/maker-display';
import { companyAlias, supplierNameKeys } from '../lib/domain/identity';
import {
  ENCAR_TRIM_CODE_COLUMN,
  REQUEST_COLUMN_NAME,
  SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel,
} from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const nk = (v: unknown) => S(v).toLowerCase().replace(/[\s_\-./·()（）]/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONLY = new Set(arg('who').split(/[,\s]+/).map(S).filter(Boolean));
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;

type Payload = { headers: string[]; values: (string | number)[][] };
const ATOM_PATH = arg('atoms', 'C:\\Users\\admin\\encar-market-survey\\reports\\atom_draft_rows.json');
const atoms = JSON.parse(readFileSync(ATOM_PATH, 'utf8')) as Payload;
const zip = (headers: string[], row: (string | number)[]) => {
  const o: Rec = {};
  headers.forEach((h, i) => { o[h] = row[i]; });
  return o;
};

const fuelKey = (v: unknown) => {
  const s = nk(v);
  if (!s) return '';
  if (/전기|ev|electric/.test(s) && !/하이브리드|hev|hybrid/.test(s)) return '전기';
  if (/수소|fcev/.test(s)) return '수소';
  if (/하이브리드|hev|hybrid|가솔린전기|디젤전기/.test(s)) return '하이브리드';
  if (/lpg|lpi/.test(s)) return 'lpg';
  if (/디젤|경유|diesel/.test(s)) return '디젤';
  if (/가솔린|휘발유|gasoline|petrol/.test(s)) return '가솔린';
  return s;
};
const ccNum = (v: unknown) => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;
const makerKey = (v: unknown) => nk(canonMakerDisplay(v) || v);
const driveKey = (v: unknown) => {
  const s = nk(v);
  if (/awd|4wd|4matic|xdrive|사륜|네바퀴/.test(s)) return 'awd';
  if (/2wd|전륜|후륜/.test(s)) return '2wd';
  return '';
};
const agree = (xs: (string | number)[]) => {
  const u = [...new Set(xs.map((x) => S(x)).filter(Boolean))];
  return u.length === 1 ? u[0] : '';
};

type Atom = {
  u: string; t: string; modelName: string; subName: string; trimName: string;
  maker: string; model: string; sub: string; trim: string; fuel: string; cc: number; seats: number; drive: string;
  yearStart: number; yearEnd: number; codes: string[]; turbo: boolean; segment: string; body: string;
};
const WEAK_TOK = new Set(['더', '뉴', '올', '디', 'the', 'new', 'all', '더뉴', '올뉴', '페이스리프트', 'fl', '런칭', '자가용', '렌터카', '렌트']);
const CC_TOKS = new Set(['10', '12', '15', '16', '18', '20', '22', '24', '25', '27', '30', '33', '35', '38', '40', '50']);
const genCodes = (subName: string) =>
  [...nk(subName).matchAll(/[a-z]{1,3}\d{1,2}|\d[a-z]{2,3}/g)].map((m) => m[0]).filter((c) => c.length >= 2 && c.length <= 5);
const ATOM_ROWS: Atom[] = atoms.values.map((r) => {
  const o = zip(atoms.headers, r);
  const subName = S(o['세부모델']);
  return {
    u: S(o['원자ID']),
    t: S(o['트림행키']),
    modelName: S(o['1차모델']),
    subName,
    trimName: S(o['세부트림']),
    maker: makerKey(o['제조사']),
    model: nk(o['1차모델']),
    sub: nk(subName),
    trim: nk(o['세부트림']),
    fuel: fuelKey(o['연료']),
    cc: ccNum(o['정확배기량(cc)']),
    seats: Number(o['인승']) || 0,
    drive: driveKey(o['구동방식']) || nk(o['구동방식']),
    yearStart: Number(String(o['연식시작']).match(/(20\d{2})/)?.[1] || 0) || 0,
    yearEnd: Number(String(o['연식종료']).match(/(20\d{2})/)?.[1] || 0) || 0,
    codes: genCodes(subName),
    turbo: S(o['터보']) === '예' || /터보/.test(S(o['세부트림'])),
    segment: S(o['차종크기']),
    body: S(o['차종구분']),
  };
}).filter((a) => a.u && a.t);

const MODELS_BY_MAKER = new Map<string, string[]>();
for (const a of ATOM_ROWS) {
  const list = MODELS_BY_MAKER.get(a.maker) || [];
  if (a.model && !list.includes(a.model)) list.push(a.model);
  MODELS_BY_MAKER.set(a.maker, list);
}
for (const list of MODELS_BY_MAKER.values()) list.sort((a, b) => b.length - a.length);
const inferModel = (maker: string, nameHay: string) =>
  (MODELS_BY_MAKER.get(maker) || []).find((m) => m.length >= 2 && nameHay.includes(m)) || '';

const TRIM_NOTE = '▶트림:';
const stripTrimNote = (v: string) => S(v).replace(new RegExp(`\\s*${TRIM_NOTE}[^|]*`, 'g'), '').replace(/^\s*\|\s*|\s*\|\s*$/g, '').replace(/\s*\|\s*\|\s*/g, ' | ').trim();
const mergeTrimNote = (existing: string, note: string) => {
  const other = stripTrimNote(existing);
  if (!note) return other;
  const tagged = note.startsWith(TRIM_NOTE) ? note : `${TRIM_NOTE} ${note}`;
  return other ? `${other} | ${tagged}` : tagged;
};
const uniq = (xs: string[]) => [...new Set(xs.map(S).filter(Boolean))];
const listed = (xs: string[], n = 6) => {
  const u = uniq(xs);
  return u.slice(0, n).join(' / ') + (u.length > n ? ` 외 ${u.length - n}` : '');
};

const TRIM_ALIAS: Record<string, string> = {
  premium: '프리미엄', exclusive: '익스클루시브', prestige: '프레스티지', signature: '시그니처',
  inspiration: '인스퍼레이션', trendy: '트렌디', modern: '모던', smart: '스마트',
  leblanc: '르브랑', nobless: '노블레스', gravity: '그래비티',
  비즈니스: '모빌리티', 비지니스: '모빌리티', business: '모빌리티',
};
const hay = (v: unknown) => nk(v);
const hasTok = (h: string, tok: string) => {
  const t = nk(tok);
  if (!t) return false;
  if (h.includes(t)) return true;
  if (TRIM_ALIAS[t] && h.includes(nk(TRIM_ALIAS[t]))) return true;
  for (const [en, ko] of Object.entries(TRIM_ALIAS)) {
    if (nk(ko) === t && h.includes(en)) return true;
  }
  return false;
};
const turboIn = (h: string) => /[0-9]t|터보|turbo/.test(h);
const trimParts = (trim: string) =>
  trim.split(/[\s+/]+/).map(nk).filter((t) => t && !WEAK_TOK.has(t) && !CC_TOKS.has(t) && !/^\d+$/.test(t) && t.length >= 2);
const trimInName = (h: string, trim: string) => {
  if (!trim) return false;
  if (hasTok(h, trim)) return true;
  const parts = trimParts(trim);
  if (!parts.length) return false;
  return parts.every((p) => hasTok(h, p) || (p === '터보' && turboIn(h)));
};
const injectGen = (nameHay: string, carName: string, model: string) => {
  let h = nameHay;
  const blob = `${model}${nk(carName)}`;
  if (/카니발/.test(blob) && /4세대/.test(carName)) h += 'ka4';
  if (/k5/.test(blob) && /3세대/.test(carName)) h += 'dl3';
  if (/쏘렌토/.test(blob) && /4세대/.test(carName)) h += 'mq4';
  if (/아반떼/.test(blob) && /cn7/.test(nk(carName))) h += 'cn7';
  return h;
};
const litersCc = (text: string) => {
  const m = text.match(/(\d+\.\d)/);
  if (!m) return 0;
  const n = Number(m[1]);
  return n >= 0.6 && n <= 8 ? Math.round(n * 1000) : 0;
};
const yearOf = (연식: string, 등록: string, name: string) => {
  const my = name.match(/(\d{2})\s*my/i);
  if (my) return 2000 + Number(my[1]);
  const from = (v: string) => {
    const m4 = String(v).match(/(20\d{2})/);
    if (m4) return Number(m4[1]);
    const m2 = String(v).match(/^(\d{2})$/);
    if (m2) {
      const n = Number(m2[1]);
      if (n >= 16 && n <= 30) return 2000 + n;
    }
    return 0;
  };
  return from(연식) || from(등록) || 0;
};
const inYear = (a: Atom, y: number) => {
  if (!y) return true;
  if (!a.yearStart && !a.yearEnd) return true;
  const lo = a.yearStart || 1990;
  const hi = a.yearEnd || 2099;
  return y >= lo && y <= hi;
};
const keepIf = (hit: Atom[], pred: (a: Atom) => boolean) => {
  const next = hit.filter(pred);
  return next.length ? next : hit;
};

type Ctx = { maker: string; model: string; nameHay: string; trimHay: string; fuel: string; cc: number; seats: number; drive: string; year: number };

/** 연식·연료·배기량·차명으로 후보를 줄인다. 이름 토큰만 맞추던 방식은 세대를 놓친다. */
const narrowAtoms = (ctx: Ctx): Atom[] => {
  if (!ctx.maker) return [];
  let hit = ATOM_ROWS.filter((a) => a.maker === ctx.maker);
  if (ctx.model) {
    const byModel = hit.filter((a) => a.model === ctx.model || ctx.nameHay.includes(a.model));
    if (byModel.length) hit = byModel;
  }
  if (!hit.length) return [];
  if (ctx.year) hit = keepIf(hit, (a) => inYear(a, ctx.year));
  if (ctx.fuel === '하이브리드' || ctx.fuel === '전기') {
    hit = keepIf(hit, (a) => a.fuel === ctx.fuel || a.sub.includes(ctx.fuel === '전기' ? '일렉트릭' : '하이브리드'));
  } else if (ctx.fuel) {
    hit = keepIf(hit, (a) => a.fuel === ctx.fuel);
    hit = keepIf(hit, (a) => !/하이브리드|일렉트릭/.test(a.sub));
  }
  if (ctx.cc > 300) hit = keepIf(hit, (a) => !!a.cc && Math.abs(a.cc - ctx.cc) / Math.max(ctx.cc, a.cc) <= 0.08);
  if (ctx.seats) hit = keepIf(hit, (a) => !a.seats || a.seats === ctx.seats);
  if (ctx.drive) hit = keepIf(hit, (a) => !a.drive || a.drive === ctx.drive);
  if (turboIn(ctx.nameHay)) hit = keepIf(hit, (a) => a.turbo || /터보/.test(a.trimName));
  const codeHit = hit.filter((a) => a.codes.some((c) => ctx.nameHay.includes(c)));
  if (codeHit.length) hit = codeHit;
  const hasNew = /더뉴|올뉴|디올뉴/.test(ctx.nameHay);
  const hasFl = /페이스|igfl|fl자가용|fl\b/.test(ctx.nameHay);
  const hasLaunch = /런칭/.test(ctx.nameHay);
  if (hasNew || hasFl) hit = keepIf(hit, (a) => /더\s*뉴|올\s*뉴|페이스/.test(a.subName));
  else if (hasLaunch) hit = keepIf(hit, (a) => !/더\s*뉴|올\s*뉴/.test(a.subName));
  const newer = hit.filter((a) => /더\s*뉴|올\s*뉴/.test(a.subName));
  const older = hit.filter((a) => !/더\s*뉴|올\s*뉴/.test(a.subName));
  if (ctx.year && newer.length && older.length) {
    const newStart = Math.min(...newer.map((a) => a.yearStart || 9999));
    hit = ctx.year >= newStart ? newer : older;
  }
  const namedSub = hit.filter((a) => {
    const toks = a.subName.split(/\s+/).map(nk).filter((t) => t && !WEAK_TOK.has(t) && t !== a.model);
    return toks.length ? toks.every((t) => hasTok(ctx.nameHay, t) || a.codes.includes(t)) : ctx.nameHay.includes(a.sub);
  });
  if (namedSub.length) {
    const contained = namedSub.filter((a) => a.sub.length > a.model.length && ctx.nameHay.includes(a.sub));
    const pool = contained.length ? contained : namedSub;
    const max = Math.max(...pool.map((a) => a.sub.length));
    hit = pool.filter((a) => a.sub.length === max);
  }
  const trimHay = ctx.trimHay || ctx.nameHay;
  const namedTrim = hit.filter((a) => trimInName(trimHay, a.trimName));
  if (namedTrim.length) {
    const n = (a: Atom) => trimParts(a.trimName).length;
    const max = Math.max(...namedTrim.map(n));
    hit = namedTrim.filter((a) => n(a) === max);
  }
  return hit;
};

const inspectNote = (ctx: Ctx, hit: Atom[], carName: string, makerDisp: string): string => {
  if (!ctx.maker) return `${TRIM_NOTE} 제조사를 적어 주세요 (현대 · 기아 · 제네시스 · 르노 · KGM …).`;
  if (!ATOM_ROWS.some((a) => a.maker === ctx.maker)) {
    return `${TRIM_NOTE} 차명에 모델·트림을 정확히 적어 주세요. 예: E200 Avantgarde · 520i Luxury · Cooper Classic`;
  }
  if (!S(carName)) return `${TRIM_NOTE} 차명(세부모델+트림)을 모델·세대·트림까지 적어 주세요. 예: 더 뉴 그랜저 GN7 캘리그래피`;
  if (!hit.length) {
    const bits = ['차명에 모델·세대·트림을 정확히 적어 주세요'];
    if (!ctx.year) bits.push('연식(네 자리, 예: 2022)');
    if (!ctx.fuel) bits.push('연료(가솔린·디젤·하이브리드·전기)');
    return `${TRIM_NOTE} ${bits.join(' · ')}.`;
  }
  const models = uniq(hit.map((a) => a.modelName));
  const subs = uniq(hit.map((a) => a.subName));
  const trims = uniq(hit.map((a) => a.trimName));
  if (models.length > 1) return `${TRIM_NOTE} 모델명을 구분해 주세요. 후보: ${listed(models)}`;
  if (subs.length > 1) return `${TRIM_NOTE} 차명에 세대를 구분해 주세요. 후보: ${listed(subs, 5)}`;
  if (trims.length > 1) return `${TRIM_NOTE} 차명에 트림을 적어 주세요. 후보: ${listed(trims)}`;
  const missing: string[] = [];
  if (!ctx.year) missing.push('연식(네 자리, 예: 2022)');
  if (!ctx.fuel) missing.push('연료(가솔린·디젤·하이브리드·전기)');
  return `${TRIM_NOTE} 트림을 특정할 수 없습니다.${missing.length ? ` ${missing.join(' · ')}도 적어 주세요.` : ' 차명·연식·연료를 다시 확인해 주세요.'}`;
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const pick = (row: string[], at: Map<string, number>, names: string[]) => {
  for (const n of names) {
    const i = at.get(n);
    if (i === undefined) continue;
    const v = S(row[i]);
    if (v) return v;
  }
  return '';
};
const put = (updates: { range: string; values: string[][] }[], title: string, at: Map<string, number>, name: string, row: number, val: string, now: string, counts: { set: number; skip: number }) => {
  const i = at.get(name) ?? -1;
  if (i < 0) return;
  if (now === val) { if (now) counts.skip++; return; }
  updates.push({ range: `${a1Tab(title)}!${colA1(i)}${row}`, values: [[val]] });
  counts.set++;
};

if (!ATOM_ROWS.length) throw new Error('atom JSON에 트림행키가 없다 — 먼저 트림행키를 붙여야 한다');

const targets: { id: string; name: string }[] = [];
{
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) {
    const name = S(f.name);
    if (/\[구버전[·・]?폐기\]/.test(name)) continue;
    const who = companyAlias(supplierSheetLabel(name)) || supplierSheetLabel(name);
    if (ONLY.size && ![...supplierNameKeys(who)].some((k) => ONLY.has(k))) continue;
    targets.push({ id: S(f.id), name: who });
  }
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
console.log(`■ 엔카 코드 심기 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳 · 원자 ${ATOM_ROWS.length} · 트림행키 ${new Set(ATOM_ROWS.map((a) => a.t)).size}`);

let totCars = 0, totT = 0, totKeep = 0, totFill = 0, totNoT = 0, totNote = 0, totSkip = 0, totNoCol = 0;
const samples: string[] = [];
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden)`);
  const titles = ((meta.sheets || []) as Rec[])
    .map((s) => s.properties)
    .filter((p) => p && !p.hidden && S(p.title) && !isOurNonInventoryTab(p.title))
    .map((p) => S(p.title));
  if (!titles.length) continue;
  const qs = titles.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&');
  let got: Rec;
  try { got = await call(`${SH}/${t.id}/values:batchGet?${qs}&majorDimension=ROWS`); }
  catch (e) { console.log(`  ✗ ${t.name} — ${(e as Error).message.slice(0, 80)}`); continue; }

  const updates: { range: string; values: string[][] }[] = [];
  let cars = 0, tSet = 0, keep = 0, fill = 0, noT = 0, notes = 0, noCol = 0;
  const counts = { set: 0, skip: 0 };
  ((got.valueRanges || []) as Rec[]).forEach((vr, ti) => {
    const title = titles[ti];
    const grid = ((vr.values || []) as string[][]);
    if (grid.length < 2) return;
    const hRow = grid.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (hRow < 0) return;
    const hdr = (grid[hRow] || []).map(S);
    const at = new Map<string, number>();
    hdr.forEach((h, i) => { if (h && !at.has(h)) at.set(h, i); });
    if ((at.get(ENCAR_TRIM_CODE_COLUMN) ?? -1) < 0) { noCol++; return; }
    const plateAt = at.get('차량번호') ?? -1;
    const checkName = at.has(REQUEST_COLUMN_NAME) ? REQUEST_COLUMN_NAME : at.has('요청사항') ? '요청사항' : '';
    const checkAt = checkName ? (at.get(checkName) ?? -1) : -1;
    if (plateAt < 0) return;
    for (let r = hRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      if (!S(row[plateAt])) continue;
      cars++;
      const nowTraw = S(row[at.get(ENCAR_TRIM_CODE_COLUMN) ?? -1]);
      const nowT = /^T-\d+$/.test(nowTraw) && ATOM_ROWS.some((a) => a.t === nowTraw) ? nowTraw : '';
      const nowCheck = checkAt >= 0 ? S(row[checkAt]) : '';
      const makerDisp = pick(row, at, ['제조사']) || pick(row, at, ['제조사(정제)']);
      const maker = makerKey(makerDisp);
      let model = nk(pick(row, at, ['모델명'])) || nk(pick(row, at, ['모델']));
      const carName = pick(row, at, ['차명(세부모델+트림)']);
      const opt = pick(row, at, ['옵션']);
      let trimHay = injectGen(hay(`${model} ${carName}`), carName, model);
      let nameHay = trimHay + nk(opt);
      if (!model && maker) {
        model = inferModel(maker, nameHay);
        if (model) {
          trimHay = injectGen(hay(`${model} ${carName}`), carName, model);
          nameHay = trimHay + nk(opt);
        }
      }
      const fuel = fuelKey(`${pick(row, at, ['연료'])} ${pick(row, at, ['연료(정제)'])} ${carName}`);
      const cc = ccNum(pick(row, at, ['배기량(정제)'])) || ccNum(pick(row, at, ['배기량'])) || litersCc(carName) || litersCc(pick(row, at, ['연료']));
      const seats = Number((carName.match(/(\d+)\s*인승/) || [])[1] || 0);
      const drive = driveKey(`${carName} ${opt}`);
      const year = yearOf(pick(row, at, ['연식']), pick(row, at, ['최초등록일']), carName);
      const ctx: Ctx = { maker, model, nameHay, trimHay, fuel, cc, seats, drive, year };
      let hit = maker && (nameHay || year || fuel) ? narrowAtoms(ctx) : [];
      const modelHint = pick(row, at, ['모델']);
      const subHint = pick(row, at, ['세부모델']);
      const trimHint = pick(row, at, ['세부트림']);
      if (modelHint) hit = keepIf(hit, (a) => a.modelName === modelHint || a.model === nk(modelHint));
      if (subHint) hit = keepIf(hit, (a) => a.subName === subHint || a.sub === nk(subHint));
      if (trimHint) hit = keepIf(hit, (a) => a.trimName === trimHint || a.trim === nk(trimHint) || trimInName(hay(trimHint), a.trimName));
      let tCode = '';
      if (nowT && ATOM_ROWS.some((a) => a.t === nowT)) {
        tCode = nowT;
        hit = ATOM_ROWS.filter((a) => a.t === nowT);
        keep++;
      } else {
        const tCodes = [...new Set(hit.map((a) => a.t))];
        tCode = tCodes.length === 1 ? tCodes[0] : '';
        if (tCode) fill++;
      }
      const ofTrim = tCode ? hit.filter((a) => a.t === tCode) : hit;
      const modelName = tCode ? (agree(ofTrim.map((a) => a.modelName)) || agree(hit.map((a) => a.modelName))) : agree(hit.map((a) => a.modelName));
      const subName = tCode ? (agree(ofTrim.map((a) => a.subName)) || agree(hit.map((a) => a.subName))) : agree(hit.map((a) => a.subName));
      const trimName = tCode ? (ofTrim[0]?.trimName || '') : agree(hit.map((a) => a.trimName));
      if (tCode) {
        tSet++;
        put(updates, title, at, ENCAR_TRIM_CODE_COLUMN, r + 1, tCode, nowTraw, counts);
        put(updates, title, at, '모델', r + 1, modelName, S(row[at.get('모델') ?? -1]), counts);
        put(updates, title, at, '세부모델', r + 1, subName, S(row[at.get('세부모델') ?? -1]), counts);
        put(updates, title, at, '세부트림', r + 1, trimName, S(row[at.get('세부트림') ?? -1]), counts);
        if (checkName && nowCheck.includes(TRIM_NOTE)) {
          put(updates, title, at, checkName, r + 1, mergeTrimNote(nowCheck, ''), nowCheck, counts);
        }
      } else {
        noT++;
        const note = inspectNote(ctx, hit, carName, makerDisp);
        if (note && checkName) {
          put(updates, title, at, checkName, r + 1, mergeTrimNote(nowCheck, note), nowCheck, counts);
          notes++;
        }
        if (note && samples.length < 40) samples.push(`${t.name} ${S(row[plateAt])} 「${carName.slice(0, 36)}」 ${note}`);
      }
    }
  });
  totCars += cars; totT += tSet; totKeep += keep; totFill += fill; totNoT += noT; totNote += notes; totSkip += counts.skip; totNoCol += noCol;
  console.log(`  ${t.name.padEnd(12)} ${String(cars).padStart(4)}대  T ${tSet}(유지 ${keep}·채움 ${fill})  못정함 ${noT}  점검사항 ${notes}${noCol ? '  열없음' : ''}`);
  if (APPLY && updates.length) {
    for (let i = 0; i < updates.length; i += 400) {
      await call(`${SH}/${t.id}/values:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data: updates.slice(i, i + 400) }),
      });
      await sleep(400);
    }
  }
  await sleep(400);
}
console.log(`\n  ${totCars}대 · 트림행키 ${totT}(유지 ${totKeep}·채움 ${totFill}) · 못정함 ${totNoT} · 점검사항 ${totNote}${totNoCol ? ` · 열없는탭 ${totNoCol}` : ''}`);
if (samples.length) {
  console.log('  못 채운 예:');
  for (const s of samples.slice(0, 25)) console.log(`    ${s}`);
}
console.log(APPLY ? '  반영 완료\n' : '※ dry-run. 반영은 --apply\n');
