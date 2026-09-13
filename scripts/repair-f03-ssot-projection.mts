import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  driveConflicts,
  explicitDriveFromSource,
  normalizeF03CanonicalRow,
  resolveF03Projection,
  stripF03Parentheses,
  type F03CanonicalRow,
} from '../lib/domain/f03-canonical-projection';
import { composeRefinedVehicleName } from '../lib/domain/vehicle-class';

const APPLY = process.argv.includes('--apply');
const ONLY = String(process.argv.find((a) => a.startsWith('--who=')) || '').slice('--who='.length).trim();
const F03_ID = '1oMB9eoNnQFxUyRK4CSxYh_hKrtCf7s_79xLs-GYwXCE';
const F03_TAB = '차종마스터';
const HUB_ID = '1cRn_XbuJXQMlVCATtDN4EpQy-KVEi65tCwcvCxdFk8w';
const HUB_TAB = '공급사연동';
const S = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');

const saPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(saPath, 'utf8'));
const token = (await new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;

const api = async (url: string, init?: RequestInit): Promise<any> => {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((ok) => setTimeout(ok, Math.min(30_000, 2_000 * (2 ** attempt))));
      continue;
    }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};

const q = (tab: string, range: string) => encodeURIComponent(`'${tab.replace(/'/g, "''")}'!${range}`);
const readRange = async (id: string, tab: string, range: string) => {
  const body = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${q(tab, range)}`);
  return (body.values || []) as string[][];
};
const colA1 = (i: number) => {
  let out = '';
  for (let n = i + 1; n > 0;) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};
const tabA1 = (t: string) => `'${t.replace(/'/g, "''")}'`;
const sheetIdFromUrl = (url: unknown) => /\/spreadsheets\/d\/([\w-]+)/.exec(S(url))?.[1] || '';

const batchValues = async (spreadsheetId: string, data: { range: string; values: string[][] }[]) => {
  if (!APPLY || !data.length) return;
  for (let i = 0; i < data.length; i += 400) {
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: data.slice(i, i + 400) }),
    });
  }
};

console.log(`\n── F03 → SUPPLIER SSOT ${APPLY ? 'APPLY' : 'DRY-RUN'} ──`);

// 1) F03 자체를 FreePass 표기 규칙으로 정규화한다.
const f03Values = await readRange(F03_ID, F03_TAB, 'A1:O2000');
if (!f03Values.length) throw new Error('F03 차종마스터를 읽지 못했습니다.');
const f03Header = f03Values[0].map(S);
const fAt = (name: string) => f03Header.indexOf(name);
const fMaker = fAt('제조사');
const fModel = fAt('모델');
const fSub = fAt('세부모델');
const fTrim = fAt('세부트림');
if ([fMaker, fModel, fSub, fTrim].some((i) => i < 0)) throw new Error('F03 이름축 헤더가 없습니다.');

const masterRows: F03CanonicalRow[] = [];
const f03Updates: { range: string; values: string[][] }[] = [];
const f03Samples: string[] = [];
for (let r = 1; r < f03Values.length; r++) {
  const row = f03Values[r] || [];
  const before: F03CanonicalRow = {
    maker: S(row[fMaker]), model: S(row[fModel]), subModel: S(row[fSub]), trim: S(row[fTrim]),
  };
  if (!before.model) continue;
  const after = normalizeF03CanonicalRow(before);
  masterRows.push(after);
  const axis: [number, string, string][] = [
    [fMaker, before.maker, after.maker],
    [fModel, before.model, after.model],
    [fSub, before.subModel, after.subModel],
    [fTrim, before.trim, after.trim],
  ];
  for (const [ci, oldValue, newValue] of axis) {
    if (newValue && oldValue !== newValue) {
      f03Updates.push({ range: `${tabA1(F03_TAB)}!${colA1(ci)}${r + 1}`, values: [[newValue]] });
      if (f03Samples.length < 25) f03Samples.push(`F03 ${r + 1}행 ${before.maker} ${before.model}: 「${oldValue}」 → 「${newValue}」`);
    }
  }
}
console.log(`F03 ${masterRows.length}행 · 표기 보정 ${f03Updates.length}칸`);
for (const s of f03Samples) console.log(`  ${s}`);
await batchValues(F03_ID, f03Updates);

// 2) 활성 공급사 정제시트를 전부 읽어 F03 이름축과 맞춘다.
const hub = await readRange(HUB_ID, HUB_TAB, 'A1:L100');
const targets = hub.slice(1).map((r) => ({
  name: S(r[0]), code: S(r[1]), id: sheetIdFromUrl(r[9]),
})).filter((x) => x.id && x.code && x.code !== '-' && (!ONLY || x.name.includes(ONLY) || x.code === ONLY));

let scannedCars = 0;
let projectedCars = 0;
let changedCells = 0;
let driveRepairs = 0;
let unresolved = 0;
const samples: string[] = [];

for (const target of targets) {
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${target.id}?fields=sheets.properties(title,sheetType,gridProperties)`);
  const tabs = (meta.sheets || []).map((s: any) => s.properties).filter((p: any) => p.sheetType === 'GRID');
  let supplierChanges = 0;
  for (const p of tabs) {
    const title = S(p.title);
    const first = await readRange(target.id, title, 'A1:BC1').catch(() => [] as string[][]);
    const header = (first[0] || []).map(S);
    const at = (name: string) => header.indexOf(name);
    if (at('차량번호') < 0 || at('모델') < 0 || at('세부모델') < 0 || at('제조사(정제)') < 0) continue;
    const maxRows = Math.min(Number(p.gridProperties?.rowCount || 1000), 3000);
    const values = await readRange(target.id, title, `A1:BC${maxRows}`);
    const updates: { range: string; values: string[][] }[] = [];
    const get = (row: string[], ...names: string[]) => {
      for (const name of names) {
        const i = at(name);
        if (i >= 0 && S(row[i])) return S(row[i]);
      }
      return '';
    };
    const set = (rowNo: number, row: string[], name: string, value: string, plate: string, reason: string) => {
      const i = at(name);
      if (i < 0 || !value || S(row[i]) === value) return;
      updates.push({ range: `${tabA1(title)}!${colA1(i)}${rowNo}`, values: [[value]] });
      supplierChanges++;
      changedCells++;
      if (samples.length < 40) samples.push(`${target.name}/${title} ${plate} ${name}: 「${S(row[i])}」 → 「${value}」 (${reason})`);
    };

    for (let ri = 1; ri < values.length; ri++) {
      const row = values[ri] || [];
      const plate = get(row, '차량번호');
      if (!plate) continue;
      scannedCars++;
      const maker = get(row, '제조사(정제)', '제조사');
      const sourceModel = get(row, '모델명', '차종', '모델');
      const refinedModel = get(row, '모델');
      const refinedSubModel = get(row, '세부모델');
      const rawName = get(row, '차명(세부모델+트림)', '차명', '모델명');
      const rawFuel = get(row, '연료');
      const projection = resolveF03Projection(masterRows, { maker, sourceModel, refinedModel, refinedSubModel, rawName, rawFuel });
      if (!projection.matched) {
        unresolved++;
      } else {
        projectedCars++;
        const rowNo = ri + 1;
        set(rowNo, row, '제조사(정제)', projection.maker, plate, projection.reason);
        set(rowNo, row, '모델', projection.model, plate, projection.reason);
        set(rowNo, row, '세부모델', projection.subModel, plate, projection.reason);
        if (projection.trim) set(rowNo, row, '세부트림', projection.trim, plate, projection.reason);
        const display = composeRefinedVehicleName(projection.model, projection.subModel, projection.trim || get(row, '세부트림'));
        set(rowNo, row, '차명(정제)', display, plate, projection.reason);
      }

      // 공급사 원문이 명시한 구동은 마스터/과거 정제값이 반대로 바꿀 수 없다.
      const rawDrive = explicitDriveFromSource([rawName, get(row, '옵션'), get(row, '점검사항')].join(' '));
      const currentDrive = get(row, '구동방식');
      if (rawDrive && (!currentDrive || driveConflicts(rawDrive, currentDrive))) {
        set(ri + 1, row, '구동방식', rawDrive, plate, 'SOURCE_DRIVE_WINS');
        if (!currentDrive || driveConflicts(rawDrive, currentDrive)) driveRepairs++;
      }
    }
    await batchValues(target.id, updates);
  }
  if (supplierChanges) console.log(`${target.name}(${target.code}) 보정 ${supplierChanges}칸`);
}

console.log(`\n차량 ${scannedCars}대 스캔 · F03 확정투영 ${projectedCars}대 · 미확정 ${unresolved}대`);
console.log(`공급사 SSOT 보정 ${changedCells}칸 · 원문 구동 충돌/누락 복구 ${driveRepairs}건`);
for (const s of samples) console.log(`  ${s}`);
console.log(APPLY ? '\n✓ F03 → 공급사 SSOT 반영 완료\n' : '\nDRY-RUN — 실제 반영은 --apply\n');
