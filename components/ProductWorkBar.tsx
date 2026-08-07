'use client';
import { type EntityRecord } from '@/lib/intake/entities';
import { cheapest, normalizeVehicleDisplayStatus, vehicleName, vehicleTone } from '@/lib/domain/product';
import { Badge, C, FS, FW, NUM, won } from '@/components/ui';

/**
 * 영업자 작업화면 **상단 요약바** — 차명 · 차번 · 상태 · 최저가 한 줄.
 *
 * 상세(왼쪽 칸)를 아래로 굴리면 차명도 가격도 화면 밖으로 나간다. 손님과 통화하면서
 * 대화·계약 칸을 보고 있을 때 «지금 어느 차 이야기인가»가 사라지는 것이 가장 위험하다.
 * 그래서 이 줄만은 스크롤과 무관하게 남는다(sticky). 값은 전부 기존 원자에서 파생 —
 * 새 표기 규칙을 만들지 않는다.
 */
export function ProductWorkBar({ p }: { p: EntityRecord }) {
  const name = vehicleName(p) || String(p.car_number || '매물');
  const status = normalizeVehicleDisplayStatus(p.vehicle_status);
  const cheap = cheapest(p);
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 3,
      display: 'flex', alignItems: 'center', gap: 8,
      // 좌우 패딩을 넘겨 화면 폭을 다 쓴다 — 아래 내용이 바 옆으로 비쳐 지나가지 않게.
      margin: '-14px -16px 12px', padding: '9px 16px',
      background: C.bg, borderBottom: `1px solid ${C.line}`,
      minWidth: 0,
    }}>
      <span style={{
        fontSize: FS.title, fontWeight: FW.title, color: C.ink,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
      }}>{name}</span>
      {p.car_number ? (
        <span style={{
          fontSize: FS.cap, fontWeight: FW.strong, color: C.mute, fontFamily: NUM,
          fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flex: '0 0 auto',
        }}>{String(p.car_number)}</span>
      ) : null}
      <Badge tone={vehicleTone(status)}>{status}</Badge>
      <span style={{ flex: 1, minWidth: 8 }} />
      {cheap ? (
        <span style={{
          display: 'inline-flex', alignItems: 'baseline', gap: 5, flex: '0 0 auto',
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span style={{ fontSize: FS.cap, color: C.faint }}>{cheap.m}개월</span>
          <span style={{ fontSize: FS.title, fontWeight: FW.head, color: C.brand, fontFamily: NUM }}>{won(cheap.rent)}</span>
          <span style={{ fontSize: FS.cap, color: C.faint }}>{cheap.deposit > 0 ? `보증 ${won(cheap.deposit)}` : '무보증'}</span>
        </span>
      ) : (
        <span style={{ fontSize: FS.cap, color: C.faint, flex: '0 0 auto' }}>가격 문의</span>
      )}
    </div>
  );
}
