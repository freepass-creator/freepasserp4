/**
 * 원자 정합 전수 — **공급사 시트 한 칸이 재고 어느 원자로 가는가.**
 *
 * 표준양식의 모든 열에 값을 채워 한 줄을 만들고, 실제 유입 경로(어댑터 → importSheetTable)로
 * 통과시킨 뒤 «열 하나하나»가 매물 원자에 도착했는지 확인한다.
 * 도착하지 않는 열이 있으면 그 칸은 공급사가 아무리 채워도 버려지는 칸이다.
 *
 * 추가: 인승·구동이 비어 와도 마스터 **기본 조합**(variant.default)을 가져온다.
 *   없으면 축 휴리스틱(인승 modeSeat · 구동 2WD · 무축 승용은 발명 없음).
 *
 *   npx tsx scripts/sim-atom-pipeline.mts
 */
import { readFileSync } from 'node:fs';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import { importSheetTable } from '../lib/domain/sheet-import';
import { TEMPLATE_COLUMNS } from '../lib/domain/supplier-template-sheet';
import { parseProductOptions } from '../lib/domain/product';
import { snapToMaster, applySnap } from '../lib/domain/vehicle-master-match';
import { modeSeat } from '../lib/domain/vehicle-master-variant';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

const S = (v: unknown) => String(v ?? '').trim();
const master: MasterEntry[] = (() => {
  const m = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
  return (Array.isArray(m) ? m : m.entries) || [];
})();

/** 열 → 도착지. 확인하는 방법까지 여기 적는다. */
const EXPECT: { col: string; write: string; check: (p: any) => string }[] = [
  { col: '차량번호', write: '123가4567', check: (p) => S(p.car_number) },
  { col: '상태', write: '출고협의', check: (p) => S(p.vehicle_status) },
  { col: '분류', write: '중고렌트', check: (p) => S(p.product_type) },
  { col: '제조사', write: '현대', check: (p) => S(p.maker) },
  { col: '차명(트림)', write: '쏘나타 디 엣지 DN8 2.0 가솔린 인스퍼레이션', check: (p) => S(p.sub_model) },
  { col: '옵션', write: '선루프, 통풍시트 / 후측방경보', check: (p) => parseProductOptions(p.options).join('|') },
  { col: '외부색상', write: '흰색', check: (p) => S(p.ext_color) },
  { col: '내부색상', write: '검정', check: (p) => S(p.int_color) },
  { col: '연식', write: '2024', check: (p) => S(p.year) },
  { col: '주행거리', write: '12000', check: (p) => S(p.mileage) },
  { col: '연료', write: '가솔린', check: (p) => S(p.fuel_type) },
  { col: '배기량', write: '1998', check: (p) => S(p.engine_cc) },
  { col: '인승', write: '9', check: (p) => S(p.seats) },
  // 열만 만들고 별칭이 없으면 공급사가 채워도 버려진다 — 그 회귀를 막는다.
  { col: '구동', write: '4WD', check: (p) => S(p.drive_type) },
  { col: '단기보증', write: '1200000', check: (p) => S(p.price?.['12']?.deposit) },
  { col: '12개월', write: '900000', check: (p) => S(p.price?.['12']?.rent) },
  { col: '장기보증', write: '1800000', check: (p) => S(p.price?.['36']?.deposit) },
  { col: '36개월', write: '750000', check: (p) => S(p.price?.['36']?.rent) },
  { col: '정책코드', write: 'POL-0047', check: (p) => S(p.policy_code) },
  { col: '최초등록일', write: '2024-03-15', check: (p) => S(p.first_registration_date) },
  { col: '사진링크', write: 'https://drive.google.com/drive/folders/abc', check: (p) => S(p.photo_link) },
  { col: '차대번호', write: 'KMHL14JA1PA123456', check: (p) => S(p.vin) },
  { col: '비고', write: '전방주차 불가', check: (p) => S(p.partner_memo) },
];

const row = Array(TEMPLATE_COLUMNS.length).fill('');
for (const e of EXPECT) {
  const i = TEMPLATE_COLUMNS.findIndex((c) => c.name === e.col);
  if (i < 0) { console.log(`✗ 표준양식에 「${e.col}」 열이 없다`); process.exit(1); }
  row[i] = e.write;
}
// 표준 밖 기간도 함께 — 렌트사가 제목을 바꿔 쓰는 칸이 실제로 먹히는가.
const free = TEMPLATE_COLUMNS.findIndex((c) => c.name === '기타기간①');
const header = TEMPLATE_COLUMNS.map((c) => c.name);
if (free >= 0) { header[free] = '18개월'; row[free] = '820000'; }

const r = importSheetTable(resolveAdapter('generic').prepareTable([header, row]), { providerCode: 'RPTEST', entries: master });
const p = (r.products[0] || {}) as any;

console.log(`\n══ 원자 정합 — 시트 한 줄 → 매물 ══\n`);
console.log(`  매물 ${r.products.length}대 · 검수필요 ${p._needs_master_review === true} · 신뢰도 ${S(p._snap_confidence)}\n`);
console.log('  열              적은 값                          도착한 원자');
let pass = 0, fail = 0;
for (const e of EXPECT) {
  const got = e.check(p);
  const ok = !!got;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${e.col.padEnd(12)} ${e.write.slice(0, 30).padEnd(32)} ${got || '(비었음)'}`);
}
const free18 = S(p.price?.['18']?.rent);
console.log(`  ${free18 ? '✓' : '✗'} ${'기타기간①'.padEnd(12)} ${'제목을 18개월로 바꿔 씀'.padEnd(32)} ${free18 || '(비었음)'}`);
free18 ? pass++ : fail++;

/** 기본값 힌트 — 인승·구동 칸이 비어도 마스터 선택지 축이면 채운다. */
function checkDefault(label: string, ok: boolean, detail: string) {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(36)} ${detail}`);
}

function entryOf(sub: string): MasterEntry | undefined {
  return master.find((e) => S(e.sub_model) === sub);
}

function snapCase(raw: Record<string, unknown>) {
  const snap = snapToMaster(raw as never, master);
  const applied = snap ? applySnap(raw as never, snap, { source: 'sim' }) : null;
  const entry = snap ? entryOf(S(snap.sub_model)) : undefined;
  const expectedSeat = entry ? modeSeat(entry.variants || []) : null;
  return { snap, applied, entry, expectedSeat };
}

console.log(`\n══ 기본 조합 (variant.default → snap) ══\n`);

// 1) 카니발 신형 — 웹: 2026형 디젤 단종, 엔트리=가솔린 3.5 · 9인승
const carnival = snapCase({
  maker: '기아',
  model: '카니발',
  trim_name: '더 뉴 카니발 KA4 프레스티지',
  year: '2025',
});
checkDefault(
  '카니발 신형 빈신호 → 가솔린3.5·9인승',
  S(carnival.applied?.fuel_type) === '가솔린'
    && S(carnival.applied?.seats) === '9'
    && Math.round(Number(carnival.applied?.engine_cc) || 0) === 3500
    && Boolean((carnival.applied as any)?._snap_defaults?.seats),
  `fuel=${S(carnival.applied?.fuel_type)} seats=${S(carnival.applied?.seats)} cc=${S(carnival.applied?.engine_cc)} sub=${S(carnival.snap?.sub_model)}`,
);
checkDefault(
  '카니발 신형 구동축 없음 → 구동 공란',
  !S(carnival.applied?.drive_type) && !(carnival.applied as any)?._snap_defaults?.drive_type,
  `drive=${S(carnival.applied?.drive_type) || '(비었음)'}`,
);

// 1b) 공급사가 디젤·7인승을 명시하면 기본(가솔린3.5·9)이 아니라 그 조합
const carnivalDiesel = snapCase({
  maker: '기아',
  model: '카니발',
  trim_name: '더 뉴 카니발 KA4 디젤 2.2 7인승 프레스티지',
  fuel_type: '디젤',
  engine_cc: '2200',
  seats: '7',
  year: '2024',
});
checkDefault(
  '공급사 디젤·7인승 → 그 조합(기본 아님)',
  S(carnivalDiesel.applied?.fuel_type) === '디젤'
    && S(carnivalDiesel.applied?.seats) === '7'
    && Math.round(Number(carnivalDiesel.applied?.engine_cc) || 0) === 2200
    && !(carnivalDiesel.applied as any)?._snap_defaults?.seats,
  `fuel=${S(carnivalDiesel.applied?.fuel_type)} seats=${S(carnivalDiesel.applied?.seats)} cc=${S(carnivalDiesel.applied?.engine_cc)}`,
);
checkDefault(
  '7인승에 없는 프레스티지 → 조합충돌 검수',
  S(carnivalDiesel.snap?.confidence) === 'low'
    && Array.isArray((carnivalDiesel.applied as any)?._snap_issues)
    && (carnivalDiesel.applied as any)._snap_issues.some((issue: any) => issue.code === 'trim_not_in_master'),
  `confidence=${S(carnivalDiesel.snap?.confidence)} trim=${S(carnivalDiesel.applied?.trim_name) || '(비었음)'}`,
);

// 1c) 차명에만 「7인승」— 칸 비어 있어도 7 선택(기본 9 아님)
const carnival7blob = snapCase({
  maker: '기아',
  model: '카니발',
  trim_name: '더 뉴 카니발 KA4 가솔린 3.5 7인승 프레스티지',
  fuel_type: '가솔린',
  engine_cc: '3500',
  year: '2025',
});
checkDefault(
  '차명 7인승 → 7(기본 9 아님)',
  S(carnival7blob.applied?.seats) === '7'
    && !(carnival7blob.applied as any)?._snap_defaults?.seats,
  `seats=${S(carnival7blob.applied?.seats)} · defaults=${Boolean((carnival7blob.applied as any)?._snap_defaults?.seats)}`,
);

// 1d) 트림이 정말 비면 선택 조합의 첫(최저) 트림을 쓰되 자동매칭임을 남긴다.
const carnivalNoTrim = snapCase({
  maker: '기아',
  model: '카니발',
  trim_name: '더 뉴 카니발 KA4 디젤 2.2',
  fuel_type: '디젤',
  engine_cc: '2200',
  year: '2024',
});
checkDefault(
  '트림 누락 → 조합 첫 트림 자동매칭',
  S(carnivalNoTrim.applied?.trim_name) === '프레스티지'
    && Boolean((carnivalNoTrim.applied as any)?._snap_defaults?.trim_name)
    && S(carnivalNoTrim.snap?.confidence) !== 'low',
  `trim=${S(carnivalNoTrim.applied?.trim_name)} · auto=${Boolean((carnivalNoTrim.applied as any)?._snap_defaults?.trim_name)}`,
);

// 1e) 공급사가 적은 별도 등급이 선택 조합에 없으면 최저 트림으로 덮지 않는다.
const carnivalBadTrim = snapCase({
  maker: '기아',
  model: '카니발',
  trim_name: '더 뉴 카니발 KA4 디젤 2.2 9인승 미확인등급Z',
  fuel_type: '디젤',
  engine_cc: '2200',
  seats: '9',
  year: '2024',
});
checkDefault(
  '미등록 트림 → 자동대체 금지·검수사유',
  !S(carnivalBadTrim.applied?.trim_name)
    && S(carnivalBadTrim.snap?.confidence) === 'low'
    && (carnivalBadTrim.applied as any)?._snap_issues?.some((issue: any) => issue.code === 'trim_not_in_master'),
  `trim=${S(carnivalBadTrim.applied?.trim_name) || '(비었음)'} · issue=${S((carnivalBadTrim.applied as any)?._snap_issues?.[0]?.value)}`,
);

// 1f) 명시 파워트레인 원자끼리 실제 조합이 없으면 점수로 타협하지 않는다.
const carnivalBadPower = snapCase({
  maker: '기아',
  model: '카니발',
  trim_name: '더 뉴 카니발 KA4',
  fuel_type: '디젤',
  engine_cc: '3500',
  seats: '9',
  year: '2024',
});
checkDefault(
  '없는 디젤3.5 조합 → 파워트레인 충돌 검수',
  S(carnivalBadPower.snap?.confidence) === 'low'
    && (carnivalBadPower.applied as any)?._snap_issues?.some((issue: any) => issue.code === 'powertrain_conflict' && issue.field === 'engine_cc'),
  `confidence=${S(carnivalBadPower.snap?.confidence)} · issue=${S((carnivalBadPower.applied as any)?._snap_issues?.[0]?.field)}`,
);

// 1g) 쏘렌토 빈신호 → 5인승·2WD (웹: 5가 기본, 6·7 옵션)
const sorento = snapCase({
  maker: '기아',
  model: '쏘렌토',
  trim_name: '더 뉴 쏘렌토 MQ4',
  year: '2024',
});
checkDefault(
  '쏘렌토 빈신호 → 5인승·2WD',
  S(sorento.applied?.seats) === '5'
    && S(sorento.applied?.drive_type) === '2WD',
  `seats=${S(sorento.applied?.seats)} drive=${S(sorento.applied?.drive_type)} sub=${S(sorento.snap?.sub_model)}`,
);
checkDefault(
  '쏘렌토 차명 7인승 → 7',
  (() => {
    const r = snapCase({
      maker: '기아',
      model: '쏘렌토',
      trim_name: '더 뉴 쏘렌토 MQ4 하이브리드 7인승',
      fuel_type: '하이브리드',
      year: '2024',
    });
    return S(r.applied?.seats) === '7' && !(r.applied as any)?._snap_defaults?.seats;
  })(),
  '7인승 명시 시 기본 5 아님',
);

// 2) 팰리세이드 LX3 — 9인승 기본화 + 2WD 엔트리
const pali = snapCase({
  maker: '현대',
  model: '팰리세이드',
  trim_name: '팰리세이드 LX3 캘리그래피',
  year: '2025',
});
checkDefault(
  '팰리 LX3 빈신호 → 9인승',
  S(pali.applied?.seats) === '9'
    && Boolean((pali.applied as any)?._snap_defaults?.seats),
  `seats=${S(pali.applied?.seats)} · sub=${S(pali.snap?.sub_model)}`,
);
checkDefault(
  '팰리 LX3 빈신호 → 2WD',
  S(pali.applied?.drive_type) === '2WD'
    && Boolean((pali.applied as any)?._snap_defaults?.drive_type),
  `drive=${S(pali.applied?.drive_type)} · defaults.drive=${Boolean((pali.applied as any)?._snap_defaults?.drive_type)}`,
);

// 2b) 공급사 4WD 명시 → 기본 2WD 아님
const pali4 = snapCase({
  maker: '현대',
  model: '팰리세이드',
  trim_name: '팰리세이드 LX3 가솔린 2.5 4WD',
  fuel_type: '가솔린',
  engine_cc: '2500',
  drive_type: '4WD',
  year: '2025',
});
checkDefault(
  '공급사 4WD → 4WD(기본 2WD 아님)',
  S(pali4.applied?.drive_type) === '4WD'
    && !(pali4.applied as any)?._snap_defaults?.drive_type,
  `drive=${S(pali4.applied?.drive_type)} · defaults=${Boolean((pali4.applied as any)?._snap_defaults?.drive_type)}`,
);

// 3) 그랜저 — 가솔린 2.5 2WD 엔트리, 인승 축 없음
const grande = snapCase({
  maker: '현대',
  model: '그랜저',
  trim_name: '디 올 뉴 그랜저 GN7 캘리그래피',
  year: '2024',
});
checkDefault(
  '그랜저 빈신호 → 2WD',
  S(grande.applied?.drive_type) === '2WD'
    && Boolean((grande.applied as any)?._snap_defaults?.drive_type),
  `drive=${S(grande.applied?.drive_type)} · sub=${S(grande.snap?.sub_model)}`,
);
checkDefault(
  '그랜저 → 인승 발명 없음',
  !S(grande.applied?.seats) && !(grande.applied as any)?._snap_defaults?.seats,
  `seats=${S(grande.applied?.seats) || '(비었음)'} · defaults.seats=${Boolean((grande.applied as any)?._snap_defaults?.seats)}`,
);

// 마스터의 첫 트림이 「세부등급 없음」이면 다음 실제 문자열(블랙 등)을 최저 트림으로 오인하지 않는다.
const g80NoGrade = snapCase({
  maker: '제네시스',
  model: 'G80',
  trim_name: 'The All new G80 2.5 터보 AWD 18인치+기본파퓰러패키지',
  year: '2025',
});
checkDefault(
  '세부등급 없음이 기본 → 다음 트림 발명 금지',
  !S(g80NoGrade.applied?.trim_name)
    && Boolean((g80NoGrade.applied as any)?._snap_defaults?.trim_name)
    && !(g80NoGrade.applied as any)?._snap_issues?.length,
  `trim=${S(g80NoGrade.applied?.trim_name) || '(세부등급 없음)'} · auto=${Boolean((g80NoGrade.applied as any)?._snap_defaults?.trim_name)}`,
);

// 4) 승용 무축 — 쏘나타
const sonata = snapCase({
  maker: '현대',
  model: '쏘나타',
  trim_name: '쏘나타 디 엣지 DN8 2.0 가솔린 인스퍼레이션',
  fuel_type: '가솔린',
  engine_cc: '2000',
  year: '2024',
});
checkDefault(
  '무축 승용(쏘나타) → 인승·구동 공란',
  !S(sonata.applied?.seats)
    && !S(sonata.applied?.drive_type)
    && !(sonata.applied as any)?._snap_defaults?.seats
    && !(sonata.applied as any)?._snap_defaults?.drive_type,
  `seats=${S(sonata.applied?.seats) || '(비었음)'} · drive=${S(sonata.applied?.drive_type) || '(비었음)'} · sub=${S(sonata.snap?.sub_model)}`,
);

// 레이: 승용·밴은 세부모델이 다름(인승 기본값 아님)
const rayPass = snapCase({
  maker: '기아',
  model: '레이',
  trim_name: '더 뉴 레이 시그니처',
  year: '2024',
});
checkDefault(
  '레이 승용(빈신호) → 승용 서브·인승축 없음',
  S(rayPass.snap?.sub_model) === '더 뉴 레이 TAM'
    && !S(rayPass.applied?.seats)
    && !(rayPass.applied as any)?._snap_defaults?.seats,
  `sub=${S(rayPass.snap?.sub_model)} seats=${S(rayPass.applied?.seats) || '(비었음)'}`,
);
const rayVan = snapCase({
  maker: '기아',
  model: '레이',
  trim_name: '더 뉴 레이 밴 프레스티지',
  year: '2024',
});
checkDefault(
  '레이 밴 명시 → 밴 서브',
  /밴$/.test(S(rayVan.snap?.sub_model)),
  `sub=${S(rayVan.snap?.sub_model)}`,
);
const ray2 = snapCase({
  maker: '기아',
  model: '레이',
  trim_name: '더 뉴 레이 2인승',
  seats: '2',
  year: '2024',
});
checkDefault(
  '레이 2인승 → 밴 서브',
  /밴$/.test(S(ray2.snap?.sub_model)),
  `sub=${S(ray2.snap?.sub_model)} seats=${S(ray2.applied?.seats) || '(비었음)'}`,
);

// applySnap 스펙 = 마스터 노드
checkDefault(
  'applySnap 스펙 = 마스터 노드',
  carnival.snap != null
    && S(carnival.snap.seats) === S(carnival.applied?.seats)
    && S(carnival.snap.seats) === '9',
  `snap.seats=${S(carnival.snap?.seats)} · applied=${S(carnival.applied?.seats)}`,
);

console.log(`\n── 도착 ${pass} · 유실 ${fail} ──\n`);
process.exit(fail ? 1 : 0);
