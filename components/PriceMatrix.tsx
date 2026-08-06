'use client';
import { useState, type CSSProperties } from 'react';
import { C, R, NUM, FW, FS, Input, Btn, thFlat, thFlatR, ICON } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { PERIODS as STD_PERIODS, isOperatedPeriod, isStandardPeriod } from '@/lib/domain/product';
import { X } from 'lucide-react';

/**
 * 대여료·보증금 편집 = 상세(/m) 요금표와 같은 표 언어.
 * 기간 | 월대여료 | 보증금 — 표로 스캔, 칸 안 Input. 섹션 라벨은 페이지.
 */
const STD = STD_PERIODS.map(String);
const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^\d]/g, '')); return isNaN(n) ? 0 : n; };
const fmt = (n: number) => (n ? n.toLocaleString() : '');
type Cell = { rent?: number; deposit?: number; fee?: number };

function orderKeys(keys: string[]): string[] {
  const nums = keys.map(Number).filter(isOperatedPeriod);
  const std = STD_PERIODS.filter((m) => nums.includes(m)).map(String);
  const extra = nums.filter((m) => !isStandardPeriod(m)).sort((a, b) => a - b).map(String);
  return [...std, ...extra];
}

export function PriceMatrix({ price, onChange, readOnly = false }: { price: unknown; onChange: (p: Record<string, Cell>) => void; readOnly?: boolean }) {
  const mobile = useIsMobile();
  const p: Record<string, Cell> = price && typeof price === 'object' ? { ...(price as Record<string, Cell>) } : {};
  const [extraM, setExtraM] = useState('');
  const [hint, setHint] = useState('');

  const editableKeys = orderKeys(Array.from(new Set([
    ...STD,
    ...Object.keys(p).filter((k) => !k.includes('_') && isOperatedPeriod(Number(k))),
  ])));
  // 조회 화면은 실제 등록된 기간만 보여 B2B 스캔 밀도를 지킨다. 편집 화면은 표준 기간 전체를 유지한다.
  const keys = readOnly
    ? editableKeys.filter((key) => Number(p[key]?.rent || 0) > 0 || Number(p[key]?.deposit || 0) > 0)
    : editableKeys;

  // 최저가 행 하이라이트(대여료 > 0 중)
  const filled = keys
    .map((k) => ({ k, rent: p[k]?.rent || 0 }))
    .filter((x) => x.rent > 0);
  const cheapK = filled.length
    ? filled.reduce((a, b) => (b.rent < a.rent ? b : a)).k
    : null;

  const setCell = (k: string, field: 'rent' | 'deposit', v: string) => {
    onChange({ ...p, [k]: { ...(p[k] || {}), [field]: num(v) } });
  };

  const addExtra = () => {
    const m = num(extraM);
    if (!isOperatedPeriod(m) || !Number.isInteger(m)) {
      setHint('1 이상 정수 개월을 입력하세요');
      return;
    }
    if (m > 120) {
      setHint('120개월 이하로 입력하세요');
      return;
    }
    const k = String(m);
    if (keys.includes(k)) {
      setHint(isStandardPeriod(m) ? '표준 기간은 이미 있습니다' : '이미 추가된 기간입니다');
      return;
    }
    onChange({ ...p, [k]: { ...(p[k] || {}), rent: p[k]?.rent || 0, deposit: p[k]?.deposit || 0 } });
    setExtraM('');
    setHint('');
  };

  const removeExtra = (k: string) => {
    if (isStandardPeriod(Number(k))) return;
    const next = { ...p };
    delete next[k];
    onChange(next);
  };

  const padX = mobile ? 10 : 10;
  const padY = mobile ? 6 : 4;
  const cellPad = `${padY}px ${padX}px`;
  const fs = mobile ? FS.body : FS.sub;

  const cellInp = (filledRent: boolean): CSSProperties => ({
    textAlign: 'right',
    fontFamily: NUM,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: FW.head,
    color: filledRent ? C.brand : C.ink,
    border: 'none',
    borderRadius: 0,
    background: 'transparent',
    boxShadow: 'none',
    padding: '0 4px',
    width: '100%',
  });

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', background: C.taupeBg }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: fs }}>
        <colgroup>
          <col style={{ width: mobile ? '26%' : '24%' }} />
          <col style={{ width: mobile ? '37%' : '38%' }} />
          <col style={{ width: mobile ? '37%' : '38%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ ...thFlat, padding: cellPad }}>기간</th>
            <th style={{ ...thFlatR, padding: cellPad }}>월대여료</th>
            <th style={{ ...thFlatR, padding: cellPad }}>보증금</th>
          </tr>
        </thead>
        <tbody>
          {readOnly && keys.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ padding: '14px 12px', textAlign: 'center', color: C.faint }}>등록된 금액 없음</td>
            </tr>
          ) : null}
          {keys.map((k, i) => {
            const custom = !isStandardPeriod(Number(k));
            const rentN = p[k]?.rent || 0;
            const depN = p[k]?.deposit || 0;
            const isCheap = cheapK === k;
            return (
              <tr
                key={k}
                style={{
                  borderTop: i ? `1px solid ${C.line2}` : 'none',
                  background: isCheap ? C.selected : (i % 2 ? C.zebra : C.taupeBg),
                }}
              >
                <td style={{ padding: cellPad, verticalAlign: 'middle' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                    {/* 「최저」 배지는 flex:0 0 auto라 축소가 안 된다 — 개월 텍스트가 안 줄면 배지가 셀 밖으로 밀려
                        그 행만 우측 여백이 깎였다. 축소 부담은 텍스트가 진다. */}
                    <span style={{
                      fontWeight: FW.head, color: C.ink, fontFamily: NUM, fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden',
                    }}>
                      {k}<span style={{ fontWeight: FW.strong, color: C.mute, fontSize: mobile ? FS.sub : FS.cap }}>개월</span>
                    </span>
                    {isCheap && (
                      <span style={{
                        flex: '0 0 auto', fontSize: FS.micro, fontWeight: FW.label, color: C.taupeBg,
                        background: C.brand, borderRadius: R, padding: '1px 5px', lineHeight: 1.2,
                      }}>최저</span>
                    )}
                    {custom && !readOnly && (
                      <span style={{ marginLeft: 'auto', flex: '0 0 auto' }}>
                        <Btn variant="bare" title={`${k}개월 삭제`} onClick={() => removeExtra(k)} aria-label={`${k}개월 삭제`}>
                          <X size={ICON.md} aria-hidden />
                        </Btn>
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ padding: cellPad, verticalAlign: 'middle', background: rentN > 0 ? 'transparent' : undefined }}>
                  {readOnly ? (
                    <span style={{ display: 'block', textAlign: 'right', fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.head, color: rentN > 0 ? C.brand : C.faint }}>
                      {fmt(rentN) || '—'}
                    </span>
                  ) : (
                    <Input
                      full
                      size={mobile ? 'md' : 'sm'}
                      inputMode="numeric"
                      placeholder="입력"
                      value={fmt(rentN)}
                      onChange={(v) => setCell(k, 'rent', v)}
                      style={{
                        ...cellInp(rentN > 0),
                        background: rentN > 0 ? 'transparent' : C.head,
                      }}
                    />
                  )}
                </td>
                <td style={{ padding: cellPad, verticalAlign: 'middle' }}>
                  {readOnly ? (
                    <span style={{ display: 'block', textAlign: 'right', fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontWeight: FW.head, color: depN > 0 ? C.ink : C.faint }}>
                      {fmt(depN) || '—'}
                    </span>
                  ) : (
                    <Input
                      full
                      size={mobile ? 'md' : 'sm'}
                      inputMode="numeric"
                      placeholder="입력"
                      value={fmt(depN)}
                      onChange={(v) => setCell(k, 'deposit', v)}
                      style={{
                        ...cellInp(false),
                        background: depN > 0 ? 'transparent' : C.head,
                      }}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!readOnly ? <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: mobile ? '10px 12px' : '8px 10px',
        borderTop: `1px solid ${C.line}`, background: C.head,
      }}>
        <span style={{ fontSize: FS.cap, fontWeight: FW.strong, color: C.mute, flex: '0 0 auto' }}>별도기간</span>
        <Input
          inputMode="numeric"
          placeholder="6"
          value={extraM}
          onChange={(v) => { setExtraM(v); setHint(''); }}
          onEnter={addExtra}
          width={64}
          size="sm"
          style={{ textAlign: 'right', fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}
        />
        <span style={{ fontSize: FS.sub, color: C.mute }}>개월</span>
        <Btn title="별도 기간 추가" size="sm" variant="ghost" onClick={addExtra}>추가</Btn>
        {hint ? (
          <span style={{ fontSize: FS.cap, color: C.danger, width: '100%' }}>{hint}</span>
        ) : (
          <span style={{ fontSize: FS.cap, color: C.faint, flex: '1 1 120px', minWidth: 0 }}>
            대여료 넣은 기간만 매물에 노출
          </span>
        )}
      </div> : null}
    </div>
  );
}
