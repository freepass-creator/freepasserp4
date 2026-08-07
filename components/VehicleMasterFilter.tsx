'use client';
/**
 * 파인더 차종 — 5단 복수 선택(칩).
 * 상위 선택이 하위 선택지를 좁힌다. 대상 대수는 표시하지 않는다.
 */
import { useMemo, type ReactNode } from 'react';
import { C, FS, FW, ToggleChips } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { type EntityRecord } from '@/lib/intake/entities';
import { normalizeVehicleFilter, type VehicleFilter } from '@/lib/domain/vehicle-master-match';
import { aggregateVehicleCascade } from '@/lib/domain/product-filters';
import { toggleInSet } from '@/lib/set';

function Step({ label, children }: { label: string; children: ReactNode }) {
  const mobile = useIsMobile();
  return (
    <div style={{ minWidth: 0, width: '100%' }}>
      <div style={{
        fontSize: mobile ? FS.sub : FS.cap, fontWeight: FW.title,
        color: C.mute, marginBottom: 4, minHeight: mobile ? 18 : 16,
      }}>{label}</div>
      {children}
    </div>
  );
}

function chipOptions(
  present: { value: string }[],
  selected: string[],
): { key: string; label: string }[] {
  const seen = new Set(present.map((o) => o.value));
  const out = present.map((o) => ({ key: o.value, label: o.value }));
  for (const key of selected) {
    if (!seen.has(key)) out.push({ key, label: key });
  }
  return out;
}

export function VehicleMasterFilter({ products, value, onChange }: {
  products: EntityRecord[];
  value: VehicleFilter;
  onChange: (v: VehicleFilter) => void;
}) {
  const selected = useMemo(() => normalizeVehicleFilter(value), [value]);
  const tree = useMemo(() => aggregateVehicleCascade(products, selected), [products, selected]);

  const toggle = (field: keyof VehicleFilter, key: string) => {
    const next = toggleInSet(new Set(selected[field]), key);
    onChange({ ...selected, [field]: [...next] });
  };

  if (!products.length && vehicleEmpty(selected)) {
    return <div style={{ fontSize: FS.sub, color: C.faint }}>매물이 없어 고를 수 없습니다</div>;
  }

  const makerOpts = chipOptions(
    tree.makers.flatMap((g) => g.options),
    selected.maker,
  );
  const modelOpts = chipOptions(tree.models, selected.model);
  const subOpts = chipOptions(tree.subs, selected.sub_model);
  const variantOpts = chipOptions(tree.variants, selected.variant);
  const trimOpts = chipOptions(tree.trims, selected.trim_name);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      width: '100%', boxSizing: 'border-box',
    }}>
      {(makerOpts.length > 0) && (
        <Step label="제조사">
          <ToggleChips
            selected={new Set(selected.maker)}
            onToggle={(key) => toggle('maker', key)}
            options={makerOpts}
          />
        </Step>
      )}
      {(modelOpts.length > 0) && (
        <Step label="모델">
          <ToggleChips
            selected={new Set(selected.model)}
            onToggle={(key) => toggle('model', key)}
            options={modelOpts}
          />
        </Step>
      )}
      {(subOpts.length > 0) && (
        <Step label="세부모델">
          <ToggleChips
            selected={new Set(selected.sub_model)}
            onToggle={(key) => toggle('sub_model', key)}
            options={subOpts}
          />
        </Step>
      )}
      {(variantOpts.length > 0) && (
        <Step label="파워트레인">
          <ToggleChips
            selected={new Set(selected.variant)}
            onToggle={(key) => toggle('variant', key)}
            options={variantOpts}
          />
        </Step>
      )}
      {(trimOpts.length > 0) && (
        <Step label="세부트림">
          <ToggleChips
            selected={new Set(selected.trim_name)}
            onToggle={(key) => toggle('trim_name', key)}
            options={trimOpts}
          />
        </Step>
      )}
    </div>
  );
}

function vehicleEmpty(v: VehicleFilter) {
  return !(v.maker.length || v.model.length || v.sub_model.length || v.variant.length || v.trim_name.length);
}
