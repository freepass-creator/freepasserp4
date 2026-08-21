/**
 * **공급사 재고에 엔카 행키를 아는 층까지 박는다.** 제원 칸은 원자 수집 시트.
 *
 *   사전 = 엔카 차종마스터 시트(연동). `--atoms=` 가 있으면 그 JSON.
 *   모델행키     = M-0001  (제조사×1차모델이 하나로 모일 때)
 *   세부모델행키 = SM-0001 (세대까지 하나로 모일 때)
 *   세부트림행키 = T-0001  (트림까지 하나로 모일 때)
 *   못 정하면 점검사항에 「다음 층」을 남긴다. 이미 있는 코드는 안 지운다.
 * ⚠ 모델·세부모델·세부트림·연료·배기량 글자는 **안 쓴다** — fill(우리 차종마스터) 몫.
 *   엔카에 가솔린 A6가 없다고 A6 e-트론 이름을 박지 않는다. 행키만, 이름과 맞을 때만.
 * ★T 가 박혀도 배기량·구동은 T×제원(U) 갈래가 남을 수 있다.
 *   그때는 차명·왼쪽 칸의 1.6·2WD·연료로 U 를 좁힌 뒤, 하나로 모이면 채운다.
 *   정확 cc 가 1591/1598처럼 갈려도 표시배기량(1.6)이 같으면 1.6 을 넣는다.
 * ★시작 때 assertEncarSpecFillGuards — 1.6→16cc · T확정 후 제원 미채움 재발이면 시트를 안 쓴다.
 * ★ERP 「차종코드」는 안 건드린다.
 *
 *   npx tsx scripts/stamp-encar-codes-on-supplier.mts
 *   npx tsx scripts/stamp-encar-codes-on-supplier.mts --apply
 *   npx tsx scripts/check-encar-spec-fill.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { companyAlias, supplierNameKeys } from '../lib/domain/identity';
import {
  assertEncarSpecFillGuards,
  atomConflictsName,
  driveKey,
  fuelFromVehicle,
  keepIf,
  inYear,
  leftoverConflicts,
  nk,
  ordinalGen,
  parseCc,
  S,
  turboIn,
} from '../lib/domain/encar-spec-fill';
import {
  ENCAR_MODEL_KEY_COLUMN,
  ENCAR_OLD_TRIM_CODE_COLUMN,
  ENCAR_SUB_KEY_COLUMN,
  ENCAR_TRIM_KEY_COLUMN,
  REQUEST_COLUMN_NAME,
  SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel,
} from '../lib/domain/supplier-template-sheet';
import { loadEncarMasterPayload } from '../lib/domain/encar-master-sheet';
import { assertStampColumnAllowed } from '../lib/domain/vehicle-master-lock';

type Rec = Record<string, any>;
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONLY = new Set(arg('who').split(/[,\s]+/).map(S).filter(Boolean));
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;

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

type Payload = { headers: string[]; values: (string | number)[][] };
const ATOM_PATH = arg('atoms');
const atoms: Payload = ATOM_PATH
  ? JSON.parse(readFileSync(ATOM_PATH, 'utf8')) as Payload
  : await loadEncarMasterPayload(call as (u: string) => Promise<Record<string, unknown>>);
const zip = (headers: string[], row: (string | number)[]) => {
  const o: Rec = {};
  headers.forEach((h, i) => { o[h] = row[i]; });
  return o;
};

const ccNum = (v: unknown) => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;
const makerKey = (v: unknown) => nk(canonMakerDisplay(v) || v);
const agree = (xs: (string | number)[]) => {
  const u = [...new Set(xs.map((x) => S(x)).filter(Boolean))];
  return u.length === 1 ? u[0] : '';
};

type Atom = {
  u: string; m: string; sm: string; t: string; modelName: string; subName: string; trimName: string; encarSub: string; encarTrim: string;
  maker: string; makerName: string; origin: string; model: string; sub: string; trim: string; fuel: string; fuelName: string;
  cc: number; liters: number; seats: number; drive: string; driveName: string;
  yearStart: number; yearEnd: number; codes: string[]; turbo: boolean; segment: string; body: string;
};
const WEAK_TOK = new Set(['더', '뉴', '올', '디', 'the', 'new', 'all', '더뉴', '올뉴', '페이스리프트', 'fl', '런칭', '자가용', '렌터카', '렌트', 'pack', 'edition', 'special', '스페셜', '에디션', '스페셜에디션']);
const CC_TOKS = new Set(['10', '12', '15', '16', '18', '20', '22', '24', '25', '27', '30', '33', '35', '38', '40', '50']);
const genCodes = (subName: string) =>
  [...nk(subName).matchAll(/[a-z]{1,3}\d{1,2}|\d[a-z]{2,3}/g)].map((m) => m[0]).filter((c) => c.length >= 2 && c.length <= 5);
const ATOM_ROWS: Atom[] = atoms.values.map((r) => {
  const o = zip(atoms.headers, r);
  const subName = S(o['세부모델']);
  const encarTrim = S(o['엔카트림']) || S(o['세부트림']);
  const cc = ccNum(o['정확배기량(cc)']);
  const litersRaw = Number(o['표시배기량(L)']) || 0;
  return {
    u: S(o['원자ID']),
    m: S(o['모델행키']),
    sm: S(o['세부모델행키']),
    t: S(o['세부트림행키']) || S(o['트림행키']),
    modelName: S(o['1차모델']),
    subName,
    trimName: S(o['세부트림']),
    encarSub: S(o['엔카세부모델']),
    encarTrim,
    maker: makerKey(o['제조사']),
    makerName: S(o['제조사']),
    origin: S(o['원산지']),
    model: nk(o['1차모델']),
    sub: nk(subName),
    trim: nk(o['세부트림']),
    fuel: fuelKey(o['연료']),
    fuelName: S(o['연료']),
    cc,
    liters: litersRaw || (cc ? Math.round(cc / 100) / 10 : 0),
    seats: Number(o['인승']) || 0,
    drive: driveKey(o['구동방식']) || nk(o['구동방식']),
    driveName: S(o['구동방식']),
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
const inferModel = (maker: string, nameHay: string) => {
  const hints: [RegExp, string][] =
    maker === '벤츠' ? [
      [/(s클래스|s-클래스|maybach|\bs\d{3})/, 's클래스'],
      [/(e클래스|e-클래스|w214|w213|w212|\be\d{3})/, 'e클래스'],
      [/(c클래스|c-클래스|w206|w205|\bc\d{3})/, 'c클래스'],
      [/(a클래스|a-클래스|w177|\ba\d{2})/, 'a클래스'],
    ] : maker === 'bmw' ? [
      [/\bx5/, 'x5'], [/\bx3/, 'x3'], [/\bx1/, 'x1'], [/\bx4/, 'x4'], [/\bx6/, 'x6'], [/\bx7/, 'x7'],
      [/(5시리즈|5\d{2}i)/, '5시리즈'],
      [/(3시리즈|3\d{2}i)/, '3시리즈'],
      [/(2시리즈|2시리즈그란쿠페|2\d{2})/, '2시리즈'],
      [/(1시리즈|1\d{2}i)/, '1시리즈'],
    ] : [];
  for (const [re, want] of hints) {
    if (!re.test(nameHay)) continue;
    return (MODELS_BY_MAKER.get(maker) || []).find((m) => m === want) || want;
  }
  return (MODELS_BY_MAKER.get(maker) || []).find((m) => m.length >= 2 && nameHay.includes(m)) || '';
};

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
  calligraphy: '캘리그래피', calligrap: '캘리그래피',
  longrange: '롱레인지', singlemotor: '싱글모터', dualmotor: '듀얼모터',
  classic: '클래식',
  xline: 'x라인', sport: '스포츠', avantgarde: '아방가르드', advantage: '어드밴티지',
  hev: '하이브리드', phev: '플러그인하이브리드', trend: '트렌디', 트렌드: '트렌디',
  iconic: '아이코닉', icon: '아이코닉',
};
const hay = (v: unknown) => nk(String(v ?? '').replace(/비지니스/g, '비즈니스'));
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
const trimParts = (trim: string) =>
  trim.split(/[\s+/]+/).map(nk).filter((t) => t && !WEAK_TOK.has(t) && !CC_TOKS.has(t) && !/^\d+$/.test(t) && t.length >= 2);
const trimInName = (h: string, trim: string) => {
  if (!trim) return false;
  const full = nk(trim);
  if (full && h.includes(full)) return true;
  if (/\d/.test(full)) return false;
  const parts = trimParts(trim);
  if (!parts.length) return false;
  return parts.every((p) => hasTok(h, p) || (p === '터보' && turboIn(h)));
};
/**
 * 원자 내부 이름과 엔카 표기가 다를 수 있다.
 *
 * ⚠ 후보를 고를 때는 «실제로 차명에서 맞은 별칭»만 점수화한다. 두 이름 중 더 긴
 * 쪽을 무조건 쓰면, 차명에는 없는 긴 별칭이 다른 T-코드를 부당하게 이길 수 있다.
 */
type AliasHit = { name: string; score: number; contained: boolean };
const aliasHits = (h: string, names: string[], model = ''): AliasHit[] => {
  const seen = new Set<string>();
  const out: AliasHit[] = [];
  for (const raw of names.map(S)) {
    const name = nk(raw);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const toks = raw.split(/\s+/).map(nk).filter((t) => t && !WEAK_TOK.has(t) && t !== model);
    const matched = h.includes(name) || (toks.length > 0 && toks.every((t) => hasTok(h, t)));
    if (matched) out.push({ name, score: name.length, contained: name.length > model.length && h.includes(name) });
  }
  return out;
};
const subHits = (a: Atom, h: string) => aliasHits(h, [a.subName, a.encarSub], a.model);
const trimHits = (a: Atom, h: string) => aliasHits(h, [a.trimName, a.encarTrim]);
const bestScore = (hits: AliasHit[]) => Math.max(0, ...hits.map((hit) => hit.score));
const hasContainedAlias = (hits: AliasHit[]) => hits.some((hit) => hit.contained);
const matchesAliasHint = (hint: string, names: string[]) => {
  const h = nk(hint);
  return !!h && names.some((name) => {
    const n = nk(name);
    return n === h || (n.length > 1 && h.includes(n));
  });
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

type Ctx = { maker: string; model: string; nameHay: string; trimHay: string; fuel: string; cc: number; seats: number; drive: string; year: number };

/** 연식·연료·배기량·차명으로 후보를 줄인다. 이름 토큰만 맞추던 방식은 세대를 놓친다. */
const narrowAtoms = (ctx: Ctx): Atom[] => {
  if (!ctx.maker) return [];
  let hit = ATOM_ROWS.filter((a) => a.maker === ctx.maker && !atomConflictsName(a, ctx.nameHay, ctx.fuel, ctx.model));
  if (ctx.model) {
    const byModel = hit.filter((a) => a.model === ctx.model || nk(a.modelName) === ctx.model);
    if (byModel.length) hit = byModel;
    else hit = [];
  }
  if (!hit.length) return [];
  if (ctx.fuel === '하이브리드' || ctx.fuel === '전기') {
    hit = keepIf(hit, (a) => a.fuel === ctx.fuel || a.sub.includes(ctx.fuel === '전기' ? '일렉트릭' : '하이브리드'));
  } else if (ctx.fuel) {
    hit = keepIf(hit, (a) => a.fuel === ctx.fuel);
    hit = keepIf(hit, (a) => !/하이브리드|일렉트릭/.test(a.sub));
  }
  if (ctx.cc > 300) hit = keepIf(hit, (a) => !!a.cc && Math.abs(a.cc - ctx.cc) / Math.max(ctx.cc, a.cc) <= 0.08);
  if (ctx.seats) hit = keepIf(hit, (a) => !a.seats || a.seats === ctx.seats);
  if (ctx.drive) hit = keepIf(hit, (a) => !a.drive || a.drive === ctx.drive);
  if (turboIn(ctx.nameHay)) hit = keepIf(hit, (a) => a.turbo || /터보/.test(a.trimName) || /터보/.test(a.encarTrim));
  // ★연식 구간으로 세대부터 가른다. 안 가르면 X1(2세대) 2021 이 F48/U11 둘 다 남고 점검사항에 엔카 세대 코드를 다시 적으라고 한다.
  if (ctx.year) hit = keepIf(hit, (a) => inYear(a, ctx.year));
  const ord = ordinalGen(ctx.trimHay) || ordinalGen(ctx.nameHay);
  if (ord) {
    const tagged = hit.filter((a) => new RegExp(`${ord}\\s*세대`).test(`${a.subName} ${a.encarSub}`));
    if (tagged.length) hit = tagged;
  }
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
  /** 내부 세부모델 또는 엔카 세부모델 중 하나가 실제 차명에 맞으면 후보다. */
  const namedSub = hit.filter((a) => subHits(a, ctx.nameHay).length > 0);
  if (namedSub.length) {
    const contained = namedSub.filter((a) => hasContainedAlias(subHits(a, ctx.nameHay)));
    const pool = contained.length ? contained : namedSub;
    const max = Math.max(...pool.map((a) => bestScore(subHits(a, ctx.nameHay))));
    hit = pool.filter((a) => bestScore(subHits(a, ctx.nameHay)) === max);
  }
  const trimHay = ctx.trimHay || ctx.nameHay;
  const namedTrim = hit.filter((a) => trimHits(a, trimHay).length > 0);
  if (namedTrim.length) {
    const max = Math.max(...namedTrim.map((a) => bestScore(trimHits(a, trimHay))));
    hit = namedTrim.filter((a) => bestScore(trimHits(a, trimHay)) === max);
  }
  return hit;
};

const inspectNote = (ctx: Ctx, hit: Atom[], carName: string, makerDisp: string): string => {
  if (!ctx.maker) return `${TRIM_NOTE} 제조사를 적어 주세요 (현대 · 기아 · 제네시스 · 르노 · KGM …).`;
  if (!ATOM_ROWS.some((a) => a.maker === ctx.maker)) {
    return `${TRIM_NOTE} 차명에 모델·트림을 정확히 적어 주세요. 예: E200 Avantgarde · 520i Luxury · Cooper Classic`;
  }
  if (ctx.model && !ATOM_ROWS.some((a) => a.maker === ctx.maker && (a.model === ctx.model || nk(a.modelName) === ctx.model))) {
    return `${TRIM_NOTE} 엔카 차종마스터에 「${ctx.model}」가 없습니다. 마스터에 세대를 넣은 뒤 stamp.`;
  }
  if (!S(carName)) return `${TRIM_NOTE} 차명(세부모델+트림)을 모델·세대·트림까지 적어 주세요. 예: 더 뉴 그랜저 GN7 캘리그래피`;
  if (!hit.length) {
    const bits = ['차명에 모델·세대·트림을 정확히 적어 주세요'];
    if (!ctx.year) bits.push('연식(네 자리, 예: 2022)');
    if (!ctx.fuel) bits.push('연료(가솔린·디젤·하이브리드·전기)');
    return `${TRIM_NOTE} ${bits.join(' · ')}.`;
  }
  const models = uniq(hit.map((a) => a.modelName));
  const subs = uniq(hit.map((a) => a.encarSub || a.subName));
  const trims = uniq(hit.map((a) => a.encarTrim || a.trimName));
  if (models.length > 1) return `${TRIM_NOTE} 모델명을 엔카처럼 구분해 주세요. 후보: ${listed(models)}`;
  if (subs.length > 1) return `${TRIM_NOTE} 차명에 엔카 세대를 적어 주세요. 후보: ${listed(subs, 5)}`;
  if (trims.length > 1) return `${TRIM_NOTE} 차명에 엔카 트림을 적어 주세요. 후보: ${listed(trims)}`;
  const missing: string[] = [];
  if (!ctx.year) missing.push('연식(네 자리, 예: 2022)');
  if (!ctx.fuel) missing.push('연료(가솔린·디젤·하이브리드·전기)');
  return `${TRIM_NOTE} 트림을 특정할 수 없습니다.${missing.length ? ` ${missing.join(' · ')}도 적어 주세요.` : ' 차명·연식·연료를 다시 확인해 주세요.'}`;
};

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
  assertStampColumnAllowed(name);
  const i = at.get(name) ?? -1;
  if (i < 0) return;
  if (now === val) { if (now) counts.skip++; return; }
  updates.push({ range: `${a1Tab(title)}!${colA1(i)}${row}`, values: [[val]] });
  counts.set++;
};

if (!ATOM_ROWS.length) throw new Error('엔카 차종마스터에 세부트림행키가 없다 — 시트를 다시 확인해야 한다');
assertEncarSpecFillGuards(ATOM_ROWS);

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
console.log(`■ 엔카 행키 심기 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳 · 원자 ${ATOM_ROWS.length} · M ${new Set(ATOM_ROWS.map((a) => a.m)).size} · SM ${new Set(ATOM_ROWS.map((a) => a.sm)).size} · T ${new Set(ATOM_ROWS.map((a) => a.t)).size}`);

const colOf = (at: Map<string, number>, names: string[]) => {
  for (const n of names) {
    const i = at.get(n);
    if (i !== undefined) return i;
  }
  return -1;
};
const validCode = (raw: string, prefix: 'M' | 'SM' | 'T', ok: (code: string) => boolean) => {
  const re = prefix === 'SM' ? /^SM-\d+$/ : prefix === 'M' ? /^M-\d+$/ : /^T-\d+$/;
  return re.test(raw) && ok(raw) ? raw : '';
};

let totCars = 0, totM = 0, totSM = 0, totT = 0, totKeep = 0, totFill = 0, totNoT = 0, totNote = 0, totSkip = 0, totNoCol = 0;
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
  let cars = 0, mSet = 0, smSet = 0, tSet = 0, keep = 0, fill = 0, noT = 0, notes = 0, noCol = 0;
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
    const tAt = colOf(at, [ENCAR_TRIM_KEY_COLUMN, ENCAR_OLD_TRIM_CODE_COLUMN]);
    const mAt = colOf(at, [ENCAR_MODEL_KEY_COLUMN]);
    const smAt = colOf(at, [ENCAR_SUB_KEY_COLUMN]);
    if (tAt < 0 && mAt < 0 && smAt < 0) { noCol++; return; }
    const tColName = tAt >= 0 ? (hdr[tAt] || ENCAR_TRIM_KEY_COLUMN) : '';
    const plateAt = at.get('차량번호') ?? -1;
    const checkName = at.has(REQUEST_COLUMN_NAME) ? REQUEST_COLUMN_NAME : at.has('요청사항') ? '요청사항' : '';
    const checkAt = checkName ? (at.get(checkName) ?? -1) : -1;
    if (plateAt < 0) return;
    for (let r = hRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      if (!S(row[plateAt])) continue;
      cars++;
      const nowTraw = tAt >= 0 ? S(row[tAt]) : '';
      const nowMraw = mAt >= 0 ? S(row[mAt]) : '';
      const nowSMraw = smAt >= 0 ? S(row[smAt]) : '';
      let nowT = validCode(nowTraw, 'T', (c) => ATOM_ROWS.some((a) => a.t === c));
      let nowM = validCode(nowMraw, 'M', (c) => ATOM_ROWS.some((a) => a.m === c));
      let nowSM = validCode(nowSMraw, 'SM', (c) => ATOM_ROWS.some((a) => a.sm === c));
      const nowCheck = checkAt >= 0 ? S(row[checkAt]) : '';
      const makerDisp = pick(row, at, ['제조사']) || pick(row, at, ['제조사(정제)']);
      const maker = makerKey(makerDisp);
      let model = nk(pick(row, at, ['모델명'])) || nk(pick(row, at, ['모델']));
      const carName = pick(row, at, ['차명(세부모델+트림)']);
      const opt = pick(row, at, ['옵션']);
      const inferred = maker ? inferModel(maker, hay(carName)) : '';
      if (inferred) model = inferred;
      let trimHay = injectGen(hay(`${model} ${carName}`), carName, model);
      let nameHay = trimHay + nk(opt);
      if (!model && maker) {
        model = inferModel(maker, nameHay);
        if (model) {
          trimHay = injectGen(hay(`${model} ${carName}`), carName, model);
          nameHay = trimHay + nk(opt);
        }
      }
      const fuel = fuelFromVehicle(pick(row, at, ['연료']), carName, pick(row, at, ['연료(정제)']));
      const cc = parseCc(pick(row, at, ['배기량(정제)']), pick(row, at, ['배기량']), carName, pick(row, at, ['연료']));
      const seats = Number((carName.match(/(\d+)\s*인승/) || [])[1] || 0);
      const drive = driveKey(`${pick(row, at, ['구동방식'])} ${carName} ${opt}`);
      const year = yearOf(pick(row, at, ['연식']), pick(row, at, ['최초등록일']), carName);
      const ctx: Ctx = { maker, model, nameHay, trimHay, fuel, cc, seats, drive, year };
      if (nowT) {
        const a = ATOM_ROWS.find((x) => x.t === nowT);
        if (a && atomConflictsName(a, nameHay, fuel, model)) nowT = '';
      }
      if (nowM) {
        const ofM = ATOM_ROWS.filter((x) => x.m === nowM);
        if (ofM.length && ofM.every((a) => atomConflictsName(a, nameHay, fuel, model))) { nowM = ''; nowSM = ''; }
      }
      let hit = maker && (nameHay || year || fuel) ? narrowAtoms(ctx) : [];
      const nowOf = (name: string) => S(row[at.get(name) ?? -1]);
      const wrongLeftover = leftoverConflicts(nowOf('모델'), nameHay, fuel, model, 'model')
        || leftoverConflicts(nowOf('세부모델'), nameHay, fuel, model, 'sub')
        || (model && !hit.length && nowOf('모델') && nk(nowOf('모델')) !== model);
      if (wrongLeftover) {
        nowT = ''; nowM = ''; nowSM = '';
        put(updates, title, at, ENCAR_MODEL_KEY_COLUMN, r + 1, '', nowMraw, counts);
        put(updates, title, at, ENCAR_SUB_KEY_COLUMN, r + 1, '', nowSMraw, counts);
        if (tColName) put(updates, title, at, tColName, r + 1, '', nowTraw, counts);
      }
      const modelHint = pick(row, at, ['모델']);
      const subHint = pick(row, at, ['세부모델']);
      const trimHint = pick(row, at, ['세부트림']);
      // 정제칸 「모델」이 예전에 잘못 박혀 있으면(A6 → A6 e-트론) 차명·모델명과 안 맞는 힌트는 버린다.
      if (modelHint) {
        const mh = nk(modelHint);
        if (mh === model || nameHay.includes(mh)) {
          hit = keepIf(hit, (a) => a.modelName === modelHint || a.model === mh);
        }
      }
      if (subHint) hit = keepIf(hit, (a) => matchesAliasHint(subHint, [a.subName, a.encarSub]));
      if (trimHint) hit = keepIf(hit, (a) => matchesAliasHint(trimHint, [a.trimName, a.encarTrim])
        || trimInName(hay(trimHint), a.trimName) || trimInName(hay(trimHint), a.encarTrim));
      let tCode = '';
      if (nowT) {
        tCode = nowT;
        hit = ATOM_ROWS.filter((a) => a.t === nowT);
        keep++;
      } else {
        const tCodes = [...new Set(hit.map((a) => a.t).filter(Boolean))];
        tCode = tCodes.length === 1 ? tCodes[0] : '';
        if (tCode) fill++;
      }
      const ofTrim = tCode ? hit.filter((a) => a.t === tCode) : hit;
      const mCode = tCode
        ? (ofTrim[0]?.m || agree(ofTrim.map((a) => a.m)))
        : (agree(hit.map((a) => a.m)) || (hit.length ? nowM : ''));
      const smCode = tCode
        ? (ofTrim[0]?.sm || agree(ofTrim.map((a) => a.sm)))
        : (agree(hit.map((a) => a.sm)) || (hit.length ? nowSM : ''));
      if (mCode) {
        mSet++;
        if (mAt >= 0) put(updates, title, at, ENCAR_MODEL_KEY_COLUMN, r + 1, mCode, nowMraw, counts);
      } else if (nowMraw) {
        put(updates, title, at, ENCAR_MODEL_KEY_COLUMN, r + 1, '', nowMraw, counts);
      }
      if (smCode) {
        smSet++;
        if (smAt >= 0) put(updates, title, at, ENCAR_SUB_KEY_COLUMN, r + 1, smCode, nowSMraw, counts);
      } else if (nowSMraw) {
        put(updates, title, at, ENCAR_SUB_KEY_COLUMN, r + 1, '', nowSMraw, counts);
      }
      if (tCode) {
        tSet++;
        if (tColName) put(updates, title, at, tColName, r + 1, tCode, nowTraw, counts);
        if (checkName && nowCheck.includes(TRIM_NOTE)) {
          put(updates, title, at, checkName, r + 1, mergeTrimNote(nowCheck, ''), nowCheck, counts);
        }
      } else {
        noT++;
        if (tColName && nowTraw) put(updates, title, at, tColName, r + 1, '', nowTraw, counts);
        const note = inspectNote(ctx, hit, carName, makerDisp);
        if (note && checkName) {
          put(updates, title, at, checkName, r + 1, mergeTrimNote(nowCheck, note), nowCheck, counts);
          notes++;
        }
        if (note && samples.length < 40) samples.push(`${t.name} ${S(row[plateAt])} 「${carName.slice(0, 36)}」 ${note}`);
      }
    }
  });
  totCars += cars; totM += mSet; totSM += smSet; totT += tSet; totKeep += keep; totFill += fill; totNoT += noT; totNote += notes; totSkip += counts.skip; totNoCol += noCol;
  console.log(`  ${t.name.padEnd(12)} ${String(cars).padStart(4)}대  M ${mSet}  SM ${smSet}  T ${tSet}(유지 ${keep}·채움 ${fill})  못정함 ${noT}  점검사항 ${notes}${noCol ? '  열없음' : ''}`);
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
console.log(`\n  ${totCars}대 · M ${totM} · SM ${totSM} · T ${totT}(유지 ${totKeep}·채움 ${totFill}) · T못정함 ${totNoT} · 점검사항 ${totNote}${totNoCol ? ` · 열없는탭 ${totNoCol}` : ''}`);
if (samples.length) {
  console.log('  못 채운 예:');
  for (const s of samples.slice(0, 25)) console.log(`    ${s}`);
}
console.log(APPLY ? '  반영 완료\n' : '※ dry-run. 반영은 --apply\n');
