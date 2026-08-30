'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import { C, NUM, FW, FS } from '@/components/ui';
import { cardTitle } from '@/components/product-card-identity';
import { TEMP_PLATE_RE } from '@/lib/domain/product';

/**
 * ★**임시번호는 화면에 안 보인다 — 「출고예정」으로 보인다**(사장님 2026-08-21 「차량번호 없이 노출」).
 *   출고는 확정됐는데 번호판이 아직 없는 신차에 우리가 붙인 자리표시(`100신0001`)다.
 *   영업자·손님에게 그 숫자를 보이면 진짜 번호인 줄 안다 — 기계만 쓰는 열쇠다.
 *   번호가 나오면 공급사가 차량번호 칸을 실번호로 덮어쓰고, 그때부터 그냥 번호로 보인다.
 */
export function Plate({ p }: { p: EntityRecord }) {
  if (!p.car_number) return null;
  const plate = String(p.car_number);
  const pending = TEMP_PLATE_RE.test(plate.replace(/s/g, ''));
  return (
    <span style={{
      fontSize: FS.cap, fontWeight: FW.strong, color: pending ? C.mute : C.ink, fontFamily: pending ? undefined : NUM,
      fontVariantNumeric: 'tabular-nums',
      letterSpacing: '-0.2px', whiteSpace: 'nowrap', flex: '0 0 auto',
    }} title={pending ? '번호판이 아직 안 나온 신차입니다' : undefined}>{pending ? '출고예정' : plate}</span>
  );
}

export function CardTitle({ p, narrow, size, weight }: {
  p: EntityRecord;
  narrow?: boolean;
  size?: number;
  /** 행의 «머리»로 세울 때만 올린다(모바일 목록). 기본은 표·격자용 FW.title. */
  weight?: number;
}) {
  const fontSize = size ?? FS.title;
  const text = cardTitle(p, !!narrow);
  return (
    <div title={text} style={{
      fontSize, fontWeight: weight ?? FW.title, color: C.ink, lineHeight: 1.2,
      minWidth: 0, width: '100%',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>{text}</div>
  );
}
