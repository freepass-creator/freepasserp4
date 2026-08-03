'use client';
import { useEffect, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, type Role } from '@/lib/domain/deal';
import { canResumeApprovedSign, createSignToken, approveSign, rejectSign, revokeSignLink } from '@/lib/domain/sign';
import { isContractSignActive, readContractSign, signPublicToContract } from '@/lib/firebase/contract-sign-public';
import { Btn, ButtonLabel, C, toneText, DetailRow, ListGroup, FW, FS, R, ICON } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { copyText } from '@/lib/clipboard';
import { CheckCircle2, Copy, Link2, Link2Off, RefreshCw, RotateCcw, Send, XCircle } from 'lucide-react';

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
            sign_consents: m.sign_consents || row.sign_consents,
            sign_consent_version: m.sign_consent_version || row.sign_consent_version,
            sign_signed_at: m.sign_signed_at || row.sign_signed_at,
            customer_name: m.customer_name || row.customer_name,
            customer_phone: m.customer_phone || row.customer_phone,
            customer_id: m.customer_id || row.customer_id,
            customer_address: m.customer_address || row.customer_address,
            driver_license_no: m.driver_license_no || row.driver_license_no,
            emergency_name: m.emergency_name || row.emergency_name,
            emergency_phone: m.emergency_phone || row.emergency_phone,
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
  const send = async () => {
    setBusy(true);
    try {
      const token = await createSignToken(c);
      await copyText(`${location.origin}/sign/${token}`);
      await load();
      toast('계약서 링크 복사됨 — 손님에게 전달하세요', 'ok');
    } catch (e) {
      toast(`발송 실패: ${String((e as Error)?.message || e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    const copied = await copyText(linkOf());
    toast(copied ? '링크 복사됨' : '클립보드 복사 실패', copied ? 'ok' : 'error');
  };
  const approve = async () => { setBusy(true); try { await approveSign(c); await load(); toast('승인 — 계약 진행됨', 'ok'); } catch (e) { toast('승인 실패: ' + ((e as Error)?.message || ''), 'error'); } finally { setBusy(false); } };
  const reject = async () => {
    const reason = typeof window !== 'undefined' ? window.prompt('반려 사유(손님에게 표시 · 선택):', '') : '';
    if (reason === null) return; // 취소
    setBusy(true);
    try { await rejectSign(c, reason || ''); await load(); toast('반려 — 손님이 다시 서명하도록 재개방됨', 'ok'); }
    catch (e) { toast('반려 실패: ' + ((e as Error)?.message || ''), 'error'); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    setBusy(true);
    try { await revokeSignLink(c); await load(); toast('서명 링크를 해지했습니다', 'ok'); }
    catch (e) { toast('링크 해지 실패: ' + ((e as Error)?.message || ''), 'error'); }
    finally { setBusy(false); }
  };
  const active = isContractSignActive(c);
  const canRecover = canAct && canResumeApprovedSign(c);
  const stColor = st === '서명완료' ? C.ok : st === '검토대기' ? toneText('amber') : st === '발송' ? toneText('blue') : C.faint;
  const footer = st === '미발송' ? '약정 완료 후 서명 링크를 만들어 손님에게 전달하세요.'
    : st === '발송' && active ? '손님 서명 대기 중. 링크는 발급 후 7일간 유효합니다.'
      : st === '발송' && !active ? '링크가 만료되었거나 해지되었습니다. 새 링크를 발급하세요.'
        : st === '검토대기' ? `${[c.customer_name, c.customer_phone].filter(Boolean).join(' · ') || '손님'} 서명 제출됨. 승인 시 약정발송 완료.`
          : st === '서명완료'
            ? (canRecover ? '전자서명은 보존됐지만 약정발송 단계 반영이 필요합니다.' : '전자서명 완료 — 계약 확정.')
            : undefined;
  const actions = (
    <>
      {canAct && st === '미발송' && (
        <Btn title="계약서 발송" size="sm" onClick={send} disabled={busy}>
          <ButtonLabel icon={<Send size={ICON.md} aria-hidden />}>계약서 발송</ButtonLabel>
        </Btn>
      )}
      {canAct && st === '발송' && active && <>
        <Btn title="링크 복사" variant="ghost" size="sm" onClick={copy}>
          <ButtonLabel icon={<Copy size={ICON.md} aria-hidden />}>링크</ButtonLabel>
        </Btn>
        <Btn title="계약서 재발송" variant="ghost" size="sm" onClick={send} disabled={busy}>
          <ButtonLabel icon={<Send size={ICON.md} aria-hidden />}>재발송</ButtonLabel>
        </Btn>
        <Btn title="서명 링크 해지" variant="ghost" size="sm" onClick={revoke} disabled={busy}>
          <ButtonLabel icon={<Link2Off size={ICON.md} aria-hidden />}>해지</ButtonLabel>
        </Btn>
        <Btn title="서명 상태 새로고침" variant="ghost" size="sm" onClick={load}>
          <ButtonLabel icon={<RefreshCw size={ICON.md} aria-hidden />}>새로고침</ButtonLabel>
        </Btn>
      </>}
      {canAct && st === '발송' && !active && (
        <Btn title="새 서명 링크 발급" size="sm" onClick={send} disabled={busy}>
          <ButtonLabel icon={<Link2 size={ICON.md} aria-hidden />}>새 링크 발급</ButtonLabel>
        </Btn>
      )}
      {canAct && st === '검토대기' && <>
        <Btn title="전자서명 반려" variant="ghost" size="sm" onClick={reject} disabled={busy}>
          <ButtonLabel icon={<XCircle size={ICON.md} aria-hidden />}>반려</ButtonLabel>
        </Btn>
        <Btn title="전자서명 승인" size="sm" onClick={approve} disabled={busy}>
          <ButtonLabel icon={<CheckCircle2 size={ICON.md} aria-hidden />}>승인</ButtonLabel>
        </Btn>
      </>}
      {canRecover && (
        <Btn title="약정 단계 복구" size="sm" onClick={approve} disabled={busy}>
          <ButtonLabel icon={<RotateCcw size={ICON.md} aria-hidden />}>약정 단계 복구</ButtonLabel>
        </Btn>
      )}
    </>
  );
  const hasActions = canAct && (st === '미발송' || st === '발송' || st === '검토대기' || canRecover);

  return (
    <ListGroup header="계약서 서명" footer={footer}>
      <DetailRow label="상태" value={<span style={{ color: stColor, fontWeight: FW.label }}>{st}</span>} />
      {/* 서명 PNG = 투명배경·짙은잉크(#0f1830) → 다크에서도 흰 지면 유지(C.taupeBg면 서명 안 보임). sign 캔버스·PDF와 동일 예외. */}
      {st === '검토대기' && c.sign_signature ? (
        <div style={{ padding: '8px 12px' }}>
          <img src={String(c.sign_signature)} alt="서명" style={{ maxWidth: 180, border: `1px solid ${C.line}`, borderRadius: R, background: '#fff' }} />
        </div>
      ) : null}
      {hasActions ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: '8px 12px', boxSizing: 'border-box' }}>
          {actions}
        </div>
      ) : null}
    </ListGroup>
  );
}
