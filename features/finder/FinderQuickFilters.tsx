'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { aggregateDyn, aggregateVehicleCascade, EMPTY_VEHICLE_FILTER, presentFilterOptions } from '@/lib/domain/product-filters';
import { normalizeVehicleFilter } from '@/lib/domain/vehicle-master-match';
import { colorSwatch } from '@/lib/domain/color-master';
import { toggleInSet } from '@/lib/set';
import { Btn, CountPill, C, FS, FW, ICON, IconBtn, SectionLabel, ToggleChips } from '@/components/ui';
import type { FilterBag } from './filter-state';
import { FinderFilterPanel, type FinderFilterPanelModel } from './FinderFilterPanel';

type QuickKey = 'vehicle' | 'color' | 'period' | 'rent' | 'dep' | 'mile' | 'fuel' | 'year' | 'perk' | 'credit';
type Update = (patch: Partial<FilterBag> | ((current: FilterBag) => FilterBag)) => void;

/**
 * 상품찾기 퀵필터 한 줄(기본 노출).
 * 맨 앞 「세부」= 사이드 대신 떠 있는 메뉴로 전체 조건 패널.
 * 모델·색상·기간·대여료·보증금·주행거리·연식·연료·우대·심사 — 드롭다운.
 */
export function FinderQuickFilters({ value, present, products, update, onReset, filterOpen, onToggleFilter, onCloseFilter, sidebarActiveCount, detailPanel }: {
  value: FilterBag;
  present: ReturnType<typeof presentFilterOptions>;
  products: EntityRecord[];
  update: Update;
  onReset: () => void;
  /** 세부 조건 메뉴 열림. */
  filterOpen: boolean;
  onToggleFilter: () => void;
  onCloseFilter: () => void;
  sidebarActiveCount: number;
  detailPanel: FinderFilterPanelModel;
}) {
  const [open, setOpen] = useState<QuickKey | null>(null);
  const [openRight, setOpenRight] = useState(false);
  const [detailBox, setDetailBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const detailAnchor = useRef<HTMLSpanElement>(null);
  const wraps = useRef<Partial<Record<QuickKey, HTMLDivElement | null>>>({});
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(null);
        onCloseFilter();
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [onCloseFilter]);

  const placeDetail = useCallback(() => {
    const el = detailAnchor.current;
    if (!el || !filterOpen) {
      setDetailBox(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 24);
    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - 12 - width);
    setDetailBox({ top: Math.round(rect.bottom + 4), left: Math.round(left), width });
  }, [filterOpen]);

  useEffect(() => {
    placeDetail();
    if (!filterOpen) return;
    const on = () => placeDetail();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
    };
  }, [filterOpen, placeDetail]);

  const dynamic = useMemo(() => aggregateDyn(products), [products]);
  const vehicle = useMemo(() => normalizeVehicleFilter(value.vehicle), [value.vehicle]);
  const vehicleTree = useMemo(() => aggregateVehicleCascade(products, {
    ...vehicle, model: [], sub_model: [], variant: [], trim_name: [],
  }), [products, vehicle]);

  const categories: { key: QuickKey; label: string; count: number }[] = [
    { key: 'vehicle', label: '모델', count: vehicle.maker.length + vehicle.model.length },
    { key: 'color', label: '색상', count: (value.dyn.ext_color?.size || 0) + (value.dyn.int_color?.size || 0) },
    { key: 'period', label: '기간', count: value.periods.size },
    { key: 'rent', label: '대여료', count: value.rent.size },
    { key: 'dep', label: '보증금', count: value.dep.size },
    { key: 'mile', label: '주행거리', count: value.mile.size },
    { key: 'year', label: '연식', count: value.dyn.year?.size || 0 },
    { key: 'fuel', label: '연료', count: value.fuel.size },
    { key: 'perk', label: '우대조건', count: value.perks.size },
    { key: 'credit', label: '심사조건', count: value.credit.size },
  ];

  const options = open === 'period' ? present.months
    : open === 'rent' ? present.rent
      : open === 'dep' ? present.dep
        : open === 'mile' ? present.mile
          : open === 'fuel' ? present.fuel
            : open === 'perk' ? present.perks
              : open === 'credit' ? present.credit
                : open === 'year' ? (dynamic.year || []).map(([key, count]) => ({ key, label: key, count }))
                  : [];
  const selected: Set<string> = open === 'period' ? new Set([...value.periods].map(String))
    : open === 'rent' ? value.rent
      : open === 'dep' ? value.dep
        : open === 'mile' ? value.mile
          : open === 'fuel' ? value.fuel
            : open === 'perk' ? value.perks
              : open === 'credit' ? value.credit
                : open === 'year' ? (value.dyn.year || new Set())
                  : new Set();

  const toggleRange = (key: string) => update((current) => {
    if (open === 'period') return { ...current, periods: toggleInSet(current.periods, Number(key)) };
    if (open === 'rent') return { ...current, rent: toggleInSet(current.rent, key) };
    if (open === 'dep') return { ...current, dep: toggleInSet(current.dep, key) };
    if (open === 'mile') return { ...current, mile: toggleInSet(current.mile, key) };
    if (open === 'fuel') return { ...current, fuel: toggleInSet(current.fuel, key) };
    if (open === 'perk') return { ...current, perks: toggleInSet(current.perks, key) };
    if (open === 'credit') return { ...current, credit: toggleInSet(current.credit, key) };
    const values = toggleInSet(current.dyn.year || new Set(), key);
    return { ...current, dyn: { ...current.dyn, year: values } };
  });

  const toggleColor = (field: 'ext_color' | 'int_color', key: string) => update((current) => ({
    ...current,
    dyn: { ...current.dyn, [field]: toggleInSet(current.dyn[field] || new Set(), key) },
  }));
  const toggleVehicle = (field: 'maker' | 'model', key: string) => update((current) => {
    const selectedVehicle = normalizeVehicleFilter(current.vehicle);
    const values = toggleInSet(new Set(selectedVehicle[field]), key);
    return {
      ...current,
      models: new Set(),
      vehicle: field === 'maker'
        ? { ...selectedVehicle, maker: [...values], model: [], sub_model: [], variant: [], trim_name: [] }
        : { ...selectedVehicle, model: [...values], sub_model: [], variant: [], trim_name: [] },
    };
  });

  const openCategory = (key: QuickKey) => {
    const rect = wraps.current[key]?.getBoundingClientRect();
    setOpenRight(Boolean(rect && rect.left + 310 > window.innerWidth - 8));
    onCloseFilter();
    setOpen(open === key ? null : key);
  };

  const toggleDetail = () => {
    setOpen(null);
    onToggleFilter();
  };

  const clearCategory = (key: QuickKey) => update((current) => {
    if (key === 'vehicle') {
      return { ...current, models: new Set(), vehicle: { ...EMPTY_VEHICLE_FILTER } };
    }
    if (key === 'color') {
      const dyn = { ...current.dyn };
      delete dyn.ext_color;
      delete dyn.int_color;
      return { ...current, dyn };
    }
    if (key === 'period') return { ...current, periods: new Set() };
    if (key === 'rent') return { ...current, rent: new Set() };
    if (key === 'dep') return { ...current, dep: new Set() };
    if (key === 'mile') return { ...current, mile: new Set() };
    if (key === 'fuel') return { ...current, fuel: new Set() };
    if (key === 'perk') return { ...current, perks: new Set() };
    if (key === 'credit') return { ...current, credit: new Set() };
    const dyn = { ...current.dyn };
    delete dyn.year;
    return { ...current, dyn };
  });

  return (
    <div className="fp-quick-filter-bar" ref={root} role="group" aria-label="퀵필터">
      <span className="fp-quick-filter-wrap" ref={detailAnchor} style={{ position: 'relative', flex: '0 0 auto' }}>
        <Btn
          size="sm"
          variant={filterOpen || sidebarActiveCount > 0 ? 'solid' : 'ghost'}
          aria-pressed={filterOpen}
          title={filterOpen ? '세부 닫기' : (sidebarActiveCount ? `조건 ${sidebarActiveCount}개 · 세부` : '세부')}
          onClick={toggleDetail}
        >
          <SlidersHorizontal size={ICON.sm} aria-hidden />
          세부
        </Btn>
        {sidebarActiveCount > 0 ? (
          <span className="fp-quick-filter-count"><CountPill n={sidebarActiveCount} /></span>
        ) : null}
        {filterOpen && detailBox ? (
          <div
            className="fp-quick-filter-detail"
            role="dialog"
            aria-label="세부 조건"
            style={{ top: detailBox.top, left: detailBox.left, width: detailBox.width }}
          >
            <FinderFilterPanel model={detailPanel} />
          </div>
        ) : null}
      </span>
      {categories.map((category) => (
        <div
          className="fp-quick-filter-wrap"
          key={category.key}
          ref={(node) => { wraps.current[category.key] = node; }}
        >
          <Btn
            variant={category.count ? 'solid' : 'ghost'}
            size="sm"
            aria-pressed={category.count > 0}
            onClick={() => openCategory(category.key)}
          >
            {category.label}
            {category.count ? <span className="fp-quick-filter-count"><CountPill n={category.count} /></span> : null}
            <ChevronDown size={ICON.sm} />
          </Btn>
          {open === category.key ? (
            <div className={`fp-quick-filter-popover${openRight ? ' is-right' : ''}`}>
              <header>
                <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {category.label}
                  {category.count > 0 ? (
                    <Btn
                      variant="bare"
                      size="sm"
                      title="해제"
                      haptic="select"
                      onClick={() => clearCategory(category.key)}
                      style={{ color: C.accent }}
                    >
                      해제
                    </Btn>
                  ) : null}
                </strong>
                <IconBtn title="닫기" onClick={() => setOpen(null)}><X size={ICON.sm} /></IconBtn>
              </header>
              {category.key === 'vehicle' ? (
                <div className="fp-quick-filter-sections">
                  <section>
                    <SectionLabel mt={0} mb={0}>제조사 · 복수 선택</SectionLabel>
                    <ToggleChips
                      selected={new Set(vehicle.maker)}
                      onToggle={(key) => toggleVehicle('maker', key)}
                      options={vehicleTree.makers.flatMap((group) => group.options).map((option) => ({
                        key: option.value, label: option.value, count: option.count,
                      }))}
                    />
                  </section>
                  {vehicle.maker.length ? (
                    <section>
                      <SectionLabel mt={0} mb={0}>모델 · 복수 선택</SectionLabel>
                      <ToggleChips
                        selected={new Set(vehicle.model)}
                        onToggle={(key) => toggleVehicle('model', key)}
                        options={vehicleTree.models.map((option) => ({
                          key: option.value, label: option.value, count: option.count,
                        }))}
                      />
                    </section>
                  ) : null}
                </div>
              ) : category.key === 'color' ? (
                <div className="fp-quick-filter-sections">
                  <section>
                    <div className="fp-quick-filter-section-head">
                      <SectionLabel mt={0} mb={0}>외장</SectionLabel>
                      {(value.dyn.ext_color?.size || 0) > 0 ? <CountPill n={value.dyn.ext_color!.size} /> : null}
                      <span style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.meta }}>차체 색</span>
                    </div>
                    <ToggleChips
                      selected={value.dyn.ext_color || new Set()}
                      onToggle={(key) => toggleColor('ext_color', key)}
                      options={(dynamic.ext_color || []).map(([key, count]) => ({
                        key, label: key, count, swatch: colorSwatch(key),
                      }))}
                    />
                  </section>
                  <section>
                    <div className="fp-quick-filter-section-head">
                      <SectionLabel mt={0} mb={0}>내장</SectionLabel>
                      {(value.dyn.int_color?.size || 0) > 0 ? <CountPill n={value.dyn.int_color!.size} /> : null}
                      <span style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.meta }}>실내 색</span>
                    </div>
                    <ToggleChips
                      selected={value.dyn.int_color || new Set()}
                      onToggle={(key) => toggleColor('int_color', key)}
                      options={(dynamic.int_color || []).map(([key, count]) => ({
                        key, label: key, count, swatch: colorSwatch(key),
                      }))}
                    />
                  </section>
                </div>
              ) : (
                <ToggleChips selected={selected} onToggle={toggleRange} options={options} />
              )}
            </div>
          ) : null}
        </div>
      ))}
      <span style={{ marginLeft: 'auto', flex: '0 0 auto' }}>
        <Btn
          size="sm"
          variant={sidebarActiveCount > 0 ? 'solid' : 'ghost'}
          disabled={sidebarActiveCount <= 0}
          title="필터 초기화"
          onClick={onReset}
        >
          <RotateCcw size={ICON.sm} aria-hidden />
          초기화
        </Btn>
      </span>
    </div>
  );
}
