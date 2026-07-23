'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { ENTITIES, type EntityRecord } from '@/lib/intake/entities';
import { getRole } from '@/lib/domain/deal';
import { parseAuditChanges, auditDomainOf, AUDIT_DOMAIN_OPTS } from '@/lib/domain/audit';
import { Page, Btn, Badge, PillTabs, FilterChips, SearchInput, C, R, Loading, CenterNote, SectionLabel, FW, FS, NUM } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';

// 감사·휴지통 — 전 데이터 write 관장(매물·대여료·계약·정산·채팅·회원). store 자동 기록.
const TRASH_ENTITIES = ['product', 'contract', 'settlement', 'policy', 'partner', 'user', 'room', 'customer'];
const ACT_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray' | 'blue' | 'teal' | 'purple'> = {
  create: 'green', update: 'amber', delete: 'red', restore: 'green',
  master_snap: 'blue', chat: 'teal',
};
const label = (k: string) => ENTITIES[k]?.label || k;
const fmt = (ms: unknown) => { const n = Number(ms); return n ? new Date(n).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; };

function AuditRow({ log }: { log: EntityRecord }) {
  const [open, setOpen] = useState(false);
  const changes = useMemo(() => parseAuditChanges(log), [log]);
  const samples = Array.isArray(log.samples) ? (log.samples as string[]) : [];
  const summary = String(log.summary || '');
  const act = String(log.action);
  return (
    <div style={{ borderTop: `1px solid ${C.line2}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px' }}>
        <Badge tone={ACT_TONE[act] || 'gray'}>{act === 'chat' ? '채팅' : act === 'master_snap' ? '차종변환' : act}</Badge>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: FS.sub, fontWeight: FW.strong, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label(String(log.entity))}{' '}
            <span style={{ fontFamily: NUM, color: C.mute, fontWeight: FW.body }}>{String(log.target_key || '')}</span>
          </div>
          <div style={{ fontSize: FS.cap, color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {String(log.actor_name || '?')} · {String(log.actor_role || '')}
            {summary ? ` · ${summary}` : ''}
          </div>
        </div>
        <span style={{ fontSize: FS.cap, color: C.faint, fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' }}>{fmt(log.at)}</span>
        {(changes.length > 0 || samples.length > 0) && (
          <Btn size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? '접기' : '상세'}</Btn>
        )}
      </div>
      {open && (
        <div style={{ padding: '0 14px 10px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {changes.map((c) => (
            <div key={c.key} style={{ display: 'grid', gridTemplateColumns: '88px 1fr auto 1fr', gap: 6, fontSize: FS.cap, alignItems: 'baseline' }}>
              <span style={{ color: C.faint }}>{c.label}</span>
              <span style={{ color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.from}>{c.from}</span>
              <span style={{ color: C.faint }}>→</span>
              <span style={{ color: C.brand, fontWeight: FW.strong, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.to}>{c.to}</span>
            </div>
          ))}
          {samples.map((s, i) => (
            <div key={i} style={{ fontSize: FS.cap, color: C.mute, fontFamily: NUM, padding: '4px 6px', background: C.head, borderRadius: R }}>{s}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AuditTrash() {
  const co = getCompanyId();
  const router = useRouter();
  const mobile = useIsMobile();
  const [ok, setOk] = useState<boolean | null>(null);
  const [tab, setTab] = useState<'audit' | 'trash'>('audit');
  const [logs, setLogs] = useState<EntityRecord[]>([]);
  const [deleted, setDeleted] = useState<{ entity: string; rec: EntityRecord }[]>([]);
  const [domain, setDomain] = useState('');
  const [q, setQ] = useState('');

  const loadTrash = async () => {
    const out: { entity: string; rec: EntityRecord }[] = [];
    for (const e of TRASH_ENTITIES) { const ds = await getStore().listDeleted(e, co); ds.forEach((rec) => out.push({ entity: e, rec })); }
    out.sort((a, b) => String(b.rec.deletedAt || '').localeCompare(String(a.rec.deletedAt || '')));
    setDeleted(out);
  };
  const load = async () => {
    const al = await getStore().list('audit_log', co);
    setLogs([...al].sort((a, b) => Number(b.at) - Number(a.at)));
    await loadTrash();
  };
  useEffect(() => { (async () => { await seedIfEmpty(co); if (getRole() !== 'admin') { router.replace('/'); return; } await load(); setOk(true); })(); /* eslint-disable-next-line */ }, []);

  const shownLogs = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return logs.filter((l) => {
      if (domain && auditDomainOf(l) !== domain) return false;
      if (!qq) return true;
      const blob = [l.target_key, l.summary, l.actor_name, l.action, l.entity, l.room_id, ...(Array.isArray(l.samples) ? l.samples as string[] : [])].join(' ').toLowerCase();
      return blob.includes(qq);
    }).slice(0, 500);
  }, [logs, domain, q]);
  const restore = async (entity: string, key: string) => { await getStore().restore(entity, co, key); await load(); };

  if (ok === null) return <Loading />;

  return (
    <Page title="감사 · 휴지통"
      listTools={tab === 'audit' ? {
        search: { value: q, onChange: setQ, placeholder: '차번·계약·채팅·행위자 검색' },
        filter: {
          count: domain ? 1 : 0,
          title: '감사 필터',
          onClear: () => setDomain(''),
          body: (
            <>
              <SectionLabel mt={0}>영역</SectionLabel>
              <FilterChips value={domain} onChange={setDomain} options={AUDIT_DOMAIN_OPTS} />
            </>
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
          {!mobile && (
            <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <FilterChips value={domain} onChange={setDomain} options={AUDIT_DOMAIN_OPTS} />
              <SearchInput value={q} onChange={setQ} placeholder="차번·계약·채팅·행위자 검색" full />
            </div>
          )}
          <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, overflow: 'hidden' }}>
            {shownLogs.length === 0 ? <CenterNote>기록이 없습니다.</CenterNote> :
              shownLogs.map((l, i) => <AuditRow key={String(l._key) || i} log={l} />)}
          </div>
          <div style={{ marginTop: 10, fontSize: FS.cap, color: C.faint, lineHeight: 1.5 }}>
            매물·대여료·계약·정산·채팅·정책·회원 변경이 자동 기록됩니다. 채팅은 메시지 본문, 대여료는 기간별 금액 diff.
            방 unread 갱신은 제외(메시지 로그로 대체). 최근 표시 500건.
          </div>
        </>
      ) : (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, overflow: 'hidden' }}>
          {deleted.length === 0 ? <CenterNote>삭제된 항목이 없습니다.</CenterNote> :
            deleted.map(({ entity, rec }, i) => (
              <div key={`${entity}_${rec._key}_${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: i ? `1px solid ${C.line2}` : 'none' }}>
                <Badge tone="gray">{label(entity)}</Badge>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: FS.sub, fontWeight: FW.strong, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(rec.car_number || rec.customer_name || rec.name || rec.contract_code || rec.policy_name || rec._key)}</div>
                  <div style={{ fontSize: FS.cap, color: C.faint }}>삭제 {fmt(Date.parse(String(rec.deletedAt || '')) || undefined)} {rec.deletedReason ? `· ${rec.deletedReason}` : ''}</div>
                </div>
                <Btn variant="ghost" size="sm" onClick={() => restore(entity, String(rec._key))}>복구</Btn>
              </div>
            ))}
        </div>
      )}
    </Page>
  );
}
