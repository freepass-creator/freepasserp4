'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, FileDown, FileText, Smartphone } from 'lucide-react';
import { getAuthClient } from '@/lib/firebase/client';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { initAuth } from '@/lib/firebase/auth';
import { isEsignUiAllowed } from '@/lib/auth-gate';
import { Btn, ButtonLabel, C, CenterNote, FS, FW, ICON, Loading, Message, R, SH } from '@/components/ui';

type PreviewState = {
  contract?: Record<string, unknown>;
  error?: string;
};

const S = (value: unknown) => String(value ?? '').trim();

async function adminFetch(url: string) {
  await initAuth();
  const auth = getAuthClient();
  if (!auth) throw new Error('전자계약 인증을 사용할 수 없습니다.');
  const user = auth.currentUser || await new Promise<User | null>((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (next) => {
      unsubscribe();
      resolve(next);
    });
  });
  if (!user) throw new Error('로그인이 필요합니다.');
  return fetch(url, {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    cache: 'no-store',
  });
}

export default function EsignPreviewPage() {
  const { contractCode } = useParams<{ contractCode: string }>();
  const router = useRouter();
  const [mode, setMode] = useState<'mobile' | 'document'>('mobile');
  const [state, setState] = useState<PreviewState | null>(null);
  const [documentUrl, setDocumentUrl] = useState('');
  // 돌아갈 곳은 연 화면이 정한다(계약서관리 /esign · ERP5 /erp5/esign). 외부 URL 은 받지 않는다.
  const [backPath, setBackPath] = useState('/esign');

  const load = useCallback(async () => {
    const code = encodeURIComponent(String(contractCode));
    const response = await adminFetch(`/api/freepass-esign/contracts/${code}`);
    const body = await response.json().catch(() => ({})) as PreviewState;
    if (!response.ok) throw new Error(body.error || '전자계약을 불러오지 못했습니다.');
    setState(body);

    // 관리자 미리보기와 실제 완료본이 동일한 Chromium PDF 경로를 사용해야
    // 폰트·줄바꿈·약관 페이지 수가 발송 후 달라지지 않는다.
    const documentResponse = await adminFetch(`/api/freepass-esign/contracts/${code}/document?draft=1&format=pdf`);
    if (documentResponse.ok) setDocumentUrl(URL.createObjectURL(await documentResponse.blob()));
  }, [contractCode]);

  useEffect(() => {
    if (!isEsignUiAllowed()) { router.replace('/login?next=/esign'); return; }
    void load().catch((error) => setState({ error: error instanceof Error ? error.message : '미리보기를 열지 못했습니다.' }));
  }, [load, router]);

  useEffect(() => () => { if (documentUrl) URL.revokeObjectURL(documentUrl); }, [documentUrl]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'a4') setMode('document');
    const back = S(params.get('back'));
    if (/^\/[a-z0-9\-/]*$/i.test(back)) setBackPath(back);
  }, []);

  useEffect(() => {
    if (state?.contract && !S(state.contract.esign_sign_url)) setMode('document');
  }, [state]);

  if (!state) return <Loading />;
  const contract = state.contract || {};
  const customerUrl = S(contract.esign_sign_url);
  // 관리자 미리보기는 손님 「열람」 시각을 오염시키면 안 된다 — 서명 페이지의 preview 모드(peek 조회, 쓰기 없음)로 연다.
  const previewCustomerUrl = customerUrl ? `${customerUrl}${customerUrl.includes('?') ? '&' : '?'}preview=1` : '';
  const customer = S(contract.customer_name) || '고객';
  const downloadDocument = () => {
    if (!documentUrl) return;
    const vehicle = S(contract.vehicle_name_snapshot || contract.car_number_snapshot) || '자동차';
    const filename = `${vehicle}_${S(contract.contract_code) || contractCode}_계약서.pdf`.replace(/[\\/:*?"<>|]/g, '_');
    const anchor = document.createElement('a');
    anchor.href = documentUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <main style={{ minHeight: '100dvh', background: C.bg, color: C.ink }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 5, borderBottom: `1px solid ${C.line}`, background: C.inverse }}>
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Btn variant="ghost" title="계약서관리로 돌아가기" onClick={() => router.push(backPath)}>
            <ButtonLabel icon={<ArrowLeft size={ICON.md} aria-hidden />}>계약서관리</ButtonLabel>
          </Btn>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: FS.body, fontWeight: FW.title }}>{customer} 고객 전달 화면</div>
            <div style={{ fontSize: FS.cap, color: C.mute }}>{S(contract.contract_code) || contractCode}</div>
          </div>
          {customerUrl ? (
            <Btn variant="ghost" title="고객 링크를 새 창에서 열기" onClick={() => window.open(customerUrl, '_blank', 'noreferrer')}>
              <ButtonLabel icon={<ExternalLink size={ICON.md} aria-hidden />}>실제 링크 열기</ButtonLabel>
            </Btn>
          ) : null}
          {mode === 'document' ? (
            <Btn variant="ghost" title="A4 계약서 PDF 다운로드" disabled={!documentUrl} onClick={downloadDocument}>
              <ButtonLabel icon={<FileDown size={ICON.md} aria-hidden />}>PDF 다운로드</ButtonLabel>
            </Btn>
          ) : null}
        </div>
        <div style={{ padding: '0 16px 10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Btn full variant={mode === 'mobile' ? 'solid' : 'ghost'} onClick={() => setMode('mobile')}>
            <ButtonLabel icon={<Smartphone size={ICON.md} aria-hidden />}>고객 모바일 화면</ButtonLabel>
          </Btn>
          <Btn full variant={mode === 'document' ? 'solid' : 'ghost'} onClick={() => setMode('document')}>
            <ButtonLabel icon={<FileText size={ICON.md} aria-hidden />}>계약서 (A4)</ButtonLabel>
          </Btn>
        </div>
      </header>

      {state.error ? (
        <div style={{ padding: 16 }}>
          <Message variant="danger">
            {state.error}
            {' '}
            <Btn variant="ghost" onClick={() => { setState(null); void load().catch((error) => setState({ error: error instanceof Error ? error.message : '미리보기를 열지 못했습니다.' })); }}>
              다시 불러오기
            </Btn>
          </Message>
        </div>
      ) : mode === 'mobile' ? (
        <section style={{ padding: '24px 12px 48px', display: 'flex', justifyContent: 'center' }}>
          {customerUrl ? (
            <div style={{ width: 'min(390px, 100%)', height: 'min(844px, calc(100dvh - 170px))', minHeight: 560, border: `1px solid ${C.line}`, borderRadius: R, padding: 8, background: C.ink, boxShadow: SH.modal }}>
              <iframe title="고객 모바일 전자계약 화면(미리보기 · 열람 기록 없음)" src={previewCustomerUrl} style={{ width: '100%', height: '100%', border: 0, borderRadius: R, background: C.inverse }} />
            </div>
          ) : (
            <CenterNote minHeight={160}>전자계약 링크를 발행하면 고객에게 전달되는 모바일 화면이 여기에 표시됩니다.</CenterNote>
          )}
        </section>
      ) : (
        <section style={{ height: 'calc(100dvh - 126px)', padding: 12 }}>
          {documentUrl ? (
            <iframe title="자동차 장기대여 계약서 A4 문서" src={documentUrl} style={{ width: '100%', height: '100%', border: `1px solid ${C.line}`, borderRadius: R, background: C.inverse }} />
          ) : (
            <CenterNote minHeight={160}>계약서 문서를 준비하고 있습니다.</CenterNote>
          )}
        </section>
      )}
    </main>
  );
}
