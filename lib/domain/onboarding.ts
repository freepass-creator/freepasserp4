/**
 * 시작안내 — «첫 화면(상품찾기)을 어떻게 보는가».
 *
 * `faq.ts` 의 GUIDE 와 역할이 다르다. 그쪽은 «업무 규칙»(담당자·서류·수수료·출고조건)이고
 * 여기는 «화면 사용법»이다. 둘을 한 곳에 섞으면 규칙을 고칠 때 사용법이 같이 흔들린다.
 *
 * 전에는 역할별(영업자·공급사·관리자) 업무 흐름 4단계였다. 그런데 로그인 직후 처음 만나는
 * 것은 «상품 목록 화면»이고, 그 화면이 기본으로 엑셀(표)이라 처음 보는 사람은 이게 무엇이며
 * 어떻게 바꾸는지를 먼저 묻는다. 업무 흐름은 「자주 묻는 질문」이 이미 다룬다 —
 * 그래서 안내를 «화면 설명 한 벌»로 바꾸고 역할 분기를 없앴다. 문구는 영업자 기준으로 쓴다.
 *
 * 내용은 실제 코드에서 확인한 것만 적었다 —
 *   · 기본 보기 = 판매시트 (`app/finder/page.tsx`: useState('excel'))
 *   · 보기 3종 = 간단(card) │ 상세(list) │ 시트(excel) (`FinderToolbar.tsx` VIEWS)
 *   · 고른 보기는 유지된다 (`app/finder/page.tsx`: localStorage 'fp4_finder_view_v2')
 *   · 시트 = ERP가 인증 후 읽어 온 판매시트 격자 (`SheetView.tsx`)
 *   · 간단·상세의 행 클릭 = 상품 상세로 이동 (`app/finder/page.tsx` go → /m/{product_code})
 *   · 모바일은 간단 보기 고정이라 전환이 없다 (`app/finder/page.tsx`: effView = mobile ? 'card' : view)
 */

export type StartStep = {
  /** 한 줄 제목 — 동사로 끝낸다(무엇을 하는가). */
  title: string;
  /** 한 문장 설명. 두 문장 이상 쓰지 않는다 — 길면 안 읽는다. */
  desc: string;
};

export type StartGuide = {
  headline: string;
  steps: StartStep[];
  /** 맨 아래 한 줄 — 더 볼 곳 */
  footer?: string;
};

const GUIDE: StartGuide = {
  headline: '상품 목록을 보는 방법입니다',
  steps: [
    { title: '판매시트로 봅니다', desc: '기본은 ERP 안의 상품리스트입니다. 로그인 권한에 맞는 판매시트만 표시됩니다.' },
    { title: '보기를 바꿉니다', desc: '우측 상단에서 간단·상세·시트로 바꿉니다. 고른 보기는 다음에 들어와도 그대로입니다.' },
    { title: '좁혀서 찾습니다', desc: '간단·상세 보기에서는 검색과 필터로 좁힐 수 있습니다. 시트 보기에는 원본 표만 표시됩니다.' },
    { title: '한 대를 엽니다', desc: '간단·상세 보기에서 차량을 누르면 상세로 들어가고, 문의는 거기서 엽니다.' },
  ],
  footer: '상품리스트는 구글시트 탭을 열지 않고 ERP 안에서 표시합니다. 휴대폰에서는 간단 보기로 고정됩니다.',
};

/** 시작안내는 한 벌뿐이다 — 역할로 갈리지 않는다. */
export function startGuide(): StartGuide {
  return GUIDE;
}

/**
 * 「다시 안 보기」 저장 키.
 *
 * 역할별로 나눠 두었으나 안내가 한 벌이 되면서 나눌 이유가 없어졌다. 키 이름을 바꿨으므로
 * 예전에 「다시 안 보기」를 눌렀던 사람도 새 안내를 한 번은 본다 — 내용이 달라졌으니 그게 맞다.
 */
export const START_GUIDE_SEEN_KEY = 'fp4_start_guide_screen';
