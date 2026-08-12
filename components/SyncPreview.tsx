'use client';

import { useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { excelMonths } from '@/lib/domain/product-filters';
import { ExcelResultsTable, type ExcelOpenCol } from '@/features/finder/ExcelResultsTable';
import { CardSpecs, CardThumb } from '@/components/product-card-atoms';
import { vehicleName } from '@/lib/domain/product';
import { vehicleIdentityLine } from '@/lib/domain/vehicle-master-match';
import {
  buildMasterIndex,
  classifyMasterMisfit,
  MASTER_MISFIT_LABEL,
  type MasterMisfitKind,
} from '@/lib/domain/master-misfit';
import type { ColSort } from '@/features/finder/excel-columns';
import { C, R, FS, FW, ICON, Btn, IconSeg, CenterNote, Select, Badge } from '@/components/ui';
import { LayoutGrid, Table, ListTree } from 'lucide-react';

type PreviewView = 'atom' | 'excel' | 'card';

type SnapDefaults = { seats?: boolean; drive_type?: boolean };

function S(v: unknown) {
  return String(v ?? '').trim();
}

function atomStatus(p: EntityRecord): { label: string; tone: 'green' | 'amber' | 'red' | 'gray'; reason?: string } {
  const conf = S(p._snap_confidence);
  const review = p._needs_master_review === true;
  if (!p._snapped && !conf) return { label: '미매칭', tone: 'red' };
  if (conf === 'high' || conf === 'medium') {
    if (review) return { label: '검수', tone: 'amber', reason: '차종 검수 표시' };
    return { label: '확정', tone: 'green' };
  }
  if (conf === 'low' || review) return { label: '검수', tone: 'amber' };
  return { label: '미매칭', tone: 'red' };
}

function withDefault(value: string, inferred?: boolean) {
  if (!value) return '미입력';
  return inferred ? `${value}(조합)` : value;
}

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
 * 원자 보기는 원문차명→마스터 확정·기본 조합 선택을 스캔용으로만 보여 준다(엑셀 표는 건드리지 않음).
 */
export function SyncPreview({
  products,
  sources,
  masterEntries,
  emptyNote = '먼저 「데이터 검증」을 실행하세요.',
}: {
  products: EntityRecord[];
  /** 공급사별로 좁혀 보기 — 어느 회사 시트가 비어 들어오는지는 섞어 놓으면 안 보인다. */
  sources?: Array<{ code: string; label: string; products: EntityRecord[] }>;
  /** 검수 사유(classifyMasterMisfit)용 — 없으면 상태 뱃지만. */
  masterEntries?: Array<{ maker: string; model: string; sub_model?: string }>;
  emptyNote?: string;
}) {
  const [view, setView] = useState<PreviewView>('atom');
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
  const masterIndex = useMemo(
    () => (masterEntries?.length ? buildMasterIndex(masterEntries as never[]) : null),
    [masterEntries],
  );

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

  const th: CSSProperties = {
    textAlign: 'left',
    fontSize: FS.micro,
    color: C.mute,
    fontWeight: FW.title,
    padding: '6px 8px',
    borderBottom: `1px solid ${C.line}`,
    whiteSpace: 'nowrap',
    background: C.taupeBg,
    position: 'sticky',
    top: 0,
    zIndex: 1,
  };
  const td: CSSProperties = {
    fontSize: FS.cap,
    color: C.ink,
    padding: '5px 8px',
    borderBottom: `1px solid ${C.line}`,
    verticalAlign: 'top',
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

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
              { key: 'atom' as const, label: '원자', icon: <ListTree size={ICON.md} aria-hidden /> },
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

      {view === 'atom' ? (
        <div style={{ overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: R, maxHeight: 480 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 960 }}>
            <thead>
              <tr>
                <th style={th}>원문차명</th>
                <th style={th}>확정 세부모델</th>
                <th style={th}>파워트레인</th>
                <th style={th}>트림</th>
                <th style={th}>연료</th>
                <th style={th}>배기</th>
                <th style={th}>인승</th>
                <th style={th}>구동</th>
                <th style={th}>상태</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p, i) => {
                const defaults = (p._snap_defaults || {}) as SnapDefaults;
                const st = atomStatus(p);
                let reason = st.reason;
                if (masterIndex && (st.label === '검수' || st.label === '미매칭')) {
                  const kind = classifyMasterMisfit(p, masterIndex, S(p._snap_confidence) || undefined) as MasterMisfitKind;
                  if (kind !== 'fit') reason = MASTER_MISFIT_LABEL[kind];
                }
                const raw = vehicleIdentityLine(p) || S((p._raw_vehicle as { model?: unknown } | undefined)?.model) || '—';
                return (
                  <tr key={String(p.product_code || p._key || i)} style={{ background: i % 2 ? C.zebra : undefined }}>
                    <td style={td} title={raw}>{raw}</td>
                    <td style={td} title={S(p.sub_model)}>{S(p.sub_model) || '미입력'}</td>
                    <td style={td} title={S(p.variant)}>{S(p.variant) || '미입력'}</td>
                    <td style={td} title={S(p.trim_name)}>{S(p.trim_name) || '미입력'}</td>
                    <td style={td}>{S(p.fuel_type) || '미입력'}</td>
                    <td style={td}>{S(p.engine_cc) || '미입력'}</td>
                    <td style={td}>{withDefault(S(p.seats), defaults.seats)}</td>
                    <td style={td}>{withDefault(S(p.drive_type), defaults.drive_type)}</td>
                    <td style={{ ...td, whiteSpace: 'normal', maxWidth: 160 }}>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {reason ? (
                        <div style={{ fontSize: FS.micro, color: C.faint, marginTop: 2 }}>{reason}</div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : view === 'excel' ? (
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
