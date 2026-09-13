import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { iankaAdapter } from '../lib/adapters/ianka';
import type { RawSupplierRow } from '../lib/domain/supplier-adapter';

const S = (v: unknown) => String(v ?? '').trim();
const compact = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (name: string, fallback = '') => {
  const hit = process.argv.find((v) => v.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DUMP = arg('dump', 'tmp/prepublish-main.json');
const IANKA_SOURCE_SHEET = arg('ianka-sheet', '1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs');
const IANKA_SOURCE_TAB = arg('ianka-tab', '이안카');
const SA_PATH = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';

type DumpShape = {
  columns?: string[];
  rows?: Record<string, Record<string, unknown>>;
};

const dump = JSON.parse(readFileSync(DUMP, 'utf8')) as DumpShape;
const published = dump.rows || {};
if (!Object.keys(published).length) throw new Error(`SSOT gate: ${DUMP} 에 발행 예정 행이 없습니다.`);

const sa = JSON.parse(readFileSync(SA_PATH, 'utf8')) as { client_email: string; private_key: string };
const token = (await new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
}).getAccessToken()).token;
if (!token) throw new Error('SSOT gate: Google access token 발급 실패');

async function sheetsValues(spreadsheetId: string, tab: string): Promise<string[][]> {
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`SSOT gate: 원천 시트 읽기 실패 ${res.status} ${await res.text()}`);
  const body = await res.json() as { values?: string[][] };
  return body.values || [];
}

function findHeaderRow(values: string[][]): number {
  for (let i = 0; i < Math.min(values.length, 40); i++) {
    const h = values[i].map(S);
    const identity = h.includes('차량번호') || h.includes('차번');
    const money = ['단기보증', '1개월', '6개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월']
      .filter((c) => h.includes(c)).length;
    if (identity && money >= 4) return i;
  }
  return -1;
}

function rowObject(headers: string[], row: string[]): RawSupplierRow {
  const out: RawSupplierRow = {};
  headers.forEach((h, i) => { if (h) out[h] = row[i] ?? ''; });
  return out;
}

function money(v: unknown): number | undefined {
  const raw = S(v);
  if (!raw || /^(?:-|—|―|x|불가|불가능|없음|미운영|미판매|해당없음|n\/a)$/i.test(raw)) return undefined;
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const values = await sheetsValues(IANKA_SOURCE_SHEET, IANKA_SOURCE_TAB);
const headerAt = findHeaderRow(values);
if (headerAt < 0) throw new Error('SSOT gate: 이안카 원천에서 차량번호+금융 헤더 행을 찾지 못했습니다.');
const headers = values[headerAt].map(S);

const finance: Array<[string, (atom: ReturnType<typeof iankaAdapter.adapt>['atom']) => number | undefined]> = [
  ['단기보증', (a) => a.shortDeposit],
  ['1개월', (a) => a.rent[1]],
  ['6개월', (a) => a.rent[6]],
  ['12개월', (a) => a.rent[12]],
  ['장기보증', (a) => a.longDeposit],
  ['24개월', (a) => a.rent[24]],
  ['36개월', (a) => a.rent[36]],
  ['48개월', (a) => a.rent[48]],
  ['60개월', (a) => a.rent[60]],
];

let checked = 0;
let matched = 0;
const mismatches: string[] = [];
const missingFromPublish: string[] = [];

for (let i = headerAt + 1; i < values.length; i++) {
  const raw = rowObject(headers, values[i]);
  const adapted = iankaAdapter.adapt(raw, {
    supplierCode: 'IANKA',
    supplierName: '이안카',
    spreadsheetId: IANKA_SOURCE_SHEET,
    tab: IANKA_SOURCE_TAB,
    row: i + 1,
  });
  const atom = adapted.atom;
  const plate = compact(atom.plateNumber);
  if (!plate) continue;
  checked++;

  const out = published[plate];
  if (!out) {
    // 출고불가/미판매 등은 판매시트에서 빠지는 것이 정상일 수 있으므로 정보만 기록한다.
    missingFromPublish.push(plate);
    continue;
  }
  matched++;

  for (const [column, fromAtom] of finance) {
    const expected = fromAtom(atom);
    const actual = money(out[column]);
    if (expected === undefined && actual === undefined) continue;
    if (expected !== actual) {
      mismatches.push(`${plate} ${column}: SOURCE/ATOM=${expected ?? '-'} PUBLISH=${actual ?? '-'}`);
    }
  }
}

if (!checked) throw new Error('SSOT gate: 이안카 원천에서 차량을 한 대도 읽지 못했습니다.');
if (!matched) throw new Error('SSOT gate: 이안카 원천 차량이 발행 예정표와 한 대도 매칭되지 않았습니다. 공급사 식별/탭을 확인해야 합니다.');

if (mismatches.length) {
  console.error(`\n✗ SSOT PREPUBLISH BLOCK — 이안카 금융 원자와 발행 예정값이 ${mismatches.length}칸 다릅니다.`);
  mismatches.slice(0, 40).forEach((v) => console.error(`  ${v}`));
  if (mismatches.length > 40) console.error(`  … 모두 ${mismatches.length}칸`);
  console.error('  실제 F01/ERP 반영을 중단합니다. SOURCE → ADAPTER → ATOM 값이 정본입니다.');
  process.exit(1);
}

console.log(`✓ SSOT PREPUBLISH PASS — 이안카 원천 ${checked}대 중 발행 대상 ${matched}대 금융 원자 일치`);
if (missingFromPublish.length) {
  console.log(`  참고: 원천에는 있으나 판매 예정표에는 없는 차량 ${missingFromPublish.length}대(출고불가/미판매 가능)`);
}
