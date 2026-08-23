'use client';

import { useRouter } from 'next/navigation';
import { FileSignature, FileSpreadsheet } from 'lucide-react';
import { useSession } from '@/lib/auth-context';
import { Btn, ButtonLabel, C, FS, FW, ICON } from '@/components/ui';

/** 영업자가 실제로 쓰는 세 도구의 순서를 상품 화면에서 바로 안내한다. */
export function AgentWorkflowGuide() {
  const session = useSession();
  const router = useRouter();
  if (session?.role !== 'agent') return null;

  return (
    <section className="fp-agent-workflow" aria-label="영업 업무 순서">
      <div style={{ minWidth: 0 }}>
        <div style={{ color: C.ink, fontSize: FS.sub, fontWeight: FW.title }}>
          상품 확인은 ERP 안의 상품리스트가 기준입니다
        </div>
        <div style={{ color: C.mute, fontSize: FS.cap, lineHeight: 1.45 }}>
          로그인한 ERP 안에서 상품 확인 → 문의는 기존 카카오톡방 → 확정 건은 ERP에서 전자계약
        </div>
      </div>
      <div className="fp-agent-workflow-actions">
        <Btn title="ERP 안의 상품리스트 보기" onClick={() => { localStorage.setItem('fp4_finder_view_v2', 'excel'); window.location.assign('/finder'); }}>
          <ButtonLabel icon={<FileSpreadsheet size={ICON.md} aria-hidden />}>상품리스트 보기</ButtonLabel>
        </Btn>
        <Btn title="전자계약 만들기" variant="ghost" onClick={() => router.push('/esign')}>
          <ButtonLabel icon={<FileSignature size={ICON.md} aria-hidden />}>전자계약</ButtonLabel>
        </Btn>
      </div>
    </section>
  );
}
