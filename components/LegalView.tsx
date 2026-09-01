'use client';
import { C, FS, FW, Btn, Message } from '@/components/ui';
import { GUEST_W } from '@/lib/guest-layout';
import { LEGAL_DOCS, LEGAL_EFFECTIVE_DATE, LEGAL_VERSION, OPERATOR, missingOperatorFields } from '@/lib/legal';

/**
 * 약관·방침 본문 뷰(공개). 로그인 없이 열려야 하므로 앱 셸(Page·TopBar) 없이 스스로 그린다.
 * 내용은 lib/legal.ts 가 SSOT — 여기서 문장을 고치지 말 것(동의 버전과 어긋난다).
 */
export function LegalView({ doc }: { doc: 'terms' | 'privacy' }) {
  const d = LEGAL_DOCS[doc];
  const missing = missingOperatorFields();
  return (
    <div style={{ minHeight: '100dvh', background: C.taupeBg, padding: '24px 16px 64px' }}>
      <div style={{ maxWidth: GUEST_W, margin: '0 auto' }}>
        <h1 style={{ fontSize: FS.page, fontWeight: FW.head, color: C.brand, margin: '0 0 6px' }}>{d.title}</h1>
        <p style={{ fontSize: FS.cap, color: C.faint, margin: '0 0 16px' }}>
          시행일 {LEGAL_EFFECTIVE_DATE} · 버전 {LEGAL_VERSION}
        </p>

        {missing.length > 0 && (
          // 사실 정보라 임의로 채울 수 없다. 비어 있는 채로 공개되면 문서가 효력을 갖지 못하므로 크게 알린다.
          <Message variant="danger">
            <b>공개 전 필수</b> — 운영자 정보가 비어 있습니다: {missing.join(' · ')}
            <br />Vercel의 NEXT_PUBLIC_OPERATOR_* 환경변수를 입력하고 재배포해야 문서에 반영됩니다.
          </Message>
        )}

        <p style={{ fontSize: FS.sub, color: C.mute, lineHeight: 1.8, margin: '0 0 20px' }}>{d.intro}</p>

        {d.sections.map((s) => (
          <section key={s.title} style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: FS.body, fontWeight: FW.head, color: C.ink, margin: '0 0 6px' }}>{s.title}</h2>
            {s.body.map((line, i) => (
              <p key={i} style={{ fontSize: FS.sub, color: C.ink, lineHeight: 1.8, margin: '0 0 4px', whiteSpace: 'pre-wrap' }}>{line}</p>
            ))}
          </section>
        ))}

        <footer style={{ borderTop: `1px solid ${C.line}`, marginTop: 24, paddingTop: 14, fontSize: FS.cap, color: C.faint, lineHeight: 1.8 }}>
          {OPERATOR.company && <div>{OPERATOR.company}{OPERATOR.ceo ? ` · 대표 ${OPERATOR.ceo}` : ''}</div>}
          {OPERATOR.bizNo && <div>사업자등록번호 {OPERATOR.bizNo}</div>}
          {OPERATOR.address && <div>{OPERATOR.address}</div>}
          {(OPERATOR.email || OPERATOR.phone) && <div>{[OPERATOR.email, OPERATOR.phone].filter(Boolean).join(' · ')}</div>}
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <Btn size="sm" variant="ghost" href={doc === 'terms' ? '/privacy' : '/terms'} title={doc === 'terms' ? '개인정보처리방침' : '이용약관'}>
              {doc === 'terms' ? '개인정보처리방침' : '이용약관'}
            </Btn>
            <Btn size="sm" variant="ghost" href="/login" title="로그인">로그인으로</Btn>
          </div>
        </footer>
      </div>
    </div>
  );
}
