import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { getSupplierAdapter } from '../lib/adapters';
import { SUPPLIER_SOURCES, type SupplierSourceSpec } from '../lib/adapters/source-registry';
import type { FreepassAtom, RawSupplierRow } from '../lib/domain/supplier-adapter';

const S = (v: unknown) => String(v ?? '').trim();
const compact = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (name: string, fallback = '') => {
  const hit = process.argv.find((v) => v.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DUMP = arg('dump', 'tmp/prepublish-main.json');
const SA_PATH = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
const ONLY = new Set(
  arg('only')
    .split(',')
    .map((v) => S(v).toUpperCase())
    .filter(Boolean),
);

// 테스트/비상 점검 때만 어댑터 입력 시트를 덮을 수 있다. 실제 원천 위치 정본은 inventory-source-registry.ts다.
// --only=IANKA,IRON 처럼 쓰면 해당 발행 탭의 실제 소유 공급사만 대조한다.
// F01은 상품리스트/오플구독 등 탭별 발행 대상이 다르므로, 서로 다른 탭을 한 dump에 억지로 찾지 않는다.
const SOURCES = SUPPLIER_SOURCES
  .filter((spec) => !ONLY.size || ONLY.has(spec.code.toUpperCase()) || ONLY.has(spec.partnerCode.toUpperCase()))
  .map((spec) => {
    const key = spec.code.toLowerCase();
    return {
      ...spec,
      spreadsheetId: arg(`${key}-sheet`, spec.spreadsheetId),
      tab: arg(`${key}-tab`, spec.tab),
    };
  });
if (!SOURCES.length) throw new Error(`SSOT gate: --only=${arg('only')} 에 해당하는 공급사가 없습니다.`);

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

function findHeaderRow(values: string[][], pricingMode: SupplierSourceSpec['pricingMode']): number {
  for (let i = 0; i < Math.min(values.length, 40); i++) {
    const h = values[i].map(S);
    const identity = h.includes('차량번호') || h.includes('차번');
    if (!identity) continue;

    const standardHeaders = ['단기보증', '1개월', '6개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월'];
    const standardCount = standardHeaders.filter((c) => h.includes(c)).length;
    if (pricingMode === 'STANDARD_TERMS' && standardCount >= 4) return i;

    const variantCount = h.filter((c) => /^\d+개월\s*\d+만$/.test(c)).length;
    if (pricingMode === 'TERM_MILEAGE_VARIANTS' && variantCount >= 2) return i;
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

function extraFees(v: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const part of S(v).split('|')) {
    if (!part) continue;
    const colon = part.lastIndexOf(':');
    if (colon < 1) continue;
    const name = S(part.slice(0, colon));
    const amount = money(part.slice(colon + 1));
    if (name && amount !== undefined) out.set(name, amount);
  }
  return out;
}

const finance: Array<[string, (atom: FreepassAtom) => number | undefined]> = [
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

let totalChecked = 0;
let totalMatched = 0;
let totalCompared = 0;
const allMismatches: string[] = [];

for (const spec of SOURCES) {
  const adapter = getSupplierAdapter(spec.code);
  const values = await sheetsValues(spec.spreadsheetId, spec.tab);
  const headerAt = findHeaderRow(values, spec.pricingMode);
  if (headerAt < 0) throw new Error(`SSOT gate: ${spec.name} 어댑터 입력에서 차량번호+가격 헤더 행을 찾지 못했습니다.`);
  const headers = values[headerAt].map(S);

  let checked = 0;
  let matched = 0;
  let compared = 0;
  const missingFromPublish: string[] = [];
  const mismatches: string[] = [];

  for (let i = headerAt + 1; i < values.length; i++) {
    const raw = rowObject(headers, values[i]);
    const adapted = adapter.adapt(raw, {
      supplierCode: spec.code,
      supplierName: spec.name,
      spreadsheetId: spec.spreadsheetId,
      tab: spec.tab,
      row: i + 1,
    });
    const atom = adapted.atom;
    const plate = compact(atom.plateNumber);
    if (!plate) continue;
    checked++;

    const out = published[plate];
    if (!out) {
      // 출고불가/미판매는 판매시트에서 빠지는 것이 정상이다.
      missingFromPublish.push(plate);
      continue;
    }
    matched++;

    // 기간 하나만으로 의미가 완전한 금융 필드.
    for (const [column, fromAtom] of finance) {
      const expected = fromAtom(atom);
      // ATOM에 없는 값은 REFINE/정책 단계에서 합법적으로 채울 수 있다.
      // 하지만 원천에 명시된 값은 downstream이 다른 의미/값으로 바꾸면 안 된다.
      if (expected === undefined) continue;
      compared++;
      const actual = money(out[column]);
      if (expected !== actual) {
        mismatches.push(`${plate} ${column}: SOURCE/ATOM=${expected} PUBLISH=${actual ?? '-'}`);
      }
    }

    // 기간+연주행거리 가격축은 F01 '그 밖 요금'에 원본 헤더 이름 그대로 보존되어야 한다.
    if (atom.rentVariants?.length) {
      const extras = extraFees(out['그 밖 요금']);
      for (const variant of atom.rentVariants) {
        compared++;
        const actual = extras.get(variant.sourceHeader);
        if (actual !== variant.amount) {
          mismatches.push(`${plate} ${variant.sourceHeader}: SOURCE/ATOM=${variant.amount} PUBLISH_EXTRA=${actual ?? '-'}`);
        }
      }
    }
  }

  if (!checked) throw new Error(`SSOT gate: ${spec.name} 원천에서 차량을 한 대도 읽지 못했습니다.`);
  if (!matched) throw new Error(`SSOT gate: ${spec.name} 원천 차량이 발행 예정표와 한 대도 매칭되지 않았습니다. 공급사 식별/탭을 확인해야 합니다.`);
  if (!compared) throw new Error(`SSOT gate: ${spec.name} 는 발행 대상이 있지만 SOURCE→ATOM→F01 가격 비교 필드가 0개입니다.`);

  totalChecked += checked;
  totalMatched += matched;
  totalCompared += compared;
  allMismatches.push(...mismatches.map((v) => `${spec.name} ${v}`));

  if (mismatches.length) {
    console.error(`✗ ${spec.name}: 원천 가격과 발행 예정값 ${mismatches.length}칸 불일치`);
  } else {
    console.log(`✓ ${spec.name}: 원천 ${checked}대 중 발행 대상 ${matched}대 · 가격 원자 ${compared}칸 보존`);
  }
  if (missingFromPublish.length) {
    console.log(`  참고: ${spec.name} 원천에는 있으나 판매 예정표에는 없는 차량 ${missingFromPublish.length}대(출고불가/미판매 가능)`);
  }
}

if (allMismatches.length) {
  console.error(`\n✗ SSOT PREPUBLISH BLOCK — 원천에 명시된 가격 원자와 발행 예정값이 ${allMismatches.length}칸 다릅니다.`);
  allMismatches.slice(0, 80).forEach((v) => console.error(`  ${v}`));
  if (allMismatches.length > 80) console.error(`  … 모두 ${allMismatches.length}칸`);
  console.error('  실제 F01/ERP 반영을 중단합니다. SOURCE에 명시된 값 → ADAPTER → ATOM 보존이 우선입니다.');
  process.exit(1);
}

console.log(`\n✓ SSOT PREPUBLISH PASS — ${SOURCES.length}개 공급사, 원천 ${totalChecked}대 / 발행 대상 ${totalMatched}대 / 가격 ${totalCompared}칸 일치`);
