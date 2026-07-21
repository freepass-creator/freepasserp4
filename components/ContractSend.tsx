'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildContractPayload, saveContractDraft, sendContractLink, snapshotFromDoc,
  TEMPLATE_SRC, type ContractPayload,
} from '@/lib/domain/contract-send';
import { getRole } from '@/lib/domain/deal';
import { Btn, C, CenterNote, Loading, R } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { useIsMobile } from '@/lib/use-mobile';

/**
 * 계약서 발송 허브 — 템플릿 iframe + 임시저장/PDF/서명링크.
 * Claude: 원자(Btn)만. 페이로드·draft = contract-send.ts. 서명 상태 = sign.ts.
 */
export function ContractSend({ contractCode }: { contractCode: string }) {
  const mobile = useIsMobile();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [payload, setPayload] = useState<ContractPayload | null>(null);
  const [signSt, setSignSt] = useState('');
  const [err, setErr] = useState('');
  const [lastLink, setLastLink] = useState('');

  const inject = useCallback((data: ContractPayload) => {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    try {
      const Ctr = (w as unknown as { Contract?: { setData: (o: ContractPayload) => void } }).Contract;
      if (Ctr?.setData) Ctr.setData(data);
      else w.postMessage({ type: 'contract:setData', data }, '*');
    } catch {
      w.postMessage({ type: 'contract:setData', data }, '*');
    }
  }, []);

  const load = useCallback(async () => {
    setErr(''); setReady(false); setPayload(null);
    try {
      const { contract, payload: p } = await buildContractPayload(contractCode);
      setPayload(p);
      setSignSt(String(contract.sign_status || '미발송'));
      setReady(true);
      // iframe 로드 후 inject — onLoad에서도 재시도
      requestAnimationFrame(() => inject(p));
    } catch (e) {
      setErr(String((e as Error).message || e));
    }
  }, [contractCode, inject]);

  useEffect(() => { load(); }, [load]);

  const onFrameLoad = () => {
    if (payload) inject(payload);
  };

  const readSnapshot = (): ContractPayload => {
    const doc = iframeRef.current?.contentDocument;
    const fromDom = doc ? snapshotFromDoc(doc) : {};
    return { ...(payload || {}), ...fromDom };
  };

  const saveDraft = async () => {
    setBusy(true);
    try {
      const snap = readSnapshot();
      await saveContractDraft(contractCode, snap);
      setPayload(snap);
      toast('임시저장 완료', 'ok');
    } catch (e) { toast('저장 실패: ' + String((e as Error).message || e), 'error'); }
    finally { setBusy(false); }
  };

  const printPdf = () => {
    try {
      const w = iframeRef.current?.contentWindow;
      w?.focus();
      w?.print();
    } catch { toast('인쇄 창을 열 수 없습니다', 'error'); }
  };

  const send = async () => {
    const role = getRole();
    if (role !== 'agent' && role !== 'admin') { toast('영업자·관리자만 발송할 수 있습니다', 'error'); return; }
    setBusy(true);
    try {
      const snap = readSnapshot();
      const token = await sendContractLink(contractCode, snap);
      const link = `${location.origin}/sign/${token}`;
      setLastLink(link);
      let copied = false;
      try {
        await navigator.clipboard?.writeText(link);
        copied = true;
      } catch { /* 클립보드 거부 시 아래 링크 노출 */ }
      setPayload(snap);
      setSignSt('발송');
      // 모바일 공유 시트(알림톡 대체 SOP)
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: '렌터카 계약 서명', text: '아래 링크에서 약관 동의·전자서명 해주세요.', url: link });
          toast('발송·공유 완료', 'ok');
          return;
        } catch { /* 사용자가 공유 취소해도 링크는 유지 */ }
      }
      toast(copied ? '링크 복사됨 — 카톡·문자로 손님에게 전달하세요' : '링크 생성됨 — 아래 주소를 복사해 전달하세요', 'ok');
    } catch (e) { toast('발송 실패: ' + String((e as Error).message || e), 'error'); }
    finally { setBusy(false); }
  };

  const copyAgain = async () => {
    if (!lastLink) return;
    try {
      await navigator.clipboard.writeText(lastLink);
      toast('링크 다시 복사됨', 'ok');
    } catch { toast('복사 실패 — 아래 주소를 길게 눌러 복사하세요', 'error'); }
  };

  if (err) return <CenterNote>{err}</CenterNote>;
  if (!ready && !payload) return <Loading />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: mobile ? '8px 10px' : '8px 12px',
        borderBottom: `1px solid ${C.line}`, background: C.head, flex: '0 0 auto',
      }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>계약서</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: signSt === '서명완료' ? C.ok : signSt === '발송' ? C.accent : C.mute }}>{signSt || '미발송'}</span>
        <span style={{ flex: 1 }} />
        <Btn size="sm" variant="ghost" onClick={load} disabled={busy}>다시채움</Btn>
        <Btn size="sm" variant="ghost" onClick={saveDraft} disabled={busy}>임시저장</Btn>
        <Btn size="sm" variant="ghost" onClick={printPdf} disabled={busy}>PDF·인쇄</Btn>
        <Btn size="sm" onClick={send} disabled={busy}>{signSt === '발송' || signSt === '검토대기' || signSt === '서명완료' ? '재발송' : '발송·링크복사'}</Btn>
        {lastLink ? <Btn size="sm" variant="ghost" onClick={copyAgain}>링크 재복사</Btn> : null}
      </div>
      {lastLink ? (
        <div style={{
          padding: '8px 12px', borderBottom: `1px solid ${C.line2}`, background: C.selected,
          fontSize: 11.5, color: C.mute, wordBreak: 'break-all', flex: '0 0 auto',
        }}>
          <span style={{ fontWeight: 700, color: C.brand }}>서명 링크 · </span>
          <a href={lastLink} target="_blank" rel="noreferrer" style={{ color: C.accent }}>{lastLink}</a>
          <div style={{ marginTop: 4, fontSize: 11, color: C.faint }}>알림톡 연동 전 — 카톡·문자로 이 링크를 전달하세요. 손님 폰에서 열리면 서명 가능합니다.</div>
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, background: '#fff', borderRadius: R, overflow: 'hidden' }}>
        <iframe
          ref={iframeRef}
          title="렌트 계약서"
          src={TEMPLATE_SRC}
          onLoad={onFrameLoad}
          style={{ width: '100%', height: '100%', minHeight: mobile ? 420 : 560, border: 'none', display: 'block' }}
        />
      </div>
      <div style={{ padding: '6px 12px', fontSize: 11, color: C.faint, borderTop: `1px solid ${C.line2}` }}>
        매물·계약·공급사 정보로 자동 채움. 임시저장 후 발송하면 손님 서명 링크가 생성됩니다.
      </div>
    </div>
  );
}
