/**
 * 화이트라벨 정본(SSOT) — 손님 카탈로그를 «누구 이름으로» 내보내는가.
 *
 * ★왜 필요한가
 *   지금까지 화이트라벨은 `/catalog?p={공급사코드}` 하나였고, 그게 주는 것은 **회사 «이름» 문자열 하나**뿐이다
 *   (`api/catalog/feed` → `brand`). 그래서 ① 로고·색·대표번호·사업자 표기를 못 바꾸고,
 *   ② **공급사가 아닌 곳은 아예 안 걸린다.** 유니오토모빌은 우리 장부에 `role=agent`(영업자) 로만 있고
 *   공급사(partner) 레코드가 없다 — `?p=` 로는 유니오토 화이트라벨이 «구조적으로 불가능»했다.
 *
 * ★어떻게 가르나 = **호스트**다. 쿼리스트링이 아니라 도메인이 브랜드를 정한다.
 *   손님이 `uniautofreepass.com` 으로 들어오면 그 사람에게 우리는 처음부터 유니오토모빌이다.
 *   (`?wl=` 는 도메인 붙이기 «전»에 미리보기로 확인하려는 용도 — 운영 판정에 쓰지 않는다.)
 *
 * ★운영 무변경이 기본이다. 호스트가 아래 표에 없으면 `FREEPASS`(노브랜드)가 나가고,
 *   그 값은 지금 화면과 «똑같다» — 이름도 색도 껍데기도 없다. 새 브랜드를 켜는 것은
 *   이 표에 줄을 하나 더하는 일이지, 화면을 고치는 일이 아니다.
 *
 * ★색은 원자에 «칠하지» 않는다. `brandColor` 는 `.fp-wl` 스코프에서 **토큰만** 뒤집는 데 쓴다
 *   (globals.css `.fp-topbar .fp-onbar` 와 같은 짜임) — 그래야 `C.*` 를 쓰는 원자가 전부 알아서 따라온다.
 *
 * ⚠ 브랜드명·사업자 표기는 **법적 표기**다. 모르는 값을 지어 넣지 말고 `[대괄호]` 로 비워 둔다 —
 *   비어 있으면 화면에 그대로 보이므로 누가 봐도 「아직 안 채웠다」가 된다.
 */

export type Whitelabel = {
  /** 내부 키 — 로그·미리보기(`?wl=`)에 쓴다. */
  key: string;
  /** 이 호스트로 들어오면 이 브랜드. 소문자·포트 제외로 비교한다. */
  hosts: string[];
  /**
   * 그 도메인이 **실제로 연결됐나.**
   *
   * ⚠ `hosts` 는 「연결되면 이 주소」라는 계획이고, 이 값은 「지금 열리나」다. 둘을 한 필드로 쓰면
   *   영업자 공유 화면(`/share`)이 **아직 안 산 주소를 손님에게 보낼 링크로 내준다**(2026-09-05).
   *   손님이 그걸 누르면 아무 데도 안 간다 — 그 손님은 그걸로 끝이다.
   * ⇒ 도메인을 사서 Vercel 에 붙인 «뒤에» true 로 바꾼다. 그전까지 공유 화면은 미리보기 주소(`?wl=`)를
   *   주고 「아직 손님에게 보내지 마세요」를 붙인다.
   * ★호스트 판정(`resolveWhitelabel`)에는 안 쓴다 — 도메인이 붙는 순간 코드 배포 없이 브랜드가 떠야 한다.
   */
  domainReady?: boolean;
  /**
   * **ERP 도메인 «안»에서 이 채널이 임시로 서 있는 주소** — 도메인이 붙기 전까지만.
   *
   * 사장님 2026-09-06 「유니오토가 들어가야지. **일단은 임시로 보여주는 페이지**고
   * **나중에 별도 도메인 붙일 수 있게**」.
   * ★도메인이 붙으면 `hosts` 가 이기고 이 값은 «안 쓰인다» — 지우는 것도 그때다.
   */
  previewPath?: string;
  /** 손님에게 보이는 회사명. 빈 문자열 = 브랜드 표식을 «세우지 않는다»(노브랜드). */
  name: string;
  /** 워드마크 이분 — 앞(굵게) + 뒤(가늘게·자간). 둘 다 비면 워드마크를 안 그린다. */
  wordmark: { main: string; sub: string };
  /**
   * 로고 마크 — 워드마크 «앞»에 서는 그림. 없으면 글자만 그린다.
   * ★채널이 실제로 쓰는 마크를 쓴다. 우리가 지어내지 않는다(2026-09-05 사장님이 로고·명함을 주셨다).
   */
  logo?: { src: string; alt: string };
  /** 브랜드색 — `.fp-wl` 안에서 `--brand`/`--text-link` 를 이 값으로 뒤집는다. 빈 값이면 안 뒤집는다. */
  brandColor: string;
  /** 대표번호 — 담당 영업자(`?a=`)가 없을 때 손님이 걸 번호. */
  tel: string;
  /** 푸터 사업자 표기. 모르는 값은 `[대괄호]` 로 둔다. */
  bizLines: string[];
  /**
   * 매물을 이 공급사 것으로 한정할 때만 채운다.
   * ⚠ 영업채널(유니오토 등)은 «우리 재고 전체»를 자기 이름으로 파는 것이라 비워 둔다 —
   *   여기에 아무 코드나 넣으면 목록이 통째로 0건이 된다.
   */
  providerCode?: string;
  /**
   * 검색창 «위» 안내 블록 — 손님이 X 로 끄면 다시 안 뜬다.
   * ★문구를 화면에 박지 않고 여기 둔다. 채널마다 홍보·이벤트가 다르고, 바꿀 때마다
   *   화면 코드를 고치면 채널이 늘어날수록 화면이 갈라진다(이 파일 머리 주석의 그 이유).
   */
  notice?: {
    title: string;
    body: string;
    /** 「자세히 보기」 같은 꼬리 링크. 주소가 없으면 글자만 두지 말고 통째로 뺀다. */
    moreLabel?: string;
    moreHref?: string;
  };
};

/** 노브랜드 기본값 = 지금 운영 화면. 이름도 색도 껍데기도 없다(사장님 2026-08-30 「노브랜드로 아무것도 안 보여야」). */
export const FREEPASS: Whitelabel = {
  key: 'freepass',
  hosts: [],
  name: '',
  wordmark: { main: '', sub: '' },
  brandColor: '',
  tel: '',
  bizLines: [],
};

/**
 * 브랜드 표 — 새 영업채널에 사이트를 내주는 일 = **여기 줄 하나 더하기**.
 * 화면 코드는 손대지 않는다. 손대게 되면 그 순간 채널마다 화면이 갈라진다.
 */
export const WHITELABELS: Whitelabel[] = [
  {
    key: 'uniplan',
    /** ERP 도메인 안의 임시 주소. 도메인이 붙으면 이 줄을 지운다(위 `previewPath` 머리말). */
    previewPath: '/uniauto',
    /*
     * ★도메인이 붙는 순간 **코드 배포 없이** 브랜드가 뜬다(`resolveWhitelabel` 은 호스트만 본다).
     *   그래서 「살 예정인 주소」와 「우리 도메인의 서브도메인」을 **미리 다 적어 둔다.**
     *   사장님 2026-09-05 「**유니오토 전용 페이지**를 좀 주면 좋겠다. 내가 **도메인 만들어서
     *   연결시킬 수 있는** 페이지 … 유니오토.프리패스erp.com 을 걸면 되니까」.
     * ★`freepasserp.com` 은 우리 도메인이다(전자계약이 `sign.freepasserp.com` 을 쓴다) —
     *   서브도메인은 **사서 붙일 필요 없이** Vercel 에 한 줄 추가하면 바로 산다. 그게 제일 빠른 길이다.
     */
    hosts: [
      'uniauto.freepasserp.com', 'www.uniauto.freepasserp.com',
      'uniautomobile.freepasserp.com',
      'uniautofreepass.com', 'www.uniautofreepass.com',
    ],
    // 2026-09-05 사장님 「도메인은 아직 못 샀고」 — 사서 Vercel 에 붙이면 true 로 바꾼다.
    domainReady: false,
    /*
     * ★손님에게 보이는 이름 = **유니오토모빌**(사장님 2026-09-05 「유니오토모빌의 그 상품 페이지잖아」
     *   · 「당연히 바꿔야지」). 처음엔 「유니오토플랜」으로 잡았는데 그건 우리가 지은 이름이었다 —
     *   실제 회사·홈페이지(uniautomobile.co.kr)·사업자 표기가 전부 «유니오토모빌»이다.
     *   손님이 검색해 볼 이름과 화면의 이름이 다르면 그 순간 「여기 뭐지」가 된다.
     * ⚠ 도메인 문자열(uniautofreepass.com)은 사장님이 정하신 주소라 그대로 둔다 — 이름과 별개다.
     */
    name: '유니오토모빌',
    wordmark: { main: 'UNI', sub: 'AUTOMOBILE' },
    /*
     * ★실제 로고 마크다(사장님 2026-09-05 로고·명함 전달). 육각형 안의 U+N.
     *   화면 글자는 그대로 두고 **마크만** 그림으로 세운다 — 워드마크까지 그림으로 넣으면
     *   화면 배율마다 글자가 뭉개진다(글자는 글자로 그리는 편이 늘 선명하다).
     */
    logo: { src: '/brand/uni-mark.png', alt: '유니오토모빌' },
    /*
     * ★★브랜드색 = **깊은 남색**(사장님 2026-09-05 「**중후한 느낌에 신뢰가는 느낌**이 필요할 듯」).
     *   ⚠ 여기 있던 `#1b4de4` 는 밝은 파랑이었고 **브랜드와 아무 상관 없는 값**이었다 —
     *     실제 명함·로고는 검정·은색이다. 밝은 파랑은 가볍고 「테크 서비스」처럼 읽힌다.
     *   ⇒ 저신용 손님이 큰돈을 맡기는 판이라 «가벼움»이 제일 나쁘다. 금융·보험이 쓰는 남색 계열로 내렸다.
     *   ★오렌지 변형 로고도 받아 뒀지만(`/brand/uni-mark-orange.png`) 화면에는 안 쓴다 —
     *     따뜻한 색은 「밝고 가벼운」 쪽이라 이번에 정한 결과 «중후함»과 반대다.
     *     쓸 자리가 생기면(이벤트 표식 등) 그때 좁게 쓴다.
     */
    brandColor: '#14263F',
    /** 유니오토모빌 대표번호 — 그 회사 홈페이지(uniautomobile.co.kr) 푸터에 공개된 값. */
    tel: '1800-6454',
    /**
     * 사업자 표기 — **법적 표기다. 지어내지 않는다.**
     * (주)유니오토모빌 홈페이지 푸터에 공개된 값을 그대로 옮겼다(2026-09-04 확인).
     * ⚠ 통신판매업신고 번호는 그쪽 사이트에 없어 비워 뒀다 — 받으면 채운다.
     */
    bizLines: [
      '(주)유니오토모빌 · 대표 김다훈 · 사업자등록번호 495-88-03178',
      '인천시 서구 봉오재3로 90 · 통신판매업신고 [미확인]',
      '고객상담 1800-6454 · 365일 24시간',
    ],
    /**
     * ⚠ 톤 — 손님에게 던지는 첫 줄이다. **세게 쓰지 않는다**(사장님 2026-09-04
     * 「문구를 너무 저돌적으로 하지 마」). 「신용 안 봅니다」처럼 들이대는 말투는 뺐다.
     * 알릴 것은 「심사가 없다 · 지금 출고된다 · 보고 고르면 된다」 셋이고, 말투는 담담하게.
     */
    notice: {
      title: '지금 바로 출고 가능한 차량입니다',
      body: '신용조회 없이 이용하실 수 있습니다. 보증금과 월 대여료를 확인하고 편하게 골라 보세요.',
    },
  },
];

/** 호스트 정규화 — 대소문자·포트·앞뒤 공백을 걷어낸다. */
function normHost(raw: string | null | undefined): string {
  return String(raw || '').trim().toLowerCase().split(':')[0];
}

/**
 * 브랜드 판정. **호스트가 정본**이고, `wlKey` 는 도메인 붙이기 전 미리보기 전용이다.
 * 어디에도 안 걸리면 노브랜드(FREEPASS) — 즉 지금 운영과 같은 화면.
 */
export function resolveWhitelabel(host?: string | null, wlKey?: string | null): Whitelabel {
  const h = normHost(host);
  if (h) {
    const byHost = WHITELABELS.find((w) => w.hosts.some((x) => normHost(x) === h));
    if (byHost) return byHost;
  }
  const k = String(wlKey || '').trim().toLowerCase();
  if (k) {
    const byKey = WHITELABELS.find((w) => w.key === k);
    if (byKey) return byKey;
  }
  return FREEPASS;
}

/**
 * **손님 동 라우트인가** — 업무동(콕핏)과 가르는 한 곳.
 *
 * ★이 판정이 필요한 이유 = **아직 채널 도메인이 하나도 안 붙어 있다**(2026-09-06 실측:
 *   `uniauto.freepasserp.com` · `uniautofreepass.com` 전부 응답 없음). 브랜드는 «호스트»가
 *   정하는 설계인데 호스트가 ERP 도메인 하나뿐이라, 손님 화면이 **노브랜드(프리패스)로 떨어졌다.**
 * ⚠ 업무동까지 채널로 물들이면 안 된다 — `/login`·`/inventory` 는 우리 콕핏이다. 그래서 «라우트»로 가른다.
 */
export function isGuestPath(pathname: string): boolean {
  const p = String(pathname || '').split('?')[0];
  if (p === '/q' || p.startsWith('/q/')) return true;
  if (p === '/shop' || p.startsWith('/shop/')) return true;
  if (p === '/catalog' || p.startsWith('/catalog/')) return true;
  return WHITELABELS.some((w) => !!w.previewPath && (p === w.previewPath || p.startsWith(`${w.previewPath}/`)));
}

/** 손님 동이 노브랜드로 떨어졌을 때 입는 **임시 채널**. 도메인이 붙으면 안 쓰인다. */
export const GUEST_FALLBACK_KEY = 'uniplan';

/**
 * **손님 동 브랜드 판정** — 호스트 → `?wl=` → **임시 채널**.
 *
 * 사장님 2026-09-06 「프리패스 erp 점 컴에서 **원래 상세 페이지가 조회되거나 그러면 안 되는데**」.
 * 맞다. `www.freepasserp.com/q/<토큰>` 에서 `?wl=` 꼬리표만 떼면 **프리패스 「상품 안내」**가 떴고,
 * `/shop` 은 재고 전체를 프리패스 껍데기로 공개하고 있었다. 손님이 주소창에서 지울 수 있는 값이
 * 브랜드를 정하고 있었던 것이다(카톡 미리보기 봇은 애초에 안 붙은 주소를 긁는다).
 *
 * ★★**호스트가 여전히 정본이다.** 여기는 «못 찾았을 때만» 떨어지는 자리라, 채널 도메인을 붙이면
 *   그 순간 위에서 끝나고 이 줄은 안 탄다 — **코드를 다시 안 고쳐도 된다**(사장님 「나중에 별도
 *   도메인 붙일 수 있게」). 채널이 둘이 되면 그때 기본값을 다시 정한다(그전엔 하나뿐이라 명확하다).
 * ⚠ 이미 카톡·문자로 나간 `freepasserp.com/q/...` 링크는 **안 죽는다** — 브랜드만 바뀐다.
 *   라우트를 닫는 쪽이 깨끗하지만, 손님이 지금 손에 들고 있는 링크가 대부분 이 도메인이다.
 */
export function resolveGuestWhitelabel(host?: string | null, wlKey?: string | null): Whitelabel {
  const wl = resolveWhitelabel(host, wlKey);
  if (hasBrand(wl)) return wl;
  return WHITELABELS.find((w) => w.key === GUEST_FALLBACK_KEY) || wl;
}

/** 브랜드 표식을 세우는가 — 노브랜드면 머리띠·워드마크·푸터를 아예 그리지 않는다. */
export function hasBrand(wl: Whitelabel): boolean {
  return !!wl.name || !!wl.wordmark.main;
}

/**
 * `.fp-wl` 스코프에 얹을 토큰 뒤집기.
 * ★원자에 색을 칠하지 않는다 — `--brand`/`--text-link` 만 바꾸면 `C.brand`·`C.accent` 를 쓰는
 *   원자가 전부 따라온다(globals.css `.fp-topbar .fp-onbar` 와 같은 짜임).
 */
export function whitelabelVars(wl: Whitelabel): Record<string, string> {
  if (!wl.brandColor) return {};
  return {
    '--brand': wl.brandColor,
    '--brand-h': wl.brandColor,
    '--text-link': wl.brandColor,
    /**
     * ★손님 화면 바탕은 **흰색**이다. 업무동 기본값(`--bg-page: #eaedf2`)은 하루 종일 보는
     * 콕핏이라 눈이 덜 부시게 회색으로 깔아 둔 것인데, 손님 카탈로그에 그대로 나오면
     * 「회색 판때기」로 보인다(사장님 2026-09-04 「전체적으로 배경도 회색이고」).
     * 중고차·렌터카 마켓은 전부 흰 바탕이다.
     */
    '--bg-page': '#ffffff',
    // 면(面)으로 깔 옅은 틴트 — 브랜드색에서 «자동으로» 뽑는다.
    // 채널마다 손으로 틴트 hex 를 적게 하면 그 값이 언젠가 브랜드색과 어긋난다.
    '--brand-bg': `color-mix(in srgb, ${wl.brandColor} 12%, white)`,
    '--brand-soft': `color-mix(in srgb, ${wl.brandColor} 6%, white)`,
  };
}
