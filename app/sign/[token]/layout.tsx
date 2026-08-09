import type { Metadata } from 'next';

/**
 * 손님 전자서명 페이지 — **검색에 절대 걸리면 안 된다.**
 *
 * 이 링크로 들어와 주민등록번호·운전면허번호·주소·서명을 입력한다. 색인되면 그 입력창이
 * 검색 결과에 뜨고, 토큰이 그대로 노출된다. 페이지가 클라이언트 컴포넌트라
 * metadata 를 export 할 수 없어 이 서버 레이아웃이 맡는다(/q 와 같은 이유).
 *
 * 제목도 차량·손님을 드러내지 않는다 — 브라우저 탭·기록에 남는 것까지가 이 페이지의 표면이다.
 */
export const metadata: Metadata = {
  title: '전자서명',
  robots: { index: false, follow: false, nocache: true },
};

export default function SignLayout({ children }: { children: React.ReactNode }) {
  return children;
}
