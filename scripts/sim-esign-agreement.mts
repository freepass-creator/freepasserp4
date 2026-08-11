/**
 * 약관 강조·중복제거 검증 — 「손님이 못 봤다」를 막는 장치가 실제로 작동하는지.
 * 실행: npx tsx scripts/sim-esign-agreement.mts
 */
import { AGREEMENT_SECTIONS } from '../lib/domain/esign-agreement-text';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import {
  KEY_CLAUSES, agreementWithEmphasis, keyClauseOf, keyClauseSummaries,
} from '../lib/domain/esign-agreement-emphasis';
import { IN_AGREEMENT, KEEP_IN_SECTION, TERMS_ACCIDENT, TERMS_PAYMENT, TERMS_SERVICE } from '../lib/domain/esign-standard-terms';
import { buildConsentGroups } from '../lib/domain/esign-consent-doc';
import type { EntityRecord } from '../lib/intake/entities';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, detail ?? ''); }
};

// ── 조문 매칭 ──
check('금지행위는 제9조로 잡힌다', keyClauseOf('제9조(금지행위)')?.clause === '제9조');
check('중요하지 않은 통지 조문은 안 잡힌다', keyClauseOf('제13조(통지 및 도달)') === null);
check('띄어쓰기가 달라도 잡는다', keyClauseOf('제 15조(중도해지수수료 및 승계)')?.clause === '제15조');

// ── 인쇄/PDF 약관 ↔ 착한거래 전송 약관 동기화 ──
// 계약서 HTML이 정본이다. 두 벌이 갈라지면 인쇄본과 실제 서명 화면의 권리·의무가 달라진다.
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
check('인쇄/PDF 약관과 착한거래 전송 약관이 완전히 같다',
  htmlAgreement.length === AGREEMENT_SECTIONS.length
    && htmlAgreement.every((section, index) => (
      section.t === AGREEMENT_SECTIONS[index].t && section.b === AGREEMENT_SECTIONS[index].b
    )),
  htmlAgreement.filter((section, index) => (
    section.t !== AGREEMENT_SECTIONS[index]?.t || section.b !== AGREEMENT_SECTIONS[index]?.b
  )).map((section) => section.t));
check('조 제목은 제N조(제목) 형식으로 통일한다',
  htmlAgreement.every((section) => /^제\d+조(?:의\d+)?\([^()]+\)$/.test(section.t)),
  htmlAgreement.map((section) => section.t));
check('항이 하나뿐인 조문에는 단독 ①을 붙이지 않는다',
  htmlAgreement.every((section) => (section.b.match(/[①-⑳]/g)?.length ?? 0) !== 1),
  htmlAgreement.filter((section) => (section.b.match(/[①-⑳]/g)?.length ?? 0) === 1).map((section) => section.t));
check('21개 조문 규모의 약관에는 장 제목을 중복 표시하지 않는다',
  $('#termsSource > .t-chapter').length === 0 && !/제\d+장/.test($('#termsSource').text()));
check('약관 문단은 왼쪽 맞춤과 한글 글자 경계 줄바꿈을 사용한다',
  /\.terms-cols p\{[^}]*text-align:left[^}]*\}/.test(contractHtml)
    && /\.terms-cols p\{[^}]*word-break:normal[^}]*\}/.test(contractHtml)
    && !/\.terms-cols p\{[^}]*text-align:justify[^}]*\}/.test(contractHtml));
check('축약 조문 참조를 사용하지 않는다',
  !/제\d+조[①-⑳]/.test(contractHtml)
    && !/제\d+(?:조)?[·ㆍ]제?\d+조/.test(contractHtml));
const forbiddenItems: string[] = [];
let forbiddenNext = $('#termsSource > .t-art').filter((_, el) => norm($(el).text()) === '제9조(차량 사용 제한)').next();
while (forbiddenNext.length && !forbiddenNext.hasClass('t-art')) {
  if (forbiddenNext.hasClass('t-sub')) forbiddenItems.push(norm(forbiddenNext.text()));
  forbiddenNext = forbiddenNext.next();
}
check('금지행위는 보호범위를 유지하며 중복을 합친 8개 호다',
  forbiddenItems.length === 8 && forbiddenItems.every((item, index) => item.startsWith(`${index + 1}. `)),
  forbiddenItems);

// 섹션별 값 소유권: 한 값은 한 섹션만 가진다. 약관은 값이 아니라 적용 절차를 설명한다.
const sectionLabels = (title: string): string[] => $('.section').filter((_, el) => (
  norm($(el).find('.sec-h .t').first().text()) === title
)).first().find('.kv > .k').map((_, el) => norm($(el).text())).get();
const rentalLabels = sectionLabels('대여 조건');
const insuranceLabels = sectionLabels('자동차 보험');
check('보험 가입 주체·포함 여부는 자동차 보험 섹션만 소유한다',
  !rentalLabels.includes('보험')
    && insuranceLabels.filter((label) => label === '보험 조건').length === 1);
check('대여 조건에는 보험료 포함 문구가 중복되지 않는다',
  !$('.section').filter((_, el) => norm($(el).find('.sec-h .t').first().text()) === '대여 조건')
    .first().text().includes('월 대여료에 포함'));
const insuranceSection = $('.section').filter((_, el) => (
  norm($(el).find('.sec-h .t').first().text()) === '자동차 보험'
)).first();
check('자차부담률 값은 자동차 보험 섹션에서 한 번만 표시한다',
  insuranceSection.find('[data-field="self_damage_deductible_rate"]').length === 1);
// 보험사 대표번호는 매년 바뀐다 — 계약서에 박아 두면 몇 해 뒤 끊긴 번호를
// 손님이 사고 현장에서 누른다. 체결일 기준 보험사«명»만 싣는다(2026-08-10).
check('보험사 대표번호를 계약서에 박지 않는다',
  !contractHtml.includes('insurer_phone'));
check('체결일 기준 보험사명은 자동차 보험 섹션에 있다',
  insuranceSection.find('[data-field="insurer_name"]').length >= 1);
check('자동이체일의 본문용 복제 필드를 두지 않는다',
  !contractHtml.includes('auto_debit_date_inline')
    && !individualHtml.includes('auto_debit_date_inline'));
check('특약 입력은 표준값 반복이 아닌 예외·추가 합의용이다',
  contractHtml.includes("['special_terms','특약사항 (예외·추가 합의만)',2]"));

const articleBody = (article: string) => AGREEMENT_SECTIONS.find((s) => s.t.startsWith(article))?.b || '';
check('신차 등록 전·후 해지 정산을 구분한다', articleBody('제15조').includes('차량 등록 전에는 실제 지출 비용만 정산'));
check('도난차 회수 후 정산 절차를 승계한다', articleBody('제11조').includes('도난 차량이 회수된 경우'));
check('회사 승인 시 지정자 명의 인수를 허용한다', articleBody('제17조').includes('임차인이 지정하고 회사가 사전에 승인한 자'));
check('같은 손해의 중복 청구를 금지한다', articleBody('제18조').includes('동일한 손해를 여러 명목으로 중복 청구하지'));
check('전자계약 완료본 교부·보관을 규정한다', /동일한 전자문서\(PDF\)(?:를|로) 임차인에게 교부/.test(articleBody('제21조')));
check('중고차량의 경년변화·통상 사용흔적을 인수 시 확인한다',
  articleBody('제7조').includes('경년변화 및 통상적인 사용흔적'));
check('중고차량 확인이 미고지 중대하자까지 면책하지 않는다',
  articleBody('제7조').includes('고지하지 않은 중대한 하자')
    && articleBody('제7조').includes('안전운행에 지장을 주는 결함')
    && articleBody('제7조').includes('통상적인 점검으로 확인하기 어려운 하자'));
check('약관 정본은 계약 유형과 무관하게 중고차 조건부 항을 포함한다',
  articleBody('제7조').includes('중고차량인 경우')
    && !contractHtml.includes('data-condition="used-vehicle"'));
check('약관 제목은 인수·반납·렌탈·구독 유형과 무관하게 하나다',
  contractHtml.includes("var TERMS_TITLE='자동차 렌탈(대여) 약관'")
    && !/ttitle\s*:/.test(contractHtml)
    && !/자동차 (?:렌탈|구독) 계약 약관 \((?:인수형|반납형|선택형)\)/.test(contractHtml));
check('약관 서문에도 인수·반납·렌탈·구독 상품명을 주입하지 않는다',
  !/<div id="termsSource"[\s\S]*?data-field="product_label"[\s\S]*?<div id="termsPages">/.test(contractHtml));

const lifecycleTitles = [
  '적용범위', '계약기간', '대여료', '보증금', '운전자격', '보험조건', '차량 인도',
  '차량 사용', '차량 사용 제한', 'GPS', '사고처리', '연체', '통지', '계약 종료',
  '중도해지', '초과주행', '만기 차량 인수', '비용부담', '개인정보', '연대보증', '효력',
];
check('약관은 계약조건에서 인도·운행·사고·반납·정산 순으로 흐른다',
  AGREEMENT_SECTIONS.length === lifecycleTitles.length
    && AGREEMENT_SECTIONS.every((section, index) => section.t.includes(lifecycleTitles[index])),
  AGREEMENT_SECTIONS.map((section) => section.t));

// ── 강조 대상 ──
const marked = agreementWithEmphasis();
check('약관은 중복을 합친 21개 조문이다', marked.length === 21 && marked.length === AGREEMENT_SECTIONS.length);
const emph = marked.filter((s) => s.emphasis);
check(`강조 조문 ${emph.length}개`, emph.length === KEY_CLAUSES.length, emph.map((s) => s.t.slice(0, 12)));
// 다 강조하면 아무것도 강조되지 않는다.
check('강조가 절반을 넘지 않는다', emph.length < marked.length / 2, `${emph.length}/${marked.length}`);
check('강조 조문엔 요약이 붙는다', emph.every((s) => !!s.summary && !!s.risk));
check('비강조엔 요약이 없다', marked.filter((s) => !s.emphasis).every((s) => !s.summary));
check('본문은 손대지 않는다',
  marked.every((s, i) => s.b === AGREEMENT_SECTIONS[i].b && s.t === AGREEMENT_SECTIONS[i].t));

// ── 요약은 실제 있는 조문만 ──
// 약관에 없는 조문을 요약에 넣으면 「약관에 없는 걸 동의받았다」가 된다.
const sums = keyClauseSummaries();
check('요약은 실재 조문만', sums.every((k) =>
  AGREEMENT_SECTIONS.some((s) => s.t.replace(/\s/g, '').startsWith(k.clause))), sums.map((k) => k.clause));
check('요약이 비지 않는다', sums.length > 0 && sums.every((k) => !!k.summary));
// 미납·운전자·사고 셋 — 분쟁이 실제로 나는 곳(2026-08-09 사장님 지정).
check('위험 갈래는 미납·운전자·사고',
  [...new Set(KEY_CLAUSES.map((k) => k.risk))].sort().join('|') === ['미납', '사고', '운전자'].sort().join('|'),
  [...new Set(KEY_CLAUSES.map((k) => k.risk))]);
check('갈래마다 조문이 있다',
  (['미납', '운전자', '사고'] as const).every((r) => KEY_CLAUSES.some((k) => k.risk === r)));

// ── 섹션↔약관 중복 제거 ──
// 약관에도 없고 섹션에서도 빼면 손님이 그 조건을 «아예» 못 본다. 여기가 제일 위험하다.
const flat = AGREEMENT_SECTIONS.map((s) => `${s.t} ${s.b}`).join(' ').replace(/[\s·,.()「」'"※]/g, '');
// ★문장이 아니라 **주제**로 본다. 약관은 같은 내용을 다른 말로 쓴다 —
//   우리 문구가 통째로 들어 있길 기대하면 안 되고, 그 조건이 «다뤄지는지»를 봐야 한다.
const TOPIC: Record<string, string[]> = {
  depositReturn: ['보증금', '반환'],
  repairShop: ['수리', '정비'],
  ownDamageRule: ['폐차'],
  insurer: ['보험'],
  maintenance: ['정비'],
  engineOil: ['정비'],
  loanerCar: ['대차'],
  deliveryFee: ['반납'],
  mileageOver: ['초과', '주행'],
  contactChange: ['통지'],
  fines: ['과태료'],
  special: ['GPS'],
};
for (const key of IN_AGREEMENT) {
  const words = TOPIC[key] || [];
  check(`«${key}» 주제가 약관에서 다뤄진다`,
    words.length > 0 && words.every((w) => flat.includes(w)), words);
}
// 우리 문구에만 있고 약관엔 없는 «값»이 있으면 그건 빼면 안 된다.
// 예: 「대차서비스 지원 불가」가 약관엔 없고 우리 문구에만 있으면 손님이 대차되는 줄 안다.
const ALL_TERMS = { ...TERMS_PAYMENT, ...TERMS_ACCIDENT, ...TERMS_SERVICE } as Record<string, string>;
const numericLeft = IN_AGREEMENT.filter((k) => /\d/.test(String(ALL_TERMS[k] ?? '')));
check('약관으로 보낸 것 중 숫자 든 문구는 없다', numericLeft.length === 0,
  numericLeft.map((k) => `${k}: ${String(ALL_TERMS[k]).slice(0, 40)}`));
check('빼는 것과 남기는 것이 안 겹친다',
  !IN_AGREEMENT.some((k) => (KEEP_IN_SECTION as readonly string[]).includes(k)),
  IN_AGREEMENT.filter((k) => (KEEP_IN_SECTION as readonly string[]).includes(k)));

// ── 섹션이 실제로 짧아졌는가 ──
const contract = { contract_code: 'C-1', rent_month_snapshot: 36, rent_amount_snapshot: 690000, deposit_amount_snapshot: 0 } as unknown as EntityRecord;
const policy = { basic_driver_age: '만 26세이상', maintenance_service: '정비제외', penalty_condition: '잔여 30%' };
const groups = buildConsentGroups(contract, policy, '회사포함');
const rowsOf = (k: string) => groups.find((g) => g.key === k)!.rows;
// 숫자·기한·연락처·부정조건이 든 건 남아 있어야 한다 — 약관 8,856자에 묻히면 못 본다.
check('면책금은 섹션에 남는다', rowsOf('accident').some((r) => r.value.includes('30만원')));
check('지연손해금은 섹션에 남는다', rowsOf('payment').some((r) => r.value.includes('연 12%')));
check('연체 시동제어는 섹션에 남는다', rowsOf('payment').some((r) => r.value.includes('시동제어')));
check('보증금 반환 기한은 섹션에 남는다', rowsOf('payment').some((r) => r.value.includes('1주일')));
check('검사대행은 섹션에 남는다', rowsOf('service').some((r) => r.value.includes('2년 1회')));
check('엔진오일 횟수는 섹션에 남는다', rowsOf('service').some((r) => r.value.includes('연 1회')));
check('키 개수는 섹션에 남는다', rowsOf('service').some((r) => r.value.includes('1개만')));
// 부정조건 — 약관이 대차를 다르게 말하면 손님이 대차되는 줄 안다.
check('대차 불가는 섹션에 남는다', rowsOf('service').some((r) => r.value.includes('지원 불가')));

// ★보험사는 매년 바뀐다 — 계약서에 이름·번호를 박으면 3년 계약이 1년 뒤부터 거짓말이 된다.
const insurerRow = rowsOf('accident').find((r) => r.label === '보험사')!;
check('보험사 칸은 있다', !!insurerRow);
check('보험사 번호를 계약서에 안 박는다', !/\d{4}-\d{4}|\d{4}-\d{3}/.test(insurerRow.value), insurerRow.value);
check('보험사는 계약조회로 안내한다', insurerRow.value.includes('계약조회'), insurerRow.value);
check('현재 보험사 값은 따로 들고 있다', TERMS_ACCIDENT.insurerCurrent.includes('1661-7977'));

// 약관으로 보낸 건 섹션에서 사라져야 한다.
check('정비 이용 절차는 섹션에서 빠졌다', !rowsOf('service').some((r) => r.label === '정비 이용'));
check('과태료 절차는 섹션에서 빠졌다', !rowsOf('service').some((r) => r.label === '과태료·차량검사'));
check('입고·대차 절차는 섹션에서 빠졌다', !rowsOf('accident').some((r) => r.label === '사고 차량 입고·대차'));

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
