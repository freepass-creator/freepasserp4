/**
 * **정산 워크스테이션의 «탭 얼굴»** — 아이콘과 제목을 상품찾기와 갈라 놓는다.
 *
 * ★사장님 2026-09-10 「브라우저 아이콘 색깔을 바꾸든 해야겠다 —
 *   색깔이랑 그게 **상품찾기랑 같아서 헷갈리네**」
 *
 *   담당자는 이 화면을 온종일 열어 두고 다른 탭과 오간다. 탭이 다 같은 얼굴이면
 *   «어느 탭이 정산인지» 매번 눌러 봐야 한다 — 하루에 수십 번이면 그게 일이다.
 * ⇒ 아이콘은 `app/settlement/icon.svg`(남색 판 + 노란 칸), 제목은 「정산」으로 시작한다.
 *   ★제목은 «앞이 다르게» 짓는다 — 탭이 좁아지면 뒤가 잘려 앞글자만 보인다.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '정산 워크스테이션',
  description: '접수·실적·청구를 한 화면에서',
  /**
   * ★★**아이콘을 «여기서» 다시 적어야 한다** — 뿌리 레이아웃이 `metadata.icons` 를 명시하고 있어서
   *   `app/settlement/icon.svg` 파일 규약만으로는 «덮이지 않는다»(실측 2026-09-10).
   *   ⇒ 이 층에서 아이콘을 다시 적어 뿌리 것을 이긴다.
   */
  icons: { icon: [{ url: '/settlement/icon.svg', type: 'image/svg+xml' }] },
};

export default function SettlementIntakeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
