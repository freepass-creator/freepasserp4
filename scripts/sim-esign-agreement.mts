/**
 * 프리패스 장기렌트 약관 V19 검증.
 * 공정위 자동차대여 표준약관의 28개 조문 흐름을 장기렌트에 맞게 재구성했는지,
 * 인쇄본·전자계약 전송본·중요조문 강조가 같은 정본을 보는지 확인한다.
 * 실행: npx tsx scripts/sim-esign-agreement.mts
 */
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { AGREEMENT_SECTIONS, AGREEMENT_VERSION } from '../lib/domain/esign-agreement-text';
import {
  KEY_CLAUSES, agreementWithEmphasis, keyClauseOf, keyClauseSummaries,
} from '../lib/domain/esign-agreement-emphasis';
import { buildConsentGroups } from '../lib/domain/esign-consent-doc';
import type { EntityRecord } from '../lib/intake/entities';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.error(`✗ ${name}`, detail ?? ''); }
};

const contractHtml = readFileSync('public/contract-template/rental-contract.html', 'utf8');
const individualHtml = readFileSync('public/contract-template/contract-individual.html', 'utf8');
const $ = load(contractHtml);
const norm = (value: string) => value.replace(/\s+/g, ' ').trim();
const htmlAgreement: { t: string; b: string }[] = [];
$('#termsSource > .t-art').each((_, el) => {
  const title = norm($(el).text());
  if (!/^제\d+조/.test(title)) return;
  const paragraphs: string[] = [];
  let next = $(el).next();
  while (next.length && !next.hasClass('t-art')) {
    paragraphs.push(norm(next.text()));
    next = next.next();
  }
  htmlAgreement.push({ t: title, b: norm(paragraphs.join(' ')) });
});

const articleBody = (article: string) => AGREEMENT_SECTIONS.find((section) => section.t.startsWith(article))?.b || '';
const titleOf = (index: number) => AGREEMENT_SECTIONS[index]?.t || '';

// ── 공정위 표준약관형 골격 ──
const expectedTitles = [
  '목적', '계약조건의 확인 및 계약신청', '계약신청의 변경·철회', '대여계약의 체결',
  '대체차량 및 차량 인도', '대여료·보증금 및 담보', '회사의 계약 해지', '임차인의 계약 해지',
  '불가항력에 따른 계약 종료', '계약조건의 변경·연장 및 승계', '보험가입 등',
  '점검표 작성 및 차량 인도', '임차인의 점검의무 및 운전자격', '임차인의 차량 관리책임',
  '금지행위', '손해배상책임 및 비용정산', '사고처리', '보험처리 및 자차손해면책',
  '휴차손해·전손 및 도난', '차량 이상·고장 발견 시 조치', '차량의 반환시기',
  '차량의 확인 및 반납정산', '반환장소 및 초과주행요금', '차량 미반환 및 차량보호조치',
  '지연손해금 및 계약종료 정산', '만기 차량 인수', '계약의 세칙·통지 및 계약서 교부',
  '분쟁해결 및 관할법원',
];
check('V19 버전을 사용한다', AGREEMENT_VERSION === 'rental-v19-2026-08-13', AGREEMENT_VERSION);
check('공정위 표준약관형 28개 조문 골격이다', AGREEMENT_SECTIONS.length === 28, AGREEMENT_SECTIONS.length);
check('제1조부터 제28조까지 번호가 연속된다', AGREEMENT_SECTIONS.every((s, i) => s.t.startsWith(`제${i + 1}조(`)));
check('장기렌트에 맞춘 표준 흐름과 제목을 따른다', expectedTitles.every((title, i) => titleOf(i).includes(title)), AGREEMENT_SECTIONS.map((s) => s.t));
check('계약→인도→사용→보험·사고→반납→정산 순이다',
  titleOf(3).includes('체결') && titleOf(11).includes('인도') && titleOf(13).includes('관리책임')
    && titleOf(16).includes('사고처리') && titleOf(20).includes('반환시기') && titleOf(24).includes('정산'));
check('약관 제목에 상품형이나 저신용 표현을 넣지 않는다',
  !AGREEMENT_SECTIONS.some((s) => /저신용|무심사|반납형|인수형/.test(`${s.t} ${s.b}`)));

// ── 인쇄본 ↔ 전자계약 정본 동기화 ──
check('인쇄/PDF 약관과 전자계약 전송 약관이 완전히 같다',
  htmlAgreement.length === AGREEMENT_SECTIONS.length
    && htmlAgreement.every((section, index) => section.t === AGREEMENT_SECTIONS[index].t && section.b === AGREEMENT_SECTIONS[index].b),
  htmlAgreement.filter((section, index) => section.t !== AGREEMENT_SECTIONS[index]?.t || section.b !== AGREEMENT_SECTIONS[index]?.b).map((s) => s.t));
check('조 제목은 제N조(제목) 형식이다', htmlAgreement.every((section) => /^제\d+조\([^()]+\)$/.test(section.t)));
check('단독 항 하나에만 ①을 붙인 조문이 없다', htmlAgreement.every((section) => (section.b.match(/[①-⑳]/g)?.length ?? 0) !== 1));
check('장 제목을 중복 표시하지 않는다', $('#termsSource > .t-chapter').length === 0 && !/제\d+장/.test($('#termsSource').text()));
check('첫 장에 중복 계약 주요조건 요약을 두지 않는다',
  $('.cover-summary').length === 0
    && !contractHtml.includes('계약 주요조건 요약')
    && !articleBody('제2조').includes('주요조건 요약'));
check('법률문서에 장식성 뱃지를 두지 않는다',
  $('.shtag, .cp-tag').length === 0
    && !contractHtml.includes('준수사항</span>')
    && !contractHtml.includes('필수 절차</span>')
    && !contractHtml.includes('매출·매입 증빙</span>')
    && !contractHtml.includes('약관 적용 기준</span>'));
const deductibleRule = $('.k').filter((_, el) => norm($(el).text()) === '자차 면책금').first().next('.v');
check('자차 면책금은 비율·최소·최대 금액을 하나의 강조 조건으로 표시한다',
  deductibleRule.find('b').length === 1
    && deductibleRule.find('b [data-field="self_damage_deductible_rate"]').length === 1
    && deductibleRule.find('b [data-field="self_damage_deductible_min"]').length === 1
    && deductibleRule.find('b [data-field="self_damage_deductible_max"]').length === 1
    && /수리비의.*최소.*최대/.test(norm(deductibleRule.find('b').text())));
check('약관 문단은 왼쪽 맞춤·글자 경계 줄바꿈이다',
  /\.terms-cols p\{[^}]*text-align:left[^}]*\}/.test(contractHtml)
    && /\.terms-cols p\{[^}]*word-break:normal[^}]*\}/.test(contractHtml)
    && !/\.terms-cols p\{[^}]*text-align:justify[^}]*\}/.test(contractHtml));
check('승계수수료 항은 같은 단에서 자동 병합한다',
  /<p>③ 임차인이 회사가 승인한 신규 임차인/.test(contractHtml)
    && contractHtml.includes("next.getAttribute('data-flow-group')===group"));
check('같은 단에 배치된 자동분할 조각은 다시 한 문단으로 병합한다',
  contractHtml.includes("fragment.setAttribute('data-flow-group',flowGroup)")
    && contractHtml.includes("next.getAttribute('data-flow-group')===group")
    && contractHtml.includes("while(next.firstChild) node.appendChild(next.firstChild)"));
check('축약 조문 참조를 사용하지 않는다', !/제\d+조[①-⑳]/.test(contractHtml) && !/제\d+(?:조)?[·ㆍ]제?\d+조/.test(contractHtml));

const forbiddenItems: string[] = [];
let forbiddenNext = $('#termsSource > .t-art').filter((_, el) => norm($(el).text()) === '제15조(금지행위)').next();
while (forbiddenNext.length && !forbiddenNext.hasClass('t-art')) {
  if (forbiddenNext.hasClass('t-sub')) forbiddenItems.push(norm(forbiddenNext.text()));
  forbiddenNext = forbiddenNext.next();
}
check('금지행위는 도입문 뒤 8개 호로 정리한다',
  forbiddenItems.length === 8 && forbiddenItems.every((item, index) => item.startsWith(`${index + 1}. `)), forbiddenItems);

// ── 프리패스 장기렌트 핵심 조건 ──
check('계약서·특약·약관의 적용순서를 제4조에 둔다',
  /특약.*개별계약서.*본 약관.*부속서류/.test(articleBody('제4조')));
check('대여기간은 계약일이 아니라 실제 차량 인도일부터 계산한다',
  articleBody('제4조').includes('실제 차량 인도일부터 계약서상 개월 수')
    && articleBody('제4조').includes('대응일이 없으면 그 월 말일')
    && contractHtml.includes('차량 인도일로부터 00개월'));
check('중고차의 통상 사용흔적과 미고지 중대하자를 함께 규정한다',
  articleBody('제12조').includes('경년변화 및 통상적인 사용흔적')
    && articleBody('제12조').includes('고지하지 않은 중대한 하자'));
check('등록 운전자는 만 21세 이상으로 제한한다', articleBody('제13조').includes('만 21세 이상'));
check('추가 운전자는 운전 전 승인·자격확인·보험효력 발생이 필요하다',
  articleBody('제13조').includes('실제 운전 전에 회사의 승인') && articleBody('제13조').includes('보험·공제의 효력이 발생하기 전'));
check('보험사·보상한도 변동은 계약서와 실제 유효조건으로 처리한다',
  articleBody('제11조').includes('보험자나 공제사업자는 계약기간 중 변경될 수 있으며')
    && articleBody('제11조').includes('사고 당시 유효한 증권·약관'));
check('사고다발은 사고일 기준 직전 1년·과실 50% 이상·총 3회다',
  articleBody('제7조').includes('직전 1년 이내') && articleBody('제7조').includes('과실비율 50% 이상') && articleBody('제7조').includes('3회'));
check('중도해지 청구는 회수금액을 공제하고 중복청구하지 않는다',
  articleBody('제8조').includes('회수하거나 지출을 면한 금액은 공제') && articleBody('제8조').includes('중복 청구하지 않는다'));
check('승계수수료는 계약서상 회사별 금액을 적용한다',
  articleBody('제8조').includes('계약서에 정한 승계수수료')
    && contractHtml.includes('data-field="succession_allowed"')
    && contractHtml.includes('data-field="succession_fee"'));
check('사고 수리는 사전승인과 객관적 자료를 요구한다',
  articleBody('제17조').includes('지정하거나 승인한 정비공장')
    && articleBody('제17조').includes('견적서·정비명세서·영수증'));
check('사고 관련 블랙박스·현장자료를 보존하고 정당한 요청에 제공한다',
  articleBody('제17조').includes('블랙박스 영상') && articleBody('제17조').includes('정당한 요청'));
check('자차 자기부담액은 실제 수리비를 넘지 않는다', articleBody('제18조').includes('실제 수리비를 초과하지 않는다'));
check('손해는 실제·통상손해 기준이고 중복청구하지 않는다',
  articleBody('제16조').includes('객관적인 자료') && articleBody('제16조').includes('중복 청구하지 않는다'));
check('등록명의자인 회사에 먼저 청구된 금액은 실제 지급자료로 정산한다',
  articleBody('제16조').includes('등록명의자 또는 소유자') && articleBody('제16조').includes('실제 지급액'));
check('반납평가는 사전 기준 또는 독립기관을 쓰고 산정근거를 제공한다',
  articleBody('제22조').includes('미리 기재된 반납평가기준') && articleBody('제22조').includes('독립된 전문평가기관'));
check('회사 권리 양도 시 사용권을 보호하고 변경사항을 통지한다',
  articleBody('제10조').includes('차량 사용권을 침해하지 않는 범위') && articleBody('제10조').includes('효력발생일'));
check('초과주행은 사용일수와 제외거리를 반영한다',
  articleBody('제23조').includes('실제 사용일수') && articleBody('제23조').includes('임차인의 사용과 무관한 거리'));
check('계약 중 확인된 초과주행은 즉시 정산하고 최고 후 미납 시 해지할 수 있다',
  articleBody('제23조').includes('확인일 현재 사용기간에 비례한 약정거리')
    && articleBody('제23조').includes('산정근거와 납부기한')
    && articleBody('제23조').includes('상당한 기간을 정하여 이행을 최고')
    && articleBody('제23조').includes('중복 청구하지 않는다'));
check('금지행위와 보험보상에 중대한 법규위반 사고 기준을 함께 둔다',
  articleBody('제15조').includes('교통사고처리 특례법')
    && articleBody('제18조').includes('교통사고처리 특례법')
    && articleBody('제18조').includes('모든 민사상 책임에서 중대한 과실이 자동 확정되는 것은 아니다'));
check('계약서 부가장비에는 스페어키 개수를 표시하지 않는다',
  !contractHtml.includes('스페어키') && !contractHtml.includes('data-field="spare_key_count"'));
check('보험 표준값과 지연손해금 표기를 반영한다',
  contractHtml.includes('사망·후유장애 1인당 3천만원')
    && contractHtml.includes('data-field="coverage_uninsured">미가입')
    && contractHtml.includes('data-field="late_fee_rate">연 24%')
    && contractHtml.includes('관계 법령상 허용 한도 내'));
check('차량보호조치는 기록 통지와 안전한 정차를 전제로 한다',
  articleBody('제24조').includes('기록이 남는 방법') && articleBody('제24조').includes('안전하게 정차된 사실'));
check('시동제어 연체일은 청구일이 아니라 각 납부기한 다음 날부터 계산한다',
  !contractHtml.includes('청구일로부터')
    && contractHtml.includes('각 납부기한 다음 날부터 계산하여')
    && articleBody('제24조').includes('계약서상 납부일')
    && articleBody('제24조').includes('청구서상 납부기한'));
check('확정 인수가격은 사고·시세만으로 증액하거나 거절하지 않는다',
  articleBody('제26조').includes('가격을 증액하거나 인수를 거절할 수 없다'));
check('만기 반납이 원칙이고 연장·인수는 기한 내 신청한다',
  articleBody('제26조').includes('만기 반납을 원칙')
    && articleBody('제26조').includes('연장 신청이나 인수옵션 행사가 없으면'));
check('주민등록번호는 구체적인 법령 근거가 있는 범위에서만 처리한다',
  articleBody('제27조').includes('법령이 구체적으로 요구하거나 허용하는 범위'));
check('서면 계약서와 완료된 전자문서 PDF를 각각 교부·보관한다',
  articleBody('제27조').includes('서명·기명날인한 계약서를 각 1부씩 보관')
    && articleBody('제27조').includes('전자문서(PDF)로 교부'));

// ── 중요 조문 강조 ──
check('띄어쓰기가 달라도 중요조문을 찾는다', keyClauseOf('제 24조(차량 미반환)')?.clause === '제24조');
check('일반 조문은 중요조문으로 오인하지 않는다', keyClauseOf('제28조(분쟁해결 및 관할법원)') === null);
const marked = agreementWithEmphasis();
const emphasized = marked.filter((section) => section.emphasis);
check('강조 대상 수가 선언과 같다', emphasized.length === KEY_CLAUSES.length);
check('강조는 전체 절반보다 적다', emphasized.length < marked.length / 2, `${emphasized.length}/${marked.length}`);
check('강조 조문에는 요약·위험유형이 있다', emphasized.every((section) => section.summary && section.risk));
check('요약은 실제 존재하는 조문만 참조한다', keyClauseSummaries().every((key) => AGREEMENT_SECTIONS.some((s) => s.t.startsWith(key.clause))));
check('위험유형은 미납·운전자·사고 세 갈래다',
  [...new Set(KEY_CLAUSES.map((k) => k.risk))].sort().join('|') === ['미납', '사고', '운전자'].sort().join('|'));
check('강조 처리 중 약관 본문을 바꾸지 않는다',
  marked.every((section, index) => section.t === AGREEMENT_SECTIONS[index].t && section.b === AGREEMENT_SECTIONS[index].b));

// ── 계약서 요약 섹션과 부속 화면 ──
const contract = {
  contract_code: 'C-1', rent_month_snapshot: 36, rent_amount_snapshot: 690000,
  deposit_amount_snapshot: 3000000, payment_timing_snapshot: '후불',
  car_number_snapshot: '12가3456', customer_name: '홍길동', esign_inputs: {},
} as unknown as EntityRecord;
const policy = {
  basic_driver_age: '만 26세 이상', maintenance_service: '정비제외',
  early_termination_rate_under1y: 0.3, early_termination_rate_over1y: 0.2,
  accident_termination_count: 2, succession_allowed: '협의', succession_fee: 1000000,
  payment_cycle: '월납', payment_timing: '선불', payment_method: 'CMS 자동이체',
};
const groups = buildConsentGroups(contract, policy, '회사포함');
const rowsOf = (key: string) => groups.find((group) => group.key === key)?.rows || [];
check('계약서 요약의 사고다발 기준도 표준 3회로 고정한다',
  rowsOf('accident').some((row) => row.label === '사고 다발 시 계약해지 기준' && row.value.includes('총 3회')));
check('보험사 대표번호를 계약서에 고정하지 않는다',
  !contractHtml.includes('insurer_phone') && !rowsOf('accident').some((row) => /\d{3,4}-\d{3,4}/.test(row.value)));
check('고객 확인 화면에 회사별 승계수수료를 표시한다',
  rowsOf('payment').some((row) => row.label === '계약 승계수수료' && row.value === '1,000,000원'));
check('선불·후불은 결제주기·결제방식과 분리해 표시한다',
  rowsOf('payment').some((row) => row.label === '대여료 결제주기' && row.value === '월납')
    && rowsOf('payment').some((row) => row.label === '대여료 납부 조건' && row.value === '후불')
    && rowsOf('payment').some((row) => row.label === '결제 방식' && row.value === 'CMS 자동이체'));
check('개별계약의 후불 스냅샷이 회사 정책의 선불 기본값보다 우선한다',
  rowsOf('payment').some((row) => row.label === '대여료 납부 조건' && row.value === '후불'));
check('계약서와 약관에 선불·후불 조건을 함께 명시한다',
  contractHtml.includes('data-field="payment_timing"')
    && contractHtml.includes("payment_timing:['선불','후불']")
    && articleBody('제6조').includes('선불은 해당 사용월의 대여료를 사용 전에')
    && articleBody('제6조').includes('후불은 해당 사용월의 대여료를 사용 후'));
check('자동이체일 복제 필드를 두지 않는다',
  !contractHtml.includes('auto_debit_date_inline') && !individualHtml.includes('auto_debit_date_inline'));
check('특약은 표준값 반복이 아니라 예외·추가 합의용이다',
  contractHtml.includes("['special_terms','특약사항 (예외·추가 합의만)',2]"));

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
