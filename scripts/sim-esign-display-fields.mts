/**
 * 계약서 표기 사전 검증 — 섹션 구분·원자 배열·마스킹.
 * 실행: npx tsx scripts/sim-esign-display-fields.mts
 */
import {
  DISPLAY_SECTIONS, applyMask, contractValue, findDisplayField, maskAccount, maskAddress,
  maskLicense, maskPhone, maskRrn, maskedFields, screenValue,
} from '../lib/domain/esign-display-fields';
import { FIELD_MAP } from '../lib/domain/esign-field-map';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, detail ?? ''); }
};

const all = DISPLAY_SECTIONS.flatMap((s) => s.fields);

// ── 섹션 구분 ──
check('섹션 9개', DISPLAY_SECTIONS.length === 9, DISPLAY_SECTIONS.map((s) => s.title));
check('섹션 순서 = 주체→대상→조건→위험→돈',
  DISPLAY_SECTIONS.map((s) => s.key).join('|')
  === 'lessee|lessee_biz|vehicle|terms|driver|insurance|accident|bank|guarantor',
  DISPLAY_SECTIONS.map((s) => s.key));
// 임대인은 별도 섹션이 아니다 — 차 소유자라 「무엇을 빌리나」에 붙는다.
check('임대인 전용 섹션은 없다', !DISPLAY_SECTIONS.some((s) => s.key === 'lessor'));
const vehicleKeys = DISPLAY_SECTIONS.find((s) => s.key === 'vehicle')!.fields.map((x) => x.key);
check('임대인이 차량정보에 들어 있다', vehicleKeys.includes('company_name'));
// 차 이야기가 먼저고 소유자가 뒤다 — 손님은 「무슨 차」부터 본다.
check('차량 식별이 임대인보다 앞',
  vehicleKeys.indexOf('car_number') < vehicleKeys.indexOf('company_name')
  && vehicleKeys.indexOf('odometer_delivery') < vehicleKeys.indexOf('company_name'),
  vehicleKeys);
check('모든 섹션에 안내문', DISPLAY_SECTIONS.every((s) => !!s.note));
check('조건부 섹션은 사업자·연대보증뿐',
  DISPLAY_SECTIONS.filter((s) => s.conditional).map((s) => s.key).join('|') === 'lessee_biz|guarantor');
// 보상한도와 면책금이 한 섹션에 있으면 손님이 둘 다 보상으로 읽는다.
check('보험과 사고·면책은 다른 섹션',
  !DISPLAY_SECTIONS.find((s) => s.key === 'insurance')!.fields.some((x) => x.label.includes('면책금')),
  DISPLAY_SECTIONS.find((s) => s.key === 'insurance')!.fields.map((x) => x.label));
check('면책금은 사고 섹션에',
  DISPLAY_SECTIONS.find((s) => s.key === 'accident')!.fields.filter((x) => x.label.includes('면책금')).length >= 3);

// ── 원자 배열 ──
check('필드 키 중복 없음', new Set(all.map((x) => x.key)).size === all.length,
  all.map((x) => x.key).filter((k, i, a) => a.indexOf(k) !== i));
// 임차인정보는 이름부터. 그 섹션이 누구에 관한 것인지부터 박는다.
check('임차인정보 첫 칸은 이름',
  DISPLAY_SECTIONS[0].fields[0].key === 'customer_name', DISPLAY_SECTIONS[0].fields[0].label);
check('임차인정보 = 이름·주민번호·연락처·주소 순',
  DISPLAY_SECTIONS[0].fields.slice(0, 4).map((x) => x.label).join('|') === '이름|주민등록번호|연락처|주소',
  DISPLAY_SECTIONS[0].fields.map((x) => x.label));
// 필수가 선택보다 앞 — 위에서부터 읽다 멈춰도 중요한 건 봤어야 한다.
for (const s of DISPLAY_SECTIONS) {
  const firstOptional = s.fields.findIndex((x) => !x.required);
  const lastRequired = s.fields.map((x) => x.required).lastIndexOf(true);
  check(`«${s.title}» 필수가 선택보다 앞`,
    firstOptional === -1 || lastRequired < firstOptional || s.key === 'lessee' || s.key === 'terms',
    s.fields.map((x) => `${x.label}${x.required ? '*' : ''}`));
}
// 짝은 붙인다 — 비교해서 읽는 값이 떨어지면 못 읽는다.
const termKeys = DISPLAY_SECTIONS.find((s) => s.key === 'terms')!.fields.map((x) => x.key);
check('계약 시작일-종료일이 붙어 있다',
  termKeys.indexOf('contract_end') - termKeys.indexOf('contract_start') === 1);
check('약정주행-초과요금이 붙어 있다',
  termKeys.indexOf('over_mileage_rate') - termKeys.indexOf('annual_mileage') === 1);
check('금액은 기간→대여료→보증금 순',
  termKeys.indexOf('rent_month') < termKeys.indexOf('rent_amount')
  && termKeys.indexOf('rent_amount') < termKeys.indexOf('deposit_amount'));
const lesseeKeys = DISPLAY_SECTIONS[0].fields.map((x) => x.key);
check('주소-실거주지가 붙어 있다',
  lesseeKeys.indexOf('residence_address') - lesseeKeys.indexOf('customer_address') === 1);

// ── 마스킹 — 빠지면 유출이다 ──
const MUST_MASK = ['customer_id', 'customer_phone', 'customer_address', 'driver_license_no',
  'emergency_contact', 'drv1_rrn', 'drv1_license', 'drv1_phone', 'cms_account_no',
  'guarantor_rrn', 'guarantor_phone', 'guarantor_address'];
for (const k of MUST_MASK) {
  const fd = findDisplayField(k);
  check(`«${fd?.label ?? k}» 화면 마스킹`, !!fd && fd.onScreen !== 'none', fd?.onScreen);
}
// 계약서에는 원본이 들어가야 한다 — 마스킹된 계약서는 효력이 의심된다.
check('계약서 표기는 원본', all.every((x) => x.onContract === 'none'));
check('주민번호·면허·계좌는 전부 가린다',
  all.filter((x) => /주민등록번호|면허번호|계좌번호/.test(x.label)).every((x) => x.onScreen !== 'none'),
  all.filter((x) => /주민등록번호|면허번호|계좌번호/.test(x.label)).map((x) => `${x.label}:${x.onScreen}`));
check(`마스킹 대상 ${maskedFields().length}개`, maskedFields().length >= 12);

// ── 마스킹 동작 ──
check('주민번호 뒷자리 전부 가림', maskRrn('880505-1058445') === '880505-*******', maskRrn('880505-1058445'));
// 성별 한 자리를 남기면 그것만으로 특정이 좁혀진다.
check('성별 자리도 안 남긴다', !maskRrn('880505-1058445').includes('1'));
// 같은 칸에 생년월일이 오기도 한다(예금주 생년월일). 그걸 가리면 칸이 통째로 별표가 된다.
check('생년월일은 안 가린다', maskRrn('1988-03-12') === '1988-03-12', maskRrn('1988-03-12'));
check('6자리 생년월일도 안 가린다', maskRrn('880505') === '880505');
check('사업자번호도 안 가린다', maskRrn('379-88-01956') === '379-88-01956');
check('휴대폰 가운데 가림', maskPhone('01012345678') === '010-****-5678', maskPhone('01012345678'));
check('주소는 시·구까지', maskAddress('서울시 강남구 테헤란로 123') === '서울시 강남구 …', maskAddress('서울시 강남구 테헤란로 123'));
check('짧은 주소는 그대로', maskAddress('서울 강남구') === '서울 강남구');
check('면허 가운데 가림', maskLicense('11-02-615681-54') === '11-02-******-54', maskLicense('11-02-615681-54'));
check('계좌 앞3·뒤4만', maskAccount('140-013-750928') === '140*****0928', maskAccount('140-013-750928'));
check('빈 값은 빈 값', applyMask('', 'rrn') === '' && applyMask(null, 'phone') === '');

const rrnField = findDisplayField('customer_id')!;
check('screenValue 가 가린다', screenValue(rrnField, '880505-1058445') === '880505-*******');
check('contractValue 는 원본', contractValue(rrnField, '880505-1058445') === '880505-1058445');

// ── 기계용 매핑과 어긋나지 않는가 ──
const mapKeys = new Set(FIELD_MAP.map((x) => x.field));
const own = ['cms_holder', 'cms_holder_birth', 'cms_holder_phone', 'biz_name', 'biz_number',
  'biz_address', 'residence_address', 'emergency_relation'];
const strayKeys = all.map((x) => x.key).filter((k) => !mapKeys.has(k) && !own.includes(k));
check('템플릿에 없는 필드를 지어내지 않았다', strayKeys.length === 0, strayKeys);

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
