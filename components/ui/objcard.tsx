'use client';
import React from 'react';
import { C, NUM, FW, FS } from './tokens';
import { Badge, CompanyBadge, type BadgeTone } from './badges';

// 반응형 카드 그리드 — 폭에 맞춰 자동(auto-fit). 카드 높이는 내용(원자 수)에 맞게, 짧은 카드는 안 늘림(align start).
export function Cards({ min = 240, fit, children }: { min?: number; fit?: boolean; children: React.ReactNode }) {
  // fit = flex-wrap → 각 카드가 내용폭에 맞게(넓은 값은 더 넓게, 좁은 값은 좁게) 늘어나고 줄바꿈. 내용 잘림 없음. 지표(Metric) 행 전용.
  if (fit) return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>{children}</div>;
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${min}px), 1fr))`, gap: 8, alignItems: 'start' }}>{children}</div>;
}
// 카드 공통 — 살짝 뜬 그림자 + 자연스러운 통일 호버(떠오름). 절제(눈 안 아프게).
const REST_SH = '0 1px 2px rgba(15,23,42,0.05)';
const HOVER_SH = '0 4px 12px rgba(15,23,42,0.10)';
function useHover() { const [h, setH] = React.useState(false); return { h, on: { onMouseEnter: () => setH(true), onMouseLeave: () => setH(false) } }; }
function cardStyle(h: boolean, click: boolean): React.CSSProperties {
  return { border: `1px solid ${h && click ? '#cfd3da' : C.line}`, borderRadius: 'var(--radius)', background: '#fff', boxShadow: h && click ? HOVER_SH : REST_SH, transform: h && click ? 'translateY(-1px)' : 'none', transition: 'box-shadow .15s ease, border-color .15s ease, transform .15s ease', cursor: click ? 'pointer' : 'default' };
}
// 지표 카드 (가동률·미수 등) — 라벨 + 숫자. 색은 숫자에만.
export function Metric({ label, value, tone, onClick }: { label: React.ReactNode; value: React.ReactNode; tone?: 'ink' | 'danger' | 'ok' | 'warn'; onClick?: () => void }) {
  const color = tone === 'danger' ? C.danger : tone === 'ok' ? C.ok : tone === 'warn' ? C.warn : C.ink;
  const { h, on } = useHover();
  return (
    <div onClick={onClick} {...on} style={{ ...cardStyle(h, !!onClick), padding: '9px 13px', flex: '0 0 auto', minHeight: 54, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.label, whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: FS.page, fontWeight: FW.head, color, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', marginTop: 2, whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}
// 객체 카드 = 목록의 단일 원자(2행 신원카드). 높이 통일 56px, 폭은 그리드 자유.
//  1행 신원: [회사][상태배지][차량번호(모노·무잘림) 또는 이름][차종(축소가능)] …[우측 핵심수치]
//  2행 원자: fields(라벨-값, 우선순위 상위 3 + ＋n) 또는 sub(자유문). 좌측 2px 레일=위험 신호.
//  호출부는 "필요한 원자만" 넘긴다. 차번=plate, 비차량 주체(자금 상대방·고객)=name, 부가식별=carType.
export type RailTone = 'none' | 'danger' | 'warn' | 'ok' | 'mute';
const RAIL: Record<RailTone, { c: string; o: number }> = {
  none: { c: C.faint, o: 0.28 }, mute: { c: C.faint, o: 0.5 },
  danger: { c: C.danger, o: 1 }, warn: { c: C.warn, o: 1 }, ok: { c: C.ok, o: 1 },
};
const ATOM_CAP = 3; // 2행 원자 표시 상한 — 넘으면 ＋n(우선순위 상위만 생존, 픽셀측정 대신 count-cap)
export function ObjCard({ badge, badgeTone = 'gray', co, rail = 'none', plate, name, carType, title, sub, right, fields, onClick }: {
  badge?: React.ReactNode; badgeTone?: BadgeTone; co?: string; rail?: RailTone;
  plate?: string; name?: React.ReactNode; carType?: React.ReactNode; title?: React.ReactNode;
  sub?: React.ReactNode; right?: React.ReactNode; fields?: [React.ReactNode, React.ReactNode][]; onClick?: () => void;
}) {
  const { h, on } = useHover();
  const rl = RAIL[rail];
  // 2행: 원자 상위 ATOM_CAP개 + ＋n, 없으면 sub 문자열
  const shown = fields ? fields.slice(0, ATOM_CAP) : [];
  const moreN = fields ? fields.length - shown.length : 0;
  const row2: React.ReactNode = fields && fields.length > 0
    ? <>{shown.map(([l, v], i) => <span key={i} style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}>{l != null && <span style={{ color: C.mute }}>{l} </span>}<span style={{ color: C.ink, fontWeight: FW.meta, fontVariantNumeric: 'tabular-nums' }}>{v}</span>{i < shown.length - 1 && <span style={{ color: C.faint, margin: '0 5px' }}>·</span>}</span>)}{moreN > 0 && <span style={{ flex: '0 0 auto', color: C.faint, marginLeft: 6 }}>＋{moreN}</span>}</>
    : sub;
  // 앵커 = 차번(모노·flexShrink0·자를 수단 없음) → 이름(비모노·축소가능) → legacy title(축소가능)
  const anchor = plate != null
    ? <span style={{ flex: '0 0 auto', whiteSpace: 'nowrap', fontFamily: NUM, fontSize: FS.body, fontWeight: FW.title, letterSpacing: '-0.01em', color: C.ink }}>{plate}</span>
    : name != null
      ? <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: FS.body, fontWeight: FW.title, color: C.ink }}>{name}</span>
      : <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: FS.sub, fontWeight: FW.title, color: C.ink }}>{title}</span>;
  return (
    <div onClick={onClick} {...on} style={{ ...cardStyle(h, !!onClick), position: 'relative', overflow: 'hidden', height: 56, padding: '0 12px 0 14px', display: 'flex', alignItems: 'center', minWidth: 0 }}>
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: rl.c, opacity: rl.o }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* 1행 = 자산 신원: 회사·상태·차번(무잘림)·차종 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, overflow: 'hidden' }}>
          {co ? <span style={{ flex: '0 0 auto' }}><CompanyBadge co={co} /></span> : null}
          {badge != null && <span style={{ flex: '0 0 auto' }}><Badge tone={badgeTone}>{badge}</Badge></span>}
          {anchor}
          {carType != null && <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: FS.sub, color: C.mute }}>{carType}</span>}
        </div>
        {/* 2행 = 내용(원자·왼쪽 축소) + 핵심 수치(오른쪽 고정·무잘림) */}
        {(row2 != null || right != null) && <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', display: 'flex', alignItems: 'baseline', fontSize: FS.cap, color: C.faint }}>{row2}</div>
          {right != null && <div style={{ flex: '0 0 auto', fontSize: FS.body, fontWeight: FW.head, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: C.ink }}>{right}</div>}
        </div>}
      </div>
    </div>
  );
}
