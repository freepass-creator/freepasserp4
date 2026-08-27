'use client';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { getRole } from '@/lib/domain/deal';
import { Page, Section, DetailGrid, SectionLabel, Disclosure, CopyBlock, CenterNote, Loading, Btn, ListRow, Message, C, FS } from '@/components/ui';
import { GUIDE, FAQ, matchFaq } from '@/lib/domain/faq';
import { NAV_LABEL } from '@/lib/tabbar';

// 위 = 업무 절차 안내(항상 펼침) · 아래 = QnA(제목만, 눌러야 펼침).
// 내용 SSOT는 lib/domain/faq.ts — 여기서는 배열·검색만 한다.

export default function Faq() {
  const [role, setRole] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q);

  useEffect(() => {
    setRole(getRole());
    const on = () => setRole(getRole());
    window.addEventListener('fp:role', on);
    return () => window.removeEventListener('fp:role', on);
  }, []);

  const searching = q.trim() !== '';
  const groups = useMemo(() => FAQ
    .map((g) => ({ ...g, items: g.items.filter((it) => matchFaq(it, deferredQ)) }))
    .filter((g) => g.items.length > 0), [deferredQ]);
  const hits = groups.reduce((n, g) => n + g.items.length, 0);

  if (role === null) return <Loading />;
  // 관리자는 전부 볼 수 있어야 한다(내용 검수·문의 대응). 영업자 대상 안내지만 관리자를 막지 않는다.
  if (role !== 'agent' && role !== 'admin') {
    return (
      <Page title={NAV_LABEL.faq}>
        <CenterNote>
          영업자·관리자에게 제공되는 안내입니다
          <span style={{ display: 'block', marginTop: 12 }}>
            <Btn title="홈으로" href="/" size="sm">홈으로</Btn>
          </span>
        </CenterNote>
      </Page>
    );
  }

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
          {s.desc ? <Message variant="info">{s.desc}</Message> : null}
          {s.steps?.length ? s.steps.map((st, i) => (
            <ListRow key={i} badge={String(i + 1)} main={st.main} sub={st.sub} />
          )) : null}
          {s.rows?.length ? <DetailGrid rows={s.rows} /> : null}
          {s.copyText ? <CopyBlock text={s.copyText} /> : null}
          {s.a?.length ? s.a.map((p, i) => (
            <p key={i} style={{ margin: i ? '6px 12px 0' : '8px 12px 0', fontSize: FS.sub, lineHeight: 1.7, color: C.ink }}>{p}</p>
          )) : null}
        </Section>
      ))}

      <SectionLabel mt={26}>{searching ? '검색 결과' : '자주 묻는 질문'}</SectionLabel>
      {groups.length === 0 ? (
        <CenterNote>검색 결과 없음</CenterNote>
      ) : (
        groups.map((g) => (
          <div key={g.title}>
            <SectionLabel mt={10}>{g.title}</SectionLabel>
            {g.items.map((it) => (
              <Disclosure key={it.q} title={it.q} defaultOpen={searching}>
                {it.a?.length ? it.a.map((p, i) => (
                  <p key={i} style={{ margin: i ? '6px 0 0' : 0, fontSize: FS.sub, lineHeight: 1.7, color: C.ink }}>{p}</p>
                )) : null}
                {it.rows?.length ? <DetailGrid rows={it.rows} /> : null}
              </Disclosure>
            ))}
          </div>
        ))
      )}
    </Page>
  );
}
