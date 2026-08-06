'use client';

import { useMemo, useState, type MouseEvent } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { excelMonths } from '@/lib/domain/product-filters';
import { ExcelResultsTable, type ExcelOpenCol } from '@/features/finder/ExcelResultsTable';
import { CardSpecs, CardThumb } from '@/components/product-card-atoms';
import { vehicleName } from '@/lib/domain/product';
import type { ColSort } from '@/features/finder/excel-columns';
import { C, R, FS, FW, ICON, Btn, IconSeg, CenterNote, Select } from '@/components/ui';
import { LayoutGrid, Table } from 'lucide-react';

/**
 * 동기화 미리보기 — 시트에서 «들어올» 매물을 실제 목록 화면 그대로 본다.
 *
 * 검증 결과가 「올림 346 · 신규 18 · 수정 262」 같은 숫자 요약뿐이라, 그게 어떤 차인지도
 * 우리 규격에 맞게 변환됐는지도 눈으로 확인할 방법이 없었다. 그래서 반영하고 나서야
 * 「제조사가 비었네」 「사진이 안 왔네」를 알았다.
 *
 * 여기서는 **영업자가 보게 될 바로 그 화면**으로 그린다 — 엑셀 보기는 `ExcelResultsTable`,
 * 간단 보기는 목록 카드다. 별도 표를 새로 그리면 「미리보기에선 멀쩡했는데」가 반복된다.
 * 사진은 엑셀 보기에 열이 없으므로 간단 보기로 확인한다.
 */
export function SyncPreview({
  products,
  sources,
  emptyNote = '먼저 「데이터 검증」을 실행하세요.',
}: {
  products: EntityRecord[];
  /** 공급사별로 좁혀 보기 — 어느 회사 시트가 비어 들어오는지는 섞어 놓으면 안 보인다. */
  sources?: Array<{ code: string; label: string; products: EntityRecord[] }>;
  emptyNote?: string;
}) {
  const [view, setView] = useState<'excel' | 'card'>('excel');
  const [source, setSource] = useState('');
  const [colFilter, setColFilter] = useState<Record<string, Set<string>>>({});
  const [colSort, setColSort] = useState<ColSort>(null);
  const [openCol, setOpenCol] = useState<ExcelOpenCol>(null);
  // 카드 한 장마다 드라이브 폴더를 서버에서 풀어 사진을 찾는다(/api/extract-photos).
  // 100장을 한 번에 띄우면 그만큼 긁는다 — 간단 보기는 적게 시작하고 더보기로 늘린다.
  const [limit, setLimit] = useState(100);
  const step = view === 'card' ? 24 : 200;

  const list = useMemo(
    () => (source && sources ? (sources.find((s) => s.code === source)?.products ?? []) : products),
    [source, sources, products],
  );
  const months = useMemo(() => excelMonths(list), [list]);
  const shown = useMemo(() => list.slice(0, limit), [list, limit]);

  /** 규격 적합도 — 반영 전에 «무엇이 비어 들어오는지»를 먼저 알려준다. */
  const gaps = useMemo(() => {
    const s = (v: unknown) => String(v ?? '').trim();
    return {
      noName: list.filter((p) => !s(p.maker) && !s(p.model)).length,
      noPlate: list.filter((p) => !s(p.car_number)).length,
      noPhoto: list.filter((p) => !s(p.photo_link)).length,
      review: list.filter((p) => p._needs_master_review === true).length,
      noPolicy: list.filter((p) => !s(p.policy_code)).length,
    };
  }, [list]);

  if (!products.length) return <CenterNote>{emptyNote}</CenterNote>;

  const chip = (label: string, n: number, total: number) => (
    <span
      key={label}
      style={{
        fontSize: FS.cap,
        color: n ? C.warn : C.mute,
        border: `1px solid ${C.line}`,
        borderRadius: R,
        padding: '3px 8px',
        background: C.taupeBg,
      }}
    >
      {label} <b style={{ fontWeight: FW.title }}>{n}</b>/{total}
    </span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: FS.sub, color: C.mute }}>
          들어올 상품 <b style={{ color: C.ink, fontWeight: FW.title }}>{list.length.toLocaleString()}</b>대
          {source ? <span style={{ color: C.faint }}> / 전체 {products.length.toLocaleString()}</span> : null}
        </span>
        {sources && sources.length > 1 ? (
          <Select
            value={source}
            onChange={(v) => { setSource(v); setLimit(100); }}
            style={{ maxWidth: 220 }}
            options={[
              { value: '', label: `공급사 전체 (${products.length})` },
              ...sources.map((s) => ({ value: s.code, label: `${s.label} (${s.products.length})` })),
            ]}
          />
        ) : null}
        <div style={{ marginLeft: 'auto' }}>
          <IconSeg
            showLabel
            value={view}
            onChange={(v) => { setView(v); setLimit(v === 'card' ? 24 : 100); }}
            options={[
              { key: 'excel' as const, label: '엑셀', icon: <Table size={ICON.md} aria-hidden /> },
              { key: 'card' as const, label: '간단', icon: <LayoutGrid size={ICON.md} aria-hidden /> },
            ]}
          />
        </div>
      </div>

      {/* 규격 적합도 — 반영 전에 무엇이 비어 들어오는지 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {chip('제조사·차명 없음', gaps.noName, list.length)}
        {chip('차번 없음', gaps.noPlate, list.length)}
        {chip('사진 없음', gaps.noPhoto, list.length)}
        {chip('차종 검수', gaps.review, list.length)}
        {chip('정책 없음', gaps.noPolicy, list.length)}
      </div>

      {view === 'excel' ? (
        <ExcelResultsTable
          rows={shown}
          list={list}
          months={months}
          filterOpen={false}
          colFilter={colFilter}
          setColFilter={setColFilter}
          colSort={colSort}
          setColSort={setColSort}
          openCol={openCol}
          setOpenCol={setOpenCol}
          onRowClick={() => { /* 미리보기 — 아직 저장 전이라 상세로 못 간다 */ }}
          onRowContextMenu={(e: MouseEvent) => e.preventDefault()}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {shown.map((p, i) => (
            <div
              key={String(p.product_code || p._key || i)}
              style={{ border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', background: C.bg }}
            >
              {/* 사진은 엑셀 보기에 열이 없다 — 간단 보기로만 확인된다. 목록 카드와 같은 썸네일을 쓴다. */}
              <CardThumb p={p} audience="admin" fill marks={false} />
              <div style={{ padding: '8px 10px 10px', minWidth: 0 }}>
                <div style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {vehicleName(p) || '(차종 미확정)'}
                </div>
                <div style={{ fontSize: FS.cap, color: C.faint, marginTop: 2 }}>
                  {String(p.car_number || '') || '차번 없음'}
                </div>
                <CardSpecs p={p} dense audience="admin" />
              </div>
            </div>
          ))}
        </div>
      )}

      {list.length > shown.length && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
          <Btn size="sm" variant="ghost" onClick={() => setLimit((n) => n + step)}>
            더보기 ({shown.length.toLocaleString()}/{list.length.toLocaleString()})
          </Btn>
        </div>
      )}
    </div>
  );
}
