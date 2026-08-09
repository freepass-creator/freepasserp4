/**
 * 구버전 종합표 — **새 표와 같은 차를 실어야 한다.**
 * 실행: npx tsx scripts/sim-jonghap-parity.mts
 *
 * 같은 시트의 두 탭이 서로 다른 대수를 말하면 영업자가 어느 쪽을 믿어야 할지 모른다.
 * 실측 2026-08-10: 옛 규칙이 «차번 없으면 버림»이라 번호미정 신차 8대가 빠져
 * 상품리스트 409대 · 종합표 401대가 됐다.
 */
import { buildJonghapTsv, JONGHAP_COLUMNS } from '../lib/domain/jonghap';
import { dedupeForSales } from '../lib/domain/inventory-sheet-export';
import type { EntityRecord } from '../lib/intake/entities';

let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, JSON.stringify(detail ?? '')); }
};

const car = (over: Record<string, unknown> = {}): EntityRecord => ({
  _key: String(over.car_number || over._key || 'X'),
  maker: '기아', model: '카니발', sub_model: '카니발 KA4',
  price: { 12: { rent: 900_000, deposit: 1_800_000 } },
  ...over,
} as EntityRecord);

const rows = [
  car({ car_number: '12가3456' }),
  car({ car_number: '34나5678' }),
  // ★번호미정 신차 — 번호가 나오기 전에도 차종·가격이 정해져 있고 계약이 붙는다.
  car({ car_number: '', _key: 'NEW1' }),
  car({ car_number: '100신0001', is_pending_plate: true, _key: 'NEW2' }),
];

const { tsv, count } = buildJonghapTsv(rows, []);
check('★차번 없는 신차도 싣는다', count === rows.length, `${count} vs ${rows.length}`);
check('새 표와 대수가 같다', count === dedupeForSales(rows).length, `종합 ${count} · 상품리스트 ${dedupeForSales(rows).length}`);

const lines = tsv.split('\n');
check('머리행이 41열 규격 그대로', lines[0] === JONGHAP_COLUMNS.join('\t'));
check('열 수가 머리행과 같다', lines.slice(1).every((l) => l.split('\t').length === JONGHAP_COLUMNS.length));
check('삭제된 차는 안 싣는다', buildJonghapTsv([...rows, car({ car_number: '99하9999', _deleted: true })], []).count === rows.length);

// 자유텍스트의 탭·개행이 행을 밀면 안 된다 — 붙여넣기가 통째로 어긋난다.
const dirty = buildJonghapTsv([car({ car_number: '55다5555', note: '앞\t뒤\n다음줄' })], []);
check('탭·개행을 공백으로 바꾼다', dirty.tsv.split('\n').length === 2, dirty.tsv.split('\n').length);

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
