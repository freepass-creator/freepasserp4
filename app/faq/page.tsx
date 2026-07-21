'use client';
import { useEffect, useState } from 'react';
import { getRole } from '@/lib/domain/deal';
import { Page, Section, DetailGrid, SectionLabel, Disclosure, CopyBlock, CenterNote, Loading, Btn, C } from '@/components/ui';
import { GUIDE, FAQ, matchFaq } from '@/lib/domain/faq';
import { NAV_LABEL } from '@/lib/tabbar';

// 위 = 업무 절차 안내(항상 펼침) · 아래 = QnA(제목만, 눌러야 펼침).
// 내용 SSOT는 lib/domain/faq.ts — 여기서는 배열·검색만 한다.
function Para({ lines }: { lines: string[] }) {
  return (
    <div style={{ padding: '8px 12px', fontSize: 12.5, lineHeight: 1.7, color: C.ink }}>
      {lines.map((p, i) => <p key={i} style={{ margin: i ? '6px 0 0' : 0 }}>{p}</p>)}
    </div>
  );
}

export default function Faq() {
  const [role, setRole] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    setRole(getRole());
    const on = () => setRole(getRole());
    window.addEventListener('fp:role', on);
    return () => window.removeEventListener('fp:role', on);
  }, []);

  if (role === null) return <Loading />;
  // 관리자는 전부 볼 수 있어야 한다(내용 검수·문의 대응). 영업자 대상 안내지만 관리자를 막지 않는다.
  if (role !== 'agent' && role !== 'admin') {
    return (
      <Page title={NAV_LABEL.faq}>
        <CenterNote>영업자에게 제공되는 안내입니다</CenterNote>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <Btn href="/settings" size="sm">설정에서 역할 변경</Btn>
        </div>
      </Page>
    );
  }

  const searching = q.trim() !== '';
  const groups = FAQ
    .map((g) => ({ ...g, items: g.items.filter((it) => matchFaq(it, q)) }))
    .filter((g) => g.items.length > 0);
  const hits = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <Page
      title={NAV_LABEL.faq}
      meta={searching ? hits : undefined}
      countSuffix="개"
      search={{ value: q, onChange: setQ, placeholder: '수수료·서류·심사·보증금…' }}
    >
      {/* 검색 중에는 안내를 접고 QnA 결과만 — 찾는 걸 바로 보여준다 */}
      {!searching && GUIDE.map((s) => (
        <Section key={s.title} title={s.title}>
          {s.desc ? (
            <div style={{ padding: '8px 12px 2px', fontSize: 11.5, color: C.faint }}>{s.desc}</div>
          ) : null}
          {s.steps?.length ? (
            <div style={{ padding: '6px 12px 4px' }}>
              {s.steps.map((st, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '5px 0', fontSize: 12.5, lineHeight: 1.55 }}>
                  <span style={{ flex: '0 0 auto', width: 18, color: C.faint, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                  <span style={{ flex: 1 }}>
                    {st.main}
                    {st.sub ? <span style={{ display: 'block', color: C.faint, fontSize: 11.5 }}>{st.sub}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {s.rows?.length ? <DetailGrid rows={s.rows} /> : null}
          {s.copyText ? (
            <div style={{ padding: '4px 12px 12px' }}>
              <CopyBlock text={s.copyText} />
            </div>
          ) : null}
          {s.a?.length ? <Para lines={s.a} /> : null}
        </Section>
      ))}

      <SectionLabel mt={26}>{searching ? '검색 결과' : '자주 묻는 질문'}</SectionLabel>
      {groups.length === 0 ? (
        <CenterNote>검색 결과 없음</CenterNote>
      ) : (
        groups.map((g) => (
          <div key={g.title} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.faint, margin: '10px 0 2px' }}>{g.title}</div>
            {g.items.map((it) => (
              <Disclosure key={it.q} title={it.q} defaultOpen={searching}>
                {it.a?.length ? (
                  <div style={{ fontSize: 12.5, lineHeight: 1.7, color: C.ink }}>
                    {it.a.map((p, i) => <p key={i} style={{ margin: i ? '6px 0 0' : 0 }}>{p}</p>)}
                  </div>
                ) : null}
                {it.rows?.length ? (
                  <div style={{ marginTop: it.a?.length ? 8 : 0, border: `1px solid ${C.line}`, borderRadius: 4, overflow: 'hidden', background: C.taupeBg }}>
                    <DetailGrid rows={it.rows} />
                  </div>
                ) : null}
              </Disclosure>
            ))}
          </div>
        ))
      )}
    </Page>
  );
}
