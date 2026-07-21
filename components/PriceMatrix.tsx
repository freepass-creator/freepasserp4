'use client';
import { useState, type CSSProperties } from 'react';
import { C, R, NUM, Input, Btn, IconBtn, thFlat, thFlatR } from '@/components/ui';
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

export function PriceMatrix({ price, onChange }: { price: unknown; onChange: (p: Record<string, Cell>) => void }) {
  const mobile = useIsMobile();
  const p: Record<string, Cell> = price && typeof price === 'object' ? { ...(price as Record<string, Cell>) } : {};
  const [extraM, setExtraM] = useState('');
  const [hint, setHint] = useState('');

  const keys = orderKeys(Array.from(new Set([
    ...STD,
    ...Object.keys(p).filter((k) => !k.includes('_') && isOperatedPeriod(Number(k))),
  ])));

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
  const fs = mobile ? 13.5 : 12.5;

  const cellInp = (filledRent: boolean): CSSProperties => ({
    textAlign: 'right',
    fontFamily: NUM,
    fontWeight: filledRent ? 800 : 600,
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
                    <span style={{
                      fontWeight: 700, color: C.ink, fontFamily: NUM, fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}>
                      {k}<span style={{ fontWeight: 600, color: C.mute, fontSize: mobile ? 12 : 11 }}>개월</span>
                    </span>
                    {isCheap && (
                      <span style={{
                        flex: '0 0 auto', fontSize: 9.5, fontWeight: 800, color: '#fff',
                        background: C.brand, borderRadius: R, padding: '1px 5px', lineHeight: 1.2,
                      }}>최저</span>
                    )}
                    {custom && (
                      <span style={{ marginLeft: 'auto', flex: '0 0 auto' }}>
                        <IconBtn title={`${k}개월 삭제`} onClick={() => removeExtra(k)}>
                          <X size={14} />
                        </IconBtn>
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ padding: cellPad, verticalAlign: 'middle', background: rentN > 0 ? 'transparent' : undefined }}>
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
                </td>
                <td style={{ padding: cellPad, verticalAlign: 'middle' }}>
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: mobile ? '10px 12px' : '8px 10px',
        borderTop: `1px solid ${C.line}`, background: C.head,
      }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.mute, flex: '0 0 auto' }}>별도기간</span>
        <Input
          inputMode="numeric"
          placeholder="6"
          value={extraM}
          onChange={(v) => { setExtraM(v); setHint(''); }}
          onEnter={addExtra}
          width={64}
          size="sm"
          style={{ textAlign: 'right', fontFamily: NUM }}
        />
        <span style={{ fontSize: 12, color: C.mute }}>개월</span>
        <Btn size="sm" variant="ghost" onClick={addExtra}>추가</Btn>
        {hint ? (
          <span style={{ fontSize: 11.5, color: C.danger, width: '100%' }}>{hint}</span>
        ) : (
          <span style={{ fontSize: 11, color: C.faint, flex: '1 1 120px', minWidth: 0 }}>
            대여료 넣은 기간만 매물에 노출
          </span>
        )}
      </div>
    </div>
  );
}
