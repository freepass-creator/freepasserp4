/**
 * 차대번호(VIN)가 **들어오고 안 나가는지** 검증.
 * 실행: npx tsx scripts/sim-vin-flow.mts
 *
 * 2026-08-09 사장님 지시로 공급사 시트에 차대번호 칸을 넣었다.
 * VIN 은 차종 매칭의 가장 좋은 열쇠지만 밖에 주면 안 되는 열쇠다 —
 * 그 하나로 사고·정비 이력과 소유 관계 조회가 열린다.
 * 그래서 **받는 길은 열고 나가는 길은 다 막혔는지**를 여기서 못 박는다.
 */
import { autoMapHeaders } from '../lib/domain/sheet-import';
import { stripSheetPrivatePatchFields } from '../lib/domain/sheet-merge';
import { PRODUCT_SHEET_COLUMNS, productSheetRow } from '../lib/domain/product-sheet-export';
import { HEADERS } from '../lib/domain/inventory-sheet-export';
import { sanitizeProductForGuest } from '../lib/domain/public-catalog';
import type { EntityRecord } from '../lib/intake/entities';

let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, JSON.stringify(detail ?? '')); }
};

const VIN = 'KMHL341ABPA123456';

// ── 들어오는 길 ─────────────────────────────────────────────
const map = autoMapHeaders(['차량번호', '차대번호', '모델', '연식']);
check('시트 헤더 「차대번호」를 vin 으로 읽는다', map.vin === 1, map);
for (const label of ['차대', 'VIN', '제조번호']) {
  const m = autoMapHeaders(['차량번호', label]);
  check(`헤더 「${label}」도 vin 으로 읽는다`, m.vin === 1, m);
}

// ★여기가 오늘 고친 곳 — 예전엔 원가·계좌와 같이 묶여 저장 직전에 버려졌다.
const kept = stripSheetPrivatePatchFields({ vin: VIN, car_number: '12가3456' } as EntityRecord);
check('★시트에서 온 VIN 이 저장까지 살아남는다', kept.vin === VIN, kept);

// 원가·계좌는 여전히 시트가 못 쓴다 — 그건 우리 영업 비밀이다.
const stripped = stripSheetPrivatePatchFields({
  vin: VIN, vehicle_price: 30000000, account_number: '123-456',
} as EntityRecord);
check('원가는 여전히 막혀 있다', stripped.vehicle_price === undefined, stripped);
check('계좌도 여전히 막혀 있다', stripped.account_number === undefined, stripped);

// ── 나가는 길 — 전부 막혀 있어야 한다 ──────────────────────
const labels = PRODUCT_SHEET_COLUMNS.map((c) => c.label);
check('공급사 표준시트에는 차대번호 칸이 있다', labels.includes('차대번호'), labels.slice(0, 6));
const row = productSheetRow({ car_number: '12가3456', vin: VIN } as EntityRecord, '테스트공급사');
check('그 칸에 실제로 값이 실린다', row[labels.indexOf('차대번호')] === VIN, row.slice(0, 5));
check('열 수와 행 길이가 같다', row.length === PRODUCT_SHEET_COLUMNS.length, `${row.length} vs ${PRODUCT_SHEET_COLUMNS.length}`);

// ★영업자 시트는 외부 링크로 열린다 — 여기 실리면 링크 아는 사람 누구나 본다.
check('★영업자 시트에는 차대번호가 없다', !HEADERS.includes('차대번호') && !HEADERS.includes('VIN'), HEADERS.slice(0, 8));

// ★손님 카탈로그 — 오늘 여기서 뺐다.
const pub = sanitizeProductForGuest('12가3456', { car_number: '12가3456', vin: VIN, model: '아반떼' });
check('★손님 카탈로그에 차대번호가 안 나간다', (pub as Record<string, unknown>).vin === undefined, pub);
check('손님에게 필요한 값은 그대로 나간다', (pub as Record<string, unknown>).model === '아반떼');

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
