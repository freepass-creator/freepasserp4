'use client';

import { ArrowDownAZ, ArrowUpAZ, Check } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { Btn, ICON, SearchInput } from '@/components/ui';
import { FUEL_TYPES, PRODUCT_TYPES, VEHICLE_STATES } from '@/lib/intake/entities';
import { CREDITS } from '@/lib/domain/product-filters';

export type SheetColumnFilter = Record<number, Set<string>>;
export type SheetSort = { column: number; direction: 'asc' | 'desc' } | null;
export type SheetFilterEntry = { value: string; label: string; count: number };
const EMPTY_SELECTION = new Set<string>();
const POPOVER_GUTTER = 8;
const POPOVER_WIDTH = 304;
const POPOVER_MAX_HEIGHT = 456;
const FOCUSABLE_TARGET = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[contenteditable="true"],[tabindex]:not([tabindex="-1"])';

/** Btn의 기본 중앙 정렬을 이 메뉴의 고정 열 레이아웃으로 명시적으로 덮는다. */
const SORT_COMMAND_STYLE: CSSProperties = {
  display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr) 16px', alignItems: 'center', gap: 8,
  justifyContent: 'normal', width: '100%', padding: '0 12px', textAlign: 'left',
  background: 'var(--fp-sheet-filter-command-bg, transparent)',
  color: 'var(--fp-sheet-filter-command-color, var(--text-main))',
};
const VALUE_BUTTON_STYLE: CSSProperties = {
  display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) auto', alignItems: 'center', gap: 8,
  justifyContent: 'normal', width: '100%', padding: '0 12px', textAlign: 'left',
  background: 'var(--fp-sheet-filter-value-bg, transparent)',
  color: 'var(--fp-sheet-filter-value-color, var(--text-main))',
};
// 버튼의 높이·패딩·모서리는 공용 Btn 규격을 그대로 쓴다. 이 표는 색만 시트의 선택 초록을 쓴다.
const FOOTER_CONFIRM_COLOR: CSSProperties = {
  borderColor: 'var(--fp-sheet-selection)', background: 'var(--fp-sheet-selection)', color: 'var(--text-inverse)',
};

/** 빈 값을 실제 문자열과 충돌하지 않게 필터 키로 보관한다. */
export const SHEET_EMPTY_VALUE = '\u0000';
export const filterValue = (value: string | undefined) => value || SHEET_EMPTY_VALUE;
export const filterLabel = (value: string) => value === SHEET_EMPTY_VALUE ? '(빈칸)' : value;

function shouldRestoreHeaderFocus(target: EventTarget | null): boolean {
  return !(target instanceof Element) || !target.closest(FOCUSABLE_TARGET);
}

const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' });

function rankIn(values: readonly string[], value: string): number | null {
  const index = values.indexOf(value);
  return index >= 0 ? index : null;
}

// 판매시트의 차종구분은 "준중형 SUV"처럼 세그먼트×차형으로 표시된다. 실제 발행값에는
// 세단·MPV·해치백처럼 editor 선택지 밖의 조합도 있으므로, 고정 목록이 아니라 구조로 정렬한다.
const VEHICLE_CLASS_SEGMENTS = ['경형', '소형', '준중형', '중형', '준대형', '대형'] as const;
const VEHICLE_CLASS_BODIES = ['', '세단', 'SUV', 'MPV', 'RV', '픽업', '해치백', '왜건', '쿠페', '승합', '화물'] as const;

function vehicleClassRank(value: string): number | null {
  const compact = value.replace(/\s+/g, '');
  if (compact === '승합') return 8000;
  if (compact === '수입') return 9000;
  const segment = VEHICLE_CLASS_SEGMENTS.findIndex((item) => compact.startsWith(item));
  if (segment < 0) return null;
  const tail = compact.slice(VEHICLE_CLASS_SEGMENTS[segment].length);
  const body = VEHICLE_CLASS_BODIES.indexOf(tail as typeof VEHICLE_CLASS_BODIES[number]);
  return segment * 100 + (body >= 0 ? body : VEHICLE_CLASS_BODIES.length);
}

/**
 * 기존 Excel 필터의 원칙을 raw 판매시트에도 적용한다.
 * - enum/상태처럼 의미 순서가 있는 축은 SSOT 순서
 * - 그 밖의 자유 값은 현재 모수의 많은 값부터
 */
function sheetEntryRank(header: string, value: string): number | null {
  const name = header.replace(/\s+/g, '');
  if (name === '구분' || name === '상품구분' || name === '분류') return rankIn(PRODUCT_TYPES, value);
  if (name === '배차상태' || name === '차량상태' || name === '상품상태' || name === '상태') return rankIn(VEHICLE_STATES, value);
  if (name === '연료' || name === '연료(정제)') return rankIn(FUEL_TYPES, value);
  if (name === '심사조건') return rankIn(CREDITS, value);
  if (name === '차종구분' || name === '차종분류') return vehicleClassRank(value);
  if (name === '연식' || name === '년식') {
    const year = Number(value.match(/(?:19|20)\d{2}/)?.[0]);
    return Number.isFinite(year) ? -year : null; // 최신 연식부터
  }
  return null;
}

export function orderSheetFilterEntries(header: string, entries: SheetFilterEntry[]): SheetFilterEntry[] {
  return [...entries].sort((a, b) => {
    // 빈칸은 선택은 가능하되 항상 맨 끝에 둔다.
    if (a.value === SHEET_EMPTY_VALUE || b.value === SHEET_EMPTY_VALUE) {
      return a.value === b.value ? 0 : (a.value === SHEET_EMPTY_VALUE ? 1 : -1);
    }
    const aRank = sheetEntryRank(header, a.value);
    const bRank = sheetEntryRank(header, b.value);
    if (aRank !== null || bRank !== null) {
      if (aRank === null) return 1;
      if (bRank === null) return -1;
      if (aRank !== bRank) return aRank - bRank;
    }
    return b.count - a.count || collator.compare(a.label, b.label);
  });
}

type Props = {
  column: number;
  label: string;
  x: number;
  y: number;
  entries: SheetFilterEntry[];
  selected?: Set<string>;
  sort: SheetSort;
  /** 확인한 값 집합만 표에 적용한다. */
  onChange: (selection: Set<string> | null) => void;
  onSort: (sort: SheetSort) => void;
  onClose: () => void;
  /** 바깥 클릭이 focusable 제어인지도 함께 알려, 빈 셀에서만 헤더 focus를 안전하게 복귀한다. */
  onDismiss: (restoreHeaderFocus: boolean) => void;
};

/**
 * 문자열 격자 전용 헤더 필터. 기존 ExcelFilterPopover는 EntityRecord/가격 규칙에 묶여 있어
 * 판매시트의 실제 열 순서·값을 그대로 쓰는 이 표에는 재사용하지 않는다.
 */
export function SheetColumnFilterPopover({
  column, label, x, y, entries, selected, sort, onChange, onSort, onClose, onDismiss,
}: Props) {
  const popoverRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target)) return;
      // 헤더 trigger는 스스로 toggle/switch한다. 여기서 먼저 닫으면 같은 클릭이 두 번
      // 상태를 바꾸거나 새 열 popover를 열지 못할 수 있다.
      if (target instanceof Element && target.closest('[id^="fp-sheet-filter-"][aria-haspopup="dialog"]')) return;
      onDismiss(shouldRestoreHeaderFocus(target));
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    return () => document.removeEventListener('pointerdown', dismissOutside, true);
  }, [onDismiss]);

  const [query, setQuery] = useState('');
  // Excel처럼 메뉴 안에서는 임시 선택만 바꾸고, 확인할 때에만 상위 표를 갱신한다.
  // 열을 바꾸거나 이미 적용된 필터가 달라지면 다음 메뉴의 초깃값도 동기화한다.
  const [draftSelection, setDraftSelection] = useState<Set<string>>(() => new Set(selected || EMPTY_SELECTION));
  useEffect(() => {
    setDraftSelection(new Set(selected || EMPTY_SELECTION));
  }, [column, selected]);
  const selectedValues = draftSelection;
  const normalized = query.toLocaleLowerCase('ko-KR');
  // ExcelFilterPopover와 같이 표시문구와 실제 필터 키 모두에서 찾는다.
  const shown = entries.filter((entry) => !query
    || entry.label.toLocaleLowerCase('ko-KR').includes(normalized)
    || entry.value.toLocaleLowerCase('ko-KR').includes(normalized));
  const activeSort = sort?.column === column ? sort.direction : null;
  const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
  const popoverWidth = Math.min(POPOVER_WIDTH, Math.max(0, viewportWidth - POPOVER_GUTTER * 2));
  const popoverHeight = Math.min(POPOVER_MAX_HEIGHT, Math.max(0, viewportHeight - POPOVER_GUTTER * 2));
  const left = Math.max(POPOVER_GUTTER, Math.min(x, Math.max(POPOVER_GUTTER, viewportWidth - popoverWidth - POPOVER_GUTTER)));
  const top = Math.max(POPOVER_GUTTER, Math.min(y + 2, Math.max(POPOVER_GUTTER, viewportHeight - popoverHeight - POPOVER_GUTTER)));

  const toggle = (value: string) => {
    setDraftSelection((current) => {
      const next = new Set(current);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  };
  const confirm = () => {
    // 빈 선택은 이 열의 필터를 해제해 전체 값을 다시 보이는 뜻이다.
    onChange(draftSelection.size ? new Set(draftSelection) : null);
    onClose();
  };
  const sortBy = (direction: 'asc' | 'desc') => onSort(activeSort === direction ? null : { column, direction });

  return (
    <>
      <section
        ref={popoverRef}
        id="fp-sheet-column-filter"
        className="fp-sheet-filter-popover"
        role="dialog"
        aria-label={`${label} 필터`}
        style={{ left, top }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <div className="fp-sheet-filter-popover__sorts" role="group" aria-label={`${label} 정렬`}>
          <Btn type="button" variant="bare" className="fp-sheet-filter-popover__sort-command" style={SORT_COMMAND_STYLE} data-active={activeSort === 'asc' ? 'true' : undefined} aria-pressed={activeSort === 'asc'} onClick={() => sortBy('asc')}>
            <ArrowDownAZ className="fp-sheet-filter-popover__sort-icon" size={ICON.sm} aria-hidden />
            <span>정렬, 오름차순</span>
            {activeSort === 'asc' ? <Check className="fp-sheet-filter-popover__sort-check" size={ICON.sm} aria-hidden /> : <span aria-hidden />}
          </Btn>
          <Btn type="button" variant="bare" className="fp-sheet-filter-popover__sort-command" style={SORT_COMMAND_STYLE} data-active={activeSort === 'desc' ? 'true' : undefined} aria-pressed={activeSort === 'desc'} onClick={() => sortBy('desc')}>
            <ArrowUpAZ className="fp-sheet-filter-popover__sort-icon" size={ICON.sm} aria-hidden />
            <span>정렬, 내림차순</span>
            {activeSort === 'desc' ? <Check className="fp-sheet-filter-popover__sort-check" size={ICON.sm} aria-hidden /> : <span aria-hidden />}
          </Btn>
        </div>
        <div className="fp-sheet-filter-popover__values-heading">
          <span>값별 필터링</span>
          <span className="fp-sheet-filter-popover__selection-state" aria-live="polite">{selectedValues.size ? `${selectedValues.size}개 값 선택` : '전체 표시'}</span>
          <span aria-live="polite">{shown.length}개 표시 중</span>
        </div>
        <div className="fp-sheet-filter-popover__search">
          <SearchInput value={query} onChange={setQuery} placeholder="값 검색" full autoFocus />
        </div>
        <div className="fp-sheet-filter-popover__values">
          {shown.length ? shown.map((entry) => {
            const checked = selectedValues.has(entry.value);
            return (
              <Btn
                key={entry.value}
                type="button"
                variant="bare"
                className="fp-sheet-filter-popover__value"
                style={VALUE_BUTTON_STYLE}
                data-active={checked ? 'true' : undefined}
                aria-pressed={checked}
                onClick={() => toggle(entry.value)}
              >
                <span className="fp-sheet-filter-popover__checkmark" data-active={checked ? 'true' : undefined} aria-hidden>{checked ? <Check size={13} /> : null}</span>
                <span title={entry.label}>{entry.label}</span>
                <small>{entry.count}</small>
              </Btn>
            );
          }) : <p className="fp-sheet-filter-popover__empty">일치하는 값이 없습니다.</p>}
        </div>
        <footer className="fp-sheet-filter-popover__actions">
          <Btn type="button" variant="ghost" onClick={onClose}>취소</Btn>
          <Btn type="button" variant="solid" style={FOOTER_CONFIRM_COLOR} onClick={confirm}>확인</Btn>
        </footer>
      </section>
    </>
  );
}
