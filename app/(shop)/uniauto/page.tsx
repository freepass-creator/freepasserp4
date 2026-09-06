import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { ShopView } from '../shop/ShopView';
import { WHITELABELS, hasBrand } from '@/lib/whitelabel';

/**
 * **유니오토모빌 전용 주소** — `/uniauto`.
 *
 * ★왜 있나(사장님 2026-09-05 「**유니오토 전용 그 페이지를 좀 주면** 좋을 거 같애.
 *   내가 **도메인 만들어서 연결시킬 수 있는** 페이지」).
 *   브랜드 판정은 «호스트»가 정본이지만(`resolveWhitelabel`), 도메인을 붙이기 **전에도**
 *   손에 쥘 주소가 하나 있어야 한다 — `?wl=uniplan` 은 미리보기 꼬리표라 남에게 주기 어렵다.
 *
 * ★**도메인을 붙이면 이 파일은 필요 없어진다.** `uniauto.freepasserp.com` 을 Vercel 에 얹으면
 *   그 도메인의 `/` 가 곧 유니오토 목록이 된다(호스트 목록에 이미 적어 뒀다).
 *   그때까지의 «다리»이고, 붙은 뒤에도 남겨 두면 같은 화면이 두 주소로 열려 검색·공유가 갈린다 —
 *   그래서 로봇에게는 색인하지 말라고 못 박는다(아래 `robots`).
 *
 * ⚠ 화면은 `/shop` 과 **같은 것**을 쓴다. 채널만 고정할 뿐 화면을 새로 만들지 않는다 —
 *   두 벌이 되는 순간 한쪽만 고쳐지고 「또 원래대로」가 시작된다(집 규격 §3).
 */
export const dynamic = 'force-dynamic';

const UNI = WHITELABELS.find((w) => w.key === 'uniplan')!;

export async function generateMetadata(): Promise<Metadata> {
  if (!hasBrand(UNI)) return {};
  const title = UNI.name;
  const description = `${UNI.name} 즉시출고 차량 — 조건별로 골라 보세요.`;
  return {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
    openGraph: { type: 'website', title, description, siteName: UNI.name },
    twitter: { card: 'summary', title, description },
  };
}

export default async function UniautoPage() {
  /*
   * ⚠⚠ **`headers()` 를 «읽어야» 한다.** 안 읽으면 이 층이 「요청을 안 보는 층」으로 잡혀,
   *   미들웨어가 붙인 손님 표시(`x-fp-guest`)가 **루트 레이아웃까지 안 간다.**
   *   그러면 겉은 유니오토인데 소스에는 우리 JSON-LD(`프리패스모빌리티 주식회사`)가 그대로 실린다
   *   — 2026-09-06 실측. `/shop`·`/q` 는 제 껍데기가 이미 `headers()` 를 읽어 멀쩡했고
   *   여기만 샜다(브랜드를 상수로 박아 둬서 요청을 볼 일이 없었다).
   * ★`export const dynamic = 'force-dynamic'` 만으로는 안 된다 — 그건 «캐시» 얘기고,
   *   이건 «이 요청을 읽었나» 얘기다. 둘은 다른 축이다.
   */
  await headers();
  return <ShopView wl={UNI} />;
}

