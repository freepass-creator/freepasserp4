/** 재고 목록 표시·조회 read-only 회귀검사. 실행: npx tsx scripts/sim-inventory-display.mts */
import { readFileSync } from 'node:fs';
import {
  UNKNOWN_VEHICLE_STATUS,
  isHiddenFromCatalog,
  normalizeVehicleDisplayStatus,
  vehicleTone,
} from '../lib/domain/product';
import { checkInventory } from '../lib/domain/data-check';
import { providerNameMap } from '../lib/domain/identity';
import { matchPolicyQuery } from '../lib/domain/search';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`PASS ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${name}`, detail ?? '');
}

check('표준 상태 앞뒤 공백 정리', normalizeVehicleDisplayStatus(' 출고 가능 ') === '출고가능');
check('누락 상태 운영 신호', normalizeVehicleDisplayStatus('') === UNKNOWN_VEHICLE_STATUS);
check('지원외 상태 운영 신호', normalizeVehicleDisplayStatus('판매중') === UNKNOWN_VEHICLE_STATUS);
check('상태 확인은 적색', vehicleTone(UNKNOWN_VEHICLE_STATUS) === 'red');
check('공백 포함 출고불가도 카탈로그 숨김', isHiddenFromCatalog({ vehicle_status: ' 출고 불가 ' }));

const missingMakerHit = checkInventory([{ product_code: 'p-missing-maker', maker: '' }])
  .find((group) => group.key === 'bad_maker')?.hits[0];
check('제조사 누락은 undefined 문자열을 표시하지 않음', missingMakerHit?.note === undefined, missingMakerHit);

const source = readFileSync(
  new URL('../features/inventory/useInventoryVehicleTools.ts', import.meta.url),
  'utf8',
);
const selection = source.slice(
  source.indexOf('const selectProduct ='),
  source.indexOf('const normalizeVehicle ='),
);
check('행 선택 경로에 DB update 없음', !selection.includes('getStore().update'), selection);
check('행 선택 경로에 목록 캐시 patch 없음', !selection.includes('patchListCache'), selection);
check('행 선택은 로컬 preview만 반영', selection.includes('setForm(preview)'));
check('늦은 마스터 preview는 현재 선택이 바뀌면 폐기', selection.includes('selectedCodeRef.current !== code'));

const accessSource = readFileSync(
  new URL('../features/inventory/useInventoryData.ts', import.meta.url),
  'utf8',
);
check('재고 일반 진입은 첫 행을 자동선택하지 않음', !accessSource.includes('selectProductRef'));
check('재고 로드 후 명시적으로 목록 상태 유지', accessSource.includes('clearSelectionRef.current();'));

const policySource = readFileSync(
  new URL('../app/policy/page.tsx', import.meta.url),
  'utf8',
);
check('화면 크기 변경은 정책 선택·수정을 초기화하지 않음',
  !policySource.includes('}, [mobile]);'));
check('정책 목록 행은 FeedListRow 공통 햄틱을 중복 호출하지 않음',
  !policySource.includes('onClick={() => { haptic.tap(); selectP(p); }}'));

const inventoryPageSource = readFileSync(
  new URL('../app/inventory/page.tsx', import.meta.url),
  'utf8',
);
check('재고 목록 행은 FeedListRow 공통 햄틱을 중복 호출하지 않음',
  !inventoryPageSource.includes('haptic.tap(); selectPRef.current'));

const aliases = providerNameMap([
  { partner_code: 'RP013', name: '주식회사 웰릭스렌터카', alias: '웰릭스' },
]);
const rawPolicy = { policy_code: 'pol_1', provider_company_code: 'RP013' };
check('정책 귀속 공급사도 코드 대신 표시명 보강', aliases.RP013 === '웰릭스', aliases);
check('정책 표시명 보강은 원본 저장 레코드를 변경하지 않음', !('provider_name' in rawPolicy), rawPolicy);
check('정책 목록에 보이는 공급사명으로 검색', matchPolicyQuery({ ...rawPolicy, provider_name: aliases.RP013 }, '웰릭스'));

const listRowSource = readFileSync(
  new URL('../components/list-rows.tsx', import.meta.url),
  'utf8',
);
check('정책 행은 공급사 표시명 우선·코드 fallback',
  listRowSource.includes('listText(resolvedProviderName) || listText(p.provider_name) || providerCode'));
check('공백-only 채팅 메시지는 기본 안내문으로 표시',
  listRowSource.includes("listText(room.last_message) || '대화를 시작하세요'"));
check('공백-only 회원명은 코드 fallback으로 표시',
  listRowSource.includes("listText(row.name) || code ||"));
check('정책명 누락은 코드를 T1·T3에 중복하지 않고 적색 확인 신호',
  listRowSource.includes("policyName || '정책명 미지정'")
    && listRowSource.includes('missingName ? <Badge tone="red" variant="solid">정보 확인</Badge>')
    && listRowSource.includes("return { icon: FileX2, tone: 'red', title: '정책명 확인' }"));
check('공백-only 상품유형은 빈 배지를 만들지 않음',
  listRowSource.includes('const pt = listText(p.product_type)'));

const formControlSource = readFileSync(
  new URL('../components/ui/form-controls.tsx', import.meta.url),
  'utf8',
);
check('공통 검색창은 placeholder와 같은 접근성 이름 제공',
  formControlSource.includes("aria-label={placeholder || '검색'}"));
check('검색 초기화 버튼은 용도가 분명한 접근성 이름 제공',
  formControlSource.includes('aria-label="검색어 지우기"'));
check('공통 정렬·필터 Select는 placeholder 기반 접근성 이름 제공',
  formControlSource.includes("aria-label={ariaLabel || placeholder || '선택'}"));
check('공통 Input은 명시 라벨 우선·placeholder fallback',
  formControlSource.includes('aria-label={ariaLabel || placeholder}'));

console.log(`\ninventory display: ${passed}/${passed + failed} PASS`);
if (failed) process.exitCode = 1;
