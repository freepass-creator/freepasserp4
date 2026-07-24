'use client';
/**
 * 파인더 차종 — 매물 집계 5단 계단(선택 시 다음 단만 노출).
 * 옵션 라벨에 대수(count) 표시 — 제조사→모델→… 각 단.
 * 다음에 고를 칸 = 라벨 옆 →다음단계 힌트 + select accent.
 */
import { useMemo, type ReactNode } from 'react';
import { C, Select, FS, FW } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { type EntityRecord } from '@/lib/intake/entities';
import { type VehicleFilter } from '@/lib/domain/vehicle-master-match';
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
  const tree = useMemo(() => aggregateVehicleCascade(products, value), [products, value]);
  const set = (patch: Partial<VehicleFilter>) => onChange({ ...value, ...patch });

  const nextKey = !value.maker ? 'maker'
    : !value.model ? 'model'
    : !value.sub_model ? 'sub_model'
    : !value.variant ? 'variant'
    : !value.trim_name ? 'trim_name'
    : null;
  const nextHint = nextKey === 'maker' ? '모델'
    : nextKey === 'model' ? '세부모델'
    : nextKey === 'sub_model' ? '파워트레인'
    : nextKey === 'variant' ? '세부트림'
    : null;

  if (!products.length) {
    return <div style={{ fontSize: FS.sub, color: C.faint }}>매물이 없어 고를 수 없습니다</div>;
  }

  const makerActive = nextKey === 'maker';
  const accent = { borderColor: C.accent, boxShadow: '0 0 0 2px rgba(37,99,235,0.14)' } as const;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      width: '100%', boxSizing: 'border-box',
    }}>
      <Step label="제조사" nextHint={nextHint} active={makerActive}>
        <Select
          full
          placeholder={makerActive ? '제조사 선택' : '전체'}
          value={value.maker}
          onChange={(v) => set({
            maker: v, model: '', sub_model: '', variant: '', trim_name: '',
          })}
          groups={tree.makers.map((g) => ({
            label: groupLabel(g.origin, g.options),
            options: g.options.map((o) => ({ value: o.value, label: optLabel(o) })),
          }))}
          style={makerActive ? accent : undefined}
        />
      </Step>

      {!!value.maker && (
        <Step label="모델" nextHint={nextHint} active={nextKey === 'model'}>
          <Select
            full placeholder={nextKey === 'model' ? '모델 선택' : '전체'} value={value.model}
            onChange={(v) => set({ model: v, sub_model: '', variant: '', trim_name: '' })}
            options={tree.models.map((o) => ({ value: o.value, label: optLabel(o) }))}
            style={nextKey === 'model' ? accent : undefined}
          />
        </Step>
      )}

      {!!value.model && (
        <Step label="세부모델" nextHint={nextHint} active={nextKey === 'sub_model'}>
          <Select
            full placeholder={nextKey === 'sub_model' ? '세부모델 선택' : '전체'} value={value.sub_model}
            onChange={(v) => set({ sub_model: v, variant: '', trim_name: '' })}
            options={tree.subs.map((o) => ({ value: o.value, label: optLabel(o) }))}
            style={nextKey === 'sub_model' ? accent : undefined}
          />
        </Step>
      )}

      {!!value.sub_model && (
        <Step label="파워트레인" nextHint={nextHint} active={nextKey === 'variant'}>
          <Select
            full placeholder={nextKey === 'variant' ? '파워트레인 선택' : '전체'} value={value.variant}
            onChange={(v) => set({ variant: v, trim_name: '' })}
            options={tree.variants.map((o) => ({ value: o.value, label: optLabel(o) }))}
            style={nextKey === 'variant' ? accent : undefined}
          />
        </Step>
      )}

      {!!value.variant && (
        <Step label="세부트림" active={nextKey === 'trim_name'}>
          <Select
            full placeholder={nextKey === 'trim_name' ? '세부트림 선택' : '전체'} value={value.trim_name}
            onChange={(v) => set({ trim_name: v })}
            options={tree.trims.map((o) => ({ value: o.value, label: optLabel(o) }))}
            style={nextKey === 'trim_name' ? accent : undefined}
          />
        </Step>
      )}
    </div>
  );
}
