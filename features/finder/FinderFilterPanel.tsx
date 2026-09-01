'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import {
  CAR_DYN_KEYS, DYN, EMPTY_VEHICLE_FILTER, EXTRA_DYN_KEYS,
  sortProviderOptions, vehicleFilterCount,
  type aggregateDyn, type presentFilterOptions,
} from '@/lib/domain/product-filters';
import { toggleInSet } from '@/lib/set';
import { VehicleMasterFilter } from '@/components/VehicleMasterFilter';
import { FINDER_DEFAULT_SORT, FINDER_SORTS } from './filter-state';
import { Badge, Btn, C, CountPill, FilterChips, FilterGroup, FS, FW, ToggleChips } from '@/components/ui';
import type { FilterBag } from './filter-state';

type FilterUpdate = Partial<FilterBag> | ((current: FilterBag) => FilterBag);

/**
 * 칩 옵션 — 대상 대수 없이, **선택 중인 값은 모수에 없어도 유지 표시**.
 * 이게 없으면 다른 축을 좁혀 그 값이 모수에서 빠지는 순간 칩이 사라진다 —
 * 필터는 걸려 있는데 화면에 안 보이는 «숨은 필터»가 되어 「왜 3대밖에 안 나오지」가 된다.
 * ⚠ 모바일 빠른필터(FinderMobileFilters)도 **반드시 이걸 통과시킨다**.
 */
export function chipOpts(
  present: { key: string; label: string }[],
  selected: Set<string>,
  labelOf?: (key: string) => string,
): { key: string; label: string }[] {
  const seen = new Set(present.map((o) => o.key));
  const out = present.map(({ key, label }) => ({ key, label }));
  for (const key of selected) {
    if (!seen.has(key)) out.push({ key, label: labelOf?.(key) || key });
  }
  return out;
}

export type FinderFilterPanelModel = {
  mobile: boolean;
  totalVisible: number;
  /** 조건 적용 결과 대수. 없으면 총대수만. */
  foundCount: number;
  searching: boolean;
  activeCount: number;
  draftOpen: boolean;
  value: FilterBag;
  rows: EntityRecord[];
  cascadeProducts: EntityRecord[];
  popularModels: { key: string; label: string; count?: number }[];
  present: ReturnType<typeof presentFilterOptions>;
  aggregate: ReturnType<typeof aggregateDyn>;
  update: (patch: FilterUpdate) => void;
  reset: () => void;
};

export function FinderFilterPanel({ model }: { model: FinderFilterPanelModel }) {
  const {
    mobile, totalVisible, foundCount, searching, activeCount, value, cascadeProducts,
    popularModels, present, aggregate, update, reset,
  } = model;

  const toggleDynamic = (key: string, selected: string) => update((current) => {
    const values = new Set(current.dyn[key] || []);
    values.has(selected) ? values.delete(selected) : values.add(selected);
    return { ...current, dyn: { ...current.dyn, [key]: values } };
  });

  const popularOpts = chipOpts(popularModels, value.models);
  const monthOpts = chipOpts(present.months, new Set([...value.periods].map(String)), (key) => `${key}개월`);
  const rentOpts = chipOpts(present.rent, value.rent);
  const depOpts = chipOpts(present.dep, value.dep);
  const fuelOpts = chipOpts(present.fuel, value.fuel);
  const mileOpts = chipOpts(present.mile, value.mile);
  const ptypeOpts = chipOpts(present.ptype, value.ptype);
  const creditOpts = chipOpts(present.credit, value.credit);
  const perksOpts = chipOpts(present.perks, value.perks);
  const promoOpts = chipOpts(present.promo, value.promo);

  return (
    <>
      {!mobile && (
        <div className="fp-sidebar-head">
          <span style={{ fontSize: FS.body, color: C.mute }}>
            총 <b style={{ color: C.ink, fontSize: FS.title }}>{totalVisible.toLocaleString()}</b>대
            {searching ? (
              <> · 검색 <b style={{ color: C.ink, fontSize: FS.title }}>{foundCount.toLocaleString()}</b>대</>
            ) : null}
          </span>
          <span style={{ fontSize: FS.title, fontWeight: FW.title, display: 'inline-flex', alignItems: 'center', gap: 6, color: C.ink }}>
            조건 검색{activeCount > 0 ? <CountPill n={activeCount} /> : null}
          </span>
          <span style={{ flex: 1 }} />
          {activeCount > 0 && (
            <Btn variant="bare" haptic="select" onClick={() => { reset(); }}>
              초기화
            </Btn>
          )}
        </div>
      )}
      <div className="fp-sidebar-body">
        {/* 요상한 것 없음(사장님 2026-08-22 「즐겨찾기 이런 거 다 빼고, 위에서부터 직관적으로 인기차종부터 영업자들이 찾을 것들로만」)
            — 즐겨찾는 조건(프리셋)·최근·관심 필터를 걷어냈다. 첫 그룹은 인기차종, 정렬은 필터 안 FilterChips. */}
        {(popularOpts.length > 0) && (
          <FilterGroup title={<>인기차종 <Badge tone="amber" variant="solid">BEST</Badge></>} count={value.models.size} defaultOpen first onClear={() => update({ models: new Set() })}>
            <ToggleChips selected={value.models} onToggle={(key) => update((current) => ({ ...current, models: toggleInSet(current.models, key) }))} options={popularOpts} />
          </FilterGroup>
        )}
        {(monthOpts.length > 0) && (
          <FilterGroup title="기간" count={value.periods.size} defaultOpen onClear={() => update({ periods: new Set() })}>
            <ToggleChips
              selected={new Set([...value.periods].map(String))}
              onToggle={(key) => update((current) => ({ ...current, periods: toggleInSet(current.periods, Number(key)) }))}
              options={monthOpts}
            />
          </FilterGroup>
        )}
        {(rentOpts.length > 0) && <FilterGroup title="월대여료" count={value.rent.size} defaultOpen onClear={() => update({ rent: new Set() })}><ToggleChips selected={value.rent} onToggle={(key) => update((current) => ({ ...current, rent: toggleInSet(current.rent, key) }))} options={rentOpts} /></FilterGroup>}
        {(depOpts.length > 0) && <FilterGroup title="보증금" count={value.dep.size} defaultOpen={value.dep.size > 0} onClear={() => update({ dep: new Set() })}><ToggleChips selected={value.dep} onToggle={(key) => update((current) => ({ ...current, dep: toggleInSet(current.dep, key) }))} options={depOpts} /></FilterGroup>}
        {(present.hasVehicle || vehicleFilterCount(value.vehicle) > 0) && (
          <FilterGroup title="차종(제조사, 모델)" count={vehicleFilterCount(value.vehicle)} defaultOpen onClear={() => update({ vehicle: { ...EMPTY_VEHICLE_FILTER } })}>
            <div style={{ flex: '1 1 100%', width: '100%', minWidth: 0 }}>
              <VehicleMasterFilter products={cascadeProducts} value={value.vehicle} onChange={(vehicle) => update({ vehicle })} />
            </div>
          </FilterGroup>
        )}
        {CAR_DYN_KEYS.map((key) => {
          const definition = DYN.find((item) => item.key === key);
          if (!definition) return null;
          const selected = value.dyn[definition.key] || new Set();
          const options = chipOpts((aggregate[definition.key] || []).map(([entry]) => ({ key: entry, label: entry })), selected);
          if (!options.length) return null;
          const count = selected.size;
          return <FilterGroup key={definition.key} title={definition.label} count={count} defaultOpen={count > 0} onClear={() => update((current) => ({ ...current, dyn: { ...current.dyn, [definition.key]: new Set() } }))}><ToggleChips selected={selected} onToggle={(entry) => toggleDynamic(definition.key, entry)} options={options} /></FilterGroup>;
        })}
        {(fuelOpts.length > 0) && <FilterGroup title="연료(동력)" count={value.fuel.size} defaultOpen={value.fuel.size > 0} onClear={() => update({ fuel: new Set() })}><ToggleChips selected={value.fuel} onToggle={(key) => update((current) => ({ ...current, fuel: toggleInSet(current.fuel, key) }))} options={fuelOpts} /></FilterGroup>}
        {(mileOpts.length > 0) && <FilterGroup title="주행거리" count={value.mile.size} defaultOpen={value.mile.size > 0} onClear={() => update({ mile: new Set() })}><ToggleChips selected={value.mile} onToggle={(key) => update((current) => ({ ...current, mile: toggleInSet(current.mile, key) }))} options={mileOpts} /></FilterGroup>}
        {(ptypeOpts.length > 0) && <FilterGroup title="상품구분" count={value.ptype.size} defaultOpen={value.ptype.size > 0} onClear={() => update({ ptype: new Set() })}><ToggleChips selected={value.ptype} onToggle={(key) => update((current) => ({ ...current, ptype: toggleInSet(current.ptype, key) }))} options={ptypeOpts} /></FilterGroup>}
        {(creditOpts.length > 0) && <FilterGroup title="심사" count={value.credit.size} defaultOpen={value.credit.size > 0} onClear={() => update({ credit: new Set() })}><ToggleChips selected={value.credit} onToggle={(key) => update((current) => ({ ...current, credit: toggleInSet(current.credit, key) }))} options={creditOpts} /></FilterGroup>}
        {(perksOpts.length > 0) && <FilterGroup title="우대조건" count={value.perks.size} defaultOpen={value.perks.size > 0} onClear={() => update({ perks: new Set() })}><ToggleChips selected={value.perks} onToggle={(key) => update((current) => ({ ...current, perks: toggleInSet(current.perks, key) }))} options={perksOpts} /></FilterGroup>}
        {(promoOpts.length > 0) && <FilterGroup title="이벤트" count={value.promo.size} defaultOpen={value.promo.size > 0} onClear={() => update({ promo: new Set() })}><ToggleChips selected={value.promo} onToggle={(key) => update((current) => ({ ...current, promo: toggleInSet(current.promo, key) }))} options={promoOpts} /></FilterGroup>}
        {EXTRA_DYN_KEYS.map((key) => {
          const definition = DYN.find((item) => item.key === key);
          if (!definition) return null;
          const selected = value.dyn[definition.key] || new Set();
          const options = chipOpts((aggregate[definition.key] || []).map(([entry]) => ({ key: entry, label: entry })), selected);
          if (!options.length) return null;
          const count = selected.size;
          return <FilterGroup key={definition.key} title={definition.label} count={count} defaultOpen={count > 0} onClear={() => update((current) => ({ ...current, dyn: { ...current.dyn, [definition.key]: new Set() } }))}><ToggleChips selected={selected} onToggle={(entry) => toggleDynamic(definition.key, entry)} options={options} /></FilterGroup>;
        })}
        {(() => {
          const entries = aggregate.provider || [];
          const selected = value.dyn.provider || new Set();
          if (!entries.length && !selected.size) return null;
          const options = chipOpts(
            sortProviderOptions(entries).map((o) => ({ key: o.value, label: o.label })),
            selected,
          );
          return (
            <FilterGroup title="공급사" count={selected.size} defaultOpen={selected.size > 0} onClear={() => update((current) => ({ ...current, dyn: { ...current.dyn, provider: new Set() } }))}>
              <ToggleChips
                selected={selected}
                onToggle={(entry) => update((current) => ({
                  ...current,
                  dyn: { ...current.dyn, provider: toggleInSet(current.dyn.provider || new Set(), entry) },
                }))}
                options={options}
              />
            </FilterGroup>
          );
        })()}
        {/* 정렬 — 필터 안 칩(업무 목록과 같음). 툴바 Select는 두지 않는다. */}
        <FilterGroup title="정렬" count={value.sort !== FINDER_DEFAULT_SORT ? 1 : 0} defaultOpen onClear={() => update({ sort: FINDER_DEFAULT_SORT })}>
          <FilterChips
            value={value.sort || FINDER_DEFAULT_SORT}
            onChange={(key) => update({ sort: key })}
            options={FINDER_SORTS.map((option) => ({ key: option.value, label: option.label }))}
            clearKey={FINDER_DEFAULT_SORT}
          />
        </FilterGroup>
      </div>
    </>
  );
}
