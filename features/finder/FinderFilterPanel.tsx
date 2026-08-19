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
import { Badge, Btn, C, CountPill, FilterGroup, FS, FW, Select, ToggleChips, ctrlH } from '@/components/ui';
import type { FilterBag, InterestKey } from './filter-state';
import type { FinderFilterPreset } from '@/lib/finder-filter-presets';

type FilterUpdate = Partial<FilterBag> | ((current: FilterBag) => FilterBag);

/** 칩 옵션 — 대상 대수 없이, 선택 중인 값은 모수에 없어도 유지 표시. */
function chipOpts(
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
  /** 축만(즐겨찾기 저장 가능 여부). interest·정렬·엑셀 제외. */
  presetSaveCount: number;
  draftOpen: boolean;
  value: FilterBag;
  rows: EntityRecord[];
  cascadeProducts: EntityRecord[];
  popularModels: { key: string; label: string; count?: number }[];
  present: ReturnType<typeof presentFilterOptions>;
  aggregate: ReturnType<typeof aggregateDyn>;
  recentCount: number;
  favoriteCount: number;
  presets: FinderFilterPreset[];
  activePresetId: string | null;
  onSavePreset: () => void;
  onApplyPreset: (id: string) => void;
  onRemovePreset: (id: string) => void;
  update: (patch: FilterUpdate) => void;
  reset: () => void;
  clearRecent: () => void;
  clearFavorites: () => void;
};

export function FinderFilterPanel({ model }: { model: FinderFilterPanelModel }) {
  const {
    mobile, totalVisible, foundCount, searching, activeCount, presetSaveCount, draftOpen, value, cascadeProducts,
    popularModels, present, aggregate, recentCount, favoriteCount,
    presets, activePresetId, onSavePreset, onApplyPreset, onRemovePreset,
    update, reset, clearRecent, clearFavorites,
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
        <FilterGroup
          title="즐겨찾는 조건"
          count={activePresetId ? 1 : 0}
          defaultOpen
          first
          actions={(() => {
            const height = ctrlH(mobile);
            const style = {
              marginLeft: 4, flex: '0 0 auto', fontSize: mobile ? FS.sub : FS.cap,
              fontWeight: FW.strong, minHeight: height, minWidth: 40,
              padding: mobile ? '0 8px' : '0 6px',
            };
            return (
              <>
                {activePresetId ? (
                  <Btn
                    variant="bare"
                    title="즐겨찾기 삭제"
                    haptic="impact"
                    onClick={() => { onRemovePreset(activePresetId); }}
                    style={{ ...style, color: C.mute }}
                  >
                    삭제
                  </Btn>
                ) : null}
                <Btn
                  variant="bare"
                  title="현재 조건 저장"
                  haptic="select"
                  disabled={presetSaveCount <= 0}
                  onClick={() => { onSavePreset(); }}
                  style={{ ...style, color: presetSaveCount > 0 ? C.accent : C.mute }}
                >
                  저장
                </Btn>
              </>
            );
          })()}
        >
          {presets.length > 0 ? (
            <ToggleChips
              selected={activePresetId ? new Set<string>([activePresetId]) : new Set<string>()}
              onToggle={(id) => { onApplyPreset(id); }}
              options={presets.map((preset) => ({ key: preset.id, label: preset.label }))}
            />
          ) : (
            <span style={{ fontSize: FS.cap, color: C.faint, lineHeight: 1.45 }}>
              조건을 켠 뒤 저장하면 여기에 모입니다
            </span>
          )}
        </FilterGroup>
        {draftOpen && (
          <>
            <FilterGroup
              title="최근·관심"
              count={value.interest.size}
              defaultOpen
              actions={(() => {
                const height = ctrlH(mobile);
                const style = {
                  marginLeft: 4, flex: '0 0 auto', fontSize: mobile ? FS.sub : FS.cap,
                  fontWeight: FW.strong, minHeight: height, minWidth: 40,
                  padding: mobile ? '0 8px' : '0 6px',
                };
                if (value.interest.size > 0) {
                  return <Btn variant="bare" title="해제" haptic="select" onClick={() => update({ interest: new Set() })} style={{ ...style, color: C.accent }}>해제</Btn>;
                }
                return <>
                  <Btn variant="bare" title="최근 비우기" haptic="impact" disabled={recentCount === 0} onClick={clearRecent} style={{ ...style, color: C.mute }}>최근 비우기</Btn>
                  <Btn variant="bare" title="관심 비우기" haptic="impact" disabled={favoriteCount === 0} onClick={clearFavorites} style={{ ...style, color: C.mute }}>관심 비우기</Btn>
                </>;
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
            <FilterGroup title="정렬" count={value.sort !== FINDER_DEFAULT_SORT ? 1 : 0} defaultOpen onClear={() => update({ sort: FINDER_DEFAULT_SORT })}>
              <div style={{ flex: '1 1 100%', width: '100%', minWidth: 0 }}>
                <Select
                  full value={value.sort || FINDER_DEFAULT_SORT} onChange={(key) => update({ sort: key })}
                  options={FINDER_SORTS}
                />
              </div>
            </FilterGroup>
          </>
        )}
        {(popularOpts.length > 0) && (
          <FilterGroup title={<>인기차종 <Badge tone="amber" variant="solid">BEST</Badge></>} count={value.models.size} defaultOpen={!draftOpen} onClear={() => update({ models: new Set() })}>
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
      </div>
    </>
  );
}
