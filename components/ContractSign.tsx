'use client';
import { useEffect, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, type Role } from '@/lib/domain/deal';
import { createSignToken, approveSign, rejectSign } from '@/lib/domain/sign';
import { readContractSign, signPublicToContract } from '@/lib/firebase/contract-sign-public';
import { Btn, C, toneText, FW, FS } from '@/components/ui';
import { toast } from '@/components/Toaster';

// 계약서 서명 진행(계약 패널) — 발송 → 손님(/sign) → 검토대기 → 승인. 공개 슬롯(contract_sign) 상태 병합.
export function ContractSign({ contractCode }: { contractCode: string }) {
  const co = getCompanyId();
  const [c, setC] = useState<EntityRecord | null>(null);
  const [role, setRole] = useState<Role>('agent');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const row = await getStore().get('contract', co, contractCode);
    if (!row) { setC(null); return; }
    const token = String(row.sign_token || '');
    if (token) {
      try {
        const pub = await readContractSign(token);
        if (pub) {
          const m = signPublicToContract(pub);
          setC({
            ...row,
            sign_status: m.sign_status || row.sign_status,
            sign_signature: m.sign_signature || row.sign_signature,
            customer_name: m.customer_name || row.customer_name,
            customer_phone: m.customer_phone || row.customer_phone,
          });
          return;
        }
      } catch { /* 공개 슬롯 없으면 contract만 */ }
    }
    setC(row);
  };
  useEffect(() => { setRole(getRole()); load(); /* eslint-disable-next-line */ }, [contractCode]);
  useEffect(() => { const on = (e: Event) => setRole((e as CustomEvent).detail as Role); window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); }, []);

  if (!c) return null;
  const st = String(c.sign_status || '미발송');
  const canAct = role === 'agent' || role === 'admin';
  const linkOf = () => `${location.origin}/sign/${c.sign_token}`;
  const send = async () => { setBusy(true); try { const token = await createSignToken(c); await navigator.clipboard?.writeText(`${location.origin}/sign/${token}`).catch(() => {}); await load(); toast('계약서 링크 복사됨 — 손님에게 전달하세요', 'ok'); } finally { setBusy(false); } };
  const copy = async () => { await navigator.clipboard?.writeText(linkOf()).catch(() => {}); toast('링크 복사됨', 'ok'); };
  const approve = async () => { setBusy(true); try { await approveSign(c); await load(); toast('승인 — 계약 진행됨', 'ok'); } catch (e) { toast('승인 실패: ' + ((e as Error)?.message || ''), 'error'); } finally { setBusy(false); } };
  const reject = async () => {
    const reason = typeof window !== 'undefined' ? window.prompt('반려 사유(손님에게 표시 · 선택):', '') : '';
    if (reason === null) return; // 취소
    setBusy(true);
    try { await rejectSign(c, reason || ''); await load(); toast('반려 — 손님이 다시 서명하도록 재개방됨', 'ok'); }
    catch (e) { toast('반려 실패: ' + ((e as Error)?.message || ''), 'error'); }
    finally { setBusy(false); }
  };
  const stColor = st === '서명완료' ? C.ok : st === '검토대기' ? toneText('amber') : st === '발송' ? toneText('blue') : C.faint;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: FS.cap, fontWeight: FW.title, color: C.ink }}>계약서 서명</span>
        <span style={{ fontSize: FS.micro, fontWeight: FW.label, color: stColor }}>{st}</span>
        <span style={{ flex: 1 }} />
        {canAct && st === '미발송' && <Btn size="sm" onClick={send} disabled={busy}>계약서 발송</Btn>}
        {canAct && st === '발송' && <><Btn variant="ghost" size="sm" onClick={copy}>링크</Btn><Btn variant="ghost" size="sm" onClick={send} disabled={busy}>재발송</Btn><Btn variant="ghost" size="sm" onClick={load}>새로고침</Btn></>}
        {canAct && st === '검토대기' && <><Btn variant="ghost" size="sm" onClick={reject} disabled={busy}>반려</Btn><Btn size="sm" onClick={approve} disabled={busy}>승인</Btn></>}
      </div>
      {/* 서명 PNG = 투명배경·짙은잉크(#0f1830) → 다크에서도 흰 지면 유지(C.taupeBg면 서명 안 보임). sign 캔버스·PDF와 동일 예외. */}
      {st === '검토대기' && c.sign_signature ? <img src={String(c.sign_signature)} alt="서명" style={{ maxWidth: 180, border: `1px solid ${C.line}`, borderRadius: 4, background: '#fff' }} /> : null}
      {st === '검토대기' && <div style={{ fontSize: FS.micro, color: C.faint }}>{[c.customer_name, c.customer_phone].filter(Boolean).join(' · ')} 서명 제출됨. 승인 시 약정발송 완료.</div>}
      {st === '미발송' && <div style={{ fontSize: FS.micro, color: C.faint }}>약정 완료 후 서명 링크를 만들어 손님에게 전달하세요.</div>}
      {st === '발송' && <div style={{ fontSize: FS.micro, color: C.faint }}>손님 서명 대기 중. 손님이 제출하면 새로고침으로 확인.</div>}
      {st === '서명완료' && <div style={{ fontSize: FS.micro, color: C.ok }}>전자서명 완료 — 계약 확정.</div>}
    </div>
  );
}
