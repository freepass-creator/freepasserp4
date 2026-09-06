import { redirect } from 'next/navigation';

/**
 * 옛 손님 카탈로그 — **가게(`/shop`)로 넘긴다.**
 *
 * 사장님 2026-09-06 「우리가 이미 손님용 카탈로그 페이지가 있었잖아. 그걸 활용해서 그냥 들어오면
 * 그 껍데기만 보여주는 거지. **카탈로그 페이지를 새로 구성한다**고 보면 되는 거지」 — 맞다.
 * `/shop` 이 바로 그 «새로 구성한 카탈로그»다(채널 껍데기 + 손님 규격 원자).
 *
 * ★그래서 여기를 남겨 두면 **손님 카탈로그가 두 벌**이 된다. 화면 하나를 고쳐도 다른 하나는 옛날
 *   그대로라, 어느 링크로 들어왔느냐에 따라 손님이 다른 화면을 본다 — 집 규격이 제일 경계하는 꼴이다.
 * ★**지우지 않고 넘긴다.** `?p=`(공급사 한정)·`?a=`(담당 귀속)를 달고 이미 나간 링크가 있다 —
 *   그 파라미터를 그대로 물려 보내야 담당자 귀속이 안 끊긴다.
 * ⚠ `redirect` 라 주소창이 `/shop` 으로 바뀐다. 채널 도메인에서는 `/` 가 이미 `/shop` 으로
 *   rewrite 되므로(미들웨어) 손님이 이 주소를 보는 일은 원래 없다.
 */
export const dynamic = 'force-dynamic';

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CatalogPage({ searchParams }: Params) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const one = Array.isArray(v) ? v[0] : v;
    if (one) qs.set(k, one);
  }
  const tail = qs.toString();
  redirect(tail ? `/shop?${tail}` : '/shop');
}
