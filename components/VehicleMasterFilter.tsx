'use client';
/**
 * 파인더 차종 — 매물 집계 5단 계단(선택 시 다음 단만 노출).
 *
 * **드롭다운이다. 칩이 아니다.**
 * 한때 다섯 단을 모두 칩으로 펼친 적이 있는데(2026-08-08), 모델만 60종이 넘어
 * 좌측 패널이 칩으로 가득 차고 그 아래 연료·주행거리·기간은 스크롤 밖으로 밀렸다.
 * 고를 것이 많은 축은 접어 두고 «고른 뒤에 다음 단»을 여는 편이 훑기 쉽다.
 *
 * 옵션 라벨에 대수(count)를 붙인다 — 「그랜저 (12)」. 몇 대짜리인지 모르고 고르면
 * 빈 결과를 보고 되돌아오게 된다.
 * 다음에 고를 칸 = 라벨 옆 →다음단계 힌트 + select accent.
 *
 * ★값은 «배열»이다. 화면은 한 단에 하나만 고르게 하지만 그릇은 배열을 유지한다 —
 *   product-filters·useFinderResults·프리셋이 모두 배열로 읽는다. 여기서 문자열로
 *   되돌리면 그 일곱 파일이 함께 흔들린다.
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
  const subModel = one('sub_model');
  const variant = one('variant');
  const trimName = one('trim_name');

  const nextKey = !maker ? 'maker'
    : !model ? 'model'
      : !subModel ? 'sub_model'
        : !variant ? 'variant'
          : !trimName ? 'trim_name'
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

      {!!model && (
        <Step label="세부모델" nextHint={nextHint} active={nextKey === 'sub_model'}>
          <Select
            full placeholder={nextKey === 'sub_model' ? '세부모델 선택' : '전체'} value={subModel}
            onChange={(v) => pick({ sub_model: v, variant: '', trim_name: '' })}
            options={tree.subs.map((o) => ({ value: o.value, label: optLabel(o) }))}
            style={nextKey === 'sub_model' ? accent : undefined}
          />
        </Step>
      )}

      {!!subModel && (
        <Step label="파워트레인" nextHint={nextHint} active={nextKey === 'variant'}>
          <Select
            full placeholder={nextKey === 'variant' ? '파워트레인 선택' : '전체'} value={variant}
            onChange={(v) => pick({ variant: v, trim_name: '' })}
            options={tree.variants.map((o) => ({ value: o.value, label: optLabel(o) }))}
            style={nextKey === 'variant' ? accent : undefined}
          />
        </Step>
      )}

      {!!variant && (
        <Step label="세부트림" active={nextKey === 'trim_name'}>
          <Select
            full placeholder={nextKey === 'trim_name' ? '세부트림 선택' : '전체'} value={trimName}
            onChange={(v) => pick({ trim_name: v })}
            options={tree.trims.map((o) => ({ value: o.value, label: optLabel(o) }))}
            style={nextKey === 'trim_name' ? accent : undefined}
          />
        </Step>
      )}
    </div>
  );
}
