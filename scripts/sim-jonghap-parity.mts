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
  car({ car_number: '12가3456', variant: '가솔린 2.0', trim_name: '프레스티지', year: '2024', ext_color: '흰색' }),
  car({ car_number: '34나5678' }),
  // ★번호미정 신차 — 번호가 나오기 전에도 차종·가격이 정해져 있고 계약이 붙는다.
  car({ car_number: '', _key: 'NEW1' }),
  car({ car_number: '100신0001', is_pending_plate: true, _key: 'NEW2' }),
];

const { tsv, count } = buildJonghapTsv(rows, []);
check('★차번 없는 신차도 싣는다', count === rows.length, `${count} vs ${rows.length}`);
check('새 표와 대수가 같다', count === dedupeForSales(rows).length, `종합 ${count} · 상품리스트 ${dedupeForSales(rows).length}`);

const lines = tsv.split('\n');
check('머리행이 규격 그대로', lines[0] === JONGHAP_COLUMNS.join('\t'));

/**
 * ★열 순서는 **차종 5단계**를 따른다(2026-08-10 사장님 지시).
 *   세부모델 → 외장·내장 → 연식·연료·주행 → 대여료 → 파워트레인 → 세부트림 → 옵션
 * 순서가 흐트러지면 영업자가 「무슨 차인가」를 한 번에 못 읽는다.
 */
const at = (n: string) => JONGHAP_COLUMNS.indexOf(n);
check('세부모델 뒤에 외장·내장', at('외장') === at('세부모델') + 1 && at('내장') === at('외장') + 1);
check('그 뒤에 연식·연료·주행', at('연식') === at('내장') + 1 && at('연료') === at('연식') + 1 && at('Km') === at('연료') + 1);
check('주행 뒤에 단기보증', at('단기보증') === at('Km') + 1);
check('대여료 뒤에 파워트레인·세부트림', at('파워트레인') === at('60개월') + 1 && at('세부트림') === at('파워트레인') + 1);
check('그 뒤가 옵션', at('옵션') === at('세부트림') + 1);
check('연식 칸이 새로 생겼다', at('연식') >= 0);
check('옛 「트림」은 「세부트림」으로 바뀌었다', at('트림') === -1 && at('세부트림') >= 0);
check('열 수가 머리행과 같다', lines.slice(1).every((l) => l.split('\t').length === JONGHAP_COLUMNS.length));
check('삭제된 차는 안 싣는다', buildJonghapTsv([...rows, car({ car_number: '99하9999', _deleted: true })], []).count === rows.length);

// 값이 제 칸에 들어가는가 — 열만 만들고 값을 안 채우면 빈 칸이 늘 뿐이다.
// ⚠ 줄 순서는 제조사·모델·차번 정렬이라 «첫 줄»이 그 차가 아니다. 차번으로 찾는다.
const first = (lines.find((l) => l.split('\t')[at('차량번호')] === '12가3456') || '').split('\t');
check('파워트레인 값이 실린다', first[at('파워트레인')] === '가솔린 2.0', first[at('파워트레인')]);
check('세부트림 값이 실린다', first[at('세부트림')] === '프레스티지', first[at('세부트림')]);
check('연식 값이 실린다', first[at('연식')] === '2024', first[at('연식')]);
// 연식이 비면 최초등록에서 연도만 뽑는다 — 없는 값을 지어내진 않는다.
const fromReg = buildJonghapTsv([car({ car_number: '77바7777', year: '', first_registration_date: '2021.06.24' })], []);
check('연식이 비면 최초등록에서 연도를 뽑는다', fromReg.tsv.split('\n')[1].split('\t')[at('연식')] === '2021');
check('둘 다 없으면 빈칸', buildJonghapTsv([car({ car_number: '88사8888', year: '', first_registration_date: '' })], [])
  .tsv.split('\n')[1].split('\t')[at('연식')] === '');

// 자유텍스트의 탭·개행이 행을 밀면 안 된다 — 붙여넣기가 통째로 어긋난다.
const dirty = buildJonghapTsv([car({ car_number: '55다5555', note: '앞\t뒤\n다음줄' })], []);
check('탭·개행을 공백으로 바꾼다', dirty.tsv.split('\n').length === 2, dirty.tsv.split('\n').length);

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
