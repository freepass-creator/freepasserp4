/**
 * **정제칸 ↔ F03 차종마스터(7열) + 제원마스터(별도 탭) 전수 대조(읽기 전용).**
 *
 * 정본 = `[F03 사용중] 차종마스터 신규` (`ENCAR_MASTER_SHEET_ID`).
 *   · 차종마스터 탭 = 이름 7열(원산지·제조사·모델·세부모델·세부트림·생산시작·생산종료)
 *   · 제원마스터 탭 = 구분·값 허용목록(연료·배기량(cc)·구동방식). 차종 행과 cc로 안 쪼갠다.
 *   · 전기 kWh = 전기차배터리마스터(세부모델 키). 인승·차종크기/구분은 제원탭에 없음 → 대조 안 함.
 *
 * 대상 = 드라이브 「프리패스 재고」 [제공]·[정제] 전 재고 탭(F01 프록시 아님).
 * 산출 버킷 = 자동후보 / 검수대기 / 읽기실패.
 *   ★읽기실패를 0건으로 숨기지 않는다. 한 공급사라도 못 읽으면 이 실행은 실패(exit 1).
 *
 * 시트·정제칸 쓰기 없음. 라이브 mf- 안 봄. high/자동후보 ≠ 확정.
 *
 *   npx tsx scripts/audit-refine-vs-master.mts
 *   npx tsx scripts/audit-refine-vs-master.mts --only=아이카,오토플러스
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, isVehicleTab, LEGACY_SHEET_PREFIX, supplierSheetLabel, supplierSheetNameParts } from '../lib/domain/supplier-template-sheet';
import { isMirrorSheet } from '../lib/domain/mirror-sources';
import { ENCAR_MASTER_SHEET_ID, ENCAR_NAME_COLUMNS, ENCAR_SPEC_TAB, loadEncarWorkSheetGrids } from '../lib/domain/encar-master-sheet';
import { isLegacySheetId } from '../lib/domain/legacy-sheets';
import { canonMakerDisplay } from '../lib/domain/maker-display';
import { VEHICLE_CLASS_VALUES } from '../lib/intake/entities';
import { companyAlias, supplierNameKeys } from '../lib/domain/identity';
import {
  attachFromEncarSheet,
  fold,
  selfCheckEncarMatch,
  workBookFromTabs,
  type NameRow,
  type WorkBook,
} from '../lib/domain/encar-work-sheet-match';
import { resolveSubmodelToF03, selfCheckSubNorm, SUB_NORM_RULE, type SubNormResult } from '../lib/domain/submodel-normalize-f03';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const ONLY = new Set(arg('only').split(',').map(S).filter(Boolean));
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const RULE_VERSION = `f03-7col+${SUB_NORM_RULE}`;
const CLASS = new Set(VEHICLE_CLASS_VALUES.map((c) => c.replace(/\s+/g, '').toLowerCase()));
const sha16 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});
const call = async (u: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 180)}`);
  }
};

function hdrRow(grid: unknown[][], ...need: string[]): number {
  const n = (s: string) => S(s).replace(/\s+/g, '');
  const want = need.map(n);
  return (grid || []).slice(0, 8).findIndex((r) => want.every((w) => (r || []).some((c) => n(S(c)) === w)));
}

type SpecContract = { headers: string[]; kinds: Record<string, string[]>; fuels: string[]; ccs: number[]; drives: string[] };
function specContractFromGrid(specGrid: unknown[][], book: WorkBook): SpecContract {
  const grid = (specGrid || []).map((r) => (r || []).map(S));
  const at = hdrRow(grid, '구분', '값');
  if (at < 0) throw new Error(`제원마스터 머리글을 못 찾음: ${(grid[0] || []).join('|')}`);
  const headers = grid[at];
  const ki = headers.findIndex((h) => h.replace(/\s+/g, '') === '구분');
  const vi = headers.findIndex((h) => h.replace(/\s+/g, '') === '값');
  const kinds = new Map<string, string[]>();
  for (const r of grid.slice(at + 1)) {
    const k = S(r[ki]); const v = S(r[vi]);
    if (!k || !v) continue;
    (kinds.get(k) || kinds.set(k, []).get(k)!).push(v);
  }
  const kindObj = Object.fromEntries([...kinds.entries()]);
  const expected = ['연료', '배기량(cc)', '구동방식'];
  const extra = [...kinds.keys()].filter((k) => !expected.includes(k) && k !== '배기량');
  if (!kinds.has('연료') || !kinds.has('구동방식')) {
    throw new Error(`제원마스터 계약이 다름(구분=${[...kinds.keys()].join('·')}): ${headers.join('|')}`);
  }
  if (extra.length) {
    throw new Error(`제원마스터에 예상 밖 구분 ${extra.join('·')} — 계약을 확인하고 감사기를 맞춰라`);
  }
  return { headers, kinds: kindObj, fuels: [...book.fuels], ccs: [...book.ccs].sort((a, b) => a - b), drives: [...book.drives] };
}

function fuelInSpec(raw: string, allowed: Set<string>): string {
  const f = fold(raw);
  if (!f || /phev|플러그인/.test(f)) return '';
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

function driveInSpec(raw: string, allowed: Set<string>): string {
  const s = S(raw);
  if (!s) return '';
  const u = s.toUpperCase();
  if (s === '2WD' || s === 'RWD' || s === 'AWD') return allowed.has(s) ? s : '';
  // 4WD·4륜은 제원 허용값에 없음 → 자동후보로 접지 않음(AWD 갈림은 사람)
  if (/\b4WD\b/.test(u) || /4륜|사륜/.test(s)) return '';
  if (/(4MATIC|XDRIVE|QUATTRO|HTRAC)/i.test(s) || /\bAWD\b/.test(u)) return allowed.has('AWD') ? 'AWD' : '';
  if (/\bRWD\b/.test(u) || /후륜/.test(s)) return allowed.has('RWD') ? 'RWD' : '';
  if (/\bFWD\b/.test(u) || /전륜|2륜/.test(s) || /\b2WD\b/.test(u)) return allowed.has('2WD') ? '2WD' : '';
  return '';
}

function ccInSpec(raw: string, allowed: Set<number>): number | undefined {
  const s = S(raw).replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  const m = /(\d{3,5})/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (n < 800 || n > 8000) return undefined;
  if (allowed.has(n)) return n;
  const liter = Number((n / 1000).toFixed(1));
  const hit = [...allowed].filter((c) => Number((c / 1000).toFixed(1)) === liter);
  return hit.length === 1 ? hit[0] : undefined;
}

type NameIdx = {
  bySub: Map<string, NameRow[]>;
  trims: Map<string, Set<string>>;
  origins: Map<string, Set<string>>;
  batBySub: Map<string, Set<string>>;
};
function buildIdx(book: WorkBook): NameIdx {
  const idx: NameIdx = { bySub: new Map(), trims: new Map(), origins: new Map(), batBySub: new Map() };
  const add = (m: Map<string, Set<string>>, k: string, v: string) => {
    if (!v) return;
    (m.get(k) || m.set(k, new Set()).get(k)!).add(v);
  };
  for (const r of book.names) {
    const sk = fold(r.sub);
    (idx.bySub.get(sk) || idx.bySub.set(sk, []).get(sk)!).push(r);
    add(idx.trims, `${fold(r.maker)}|${fold(r.model)}|${sk}`, r.trim);
    add(idx.origins, fold(r.maker), r.origin);
  }
  for (const b of book.batteries) add(idx.batBySub, `${fold(b.maker)}|${fold(b.model)}|${fold(b.sub)}`, b.kwh);
  return idx;
}

function inSet(set: Set<string> | undefined, val: string): boolean {
  if (!set || !val) return false;
  const f = fold(val);
  for (const x of set) if (fold(x) === f) return true;
  return false;
}

function sheetMakerOf(raw: string, book: WorkBook): string {
  const disp = canonMakerDisplay(raw) || S(raw);
  if (!disp) return '';
  const exact = book.names.find((r) => r.maker === disp || r.maker === raw)?.maker;
  if (exact) return exact;
  return book.names.find((r) => canonMakerDisplay(r.maker) === disp)?.maker || '';
}

function pickRows(idx: NameIdx, sub: string, makerSheet: string, model: string): NameRow[] {
  let rows = idx.bySub.get(fold(sub)) || [];
  if (makerSheet) rows = rows.filter((r) => fold(r.maker) === fold(makerSheet) || canonMakerDisplay(r.maker) === canonMakerDisplay(makerSheet));
  if (model) rows = rows.filter((r) => fold(r.model) === fold(model));
  return rows;
}

type Bucket = '자동후보' | '검수대기' | '읽기실패';
type Issue = { supplier: string; mirror: boolean; plate: string; kind: string; detail: string };
type RowOut = {
  bucket: Bucket;
  supplier: string; kind: string; tab: string; plate: string; status: string;
  raw: { 차명: string; 연식: string; 연료: string; 배기량: string; 구동: string };
  filled: { 제조사: string; 모델: string; 세부모델: string; 세부트림: string; 연료: string; 배기량: string; 구동: string; 배터리: string; 원산지: string };
  attached: { 모델: string; 세부모델: string; 세부트림: string };
  round4?: { tag: string; from: string; picked: string; note: string };
  reasons: string[];
  sourceHash: string;
};
type ReadFail = { supplier: string; id: string; tab: string; error: string };

const grids = await loadEncarWorkSheetGrids(call);
const book = workBookFromTabs(grids);
const checks = selfCheckEncarMatch(book);
if (checks.length) {
  console.error('⛔ 매처 자가검증 실패 (F03)\n' + checks.map((x) => `  ${x}`).join('\n'));
  process.exit(1);
}
const normChecks = selfCheckSubNorm();
if (normChecks.length) {
  console.error('⛔ 세부모델 정규화 자가검증 실패\n' + normChecks.map((x) => `  ${x}`).join('\n'));
  process.exit(1);
}
const nameAt = hdrRow(grids.names, '제조사', '세부모델', '세부트림');
if (nameAt < 0) throw new Error(`차종마스터 머리글을 못 찾음: ${(grids.names[0] || []).join('|')}`);
const nameHdr = (grids.names[nameAt] || []).map(S);
const missingName = ENCAR_NAME_COLUMNS.filter((c) => !nameHdr.some((h) => h.replace(/\s+/g, '') === c.replace(/\s+/g, '')));
if (missingName.length) throw new Error(`차종마스터 7열 계약이 다름(없음 ${missingName.join('·')}): ${nameHdr.join('|')}`);
const spec = specContractFromGrid(grids.specs, book);
const idx = buildIdx(book);
const f03Meta = await call(`https://www.googleapis.com/drive/v3/files/${ENCAR_MASTER_SHEET_ID}?fields=id,name,modifiedTime,version&supportsAllDrives=true`);
const f03NameHash = sha16(book.names.map((r) => [r.origin, r.maker, r.model, r.sub, r.trim, r.start, r.end].join('|')).join('\n'));
const f03SpecHash = sha16(JSON.stringify(spec.kinds));
console.log(`■ F03 사전 — 차종마스터 ${book.names.length}행 7열(${nameHdr.join('·')})`);
console.log(`  제원마스터 계약 ${ENCAR_SPEC_TAB} 머리 ${spec.headers.join('·')} · 구분 ${Object.keys(spec.kinds).join('·')}`);
console.log(`  연료 ${spec.fuels.join('/')} · 구동 ${spec.drives.join('/')} · cc ${spec.ccs.length} · 배터리 ${book.batteries.length}`);
console.log(`  제원탭에 없는 축(대조 안 함): 인승 · 차종크기 · 차종구분`);
console.log(`  규칙 ${RULE_VERSION} · 수정시각 ${S(f03Meta.modifiedTime)} · 이름해시 ${f03NameHash} · 제원해시 ${f03SpecHash}`);

const targets: { name: string; id: string; sheetKind: string; sheetName: string }[] = [];
{
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  let page = '';
  for (;;) {
    const u = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`;
    const got = await call(u);
    for (const f of ((got.files || []) as Rec[])) {
      const nm = S(f.name);
      const who = companyAlias(supplierSheetLabel(nm)) || supplierSheetLabel(nm);
      if (nm.startsWith(LEGACY_SHEET_PREFIX) || /구버전/.test(nm) || isLegacySheetId(S(f.id))) continue;
      if (ONLY.size && ![...supplierNameKeys(who)].some((k) => ONLY.has(k))) continue;
      const parts = supplierSheetNameParts(nm);
      targets.push({ name: who, id: S(f.id), sheetKind: parts.kind || (isMirrorSheet(S(f.id)) ? '정제' : ''), sheetName: nm });
    }
    if (!got.nextPageToken) break;
    page = S(got.nextPageToken);
  }
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
if (!targets.length) throw new Error('프리패스 재고 시트를 한 장도 못 찾았다 — 0건으로 넘기지 않음');

const rows: RowOut[] = [];
const issues: Issue[] = [];
const readFails: ReadFail[] = [];
const perSupplier = new Map<string, { cars: number; auto: number; review: number }>();
let blankCore = 0;
const round4Pool: { plate: string; supplier: string; from: string; r: SubNormResult }[] = [];

function failRead(supplier: string, id: string, tab: string, error: string) {
  readFails.push({ supplier, id, tab, error });
  console.log(`  ✗ 읽기실패 ${supplier}${tab ? ` / ${tab}` : ''} — ${error.slice(0, 120)}`);
}

for (const t of targets) {
  let meta: Rec;
  try {
    meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}?fields=sheets.properties(title,hidden)`);
  } catch (e) {
    failRead(t.name, t.id, '', `시트를 못 열었다: ${String((e as Error).message)}`);
    continue;
  }
  const tabTitles = ((meta.sheets || []) as Rec[])
    .map((s) => s.properties as Rec)
    .filter((p) => !p.hidden && !isOurNonInventoryTab(S(p.title)) && isVehicleTab(S(p.title)))
    .map((p) => S(p.title));
  if (!tabTitles.length) {
    failRead(t.name, t.id, '', '재고 탭 없음');
    continue;
  }
  let got: Rec;
  try {
    const qs = tabTitles.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&');
    got = await call(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}/values:batchGet?${qs}&majorDimension=ROWS`);
  } catch (e) {
    failRead(t.name, t.id, '', `값을 못 읽었다: ${String((e as Error).message)}`);
    continue;
  }
  const ranges = (got.valueRanges || []) as Rec[];
  if (ranges.length !== tabTitles.length) {
    failRead(t.name, t.id, '', `탭 ${tabTitles.length} vs 값범위 ${ranges.length}`);
    continue;
  }
  const st = perSupplier.get(t.name) || { cars: 0, auto: 0, review: 0 };
  const mirror = isMirrorSheet(t.id) || t.sheetKind === '정제';
  let tabOk = 0;
  for (let ti = 0; ti < tabTitles.length; ti++) {
    const title = tabTitles[ti];
    const grid = ((ranges[ti].values || []) as string[][]).map((r) => (r || []).map(S));
    const hi = grid.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (hi < 0) {
      failRead(t.name, t.id, title, '차량번호 머리글 없음');
      continue;
    }
    tabOk++;
    const hdr = grid[hi];
    const at = new Map<string, number>();
    hdr.forEach((h, i) => { if (h && !at.has(h)) at.set(h, i); });
    const g = (row: string[], ...names: string[]) => {
      for (const n of names) {
        const i = at.get(n);
        if (i !== undefined) return S(row[i]);
      }
      return '';
    };
    for (const row of grid.slice(hi + 1)) {
      const plate = g(row, '차량번호');
      if (!plate) continue;
      st.cars++;
      const carName = g(row, '차명(세부모델+트림)', '차명');
      const carKindRaw = g(row, '차종', '모델명');
      const carKind = CLASS.has(carKindRaw.replace(/\s+/g, '').toLowerCase()) ? '' : carKindRaw;
      const year = g(row, '연식') || g(row, '최초등록일', '최초등록');
      const srcFuel = g(row, '연료');
      const srcCc = g(row, '배기량');
      const srcDrive = g(row, '구동', '구동방식');
      const filledMaker = g(row, '제조사(정제)', '제조사');
      const filledModel = g(row, '모델');
      const filledSub = g(row, '세부모델');
      const filledTrim = g(row, '세부트림');
      const filledFuel = g(row, '연료(정제)');
      const filledCc = g(row, '배기량(정제)');
      const filledDrive = g(row, '구동방식');
      const filledBat = g(row, '배터리용량(정제)');
      const filledOrigin = g(row, '원산지');
      const status = g(row, '상태');
      const attached = attachFromEncarSheet({
        maker: g(row, '제조사') || filledMaker,
        kind: carKind,
        carName,
        fuel: srcFuel,
        cc: srcCc,
        drive: srcDrive,
        seats: g(row, '승차인원', '인승'),
        year,
      }, book);
      const reasons: string[] = [];
      const makerSheet = sheetMakerOf(filledMaker, book);
      let sub = filledSub || S(attached.세부모델);
      const model = filledModel || S(attached.모델);
      let round4: RowOut['round4'];
      if (!carName && !carKind && !filledMaker) reasons.push('원문 차명·제조사 없음');
      if (!sub) reasons.push('세부모델 없음(원문도 하나로 안 모임)');
      let nameRows = sub ? pickRows(idx, sub, makerSheet, model) : [];
      if (filledSub && !nameRows.length) {
        const nrm = resolveSubmodelToF03({
          raw: filledSub, year, maker: makerSheet, model, names: book.names,
        });
        round4Pool.push({ plate, supplier: t.name, from: filledSub, r: nrm });
        round4 = { tag: nrm.tag, from: filledSub, picked: nrm.picked, note: nrm.note };
        if (nrm.tag === '매칭' && nrm.picked) {
          sub = nrm.picked;
          nameRows = pickRows(idx, sub, makerSheet, model);
        } else if (nrm.tag === '오매칭의심') {
          reasons.push(`세대 오매칭 의심 ${nrm.note}`);
        } else {
          const anySub = idx.bySub.get(fold(filledSub)) || [];
          if (!anySub.length) reasons.push(`차종마스터에 없는 세부모델 「${filledSub}」`);
          else reasons.push(`세부모델 「${filledSub}」는 있으나 제조사·모델과 안 맞음`);
        }
      } else if (sub && !nameRows.length) {
        const anySub = idx.bySub.get(fold(sub)) || [];
        if (!anySub.length) reasons.push(`차종마스터에 없는 세부모델 「${sub}」`);
        else reasons.push(`세부모델 「${sub}」는 있으나 제조사·모델과 안 맞음`);
      }
      if (filledMaker && !makerSheet) reasons.push(`제조사 「${filledMaker}」 F03 밖`);
      if (filledModel && nameRows.length && !nameRows.some((r) => fold(r.model) === fold(filledModel))) {
        reasons.push(`모델 어긋남 「${filledModel}」`);
      }
      if (filledOrigin && makerSheet) {
        const origins = idx.origins.get(fold(makerSheet));
        if (origins && !inSet(origins, filledOrigin)) reasons.push(`원산지 어긋남 「${filledOrigin}」`);
      }
      if (filledTrim && nameRows.length) {
        const sample = nameRows[0];
        const trims = idx.trims.get(`${fold(sample.maker)}|${fold(sample.model)}|${fold(sample.sub)}`);
        if (trims && !inSet(trims, filledTrim)) reasons.push(`세부트림 「${filledTrim}」이 그 세부모델에 없음`);
      }
      if (filledFuel) {
        const ok = fuelInSpec(filledFuel, book.fuels);
        if (!ok) reasons.push(`연료 「${filledFuel}」 제원마스터에 없음`);
      }
      if (filledCc) {
        if (ccInSpec(filledCc, book.ccs) === undefined) reasons.push(`배기량 「${filledCc}」 제원마스터에 없음`);
      }
      if (filledDrive) {
        if (!driveInSpec(filledDrive, book.drives)) reasons.push(`구동 「${filledDrive}」 제원마스터에 없음`);
      }
      if (filledBat) {
        if (!sub || !nameRows.length) reasons.push('세부모델 없이 kWh 대조 불가');
        else {
          const sample = nameRows[0];
          const allowed = idx.batBySub.get(`${fold(sample.maker)}|${fold(sample.model)}|${fold(sample.sub)}`);
          const kwh = (filledBat.match(/(\d+(?:\.\d+)?)/) || [])[1] || filledBat;
          const ok = allowed && [...allowed].some((x) => fold(x) === fold(kwh) || Number(x) === Number(kwh));
          if (!ok) reasons.push(`배터리 「${filledBat}」 그 세부모델 배터리마스터에 없음`);
        }
      }
      const nameOk = !!sub && nameRows.length > 0;
      const bucket: Bucket = reasons.length === 0 && nameOk ? '자동후보' : '검수대기';
      if (!filledSub && !S(attached.세부모델)) blankCore++;
      if (bucket === '자동후보') st.auto++;
      else {
        st.review++;
        const kind = reasons[0]?.split('「')[0].trim() || '검수대기';
        issues.push({ supplier: t.name, mirror, plate, kind, detail: reasons.join(' · ') || '이유 없음' });
      }
      const src = [t.name, title, plate, carName, year, filledMaker, filledModel, filledSub, filledTrim, filledFuel, filledCc, filledDrive, filledBat].join('|');
      rows.push({
        bucket, supplier: t.name, kind: t.sheetKind || (mirror ? '정제' : '제공'), tab: title, plate, status,
        raw: { 차명: carName, 연식: year, 연료: srcFuel, 배기량: srcCc, 구동: srcDrive },
        filled: { 제조사: filledMaker, 모델: filledModel, 세부모델: filledSub, 세부트림: filledTrim, 연료: filledFuel, 배기량: filledCc, 구동: filledDrive, 배터리: filledBat, 원산지: filledOrigin },
        attached: { 모델: S(attached.모델), 세부모델: S(attached.세부모델), 세부트림: S(attached.세부트림) },
        round4,
        reasons,
        sourceHash: sha16(src),
      });
    }
  }
  if (!tabOk) continue;
  perSupplier.set(t.name, st);
}

const auto = rows.filter((r) => r.bucket === '자동후보');
const review = rows.filter((r) => r.bucket === '검수대기');
const cars = rows.length;
const named = auto.length;
const SOLD = /출고불가|판매완료|말소/;
const live = rows.filter((r) => !SOLD.test(r.status));
const liveAuto = live.filter((r) => r.bucket === '자동후보');
const liveReview = live.filter((r) => r.bucket === '검수대기');

console.log(`\n■ 원본·제공 정제시트 ↔ F03 — 같은 실행 스냅샷`);
console.log(`  대상 시트 ${targets.length}곳 · 차량번호 있는 전 행 ${cars}대 · 자동후보 ${auto.length} · 검수대기 ${review.length} · 읽기실패 ${readFails.length}`);
console.log(`  출고불가 등 제외 ${live.length}대 · 자동후보 ${liveAuto.length} · 검수대기 ${liveReview.length}  (F01 711은 하류 근사 · 이번 정본은 제공·정제시트)`);
if (readFails.length) {
  console.log('  ── 읽기실패 (0건으로 취급하지 않음)');
  for (const f of readFails) console.log(`   ${f.supplier.padEnd(12)} ${f.tab || '-'}  ${f.error}`);
}
console.log('  ── 공급사별');
for (const [name, st] of [...perSupplier].sort((a, b) => b.cars - a.cars)) {
  console.log(`   ${name.slice(0, 12).padEnd(13)} 차 ${String(st.cars).padStart(3)} · 자동후보 ${String(st.auto).padStart(3)} · 검수대기 ${String(st.review).padStart(3)}`);
}
const byReason = new Map<string, number>();
for (const i of issues) {
  const k = i.kind.slice(0, 24);
  byReason.set(k, (byReason.get(k) || 0) + 1);
}
console.log(`  ── 검수대기 이유 ${issues.length}건 — ${[...byReason].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
const r4Match = round4Pool.filter((x) => x.r.tag === '매칭');
const r4Suspect = round4Pool.filter((x) => x.r.tag === '오매칭의심');
const r4Wait = round4Pool.filter((x) => x.r.tag === '검수대기');
console.log(`\n  ── 라운드4 세부모델 정규화 (풀=F03에 없던 채움 세부모델 ${round4Pool.length})`);
console.log(`     매칭 ${r4Match.length} · 오매칭의심 ${r4Suspect.length} · 검수대기 ${r4Wait.length}  (규칙 ${SUB_NORM_RULE})`);
console.log('     매칭 예');
for (const x of r4Match.slice(0, 15)) {
  console.log(`      ${x.supplier.slice(0, 10).padEnd(11)} ${x.plate.padEnd(10)} 「${x.from}」→「${x.r.picked}」`);
}
if (r4Match.length > 15) console.log(`      … 그 밖 ${r4Match.length - 15}`);
if (r4Suspect.length) {
  console.log('     오매칭의심');
  for (const x of r4Suspect.slice(0, 12)) {
    console.log(`      ${x.supplier.slice(0, 10).padEnd(11)} ${x.plate.padEnd(10)} ${x.r.note.slice(0, 70)}`);
  }
}
console.log('\n  ── 검수대기 예');
for (const r of review.slice(0, 25)) {
  console.log(`   ${r.supplier.slice(0, 10).padEnd(11)} ${r.plate.padEnd(10)} ${r.reasons.join(' · ').slice(0, 80)}`);
}
if (review.length > 25) console.log(`   … 그 밖 ${review.length - 25}대`);

mkdirSync('tmp', { recursive: true });
const report = {
  at: new Date().toISOString(),
  ruleVersion: RULE_VERSION,
  readOnly: true,
  wroteSheets: false,
  f03: {
    id: ENCAR_MASTER_SHEET_ID,
    name: S(f03Meta.name),
    modifiedTime: S(f03Meta.modifiedTime),
    version: S(f03Meta.version),
    nameRows: book.names.length,
    nameHeaders: nameHdr,
    specHeaders: spec.headers,
    specKinds: spec.kinds,
    nameHash: f03NameHash,
    specHash: f03SpecHash,
    batteries: book.batteries.length,
  },
  targets: targets.map((t) => ({ name: t.name, id: t.id, kind: t.sheetKind, sheetName: t.sheetName })),
  cars, named, blankCore,
  buckets: { 자동후보: auto.length, 검수대기: review.length, 읽기실패: readFails.length },
  bucketsSellable: { cars: live.length, 자동후보: liveAuto.length, 검수대기: liveReview.length, 읽기실패: readFails.length },
  round4: {
    rule: SUB_NORM_RULE,
    pool: round4Pool.length,
    매칭: r4Match.length,
    오매칭의심: r4Suspect.length,
    검수대기: r4Wait.length,
    samples: {
      매칭: r4Match.slice(0, 40).map((x) => ({ supplier: x.supplier, plate: x.plate, from: x.from, picked: x.r.picked, note: x.r.note, yearOk: x.r.yearOk })),
      오매칭의심: r4Suspect.map((x) => ({ supplier: x.supplier, plate: x.plate, from: x.from, picked: x.r.picked, note: x.r.note })),
    },
  },
  readFails,
  issues,
  rows,
};
writeFileSync('tmp/refine-vs-master.json', JSON.stringify(report, null, 2));
console.log('\n  산출 tmp/refine-vs-master.json — 정제칸·시트에 쓰지 않았다.');
if (readFails.length) {
  console.error(`\n⛔ 읽기실패 ${readFails.length} — 이 실행은 실패. 빈 결과로 넘기지 않음.`);
  process.exit(1);
}
console.log('');
