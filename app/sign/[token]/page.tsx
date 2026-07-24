'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { seedIfEmpty } from '@/lib/seed';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import { getContractByToken, submitSign } from '@/lib/domain/sign';
import { won, C, R, Input, fmtPhone, Loading, Btn, FW, FS } from '@/components/ui';
import { toast } from '@/components/Toaster';

// 손님 전자서명 페이지(공개·화이트라벨). 계약요약 → 본인확인 → 약관동의 → 전자서명 → 제출(검토대기).
const CONSENTS = ['렌터카 대여 계약 약관', '개인정보 수집·이용', '신용정보 조회·제공', '차량 위치(GPS) 수집', '자동결제(CMS) 출금'];

export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const co = getCompanyId();
  const [c, setC] = useState<EntityRecord | null | undefined>(undefined);
  const [form, setForm] = useState({ customer_name: '', customer_phone: '', customer_id: '', customer_address: '', driver_license_no: '', emergency_name: '', emergency_phone: '' });
  const [consents, setConsents] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);

  useEffect(() => { (async () => { await seedIfEmpty(co); setC(await getContractByToken(String(token))); })(); /* eslint-disable-next-line */ }, [token]);

  const pos = (e: PointerEvent) => { const cv = canvasRef.current!; const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) }; };
  const start = (e: React.PointerEvent) => { drawing.current = true; const ctx = canvasRef.current!.getContext('2d')!; const { x, y } = pos(e.nativeEvent); ctx.beginPath(); ctx.moveTo(x, y); canvasRef.current!.setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; e.preventDefault(); const ctx = canvasRef.current!.getContext('2d')!; const { x, y } = pos(e.nativeEvent); ctx.lineTo(x, y); ctx.strokeStyle = '#0f1830'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); inked.current = true; };
  const end = () => { drawing.current = false; };
  const clearSig = () => { const cv = canvasRef.current; if (cv) cv.getContext('2d')!.clearRect(0, 0, cv.width, cv.height); inked.current = false; };

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const allC = CONSENTS.every((x) => consents.has(x));
  const toggle = (x: string) => setConsents((s) => { const n = new Set(s); n.has(x) ? n.delete(x) : n.add(x); return n; });

  const submit = async () => {
    if (!form.customer_name.trim() || !form.customer_phone.trim()) { toast('성명·연락처를 입력하세요', 'error'); return; }
    if (!allC) { toast('모든 약관에 동의해야 진행됩니다', 'error'); return; }
    if (!inked.current) { toast('전자서명을 해주세요', 'error'); return; }
    setBusy(true);
    try {
      const signature = canvasRef.current!.toDataURL('image/png');
      await submitSign(String(c!.contract_code), { ...form, signature, consents: [...consents] }, String(token));
      setC(await getContractByToken(String(token)));
      toast('제출되었습니다. 확인 후 안내드립니다.', 'ok');
    } finally { setBusy(false); }
  };

  const wrap: CSSProperties = { maxWidth: 560, margin: '0 auto', padding: '18px 16px 60px' };
  if (c === undefined) return <Loading />;
  if (!c) return <main style={wrap}><h1 style={{ fontSize: FS.page }}>유효하지 않은 링크</h1><p style={{ color: C.mute, fontSize: FS.body }}>서명 링크가 만료되었거나 잘못되었습니다. 담당자에게 문의해 주세요.</p></main>;

  const st = String(c.sign_status || '');
  if (st === '검토대기' || st === '서명완료') return (
    <main style={wrap}>
      <div style={{ textAlign: 'center', padding: '40px 0' }}>
        <div style={{ fontSize: 40 }}>✓</div>
        <h1 style={{ fontSize: FS.page, fontWeight: FW.title, margin: '8px 0 4px' }}>{st === '서명완료' ? '서명이 완료되었습니다' : '제출이 접수되었습니다'}</h1>
        <p style={{ color: C.mute, fontSize: FS.body }}>{st === '서명완료' ? '계약이 확정되었습니다.' : '담당자 확인 후 계약이 확정됩니다. 잠시만 기다려 주세요.'}</p>
      </div>
    </main>
  );

  const inpStyle: CSSProperties = { display: 'block', marginTop: 4 };
  const label: CSSProperties = { fontSize: FS.sub, color: C.mute, fontWeight: FW.strong };

  return (
    <main style={wrap}>
      <div style={{ fontSize: FS.sub, color: C.mute, letterSpacing: '0.04em' }}>렌터카 대여 계약 · 전자서명</div>
      <h1 style={{ fontSize: FS.page, fontWeight: FW.title, letterSpacing: '-0.02em', margin: '4px 0 12px' }}>{String(c.vehicle_name_snapshot || c.sub_model_snapshot || '차량')}</h1>
      {c.reject_reason || c.sign_reject_reason ? (
        <div style={{ margin: '0 0 12px', padding: '10px 12px', borderRadius: R, background: C.warnBg, color: C.warn, fontSize: FS.sub, fontWeight: FW.strong }}>
          이전 제출이 반려되었습니다{String(c.reject_reason || c.sign_reject_reason) ? ` — ${String(c.reject_reason || c.sign_reject_reason)}` : ''}. 정보를 확인해 다시 작성해 주세요.
        </div>
      ) : null}

      <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: '#fff', overflow: 'hidden', marginBottom: 18 }}>
        {[['차량', [c.car_number_snapshot, c.sub_model_snapshot].filter(Boolean).join(' · ')], ['대여기간', `${c.rent_month_snapshot || '—'}개월`], ['월 대여료', `${won(c.rent_amount_snapshot)}원`], ['보증금', `${won(c.deposit_amount_snapshot)}원`]].map(([k, v], i) => (
          <div key={String(k)} style={{ display: 'flex', padding: '10px 14px', borderTop: i ? `1px solid ${C.line2}` : 'none' }}>
            <span style={{ width: 90, flex: '0 0 90px', color: C.mute, fontSize: FS.body }}>{k}</span>
            <span style={{ fontSize: FS.body, fontWeight: FW.strong, color: C.ink }}>{String(v) || '—'}</span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: FS.title, fontWeight: FW.title, marginBottom: 8 }}>계약자 정보</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        <label style={label}>성명 *<Input value={form.customer_name} onChange={(v) => set('customer_name', v)} full style={inpStyle} /></label>
        <label style={label}>연락처 *<Input value={form.customer_phone} onChange={(v) => set('customer_phone', fmtPhone(v))} inputMode="tel" full style={inpStyle} /></label>
        <label style={label}>주민등록번호<Input value={form.customer_id} onChange={(v) => set('customer_id', v)} inputMode="numeric" placeholder="본인확인용" full style={inpStyle} /></label>
        <label style={label}>운전면허번호<Input value={form.driver_license_no} onChange={(v) => set('driver_license_no', v)} full style={inpStyle} /></label>
        <label style={label}>주소<Input value={form.customer_address} onChange={(v) => set('customer_address', v)} full style={inpStyle} /></label>
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ ...label, flex: 1 }}>비상연락 성명<Input value={form.emergency_name} onChange={(v) => set('emergency_name', v)} full style={inpStyle} /></label>
          <label style={{ ...label, flex: 1 }}>비상연락처<Input value={form.emergency_phone} onChange={(v) => set('emergency_phone', fmtPhone(v))} inputMode="tel" full style={inpStyle} /></label>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: FS.title, fontWeight: FW.title, flex: 1 }}>약관 동의</span>
        <Btn size="sm" variant={allC ? 'solid' : 'ghost'} onClick={() => setConsents(allC ? new Set() : new Set(CONSENTS))}>전체 동의</Btn>
      </div>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: '#fff', overflow: 'hidden', marginBottom: 20 }}>
        {CONSENTS.map((x, i) => {
          const on = consents.has(x);
          return (
            <Btn
              key={x}
              full
              variant={on ? 'solid' : 'ghost'}
              onClick={() => toggle(x)}
              style={{
                justifyContent: 'flex-start',
                borderRadius: 0,
                border: 'none',
                borderTop: i ? `1px solid ${C.line2}` : 'none',
                boxShadow: 'none',
                height: 'auto',
                minHeight: 44,
                padding: '11px 14px',
                whiteSpace: 'normal',
                fontWeight: on ? FW.head : FW.meta,
              }}
            >
              <span style={{ flex: '0 0 18px', fontFamily: 'var(--font-mono)' }}>{on ? '✓' : ''}</span>
              <span style={{ textAlign: 'left' }}>{x} <span style={{ color: on ? 'rgba(255,255,255,0.85)' : C.danger }}>(필수)</span></span>
            </Btn>
          );
        })}
      </div>

      <div style={{ fontSize: FS.title, fontWeight: FW.title, marginBottom: 8, display: 'flex', alignItems: 'center' }}>전자서명 <span style={{ flex: 1 }} /><Btn size="sm" variant="ghost" onClick={clearSig}>지우기</Btn></div>
      <canvas ref={canvasRef} width={600} height={180} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
        style={{ width: '100%', height: 'auto', aspectRatio: '600 / 180', border: `1.5px dashed ${C.line}`, borderRadius: R, background: '#fff', touchAction: 'none', cursor: 'crosshair' }} />
      <div style={{ fontSize: FS.cap, color: C.faint, marginTop: 4 }}>위 칸에 손가락 또는 마우스로 서명해 주세요.</div>

      <div style={{ marginTop: 22 }}><Btn onClick={submit} disabled={busy}>{busy ? '제출 중…' : '동의하고 서명 제출'}</Btn></div>
      <div style={{ marginTop: 12, fontSize: FS.cap, color: C.faint, lineHeight: 1.6 }}>제출 시 위 약관에 동의하고 전자서명한 것으로 간주됩니다. 입력 정보는 계약·본인확인 목적에만 사용됩니다.</div>
    </main>
  );
}
