'use client';
import { type EntityRecord } from '@/lib/intake/entities';
import { priceList, cheapest } from '@/lib/domain/product';
import { won, C } from '@/components/ui';

// 기간별 대여료 = 단일 규격 원자(카드·리스트 공용).
//   1줄(가로): [최저 개월 뱃지] 76만원 · 보증 120만  ← 카드는 만원 단위 반올림(항상 한 줄, 안 잘림).
//   2줄: 운영 개월 전부 뱃지(최저 강조 색칠, hover=그 기간 정확한 대여료·보증금).
//   정확한 금액은 hover·상세페이지·엑셀에 그대로 살아있음 → 카드 반올림은 정보손실 아님.
const man = (n: number) => Math.round(n / 10000);
const rentMan = (n: number) => `${man(n)}만원`;
const depMan = (n: number) => (n ? `${man(n)}만` : '0');
const badge = (on: boolean) => ({ fontSize: 10.5, fontWeight: on ? 800 : 600, padding: '1px 7px', borderRadius: 3, border: `1px solid ${on ? C.brand : C.line}`, background: on ? C.brand : '#fff', color: on ? '#fff' : C.mute, whiteSpace: 'nowrap' as const, fontVariantNumeric: 'tabular-nums' as const });

export function PeriodPrices({ p }: { p: EntityRecord }) {
  const all = priceList(p);
  if (!all.length) return <div style={{ fontSize: 12, color: C.mute }}>가격 문의</div>;
  const cheap = cheapest(p)!;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden' }}>
        <span style={{ ...badge(true), flex: '0 0 auto' }}>{cheap.m}개월</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: C.brand, fontFamily: 'var(--font-mono)', flex: '0 0 auto' }}>{rentMan(cheap.rent)}</span>
        <span style={{ fontSize: 11, color: C.faint, flex: '0 0 auto' }}>보증 {depMan(cheap.deposit)}</span>
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
        {all.map((pr) => (
          <span key={pr.m} title={`${pr.m}개월 · 월 ${won(pr.rent)}원 · 보증 ${won(pr.deposit)}원`} style={{ ...badge(pr.m === cheap.m), cursor: 'help' }}>{pr.m}</span>
        ))}
      </div>
    </div>
  );
}
