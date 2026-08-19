/**
 * 공급사 제공시트 「회사정보」 탭 — 회사가 **한 번만** 적는 것(사장님 2026-08-19).
 *
 * ★왜 따로 두나
 *   정책 탭은 «정책마다» 다른 값이고, 여기는 «회사마다» 하나인 값이다(상호·사업자번호·대표자·주소·입금계좌). 계약서 임대인 칸이 여기서 채워진다 — 비면 전자계약 링크를 못 만든다.
 *   정책 탭의 「전용계좌」는 이 탭으로 옮기며 뺐다(「정책에 계좌는 빼자 · 통장사본 받아서 업로드」).
 *
 * ★어떻게 받나
 *   값만 적는다(사장님 2026-08-19 「회사정보에는 그냥 입력만」). 첨부(사업자등록증·통장사본)는 시트에서 받지 않는다.
 *   값 칸(B열)은 사람이 적는 칸이라 다시 찍을 때 건드리지 않는다.
 *
 * ★ERP 매핑: `field` = 파트너 레코드 키(계약서 임대인 칸으로 감). 시트 → 파트너 반영은 정책과 같은 «검토 승인» 단계로.
 */
export const COMPANY_INFO_TAB_TITLE = '회사정보';

export type CompanyInfoRow =
  | { kind: 'section'; title: string; note?: string }
  | { kind: 'attach'; label: string; note: string; key: string }
  | { kind: 'field'; label: string; note: string; field: string; example?: string; ocr?: '사업자등록증' | '통장사본' };

export const COMPANY_INFO_ROWS: CompanyInfoRow[] = [
  // 사장님 2026-08-19 「회사정보에는 그냥 입력만」 — 첨부(사업자등록증·통장사본)는 여기서 받지 않는다. 값만 적는다.
  { kind: 'section', title: '① 사업자등록증 정보', note: '사업자등록증에 적힌 대로 적어 주세요. 계약서 임대인 칸에 그대로 실립니다.' },
  { kind: 'field', label: '상호(법인명)', note: '계약서 임대인 상호', field: 'name', example: '주식회사 손오공렌터카' },
  { kind: 'field', label: '사업자등록번호', note: '숫자와 - 만', field: 'business_number', example: '110-81-83379' },
  { kind: 'field', label: '법인등록번호', note: '법인이면 · 13자리(사장님 2026-08-19)', field: 'corporate_registration_no', example: '110111-0000000' },
  { kind: 'field', label: '대표자', note: '계약서 임대인 대표자', field: 'ceo', example: '홍길동' },
  { kind: 'field', label: '사업장 주소', note: '계약서 임대인 주소 — 도로명 주소', field: 'address', example: '서울특별시 강남구 …' },
  { kind: 'field', label: '업태 · 종목', note: '참고(계약서엔 안 실림)', field: 'biz_category', example: '서비스 · 자동차대여' },

  { kind: 'section', title: '② 연락처 · 등록', note: '사고 접수와 계약 확인에 쓰는 번호입니다.' },
  { kind: 'field', label: '대표번호(사고 접수처)', note: '계약서 임대인 연락처 · 사고 접수 안내에 실립니다', field: 'phone', example: '02-000-0000' },
  { kind: 'field', label: '담당자 이름', note: '프리패스가 연락할 사람', field: 'contact_name' },
  { kind: 'field', label: '담당자 연락처', note: '휴대전화', field: 'contact_phone', example: '010-0000-0000' },
  { kind: 'field', label: '담당자 이메일', note: '계약서·정산 자료 전달', field: 'contact_email' },

  { kind: 'section', title: '③ 입금계좌', note: '대여료·보증금이 들어갈 계좌입니다. 예금주는 상호와 같아야 합니다.' },
  { kind: 'field', label: '은행', note: '', field: 'bank_name', example: '신한' },
  { kind: 'field', label: '계좌번호', note: '숫자와 - 만', field: 'bank_account', example: '100-032-471576' },
  { kind: 'field', label: '예금주', note: '상호와 다르면 사유를 옆에', field: 'bank_holder', example: '(주)손오공렌터카' },
];

/** 회사정보 탭 머리·설명 문구. */
export const COMPANY_INFO_HEADER = ['항목', '입력(여기에 적어 주세요)', '설명'] as const;
export const COMPANY_INFO_INTRO = [
  '회사 정보 입력하기 — 회사가 한 번만 적는 것입니다. 계약서의 임대인 칸(상호·사업자등록번호·대표자·주소·입금계좌)이 여기서 채워집니다.',
  '노란 칸(B열)에 값만 적어 주세요. 값이 바뀌면 이 탭만 고쳐 주시면 됩니다.',
] as const;

/** 파트너 레코드 키 목록 — 반영·감사 도구가 쓴다. */
export const COMPANY_INFO_FIELDS = COMPANY_INFO_ROWS.filter((r): r is Extract<CompanyInfoRow, { kind: 'field' }> => r.kind === 'field');
