'use client';
import { useEffect, useState } from 'react';
import { getRole } from '@/lib/domain/deal';
import { Page, Section, DetailGrid, SectionLabel, CenterNote, Loading, Btn, C } from '@/components/ui';
import { FAQ, matchFaq } from '@/lib/domain/faq';
import { NAV_LABEL } from '@/lib/tabbar';

// 영업자 QNA — 내용 SSOT는 lib/domain/faq.ts. 여기서는 검색·배열만 한다.
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

  const groups = FAQ
    .map((g) => ({ ...g, items: g.items.filter((it) => matchFaq(it, q)) }))
    .filter((g) => g.items.length > 0);
  const hits = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <Page
      title={NAV_LABEL.faq}
      meta={hits}
      countSuffix="개"
      search={{ value: q, onChange: setQ, placeholder: '수수료·서류·탁송·정산…' }}
    >
      {groups.length === 0 ? (
        <CenterNote>검색 결과 없음</CenterNote>
      ) : (
        groups.map((g) => (
          <div key={g.title}>
            <SectionLabel mt={18}>{g.title}</SectionLabel>
            {g.items.map((it) => (
              <Section key={it.q} title={it.q}>
                {it.a?.length ? (
                  <div style={{ padding: '8px 12px', fontSize: 12.5, lineHeight: 1.7, color: C.ink }}>
                    {it.a.map((p, i) => (
                      <p key={i} style={{ margin: i ? '6px 0 0' : 0 }}>{p}</p>
                    ))}
                  </div>
                ) : null}
                {it.rows?.length ? <DetailGrid rows={it.rows} /> : null}
              </Section>
            ))}
          </div>
        ))
      )}
    </Page>
  );
}
