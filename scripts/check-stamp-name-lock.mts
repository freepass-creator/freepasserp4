/**
 * 정제칸이 차명·연료와 어긋난 줄(A6 TFSI → A6 e-트론)을 전수검사한다.
 * 원자 가드 + 공급사 「프리패스 재고」 전 시트. 독이 있으면 exit 1.
 *
 *   npx tsx scripts/check-stamp-name-lock.mts
 *   npx tsx scripts/check-stamp-name-lock.mts --unit
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { companyAlias } from '../lib/domain/identity';
import {
  assertNameLockGuards,
  atomConflictsName,
  fuelFromVehicle,
  fuelKey,
  leftoverConflicts,
  nk,
  S,
} from '../lib/domain/encar-spec-fill';
import {
  ENCAR_MODEL_KEY_COLUMN,
  ENCAR_TRIM_KEY_COLUMN,
  SHEET_NAME_MATCH,
  isOurNonInventoryTab,
  supplierSheetLabel,
} from '../lib/domain/supplier-template-sheet';
import { loadEncarMasterPayload } from '../lib/domain/encar-master-sheet';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';
import { projectSourceRow } from '../lib/domain/mirror-sheet-mapping';
import { SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const UNIT = process.argv.includes('--unit');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});
const call = async (u: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 220)}`);
  }
};

type Atom = { t: string; m: string; sm: string; model: string; modelName: string; sub: string; fuel: string };
const zip = (headers: string[], row: (string | number)[]) => {
  const o: Rec = {};
  headers.forEach((h, i) => { o[h] = row[i]; });
  return o;
};
const atomsPayload = UNIT
  ? JSON.parse(readFileSync('C:\\Users\\admin\\encar-market-survey\\reports\\atom_draft_rows.json', 'utf8'))
  : await loadEncarMasterPayload(call as (u: string) => Promise<Record<string, unknown>>);
const ATOM_ROWS: Atom[] = atomsPayload.values.map((r: (string | number)[]) => {
  const o = zip(atomsPayload.headers, r);
  return {
    t: S(o['세부트림행키']) || S(o['트림행키']),
    m: S(o['모델행키']),
    sm: S(o['세부모델행키']),
    model: nk(o['1차모델']),
    modelName: S(o['1차모델']),
    sub: nk(o['세부모델']),
    fuel: fuelKey(o['연료']),
  };
}).filter((a: Atom) => a.t);
assertNameLockGuards();
console.log('✓ 이름·연료 가드(단위) 통과');
if (UNIT) process.exit(0);

type Hit = {
  who: string; plate: string; status: string; kind: string; why: string;
  모델명: string; 차명: string; 모델: string; 세부모델: string; 연료: string; 연료정제: string; M: string; T: string;
};
const poison: Hit[] = [];
const shortName: Hit[] = [];
const sourceDrift: Hit[] = [];
const byWho = new Map<string, { cars: number; poison: number; short: number }>();

const pick = (row: string[], at: Map<string, number>, names: string[]) => {
  for (const n of names) { const i = at.get(n); if (i !== undefined && S(row[i])) return S(row[i]); }
  return '';
};
const bump = (who: string, cars = 0, p = 0, s = 0) => {
  const cur = byWho.get(who) || { cars: 0, poison: 0, short: 0 };
  cur.cars += cars; cur.poison += p; cur.short += s;
  byWho.set(who, cur);
};

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const listed = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const targets = ((listed.files || []) as Rec[]).map((f) => ({
  id: S(f.id),
  name: companyAlias(supplierSheetLabel(f.name)) || supplierSheetLabel(f.name),
})).sort((a, b) => a.name.localeCompare(b.name, 'ko'));

console.log(`■ 정제칸 전수검사 — ${targets.length}곳`);
for (const t of targets) {
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}?fields=sheets.properties(title,hidden)`);
  const titles = ((meta.sheets || []) as Rec[])
    .map((s) => s.properties)
    .filter((p) => p && !p.hidden && S(p.title) && !isOurNonInventoryTab(p.title))
    .map((p) => S(p.title));
  if (!titles.length) continue;
  const qs = titles.map((x) => `ranges=${encodeURIComponent(`'${x.replace(/'/g, "''")}'`)}`).join('&');
  let got: Rec;
  try { got = await call(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}/values:batchGet?${qs}&majorDimension=ROWS`); }
  catch (e) { console.log(`  ✗ ${t.name} — ${(e as Error).message.slice(0, 80)}`); continue; }
  ((got.valueRanges || []) as Rec[]).forEach((vr) => {
    const grid = ((vr.values || []) as string[][]);
    const hRow = grid.findIndex((r) => (r || []).some((c) => /차량번호|차번/.test(S(c))));
    if (hRow < 0) return;
    const hdr = (grid[hRow] || []).map((c) => S(c).replace(/\s+/g, ''));
    const at = new Map(hdr.map((h, i) => [h, i]));
    const plateAt = at.get('차량번호') ?? -1;
    if (plateAt < 0) return;
    for (const row of grid.slice(hRow + 1)) {
      const plate = S(row[plateAt]);
      if (!plate) continue;
      bump(t.name, 1);
      const carName = pick(row, at, ['차명(세부모델+트림)']);
      const search = pick(row, at, ['모델명']);
      const refine = pick(row, at, ['모델']);
      const sub = pick(row, at, ['세부모델']);
      const leftFuel = pick(row, at, ['연료']);
      const refFuel = pick(row, at, ['연료(정제)']);
      const status = pick(row, at, ['상태']);
      const mCode = pick(row, at, [ENCAR_MODEL_KEY_COLUMN]);
      const tCode = pick(row, at, [ENCAR_TRIM_KEY_COLUMN]);
      const opt = pick(row, at, ['옵션']);
      const ctxModel = nk(search) || nk(refine);
      const nameHay = nk(`${carName} ${opt}`);
      const fuel = fuelFromVehicle(leftFuel, carName, '');
      const tAtom = tCode ? ATOM_ROWS.find((a) => a.t === tCode) : undefined;
      const reasons: string[] = [];
      if (leftoverConflicts(refine, nameHay, fuel, ctxModel, 'model')) reasons.push(`모델「${refine}」≠차명`);
      if (leftoverConflicts(sub, nameHay, fuel, ctxModel, 'sub')) reasons.push(`세부모델「${sub}」≠차명`);
      if (tAtom && atomConflictsName(tAtom, nameHay, fuel, ctxModel)) reasons.push(`T ${tCode} ${tAtom.modelName}≠차명`);
      const ofM = mCode ? ATOM_ROWS.filter((a) => a.m === mCode) : [];
      if (ofM.length && ofM.every((a) => atomConflictsName(a, nameHay, fuel, ctxModel))) reasons.push(`M ${mCode} ${ofM[0].modelName}≠차명`);
      const rf = fuelKey(refFuel);
      if (fuel && rf && fuel !== rf && (fuel === '전기' || rf === '전기')) reasons.push(`연료 ${leftFuel||fuel} vs 정제 ${refFuel}`);
      const hit = (kind: string, why: string): Hit => ({
        who: t.name, plate, status, kind, why, 모델명: search, 차명: carName.slice(0, 48),
        모델: refine, 세부모델: sub, 연료: leftFuel, 연료정제: refFuel, M: mCode, T: tCode,
      });
      if (reasons.length) {
        poison.push(hit('poison', reasons.join(' · ')));
        bump(t.name, 0, 1);
      }
      const nameOnly = nk(carName);
      if (search && nameOnly && (nameOnly === nk(search) || nameOnly === nk(`${pick(row, at, ['제조사'])} ${search}`))) {
        shortName.push(hit('short', '차명이 모델명만 — 트림 없음'));
        bump(t.name, 0, 0, 1);
      }
    }
  });
  const st = byWho.get(t.name);
  console.log(`  ${t.name.padEnd(12)} ${String(st?.cars || 0).padStart(4)}대  독 ${st?.poison || 0}  차명짧음 ${st?.short || 0}`);
  await sleep(200);
}

console.log('\n■ 정제시트 원본 차명 대조');
for (const m of MIRROR_SOURCES.filter((x) => x.kind === 'sheet' && x.from)) {
  const to = targets.find((t) => t.id === m.to);
  const who = to?.name || m.name;
  try {
    const grid = await call(`https://sheets.googleapis.com/v4/spreadsheets/${m.from}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`);
    const read = readSupplierSheet(grid as never, { partner_code: m.code } as EntityRecord);
    const src = new Map<string, string>();
    for (const tab of read.tabs) {
      const hdr = (tab.table[0] || []).map(S);
      const pi = hdr.findIndex((h) => /^차량번호$|^차번$/.test(h.replace(/\s+/g, '')));
      if (pi < 0) continue;
      for (const r of tab.table.slice(1)) {
        const plate = S(r[pi]).replace(/\s+/g, '');
        if (!plate || src.has(plate)) continue;
        const raw = new Map<string, string>();
        hdr.forEach((h, i) => { if (S(h)) raw.set(h.replace(/\s+/g, ''), S(r[i])); });
        src.set(plate, S(projectSourceRow(raw).get('차명(세부모델+트림)')));
      }
    }
    const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${m.to}/values/${encodeURIComponent("'재고'")}`);
    const rows = ((meta.values || []) as string[][]);
    const hi = rows.findIndex((r) => (r || []).some((c) => S(c).replace(/\s+/g, '') === '차량번호'));
    if (hi < 0) continue;
    const hdr = (rows[hi] || []).map((c) => S(c).replace(/\s+/g, ''));
    const at = (n: string) => hdr.indexOf(n);
    let drift = 0; let live = 0;
    for (const r of rows.slice(hi + 1)) {
      const plate = S(r[at('차량번호')]).replace(/\s+/g, '');
      if (!plate) continue;
      const status = S(r[at('상태')]);
      if (status === '출고불가') continue;
      live++;
      const want = src.get(plate);
      const got = S(r[at('차명(세부모델+트림)')]);
      if (want && nk(want) !== nk(got)) {
        drift++;
        sourceDrift.push({
          who, plate, status, kind: 'source', why: `원본「${want.slice(0, 40)}」 vs 정제「${got.slice(0, 40)}」`,
          모델명: S(r[at('모델명')]), 차명: got.slice(0, 48), 모델: S(r[at('모델')]), 세부모델: S(r[at('세부모델')]),
          연료: S(r[at('연료')]), 연료정제: S(r[at('연료(정제)')]), M: S(r[at(ENCAR_MODEL_KEY_COLUMN)]), T: S(r[at(ENCAR_TRIM_KEY_COLUMN)]),
        });
      }
    }
    console.log(`  ${who.padEnd(12)} 원본 ${src.size} · 출고가능 ${live} · 차명어긋 ${drift}`);
  } catch (e) {
    console.log(`  ✗ ${who} 원본 — ${(e as Error).message.slice(0, 80)}`);
  }
  await sleep(300);
}

const out = { when: new Date().toISOString(), cars: [...byWho.values()].reduce((n, x) => n + x.cars, 0), poison, shortName, sourceDrift, byWho: [...byWho] };
writeFileSync('tmp/stamp-name-lock-audit.json', JSON.stringify(out, null, 2));
console.log(`\n  합 ${out.cars}대 · 독 ${poison.length} · 차명짧음 ${shortName.length} · 원본차명어긋 ${sourceDrift.length}`);
if (poison.length) {
  console.log('  독 목록:');
  for (const h of poison.slice(0, 40)) console.log(`    ${h.who} ${h.plate} 「${h.차명}」 ${h.why}`);
}
if (poison.length) {
  console.log('✗ 정제칸이 차명·연료와 다른 줄이 있다');
  process.exit(1);
}
console.log('✓ 정제칸 독 없음');
