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
import type { BoardApi, Board, Car, CarLite, Line } from './SettlementBoard';
import './classic.css';

const S = (v: unknown) => String(v ?? '').trim();
const won = (n: number) => Math.round(n || 0).toLocaleString('ko-KR');
/** 만원 단위 — 단위 글자는 «머리줄»이 말한다(값에 또 붙이면 칸만 좁아지고 자릿수가 안 맞는다). */
const man = (n: number) => (n ? Math.round(n / 10000).toLocaleString('ko-KR') : '');
/** 만km 단위 — 3.2 = 3만 2천 km. 단위는 머리줄이 말한다. */
const km = (n: number) => (n ? (n / 10000).toFixed(1) : '');

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

const pickList = (cars: CarLite[], key: 'fuel' | 'cls' | 'product' | 'supplier' | 'color') => {
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
  const [color, setColor] = useState('');
  const [perk, setPerk] = useState('');
  const [onlyOk, setOnlyOk] = useState(true);

  /** 고른 차 · 오른쪽 칸의 얼굴 — 보기 ↔ 접수. 자리는 그대로, 얼굴만 바뀐다. */
  const [picked, setPicked] = useState<CarLite | null>(null);
  const [car, setCar] = useState<Car | null>(null);
  const [mode, setMode] = useState<'보기' | '접수'>('보기');
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
  const [direct, setDirect] = useState<'' | typeof DIRECT[number]>('');
  /** 마지막에 쓴 채널·영업자 — 다음 접수에 그대로 들어온다. 타자가 하나로 준다. */
  const [last, setLast] = useState({ channel: '', agent: '' });
  const [busy, setBusy] = useState(false);
  const [justId, setJustId] = useState('');
  /** ★사진은 «눌러서 크게» — 사장님 2026-09-10 「사진만 예외로 누르면 크게 보이게 해 주자」. */
  const [zoom, setZoom] = useState(false);
  /** 먼저 누른 차의 늦은 응답이 지금 고른 차를 덮지 못하게 하는 요청 순번. */
  const carRequest = useRef(0);

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
  }, [board, q, fuel, cls, prod, sup, maxRent, maxDep, minYear, maxKm, color, perk, onlyOk]);

  /** 줄을 누르면 오른쪽에 상세가 뜬다. 요금표는 그때 따로 묻는다. */
  const pick = async (c: CarLite) => {
    const request = ++carRequest.current;
    setPicked(c); setCar(null); setMode('보기'); setDirect('');
    setF({ ...empty, plate: c.plate, model: [c.name, c.trim].filter(Boolean).join(' '), supplier: c.supplier, product: c.product });
    const got = await api.car(c.plate);
    if (request !== carRequest.current) return;
    if (got && sameSettlementCar(c.plate, got.plate)) setCar(got);
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
  /** ★필수는 «영업채널» 하나 — 차 정보는 재고에서 오고 고객명은 알면 적는다. */
  const ready = isAid ? !!S(f.customer) : (!!S(f.plate) && !!S(f.channel));

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.save({
        plate: S(f.plate), customer: S(f.customer), model: S(f.model), supplier: S(f.supplier),
        channel: S(f.channel), agent: S(f.agent), product: S(f.product), payKind: S(f.payKind),
        receivedAt: S(f.receivedAt), deliveredAt: S(f.deliveredAt), billMonth: S(f.billMonth),
        intakeKind: S(f.intakeKind) || '영업수수료',
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

  const flip = async (r: Line, key: 'paper' | 'delivered', on: boolean) => {
    if (!api.edit) { toast('미리보기라 바뀌지 않습니다'); return; }
    const patch = key === 'delivered' ? deliveryTransitionPatch(on, r, today) : { paper: on };
    const res = await api.edit(r.id, patch);
    if (!res.ok) { toast(res.error || '못 바꿨습니다'); return; }
    await load();
  };

  if (!api.ready) return null;
  if (!board) return <div className="cl"><div className="cl-menubar"><span className="cl-logo">FREEPASS ERP</span></div></div>;

  const todo = board.intake.filter((r) => stateOf(r).key === 'todo').length;
  const fuels = pickList(board.cars, 'fuel');
  const clss = pickList(board.cars, 'cls');
  const prods = pickList(board.cars, 'product');
  const sups = pickList(board.cars, 'supplier');
  /** ★연식·색상·우대는 «있는 것만» 세운다 — 0건짜리를 고르게 두면 빈 목록이 나온다. */
  const years = [...new Set(board.cars.map((c) => Number(c.year)).filter((y) => y > 2000))].sort((a, b) => b - a);
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
        {(['접수', '실적', '청구'] as const).map((t) => (
          <span key={t} className={`cl-menu${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>{t}</span>
        ))}
        {preview && <span className="cl-menu" style={{ color: '#ffd28a' }}>미리보기 — 지어낸 값</span>}
        <span className="cl-user">
          재고 {board.cars.length}대 · 접수대기 {board.intake.length}건{todo ? ` · 할 일 ${todo}` : ''}
        </span>
      </div>

      {tab !== '접수' ? (
        <div className="cl-body">
          <main className="cl-main">
            <div className="cl-grid">
              <div className="cl-crumb">{tab}</div>
              <div className="cl-note" style={{ padding: 16 }}>
                «{tab}» 은 아직 안 만들었습니다 — 접수부터 끝내고 옵니다(설계서 §7).
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
              <select value={fuel} onChange={(e) => setFuel(e.target.value)}>
                <option value="">연료 전체</option>
                {fuels.map((x) => <option key={x.v} value={x.v}>{x.v} ({x.n})</option>)}
              </select>
              <select value={cls} onChange={(e) => setCls(e.target.value)}>
                <option value="">차급 전체</option>
                {clss.map((x) => <option key={x.v} value={x.v}>{x.v} ({x.n})</option>)}
              </select>
              <select value={prod} onChange={(e) => setProd(e.target.value)}>
                <option value="">상품 전체</option>
                {prods.map((x) => <option key={x.v} value={x.v}>{x.v} ({x.n})</option>)}
              </select>
              <select value={sup} onChange={(e) => setSup(e.target.value)}>
                <option value="">공급사 전체</option>
                {sups.map((x) => <option key={x.v} value={x.v}>{x.v} ({x.n})</option>)}
              </select>
              {/**
                * ★★**많이 찾는 것은 «사다리»로** — 사장님 2026-09-10
                *   「차종구분 대여료 보증금 연식 주행거리 색상 우대(무보증·21세·경력무관) …
                *    이런 식으로 많이 찾는 거 드랍다운으로 빠르게 찾을 수 있게끔」
                *   ⚠ 앞서 대여료를 «손으로 치는 칸»으로 뒀다. 전화하며 0 을 하나 더 치거나 덜 치면
                *     엉뚱한 목록을 손님에게 읽어 주게 된다. 사다리는 그 실수를 원천에서 없앤다.
                *   ★끊는 자리는 «손님이 묻는 단위»다 — 「50만 이하 있어요?」 「2만km 안 넘는 거로」
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
              <select value={color} onChange={(e) => setColor(e.target.value)}>
                <option value="">색상 전체</option>
                {colors.map((x) => <option key={x.v} value={x.v}>{x.v} ({x.n})</option>)}
              </select>
              <select value={perk} onChange={(e) => setPerk(e.target.value)}>
                <option value="">우대 전체</option>
                {perkList.map((x) => <option key={x.v} value={x.v}>{x.v} ({x.n})</option>)}
              </select>
              <label className="cl-chk">
                <input type="checkbox" checked={onlyOk} onChange={(e) => setOnlyOk(e.target.checked)} /> 출고가능만
              </label>
              <button type="button" className="cl-btn"
                onClick={() => { setQ(''); setFuel(''); setCls(''); setProd(''); setSup(''); setMaxRent(''); setMaxDep(''); setMinYear(''); setMaxKm(''); setColor(''); setPerk(''); setOnlyOk(true); }}>조건 지우기</button>
              {DIRECT.map((k) => (
                <button key={k} type="button" className={`cl-btn${direct === k ? ' cl-btn-p' : ''}`} onClick={() => openDirect(k)}>{k}</button>
              ))}
              <span className="cl-sp" />
              <span className="cl-note">{board.cars.length} → <b>{hits.length}대</b></span>
            </div>
          </div>

          <div className="cl-body">
            {/* ── 왼쪽 — 위 상품 목록, 아래 접수 목록 ───────────── */}
            <main className="cl-main">
              <div className="cl-grid cl-cars">
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

              <div className="cl-grid cl-wait">
                <div className="cl-crumb">
                  접수 목록 {board.intake.length}건
                  {todo > 0 && <span className="cl-st warn"> · ★청구월 박아야 할 것 {todo}건</span>}
                </div>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 94 }}>차량번호</th>
                      <th style={{ width: 80 }}>고객</th>
                      <th style={{ width: 134 }}>차종</th>
                      <th style={{ width: 100 }}>공급사</th>
                      <th style={{ width: 88 }}>영업채널</th>
                      <th className="cl-num" style={{ width: 84 }}>접수일</th>
                      <th className="cl-num" style={{ width: 66 }}>청구월</th>
                      <th className="cl-mid" style={{ width: 50 }}>계약서</th>
                      <th className="cl-mid" style={{ width: 60 }}>인도완료</th>
                      <th style={{ width: 88 }}>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.intake.map((r) => {
                      const st = stateOf(r);
                      return (
                        <tr key={r.id} className={`cl-row-${st.key}${r.id === justId ? ' on' : ''}`}>
                          <td><b>{r.plate || '(차번없음)'}</b></td>
                          <td>{r.customer}</td>
                          <td>{r.model}</td>
                          <td>{r.supplier}</td>
                          <td>{r.channel}</td>
                          <td className="cl-num">{r.receivedAt}</td>
                          {/** 아직 안 박힌 달은 «칸을 비우지» 않는다 — 빈 칸은 「없다」인지 「모른다」인지 말하지 않는다. */}
                          <td className={`cl-num${S(r.billMonth) ? '' : ' cl-st warn'}`}>{S(r.billMonth) || '—'}</td>
                          <td className="cl-mid">
                            <input type="checkbox" checked={!!r.paper} onChange={(e) => void flip(r, 'paper', e.target.checked)} />
                          </td>
                          <td className="cl-mid">
                            <input type="checkbox" checked={!!r.delivered} onChange={(e) => void flip(r, 'delivered', e.target.checked)} />
                          </td>
                          <td className={`cl-st ${st.key === 'todo' ? 'warn' : st.key === 'gone' ? 'ok' : ''}`}>{st.label}</td>
                        </tr>
                      );
                    })}
                    {board.intake.length === 0 && (
                      <tr><td colSpan={10} className="cl-note">접수된 줄이 없습니다</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </main>

            {/* ── 오른쪽 — 상세 ↔ 접수. 자리는 그대로, 얼굴만 바뀐다 ── */}
            <aside className="cl-side">
              {!picked && !direct && (
                <>
                  <div className="cl-tree-head">상세</div>
                  <div className="cl-empty-note">
                    왼쪽 목록에서 차를 고르면<br />조건과 기간별 요금이 여기 뜹니다.
                    <br /><br />재고에 없는 차도 접수합니다 — 아래 단추로 차량번호부터 손으로 적으세요.
                  </div>
                  {/**
                    * ★**차가 없어도 접수한다** — 사장님 2026-09-10.
                    *   조건 줄 구석의 «＋» 하나로는 못 찾는다. 빈 상세 자리는 어차피 놀고 있으니 여기 세운다.
                    */}
                  <div className="cl-side-go">
                    <button type="button" className="cl-btn cl-btn-p cl-go" onClick={() => openDirect('직접 접수')}>
                      직접 접수하기 — 차 없이도
                    </button>
                  </div>
                </>
              )}

              {picked && mode === '보기' && (
                <>
                  <div className="cl-tree-head">상세 — 손님에게 읽어 주는 자리</div>

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

                  <div className="cl-side-go">
                    <button type="button" className="cl-btn cl-btn-p cl-go" onClick={toIntake}>접수하기</button>
                  </div>
                </>
              )}

              {(mode === '접수' && (picked || direct)) && (
                <>
                  <div className="cl-tree-head">
                    접수
                    <button type="button" className="cl-btn cl-back"
                      onClick={() => { if (direct) { setDirect(''); setMode('보기'); } else setMode('보기'); }}>
                      ← 상세로
                    </button>
                  </div>
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
                      <div className="cl-pick" style={{ margin: '-8px -10px 8px' }}>
                        <div className="cl-pick-t">{picked.plate}</div>
                        <div className="cl-pick-s">{picked.name} {picked.trim} · {f.term || picked.term}개월 · {won(Number(f.rent) || picked.rent)}</div>
                      </div>
                    )}
                    {direct === '직접 접수' && (
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
                            {['선출고', '선발주', '신차발주', '매칭출고', '장기렌트', '구독', '오플구독', '오공구독'].map((p) => <option key={p}>{p}</option>)}
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
                        <input type="month" value={f.billMonth} onChange={(e) => set('billMonth', e.target.value)} /></div>
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
                    <button type="button" className="cl-btn cl-btn-p cl-go" disabled={busy || !ready} onClick={() => void submit()}>
                      {busy ? '남기는 중…' : ready ? '접수' : isAid ? '무엇에 대한 것인지 적으세요' : !S(f.plate) ? '차량번호를 적으세요' : '영업채널을 적으세요'}
                    </button>
                  </div>
                </>
              )}
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
