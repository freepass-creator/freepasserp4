/**
 * **공급사 재고에 엔카 트림행키만 박는다.** 제원 칸은 원자 수집 시트.
 *
 *   차종트림코드 = T-0001 (모델×세부모델×세부트림이 하나로 모일 때만)
 *   모델 · 세부모델 · 세부트림 — 차명+연식+연료+배기량으로 변환(정제칸이 있으면)
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

const TRIM_ALIAS: Record<string, string> = {
  premium: '프리미엄', exclusive: '익스클루시브', prestige: '프레스티지', signature: '시그니처',
  inspiration: '인스퍼레이션', trendy: '트렌디', modern: '모던', smart: '스마트',
  leblanc: '르브랑', nobless: '노블레스', gravity: '그래비티',
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

type Ctx = { maker: string; model: string; nameHay: string; fuel: string; cc: number; seats: number; drive: string; year: number };

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
  if (namedSub.length) hit = namedSub;
  const namedTrim = hit.filter((a) => trimInName(ctx.nameHay, a.trimName));
  if (namedTrim.length) {
    const n = (a: Atom) => trimParts(a.trimName).length;
    const max = Math.max(...namedTrim.map(n));
    hit = namedTrim.filter((a) => n(a) === max);
  }
  return hit;
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

let totCars = 0, totT = 0, totNoT = 0, totSkip = 0, totNoCol = 0;
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
  let cars = 0, tSet = 0, noT = 0, skip = 0, noCol = 0;
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
    if (plateAt < 0) return;
    for (let r = hRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      if (!S(row[plateAt])) continue;
      cars++;
      const maker = makerKey(pick(row, at, ['제조사']));
      const model = nk(pick(row, at, ['모델명']));
      const carName = pick(row, at, ['차명(세부모델+트림)']);
      const nameHay = injectGen(hay(`${model} ${carName} ${pick(row, at, ['옵션'])}`), carName, model);
      const fuel = fuelKey(`${pick(row, at, ['연료'])} ${carName}`);
      const cc = ccNum(pick(row, at, ['배기량'])) || litersCc(carName) || litersCc(pick(row, at, ['연료']));
      const seats = Number((carName.match(/(\d+)\s*인승/) || [])[1] || 0);
      const drive = driveKey(`${carName} ${pick(row, at, ['옵션'])}`);
      const year = yearOf(pick(row, at, ['연식']), pick(row, at, ['최초등록일']), carName);
      const ctx = { maker, model, nameHay, fuel, cc, seats, drive, year };
      const hit = maker && (nameHay || year || fuel) ? narrowAtoms(ctx) : [];
      const tCodes = [...new Set(hit.map((a) => a.t))];
      const tCode = tCodes.length === 1 ? tCodes[0] : '';
      const ofTrim = tCode ? hit.filter((a) => a.t === tCode) : hit;
      const modelName = agree(hit.map((a) => a.modelName));
      const subName = agree(hit.map((a) => a.subName));
      const trimName = tCode ? (ofTrim[0]?.trimName || '') : agree(hit.map((a) => a.trimName));
      if (!tCode) noT++;
      if (ONLY.size && cars <= 8) {
        console.log(`     ${tCode || '-'} ${subName || modelName || ''} ${trimName} 「${carName.slice(0, 42)}」`);
      }
      put(updates, title, at, ENCAR_TRIM_CODE_COLUMN, r + 1, tCode, S(row[at.get(ENCAR_TRIM_CODE_COLUMN) ?? -1]), counts);
      put(updates, title, at, '모델', r + 1, modelName, S(row[at.get('모델') ?? -1]), counts);
      put(updates, title, at, '세부모델', r + 1, subName, S(row[at.get('세부모델') ?? -1]), counts);
      put(updates, title, at, '세부트림', r + 1, trimName, S(row[at.get('세부트림') ?? -1]), counts);
      if (tCode) tSet++;
    }
  });
  skip = counts.skip;
  totCars += cars; totT += tSet; totNoT += noT; totSkip += skip; totNoCol += noCol;
  console.log(`  ${t.name.padEnd(12)} ${String(cars).padStart(4)}대  T ${tSet}  트림못정함 ${noT}${noCol ? '  열없음' : ''}`);
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
console.log(`\n  ${totCars}대 · 트림행키 ${totT} · 트림못정함 ${totNoT}${totNoCol ? ` · 열없는탭 ${totNoCol}` : ''}`);
console.log(APPLY ? '  반영 완료\n' : '※ dry-run. 반영은 --apply\n');
