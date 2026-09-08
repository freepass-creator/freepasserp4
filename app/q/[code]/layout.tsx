/**
 * `/q` 껍데기 — **지나보내기만 한다.**
 *
 * ⚠⚠ 여기 `generateMetadata` 가 있었고, 그게 **아무 쓸모 없이 링크를 2.45초 느리게** 했다
 *   (2026-09-08 전수 검사에서 잡았다).
 *   · 폐기한 **RTDB `v4/products` 를 통째로** 읽고(`db.ref('v4/products').get()`),
 *     사진을 풀려고 `/api/extract-photos` 까지 왕복했다.
 *   · 그런데 그 결과는 **`page.tsx` 의 `generateMetadata` 가 통째로 덮어쓴다** —
 *     제목·설명·robots·og 를 page 가 다 다시 적기 때문이다.
 *     증거: 운영 응답의 `og:title` 이 page 형식(「차번 차명」)이지 layout 형식(「… · 상품 안내」)이 아니다.
 *   · 새 링크는 `토큰-담당자코드` 꼴이라 layout 의 직접 조회가 **구조적으로 늘 빗나가** 매번 전수 스캔이었다.
 * ★왜 남아 있었나 — 예전엔 `/q` 페이지가 클라이언트 컴포넌트라 여기서 대신 맡았다.
 *   page 가 서버 컴포넌트가 되면서 제 일을 가져갔는데, **여기 것을 아무도 안 걷었다.**
 * ⇒ 걷는다. 미리보기는 `page.tsx` 하나가 만든다(오늘 사진·큰 카드까지 그쪽에 붙였다).
 * ★★카톡 스크레이퍼는 기다려 주지 않는다 — 느리면 사진 카드가 아니라 **맨 글자 카드로 굳는다.**
 *   영업자가 「보냈어요」 한 직후, 매출에 제일 가까운 자리의 첫인상이다.
 */
export default function QuoteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
