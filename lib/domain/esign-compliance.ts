/**
 * 전자계약 법적 요건 점검표 — **빠진 게 없는지 기계로 센다.**
 *
 * ⚠ 이건 **구조 점검이지 법률 자문이 아니다.** 「항목이 화면에 있는가」를 볼 뿐,
 *   문구가 법적으로 충분한지는 판단하지 못한다. 실계약 투입 전 **법률 검토를 받아야 한다.**
 *   여기 통과했다고 「법적으로 문제없다」가 되지 않는다 — 빠진 것을 찾는 그물일 뿐이다.
 *
 * ★근거 법령
 *   전자문서 및 전자거래 기본법 §4·§5   전자문서 효력·보관
 *   전자서명법 §3                        전자서명 효력
 *   약관의 규제에 관한 법률 §3           **명시·설명의무** ← 우리 강조 장치의 근거
 *   개인정보 보호법 §15·§17·§22          수집·이용·제3자제공 동의 요건
 *   여객자동차 운수사업법 §34의2②         대여사업자의 운전자격 확인 의무
 *   보증인 보호를 위한 특별법 §4·§6       연대보증 서면·최고액 특정
 */

/** 못 지키면 계약 내용으로 주장 못 하거나 동의가 무효가 되는 것 = `필수`. */
export type ComplianceLevel = '필수' | '권고';

export type ComplianceItem = {
  key: string;
  law: string;
  title: string;
  /** 무엇을 갖추면 충족인가. */
  requirement: string;
  level: ComplianceLevel;
  /** 못 지키면 실제로 무슨 일이 생기나 — 「그냥 하라」가 아니라 결과를 적는다. */
  risk: string;
  /** 우리 payload/화면의 어디가 이걸 담당하나. */
  coveredBy: string;
};

export const COMPLIANCE_ITEMS: ComplianceItem[] = [
  /* ── 약관 명시·설명의무 — 우리 사업에서 제일 자주 터지는 곳 ── */
  {
    key: 'terms_disclosed',
    law: '약관규제법 §3①',
    title: '약관 전문 명시',
    requirement: '계약 체결 전 약관 전문을 손님이 볼 수 있어야 한다.',
    level: '필수',
    risk: '그 약관을 계약 내용으로 주장할 수 없다(§3④).',
    coveredBy: 'agreement.sections 28개조 전문',
  },
  {
    key: 'terms_read_through',
    law: '약관규제법 §3①',
    title: '약관 통독 확인',
    requirement: '스크롤 끝에 닿기 전에는 동의 버튼이 눌리지 않아야 한다.',
    level: '권고',
    risk: '「보여줬다」는 입증이 약해진다.',
    coveredBy: 'agreement.requireReadThrough',
  },
  {
    key: 'terms_key_explained',
    law: '약관규제법 §3②',
    title: '중요 내용 설명',
    requirement: '손님에게 불리하거나 예상하기 어려운 조항을 따로 강조해 설명해야 한다.',
    level: '필수',
    risk: '그 조항만 계약에서 빠진다 — 위약금·면책금 조항이 무효가 될 수 있다.',
    coveredBy: 'agreement.sections[].emphasis + keyClauses (미납·운전자·사고)',
  },
  {
    key: 'terms_key_reconfirm',
    law: '약관규제법 §3②',
    title: '중요 내용 재확인',
    requirement: '통독 후 주요 사항을 요약해 다시 확인받는다.',
    level: '권고',
    risk: '「설명했다」의 증거가 통독 기록뿐이라 다투기 쉽다.',
    coveredBy: 'keyClauses.confirmLabel + 동의 시각',
  },

  /* ── 개인정보 ── */
  {
    key: 'privacy_items_purpose_period',
    law: '개인정보보호법 §15②',
    title: '수집·이용 동의 3요소',
    requirement: '수집 항목·이용 목적·보유 기간을 각각 알리고 동의받는다.',
    level: '필수',
    risk: '동의가 무효가 되고 과태료 대상이다.',
    coveredBy: 'consentAtoms[].items / purpose / retention',
  },
  {
    key: 'privacy_third_party',
    law: '개인정보보호법 §17②',
    title: '제3자 제공 동의 4요소',
    requirement: '받는 자·이용 목적·제공 항목·보유 기간을 알리고 별도로 동의받는다.',
    level: '필수',
    risk: '제3자 제공이 위법이 된다 — 자동이체 출금 대행이 막힌다.',
    coveredBy: 'consentAtoms[].recipients[]',
  },
  {
    key: 'privacy_refusal',
    law: '개인정보보호법 §22⑤',
    title: '거부권·불이익 고지',
    requirement: '동의를 거부할 수 있고 거부 시 어떤 불이익이 있는지 알린다.',
    level: '필수',
    risk: '「거부할 수 없는 동의」가 되어 무효다.',
    coveredBy: 'consentAtoms[].refusalNote',
  },
  {
    key: 'privacy_separate',
    law: '개인정보보호법 §22①',
    title: '필수·선택 동의 분리',
    requirement: '선택 동의(마케팅 등)를 필수 동의와 묶어 받지 않는다.',
    level: '필수',
    risk: '끼워넣기 동의로 전체가 무효가 될 수 있다.',
    coveredBy: 'consentAtoms[].required (현재 마케팅 동의 없음)',
  },

  /* ── 렌터카 특유 ── */
  {
    key: 'driver_license_check',
    law: '여객자동차법 §34의2②',
    title: '운전자격 확인',
    requirement: '계약서상 운전자의 면허 효력·범위를 확인해야 한다.',
    level: '필수',
    risk: '사업자 제재 대상이다.',
    coveredBy: '운전면허증 제출 + 관리자 원본·유효성 확인 + 약관 제13조',
  },

  /* ── 전자서명·전자문서 ── */
  {
    key: 'signer_identity',
    law: '전자서명법 §3',
    title: '서명자 확인',
    requirement: '누가 서명했는지 확인할 수 있어야 한다.',
    level: '필수',
    risk: '서명의 진정성을 다투면 방어가 어렵다.',
    coveredBy: '운전면허증·셀카 제출 + 관리자 대조 + auditTrail.identity',
  },
  {
    key: 'sign_intent',
    law: '전자서명법 §3',
    title: '서명 의사 표시',
    requirement: '서명한다는 의사를 명시적으로 표시하게 한다.',
    level: '필수',
    risk: '「눌린 것뿐」이라는 주장에 취약하다.',
    coveredBy: '자체 전자계약 서명 화면의 명시 문구 + 확인하고 전자서명 제출',
  },
  {
    key: 'integrity',
    law: '전자문서법 §5',
    title: '무결성 보장',
    requirement: '서명 후 내용이 바뀌지 않았음을 증명할 수 있어야 한다.',
    level: '필수',
    risk: '문서 내용 자체를 다툴 수 있다.',
    coveredBy: 'sealHash(SHA-256) + 타임스탬프',
  },
  {
    key: 'retention',
    law: '전자문서법 §5',
    title: '보관·재현',
    requirement: '계약 내용을 그대로 열람·재현할 수 있게 보관한다.',
    level: '필수',
    risk: '분쟁 때 계약서를 못 낸다.',
    coveredBy: 'documentUrl(본문 사본) + verifyUrl',
  },
  {
    key: 'copy_to_customer',
    law: '약관규제법 §3① · 상관례',
    title: '손님에게 사본 제공',
    requirement: '체결된 계약서 사본을 손님이 받아 볼 수 있어야 한다.',
    level: '필수',
    risk: '교부 의무 미이행 — 손님이 내용을 몰랐다고 다툰다.',
    coveredBy: '서명 완료 후 같은 고객 링크의 완료 PDF 열람·다운로드',
  },
  {
    key: 'version_pinning',
    law: '실무',
    title: '판(version) 고정',
    requirement: '어느 판의 약관·양식으로 서명했는지 남긴다.',
    level: '필수',
    risk: '문구를 고친 뒤 「그때 뭐였나」를 못 댄다.',
    coveredBy: 'agreementVersion + templateVersion',
  },

  /* ── 조건부 ── */
  {
    key: 'guarantor_written',
    law: '보증인보호법 §4·§6',
    title: '연대보증 서면·최고액',
    requirement: '보증 채무의 최고액을 서면으로 특정하고 보증인이 직접 서명한다.',
    level: '필수',
    risk: '보증계약이 무효가 된다.',
    coveredBy: '별도 연대보증 약정서(A4 부속서식)의 보증 최고액·보증인 서명 + 주계약 발행 혼입 차단',
  },
  {
    key: 'minor_check',
    law: '민법 §5',
    title: '미성년자 확인',
    requirement: '미성년자는 법정대리인 동의가 없으면 취소할 수 있다.',
    level: '권고',
    risk: '계약이 취소될 수 있다.',
    coveredBy: '본인확인 생년월일 + 운전자 연령 요건(만 21세 이상)',
  },
];

/** 아직 구현이 안 된 항목 — `coveredBy` 에 ⚠ 가 붙은 것. 숨기지 말고 센다. */
export function openComplianceItems(): ComplianceItem[] {
  return COMPLIANCE_ITEMS.filter((x) => x.coveredBy.includes('⚠'));
}

export function requiredOpenItems(): ComplianceItem[] {
  return openComplianceItems().filter((x) => x.level === '필수');
}

export function complianceSummary(): { total: number; covered: number; open: number; requiredOpen: number } {
  const open = openComplianceItems().length;
  return {
    total: COMPLIANCE_ITEMS.length,
    covered: COMPLIANCE_ITEMS.length - open,
    open,
    requiredOpen: requiredOpenItems().length,
  };
}
