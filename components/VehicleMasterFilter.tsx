'use client';
/**
 * 파인더 차종 퀵필터 — 제조사 → 모델만.
 * 세부모델·파워·트림은 여기 안 연다. 제조사만 골랐을 때 그 제조사 세부모델이
 * 펼쳐지던 것(모델 칸에 세대명이 뜨거나 다음 단이 세부모델인 것)을 막는다.
 *
 * **드롭다운이다. 칩이 아니다.**
 * 옵션 라벨에 대수(count)를 붙인다 — 「그랜저 (12)」.
 *
 * ★값은 «배열»이다. 화면은 한 단에 하나만 고르게 하지만 그릇은 배열을 유지한다.
 * 제조사·모델을 고르면 아래 축(세부모델·파워·트림)은 비운다.
 */
import { useMemo, type ReactNode } from 'react';
import { C, Select, FS, FW } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { type EntityRecord } from '@/lib/intake/entities';
import { normalizeVehicleFilter, type VehicleFilter } from '@/lib/domain/vehicle-master-match';
import { aggregateVehicleCascade, type CascadeOpt } from '@/lib/domain/product-filters';

/** 선택지 = 이름 + 대수. 웹·모바일 select 공통. */
function optLabel(o: CascadeOpt) {
  return `${o.value} (${o.count})`;
}

function groupLabel(origin: string, options: CascadeOpt[]) {
  const n = options.reduce((s, o) => s + o.count, 0);
  return `${origin} (${n})`;
}

function Step({ label, nextHint, active, children }: {
  label: string; nextHint?: string | null; active?: boolean; children: ReactNode;
}) {
  const mobile = useIsMobile();
  return (
    <div style={{ minWidth: 0, width: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, minHeight: mobile ? 18 : 16,
      }}>
        <div style={{
          fontSize: mobile ? FS.sub : FS.cap, fontWeight: FW.title,
          color: active ? C.accent : C.mute, flex: '0 0 auto',
        }}>{label}</div>
        {active && nextHint && (
          <div style={{
            flex: 1, minWidth: 0, fontSize: FS.cap, fontWeight: FW.strong, color: C.accent,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right',
          }}>
            선택 → {nextHint}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export function VehicleMasterFilter({ products, value, onChange }: {
  products: EntityRecord[];
  value: VehicleFilter;
  onChange: (v: VehicleFilter) => void;
}) {
  const selected = useMemo(() => normalizeVehicleFilter(value), [value]);
  const tree = useMemo(() => aggregateVehicleCascade(products, selected), [products, selected]);

  /** 한 단을 고르면 그 아래는 지운다 — 남겨 두면 «있을 수 없는 조합»이 남는다. */
  const pick = (patch: Partial<Record<keyof VehicleFilter, string>>) => {
    const next = { ...selected } as Record<string, string[]>;
    for (const [key, v] of Object.entries(patch)) next[key] = v ? [v] : [];
    onChange(next as unknown as VehicleFilter);
  };
  /** 화면은 한 단에 하나 — 배열의 첫 값만 보여 준다. */
  const one = (field: keyof VehicleFilter) => (selected[field] || [])[0] || '';

  const maker = one('maker');
  const model = one('model');

  const nextKey = !maker ? 'maker' : !model ? 'model' : null;
  const nextHint = nextKey === 'maker' ? '모델' : null;

  if (!products.length) {
    return <div style={{ fontSize: FS.sub, color: C.faint }}>매물이 없어 고를 수 없습니다</div>;
  }

  const makerActive = nextKey === 'maker';
  const accent = { borderColor: C.accent, boxShadow: `0 0 0 2px ${C.focusRing}` } as const;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      width: '100%', boxSizing: 'border-box',
    }}>
      <Step label="제조사" nextHint={nextHint} active={makerActive}>
        <Select
          full
          placeholder={makerActive ? '제조사 선택' : '전체'}
          value={maker}
          onChange={(v) => pick({
            maker: v, model: '', sub_model: '', variant: '', trim_name: '',
          })}
          groups={tree.makers.map((g) => ({
            label: groupLabel(g.origin, g.options),
            options: g.options.map((o) => ({ value: o.value, label: optLabel(o) })),
          }))}
          style={makerActive ? accent : undefined}
        />
      </Step>

      {!!maker && (
        <Step label="모델" nextHint={nextHint} active={nextKey === 'model'}>
          <Select
            full placeholder={nextKey === 'model' ? '모델 선택' : '전체'} value={model}
            onChange={(v) => pick({ model: v, sub_model: '', variant: '', trim_name: '' })}
            options={tree.models.map((o) => ({ value: o.value, label: optLabel(o) }))}
            style={nextKey === 'model' ? accent : undefined}
          />
        </Step>
      )}
    </div>
  );
}
