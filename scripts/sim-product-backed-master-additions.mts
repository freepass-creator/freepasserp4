import fs from 'node:fs';
import path from 'node:path';

type RecordRow = {
  trim_row_key: string; master_id: string; maker: string; model: string; sub_model: string;
  fuel: string; engine_cc: number | null; drivetrain: string; seats: number | null; trim: string;
  production_start: string; production_end: string; model_year_start: string; model_year_end: string;
  usage_tier: string; evidence_url: string;
};
const artifact = JSON.parse(fs.readFileSync(path.resolve('public/data/vehicle-trim-master.json'), 'utf8')) as { records: RecordRow[] };
const byId = (id: string) => artifact.records.filter((row) => row.master_id === id);
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

const eq900 = byId('mf-007.md-004.sm-hi-eq900-2016__eq900-product');
assert(eq900.length === 1 && eq900[0].engine_cc === 3778 && eq900[0].drivetrain === 'AWD' && eq900[0].trim === '프레스티지', 'EQ900 상품 축 회귀');
assert(eq900[0].production_end === '2018-10' && /genesis\.com/.test(eq900[0].evidence_url), 'EQ900 전환 경계·공식 provenance 회귀');

const k5Lpg = byId('mf-002.md-001.sm-dl3-pe-my2025__k5-2025-lpg');
assert(k5Lpg.length === 1 && k5Lpg[0].fuel === 'LPG' && k5Lpg[0].engine_cc === 1999 && k5Lpg[0].trim === '프레스티지', 'K5 2025 LPG 축 회귀');
assert(k5Lpg[0].model_year_start === '2025' && k5Lpg[0].production_start === '2025-01' && k5Lpg[0].production_end === '2026-06', 'K5 2025 기간 회귀');

const k5Best = byId('mf-002.md-001.sm-dl3-pe-my2026__k5-best-product');
assert(k5Best.length === 2 && k5Best.every((row) => row.trim === '베스트 셀렉션' && row.fuel === '가솔린'), 'K5 2026 Best Selection 범위 회귀');
assert(new Set(k5Best.map((row) => row.engine_cc)).size === 2 && k5Best.every((row) => row.model_year_start === '2026' && row.model_year_end === '2026'), 'K5 2026 엔진·연식 음성경계 회귀');

const k5FaceliftGas = byId('mf-002.md-001.sm-dl3-pe-2023__k5-facelift-gas-product');
assert(k5FaceliftGas.length === 3 && new Set(k5FaceliftGas.map((row) => row.trim)).size === 3, 'K5 부분변경 2.0 가솔린 공식 트림축 회귀');
assert(k5FaceliftGas.every((row) => row.engine_cc === 1999 && row.production_start === '2023-11' && row.production_end === '2025-05'), 'K5 부분변경 생산기간·배기량 회귀');
assert(!k5FaceliftGas.some((row) => row.fuel !== '가솔린' || row.trim === '베스트 셀렉션'), 'K5 LPG·하이브리드·조기 Best Selection 확장 금지 회귀');

const sonataRental = byId('mf-001.md-018.sm-dn8-edge-rent-my2024-2025__sonata-rental-product');
assert(sonataRental.length === 2 && new Set(sonataRental.map((row) => row.trim)).size === 2, '쏘나타 2024~2025 렌터카 Business 1/2 축 회귀');
assert(sonataRental.every((row) => row.fuel === 'LPG' && row.engine_cc === 1999 && row.production_end === '2025-08'), '쏘나타 렌터카 연료·배기량·2026 경계 회귀');
assert(sonataRental.every((row) => row.trim_aliases.includes('비즈니스')), '쏘나타 숫자 미상 비즈니스는 양쪽 후보로 보존');

const gv80Initial = byId('mf-007.md-005.sm-jx1-2020__gv80-initial-product');
assert(gv80Initial.length === 4 && gv80Initial.every((row) => row.seats === 5 && row.production_end === '2023-09'), 'GV80 초기형 실상품 5인승·부분변경 경계 회귀');
assert(gv80Initial.filter((row) => row.fuel === '디젤').length === 2 && gv80Initial.some((row) => row.engine_cc === 2497) && gv80Initial.some((row) => row.engine_cc === 3470), 'GV80 초기형 공식 엔진·구동 축 회귀');

const g80Initial = byId('mf-007.md-002.sm-rg3-prefacelift-corrected__g80-2020');
assert(g80Initial.length === 8 && g80Initial.every((row) => row.usage_tier === 'automatic'), 'G80 초기형 공식 교차근거 자동사용 승격 회귀');
assert(g80Initial.every((row) => row.production_end === '2023-11') && g80Initial.filter((row) => row.trim === '스포츠 패키지').every((row) => row.production_start === '2021-08'), 'G80 초기형/스포츠 시작·종료 경계 회귀');

const niroSg2Hev = byId('mf-002.md-061.sm-sg2-2022__niro-hev-product');
assert(niroSg2Hev.length === 3 && new Set(niroSg2Hev.map((row) => row.trim)).size === 3, '니로 SG2 HEV 공식 3트림 회귀');
assert(niroSg2Hev.every((row) => row.engine_cc === 1580 && row.drivetrain === 'FWD' && row.production_end === '2026-02'), '니로 SG2 배기량·구동·부분변경 경계 회귀');

const venue2025 = byId('mf-001.md-059.sm-qx1-venue-2025-korea__venue-1.6-ivt');
assert(venue2025.length === 3 && venue2025.every((row) => row.usage_tier === 'automatic' && row.engine_cc === 1598), '베뉴 2025 국내 공식 3트림 자동사용 회귀');

const gv70 = byId('mf-007.md-006.sm-jk1-2020__gv70-initial-product');
assert(gv70.length === 4 && gv70.every((row) => row.production_end === '2024-04' && row.usage_tier === 'automatic'), 'GV70 초기형/부분변경 경계 회귀');
const gv70Diesel = gv70.find((row) => row.fuel === '디젤');
assert(gv70Diesel?.engine_cc === 2151 && gv70Diesel.drivetrain === 'AWD', 'GV70 디젤 공식 2,151cc 축 회귀');
assert(!gv70.some((row) => row.fuel === '전기' || row.production_start >= '2024-05'), 'GV70 전동화·부분변경 확장 금지 회귀');

const ray = byId('mf-002.md-058.sm-tam-my2026__ray-product');
assert(ray.length === 4 && ray.every((row) => row.production_end === '2026-07'), '레이 2026/2027 경계 회귀');
assert(ray.filter((row) => row.fuel === '가솔린').length === 3 && ray.some((row) => row.fuel === '전기' && row.trim === '에어'), '레이 가솔린·EV 공식 상품축 회귀');

const k8 = byId('mf-002.md-065.sm-gl3-pe-my2026__k8-best-product');
assert(k8.length === 1 && k8[0].engine_cc === 2497 && k8[0].drivetrain === '2WD' && k8[0].trim === '베스트 셀렉션', 'K8 2026 Best Selection 축 회귀');
assert(k8[0].production_end === '2026-05' && k8[0].model_year_start === '2026', 'K8 실제상품 등록월 이후 확장 금지 회귀');

const santaFeTm2021 = byId('mf-001.md-017.sm-tm-pe-2021-product__santafe-2021');
assert(santaFeTm2021.length === 2 && santaFeTm2021.every((row) => row.drivetrain === '2WD' && row.seats === 5), '싼타페 TM 2021 기본 5인승·2WD 축 회귀');
assert(santaFeTm2021.some((row) => row.fuel === '가솔린' && row.engine_cc === 2497 && row.trim === '프리미엄 초이스'), '싼타페 TM 가솔린 프리미엄 초이스 회귀');
assert(santaFeTm2021.some((row) => row.fuel === '디젤' && row.engine_cc === 2151 && row.trim === '프리미엄'), '싼타페 TM 디젤 프리미엄 회귀');
assert(santaFeTm2021.every((row) => /hyundai\.com/.test(row.evidence_url) && row.usage_tier === 'automatic'), '싼타페 TM 공식근거·자동사용 회귀');

const g90Hi50 = byId('mf-007.md-004.sm-hi-2018-50-5seat__g90-product');
assert(g90Hi50.length === 1 && g90Hi50[0].engine_cc === 5038 && g90Hi50[0].drivetrain === 'AWD', 'G90 HI 5.0 공식 엔진·구동 회귀');
assert(g90Hi50[0].seats === 5 && g90Hi50[0].trim === '프레스티지' && g90Hi50[0].usage_tier === 'automatic', 'G90 일반 세단 5인승 프레스티지 회귀');

const tucson2023 = byId('mf-001.md-032.sm-nx4-my2023-product__tucson');
assert(tucson2023.length === 1 && tucson2023[0].fuel === '디젤' && tucson2023[0].engine_cc === 1998 && tucson2023[0].drivetrain === '4WD', '투싼 2023 디젤 HTRAC 축 회귀');
assert(tucson2023[0].trim === '인스퍼레이션' && tucson2023[0].seats === 5, '투싼 2023 트림·인승 회귀');

const palisadeLx2Seven = byId('mf-001.md-058.sm-lx2-pe-7seat-product__palisade');
assert(palisadeLx2Seven.length === 2 && palisadeLx2Seven.every((row) => row.fuel === '디젤' && row.engine_cc === 2199 && row.drivetrain === '2WD' && row.seats === 7), '팰리세이드 LX2 디젤 2WD 7인승 축 회귀');
assert(new Set(palisadeLx2Seven.map((row) => row.trim)).size === 2 && palisadeLx2Seven.some((row) => row.trim === '르블랑') && palisadeLx2Seven.some((row) => row.trim === '프레스티지'), '팰리세이드 르블랑·프레스티지 회귀');

const sportageLpgGravity = byId('mf-002.md-025.sm-nq5-2022-lpg-gravity__sportage-product');
assert(sportageLpgGravity.length === 1 && sportageLpgGravity[0].fuel === 'LPG' && sportageLpgGravity[0].engine_cc === 1999 && sportageLpgGravity[0].drivetrain === '2WD', '스포티지 LPG 그래비티 동력축 회귀');
assert(sportageLpgGravity[0].trim === '그래비티' && sportageLpgGravity[0].seats === 5 && sportageLpgGravity[0].usage_tier === 'automatic', '스포티지 그래비티 트림·인승 회귀');

const sorento2024DieselGravity = byId('mf-002.md-027.sm-mq4-pe-2024-diesel-gravity__sorento-product');
assert(sorento2024DieselGravity.length === 1 && sorento2024DieselGravity[0].fuel === '디젤' && sorento2024DieselGravity[0].engine_cc === 2151 && sorento2024DieselGravity[0].drivetrain === '2WD', '쏘렌토 2024 디젤 그래비티 동력축 회귀');
assert(sorento2024DieselGravity[0].trim === '그래비티' && sorento2024DieselGravity[0].seats === 7 && sorento2024DieselGravity[0].model_year_end === '2024', '쏘렌토 2024 그래비티 트림·인승·연식경계 회귀');

console.log('PASS product-backed master additions — EQ900/G90/K5/GV70/Ray/K8/쏘나타/싼타페/투싼/팰리세이드/스포티지/쏘렌토/GV80/니로 공식축·기간·음성경계');
