'use client';
import React from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import { ChevronDown } from 'lucide-react';
import { C, R, R_CARD, NUM, ctrlH, ctrlInputFs, FW, FS, SH, KV_LABEL_W } from './tokens';
import { useIsMobile } from '@/lib/use-mobile';

/* 상세 — 섹션/그리드/행 */
export function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: FS.cap, fontWeight: FW.strong, color: C.mute, marginBottom: 6 }}>{title}</h2>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', background: C.taupeBg }}>{children}</div>
    </div>
  );
}
export function DetailGrid({ rows }: { rows: [string, unknown][] }) {
  return (
    <div>
      {rows.map(([k, val], i) => {
        const filled = val != null && val !== '';
        const node = (typeof val === 'object' ? val : filled ? String(val) : '—') as React.ReactNode;
        return (
          <div key={i} style={{ display: 'flex', padding: '6px 12px', fontSize: FS.body, borderTop: i ? `1px solid ${C.line2}` : 'none' }}>
            <span style={{ width: KV_LABEL_W, color: C.mute, flex: `0 0 ${KV_LABEL_W}px` }}>{k}</span>
            <span style={{ color: filled ? C.ink : C.faint, fontVariantNumeric: 'tabular-nums' }}>{node}</span>
          </div>
        );
      })}
    </div>
  );
}
export function DetailEmpty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 14, fontSize: FS.body, color: C.faint }}>{children}</div>;
}

/** 집계·요약 행(메인+서브+우측) — 그룹리스트 DetailRow(label/value)와 별개. */
export function MetricRow({ main, sub, right, rightColor = C.mute }: { main: React.ReactNode; sub: React.ReactNode; right?: React.ReactNode; rightColor?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderTop: `1px solid ${C.line2}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: FS.body, fontWeight: FW.strong }}>{main}</div>
        <div style={{ fontSize: FS.cap, color: C.faint }}>{sub}</div>
      </div>
      {right != null && <div style={{ fontSize: FS.body, fontWeight: FW.strong, color: rightColor, fontVariantNumeric: 'tabular-nums' }}>{right}</div>}
    </div>
  );
}
/* 섹션 소제목(테두리 없음) — 상세·폼 내부. Section(박스형)과 별개. 손롤 secTitle 금지. */
export function SectionLabel({ children, mt = 2, mb = 5 }: { children: React.ReactNode; mt?: number; mb?: number }) {
  return <div style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.ink, margin: `${mt}px 0 ${mb}px` }}>{children}</div>;
}

/** 표가 아닌 블록(드롭존·칩 묶음)용 카드. 라벨|값 섹션은 FormGrid/FormReadList → DetailTable.
 *  모서리는 상세 표와 같게 R_CARD. */
export function FormCard({ title, hint, children }: { title?: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      {title != null && title !== '' ? <SectionLabel mt={0}>{title}</SectionLabel> : null}
      {hint ? <div style={{ fontSize: FS.cap, color: C.faint, margin: title != null ? '-2px 0 8px' : '0 0 8px', lineHeight: 1.4 }}>{hint}</div> : null}
      <div style={{ border: `1px solid ${C.line}`, borderRadius: R_CARD, background: C.taupeBg, padding: '10px 12px' }}>
        {children}
      </div>
    </div>
  );
}
/**
 * ── 상세 표 규격(2026-08-20) ─────────────────────────────────────────
 * **상세의 모든 섹션이 같은 표 문법을 쓴다.**
 *
 * ★왜(사장님 「맹하다 · 표로 할 건 표로 명확하게」): 예전엔 대여료·보험만 진짜 표였고
 *   차량스펙·계약조건·기타사항은 «라벨 위 / 값 아래» 격자였다. 한 화면에 문법 두 개가 섞여
 *   «어디가 항목이고 어디가 값인지»를 스크롤할 때마다 눈이 다시 잡아야 했다.
 *
 * 규격 = 머리띠(섹션 이름) → [열이름 줄(값 칸이 여러 개인 표만)] → 항목칸 │ 값칸.
 *   · 제목을 표 머리띠 안에 넣는다 — 카드 위 제목 + 표 머리 = 머리가 둘이라 더 산만했다.
 *   · 값은 줄바꿈된다(옵션·특이사항이 길다). 데이터그리드(table.tsx `tdX`)의 nowrap 과 다르다.
 *   · 얼룩(zebra) 없음 — 줄이 5~8개라 오히려 시끄럽다. 구분은 가는 실선 하나로 충분하다.
 */
export const DT = {
  table: {
    width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: FS.body,
  } as React.CSSProperties,
  /** 섹션 이름을 인 머리띠 — 부가 섹션은 이 회색 띠로 시작한다(카드가 달라도 시작선이 같다). */
  band: {
    /* C.head는 흰 카드와 붙어 띠가 사라졌고, --border도 폰에서는 「아직 배경이랑 거의 동일」
       (사장님 2026-08-22 두 번 지적) — 한 단계 더 올려 --border-strong. 무채 유지, 글자는 C.ink 그대로. */
    padding: '7px 10px', textAlign: 'left', background: 'var(--border-strong)',
    /* 밑줄 없음(2026-08-21 사장님 「굳이 라인 없어도 되는 곳에 라인」) — 띠 배경이 이미 경계다. */
    fontWeight: FW.body,
  } as React.CSSProperties,
  /** 중요 섹션 타이틀 — 반전 남색. 페이지가 C.brand 면을 손그리지 말고 이걸 쓴다. */
  bandInvert: {
    padding: '7px 10px', textAlign: 'left' as const, background: C.brand, color: C.inverse,
    fontWeight: FW.body,
  } as React.CSSProperties,
  /** 값 칸이 여러 개인 표만 쓰는 열이름 줄(기간·월대여료·보증금 / 보장한도·면책금). */
  colTh: {
    padding: '5px 10px', textAlign: 'left', fontSize: FS.cap, color: C.mute,
    fontWeight: FW.strong, borderBottom: `1px solid ${C.line2}`, whiteSpace: 'nowrap',
  } as React.CSSProperties,
  /** 항목(라벨) 칸 — 폭이 모든 섹션에서 같아 섹션이 달라도 값 시작선이 맞는다. */
  /**
   * 항목(라벨) 칸.
   *
   * ⚠ **면도 선도 넣지 않는다.** 배경 틴트와 세로 실선을 차례로 넣어 봤다가 둘 다 되돌렸다
   *   (2026-08-20): 2열 표에서 라벨 칸이 네 군데라 면은 바둑판처럼 답답해지고, 선은 격자를 더한다.
   *   가르는 일은 이미 «글자색(보조색 vs 먹색)»과 «폭 고정 116px»이 하고 있다 — 그걸로 충분하다.
   * ⚠ 이 스타일은 보험표·대여료표·영업자 패널이 다 같이 쓴다. 한 곳을 칠하면 엉뚱한 표까지 물든다.
   */
  labelTh: {
    width: KV_LABEL_W, padding: '7px 10px', textAlign: 'left', verticalAlign: 'top',
    color: C.mute, fontWeight: FW.strong, fontSize: FS.body, overflowWrap: 'anywhere',
  } as React.CSSProperties,
  td: {
    padding: '7px 10px', verticalAlign: 'top', lineHeight: 1.5, overflowWrap: 'anywhere',
  } as React.CSSProperties,
  tdR: {
    padding: '7px 10px', verticalAlign: 'top', textAlign: 'right',
    fontFamily: NUM, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
  } as React.CSSProperties,
  /** 표 안에서 갈래를 가르는 줄(반납형 → 인수형). 표를 둘로 쪼개는 대신 이 줄 하나로 나눈다. */
  split: {
    padding: '6px 10px', textAlign: 'left', fontSize: FS.cap, color: C.mute,
    fontWeight: FW.strong, background: C.head, borderTop: `1px solid ${C.line}`,
    borderBottom: `1px solid ${C.line2}`,
  } as React.CSSProperties,
  /** 행 구분선 — 첫 줄은 머리띠 밑선이 이미 있어 겹치지 않게 뺀다. */
  tr: (i: number): React.CSSProperties => ({ borderTop: i ? `1px solid ${C.line2}` : 'none' }),
} as const;

/**
 * 상세 섹션 표 — 머리띠 + (열이름 줄) + 본문. 상세의 모든 섹션이 이걸 쓴다.
 *   tone: main=흰 카드(핵심) · sub=테두리만 옅은 카드(부가) · agent=main 과 같은 카드(소속은 머리띠가 말한다)
 */
export type DetailTone = 'main' | 'sub' | 'agent';

/**
 * **머리띠 무게** — 색으로 섹션의 «중요도»를 말한다. 성격이 아니라 중요도다.
 *
 * 처음엔 섹션마다 다른 색(초록=보장·앰버=의무…)을 줬다가 되돌렸다 — 사장님 2026-08-20
 * 「섹션마다 색깔을 너무 다르게 하지 말고, 중요한 섹션은 메인 컬러로 하고 부가적인 건 좀 다르게」.
 * 다섯 갈래 색은 상세를 스크롤할 때 무지개가 되고, 어느 게 중요한지는 오히려 안 보인다.
 *
 *   main  **반전 남색** — 차를 고르는 데 필요한 것(차량스펙·대여료조건)
 *   sub   무채        — 조건·규칙(보험·계약)
 *   trace 흐린 무채    — 식별값(기타사항). 읽는 값이 아니라 대조하는 값
 *
 * ★반전 남색은 원래 영업자 패널의 문법이었는데 **본문 중요 섹션으로 옮겼다**
 *   (사장님 2026-08-20 「섹션헤드 컬러를 영업자용 거를 메인으로 손님용에서 쓰고」).
 *   제일 센 표현은 제일 많이 보는 곳 — 손님과 함께 보는 본문 — 이 가져가는 게 맞다.
 *   영업자 패널은 «참고하는 곳»이라 무채로 내려갔다(「강조할 곳은 아니니까」).
 *
 * ★2026-08-22 이후 **칠은 둘뿐**: `main` → `DT.bandInvert`(남색) · 나머지 → `DT.band`(회색).
 *   `trace`/`agent`는 이름·아이콘용. 스카이 면을 다시 켜지 않는다. 정본 = DESIGN.md §6.1.
 *
 * ⚠ 몸통은 칠하지 않는다. 면을 통째로 물들이면 섹션마다 카드 색이 달라져 «같은 규격»이 깨진다.
 */
export type SectionAccent = 'main' | 'sub' | 'trace' | 'agent';
export function DetailTable({ title, hint, mark, icon, tone = 'main', headTone = 'plain', accent = 'sub', span, cols, widths, label, children }: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  /** 제목 옆 작은 딱지(예: 「영업자 전용」). 바탕색만으로는 무슨 뜻인지 안 읽힌다. */
  mark?: React.ReactNode;
  /**
   * 머리띠 맨 앞 작은 그림 하나 — **섹션마다 다른 유일한 것**.
   * 규격(머리띠·항목칸·값칸)은 다 같게 두고 여기서만 성격을 준다. 스크롤하다 눈이 «어느 섹션인지»를
   * 글자를 읽기 전에 잡는다. 장식이 아니라 길찾기라서 **섹션 머리에 하나만** 둔다(칸 안에는 안 넣는다).
   */
  icon?: React.ReactNode;
  tone?: DetailTone;
  /**
   * 머리띠 강제 반전. `accent='main'` 과 같이 남색 띠가 된다.
   * 본문 중요 섹션은 accent 로 주고, 이 플래그는 예외(손그린 남색 바를 표에 붙일 때)만.
   */
  headTone?: 'plain' | 'invert';
  /** 머리띠 무게 — DESIGN.md §6.1. main=남색 반전, 나머지=회색 띠. */
  accent?: SectionAccent;
  /** 열 수 — 머리띠가 가로지를 칸 수. */
  span: number;
  /** 열이름 줄의 `<th>`들. 값 칸이 하나뿐인 표(항목│내용)는 안 준다 — 「항목 내용」은 매 카드 반복되는 빈말이다. */
  cols?: React.ReactNode;
  /** 칸 너비 — `tableLayout:'fixed'` 는 첫 줄로 폭을 정하는데 머리띠가 colSpan 이라 정할 게 없다. colgroup 으로 못박는다. */
  widths?: (string | number | undefined)[];
  /** 표 접근성 이름(aria-label). 안 주면 제목을 쓴다. */
  label?: string;
  children: React.ReactNode;
}) {
  const box: React.CSSProperties = tone === 'agent'
    // 영업자 것 = **머리띠(headTone='invert' 반전 남색)만으로** 말한다. 면을 따로 칠하지 않는다.
    //   · 앰버로 칠하면 「주의·수기입력」과 뜻이 겹치고 옆 섹션과 바탕이 달라져 «같은 규격»이 깨진다.
    //   · 좌측 4px 바도 뺐다 — 블록을 감싸는 인용문처럼 읽힌다(사장님 2026-08-20 「좌측에 바로 감싸는 느낌, 별로」).
    // 소속은 이미 패널 위치(우측 칼럼)와 머리띠 색이 말하므로, 몸통은 본문 섹션과 똑같이 둔다.
    // 영업자 판(ProductAgentColumn) 안에 얹히는 블록 — 판이 이미 테두리를 가졌으니 여기서 또 두르지 않는다.
    // 구획은 머리띠(스카이)가 나눈다. «상자 속 상자»를 만들지 않는 게 이 톤의 존재 이유다.
    ? { border: 'none', background: 'transparent' }
    // sub 를 투명(=페이지 회색)으로 두면 머리띠(C.head)가 배경과 거의 같은 색이라 사라진다.
    // 「모든 섹션이 같은 띠로 시작」이 규격이므로 바탕은 다 흰 카드로 두고, 무게는 테두리 굵기로만 준다.
    : tone === 'sub'
      ? { border: `1px solid ${C.line2}`, background: C.taupeBg }
      : { border: `1px solid ${C.line}`, background: C.taupeBg };
  const inverted = headTone === 'invert' || accent === 'main';
  return (
    <div style={{ ...box, borderRadius: R_CARD, overflow: 'hidden', flexShrink: 0 }}>
      <table aria-label={label || (typeof title === 'string' ? title : undefined)} style={DT.table}>
        {widths ? <colgroup>{widths.map((w, i) => <col key={i} style={w == null ? undefined : { width: w }} />)}</colgroup> : null}
        <thead>
          <tr>
            <th scope="col" colSpan={span} style={inverted ? DT.bandInvert : DT.band}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {icon ? (
                  <span aria-hidden style={{ display: 'inline-flex', color: inverted ? C.inverse : C.mute, opacity: inverted ? 0.85 : 1 }}>{icon}</span>
                ) : null}
                <span style={{ fontSize: FS.sub, fontWeight: FW.title, color: inverted ? C.inverse : C.ink }}>{title}</span>
                {hint ? <span style={{ fontSize: FS.cap, color: inverted ? C.inverse : C.faint, opacity: inverted ? 0.75 : 1 }}>{hint}</span> : null}
                {/* 딱지 — 뱃지와 같은 사각(R). 알약을 섞지 않는다(사장님 2026-08-20 「라운드 규격 통일」).
                    연한 네이비 틴트로 «강조는 하되 소리치지 않게» 둔다 — 값보다 세면 안 된다. */}
                {mark ? (
                  <span style={{
                    fontSize: FS.micro, fontWeight: FW.label, borderRadius: R, padding: '1px 6px', lineHeight: 1.6,
                    ...(inverted
                      ? { color: C.inverse, background: `color-mix(in srgb, ${C.inverse} 18%, transparent)` }
                      : { color: C.brand, background: 'var(--brand-bg)' }),
                  }}>{mark}</span>
                ) : null}
              </span>
            </th>
          </tr>
          {cols ? <tr>{cols}</tr> : null}
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/* 빈값 폴백 대시 — 인라인 '—' 통일. */
export function Dash() { return <span style={{ color: C.faint }}>—</span>; }

/** 상세 표 한 줄(라벨|값). 페이지가 tr/th/td 를 손대지 않게. 빈 값은 — . */
export function DtRow({ i, label, children, valueStyle }: {
  i: number;
  label: React.ReactNode;
  children?: React.ReactNode;
  valueStyle?: React.CSSProperties;
}) {
  const empty = children == null || children === '';
  return (
    <tr style={DT.tr(i)}>
      <th scope="row" style={DT.labelTh}>{label}</th>
      <td style={{ ...DT.td, ...valueStyle }}>{empty ? <Dash /> : children}</td>
    </tr>
  );
}

/* 접이식 항목 — 제목 줄만 보이고 눌러야 펼쳐진다(QnA·도움말).
 * Sec(페이지 섹션: 숨김·드래그 정렬 포함)과 별개. 이건 목록 안 한 줄짜리.
 * 여러 개를 세로로 쌓으면 위아래 선이 붙어 하나의 목록으로 보인다. */
export function Disclosure({ title, defaultOpen = false, children }: { title: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const mobile = useIsMobile();
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div style={{ borderBottom: `1px solid ${C.line}` }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          minHeight: ctrlH(mobile), padding: mobile ? '10px 2px' : '8px 2px',
          border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <ChevronDown
          size={mobile ? 16 : 14}
          color={open ? C.ink : C.faint}
          style={{ flex: '0 0 auto', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }}
        />
        <span style={{ flex: 1, minWidth: 0, fontSize: mobile ? FS.title : FS.body, fontWeight: FW.title, color: C.ink, lineHeight: 1.45 }}>{title}</span>
      </button>
      {open && <div style={{ padding: '0 0 12px 24px' }}>{children}</div>}
    </div>
  );
}

/* 라벨|값 표(인라인 편집) — 세부(360)·InfoDoc 공용 SSOT.
 * editing이면 값 칸만 그 자리에서 입력칸으로(화면 그대로, 폼 스왑 X). key=null이면 읽기전용.
 * 편집 모드는 테두리·배경(accent)으로 시각 구분. */
export type KVRow = [label: string, key: string | null, value: React.ReactNode];
export function KV({ rows, editing, form, onChange }: { rows: KVRow[]; editing?: boolean; form?: EntityRecord; onChange?: (k: string, v: string) => void }) {
  const mobile = useIsMobile();
  return (
    <div style={{ border: `1px solid ${editing ? C.accent : C.line}`, borderRadius: R, background: editing ? 'var(--bg-card)' : C.taupeBg, boxShadow: editing ? `0 0 0 3px ${C.focusRing}` : SH.cardRest, transition: 'box-shadow .15s, border-color .15s' }}>
      {rows.map(([k, key, val], i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', minHeight: ctrlH(mobile), padding: '0 12px', fontSize: mobile ? FS.title : FS.body, borderTop: i ? `1px solid var(--border-soft)` : 'none' }}>
          <span style={{ width: mobile ? 104 : 96, flex: `0 0 ${mobile ? 104 : 96}px`, color: C.mute }}>{k}</span>
          {editing && key
            ? <input value={String(form?.[key] ?? '')} onChange={(e) => onChange?.(key, e.target.value)}
                style={{ flex: 1, minWidth: 0, height: ctrlH(mobile, mobile ? 'md' : 'sm'), boxSizing: 'border-box', padding: mobile ? '0 10px' : '0 7px', border: `1px solid ${C.line}`, borderRadius: R, fontSize: ctrlInputFs(mobile), background: C.taupeBg, color: C.ink, fontFamily: 'inherit' }} />
            : <span style={{ minWidth: 0, fontVariantNumeric: 'tabular-nums' }}>{(val === '' || val == null) ? <span style={{ color: C.faint }}>—</span> : val}</span>}
        </div>
      ))}
    </div>
  );
}
