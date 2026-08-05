/**
 * 시작안내 — «이 화면에서 무엇을 어떤 순서로 하는가».
 *
 * `faq.ts` 의 GUIDE 와 역할이 다르다. 그쪽은 «업무 규칙»(담당자·서류·수수료·출고조건)이고
 * 여기는 «화면 사용 순서»다. 둘을 한 곳에 섞으면 규칙을 고칠 때 사용법이 같이 흔들린다.
 *
 * 웹과 모바일이 같은 배열을 읽는다. 화면마다 문구를 복사하면 한쪽만 고쳐져 곧 서로 달라진다.
 *
 * 내용은 실제 코드에서 확인한 흐름만 적었다 —
 *   · 방 = 매물 × 영업자 (`deal.ts` ensureRoom: `CH_{매물}_{영업자}`), 영업자↔공급사 1:1
 *   · 서류 첨부는 그 방에서 한다 (`app/chat/page.tsx`: "계약문의를 시작하면 서류를 첨부할 수 있습니다")
 *   · 계약금 입금 체크가 차량 선점을 만든다 (`lib/server/vehicle-claim.ts`)
 *   · 계약 화면 = 목록 │ 계약진행상황 │ 첨부서류 │ 정산상태 (`app/contract/page.tsx`)
 */

export type StartStep = {
  /** 한 줄 제목 — 동사로 끝낸다(무엇을 하는가). */
  title: string;
  /** 한 문장 설명. 두 문장 이상 쓰지 않는다 — 길면 안 읽는다. */
  desc: string;
};

export type StartGuide = {
  /** 이 안내를 볼 역할 */
  roles: string[];
  headline: string;
  steps: StartStep[];
  /** 맨 아래 한 줄 — 더 볼 곳 */
  footer?: string;
};

const AGENT: StartGuide = {
  roles: ['agent', 'agent_admin', 'agent_manager'],
  headline: '상품을 찾아 문의하고, 계약까지 이 안에서 진행합니다',
  steps: [
    { title: '상품 찾기', desc: '왼쪽 필터로 좁히고, 보기(간단·상세·엑셀)는 우측 상단에서 바꿉니다.' },
    { title: '문의 열기', desc: '상품에서 문의를 열면 그 차량 담당 공급사와 1:1 대화방이 생깁니다.' },
    { title: '서류 첨부', desc: '면허증·계약서류는 그 대화방에 올립니다. 계약 화면의 첨부서류와 연결됩니다.' },
    { title: '계약금 · 정산', desc: '계약금 입금을 체크하면 그 차량이 선점돼 다른 계약이 가져갈 수 없습니다.' },
  ],
  footer: '수수료·서류·심사 기준은 「자주 묻는 질문」에 정리돼 있습니다.',
};

const PROVIDER: StartGuide = {
  roles: ['provider', 'provider_admin'],
  headline: '재고를 올리고 문의에 답하면, 계약과 정산이 따라옵니다',
  steps: [
    { title: '재고 올리기', desc: '시트를 연동해두면 검증 후 반영으로 한 번에 올라갑니다. 직접 등록도 됩니다.' },
    { title: '문의 응대', desc: '영업자 문의가 차량별 대화방으로 옵니다. 서류도 그 방에서 받습니다.' },
    { title: '입금 확인', desc: '계약금이 들어오면 확인을 체크합니다. 그때부터 계약이 진행됩니다.' },
    { title: '출고 · 정산', desc: '출고가 끝나면 정산 화면에서 지급 상태를 확인합니다.' },
  ],
};

const ADMIN: StartGuide = {
  roles: ['admin'],
  headline: '전 역할의 화면을 보고, 승인·검수·정산을 처리합니다',
  steps: [
    { title: '가입 승인', desc: '회원 화면에서 소속 회사를 확인하고 승인합니다. 승인 전에는 아무것도 못 봅니다.' },
    { title: '재고 검수', desc: '공급사 시트 연동 결과를 검증하고 반영합니다. 반영 전에 차이를 먼저 봅니다.' },
    { title: '거래 관찰', desc: '모든 대화방과 계약을 볼 수 있습니다. 개입이 필요한 건만 들어갑니다.' },
    { title: '정산 확정', desc: '계약완료 건의 수수료를 확정하고 지급 상태를 관리합니다.' },
  ],
};

const GUIDES = [AGENT, PROVIDER, ADMIN];

/** 역할에 맞는 시작안내. 모르는 역할이면 영업자 안내를 준다(가장 많은 쪽). */
export function startGuideFor(role: string | null | undefined): StartGuide {
  const r = String(role || '').trim();
  return GUIDES.find((g) => g.roles.includes(r)) || AGENT;
}

/**
 * 「다시 안 보기」 저장 키 — 역할별로 나눈다.
 * 한 사람이 역할이 바뀌면(영업자 → 관리자) 새 역할 안내는 다시 봐야 한다.
 */
export function startGuideSeenKey(role: string | null | undefined): string {
  return `fp4_start_guide_${String(role || 'agent').trim() || 'agent'}`;
}
