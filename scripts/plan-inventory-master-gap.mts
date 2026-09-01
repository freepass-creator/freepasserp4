/**
 * 현재 재고 → 차종마스터 보강 계획. 읽기 전용. Google Sheet write 0.
 *
 * 코덱스 인수인계 `docs/HANDOFF-차종마스터-상품리스트-완성화-2026-08-21.md`
 *   활성 공급사는 문패 allowlist만. Drive 이름 검색으로 대상을 정하지 않는다.
 *   [구버전·폐기] 제외. 숨김 행/탭은 readSupplierSheet 규격.
 *
 *   npx tsx scripts/plan-inventory-master-gap.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { HUB_CODE_SHEET_ID, ENCAR_MASTER_SHEET_ID, isLegacySheetId } from '../lib/domain/legacy-sheets';
import { LEGACY_SHEET_PREFIX, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { SHEET_GRID_FIELDS, findPlateAndStatusColumns, readSupplierSheet, sheetIdFromUrl } from '../lib/domain/supplier-sheet-read';
import { snapToMaster } from '../lib/domain/vehicle-master-match';
import { canonMakerDisplay } from '../lib/domain/maker-display';
import type { EntityRecord } from '../lib/intake/entities';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const fold = (v: unknown) => S(v).normalize('NFC').replace(/\s+/g, ' ');
const key = (v: unknown) => fold(v).toLowerCase().replace(/[()（）\-_.·,/]/g, '');
const plate = (v: unknown) => S(v).replace(/\s/g, '');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;

const api = async (url: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${gT}` } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) {
      const wait = Math.min(60_000, 5_000 * 2 ** n);
      console.log(`  … ${res.status} — ${Math.round(wait / 1000)}초 쉬고 다시`);
      await new Promise((ok) => setTimeout(ok, wait));
      continue;
    }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};

const cell = (hdr: string[], row: string[], names: string[]) => {
  for (const name of names) {
    const i = hdr.findIndex((h) => h === name || h.replace(/\s/g, '') === name.replace(/\s/g, ''));
    if (i >= 0 && S(row[i])) return S(row[i]);
  }
  return '';
};

const master = ((JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec).entries || []) as MasterEntry[];
const jsonSubs = new Set(master.map((e) => key(e.sub_model)));

type EncarSpec = { sub: string; fuels: Set<string> };
const encar = new Map<string, EncarSpec>();
{
  const rows = ((await api(`https://sheets.googleapis.com/v4/spreadsheets/${ENCAR_MASTER_SHEET_ID}/values/${encodeURIComponent('차종마스터!A1:AB5000')}`)).values || []) as string[][];
  const h = (rows[0] || []).map(S);
  const si = h.findIndex((c) => c === '세부모델');
  const fi = h.findIndex((c) => c === '연료');
  for (const r of rows.slice(1)) {
    const sub = S(r[si]);
    if (!sub) continue;
    const cur = encar.get(key(sub)) || { sub, fuels: new Set<string>() };
    if (S(r[fi])) cur.fuels.add(S(r[fi]));
    encar.set(key(sub), cur);
  }
  console.log(`■ 엔카 원자 세부모델 ${encar.size}종 · json 이름 ${jsonSubs.size}종`);
}

type Row = {
  bucket: 'AUTO' | 'ALIAS' | 'ATOM_ADD' | 'HOLD';
  supplier: string;
  code: string;
  plate: string;
  rawName: string;
  maker: string;
  model: string;
  sub: string;
  fuel: string;
  cc: string;
  seats: string;
  drive: string;
  year: string;
  snapSub: string;
  snapConf: string;
  reason: string;
  atomKey: string;
};

const docs = new Map<string, { id: string; codes: string[]; names: string[] }>();
{
  const idx = await api(`https://sheets.googleapis.com/v4/spreadsheets/${HUB_CODE_SHEET_ID}/values/A1:Z300`) as { values?: string[][] };
  for (const r of (idx.values || []) as string[][]) {
    const code = S(r[1]);
    const url = S(r[2]);
    const id = sheetIdFromUrl(url);
    if (!code || !id || !/^https?:/.test(url)) continue;
    if (isLegacySheetId(id)) continue;
    const cur = docs.get(id) || { id, codes: [], names: [] };
    if (!cur.codes.includes(code)) cur.codes.push(code);
    const name = S(r[0]);
    if (name && !cur.names.includes(name)) cur.names.push(name);
    docs.set(id, cur);
  }
}

const cars: Row[] = [];
const skipped: string[] = [];
console.log(`■ 문패 allowlist ${docs.size}문서 · 코드 ${[...docs.values()].reduce((n, d) => n + d.codes.length, 0)}개`);

for (const doc of [...docs.values()].sort((a, b) => a.codes[0].localeCompare(b.codes[0]))) {
  let grid: Rec;
  try {
    grid = await api(`https://sheets.googleapis.com/v4/spreadsheets/${doc.id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`);
  } catch (e) {
    skipped.push(`${doc.codes.join(',')} 못 읽음 ${(e as Error).message.slice(0, 80)}`);
    continue;
  }
  const title = S(grid.properties?.title);
  if (title.startsWith(LEGACY_SHEET_PREFIX) || /구버전/.test(title)) {
    skipped.push(`${title} — 구버전 제외`);
    continue;
  }
  const who = supplierSheetLabel(title) || doc.names[0] || doc.codes[0];
  const read = readSupplierSheet(grid as never, { partner_code: doc.codes[0], partner_name: who } as EntityRecord);
  for (const fail of read.failures) {
    if (isOurNonInventoryTab(fail.title) || /운영정책|공지사항|회사정보/.test(fail.title)) continue;
    skipped.push(`${who} ${fail.title}: ${fail.reason}`);
  }
  for (const tab of read.tabs) {
    if (isOurNonInventoryTab(tab.title) || !/재고$/.test(tab.title)) continue;
    const hdr = (tab.table[0] || []).map(S);
    const { plate: pi, status: sti } = findPlateAndStatusColumns(hdr);
    if (pi < 0) continue;
    for (const raw of tab.table.slice(1)) {
      const row = raw.map(S);
      const pl = plate(row[pi]);
      if (!pl) continue;
      const status = sti >= 0 ? S(row[sti]) : '';
      if (/출고불가|판매완료|말소/.test(status)) continue;
      const rawName = cell(hdr, row, ['차명(세부모델+트림)', '차명', '세부모델']);
      const maker = canonMakerDisplay(cell(hdr, row, ['제조사(정제)', '제조사']));
      const model = cell(hdr, row, ['모델', '모델명', '차종']);
      const sub = cell(hdr, row, ['세부모델']);
      const fuel = cell(hdr, row, ['연료(정제)', '연료', '파워트레인']);
      const cc = cell(hdr, row, ['배기량(정제)', '배기량']);
      const seats = cell(hdr, row, ['인승']);
      const drive = cell(hdr, row, ['구동방식', '구동']);
      const year = cell(hdr, row, ['연식', '최초등록일', '최초등록']);
      const trim = cell(hdr, row, ['세부트림', '트림']);
      const rec = {
        maker, model: model || sub, sub_model: sub || rawName, vehicle_name: rawName,
        fuel_type: fuel, year: year.replace(/\D/g, '').slice(0, 4),
        seats, drive_type: drive, trim_name: trim,
      } as EntityRecord;
      const snap = snapToMaster(rec, master);
      const snapSub = S(snap?.sub_model);
      const snapConf = S(snap?.confidence);
      const atomKey = [key(maker || snap?.maker), key(model || snap?.model), key(snapSub || sub || rawName), key(fuel || snap?.fuel_type), key(cc), key(seats || snap?.seats), key(drive || snap?.drive_type)].join('|');
      cars.push({
        bucket: 'HOLD', supplier: who, code: doc.codes.join('+'), plate: pl, rawName, maker, model, sub,
        fuel, cc, seats, drive, year, snapSub, snapConf, reason: '', atomKey,
      });
    }
  }
  console.log(`  ${who}  코드 ${doc.codes.join('+')}  누적 ${cars.length}대`);
}

const groups = new Map<string, Row[]>();
for (const c of cars) {
  const g = groups.get(c.atomKey) || [];
  g.push(c);
  groups.set(c.atomKey, g);
}

const adPrefix = /디\s*올\s*뉴|올\s*뉴|the\s*all\s*new|더\s*뉴/i;
const genMarker = /(?:\bfl\b|페이스\s*리프트|부분변경|디\s*엣지|엣지)/i;
for (const c of cars) {
  const inJson = jsonSubs.has(key(c.snapSub)) || jsonSubs.has(key(c.sub));
  const inEncar = encar.has(key(c.snapSub)) || encar.has(key(c.sub));
  const raw = key(c.rawName + c.sub);
  const canon = key(c.snapSub);
  const aliasLike = !!(canon && raw && raw !== canon && (adPrefix.test(c.rawName) || adPrefix.test(c.sub) || raw.includes(canon) || canon.includes(raw.replace(/디올뉴|올뉴|더뉴|기아|현대/g, ''))));
  const genShift = genMarker.test(`${c.rawName} ${c.sub}`) && !genMarker.test(c.snapSub);
  const axes = [c.fuel, c.cc, c.seats, c.maker, c.rawName || c.sub].filter(Boolean).length;
  const group = groups.get(c.atomKey) || [];
  const uniquePlates = new Set(group.map((x) => x.plate));
  const fuels = new Set(group.map((x) => key(x.fuel)).filter(Boolean));
  const conflict = fuels.size > 1;

  if (genShift) {
    if (uniquePlates.size >= 2 && !conflict) {
      c.bucket = 'ATOM_ADD';
      c.reason = `원문에 세대표기(FL/엣지)가 있는데 스냅은 「${c.snapSub || '없음'}」 — 다른 차번 ${uniquePlates.size}대 반복`;
    } else {
      c.bucket = 'HOLD';
      c.reason = `원문에 세대표기(FL/엣지)가 있는데 스냅은 「${c.snapSub || '없음'}」 — 비슷한 세대로 붙이지 않음`;
    }
    continue;
  }
  if ((c.snapConf === 'high' || c.snapConf === 'medium') && inJson) {
    if (aliasLike && c.sub && key(c.sub) !== canon) {
      c.bucket = 'ALIAS';
      c.reason = `원문 「${c.sub || c.rawName}」 → json 「${c.snapSub}」`;
    } else {
      c.bucket = 'AUTO';
      c.reason = inEncar ? '이름사전·엔카 원자 모두 있음' : '이름사전은 있고 엔카 원자는 없음';
    }
    continue;
  }
  if (!c.snapSub || c.snapConf === 'low') {
    if (axes < 3) { c.bucket = 'HOLD'; c.reason = '원문 축 부족'; continue; }
    if (conflict) { c.bucket = 'HOLD'; c.reason = `같은 조합 연료 충돌 ${[...fuels].join('/')}`; continue; }
    if (uniquePlates.size >= 2) {
      c.bucket = 'ATOM_ADD';
      c.reason = `다른 차번 ${uniquePlates.size}대에서 같은 원자 반복`;
      continue;
    }
    c.bucket = 'HOLD';
    c.reason = c.snapSub ? `스냅 저신뢰(${c.snapConf} → ${c.snapSub}) · 반복 1대` : '스냅 없음 · 반복 1대';
    continue;
  }
  c.bucket = 'HOLD';
  c.reason = '후보 불명';
}

const counts = { AUTO: 0, ALIAS: 0, ATOM_ADD: 0, HOLD: 0 };
for (const c of cars) counts[c.bucket]++;
mkdirSync('tmp', { recursive: true });
const out = {
  generated: new Date().toISOString(),
  docs: docs.size,
  codes: [...docs.values()].reduce((n, d) => n + d.codes.length, 0),
  cars: cars.length,
  counts,
  skipped,
  note: 'Google Sheet write 0. ATOM_ADD/ALIAS는 사람 승인 후에만 마스터·정제칸에 반영.',
  rows: cars,
};
writeFileSync('tmp/inventory-master-gap.json', JSON.stringify(out, null, 2));
const csvHead = ['bucket', 'supplier', 'code', 'plate', 'rawName', 'maker', 'model', 'sub', 'fuel', 'cc', 'seats', 'drive', 'year', 'snapSub', 'snapConf', 'reason'];
const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
writeFileSync('tmp/inventory-master-gap.csv', [csvHead.join(','), ...cars.map((c) => csvHead.map((k) => esc((c as Rec)[k])).join(','))].join('\n'));
console.log(`\n■ 판매가능 ${cars.length}대 — AUTO ${counts.AUTO} · ALIAS ${counts.ALIAS} · ATOM_ADD ${counts.ATOM_ADD} · HOLD ${counts.HOLD}`);
console.log(`  tmp/inventory-master-gap.json · tmp/inventory-master-gap.csv`);
if (skipped.length) console.log(`  건너뜀 ${skipped.length}\n${skipped.slice(0, 12).map((s) => `    ${s}`).join('\n')}`);
