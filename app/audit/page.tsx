'use client';
import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { ENTITIES, type EntityRecord } from '@/lib/intake/entities';
import { isAdminUiAllowed } from '@/lib/auth-gate';
import { parseAuditChanges, auditDomainOf, normalizeAuditRecord, AUDIT_DOMAIN_OPTS } from '@/lib/domain/audit';
import { Page, Btn, Badge, PillTabs, FilterChips, FilterGroup, Loading, CenterNote, Message, ListRow, WorkTable, WorkRow } from '@/components/ui';

// 감사·휴지통 — 전 데이터 write 관장(매물·대여료·계약·정산·채팅·회원). store 자동 기록.
const TRASH_ENTITIES = ['product', 'contract', 'settlement', 'policy', 'partner', 'user', 'room', 'customer'];
const ACT_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray' | 'blue' | 'teal' | 'purple'> = {
  create: 'green', update: 'amber', delete: 'red', restore: 'green',
  master_snap: 'blue', chat: 'teal',
};
const label = (k: string) => ENTITIES[k]?.label || k;
const fmt = (ms: unknown) => { const n = Number(ms); return n ? new Date(n).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; };

const AuditRow = memo(function AuditRow({ log }: { log: EntityRecord }) {
  const [open, setOpen] = useState(false);
  const changes = useMemo(() => parseAuditChanges(log), [log]);
  const samples = Array.isArray(log.samples) ? (log.samples as string[]) : [];
  const summary = String(log.summary || '');
  const act = String(log.action || 'update');
  const entity = String(log.entity || '').trim();
  const targetKey = String(log.target_key || '').trim();
  const tone = ACT_TONE[act] || 'gray';
  const listTone = tone === 'teal' || tone === 'purple' ? 'blue' : tone;
  return (
    <>
      <ListRow
        badge={act === 'chat' ? '채팅' : act === 'master_snap' ? '차종변환' : act}
        badgeTone={listTone}
        main={[entity ? label(entity) : '기록', targetKey || '대상 미기록'].join(' ')}
        sub={[String(log.actor_name || '?'), String(log.actor_role || ''), summary, fmt(log.at)].filter(Boolean).join(' · ')}
        right={(changes.length > 0 || samples.length > 0) ? (
          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Btn size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? '접기' : '상세'}</Btn>
          </span>
        ) : undefined}
      />
      {open ? (
        <WorkTable title="변경 내용">
          {changes.map((c) => (
            <WorkRow key={c.key} label={c.label}>{c.from} → {c.to}</WorkRow>
          ))}
          {samples.map((s, i) => (
            <WorkRow key={`s-${i}`} label="표본">{s}</WorkRow>
          ))}
        </WorkTable>
      ) : null}
    </>
  );
});

export default function AuditTrash() {
  const co = getCompanyId();
  const router = useRouter();
  const [ok, setOk] = useState<boolean | null>(null);
  const [tab, setTab] = useState<'audit' | 'trash'>('audit');
  const [logs, setLogs] = useState<EntityRecord[]>([]);
  const [deleted, setDeleted] = useState<{ entity: string; rec: EntityRecord }[]>([]);
  const [domain, setDomain] = useState('');
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q);

  const loadTrash = async () => {
    const out: { entity: string; rec: EntityRecord }[] = [];
    for (const e of TRASH_ENTITIES) { const ds = await getStore().listDeleted(e, co); ds.forEach((rec) => out.push({ entity: e, rec })); }
    out.sort((a, b) => String(b.rec.deletedAt || '').localeCompare(String(a.rec.deletedAt || '')));
    setDeleted(out);
  };
  const load = async () => {
    const al = await getStore().list('audit_log', co);
    const normalized = al.map(normalizeAuditRecord).filter((log): log is EntityRecord => !!log);
    setLogs(normalized.sort((a, b) => Number(b.at) - Number(a.at)));
    await loadTrash();
  };
  useEffect(() => { (async () => { if (!isAdminUiAllowed()) { router.replace('/'); return; } await seedIfEmpty(co); await load(); setOk(true); })(); /* eslint-disable-next-line */ }, []);

  const shownLogs = useMemo(() => {
    const qq = deferredQ.trim().toLowerCase();
    return logs.filter((l) => {
      if (domain && auditDomainOf(l) !== domain) return false;
      if (!qq) return true;
      const blob = [l.target_key, l.summary, l.actor_name, l.action, l.entity, l.room_id, ...(Array.isArray(l.samples) ? l.samples as string[] : [])].join(' ').toLowerCase();
      return blob.includes(qq);
    }).slice(0, 500);
  }, [logs, domain, deferredQ]);
  const restore = async (entity: string, key: string) => { await getStore().restore(entity, co, key); await load(); };

  if (ok === null) return <Loading />;

  return (
    <Page title="감사 · 휴지통"
      listTools={tab === 'audit' ? {
        search: { value: q, onChange: setQ, placeholder: '차번·계약·채팅·행위자 검색' },
        filter: {
          count: domain ? 1 : 0,
          title: '조건 검색',
          onClear: () => setDomain(''),
          body: (
            <FilterGroup
              title="영역"
              count={domain ? 1 : 0}
              defaultOpen
              first
              onClear={() => setDomain('')}
            >
              <FilterChips value={domain} onChange={setDomain} options={AUDIT_DOMAIN_OPTS} />
            </FilterGroup>
          ),
        },
        hints: [
          ...(q.trim() ? [q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim()] : []),
          ...(domain ? [domain] : []),
        ],
        onClearHints: () => { setQ(''); setDomain(''); },
      } : undefined}
      right={<PillTabs tabs={[{ key: 'audit', label: `감사로그 ${logs.length}` }, { key: 'trash', label: `휴지통 ${deleted.length}` }]} value={tab} onChange={setTab} size="sm" />}>

      {tab === 'audit' ? (
        <>
          {shownLogs.length === 0 ? <CenterNote>기록이 없습니다.</CenterNote> :
            shownLogs.map((l, i) => <AuditRow key={String(l._key) || i} log={l} />)}
          <Message variant="info">
            매물·대여료·계약·정산·채팅·정책·회원 변경이 자동 기록됩니다. 채팅은 메시지 본문, 대여료는 기간별 금액 diff.
            방 unread 갱신은 제외(메시지 로그로 대체). 최근 표시 500건.
          </Message>
        </>
      ) : (
        deleted.length === 0 ? <CenterNote>삭제된 항목이 없습니다.</CenterNote> :
          deleted.map(({ entity, rec }, i) => (
            <ListRow
              key={`${entity}_${rec._key}_${i}`}
              badge={label(entity)}
              main={String(rec.car_number || rec.customer_name || rec.name || rec.contract_code || rec.policy_name || rec._key)}
              sub={`삭제 ${fmt(Date.parse(String(rec.deletedAt || '')) || undefined)}${rec.deletedReason ? ` · ${rec.deletedReason}` : ''}`}
              right={<Btn variant="ghost" size="sm" onClick={() => restore(entity, String(rec._key))}>복구</Btn>}
            />
          ))
      )}
    </Page>
  );
}
