'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link2 } from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { acquisitionPriceList, agentContractRows, agentPanelRows, cheapest, priceList, vehicleName, type Audience } from '@/lib/domain/product';
import { actor, getRole } from '@/lib/domain/deal';
import { guestShareUrl } from '@/lib/domain/product-share';
import { useProductPhotoState } from '@/components/use-product-photos';
import { CustomerPreviewButton } from '@/components/CustomerPreviewModal';
import { sectionIcon } from '@/components/section-icons';
import { copyText } from '@/lib/clipboard';
import { toast } from '@/components/Toaster';
import { useIsMobile } from '@/lib/use-mobile';
import { won, Btn, C, R, PILL_R, NUM, FW, FS, ICON, DetailTable, DT, R_CARD } from '@/components/ui';

/**
 * **상품상세 우측 영업자 패널**(사장님 2026-08-20 목업 「이렇게 상품상세 우측에 들어가는거잖아」).
 *
 * ★이 칼럼은 **영업자가 보는 것만** 둔다(사장님 「영업자가 보는거 위주로 가자」).
 *   계약진행·대화·문의는 여기서 뺐다 — 상담 문의는 아직 운영하지 않는다(사장님 2026-08-20).
 *   지금 여기서 할 수 있는 일은 둘뿐이다: **링크 공유 · 손님 화면 보기**.
 *
 * 구성
 *   ① 대여료 — 기간·월대여료·보증금 **전 기간 목록**(본문을 스크롤해 올라가지 않게)
 *   ② 영업 정보 — 심사·보증금 분납·카드결제·위약금·주행초과·승계(`agentPanelRows`)
 *   ③ 손님 전달 — 링크 복사·텍스트 복사(보내는 것)
 *   ④ 손님 화면 보기(내가 «확인»하는 것) — 손님에게 «보내는» 버튼과 모양을 달리 세운다
 *
 * ★**반전(남색) 머리띠 = 이 패널의 문법**(사장님 「반전 표로 잘 꾸며봐」).
 *   상세 본문 표는 회색 머리띠(`DT.band`), 패널 표는 반전 머리띠 — 색 하나로 «본문이냐 패널이냐»가 갈린다.
 *
 * ★손님 화면(`/q`)에는 이 패널이 **붙지 않는다.** 「모드 토글」로 가리지 않는 이유는,
 *   손님과 화면을 같이 보다가 잘못 눌러 공급사·원가가 새기 때문이다. 붙이지 않으면 샐 수가 없다.
 *
 * ★전달 버튼은 **대여료가 없어도 보인다.** 예전엔 하단독에서 `offerable` 로 묶여 있어
 *   요금 미입력 매물에서는 링크·텍스트 버튼이 통째로 사라졌다(사장님 「전혀 구현이 안되고 있는데」).
 *   요금이 없으면 보낼 값이 없다고 **아래가 말해 준다** — 버튼을 지우면 기능이 없는 줄 안다.
 */

/** 우측 칼럼이 서는 최소 폭. 이보다 좁으면 본문 아래로 쌓는다. */
export const AGENT_COL_BP = 1200;
/** 칼럼 폭 · 본문과의 간격 — 페이지가 flex gap 을 맞추려면 알아야 한다. */
const AGENT_COL_W = 380;
export const AGENT_COL_GAP = 16;
/** 위아래 같은 숨 간격 — 위는 곧 «상단에 부딪혔을 때 멈추는 자리»다. */
const CHROME_GAP = 14;

/** 지금 우측 칼럼이 실제로 서는가 — 페이지가 본문 하단 여백을 정할 때 쓴다. */
export function useAgentColumn(): boolean {
  return !useIsMobile(AGENT_COL_BP);
}

/** 남색 면 위의 선·글자 — 반전면에서는 C.line·C.mute 가 안 보인다(어두운 바탕에 어두운 선). */
const INV = {
  line: 'color-mix(in srgb, var(--text-inverse) 24%, transparent)',
  soft: 'color-mix(in srgb, var(--text-inverse) 12%, transparent)',
  dim: 'color-mix(in srgb, var(--text-inverse) 70%, transparent)',
};

/**
 * 손님에게 **보내는** 두 버튼 — 좌우 2열.
 * 우측 칼럼에서는 이 줄이 패널 아래에 **고정**돼 스크롤과 무관하게 늘 보인다
 * (사장님 2026-08-20 「링크랑 텍스트 복사는 고정해서 밑에서 보이게 · 버튼도 좌우로」).
 * 「손님 전달」 같은 이름표는 붙이지 않는다 — 버튼 글자가 이미 무슨 일인지 말한다.
 */
/**
 * 손님에게 보내기 = **링크 공유하기 «하나»**.
 *
 * 사장님 2026-08-22 「텍스트복사 빼자, 링크 공유하기 버튼만 · 바로 공유할 수 있게끔 · 웹도 링크 공유로」 —
 * 2026-08-30 재확인 「텍스트 복사는 빼고 링크 공유하기만 넣을 거야」.
 *
 *   누르면 곧장 OS 공유시트(카톡·문자)가 뜬다. 공유시트가 없는 브라우저에서만 링크를 복사한다.
 *
 * ★버튼을 둘로 나누면 «무엇을 보내는지»를 매번 고르게 된다 — 보내는 것은 항상 이 매물 링크 하나다.
 *   차명·대여료를 «글»로 붙여넣는 길은 없어지지 않았다: 목록 우클릭·더보기 메뉴(ProductMoreMenu ·
 *   features/finder/product-context)에 그대로 있다. 손님에게 보내는 자리에서만 뺀 것이다.
 */
export function ProductAgentShareActions({ p }: { p: EntityRecord }) {
  const role = getRole();
  const sendLink = async () => {
    const a = actor(role);
    const url = guestShareUrl(p, a.code || a.uid);
    if (navigator.share) { navigator.share({ title: vehicleName(p), url }).catch(() => {}); return; }
    if (await copyText(url)) toast('손님용 매물 링크 복사됨', 'ok');
    else prompt('링크', url);
  };
  return (
    <Btn full title="손님에게 이 매물 링크를 보냅니다" onClick={sendLink}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <Link2 size={ICON.md} aria-hidden />링크 공유하기
      </span>
    </Btn>
  );
}

export function ProductAgentPanel({ p, audience, pinnedShare }: {
  p: EntityRecord;
  audience?: Audience;
  /** 공유 두 버튼을 칼럼이 아래에 고정해 따로 그린다 — 본문에서는 빼서 같은 버튼이 두 번 서지 않게. */
  pinnedShare?: boolean;
}) {
  const role = getRole();
  const aud: Audience = audience || (role === 'admin' ? 'admin' : 'agent');
  const rows = agentPanelRows(p, aud);
  const contractRows = agentContractRows(p, aud);
  const { photos } = useProductPhotoState(p);
  const prices = priceList(p);
  const acquisition = acquisitionPriceList(p);
  const cheap = cheapest(p);
  const plate = String(p.car_number || '').trim();
  /** 우측 칼럼이 없으면 본문 「기간별 대여료」와 같은 표가 바로 위에 있다. 그때는 패널 대여료표를 두지 않는다. */
  const sideCol = useAgentColumn();

  /* 반전 표 칸 규격 — 본문 표(DT)와 같은 리듬, 색만 반전. */
  /**
   * **구조 띠**(열이름 줄 · 「인수형」 갈래 줄) — 진한 남색.
   * 선택된 행(최저)과 같은 옅은 틴트를 쓰면 «고른 줄»인지 «구역 나눔»인지 구분이 안 됐다
   * (사장님 2026-08-20 「섹션 나누는거랑 최저가 선택돼서 배경 있는거랑 구분좀」).
   *   구조 = 진하게(brandDeep) · 선택 = 옅게(INV.soft) + 왼쪽 굵은 바.
   */
  const invTh: CSSProperties = {
    padding: '5px 10px', textAlign: 'left', fontSize: FS.cap, fontWeight: FW.strong,
    color: INV.dim, background: C.brandDeep, whiteSpace: 'nowrap',
  };
  const invThR: CSSProperties = { ...invTh, textAlign: 'right' };
  const invLabel: CSSProperties = {
    padding: '6px 10px', textAlign: 'left', fontWeight: FW.strong, fontSize: FS.body,
    color: C.inverse, whiteSpace: 'nowrap',
  };
  const invTd: CSSProperties = {
    padding: '6px 10px', textAlign: 'right', color: C.inverse,
    fontFamily: NUM, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
  };
  const invTr = (i: number, on = false): CSSProperties => ({
    borderTop: i ? `1px solid ${INV.line}` : 'none',
    background: on ? INV.soft : 'transparent',
  });
  /** 선택된 행 표시 = 왼쪽 굵은 바. 바탕만으로는 구조 띠와 헷갈린다. */
  const pickBar = (on: boolean): CSSProperties => (on ? { boxShadow: `inset 3px 0 0 ${C.inverse}` } : {});

  const priceRow = (kind: string, m: number, rent: number, deposit: number, i: number, best: boolean) => (
    <tr key={`${kind}:${m}`} style={invTr(i, best)}>
      <th scope="row" style={{ ...invLabel, ...pickBar(best) }}>
        {m}개월
        {best ? <span style={{ marginLeft: 5, fontSize: FS.micro, fontWeight: FW.label, color: INV.dim }}>최저</span> : null}
      </th>
      <td style={{ ...invTd, fontWeight: FW.head, fontSize: FS.title }}>{won(rent)}</td>
      <td style={invTd}>{deposit > 0 ? won(deposit) : '무보증'}</td>
    </tr>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/*
        ⓪ 패널 머리 — **이 칼럼이 무엇인지 맨 위에서 말한다**(사장님 2026-08-20 「영업자 전용 패널이라고 왜 상단에 안해주냐고」).
           **좌측 4px 네이비 바** = 「영업자 것」의 표식. 아래 섹션 표들(DetailTable tone='agent')과 같은 문법이라
           패널 안에서 색축이 하나로 선다. 앰버는 「주의·수기입력」 뜻으로 돌려보냈다.
           손님 화면엔 이 칼럼이 통째로 안 붙으므로, 그 사실은 칸마다가 아니라 **여기 한 번**만 적는다.
      */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        border: `1px solid ${C.line}`, borderLeft: `4px solid ${C.brand}`, background: C.taupeBg,
        borderRadius: R_CARD, padding: '6px 10px',
      }}>
        <span style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.ink }}>
          영업자 전용 패널
        </span>
        <span style={{
          flex: '0 0 auto', fontSize: FS.micro, fontWeight: FW.label, color: C.mute,
          border: `1px solid ${C.line}`, borderRadius: PILL_R, padding: '0 6px', lineHeight: 1.6,
        }}>손님 화면엔 없음</span>
      </div>

      {/* ① 대여료 — 전 기간 목록(반전). 패널이 늘 떠 있으니 본문 위로 올라가지 않아도 «얼마»가 보인다.
          모바일·좁은 화면은 본문 표와 중복이라 뺀다(사장님 2026-08-22). */}
      {sideCol ? (
      <div style={{ background: C.brand, color: C.inverse, borderRadius: R, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '9px 10px' }}>
          <span style={{ fontSize: FS.body, fontWeight: FW.title, minWidth: 0, overflowWrap: 'anywhere' }}>{vehicleName(p)}</span>
          {plate ? (
            <span style={{
              flex: '0 0 auto', fontFamily: NUM, fontSize: FS.cap, fontWeight: FW.strong,
              border: `1px solid ${INV.line}`, background: INV.soft, borderRadius: R, padding: '1px 6px',
            }}>{plate}</span>
          ) : null}
        </div>
        {prices.length || acquisition.length ? (
          <table aria-label="기간별 대여료와 보증금" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: FS.body }}>
            <colgroup><col style={{ width: '34%' }} /><col style={{ width: '34%' }} /><col style={{ width: '32%' }} /></colgroup>
            <thead>
              <tr>
                <th scope="col" style={invTh}>기간</th>
                <th scope="col" style={invThR}>월대여료</th>
                <th scope="col" style={invThR}>보증금</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((x, i) => priceRow('반납', x.m, x.rent, x.deposit, i, !!cheap && x.m === cheap.m))}
              {acquisition.length ? (
                <>
                  {/* 인수형은 «같은 기간의 다른 상품» — 표를 쪼개지 않고 갈래 줄 하나로 나눈다(본문 표와 같은 규칙). */}
                  <tr>
                    <th scope="colgroup" colSpan={3} style={{ ...invTh, borderTop: `2px solid ${C.inverse}` }}>
                      인수형 · 만기 인수
                    </th>
                  </tr>
                  {acquisition.map((x, i) => priceRow('인수', x.m, x.rent, x.deposit, i, false))}
                </>
              ) : null}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '0 10px 10px', fontSize: FS.cap, color: INV.dim }}>
            대여료 미입력 — 손님 안내 전에 요금을 넣어야 합니다.
          </div>
        )}
      </div>
      ) : null}

      {/* ② 영업 정보 — 웹 우측 칼럼은 반전 남색(원래 패널 문법). 좁은 화면만 본문과 같은 회색. */}
      <DetailTable
        title="영업 정보"
        hint="상담용"
        icon={sectionIcon('영업 정보')}
        tone={sideCol ? 'agent' : 'main'}
        headTone={sideCol ? 'invert' : 'plain'}
        span={2}
        widths={['44%', undefined]}
        label="영업자 상담용 정보"
      >
        {rows.map(([k, v], i) => (
          <tr key={k} style={DT.tr(i)}>
            <th scope="row" style={{ ...DT.labelTh, width: undefined }}>{k}</th>
            <td style={DT.td}>{v || <span style={{ color: C.faint }}>—</span>}</td>
          </tr>
        ))}
      </DetailTable>

      {/*
        ②-2 계약 조건 — 성격이 달라 표를 나눈다. 상담용은 «이 손님이 되나·얼마 드나»,
            이쪽은 «계약하면 어떻게 되나»다. 정책이 55열이라 한 표에 몰면 상담 중 위 여섯 줄을 못 찾는다.
      */}
      {contractRows.length ? (
        <DetailTable
          title="계약 조건"
          hint="계약 단계"
          icon={sectionIcon('계약 조건')}
          tone={sideCol ? 'agent' : 'main'}
          headTone={sideCol ? 'invert' : 'plain'}
          span={2}
          widths={['44%', undefined]}
          label="계약 단계 정책"
        >
          {contractRows.map(([k, v], i) => (
            <tr key={k} style={DT.tr(i)}>
              <th scope="row" style={{ ...DT.labelTh, width: undefined }}>{k}</th>
              <td style={DT.td}>{v || <span style={{ color: C.faint }}>—</span>}</td>
            </tr>
          ))}
        </DetailTable>
      ) : null}

      {/* ③ 내가 하는 일 — 손님 화면 «확인» 하나. 파일 받기는 걷었다(사장님 2026-08-30) —
          사진은 링크로 보내지 파일로 주고받지 않는다. */}
      <CustomerPreviewButton p={p} full />
      {/* 좁은 화면 = 고정할 칼럼이 없다 → 공유 버튼도 흐름 끝에 그대로 선다. */}
      {!pinnedShare ? <ProductAgentShareActions p={p} /> : null}
    </div>
  );
}

/**
 * 넓은 화면의 **우측 고정 칼럼** — 본문이 스크롤돼도 패널은 안 움직인다.
 * 플로우에는 폭만 잡는 spacer 를 두어 본문이 칼럼 밑으로 파고들지 않게 한다.
 * 패널이 뷰포트보다 길면 **칼럼이 스스로 스크롤**한다(예전엔 넘치는 만큼 그냥 잘렸다).
 */
export function ProductAgentColumn({ p, audience }: { p: EntityRecord; audience?: Audience }) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const code = String(p.product_code || p._key || '');

  // spacer 의 left → fixed 칼럼이 같은 세로선에 선다(창 리사이즈·스크롤바 대응).
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const measure = () => {
      const r = slot.getBoundingClientRect();
      const next = { left: Math.round(r.left), width: Math.round(r.width) };
      setBox((cur) => (cur?.left === next.left && cur.width === next.width ? cur : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(slot);
    ro.observe(document.documentElement);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [code]);

  return (
    <>
      <div ref={slotRef} aria-hidden style={{ flex: `0 0 ${AGENT_COL_W}px`, width: AGENT_COL_W, alignSelf: 'stretch', pointerEvents: 'none' }} />
      <aside
        aria-label="영업자 패널"
        style={{
          position: 'fixed',
          // 사진 윗선에 맞추지 않는다 — 사진 크기에 따라 시작 높이가 달라지면 패널이 매번 다른 자리에 선다.
          top: `calc(var(--topbar-h) + ${CHROME_GAP}px)`,
          // 바닥은 **하단바와 같은 선**(사장님 2026-08-20 「하단에 박아달라는 거였어 하단바처럼」).
          //  독 위로 띄우면 공유 줄만 붕 떠서 «독의 일부»로 안 읽힌다.
          bottom: 0,
          left: box ? box.left : undefined,
          width: box ? box.width : AGENT_COL_W,
          // 측정 전엔 숨긴다 — 한 프레임 점프 방지
          visibility: box ? 'visible' : 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          // 칼럼 자신은 안 굴린다 — 굴리는 건 «본문»뿐이고, 공유 줄은 바닥에 남아야 한다.
          overflow: 'hidden',
          zIndex: 40,
          boxSizing: 'border-box',
          pointerEvents: 'auto',
        }}
      >
        {/* 굴러가는 쪽 */}
        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          <ProductAgentPanel p={p} audience={audience} pinnedShare />
        </div>
        {/*
          바닥 고정 — 링크·텍스트 복사는 **스크롤 위치와 상관없이 늘 손에 닿아야 한다**
          (사장님 2026-08-20). 겹치는 게 아니라 형제로 두었으니 본문이 밑으로 파고들지 않는다.
        */}
        {/*
          바닥 고정 줄 — **하단바(BottomNav)와 같은 규격**으로 맞춘다.
          같은 세로 패딩(`--fp-bar-pad-y`)을 써야 버튼 중심이 옆 「이전·검수 요청」과 한 선에 선다.
          숫자를 손으로 찍으면 바 높이가 바뀔 때 이 줄만 어긋난다.
        */}
        <div style={{
          flex: '0 0 auto',
          background: C.bg,
          padding: 'var(--fp-bar-pad-y) 0',
          paddingBottom: 'calc(var(--fp-bar-pad-y) + var(--fp-dock-safe, 0px))',
        }}>
          <ProductAgentShareActions p={p} />
        </div>
      </aside>
    </>
  );
}
