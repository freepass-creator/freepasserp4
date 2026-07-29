'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import {
  CAR_DYN_KEYS, DYN, EMPTY_VEHICLE_FILTER, EXTRA_DYN_KEYS,
  operatingMonths, sortProviderOptions, vehicleFilterCount,
  type aggregateDyn, type presentFilterOptions,
} from '@/lib/domain/product-filters';
import { toggleInSet } from '@/lib/set';
import { VehicleMasterFilter } from '@/components/VehicleMasterFilter';
import { FINDER_SORTS } from './filter-state';
import {
  Badge, Btn, C, CountPill, FilterGroup, FS, FW, Select, ToggleChips, ctrlH,
} from '@/components/ui';
import type { FilterBag, InterestKey } from './filter-state';

type FilterUpdate = Partial<FilterBag> | ((current: FilterBag) => FilterBag);

export type FinderFilterPanelModel = {
  mobile: boolean;
  totalVisible: number;
  activeCount: number;
  draftOpen: boolean;
  value: FilterBag;
  rows: EntityRecord[];
  cascadeProducts: EntityRecord[];
  popularModels: { key: string; label: string; count?: number }[];
  present: ReturnType<typeof presentFilterOptions>;
  aggregate: ReturnType<typeof aggregateDyn>;
  recentCount: number;
  favoriteCount: number;
  update: (patch: FilterUpdate) => void;
  reset: () => void;
  clearRecent: () => void;
  clearFavorites: () => void;
};

export function FinderFilterPanel({ model }: { model: FinderFilterPanelModel }) {
  const {
    mobile, totalVisible, activeCount, draftOpen, value, rows, cascadeProducts,
    popularModels, present, aggregate, recentCount, favoriteCount,
    update, reset, clearRecent, clearFavorites,
  } = model;

  const toggleDynamic = (key: string, selected: string) => update((current) => {
    const values = new Set(current.dyn[key] || []);
    values.has(selected) ? values.delete(selected) : values.add(selected);
    return { ...current, dyn: { ...current.dyn, [key]: values } };
  });

  return (
    <>
      {!mobile && (
        <div className="fp-sidebar-head">
          <span style={{ fontSize: FS.body, color: C.mute }}>
            총 <b style={{ color: C.ink, fontSize: FS.title }}>{totalVisible.toLocaleString()}</b>대
          </span>
          <span style={{ fontSize: FS.title, fontWeight: FW.title, display: 'inline-flex', alignItems: 'center', gap: 6, color: C.ink }}>
            조건 검색{activeCount > 0 ? <CountPill n={activeCount} /> : null}
          </span>
          <span style={{ flex: 1 }} />
          {activeCount > 0 && (
            <Btn
              variant="bare"
              haptic="select"
              onClick={() => { reset(); }}
              style={{ color: C.accent, fontSize: FS.cap, fontWeight: FW.strong, padding: '4px 6px' }}
            >
              초기화
            </Btn>
          )}
        </div>
      )}
      <div className="fp-sidebar-body">
        {draftOpen && (
          <>
            <FilterGroup
              title="최근·관심"
              count={value.interest.size}
              defaultOpen
              first
              actions={(() => {
                const height = ctrlH(mobile);
                const style = {
                  marginLeft: 4, flex: '0 0 auto', fontSize: mobile ? FS.sub : FS.cap,
                  fontWeight: FW.strong, minHeight: height, minWidth: 40,
                  padding: mobile ? '0 8px' : '0 6px',
                };
                if (value.interest.size > 0) {
                  return <Btn variant="bare" title="해제" haptic="select" onClick={() => { update({ interest: new Set() }); }} style={{ ...style, color: C.accent }}>해제</Btn>;
                }
                return (
                  <>
                    <Btn variant="bare" title="최근 비우기" haptic="impact" disabled={recentCount === 0} onClick={() => { clearRecent(); }} style={{ ...style, color: C.mute }}>최근 비우기</Btn>
                    <Btn variant="bare" title="관심 비우기" haptic="impact" disabled={favoriteCount === 0} onClick={() => { clearFavorites(); }} style={{ ...style, color: C.mute }}>관심 비우기</Btn>
                  </>
                );
              })()}
            >
              <ToggleChips
                selected={value.interest}
                onToggle={(key) => update((current) => ({ ...current, interest: toggleInSet(current.interest, key as InterestKey) }))}
                options={[
                  { key: 'recent', label: recentCount ? `최근 ${recentCount}` : '최근' },
                  { key: 'fav', label: favoriteCount ? `관심 ${favoriteCount}` : '관심' },
                ]}
              />
            </FilterGroup>
            <FilterGroup title="정렬" count={value.sort ? 1 : 0} defaultOpen onClear={() => update({ sort: '' })}>
              <div style={{ flex: '1 1 100%', width: '100%', minWidth: 0 }}>
                <Select
                  full value={value.sort || ''} onChange={(key) => update({ sort: key })}
                  placeholder="기본"
                  options={FINDER_SORTS}
                />
              </div>
            </FilterGroup>
          </>
        )}
        {popularModels.length > 0 && (
          <FilterGroup title={<>인기차종 <Badge tone="amber" variant="solid">BEST</Badge></>} count={value.models.size} defaultOpen={!draftOpen} first={!draftOpen} onClear={() => update({ models: new Set() })}>
            <ToggleChips selected={value.models} onToggle={(key) => update((current) => ({ ...current, models: toggleInSet(current.models, key) }))} options={popularModels} />
          </FilterGroup>
        )}
        {present.months.length > 0 && (
          <FilterGroup title="기간" count={value.periods.size} defaultOpen onClear={() => update({ periods: new Set() })}>
            <ToggleChips
              selected={new Set([...value.periods].map(String))}
              onToggle={(key) => update((current) => ({ ...current, periods: toggleInSet(current.periods, Number(key)) }))}
              options={operatingMonths(rows).map((month) => {
                const hit = present.months.find((option) => option.key === String(month));
                return { key: String(month), label: hit?.label || `${month}개월` };
              })}
            />
          </FilterGroup>
        )}
        {present.rent.length > 0 && <FilterGroup title="월대여료" count={value.rent.size} defaultOpen onClear={() => update({ rent: new Set() })}><ToggleChips selected={value.rent} onToggle={(key) => update((current) => ({ ...current, rent: toggleInSet(current.rent, key) }))} options={present.rent} /></FilterGroup>}
        {present.dep.length > 0 && <FilterGroup title="보증금" count={value.dep.size} defaultOpen={value.dep.size > 0} onClear={() => update({ dep: new Set() })}><ToggleChips selected={value.dep} onToggle={(key) => update((current) => ({ ...current, dep: toggleInSet(current.dep, key) }))} options={present.dep} /></FilterGroup>}
        {present.hasVehicle && (
          <FilterGroup title="차종(제조사, 모델, 트림 등)" count={vehicleFilterCount(value.vehicle)} defaultOpen onClear={() => update({ vehicle: { ...EMPTY_VEHICLE_FILTER } })}>
            <div style={{ flex: '1 1 100%', width: '100%', minWidth: 0 }}>
              <VehicleMasterFilter products={cascadeProducts} value={value.vehicle} onChange={(vehicle) => update({ vehicle })} />
            </div>
          </FilterGroup>
        )}
        {CAR_DYN_KEYS.map((key) => {
          const definition = DYN.find((item) => item.key === key);
          if (!definition) return null;
          const options = (aggregate[definition.key] || []).map(([entry, count]) => ({ key: entry, label: entry, count }));
          if (!options.length) return null;
          const count = value.dyn[definition.key]?.size || 0;
          return <FilterGroup key={definition.key} title={definition.label} count={count} defaultOpen={count > 0} onClear={() => update((current) => ({ ...current, dyn: { ...current.dyn, [definition.key]: new Set() } }))}><ToggleChips selected={value.dyn[definition.key] || new Set()} onToggle={(entry) => toggleDynamic(definition.key, entry)} options={options} /></FilterGroup>;
        })}
        {present.fuel.length > 0 && <FilterGroup title="연료(동력)" count={value.fuel.size} defaultOpen={value.fuel.size > 0} onClear={() => update({ fuel: new Set() })}><ToggleChips selected={value.fuel} onToggle={(key) => update((current) => ({ ...current, fuel: toggleInSet(current.fuel, key) }))} options={present.fuel} /></FilterGroup>}
        {present.mile.length > 0 && <FilterGroup title="주행거리" count={value.mile.size} defaultOpen={value.mile.size > 0} onClear={() => update({ mile: new Set() })}><ToggleChips selected={value.mile} onToggle={(key) => update((current) => ({ ...current, mile: toggleInSet(current.mile, key) }))} options={present.mile} /></FilterGroup>}
        {present.ptype.length > 0 && <FilterGroup title="상품구분" count={value.ptype.size} defaultOpen={value.ptype.size > 0} onClear={() => update({ ptype: new Set() })}><ToggleChips selected={value.ptype} onToggle={(key) => update((current) => ({ ...current, ptype: toggleInSet(current.ptype, key) }))} options={present.ptype} /></FilterGroup>}
        {present.credit.length > 0 && <FilterGroup title="심사" count={value.credit.size} defaultOpen={value.credit.size > 0} onClear={() => update({ credit: new Set() })}><ToggleChips selected={value.credit} onToggle={(key) => update((current) => ({ ...current, credit: toggleInSet(current.credit, key) }))} options={present.credit} /></FilterGroup>}
        {present.perks.length > 0 && <FilterGroup title="우대조건" count={value.perks.size} defaultOpen={value.perks.size > 0} onClear={() => update({ perks: new Set() })}><ToggleChips selected={value.perks} onToggle={(key) => update((current) => ({ ...current, perks: toggleInSet(current.perks, key) }))} options={present.perks} /></FilterGroup>}
        {present.promo.length > 0 && <FilterGroup title="이벤트" count={value.promo.size} defaultOpen={value.promo.size > 0} onClear={() => update({ promo: new Set() })}><ToggleChips selected={value.promo} onToggle={(key) => update((current) => ({ ...current, promo: toggleInSet(current.promo, key) }))} options={present.promo} /></FilterGroup>}
        {EXTRA_DYN_KEYS.map((key) => {
          const definition = DYN.find((item) => item.key === key);
          if (!definition) return null;
          const options = (aggregate[definition.key] || []).map(([entry, count]) => ({ key: entry, label: entry, count }));
          if (!options.length) return null;
          const count = value.dyn[definition.key]?.size || 0;
          return <FilterGroup key={definition.key} title={definition.label} count={count} defaultOpen={count > 0} onClear={() => update((current) => ({ ...current, dyn: { ...current.dyn, [definition.key]: new Set() } }))}><ToggleChips selected={value.dyn[definition.key] || new Set()} onToggle={(entry) => toggleDynamic(definition.key, entry)} options={options} /></FilterGroup>;
        })}
        {(() => {
          const entries = aggregate.provider || [];
          if (!entries.length) return null;
          const selected = [...(value.dyn.provider || [])][0] || '';
          return (
            <FilterGroup title="공급사" count={selected ? 1 : 0} defaultOpen={!!selected} onClear={() => update((current) => ({ ...current, dyn: { ...current.dyn, provider: new Set() } }))}>
              <div style={{ flex: '1 1 100%', width: '100%', minWidth: 0 }}>
                <Select full value={selected} placeholder="전체" onChange={(entry) => update((current) => ({ ...current, dyn: { ...current.dyn, provider: entry ? new Set([entry]) : new Set() } }))} options={sortProviderOptions(entries)} />
              </div>
            </FilterGroup>
          );
        })()}
      </div>
    </>
  );
}
