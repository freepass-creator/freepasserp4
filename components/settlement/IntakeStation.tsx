'use client';
/**
 * **정산 워크스테이션 — 직원이 «이 페이지만 열어 놓으면 일이 되는» 한 화면.**
 * 설계는 `docs/정산-워크스테이션-설계.md`.
 *
 * ★★★사장님 2026-09-10 — 자리를 이렇게 잡았다.
 *   「**3개 분할**인 거지. **상품 목록**, 그 밑에 **접수 목록**, 우측에 **상세 화면**.
 *    상세 화면에서 **접수하기 누르면 접수 화면으로 바뀌는** 거지.
 *    거기서 **접수 누르면 접수 목록으로 들어가**」
 * ```
 *   ┌──────────────────────────┬─────────────┐
 *   │ 상품 목록 (자체 스크롤)     │ 상세 화면    │
 *   │ 한 줄에 조건이 다 보인다    │   ↕ 갈아낌   │
 *   ├──────────────────────────┤ 접수 화면    │
 *   │ 접수 목록 (5줄 + 스크롤)   │             │
 *   └──────────────────────────┴─────────────┘
 * ```
 *   ★**자리는 안 옮기고 «얼굴»만 바뀐다** — 오른쪽 칸이 조건 보기 ↔ 접수로 갈아 끼워진다.
 *     전화하며 쓰는 화면이라 눈이 자리를 잃으면 안 된다. 모달·새 페이지는 안 쓴다.
 *   ★접수 목록은 **다섯 줄**이면 된다(사장님). 상품 목록이 주인공이라 자리를 뺏으면 안 된다.
 *
 * ★★**접수에 사람이 치는 것은 몇 개 안 된다** — 사장님 「기간이랑 영업채널만 박아주면 되는 거네??」
 * ```
 *   차에서 온다   차량번호 · 모델 · 공급사 · 상품구분 · 차량가액
 *   요금표에서    계약기간 · 대여료 · 보증금   ← 줄 한 번 누르면 셋 다
 *   기본값        접수일(오늘) · 납입방식
 *   ─────────────────────────────────────────
 *   사람이        영업채널 (필수) · 고객명 · 영업자   ← 채널·영업자는 «지난번 값»이 들어와 있다
 * ```
 *   ⚠ **청구월은 접수 때 안 넣는다** — 인도돼야 달이 박힌다(정산원장 규칙 그대로).
 *
 * ── 지나온 판(왜 이렇게 됐나)
 *   1판 — 차 목록을 왼쪽 구석에 밀고 가운데를 접수 대기가 차지했다(사장님 「완전 똥멍청이」).
 *   2판 — 자리는 고쳤는데 표에 «요금이 없어» 「얼마예요?」에 못 답했다.
 *   3판 — 상세를 줄 아래에 펼쳤더니 목록이 밀렸다. ⇒ 오른쪽 고정 칸으로.
 *
 * ★★겉모습은 **고전 ERP** — 원본 `teamjpkwork/app/erp-classic/classic.css`.
 * ★PC 전용. 폰 접수는 `/settlement/board` 가 맡는다.
 * ★숫자는 여기서 세지 않는다 — 데이터는 `BoardApi` 가 준다(진짜 문·미리보기 같은 얼굴).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/components/Toaster';
import { deliveryTransitionPatch, intakeTermMonths, localSettlementDay, sameSettlementCar } from '@/lib/domain/settlement-intake';
/**
 * ★청구예정월의 정본 — 「박힌 값이 이긴다 · 분납은 접수일+(회차−1) · 일시납은 인도월 ·
 *   인도 전이면 접수월」. 화면이 이 규칙을 다시 짜면 그 순간 정본이 둘이 된다.
 */
import { settlementMonthOf } from '@/lib/domain/settlement-billing-month';
/** ★상품구분 7캐논은 여기가 정본이다 — 화면이 목록을 다시 적으면 재고와 갈린다. */
import { PRODUCT_TYPES } from '@/lib/intake/entities';
import type { BoardApi, Board, Car, CarLite, Line, LineSpec } from './SettlementBoard';
import './classic.css';

const S = (v: unknown) => String(v ?? '').trim();
const won = (n: number) => Math.round(n || 0).toLocaleString('ko-KR');
/** 만원 단위 — 단위 글자는 «머리줄»이 말한다(값에 또 붙이면 칸만 좁아지고 자릿수가 안 맞는다). */
const man = (n: number) => (n ? Math.round(n / 10000).toLocaleString('ko-KR') : '');
/** 만km 단위 — 3.2 = 3만 2천 km. 단위는 머리줄이 말한다. */
const km = (n: number) => (n ? (n / 10000).toFixed(1) : '');
/** 날짜는 «월-일»만 — 목록에서 해까지 읽을 일이 없다. 자리를 반으로 줄인다. */
const d4 = (v: string) => (S(v).length >= 10 ? S(v).slice(5) : S(v));

/**
 * ★★**접수 목록의 칸 — 시트를 보고 짰다** (사장님 2026-09-10 「접수목록 더 짱짱하게, 시트 보고」).
 *
 * 정산원장 F04 「접수」 탭은 54칸이다. 그 중 «접수 담당자가 목록에서 보고 켜는» 것만 여기 온다.
 * 차례는 시트의 뜻 묶음을 따른다 —
 *   ① 어디까지 왔나(상태)  ② 언제·무엇(접수일·차번·고객·모델·공급사·상품)
 *   ③ 누가 팔았나(채널·담당)  ④ 계약 조건(개월·렌탈료·보증금·납입)
 *   ⑤ 진행 체크(계약서·인도·인도일)  ⑥ 돈(청구월·청구·지급·우리몫)  ⑦ 끝(청구서·계산서·갈래·비고)
 *
 * ⚠ **수금·지급 실행은 여기 없다** — 통장을 봐야 아는 것이라 화면에 띄우면 거짓말이 된다
 *   (사장님 「수금은 별도로 관리할게」). 시트에 칸이 있어도 안 가져온다.
 * ⚠ 환수는 별도 컬렉션(settlement_clawbacks)이라 이 목록의 줄과 1:1 이 아니다 — 청구 탭에서 다룬다.
 */
type IntakeCol = { key: string; label: string; w: number; unit?: string; num?: boolean; mid?: boolean; title?: string };
const INTAKE_COLS: IntakeCol[] = [
  { key: 'state', label: '상태', w: 78, title: '접수만 → 인도 대기 → 청구월 필요 → 인도완료' },
  { key: 'receivedAt', label: '접수일', w: 58, num: true },
  { key: 'plate', label: '차량번호', w: 82 },
  { key: 'customer', label: '고객', w: 62 },
  { key: 'model', label: '모델명', w: 118 },
  { key: 'supplier', label: '공급사', w: 76 },
  { key: 'product', label: '상품', w: 62 },
  { key: 'channel', label: '영업채널', w: 70 },
  { key: 'agent', label: '영업담당', w: 62 },
  { key: 'term', label: '개월', w: 38, num: true },
  { key: 'rent', label: '렌탈료', w: 66, unit: '원', num: true },
  { key: 'deposit', label: '보증금', w: 58, unit: '만', num: true },
  { key: 'payKind', label: '납입', w: 56 },
  { key: 'paper', label: '계약서', w: 46, mid: true },
  { key: 'delivered', label: '인도', w: 38, mid: true },
  { key: 'deliveredAt', label: '인도일', w: 58, num: true },
  { key: 'billMonth', label: '청구월', w: 62, num: true },
  { key: 'claim', label: '청구액', w: 74, unit: '원', num: true },
  { key: 'pay', label: '지급액', w: 74, unit: '원', num: true },
  { key: 'mine', label: '우리 몫', w: 74, unit: '원', num: true, title: '청구 − 지급' },
  { key: 'billed', label: '청구서', w: 46, mid: true, title: '청구서를 보냈나 — 우리가 정하는 것이라 여기서 켠다' },
  { key: 'invoiceIssued', label: '계산서', w: 46, mid: true, title: '세금계산서 발행 여부(홈택스에서 거둔 값)' },
  { key: 'intakeKind', label: '갈래', w: 62, title: '영업수수료가 기본 — 다른 것만 보인다' },
  { key: 'note', label: '비고', w: 160 },
];

/** 접수 줄이 지나는 네 자리 — 시트의 체크 둘과 청구월이 말해 준다. */
function stateOf(r: Line) {
  if (r.delivered && !S(r.billMonth)) return { key: 'todo', label: '청구월 필요' };
  if (r.delivered) return { key: 'gone', label: '인도완료' };
  if (r.paper) return { key: 'paper', label: '인도 대기' };
  return { key: 'new', label: '접수만' };
}
const tone = (s: string) => (s === '출고가능' ? 'ok' : s === '계약중' ? 'warn' : 'bad');
/** 조건 뽑기 칸 — 값이 있는 것만, 많이 쓰는 것부터. */
/**
 * ★원자 밭 이름을 «우리말»로 — 담당자가 읽는 화면이라 `first_registration_date` 로 두면 안 된다.
 *   표에 없는 밭은 열쇠 그대로 뜬다 — 새 밭이 생겨도 «안 보이는» 일은 없게.
 */
const SPEC_LABEL: Record<string, string> = {
  car_number: '차량번호', maker: '제조사', model: '모델', sub_model: '세부모델', trim_name: '트림',
  year: '연식', first_registration_date: '최초등록일', mileage: '주행거리', fuel_type: '연료',
  vehicle_class: '차급', seats: '인승', ext_color: '외장색', int_color: '내장색', drive_type: '구동',
  engine_cc: '배기량', battery_capacity: '배터리(kWh)', options: '옵션', origin: '원산지', vin: '차대번호',
  provider_name: '공급사', provider_company_code: '공급사코드', partner_code: '파트너코드',
  product_type: '상품구분', product_code: '상품코드', status: '상태', vehicle_status: '출고상태',
  status_kind: '상태갈래', status_label_raw: '원문 상태', status_reason: '상태 사유', policy_code: '정책코드',
  photo_link: '사진', reborncar_product_id: '원천 상품ID',
};

const pickList = (cars: CarLite[], key: 'fuel' | 'cls' | 'product' | 'supplier' | 'color' | 'maker') => {
  const m = new Map<string, number>();
  for (const c of cars) { const v = S(c[key]); if (v) m.set(v, (m.get(v) || 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ v, n }));
};

export default function IntakeStation({ api, preview = false }: { api: BoardApi; preview?: boolean }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [tab, setTab] = useState<'접수' | '실적' | '청구'>('접수');

  /** 조건 — 손님은 「월 70 이하 SUV 있어요?」로 묻는다. 글자 검색만으로는 못 답한다. */
  const [q, setQ] = useState('');
  const [fuel, setFuel] = useState('');
  const [cls, setCls] = useState('');
  const [prod, setProd] = useState('');
  const [sup, setSup] = useState('');
  const [maxRent, setMaxRent] = useState('');
  const [maxDep, setMaxDep] = useState('');
  const [minYear, setMinYear] = useState('');
  const [maxKm, setMaxKm] = useState('');
  const [maker, setMaker] = useState('');
  const [color, setColor] = useState('');
  const [perk, setPerk] = useState('');
  const [onlyOk, setOnlyOk] = useState(true);

  /** 고른 차 · 오른쪽 칸의 얼굴 — 보기 ↔ 접수. 자리는 그대로, 얼굴만 바뀐다. */
  const [picked, setPicked] = useState<CarLite | null>(null);
  const [car, setCar] = useState<Car | null>(null);
  const [mode, setMode] = useState<'보기' | '접수' | '줄'>('보기');
  /**
   * ★★**접수 줄을 누르면 오른쪽이 «그 줄»로 바뀐다** — 사장님 2026-09-10 「구현해야 할 게 더 있을 건데 항목이」
   *   시트는 54칸인데 목록에는 스물넷만 세웠다. 더 세우면 목록이 아니라 시트가 된다 —
   *   나머지는 «누르면» 여기 통째로 뜬다. 차를 누르면 차가 통째로 뜨는 것과 같은 수법이다.
   *   ★자리는 안 옮긴다 — 오른쪽 칸의 «얼굴»만 셋째로 바뀔 뿐이다.
   */
  const [pickedLine, setPickedLine] = useState<Line | null>(null);
  const [lineSpec, setLineSpec] = useState<LineSpec[] | null>(null);
  const [more, setMore] = useState(false);
  /**
   * ★재고에 «없는» 것도 접수한다 — 사장님 「직접 차량번호로 접수할 수도 있어야 하고,
   *   지원금이나 이런 것들도 다 눌러서 접수에 반영시킬 수 있어야 함」.
   *   지원금은 차번이 «없는» 것이 정상이다.
   */
  const DIRECT = ['직접 접수'] as const;
  /**
   * ★★**접수 갈래** — 사장님 2026-09-10. 기본은 «영업수수료»다.
   *   앞서 조건 줄에 「지원금」 단추를 따로 뒀는데, 갈래는 «차가 있냐 없냐»가 아니라
   *   «무슨 돈이냐»의 문제다 — 차를 골라 접수하면서도 인센티브일 수 있다.
   *   ⇒ 단추가 아니라 접수 칸의 한 줄로 둔다. 원자 밭 = `intakeKind`.
   */
  const KINDS = ['영업수수료', '인센티브', '업무지원비'] as const;
  /**
   * ★★**상품 구분은 «두 어휘»가 만난다** — 2026-09-10 실측으로 드러났다.
   *     재고(products)  7캐논: 신차렌트·중고렌트·신차구독·중고구독·오플구독·픽업구독·오공구독
   *     정산원장(F04)   거래 형태: 선출고·선발주·신차발주·매칭출고·장기렌트·구독 …
   *   둘은 «다른 것»을 말한다 — 하나는 상품 종류, 하나는 우리가 어떻게 판 것인가다.
   *   ⚠ 그래서 억지로 한쪽으로 옮기지 않는다. 옮기면 정산원장과 말이 안 맞는다.
   *   ⇒ 고를 수 있는 것은 둘을 «합쳐» 세우고, 그래도 모르는 값이 오면 그 값을 그대로 한 칸 더 세운다.
   */
  const PRODUCT_PICKS: string[] = [
    '선출고', '선발주', '신차발주', '매칭출고', '장기렌트', '구독',
    ...PRODUCT_TYPES,
  ].filter((x, i, a) => a.indexOf(x) === i);
  /**
   * ★메뉴 아이콘 — 원본 규격대로 «얇은 홑색 글리프»다(erp-classic/classic.css 머리글:
   *   「그림 파일도, 아이콘 글꼴도 쓰지 않는다. 그 시절 화면이 그랬다」).
   *   ⌂ 집 · ▤ 표(실적) · ₩ 돈(청구) — 도구모음의 ⟳ ＋ ⎙ ★ 와 같은 계열이다.
   */
  const MENUS = [
    { tab: '접수' as const, icon: '⌂' },
    { tab: '실적' as const, icon: '▤' },
    { tab: '청구' as const, icon: '₩' },
  ];
  /**
   * ★★★**왼쪽 업무 트리** — 사장님 2026-09-10
   *   「좌측에 teamjpkwork 처럼 좌측에 메뉴 만들자」·「그게 있어야 맞는 거 같다… **그게 규격이다**」
   *
   *   원본 고전 ERP 의 왼쪽은 두 층이다 —
   *     ① «빠른 단추»  이 회사가 매일 누르는 것. 펴지지 않고 바로 열린다.
   *     ② «업무 트리»  갈래(그룹) 아래 화면들. 렌터카면 어느 회사든 이만큼은 있다.
   *   ★코드(AR-0318 꼴)를 같이 적는다 — 전화로 「어느 화면이요?」를 주고받을 때 그것이 이름이다.
   *
   * ⚠ 아직 «안 만든» 화면은 흐리게 두고 눌러도 안 열린다 — 눌렸는데 빈 화면이 뜨면 고장으로 보인다.
   */
  const 빠른 = [
    { icon: '⌂', name: '접수', code: 'ST-0110', tab: '접수' as const },
    { icon: '▤', name: '실적', code: 'ST-0210', tab: '실적' as const },
    { icon: '₩', name: '청구', code: 'ST-0310', tab: '청구' as const },
  ];
  const 트리: { g: string; code: string; items: { name: string; code: string; tab?: typeof tab; href?: string }[] }[] = [
    { g: '정산', code: 'ST', items: [
      { name: '접수 등록', code: 'ST-0110', tab: '접수' },
      { name: '실적 확인', code: 'ST-0210', tab: '실적' },
      { name: '청구 장부', code: 'ST-0310', tab: '청구' },
    ] },
    { g: '정산서', code: 'SB', items: [
      { name: '보낼 곳·링크', code: 'SB-0110' },
      { name: '확인·정정 받은 것', code: 'SB-0210' },
    ] },
    { g: '맞대보기', code: 'CK', items: [
      { name: '원장 대조', code: 'CK-0110' },
      { name: '계산서', code: 'CK-0210' },
    ] },
  ];
  const [direct, setDirect] = useState<'' | typeof DIRECT[number]>('');
  /** 마지막에 쓴 채널·영업자 — 다음 접수에 그대로 들어온다. 타자가 하나로 준다. */
  const [last, setLast] = useState({ channel: '', agent: '' });
  const [busy, setBusy] = useState(false);
  const [justId, setJustId] = useState('');
  /**
   * ★**머리줄을 눌러 줄을 세운다** — 원본에 이미 `.cl-grid th.sortable` 이 있다(값은 안 고쳤다).
   *   기본은 «접수일 내림차순» — 방금 넣은 것이 맨 위에 오는 게 담당자가 바라는 차례다.
   */
  const [sortKey, setSortKey] = useState<string>('receivedAt');
  const [sortAsc, setSortAsc] = useState(false);
  const flipSort = (k: string) => {
    if (k === sortKey) { setSortAsc(!sortAsc); return; }
    setSortKey(k);
    /** 글자 칸은 «가나다순»이 자연스럽고, 날짜·돈은 «큰 것부터»가 자연스럽다. */
    const c = INTAKE_COLS.find((x) => x.key === k);
    setSortAsc(!(c?.num || k === 'state'));
  };
  /** ★사진은 «눌러서 크게» — 사장님 2026-09-10 「사진만 예외로 누르면 크게 보이게 해 주자」. */
  const [zoom, setZoom] = useState(false);

  /**
   * ★★**칸 크기는 담당자가 정한다** — 사장님 2026-09-10 「사이에 바를 각각 공간 조정할 수 있게」.
   *   곁폭 = 오른쪽 상세의 폭 · 아래높이 = 접수 목록의 높이.
   *   ⚠ 첫 그림은 «기본값»으로 나간다 — 저장한 값을 처음부터 쓰면 서버가 그린 것과 달라 하이드레이션이 깨진다.
   */
  /**
   * ★★**기본은 «반반»** — 사장님 2026-09-10 「기본 반반으로 해 주고」.
   *   `null` 이면 둘이 남는 높이를 반씩 나눠 갖는다. 끌면 그때 픽셀이 정해진다.
   *   ⚠ 첫 그림이 `null` 이라 서버가 그린 것과 브라우저가 그린 것이 같다 — 하이드레이션이 안 깨진다.
   */
  const [waitH, setWaitH] = useState<number | null>(null);
  useEffect(() => {
    try {
      const b = Number(localStorage.getItem('fp_stl_waitH'));
      if (b >= 90 && b <= 900) setWaitH(b);
    } catch { /* 저장이 막힌 브라우저도 있다 — 반반으로 돈다 */ }
  }, []);

  /**
   * 끌기 — 포인터를 «붙잡아» 둔다(setPointerCapture). 안 붙잡으면 표 위로 지나갈 때 끌기가 끊긴다.
   * ★가름바를 두 번 누르면 기본값으로 돌아간다 — 잘못 끌어 화면이 망가졌을 때 되돌릴 길이 있어야 한다.
   */
  /**
   * 위아래 몫을 끈다 — 포인터를 «붙잡아» 둔다(setPointerCapture). 안 붙잡으면 표 위를 지날 때 끌기가 끊긴다.
   * ★두 번 누르면 «반반»으로 돌아간다 — 잘못 끌어 화면이 망가졌을 때 되돌릴 길이 있어야 한다.
   */
  const 끌기 = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const 처음 = e.clientY;
    const 값 = (document.querySelector('.cl-wait') as HTMLElement)?.offsetHeight || 180;
    const 움직임 = (ev: PointerEvent) => {
      /** 위로 끌수록 아래 칸이 커진다. */
      setWaitH(Math.min(Math.round(window.innerHeight * 0.75), Math.max(90, 값 + (처음 - ev.clientY))));
    };
    const 놓기 = () => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener('pointermove', 움직임);
      el.removeEventListener('pointerup', 놓기);
      const 끝 = (document.querySelector('.cl-wait') as HTMLElement)?.offsetHeight;
      try { if (끝) localStorage.setItem('fp_stl_waitH', String(끝)); } catch { /* 못 적어도 이번 판에서는 잘 돈다 */ }
    };
    el.addEventListener('pointermove', 움직임);
    el.addEventListener('pointerup', 놓기);
  };
  const 되돌리기 = () => { setWaitH(null); try { localStorage.removeItem('fp_stl_waitH'); } catch { /* 무시 */ } };
  /** 먼저 누른 차의 늦은 응답이 지금 고른 차를 덮지 못하게 하는 요청 순번. */
  const carRequest = useRef(0);

  /**
   * ★★**오른쪽 끝은 «상태»다** — 사장님 2026-09-10 「우측에는 날짜 시간 날씨 넣어주고」.
   *   통상 고전 ERP 가 접속 서버·사람·시각을 두는 자리다(원본도 「DB PROD | SVR: was-01 | 2026-09-05 14:22:31」).
   *
   * ⚠ **첫 그림은 서버가 그린다** — 시각을 처음부터 그리면 서버가 그린 글자와 브라우저가 그린 글자가
   *   달라 하이드레이션이 깨진다. 그래서 빈 채로 나가고 브라우저에서 채운다.
   */
  const [now, setNow] = useState('');
  useEffect(() => {
    const 그리기 = () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const 요일 = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
      setNow(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}(${요일}) ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`);
    };
    그리기();
    const h = setInterval(그리기, 1000);
    return () => clearInterval(h);
  }, []);

  /**
   * 날씨 — 열쇠 없이 열려 있는 곳(open-meteo)에서 서울 것을 한 번 받아 30분마다 새로 받는다.
   * ⚠ **못 받아도 화면은 그대로 돈다** — 날씨는 «곁수»지 일이 아니다. 실패하면 자리를 비운다.
   * ★글리프는 원본 계열(얇은 홑색)로 고른다 — 그림 아이콘을 끌어오지 않는다.
   */
  const [sky, setSky] = useState<{ icon: string; text: string }>({ icon: '', text: '' });
  useEffect(() => {
    let 살아있다 = true;
    const 받기 = async () => {
      try {
        const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m,weather_code&timezone=Asia%2FSeoul');
        if (!r.ok) return;
        const j = await r.json() as { current?: { temperature_2m?: number; weather_code?: number } };
        const t2 = j.current?.temperature_2m;
        const w = Number(j.current?.weather_code ?? -1);
        if (!살아있다 || typeof t2 !== 'number') return;
        /** 날씨표(WMO) 를 글리프 다섯으로 줄인다 — 화면에 필요한 만큼만. */
        const icon = w === 0 ? '☀' : w <= 3 ? '☁' : w <= 48 ? '≡' : w <= 67 ? '☂' : w <= 77 ? '❄' : w <= 82 ? '☂' : '☈';
        setSky({ icon, text: `${Math.round(t2)}°` });
      } catch { /* 날씨는 곁수다 — 못 받으면 자리를 비운다 */ }
    };
    void 받기();
    const h = setInterval(받기, 30 * 60 * 1000);
    return () => { 살아있다 = false; clearInterval(h); };
  }, []);

  const today = useMemo(() => localSettlementDay(), []);
  const empty = {
    plate: '', customer: '', model: '', supplier: '', channel: '', agent: '', product: '',
    term: '', rent: '', deposit: '', price: '', payKind: '일시납', intakeKind: '영업수수료',
    receivedAt: today, deliveredAt: '', billMonth: '', note: '',
  };
  const [f, setF] = useState<Record<string, string>>(empty);
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));

  const load = async () => { const j = await api.load(); if (j) setBoard(j); };
  useEffect(() => { if (api.ready) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [api.ready]);

  const hits = useMemo(() => {
    if (!board) return [];
    const t = S(q).replace(/\s/g, '');
    const cap = Number(String(maxRent).replace(/[,\s]/g, '')) || 0;
    const dcap = Number(maxDep) || 0;
    const yfloor = Number(minYear) || 0;
    const kcap = Number(maxKm) || 0;
    return board.cars.filter((c) => {
      if (onlyOk && c.status !== '출고가능') return false;
      if (fuel && c.fuel !== fuel) return false;
      if (cls && c.cls !== cls) return false;
      if (prod && c.product !== prod) return false;
      if (sup && c.supplier !== sup) return false;
      if (maker && c.maker !== maker) return false;
      if (color && c.color !== color) return false;
      /** ★우대조건 — 셈은 서버가 정본(`hasPerk`)으로 해 뒀다. 화면은 «고르기»만 한다. */
      if (perk && !(c.perks || []).includes(perk)) return false;
      if (yfloor && Number(c.year) < yfloor) return false;
      if (kcap && !(c.km > 0 && c.km <= kcap)) return false;
      /** ★보증금 0 은 «무보증»이라 어떤 상한에도 걸린다 — 0 을 「모름」으로 읽으면 무보증 차가 사라진다. */
      if (dcap && !(c.terms || []).some((x) => x.rent > 0 && x.deposit <= dcap)) return false;
      /** ★요금은 «어느 기간이든» 그 값 아래면 된다 — 「36개월로 하면 되나요」가 그 자리에서 풀린다. */
      if (cap && !(c.terms || []).some((x) => x.rent > 0 && x.rent <= cap)) return false;
      if (t && !`${c.plate}${c.name}${c.trim}${c.supplier}${c.product}${c.cls}${c.fuel}${c.color}`.replace(/\s/g, '').includes(t)) return false;
      return true;
    }).sort((a, b) => (a.rent || 9e9) - (b.rent || 9e9)).slice(0, 400);
  }, [board, q, fuel, cls, prod, sup, maxRent, maxDep, minYear, maxKm, maker, color, perk, onlyOk]);

  /** 줄을 누르면 오른쪽에 상세가 뜬다. 요금표는 그때 따로 묻는다. */
  const pick = async (c: CarLite) => {
    const request = ++carRequest.current;
    setPicked(c); setCar(null); setMode('보기'); setDirect('');
    setF({ ...empty, plate: c.plate, model: [c.name, c.trim].filter(Boolean).join(' '), supplier: c.supplier, product: c.product });
    const got = await api.car(c.plate);
    if (request !== carRequest.current) return;
    if (got && sameSettlementCar(c.plate, got.plate)) setCar(got);
  };

  /** 접수 줄을 누르면 그 줄을 통째로 받아 온다. 못 받으면 목록에 있는 만큼만 보여 준다. */
  const pickLine = async (r: Line) => {
    setPickedLine(r); setLineSpec(null); setMode('줄'); setPicked(null); setCar(null); setDirect('');
    if (!api.line) return;
    const got = await api.line(r.id);
    if (got) setLineSpec(got);
  };

  /** 상세 → 접수. 같은 칸이 얼굴만 바꾼다. 지난번 채널·영업자가 들어와 있다. */
  const toIntake = () => {
    if (!picked) return;
    setF((o) => ({
      ...o,
      term: o.term || String(intakeTermMonths(picked.term) || ''), rent: o.rent || String(picked.rent || ''), deposit: o.deposit || String(picked.deposit || ''),
      channel: o.channel || last.channel, agent: o.agent || last.agent,
    }));
    setMode('접수');
    setTimeout(() => document.getElementById('cl-ch-in')?.focus(), 0);
  };

  const openDirect = (kind: typeof DIRECT[number]) => {
    carRequest.current++;
    setPicked(null); setCar(null); setMode('접수');
    setDirect(direct === kind ? '' : kind);
    setF({ ...empty, product: '', channel: last.channel, agent: last.agent });
  };

  const useTerm = (term: string, rent: number, deposit: number) =>
    setF((o) => ({ ...o, term: String(intakeTermMonths(term) || ''), rent: String(rent || ''), deposit: String(deposit || '') }));

  /** ★갈래가 영업수수료가 아니면 «차»가 아니라 «무엇에 대한 것이냐»를 묻는다. */
  const isAid = f.intakeKind !== '영업수수료';
  /**
   * ★**청구예정월** — 지금 적힌 것으로 규칙이 내는 달. 담당자가 «지금 정하는» 값이다.
   *   비워 두면 이 달로 저장된다. 적으면 적은 것이 이긴다.
   */
  const 예정월 = settlementMonthOf({
    billMonth: '', receivedAt: f.receivedAt, deliveredAt: f.deliveredAt, payKind: f.payKind,
  }) || today.slice(0, 7);
  /** ★필수는 «영업채널» 하나 — 차 정보는 재고에서 오고 고객명은 알면 적는다. */
  const ready = isAid ? !!S(f.customer) : (!!S(f.plate) && !!S(f.channel));

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.save({
        plate: S(f.plate), customer: S(f.customer), model: S(f.model), supplier: S(f.supplier),
        channel: S(f.channel), agent: S(f.agent), product: S(f.product), payKind: S(f.payKind),
        receivedAt: S(f.receivedAt), deliveredAt: S(f.deliveredAt),
        intakeKind: S(f.intakeKind) || '영업수수료',
        /** ★비워 두면 «규칙이 정한 달»이 들어간다 — 어느 달에도 안 서는 줄을 만들지 않는다. */
        billMonth: S(f.billMonth) || 예정월,
        term: intakeTermMonths(f.term),
        rent: Number(String(f.rent).replace(/[,\s]/g, '')) || 0,
        deposit: Number(String(f.deposit).replace(/[,\s]/g, '')) || 0,
        price: Number(String(f.price).replace(/[,\s]/g, '')) || 0,
        note: S(f.note),
      });
      if (!res.ok) { toast(res.error || '못 남겼습니다'); return; }
      toast(`접수했습니다 — ${S(f.plate) || S(f.customer)}`);
      setLast({ channel: S(f.channel), agent: S(f.agent) });
      setJustId(S(res.id));
      setPicked(null); setDirect(''); setMode('보기'); setF(empty);
      await load();
    } finally { setBusy(false); }
  };

  const flip = async (r: Line, key: 'paper' | 'delivered' | 'billed', on: boolean) => {
    if (!api.edit) { toast('미리보기라 바뀌지 않습니다'); return; }
    /**
     * ★「청구서 나감」은 날짜를 같이 박는다 — «언젠가 보냈다»만 남기면 나중에 못 찾는다.
     *   끄는 쪽으로는 날짜도 같이 지운다 — 안 보냈는데 날짜만 남으면 거짓말이 된다.
     */
    const patch = key === 'delivered' ? deliveryTransitionPatch(on, r, today)
      : key === 'billed' ? { billed: on, billedAt: on ? today : '' }
      : { paper: on };
    const res = await api.edit(r.id, patch);
    if (!res.ok) { toast(res.error || '못 바꿨습니다'); return; }
    await load();
  };

  if (!api.ready) return null;
  if (!board) return <div className="cl"><div className="cl-menubar"><span className="cl-logo">FREEPASS ERP</span></div></div>;

  const todo = board.intake.filter((r) => stateOf(r).key === 'todo').length;
  /** ★상태 차례는 «일이 남은 순»이다 — 할 일이 위로 온다. 가나다순이면 뜻이 없다. */
  const 상태차례: Record<string, number> = { todo: 0, paper: 1, new: 2, gone: 3 };
  const sortedIntake = [...board.intake].sort((a, b) => {
    const 값 = (r: Line): string | number => {
      if (sortKey === 'state') return 상태차례[stateOf(r).key] ?? 9;
      if (sortKey === 'mine') return (r.claim || 0) - (r.pay || 0);
      const v = (r as unknown as Record<string, unknown>)[sortKey];
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'number') return v;
      return S(v);
    };
    const x = 값(a); const y = 값(b);
    const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
    return sortAsc ? d : -d;
  });
  const fuels = pickList(board.cars, 'fuel');
  const clss = pickList(board.cars, 'cls');
  const prods = pickList(board.cars, 'product');
  const sups = pickList(board.cars, 'supplier');
  /** ★연식·색상·우대는 «있는 것만» 세운다 — 0건짜리를 고르게 두면 빈 목록이 나온다. */
  const years = [...new Set(board.cars.map((c) => Number(c.year)).filter((y) => y > 2000))].sort((a, b) => b - a);
  const makers = pickList(board.cars, 'maker');
  const colors = pickList(board.cars, 'color');
  const perkCnt = new Map<string, number>();
  for (const c of board.cars) for (const pk of c.perks || []) perkCnt.set(pk, (perkCnt.get(pk) || 0) + 1);
  const perkList = [...perkCnt].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ v, n }));
  /** 요금표 — 고른 차의 것이 오면 그것을, 아직이면 목록에 실려 온 것을 쓴다. */
  const fees = car && picked && sameSettlementCar(picked.plate, car.plate)
    ? Object.entries(car.price || {}).map(([k, v]) => ({ term: k, rent: v.rent, deposit: v.deposit }))
    : (picked?.terms || []);

  return (
    <div className="cl">
      <div className="cl-menubar">
        <span className="cl-logo">FREEPASS ERP</span>
        {/** ★로고 바로 뒤 = 이 프로그램이 하는 일 셋. 아이콘+텍스트(박스 뱃지 금지 — 확정 규격). */}
        {MENUS.map((m) => (
          <span key={m.tab} className={`cl-menu${tab === m.tab ? ' on' : ''}`} onClick={() => setTab(m.tab)}>
            <span className="cl-tbi">{m.icon}</span>{m.tab === '접수' ? '홈' : m.tab}
          </span>
        ))}
        {preview && <span className="cl-preview">미리보기 — 지어낸 값</span>}
        <span className="cl-sp" />
        {/** ★오른쪽 끝 = «상태». 통상 ERP 가 서버·사람·시각을 두는 자리다. */}
        <span className="cl-user">
          재고 {board.cars.length}대 · 대기 {board.intake.length}건{todo ? ` · 할 일 ${todo}` : ''}
        </span>
        <span className="cl-msep" />
        <span className="cl-user" style={{ marginLeft: 0 }}>
          <span className="cl-tbi">{sky.icon}</span>{sky.text}
        </span>
        <span className="cl-msep" />
        <span className="cl-clock">{now}</span>
      </div>

      {/**
        * ★★**도구 모음** — 원본 규격. 아이콘은 얇은 홑색 글리프(⟳ ＋ ⎙ ⤓ ★ ?).
        *   ⚠ 아직 «안 만든» 것은 흐리게 두고 안 눌린다 — 눌렀는데 아무 일도 안 나면 고장으로 보인다.
        */}
      <div className="cl-toolbar">
        <button type="button" className="cl-tb" onClick={() => void load()} title="다시 불러오기">
          <span className="cl-tbi">⟳</span>조회
        </button>
        <button type="button" className="cl-tb" onClick={() => openDirect('직접 접수')} title="차 없이 바로 접수">
          <span className="cl-tbi">＋</span>신규
        </button>
        <span className="cl-tbsep" />
        <button type="button" className="cl-tb" disabled title="준비 중"><span className="cl-tbi">⎙</span>출력</button>
        <button type="button" className="cl-tb" disabled title="준비 중"><span className="cl-tbi">⤓</span>엑셀</button>
        <span className="cl-sp" />
        {/** ★문서 탭 — 지금 «어느 창»을 보고 있는지. 고른 것만 올라온다(원본 결). */}
        <div className="cl-tabs">
          {MENUS.map((m) => (
            <div key={m.tab} className={`cl-tab${tab === m.tab ? ' on' : ''}`} onClick={() => setTab(m.tab)}>
              <span className="cl-tbi">{m.icon}</span>{m.tab === '접수' ? '접수 등록' : m.tab === '실적' ? '실적 확인' : '청구 장부'}
              <span className="cl-tcode">{m.tab === '접수' ? 'ST-0110' : m.tab === '실적' ? 'ST-0210' : 'ST-0310'}</span>
            </div>
          ))}
        </div>
      </div>

      {tab !== '접수' ? (
        <div className="cl-body">
          <main className="cl-main">
            <div className="cl-grid">
              <div className="cl-crumb">{tab}</div>
              <div className="cl-note" style={{ padding: 16 }}>
                «{tab}» 은 아직 안 만들었습니다 — 접수부터 끝내고 옵니다(설계서 §7).
                <div style={{ marginTop: 10 }}>
                  <button type="button" className="cl-btn" onClick={() => setTab('접수')}>← 홈으로</button>
                </div>
              </div>
            </div>
          </main>
        </div>
      ) : (
        <>
          {/**
            * 조건 줄 — 손님 물음에 그 자리에서 답한다.
            * ★★원본 어휘로 «필터 판»이다 — `cl-filter`(판·선·띠높이) 안에 `cl-frow`(조건 한 줄).
            *   앞서 `cl-toolbar` 로 만들었는데, 원본에서 툴바는 «행동 단추 띠»고
            *   조건은 «필터 판»이다. 둘은 바탕도 테두리도 단추 결도 다르다 — 섞으면 어정쩡해진다.
            */}
          <div className="cl-filter cl-cond">
            <div className="cl-frow">
              <input className="cl-find" type="text" value={q} autoFocus
                placeholder="차번 · 차종 · 트림 · 색으로 찾기"
                onChange={(e) => setQ(e.target.value)} />
              {/**
                * ★★**차례는 «손님이 묻는 차례»다** — 사장님 2026-09-10
                *   「자주 쓰는 거부터 앞으로 둬야지 — 대여료 보증금 제조사 차종구분 색상 연식 주행거리 연료 우대」
                *   앞서 나는 «데이터가 있는 차례»로 세웠다. 그건 우리 사정이지 손님 사정이 아니다.
                *   ⚠ 여기 차례를 바꿀 때는 «왜 그 자리인지»가 있어야 한다 — 통화 중에 눈이 외운 자리다.
                */}
              <select value={maxRent} onChange={(e) => setMaxRent(e.target.value)}>
                <option value="">대여료 전체</option>
                {[300000, 400000, 500000, 600000, 700000, 800000, 1000000, 1500000].map((v) => (
                  <option key={v} value={v}>{`${v / 10000}만 이하`}</option>
                ))}
              </select>
              <select value={maxDep} onChange={(e) => setMaxDep(e.target.value)}>
                <option value="">보증금 전체</option>
                <option value="0">무보증</option>
                {[500000, 1000000, 2000000, 3000000, 5000000].map((v) => (
                  <option key={v} value={v}>{`${v / 10000}만 이하`}</option>
                ))}
              </select>
              <select value={maker} onChange={(e) => setMaker(e.target.value)}>
                <option value="">제조사 전체</option>
                {makers.map((x) => <option key={x.v} value={x.v}>{x.v} ({x.n})</option>)}
              </select>
              <select value={cls} onChange={(e) => setCls(e.target.value)}>
                <option value="">차종구분 전체</option>
                {clss.map((x) => <option key={x.v} value={x.v}>{x.v} ({x.n})</option>)}
              </select>
              <select value={color} onChange={(e) => setColor(e.target.value)}>
                <option value="">색상 전체</option>
                {colors.map((x) => <option key={x.v} value={x.v}>{x.v} ({x.n})</option>)}
              </select>
              <select value={minYear} onChange={(e) => setMinYear(e.target.value)}>
                <option value="">연식 전체</option>
                {years.map((y) => <option key={y} value={y}>{y}년 이상</option>)}
              </select>
              <select value={maxKm} onChange={(e) => setMaxKm(e.target.value)}>
                <option value="">주행 전체</option>
                {[10000, 20000, 30000, 50000, 80000, 100000].map((v) => (
                  <option key={v} value={v}>{`${v / 10000}만km 이하`}</option>
                ))}
              </select>
              <select value={fuel} onChange={(e) => setFuel(e.target.value)}>
                <option value="">연료 전체</option>
                {fuels.map((x) => <option key={x.v} value={x.v}>{x.v} ({x.n})</option>)}
              </select>
              <select value={perk} onChange={(e) => setPerk(e.target.value)}>
                <option value="">우대 전체</option>
                {perkList.map((x) => <option key={x.v} value={x.v}>{x.v} ({x.n})</option>)}
              </select>
              {/** 상품·공급사는 «우리 사정»이라 뒤에 둔다 — 손님이 묻는 말이 아니다. */}
              <select value={prod} onChange={(e) => setProd(e.target.value)}>
                <option value="">상품 전체</option>
                {prods.map((x) => <option key={x.v} value={x.v}>{x.v} ({x.n})</option>)}
              </select>
              <select value={sup} onChange={(e) => setSup(e.target.value)}>
                <option value="">공급사 전체</option>
                {sups.map((x) => <option key={x.v} value={x.v}>{x.v} ({x.n})</option>)}
              </select>
              <label className="cl-chk">
                <input type="checkbox" checked={onlyOk} onChange={(e) => setOnlyOk(e.target.checked)} /> 출고가능만
              </label>
              <button type="button" className="cl-btn"
                onClick={() => { setQ(''); setFuel(''); setCls(''); setProd(''); setSup(''); setMaxRent(''); setMaxDep(''); setMinYear(''); setMaxKm(''); setMaker(''); setColor(''); setPerk(''); setOnlyOk(true); }}>조건 지우기</button>
              {DIRECT.map((k) => (
                <button key={k} type="button" className={`cl-btn${direct === k ? ' cl-btn-p' : ''}`} onClick={() => openDirect(k)}>{k}</button>
              ))}
              <span className="cl-sp" />
            </div>
          </div>

          <div className="cl-body" style={waitH ? ({ ['--아래높이' as string]: `${waitH}px` } as React.CSSProperties) : undefined}>
            {/**
              * ★왼쪽 업무 트리 — 원본 규격(빠른 단추 + 갈래별 화면).
              *   ⚠ 접수 탭에서만 세우지 않는다. 어느 탭에서든 «어디로 갈지»가 보여야 한다.
              */}
            <nav className="cl-tree">
              <div className="cl-tree-head">프리패스 정산</div>
              <div className="cl-quick">
                {빠른.map((q) => (
                  <button key={q.code} type="button" className={`cl-qbtn${tab === q.tab ? ' on' : ''}`}
                    onClick={() => setTab(q.tab)} title={q.code}>
                    <span className="cl-qi">{q.icon}</span>{q.name}
                  </button>
                ))}
              </div>
              {트리.map((g) => (
                <div key={g.code}>
                  <div className="cl-tree-g">{g.g}<span className="cl-sp" /><span className="cl-tcode">{g.code}</span></div>
                  {g.items.map((it) => (
                    <div key={it.code}
                      className={`cl-tree-s${it.tab && tab === it.tab ? ' on' : ''}${it.tab ? '' : ' off'}`}
                      onClick={() => { if (it.tab) setTab(it.tab); }}
                      title={it.tab ? it.code : '준비 중'}>
                      {it.name}<span className="cl-sp" /><span className="cl-tcode">{it.code}</span>
                    </div>
                  ))}
                </div>
              ))}
            </nav>

            {/* ── 왼쪽 — 위 상품 목록, 아래 접수 목록 ───────────── */}
            <main className="cl-main">
              <div className="cl-grid cl-cars">
                {/**
                  * ★★**판에는 «이름표»가 있다** — 사장님 2026-09-10
                  *   「근데 상품리스트는 왜 패널헤더가 없지?? 거기에 댓수랑 이런 거 규격 맞춰야 하는데」
                  *   접수 목록·상세에는 `cl-crumb` 가 있는데 상품 목록만 없었다.
                  *   ★건수는 «그 판이» 말한다 — 조건 줄 구석에 두면 무엇을 센 숫자인지 흐려진다.
                  */}
                <div className="cl-crumb">
                  상품 목록 <b>{hits.length}대</b>
                  <span className="cl-note">재고 {board.cars.length}대 중</span>
                  {hits.length >= 400 && <span className="cl-st warn">· 400대까지만 보입니다 — 조건을 좁히세요</span>}
                  <span className="cl-sp" />
                  <span className="cl-note">줄을 누르면 오른쪽에 상세가 뜹니다</span>
                </div>
                <table>
                  <thead>
                    <tr>
                      {/**
                        * ★상태는 «글자»로 둔다 — 원본 jpkwork 가 그렇게 쓴다(`cl-st` 에 색만 입힘).
                        * 앞서 이름 없는 «점» 칸을 세웠더니 머리줄이 비어 표가 어정쩡해졌다.
                        * 고전 ERP 표는 «머리 없는 칸»을 두지 않는다 — 칸이 있으면 이름이 있다.
                        */}
                      <th style={{ width: 58 }}>상태</th>
                      <th style={{ width: 84 }}>차량번호</th>
                      <th style={{ width: 76 }}>차종</th>
                      <th style={{ width: 76 }}>트림</th>
                      <th className="cl-num" style={{ width: 44 }}>연식</th>
                      <th className="cl-num" style={{ width: 62 }}>주행<i>만km</i></th>
                      <th style={{ width: 62 }}>연료</th>
                      <th style={{ width: 54 }}>차급</th>
                      <th className="cl-num" style={{ width: 36 }}>인승</th>
                      <th style={{ width: 38 }}>색</th>
                      <th style={{ width: 66 }}>공급사</th>
                      <th style={{ width: 56 }}>상품</th>
                      <th className="cl-num" style={{ width: 38 }}>개월</th>
                      <th className="cl-num" style={{ width: 74 }}>월대여료<i>원</i></th>
                      <th className="cl-num" style={{ width: 58 }}>보증금<i>만</i></th>
                    </tr>
                  </thead>
                  <tbody>
                    {hits.map((c) => (
                      <tr key={c.plate} className={picked?.plate === c.plate ? 'on' : ''} onClick={() => void pick(c)}>
                        <td className={`cl-st ${tone(c.status)}`}>{c.status}</td>
                        <td><b>{c.plate}</b></td>
                        <td>{c.name}</td>
                        <td>{c.trim}</td>
                        <td>{c.year}</td>
                        <td className="cl-num">{km(c.km)}</td>
                        <td>{c.fuel}</td>
                        <td>{c.cls}</td>
                        <td className="cl-num">{c.seats || ''}</td>
                        <td>{c.color}</td>
                        <td>{c.supplier}</td>
                        <td>{c.product}</td>
                        <td className="cl-num">{c.term}</td>
                        <td className="cl-num"><b>{won(c.rent)}</b></td>
                        <td className="cl-num">{man(c.deposit)}</td>
                      </tr>
                    ))}
                    {hits.length === 0 && (
                      <tr><td colSpan={15} className="cl-note">조건에 맞는 차가 없습니다 — 조건을 넓혀 보세요</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/** ★가로 가름바 — 위(상품)와 아래(접수)의 몫을 담당자가 정한다. 두 번 누르면 기본값. */}
              <div className="cl-gutter cl-gutter-h" onPointerDown={끌기} onDoubleClick={되돌리기}
                title="끌어서 위아래 크기 조절 · 두 번 누르면 기본값" role="separator" aria-orientation="horizontal"><i /></div>
              <div className="cl-grid cl-wait">
                <div className="cl-crumb">
                  접수 목록 {sortedIntake.length}건
                  {todo > 0 && <span className="cl-st warn"> · ★청구월 박아야 할 것 {todo}건</span>}
                  <span className="cl-sp" />
                  <span className="cl-note">머리줄을 누르면 그 칸으로 줄을 세웁니다</span>
                </div>
                <table>
                  <thead>
                    <tr>
                      {INTAKE_COLS.map((c) => (
                        <th key={c.key} className={`${c.num ? 'cl-num' : ''}${c.mid ? ' cl-mid' : ''} sortable${sortKey === c.key ? ' on' : ''}`}
                          style={{ width: c.w }} onClick={() => flipSort(c.key)} title={c.title || c.label}>
                          {c.label}{c.unit ? <i>{c.unit}</i> : null}
                          {sortKey === c.key ? <span className="cl-sort">{sortAsc ? '▲' : '▼'}</span> : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedIntake.map((r) => {
                      const st = stateOf(r);
                      const mine = (r.claim || 0) - (r.pay || 0);
                      return (
                        <tr key={r.id}
                          className={`cl-row-${st.key}${r.id === justId || pickedLine?.id === r.id ? ' on' : ''}${r.cancelled ? ' cl-row-x' : ''}`}
                          onClick={(e) => {
                            /** ⚠ 체크칸을 누른 것은 «줄을 연» 것이 아니다 — 체크만 하고 만다. */
                            if ((e.target as HTMLElement).closest('input')) return;
                            void pickLine(r);
                          }}>
                          <td className={`cl-st ${st.key === 'todo' ? 'warn' : st.key === 'gone' ? 'ok' : ''}`}>{st.label}</td>
                          <td className="cl-num">{d4(r.receivedAt)}</td>
                          <td><b>{r.plate || '(차번없음)'}</b></td>
                          <td>{r.customer}</td>
                          <td>{r.model}</td>
                          <td>{r.supplier}</td>
                          <td>{r.product}</td>
                          <td>{r.channel}</td>
                          <td>{r.agent}</td>
                          <td className="cl-num">{r.term || ''}</td>
                          <td className="cl-num">{r.rent ? won(r.rent) : ''}</td>
                          <td className="cl-num">{man(r.deposit || 0)}</td>
                          <td>{r.payKind}</td>
                          <td className="cl-mid">
                            <input type="checkbox" checked={!!r.paper} onChange={(e) => void flip(r, 'paper', e.target.checked)} />
                          </td>
                          <td className="cl-mid">
                            <input type="checkbox" checked={!!r.delivered} onChange={(e) => void flip(r, 'delivered', e.target.checked)} />
                          </td>
                          <td className="cl-num">{d4(r.deliveredAt)}</td>
                          {/** 아직 안 박힌 달은 «칸을 비우지» 않는다 — 빈 칸은 「없다」인지 「모른다」인지 말하지 않는다. */}
                          <td className={`cl-num${S(r.billMonth) ? '' : ' cl-st warn'}`}>{S(r.billMonth) || '—'}</td>
                          <td className="cl-num">{r.claim ? won(r.claim) : ''}</td>
                          <td className="cl-num">{r.pay ? won(r.pay) : ''}</td>
                          {/** ★우리 몫 = 청구 − 지급. 화면이 «세는» 게 아니라 서버가 준 둘을 뺀 것뿐이다. */}
                          <td className={`cl-num${mine < 0 ? ' cl-st bad' : ''}`}><b>{mine ? won(mine) : ''}</b></td>
                          <td className="cl-mid">
                            <input type="checkbox" checked={!!r.billed} onChange={(e) => void flip(r, 'billed', e.target.checked)} />
                          </td>
                          <td className="cl-mid">{r.invoiceIssued ? <span className="cl-st ok" title={r.invoiceAt}>발행</span> : ''}</td>
                          <td>{r.intakeKind !== '영업수수료' ? <span className="cl-st warn">{r.intakeKind}</span> : ''}</td>
                          <td title={r.note}>{r.note}</td>
                        </tr>
                      );
                    })}
                    {sortedIntake.length === 0 && (
                      <tr><td colSpan={INTAKE_COLS.length} className="cl-note">접수된 줄이 없습니다</td></tr>
                    )}
                  </tbody>
                  {/**
                    * ★★**합계 줄** — 원본 규격(`cl-sum` · tfoot 붙박이).
                    *   ⚠ 정산 화면인데 «합계가 없었다». 사장님 2026-09-10 「뭔가 정산은 좀 빠지는 거 같은데??」
                    *     — 원본 클래스를 세어 보니 `cl-sum` 을 우리만 안 쓰고 있었다.
                    *   ★합계는 «자료가 아니라 답»이다. 그래서 몸통과 선으로 뗀다(원본 주석 그대로).
                    *   ★굴려도 아래에 붙어 있는다 — 답을 보려고 끝까지 내리지 않아도 된다.
                    */}
                  {sortedIntake.length > 0 && (
                    <tfoot>
                      <tr className="cl-sum">
                        <td colSpan={9}>합계 {sortedIntake.length}건</td>
                        <td className="cl-num">{sortedIntake.reduce((a, r) => a + (r.term || 0), 0) || ''}</td>
                        <td className="cl-num">{won(sortedIntake.reduce((a, r) => a + (r.rent || 0), 0))}</td>
                        <td className="cl-num">{man(sortedIntake.reduce((a, r) => a + (r.deposit || 0), 0))}</td>
                        <td colSpan={5} />
                        <td className="cl-num">{won(sortedIntake.reduce((a, r) => a + (r.claim || 0), 0))}</td>
                        <td className="cl-num">{won(sortedIntake.reduce((a, r) => a + (r.pay || 0), 0))}</td>
                        <td className="cl-num"><b>{won(sortedIntake.reduce((a, r) => a + ((r.claim || 0) - (r.pay || 0)), 0))}</b></td>
                        <td colSpan={4} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/**
                * ★**건수 줄** — 원본 규격(`cl-count`). 표 아래에서 «지금 몇 건을 보고 있나»를 말한다.
                *   판 머리는 「무엇을 보는 판인가」, 여기는 「그 중 몇을 보고 있나」다 — 다른 물음이다.
                */}
              <div className="cl-count">
                <b>{hits.length}</b>건 보는 중
                <span className="cl-tilde"> / </span>재고 <b>{board.cars.length}</b>대
                <span className="cl-sp" />
                접수 <b>{sortedIntake.length}</b>건{todo ? <span className="cl-st warn"> · 할 일 {todo}</span> : null}
              </div>
            </main>

            {/* ── 오른쪽 — 상세 ↔ 접수. 자리는 그대로, 얼굴만 바뀐다 ── */}
            {/**
              * ★★**오른쪽 칸은 «몸 + 붙박이 실행바»다** — 사장님 2026-09-10
              *   「상세 페이지 하단바를 고정으로 해서 접수하기·돌아가기 이런 거 만들어 줘.
              *    **우에 상세로 필요 없고**」
              *   ⚠ 앞서 실행 단추가 «몸 안에» 있어서 제원을 내려 보면 같이 밀려 나갔다.
              *     누를 것이 화면 밖으로 나가면 그건 없는 단추다.
              *   ⇒ 몸만 구르고 바는 붙박이로 선다. 되돌아가는 길도 머리가 아니라 «여기»에 둔다.
              */}
            <aside className="cl-side">
              <div className="cl-side-body">
              {!picked && !direct && mode !== '줄' && (
                <>
                  <div className="cl-crumb">상세</div>
                  <div className="cl-empty-note">
                    왼쪽 목록에서 차를 고르면<br />조건과 기간별 요금이 여기 뜹니다.
                    <br /><br />재고에 없는 차도 접수합니다 — 아래 단추로 차량번호부터 손으로 적으세요.
                  </div>
                </>
              )}

              {mode === '줄' && pickedLine && (
                <>
                  <div className="cl-crumb">접수 줄 — 시트에 적힌 그대로</div>
                  <div className="cl-pick">
                    <div className="cl-pick-t">{pickedLine.plate || '(차번없음)'}</div>
                    <div className="cl-pick-s">{pickedLine.customer} · {pickedLine.model}</div>
                    <div className="cl-pick-r">
                      <span>{pickedLine.supplier}</span><span>{pickedLine.channel}</span>
                      <span className={`cl-st ${stateOf(pickedLine).key === 'todo' ? 'warn' : ''}`}>{stateOf(pickedLine).label}</span>
                    </div>
                  </div>
                  <div className="cl-dh">시트 칸 {lineSpec ? lineSpec.length : '…'}개</div>
                  <table className="cl-spec">
                    <tbody>
                      {(lineSpec || []).map((f) => (
                        <tr key={f.key}><th title={f.key}>{f.label}</th><td>{f.value}</td></tr>
                      ))}
                      {!lineSpec && <tr><td className="cl-note">불러오는 중…</td></tr>}
                    </tbody>
                  </table>
                </>
              )}

              {picked && mode === '보기' && (
                <>
                  <div className="cl-crumb">상세 — 손님에게 읽어 주는 자리</div>

                  {/**
                    * ★★**사진** — 손님 상세페이지와 같은 것을 쓴다(사장님 「우리 상세 페이지를 활용해 봐」).
                    *   눌러서 크게 본다 — 이 화면에서 «크게 뜨는 것»은 사진뿐이다.
                    */}
                  {car?.photo && (
                    <div className="cl-photo" onClick={() => setZoom(true)} title="누르면 크게">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={car.photo} alt={`${picked.plate} ${picked.name}`} />
                      <span className="cl-photo-z">누르면 크게</span>
                    </div>
                  )}

                  <div className="cl-pick">
                    <div className="cl-pick-t">{picked.plate}</div>
                    <div className="cl-pick-s">{picked.name} {picked.trim}</div>
                    <div className="cl-pick-r">
                      <span>{picked.year}년</span><span>{km(picked.km)}km</span>
                      <span>{picked.fuel}</span><span>{picked.cls}</span>
                      <span className={`cl-st ${tone(picked.status)}`}>{picked.status}</span>
                    </div>
                  </div>

                  <div className="cl-dh" style={{ padding: '8px 10px 4px' }}>기간별 요금 — 누르면 고릅니다</div>
                  <table className="cl-mini cl-fee">
                    <thead><tr><th>기간<i>개월</i></th><th>월 대여료<i>원</i></th><th>보증금<i>원</i></th></tr></thead>
                    <tbody>
                      {fees.map((t) => (
                        <tr key={t.term} className={f.term === t.term.split('_')[0] ? 'on' : ''}
                          onClick={() => useTerm(t.term, t.rent, t.deposit)}>
                          <td>{t.term.replace('_', ' · ')}</td>
                          <td>{won(t.rent)}</td>
                          <td>{won(t.deposit)}</td>
                        </tr>
                      ))}
                      {fees.length === 0 && <tr><td colSpan={3} className="cl-note">요금표가 없습니다</td></tr>}
                    </tbody>
                  </table>

                  {/**
                    * ★★**원자를 다 싣는다** — 사장님 「현재 있는 원자들 다 때려넣을 수 있어야 되지」.
                    *   담당자가 손님에게 답할 수 있는 것은 다 여기 있어야 한다 —
                    *   VIN·배터리·구동·내장색·옵션·최초등록일까지. 「그건 모르겠는데요」가 없게.
                    */}
                  <div className="cl-dh" style={{ padding: '10px 10px 4px' }}>제원 — 원자에 있는 그대로</div>
                  <table className="cl-spec">
                    <tbody>
                      {Object.entries(car?.spec || {}).map(([k, v]) => (
                        <tr key={k}><th>{SPEC_LABEL[k] || k}</th><td>{v}</td></tr>
                      ))}
                      {!car && <tr><td className="cl-note">불러오는 중…</td></tr>}
                    </tbody>
                  </table>

                </>
              )}

              {(mode === '접수' && (picked || direct)) && (
                <>
                  <div className="cl-crumb">접수</div>
                  <div className="cl-ipt">
                    {/**
                      * ★갈래가 «맨 위»에 선다 — 무슨 돈인지가 정해져야 아래 칸이 무슨 뜻인지 정해진다.
                      *   기본이 영업수수료라 대개는 손대지 않고 지나간다(사장님 「기본 세팅」).
                      */}
                    <div className="cl-fr"><label>접수 갈래</label>
                      <select value={f.intakeKind} onChange={(e) => set('intakeKind', e.target.value)}>
                        {KINDS.map((k) => <option key={k}>{k}</option>)}
                      </select></div>
                    {picked && (
                      <div className="cl-pick cl-pick-in">
                        <div className="cl-pick-t">{picked.plate}</div>
                        <div className="cl-pick-s">{picked.name} {picked.trim} · {f.term || picked.term}개월 · {won(Number(f.rent) || picked.rent)}</div>
                      </div>
                    )}
                    {/**
                      * ★★**접수 칸은 «늘 같다»** — 사장님 2026-09-10 「직접접수랑 차량 누르고 계약접수랑 동일해야지」.
                      *   차를 골라 들어왔으면 이 칸들이 «채워져» 있고, 직접 접수면 비어 있을 뿐이다.
                      *   ⚠ 앞서 차량 칸을 «직접 접수일 때만» 세웠더니, 차를 고른 사람은 공급사·상품이
                      *     틀려도 고칠 길이 없었다. 들어온 길이 달라도 하는 일은 같다.
                      *   ★지원금·업무지원비(갈래)일 때만 차량 칸을 접는다 — 그건 차가 «없는» 것이 정상이다.
                      */}
                    {!isAid && (
                      <>
                        <div className="cl-fr"><label className="cl-must">※ 차량번호</label>
                          <input value={f.plate} onChange={(e) => set('plate', e.target.value)} placeholder="00가0000"
                            className={S(f.plate) ? '' : 'cl-need'} /></div>
                        <div className="cl-fr"><label>모델명</label>
                          <input value={f.model} onChange={(e) => set('model', e.target.value)} /></div>
                        <div className="cl-fr"><label>공급사</label>
                          <input value={f.supplier} onChange={(e) => set('supplier', e.target.value)} list="cl-sup" /></div>
                        <div className="cl-fr"><label>상품 구분</label>
                          <select value={f.product} onChange={(e) => set('product', e.target.value)}>
                            <option value="">고르세요</option>
                            {PRODUCT_PICKS.map((p) => <option key={p}>{p}</option>)}
                            {/**
                              * ⚠★**목록에 없는 값이 와도 «지워지지 않게»** — 이게 없으면 담당자가 아무것도
                              *   안 건드려도 상품구분이 조용히 빈칸이 된다(실측 2026-09-10: 재고 「중고렌트」가
                              *   목록에 없어 그랬다). 모르는 값은 «있는 그대로» 한 칸 더 세운다.
                              */}
                            {S(f.product) && !PRODUCT_PICKS.includes(f.product) && <option>{f.product}</option>}
                          </select></div>
                      </>
                    )}

                    <div className="cl-fr">
                      <label className={isAid ? '' : 'cl-must'}>{isAid ? '무엇에' : '※ 영업채널'}</label>
                      {isAid
                        ? <input value={f.customer} onChange={(e) => set('customer', e.target.value)}
                            placeholder="사무실비 · 업무지원비" className={S(f.customer) ? '' : 'cl-need'} />
                        : <input id="cl-ch-in" value={f.channel} onChange={(e) => set('channel', e.target.value)}
                            list="cl-ch" className={S(f.channel) ? '' : 'cl-need'} />}
                    </div>
                    {!isAid && (
                      <div className="cl-fr"><label>고객명</label>
                        <input value={f.customer} onChange={(e) => set('customer', e.target.value)} placeholder="알면 적습니다"
                          onKeyDown={(e) => { if (e.key === 'Enter' && ready) void submit(); }} /></div>
                    )}
                    <div className="cl-fr"><label>영업자</label>
                      <input value={f.agent} onChange={(e) => set('agent', e.target.value)} list="cl-ag" placeholder="「이」만 쳐도"
                        onKeyDown={(e) => { if (e.key === 'Enter' && ready) void submit(); }} /></div>
                    <div className="cl-fr2">
                      <div><label>기간<i>개월</i></label><input value={f.term} onChange={(e) => set('term', e.target.value)} /></div>
                      <div><label>납입</label>
                        <select value={f.payKind} onChange={(e) => set('payKind', e.target.value)}>
                          {['일시납', '2회분납', '3회분납'].map((p) => <option key={p}>{p}</option>)}
                        </select></div>
                    </div>
                    {/**
                      * ★★**접수일 · 청구월은 «지금» 박는다** — 사장님 2026-09-10.
                      *   나중에 채우려면 목록을 다시 뒤져야 하고, 그러다 빠진 것이 「청구월 필요」로 쌓인다.
                      *   ⚠ 미리 적어도 «실적»으로는 인도완료를 켜야 넘어간다 — 달은 달이고 인도는 인도다.
                      */}
                    <div className="cl-fr2">
                      <div><label>접수일</label>
                        <input type="date" value={f.receivedAt} onChange={(e) => set('receivedAt', e.target.value)} /></div>
                      <div><label>청구월</label>
                        {/**
                          * ★★**청구예정월은 «규칙»이 채운다** — 2026-09-10 코덱스 P0.
                          *   비워 두면 `settlementMonthOf` 가 정한 달로 저장된다:
                          *     분납 = 접수일 + (회차−1) · 일시납 = 인도월 · 인도 전이면 접수월.
                          *   ⚠ 앞서 폰 콕핏은 «인도일이 없으면 청구월을 막았다» — 규칙과 정반대였다.
                          *   ★사람이 적으면 그 값이 이긴다(정본 주석: 「박힌 청구월이 이긴다」).
                          */}
                        <input type="month" value={f.billMonth} placeholder={예정월}
                          title={f.billMonth ? '적힌 값이 이깁니다' : `비워 두면 ${예정월} 로 들어갑니다`}
                          onChange={(e) => set('billMonth', e.target.value)} /></div>
                    </div>

                    {more && (
                      <>
                        <div className="cl-fr2">
                          <div><label>대여료</label><input value={f.rent} onChange={(e) => set('rent', e.target.value)} /></div>
                          <div><label>보증금</label><input value={f.deposit} onChange={(e) => set('deposit', e.target.value)} /></div>
                        </div>
                        <div className="cl-fr"><label>비고</label>
                          <input value={f.note} onChange={(e) => set('note', e.target.value)} /></div>
                      </>
                    )}
                    <button type="button" className="cl-more" onClick={() => setMore(!more)}>
                      {more ? '− 자세히 접기' : '+ 요금 · 비고'}
                    </button>

                    <div className="cl-note" style={{ margin: '7px 0 8px' }}>
                      청구월을 미리 적어 두면 «적힌 값»이 이깁니다 — 실적은 인도완료를 켤 때 넘어갑니다.
                    </div>
                  </div>
                </>
              )}
              </div>

              {/**
                * ★★**붙박이 실행바** — 무엇을 보고 있든 «지금 할 일»과 «되돌아가는 길»이 늘 같은 자리에 있다.
                *   ★되돌아가는 것은 왼쪽 «좁게», 하는 일은 오른쪽 «넓게» — 전자계약 하단독과 같은 결이다
                *     (CLAUDE.md: 비주요=고정폭 · 주요=나머지 전부). 손이 가는 자리가 화면마다 같아야 한다.
                */}
              <div className="cl-side-go">
                {!picked && !direct && mode !== '줄' && (
                  <button type="button" className="cl-btn cl-btn-p cl-go" onClick={() => openDirect('직접 접수')}>
                    직접 접수하기 — 차 없이도
                  </button>
                )}

                {mode === '줄' && pickedLine && (
                  <button type="button" className="cl-btn cl-go"
                    onClick={() => { setPickedLine(null); setLineSpec(null); setMode('보기'); }}>목록으로</button>
                )}

                {picked && mode === '보기' && (
                  <button type="button" className="cl-btn cl-btn-p cl-go" onClick={toIntake}>접수하기</button>
                )}

                {(mode === '접수' && (picked || direct)) && (
                  <>
                    <button type="button" className="cl-btn cl-prev"
                      onClick={() => { if (direct) { setDirect(''); setMode('보기'); } else setMode('보기'); }}>돌아가기</button>
                    <button type="button" className="cl-btn cl-btn-p cl-go" disabled={busy || !ready} onClick={() => void submit()}>
                      {busy ? '남기는 중…' : ready ? '접수' : isAid ? '무엇에 대한 것인지 적으세요' : !S(f.plate) ? '차량번호를 적으세요' : '영업채널을 적으세요'}
                    </button>
                  </>
                )}
              </div>
            </aside>
          </div>
        </>
      )}

      <div className="cl-status">
        <span>재고 {board.cars.length}대</span>
        <span>찾은 것 {hits.length}대</span>
        <span className="cl-sp" style={{ flex: 1 }} />
        <span>접수 목록 {board.intake.length}건{todo ? ` · 할 일 ${todo}건` : ''}</span>
      </div>

      {/** ★사진만 크게. 아무 데나 누르면 닫힌다 — 이 화면에서 «덮는 것»은 이것뿐이다. */}
      {zoom && car?.photo && (
        <div className="cl-zoom" onClick={() => setZoom(false)} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setZoom(false); }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={car.photo} alt={S(picked?.plate)} />
          <span className="cl-zoom-x">누르면 닫힘</span>
        </div>
      )}

      <datalist id="cl-sup">{board.suggest.suppliers.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="cl-ch">{board.suggest.channels.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="cl-ag">{board.suggest.agents.map((v) => <option key={v} value={v} />)}</datalist>
    </div>
  );
}
