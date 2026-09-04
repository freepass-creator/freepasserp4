/**
 * **거래처 CI 정본 — 「손오공」이 아니라 「주식회사 손오공렌터카」로 부른다.**
 *
 * ★사장님 2026-08-26 「청구회사를 좀 정중하게 별도로 이름이랑 CI까지 확인해서 해주고」
 *   「니가 웹서치를 통해서 회사 CI 다 확보해 홈페이지있는 회사는」.
 *
 * ★★**왜 이 파일이 있나** — 정산시트는 사람이 부르는 «별칭»만 적는다(손오공 · 하허호 · 아이언).
 *   그 별칭을 그대로 대외 문서에 찍으면 상대 회사를 반말로 부르는 꼴이 된다.
 *   청구서·정산서는 법인이 법인에게 보내는 문서다 — 정식 상호로 부른다.
 *
 * ★★★**지어내지 않는다.** 값마다 어디서 왔는지(`src`)를 같이 적는다.
 * ```
 * erp   ERP 거래처 등록(v3 partners · v4/partners)에 들어 있던 값
 * web   2026-08-26 웹에서 확인 — 회사 홈페이지·공공데이터·사업자조회
 * 모름   확인 못 했다. ★「없다」가 아니라 「모른다」다(집 규칙)
 * ```
 *   모르는 칸은 **비워 둔다**. 문서가 「모름」이라고 말하게 두지, 그럴듯한 값을 채우지 않는다.
 *
 * ⚠ **로고 이미지는 넣지 않는다.** 남의 회사 로고를 우리 청구서에 얹는 건 상표 문제다.
 *   여기서 말하는 CI 는 «정식 상호·법인격·사업자번호·대표·주소·홈페이지» — 문자로 된 신원이다.
 *
 * ⚠ **ERP 등록과 웹이 어긋나면 고치지 않고 `conflict` 에 적는다.** 어느 쪽이 맞는지는
 *   사업자등록증을 봐야 안다. 조용히 덮어쓰면 다음 사람이 왜 바뀌었는지 모른다.
 */

/** 어디서 온 값인가. */
export type CiSource = 'erp' | 'web' | 'erp+web';

/** 거래처 하나의 신원. 모르는 칸은 빈 문자열 — 그게 「모른다」다. */
export type PartnerCi = {
  /** 시트·화면에서 부르는 별칭. 이게 열쇠다 */
  alias: string;
  /** 정식 상호 — 법인격(주식회사)까지. 대외 문서는 이걸 쓴다 */
  legal: string;
  /** 사업자등록번호 `000-00-00000` */
  bizNo: string;
  /** 대표자 */
  ceo: string;
  /** 주소 */
  addr: string;
  /** 대표 전화 */
  tel: string;
  /** 홈페이지 — 있는 곳만 */
  web: string;
  /**
   * **정산서를 받을 메일.** 비면 그 회원사에는 «안 보낸다».
   *
   * ★★★지어내지 않는다. 틀린 주소로 나가면 남의 회사가 우리 거래 내역을 본다.
   *   ⚠ 2026-08-27 현재 **전부 비어 있다.** 사장님이 받아서 주기로 했다.
   *   ★대표 메일이 아니라 «정산 담당자» 주소가 맞다 — 대표 메일함은 안 열어 본다.
   */
  mail?: string;
  /**
   * **대여료 전용계좌** — 고객이 «대여료를 넣는» 곳이다. `은행 번호 예금주` 한 줄.
   *
   * ★★★**정산 계좌가 아니다.** 정산서에 쓰면 안 된다.
   *   ⚠ 2026-08-26 에 계좌를 찾다가 판매시트 「전용계좌」 열(65)을 정산 계좌로 착각했다.
   *     그건 «정책» 칸이다(`company-info-sheet.ts` — 정책 탭에서 옮겨 온 값).
   *     공급사에게는 우리가 «받는» 쪽이라 애초에 상대 계좌가 필요 없고,
   *     퍼시픽처럼 공급사이면서 영업채널인 곳에 잘못 쓰면 **돈이 엉뚱한 데로 간다.**
   * ★그래도 담아 둔다 — 대여료 문의가 오면 여기를 본다. 쓰는 자리를 헷갈리지만 않으면 된다.
   */
  rentAccount: string;
  /**
   * **정산 계좌** — 우리가 «지급»할 때 돈이 가는 곳. 영업채널만 해당한다.
   * ⚠ 아직 아무 곳도 모른다(2026-08-26). 통장 사본을 받아 채워야 한다.
   *   ⚠ **지어내지 않는다.** 틀린 계좌가 찍히면 돈이 남에게 간다.
   */
  payAccount: string;
  /** 다른 표가 다르게 부르는 이름. 판매시트는 「에스에이」를 `SA` 로 적는다. */
  alias2?: string[];
  /** ERP 거래처 코드(있으면) */
  code: string;
  /** 값의 출처 */
  src: CiSource;
  /** ERP 와 웹이 어긋난 지점. 비어 있으면 어긋남 없음 */
  conflict?: string;
};

/** 하이픈 없는 10자리를 사람이 읽는 모양으로. `8828700650` → `882-87-00650` */
export const bizNoPretty = (v: unknown): string => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : String(v ?? '').trim();
};

/**
 * 확인된 거래처.
 *
 * ★여기 없는 거래처는 「모르는 곳」이다 — 문서에 별칭 그대로 나가고, 발송 전 확인 목록에 뜬다.
 * ★새로 알아내면 **그 자리에서 여기에 박는다.** 안 박으면 다음 세션이 또 찾는다.
 */
export const PARTNER_CI: readonly PartnerCi[] = [
  // ── 공급사 (차를 대는 곳 · 우리가 청구한다) ──────────────────────────────
  {
    /**
     * ★★★**「손오공」이라는 이름을 쓰는 회사가 둘이다.**
     *   여기 있는 건 «주식회사 손오공렌터카» — 렌터카 회사다(sokrc.com · 「손오공 Agent」).
     *   ⛔ 「손오공주식회사」는 **완구 회사**로 전혀 다른 법인이다
     *      (사장님 2026-08-27 「손오공은 손오공주식회사 로고있어 완구회사」).
     *   ⇒ 로고를 찾을 때 이름만 보고 고르면 «완구 회사 상표»를 렌터카 청구서에 찍는다.
     *     사업자번호(882-87-00650)와 대표(차현일)로 확인하고 고른다.
     * ⚠ 홈페이지가 automgt.co.kr 로 적혀 있었는데 2026-08-27 에 주소가 안 풀렸다.
     *   sokrc.com 이 실제로 열린다 — 우리가 API 로 붙는 그 주소다.
     */
    alias: '손오공', legal: '주식회사 손오공렌터카', bizNo: '882-87-00650', ceo: '차현일',
    addr: '서울특별시 강서구 양천로53길 30, 서서울모터리움 1205호', tel: '', web: 'sokrc.com',
    code: 'RP012', src: 'erp+web',
    // ★우리(1004호)와 같은 건물 1205호다. 주소를 헷갈리지 말 것.
    rentAccount: '신한 100-032-471576 (주)손오공렌터카',
    payAccount: '',
  },
  {
    alias: '오토플러스', legal: '오토플러스 주식회사', bizNo: '105-86-06429', ceo: '이윤석',
    addr: '서울특별시 영등포구 선유동2로 57, 이레빌딩 신관 11층', tel: '1544-2277',
    web: 'autoplus.co.kr', code: 'RP023', src: 'web',
    // ★autoplus.co.kr 은 스크립트 렌더라 푸터를 못 읽었다. 직영 플랫폼 「리본카」(reborncar.co.kr)
    //   푸터에서 확보했다(2026-08-26). 통신판매업 2020-서울영등포-1338.
    conflict: '★ERP 등록값이 999-99-99999(가짜)다 — 위 번호로 고쳐야 한다. 거래 112건으로 가장 큰 공급사다',
    rentAccount: '',
    payAccount: '',
  },
  {
    alias: '웰릭스', legal: '웰릭스모빌리티 주식회사', bizNo: '379-88-01956', ceo: '이창영',
    addr: '경기도 김포시 고촌읍 아라육로152번길 45, 에이동 229호', tel: '1544-3871',
    web: 'welrixmobility.com', code: 'RP013', src: 'erp+web',
    conflict: '대표 — ERP 이창호 / 홈페이지 이창영(홈페이지를 따랐다). 같은 사업자번호가 JPK모빌리티(차두준)로도 나온다',
    rentAccount: '신한 140-013-750928 웰릭스모빌리티(주)',
    payAccount: '',
  },
  {
    alias: '아이언', legal: '주식회사 아이언렌트카', bizNo: '715-88-00129', ceo: '김기문',
    addr: '', tel: '', web: '', code: 'RP006', src: 'erp',
    rentAccount: '',
    payAccount: '',
  },
  {
    alias: '아이카', legal: '주식회사 아이카', bizNo: '503-88-01369', ceo: '김영혁',
    addr: '경기도 수원시 권선구 수인로 43-2', tel: '1661-3922', web: 'icar.or.kr',
    code: 'RP004', src: 'erp+web',
    // 통신판매업 2020-수원권선-0121 · cs sky_belly@naver.com (홈페이지 푸터, 2026-08-26)
    rentAccount: '',
    payAccount: '',
  },
  {
    alias: '우리캐피탈', legal: '우리캐피탈렌터카 주식회사', bizNo: '142-81-15688', ceo: '손삼호',
    addr: '경기도 용인시 처인구 중부대로 1123', tel: '', web: 'wooricap-rentacar.com',
    code: 'RP020', src: 'erp+web',
    rentAccount: '국민 274101-04-182593 우리캐피탈렌터카(주)',
    payAccount: '',
  },
  {
    alias: '스위치', legal: '주식회사 스위치플랜', bizNo: '158-81-03213', ceo: '박영현',
    addr: '', tel: '', web: '', code: 'RP014', src: 'erp',
    rentAccount: '신한 140-014-386616 스위치플랜 주식회사',
    payAccount: '',
  },
  {
    alias: '스타스카이', legal: '주식회사 스타스카이', bizNo: '206-86-03184', ceo: '조기배',
    addr: '서울특별시 성동구 아차산로7길 36, 303-2호(성수동2가)', tel: '',
    web: 'sratskyrent.wixsite.com/starskyrentcar', code: 'RP005', src: 'erp+web',
    conflict: '★사업자번호가 한 자리 어긋난다 — ERP 206-86-0**3**184 / 웹 206-86-0**9**184. '
      + '게다가 ERP 에 「스타」(RP018)가 206-86-09184 로 «따로» 등록돼 있다. '
      + '둘이 같은 회사인지, 한쪽이 오타인지 확인해야 한다(대표가 둘 다 조기배)',
    rentAccount: '기업 141-066418-04-025 (주)스타스카이',
    payAccount: '',
  },
  {
    alias: '경진카', legal: '경진카 주식회사', bizNo: '725-81-02483', ceo: '유희주',
    addr: '', tel: '', web: '', code: 'RP016', src: 'erp',
    rentAccount: '',
    payAccount: '',
  },
  {
    alias: '경진렌트카', legal: '경진렌트카', bizNo: '129-86-87637', ceo: '유진수',
    addr: '', tel: '', web: '', code: 'RP015', src: 'erp',
    rentAccount: '',
    payAccount: '',
  },
  {
    alias: 'KH', legal: '주식회사 케이에이치', bizNo: '721-81-01202', ceo: '이광호',
    addr: '', tel: '', web: '', code: 'RP010', src: 'erp',
    conflict: '정식 상호가 「케이에이치」인지 「KH」인지 미확인 — 사업자등록증 확인 필요',
    rentAccount: '기업 486-061377-04-043 KH렌트카',
    payAccount: '',
  },
  {
    alias: '퍼시픽', legal: '주식회사 퍼시픽', bizNo: '105-87-13233', ceo: '이원진',
    addr: '', tel: '', web: '', code: 'RP022', src: 'erp',
    conflict: '같은 이름이 영업채널에도 있다 — 같은 곳인지 확인 필요',
    rentAccount: '신한 140-015-656880 퍼시픽모빌리티㈜',
    payAccount: '',
  },
  {
    alias: '에이스', legal: '주식회사 에이스', bizNo: '393-81-01841', ceo: '백은영',
    addr: '', tel: '', web: '', code: 'RP019', src: 'erp',
    rentAccount: '국민 808801-04-217021 (주)에이스렌트카',
    payAccount: '',
  },
  {
    alias: '리더스', legal: '주식회사 리더스렌터카', bizNo: '215-87-46138', ceo: '김종철',
    addr: '', tel: '', web: '', code: 'RP008', src: 'erp',
    rentAccount: '국민 337101-04-215464 리더스렌트카',
    payAccount: '',
  },
  {
    alias: '리더스렌트카', legal: '주식회사 리더스렌터카', bizNo: '215-87-46138', ceo: '김종철',
    addr: '', tel: '', web: '', code: 'RP008', src: 'erp',
    rentAccount: '국민 337101-04-215464 리더스렌트카',
    payAccount: '',
  },
  {
    alias: '렌트존', legal: '주식회사 렌트존', bizNo: '113-86-54067', ceo: '엄은정',
    addr: '', tel: '', web: '', code: 'PT-0001', src: 'erp',
    rentAccount: '우리 1005-001-948600 (주)렌트존',
    payAccount: '',
  },
  {
    alias: '빌린카', legal: '주식회사 빌린카', bizNo: '247-87-03117', ceo: '최우영',
    addr: '', tel: '', web: '', code: 'RP021', src: 'erp',
    rentAccount: '하나 634-910022-15404 (주)빌린카(영업소)',
    payAccount: '',
  },
  {
    alias: '퍼스트', legal: '주식회사 퍼스트', bizNo: '872-86-00447', ceo: '이현식',
    addr: '', tel: '', web: '', code: 'RP009', src: 'erp',
    rentAccount: '',
    payAccount: '',
  },
  {
    alias: '센트로', legal: '주식회사 센트로', bizNo: '128-88-00500', ceo: '김태현',
    addr: '', tel: '', web: '', code: 'RP017', src: 'erp',
    rentAccount: '신한 140-011-380331 (주)센트로렌트카',
    payAccount: '',
  },
  {
    alias: '엘씨렌트', legal: '주식회사 엘씨', bizNo: '819-81-00849', ceo: '이치헌',
    addr: '', tel: '', web: '', code: 'PT-0026', src: 'erp',
    // ★이 곳 차량만 계약서가 손오공 명의다(기존에 확인된 사실).
    // ⚠ 예금주가 「손오공렌트카(대전지점)」이다 — 상호와 다르지만 그 계좌로 받는다.
    rentAccount: '신한 100-034-538803 (주)손오공렌트카(대전지점)',
    payAccount: '',
  },
  {
    alias: '에스에이', legal: '주식회사 에스에이렌터카', bizNo: '217-81-42626', ceo: '김성호',
    addr: '', tel: '', web: '', code: 'PT-0023', src: 'erp',
    alias2: ['SA'],   // 판매시트는 「SA」 로 적는다
    rentAccount: '우리 1005-402-748053 (주)에스에이렌터카',
    payAccount: '',
  },
  {
    alias: 'JPK', legal: '제이피케이모빌리티 주식회사', bizNo: '', ceo: '',
    addr: '', tel: '', web: 'jpkmobility.com', code: '', src: 'web',
    conflict: '웹에서 웰릭스모빌리티와 사업자번호(379-88-01956)가 겹쳐 나온다 — 관계 확인 필요',
    rentAccount: '',
    payAccount: '',
  },

  // ── 영업채널 (차를 파는 곳 · 우리가 지급한다) ────────────────────────────
  {
    alias: '하허호', legal: '주식회사 하허호무심사', bizNo: '830-88-03672', ceo: '이하민',
    addr: '경기도 김포시 운곡로 4-1, 103호', tel: '1688-0987', web: '하허호.com',
    code: 'SP001', src: 'erp+web',
    conflict: '상호 띄어쓰기 — ERP 「하허호무심사 주식회사」 / 홈페이지 「주식회사 하허호 무심사」',
    rentAccount: '',
    payAccount: '',
  },
  {
    alias: '렌트야', legal: '주식회사 렌트야', bizNo: '598-88-01028', ceo: '이주열',
    addr: '대전광역시 서구 도안북로93번길 31, 도안더블루힐 405호', tel: '1599-1080', web: 'nae-cha.com',
    code: 'SP002', src: 'erp+web',
    conflict: 'nae-cha.com 이 응답하지 않는다(2026-08-26) — 주소·전화는 검색 결과라 사업자등록증 대조 필요',
    rentAccount: '',
    payAccount: '',
  },
  {
    alias: '카핑', legal: '카핑', bizNo: '310-10-93045', ceo: '지홍석',
    addr: '경기도 부천시 부일로205번길 46, 202호(상동, 윌타운)', tel: '1688-1362',
    web: 'carping1.com', code: '', src: 'web',
    conflict: 'ERP 거래처 미등록(홈페이지 푸터로만 확인, 2026-08-26). 사업자번호 가운데 10 — 개인사업자다. '
      + '공동대표 「지홍석 외 1명」 — 나머지 한 명 모름. ★거래액 23건이라 등록이 시급하다',
    rentAccount: '',
    payAccount: '',
  },
  {
    alias: 'SI오토', legal: '주식회사 에스아이그룹', bizNo: '437-88-00928', ceo: '이세인',
    addr: '', tel: '', web: '', code: 'SP010', src: 'erp',
    rentAccount: '',
    payAccount: '',
  },
  {
    alias: '오토원트', legal: '주식회사 오토원트', bizNo: '609-88-02424', ceo: '신선호',
    addr: '', tel: '', web: '', code: 'PT-0015', src: 'erp',
    rentAccount: '',
    payAccount: '',
  },
  {
    alias: 'SMC', legal: '주식회사 에스엠씨', bizNo: '467-13-01181', ceo: '양정욱',
    addr: '', tel: '', web: '', code: 'SP008', src: 'erp',
    conflict: 'ERP 표기가 「에스엠씨(S.M.C)」 — 정식 상호에 (S.M.C)가 붙는지 미확인',
    rentAccount: '',
    payAccount: '',
  },
  {
    alias: '카렉토', legal: '카렉토', bizNo: '439-14-02595', ceo: '이성현',
    addr: '', tel: '', web: '', code: 'PT-0020', src: 'erp',
    conflict: '사업자번호 가운데가 14 — 개인사업자로 보인다. 「주식회사」를 붙이면 안 된다',
    rentAccount: '',
    payAccount: '',
  },
  {
    alias: '에이카솔루션', legal: '에이카솔루션', bizNo: '601-08-03295', ceo: '김민구',
    addr: '', tel: '', web: '', code: 'SP007', src: 'erp',
    conflict: '사업자번호 가운데가 08 — 개인사업자로 보인다',
    rentAccount: '',
    payAccount: '',
  },
  {
    alias: '프리패스', legal: '프리패스모빌리티 주식회사', bizNo: '528-88-02988', ceo: '박영협',
    addr: '서울시 강서구 양천로 53길 30, 서서울모터리움 1004호', tel: '02-6956-8835',
    web: 'freepassmobility.com', code: 'OP001', src: 'erp',
    // ★우리 자신. 우리가 영업채널로 뛴 건이 3건 있다.
    rentAccount: '',
    payAccount: '',
  },
];

const KEY = (v: unknown) => String(v ?? '').replace(/[\s()（）㈜(주)·.,-]/g, '').toLowerCase();

const BY_ALIAS = new Map<string, PartnerCi>();
for (const p of PARTNER_CI) {
  BY_ALIAS.set(KEY(p.alias), p);
  // ★다른 표가 다르게 부르는 이름도 같은 곳으로 보낸다(판매시트 「SA」 = 에스에이).
  for (const a of p.alias2 || []) if (!BY_ALIAS.has(KEY(a))) BY_ALIAS.set(KEY(a), p);
}

/**
 * 별칭으로 CI 를 찾는다. 못 찾으면 `null` — **별칭을 정식 상호인 척 돌려주지 않는다.**
 * 부르는 쪽이 「모른다」를 알아야 발송 전 확인 목록에 올릴 수 있다.
 */
export const ciOf = (alias: unknown): PartnerCi | null => BY_ALIAS.get(KEY(alias)) ?? null;

/** 문서에 찍을 이름. CI 를 알면 정식 상호, 모르면 별칭 그대로. */
export const legalNameOf = (alias: unknown): string => ciOf(alias)?.legal || String(alias ?? '').trim();

/** 이 거래처에 대해 아직 모르는 것들. 발송 전 확인 목록에 쓴다.
 *  ★주소는 정산서에 안 싣는다(사장님 2026-08-26) — 빈칸 경고 대상이 아니다. */
export const ciGapsOf = (alias: unknown): string[] => {
  const ci = ciOf(alias);
  if (!ci) return [`${String(alias ?? '').trim()} — 거래처 등록 없음(정식 상호·사업자번호 미입력)`];
  const gaps: string[] = [];
  if (!ci.legal) gaps.push('정식 상호');
  if (!ci.bizNo) gaps.push('사업자등록번호');
  if (!ci.ceo) gaps.push('대표자');
  // ★정산 계좌가 없으면 돈이 갈 곳을 모르는 채로 종이가 나간다. 대여료 전용계좌는 다른 것이다.
  if (!ci.payAccount) gaps.push('정산계좌');
  // ★「모름」이 아니라 「미입력」이다 — 아직 안 적은 칸이지 알 수 없는 값이 아니다
    //   (사장님 2026-08-27 「뭐 모름이야 나중에 채워넣을건데」).
  return gaps.length ? [`${ci.alias} — ${gaps.join(' · ')} 미입력`] : [];
};
