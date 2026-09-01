'use client';

import { useMemo } from 'react';
import {
  aggregateVehicleCascade, EMPTY_VEHICLE_FILTER, normalizeVehicleFilter, type VehicleFilter,
} from '@/lib/domain/product-filters';
import { toggleInSet } from '@/lib/set';
import { Badge, Btn, C, CountPill, FilterChips, FS, FW, ToggleChips } from '@/components/ui';
import { FINDER_DEFAULT_SORT, FINDER_SORTS } from './filter-state';
import { chipOpts, type FinderFilterPanelModel } from './FinderFilterPanel';

/**
 * ★모바일 빠른필터 — 하단 「검색」 탭이 여는 시트의 몸통.
 *
 * 사장님 2026-08-30 「빠른 필터로 찾아서 찍을 수 있게끔 모바일에 특화된 걸로 …
 * **섹션으로 이렇게 하는 게 아니라** … 제일 많이 쓸만한 것만 딱 정리해서 우루룩」.
 *
 *   · **접이식이 아니다.** 웹 사이드바(`FinderFilterPanel`)는 축이 열 몇 개라 `FilterGroup`(접이식)으로
 *     접어 뒀다. 폰에서 그 방식이면 «펴고 → 찍고 → 접고»가 축마다 반복된다 —
 *     엄지로 훑으며 연달아 찍는 동작이 안 나온다. 여기는 **전부 펼친 칩 줄**을 세로로 쌓고 한 번에 스크롤한다.
 *   · **축을 줄였다.** 영업자가 손님 앞에서 실제로 좁히는 것만 —
 *     인기차종 · 제조사 · 모델 · 월대여료 · 보증금 · 주행거리 · 연식 · 연료 · 심사 · 우대조건 · 정렬.
 *     ⚠ 웹에만 남긴 것: 기간 · 상품구분 · 이벤트 · 외부/내부색상 · 차종분류 · 약정주행 · 공급사.
 *       (폰에서 안 쓰는 축이다. 필요해지면 여기 한 줄 추가 — 웹 패널은 손대지 않는다.)
 *   · 「만21세」·「경력무관」은 **심사가 아니라 우대조건**에 있다(PERKS SSOT) — 사장님이 말한
 *     「21세 되는지, 운전 경력 1년 미만인지」가 그 두 칩이다.
 *   · 값·집계·초기화는 웹과 «같은 모델»(`FinderFilterPanelModel`)을 쓴다. 규격이 갈라지면 웹에서 건 조건이
 *     폰에서 안 보이는 «숨은 필터»가 생긴다.
 */
export function FinderMobileFilters({ model }: { model: FinderFilterPanelModel }) {
  const { value, cascadeProducts, popularModels, present, aggregate, update } = model;

  const vsel = useMemo(() => normalizeVehicleFilter(value.vehicle), [value.vehicle]);
  const tree = useMemo(() => aggregateVehicleCascade(cascadeProducts, vsel), [cascadeProducts, vsel]);
  const maker = vsel.maker[0] || '';
  const carModel = vsel.model[0] || '';

  /** 한 단을 고르면 아래 단은 지운다 — 남기면 «있을 수 없는 조합»이 남는다(VehicleMasterFilter 와 같은 규칙). */
  const pickMaker = (v: string) => update({
    vehicle: { ...EMPTY_VEHICLE_FILTER, maker: v ? [v] : [] } satisfies VehicleFilter,
  });
  const pickModel = (v: string) => update({
    vehicle: { ...EMPTY_VEHICLE_FILTER, maker: vsel.maker, model: v ? [v] : [] } satisfies VehicleFilter,
  });

  /** ★모든 칩은 chipOpts 를 통과한다 — 고른 값이 모수에서 빠져도 칩이 남아야 «숨은 필터»가 안 생긴다. */
  const yearSel = value.dyn.year || new Set<string>();
  const yearOpts = chipOpts((aggregate.year || []).map(([key]) => ({ key, label: key })), yearSel);
  const popularOpts = chipOpts(popularModels, value.models);
  const rentOpts = chipOpts(present.rent, value.rent);
  const depOpts = chipOpts(present.dep, value.dep);
  const mileOpts = chipOpts(present.mile, value.mile);
  const fuelOpts = chipOpts(present.fuel, value.fuel);
  const creditOpts = chipOpts(present.credit, value.credit);
  const perksOpts = chipOpts(present.perks, value.perks);

  // 제조사 = 국산/수입 묶음을 펼쳐 대수순 한 줄로. 폰에서는 묶음 제목이 줄만 늘린다.
  const makerOpts = tree.makers.flatMap((g) => g.options).map((o) => ({ key: o.value, label: o.value }));
  const modelOpts = tree.models.map((o) => ({ key: o.value, label: o.value }));

  return (
    <div>
      <Row title={<>인기차종 <Badge tone="amber" variant="solid">BEST</Badge></>} count={value.models.size} onClear={() => update({ models: new Set() })} show={popularOpts.length > 0}>
        <ToggleChips
          selected={value.models}
          onToggle={(key) => update((cur) => ({ ...cur, models: toggleInSet(cur.models, key) }))}
          options={popularOpts}
        />
      </Row>

      {/* 제조사·모델 = 한 단에 하나(칩 재클릭 = 해제). 웹은 드롭다운이지만 폰에서는 칩이 빠르다. */}
      <Row title="제조사" count={maker ? 1 : 0} onClear={() => pickMaker('')} show={makerOpts.length > 0}>
        <FilterChips value={maker} onChange={pickMaker} options={makerOpts} clearKey="" />
      </Row>
      <Row title="모델" count={carModel ? 1 : 0} onClear={() => pickModel('')} show={!!maker && modelOpts.length > 0}>
        <FilterChips value={carModel} onChange={pickModel} options={modelOpts} clearKey="" />
      </Row>

      <Row title="월대여료" count={value.rent.size} onClear={() => update({ rent: new Set() })} show={rentOpts.length > 0}>
        <ToggleChips selected={value.rent} onToggle={(key) => update((cur) => ({ ...cur, rent: toggleInSet(cur.rent, key) }))} options={rentOpts} />
      </Row>
      <Row title="보증금" count={value.dep.size} onClear={() => update({ dep: new Set() })} show={depOpts.length > 0}>
        <ToggleChips selected={value.dep} onToggle={(key) => update((cur) => ({ ...cur, dep: toggleInSet(cur.dep, key) }))} options={depOpts} />
      </Row>
      <Row title="주행거리" count={value.mile.size} onClear={() => update({ mile: new Set() })} show={mileOpts.length > 0}>
        <ToggleChips selected={value.mile} onToggle={(key) => update((cur) => ({ ...cur, mile: toggleInSet(cur.mile, key) }))} options={mileOpts} />
      </Row>
      <Row title="연식" count={yearSel.size} onClear={() => update((cur) => ({ ...cur, dyn: { ...cur.dyn, year: new Set() } }))} show={yearOpts.length > 0}>
        <ToggleChips
          selected={yearSel}
          onToggle={(key) => update((cur) => ({ ...cur, dyn: { ...cur.dyn, year: toggleInSet(cur.dyn.year || new Set(), key) } }))}
          options={yearOpts}
        />
      </Row>
      <Row title="연료" count={value.fuel.size} onClear={() => update({ fuel: new Set() })} show={fuelOpts.length > 0}>
        <ToggleChips selected={value.fuel} onToggle={(key) => update((cur) => ({ ...cur, fuel: toggleInSet(cur.fuel, key) }))} options={fuelOpts} />
      </Row>

      <Row title="심사" count={value.credit.size} onClear={() => update({ credit: new Set() })} show={creditOpts.length > 0}>
        <ToggleChips selected={value.credit} onToggle={(key) => update((cur) => ({ ...cur, credit: toggleInSet(cur.credit, key) }))} options={creditOpts} />
      </Row>
      <Row title="우대조건" count={value.perks.size} onClear={() => update({ perks: new Set() })} show={perksOpts.length > 0}>
        <ToggleChips selected={value.perks} onToggle={(key) => update((cur) => ({ ...cur, perks: toggleInSet(cur.perks, key) }))} options={perksOpts} />
      </Row>

      {/* 정렬은 조건이 아니지만 여기 둔다 — 폰에 정렬 자리가 여기밖에 없다(툴바를 없앴다). */}
      <Row title="정렬" count={value.sort !== FINDER_DEFAULT_SORT ? 1 : 0} onClear={() => update({ sort: FINDER_DEFAULT_SORT })} show last>
        <FilterChips
          value={value.sort || FINDER_DEFAULT_SORT}
          onChange={(key) => update({ sort: key })}
          options={FINDER_SORTS.map((o) => ({ key: o.value, label: o.label }))}
          clearKey={FINDER_DEFAULT_SORT}
        />
      </Row>
    </div>
  );
}

/** 한 줄 = 제목(+걸린 개수·해제) + 칩 밭. 접히지 않는다 — 이 화면의 요점이다. */
function Row({ title, count, onClear, show, last, children }: {
  title: React.ReactNode;
  count: number;
  onClear: () => void;
  show: boolean;
  last?: boolean;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <section style={{ padding: '13px 16px', borderBottom: last ? 'none' : `1px solid ${C.line2}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9, minWidth: 0 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: FS.body, fontWeight: FW.title, color: C.ink, letterSpacing: '-0.02em',
        }}>{title}</span>
        {count > 0 ? <CountPill n={count} /> : null}
        <span style={{ flex: 1 }} />
        {count > 0 ? (
          <Btn variant="bare" size="sm" haptic="select" title="해제" onClick={onClear}>해제</Btn>
        ) : null}
      </div>
      {children}
    </section>
  );
}
