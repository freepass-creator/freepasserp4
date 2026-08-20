/**
 * **공급사 재고 탭에 엔카 중고차 코드를 박는다.** 기본 dry-run, 반영은 `--apply`.
 *
 *   차종트림코드 = 원자ID `U-0001`  ·  차종마스터코드 = 세부모델ID `SM-0001`
 * ★정제칸(제조사(정제)·모델·세부모델·세부트림·연료(정제)·배기량(정제))으로 맞춘다.
 *   후보가 하나일 때만 박는다. 이미 있는 칸은 안 덮는다.
 * ⚠ ERP 「차종코드」는 안 건드린다.
 *
 *   npx tsx scripts/stamp-encar-codes-on-supplier.mts
 *   npx tsx scripts/stamp-encar-codes-on-supplier.mts --apply
 *   npx tsx scripts/stamp-encar-codes-on-supplier.mts --who=웰릭스 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonMakerDisplay } from '../lib/domain/maker-display';
import { companyAlias, supplierNameKeys } from '../lib/domain/identity';
import {
  ENCAR_MASTER_CODE_COLUMN, ENCAR_TRIM_CODE_COLUMN, SHEET_NAME_MATCH,
  isOurNonInventoryTab, supplierSheetLabel,
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
const SUB_PATH = arg('subs', 'C:\\Users\\admin\\encar-market-survey\\reports\\master_draft_rows.json');
const atoms = JSON.parse(readFileSync(ATOM_PATH, 'utf8')) as Payload;
const subs = JSON.parse(readFileSync(SUB_PATH, 'utf8')) as Payload;
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

type Atom = { u: string; smName: string; maker: string; model: string; sub: string; trim: string; fuel: string; cc: number };
const ATOM_ROWS: Atom[] = atoms.values.map((r) => {
  const o = zip(atoms.headers, r);
  return {
    u: S(o['원자ID']),
    smName: S(o['세부모델']),
    maker: makerKey(o['제조사']),
    model: nk(o['1차모델']),
    sub: nk(o['세부모델']),
    trim: nk(o['세부트림']),
    fuel: fuelKey(o['연료']),
    cc: ccNum(o['정확배기량(cc)']),
  };
}).filter((a) => a.u);

const SM_BY = new Map<string, string>();
for (const r of subs.values) {
  const o = zip(subs.headers, r);
  const id = S(o['세부모델ID']);
  if (!id) continue;
  SM_BY.set(`${makerKey(o['제조사'])}|${nk(o['세부모델'])}`, id);
}

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

const matchAtom = (maker: string, model: string, sub: string, trim: string, fuel: string, cc: number): Atom[] => {
  let hit = ATOM_ROWS.filter((a) => a.maker === maker && a.sub === sub);
  if (!hit.length && model) hit = ATOM_ROWS.filter((a) => a.maker === maker && a.model === model && a.sub === sub);
  if (!hit.length) return [];
  if (trim) {
    const t = hit.filter((a) => a.trim === trim);
    if (t.length) hit = t;
  }
  if (fuel) {
    const f = hit.filter((a) => a.fuel === fuel);
    if (f.length) hit = f;
  }
  if (cc > 300) {
    const exact = hit.filter((a) => a.cc && Math.abs(a.cc - cc) / cc <= 0.07);
    if (exact.length) hit = exact;
  }
  return hit;
};

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
console.log(`■ 엔카 코드 심기 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳 · 원자 ${ATOM_ROWS.length} · 세부모델 ${SM_BY.size}`);

let totCars = 0, totU = 0, totSm = 0, totAmb = 0, totMiss = 0, totSkip = 0, totNoCol = 0;
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
  let cars = 0, uSet = 0, smSet = 0, amb = 0, miss = 0, skip = 0, noCol = 0;
  ((got.valueRanges || []) as Rec[]).forEach((vr, ti) => {
    const title = titles[ti];
    const grid = ((vr.values || []) as string[][]);
    if (grid.length < 2) return;
    const hRow = grid.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (hRow < 0) return;
    const hdr = (grid[hRow] || []).map(S);
    const at = new Map<string, number>();
    hdr.forEach((h, i) => { if (h && !at.has(h)) at.set(h, i); });
    const uAt = at.get(ENCAR_TRIM_CODE_COLUMN) ?? -1;
    const smAt = at.get(ENCAR_MASTER_CODE_COLUMN) ?? -1;
    if (uAt < 0 && smAt < 0) { noCol++; return; }
    const plateAt = at.get('차량번호') ?? -1;
    if (plateAt < 0) return;
    for (let r = hRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      if (!S(row[plateAt])) continue;
      cars++;
      const maker = makerKey(pick(row, at, ['제조사(정제)', '제조사']));
      const model = nk(pick(row, at, ['모델']));
      const sub = nk(pick(row, at, ['세부모델']));
      const trim = nk(pick(row, at, ['세부트림']));
      const fuel = fuelKey(pick(row, at, ['연료(정제)', '연료']));
      const cc = ccNum(pick(row, at, ['배기량(정제)', '배기량']));
      if (!maker || !sub) { miss++; continue; }
      const hits = matchAtom(maker, model, sub, trim, fuel, cc);
      const sm = SM_BY.get(`${maker}|${sub}`) || (hits.length ? SM_BY.get(`${hits[0].maker}|${nk(hits[0].smName)}`) : '');
      const uniqU = [...new Set(hits.map((h) => h.u))];
      const nowU = uAt >= 0 ? S(row[uAt]) : '';
      const nowSm = smAt >= 0 ? S(row[smAt]) : '';
      if (uniqU.length === 1 && uAt >= 0) {
        if (!nowU) { updates.push({ range: `${a1Tab(title)}!${colA1(uAt)}${r + 1}`, values: [[uniqU[0]]] }); uSet++; }
        else skip++;
      } else if (uniqU.length > 1) amb++;
      else if (!uniqU.length) miss++;
      if (sm && smAt >= 0) {
        if (!nowSm) { updates.push({ range: `${a1Tab(title)}!${colA1(smAt)}${r + 1}`, values: [[sm]] }); smSet++; }
        else skip++;
      }
    }
  });
  totCars += cars; totU += uSet; totSm += smSet; totAmb += amb; totMiss += miss; totSkip += skip; totNoCol += noCol;
  console.log(`  ${t.name.padEnd(12)} ${String(cars).padStart(4)}대  U ${uSet}  SM ${smSet}  여럿 ${amb}  못찾음 ${miss}${noCol ? '  열없음' : ''}`);
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
console.log(`\n  ${totCars}대 · 트림코드 ${totU} · 마스터코드 ${totSm} · 후보여럿 ${totAmb} · 못찾음 ${totMiss} · 이미있음 ${totSkip}${totNoCol ? ` · 열없는탭 ${totNoCol}` : ''}`);
console.log(APPLY ? '  반영 완료\n' : '※ dry-run. 반영은 --apply\n');
