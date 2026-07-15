'use client';
import { useState, type CSSProperties } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { priceList } from '@/lib/domain/product';
import { createContractRequest } from '@/lib/domain/deal';
import { Btn, won, C } from '@/components/ui';

// 계약 요청 = 인라인 폼(오버레이 아님). 그 자리에서 입력·취소. /m·소통 계약패널 공용.
export function ContractRequestForm({ p, roomId, deliveryResponse, onDone, onCancel }: { p: EntityRecord; roomId?: string; deliveryResponse?: string; onDone?: (code: string) => void; onCancel: () => void }) {
  const [form, setForm] = useState<{ period: number; name: string; phone: string }>({ period: 0, name: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const prices = priceList(p);
  const submit = async () => {
    if (!form.period || !form.name.trim()) { alert('기간과 계약자명을 입력하세요.'); return; }
    setBusy(true);
    const code = await createContractRequest(p, { period: form.period, customerName: form.name.trim(), customerPhone: form.phone.trim() }, roomId, deliveryResponse);
    onDone?.(code);
  };
  const inp: CSSProperties = { display: 'block', width: '100%', marginTop: 3, height: 34, padding: '0 9px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 13, boxSizing: 'border-box' };
  return (
    <div style={{ border: `1px solid ${C.brand}`, borderRadius: 4, background: '#f8fbff', padding: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.brand }}>계약 요청</div>
      <label style={{ fontSize: 11.5, color: C.mute }}>기간
        <select value={form.period} onChange={(e) => setForm({ ...form, period: Number(e.target.value) })} style={inp}>
          <option value={0}>기간 선택</option>
          {prices.map((pr) => <option key={pr.m} value={pr.m}>{pr.m}개월 · 월 {won(pr.rent)} · 보증 {won(pr.deposit)}</option>)}
        </select>
      </label>
      <label style={{ fontSize: 11.5, color: C.mute }}>계약자명<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inp} /></label>
      <label style={{ fontSize: 11.5, color: C.mute }}>연락처<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="010-0000-0000" style={inp} /></label>
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <Btn size="sm" onClick={submit} disabled={busy}>계약요청 생성</Btn>
        <Btn variant="ghost" size="sm" onClick={onCancel}>취소</Btn>
      </div>
    </div>
  );
}
