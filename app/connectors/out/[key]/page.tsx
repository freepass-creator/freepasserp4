'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Page } from '@/components/Page';
import { C, FS, FW, NUM, R, Loading, CenterNote, Badge, VEHICLE_STATUS_TONE } from '@/components/ui';
import { useSession, useAuthReady } from '@/lib/auth-context';
import { subscribeFirestoreProducts } from '@/lib/firebase/firestore-products-client';
import type { EntityRecord } from '@/lib/intake/entities';
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';
import { buildMasterIndex, atomHealth, lowestRent, updatedAt, HEALTH_RANK, type Health } from '@/lib/domain/atom-health';
import type { MasterIndex } from '@/lib/domain/atom-invariants';

/**
 * 목적지 세부 — 한 «옷»(내보내기 대상)이 무엇을·어디로·언제·성패로 나가나. 위계 §4(OUT 판).
 *   나가는 원자(products 파생)는 이 화면이 읽고, «발행 시각·성패»는 파이프라인·관제탑(/hub) 몫.
 */
const S = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const HEALTH_TONE: Record<Health, 'green' | 'orange' | 'red'> = { 정상: 'green', 주의: 'orange', 문제: 'red' };
const wonMan = (n: number) => (n >= 10000 ? `${Math.round(n / 10000)}만` : n ? String(n) : '');
function statusColor(status: string): string { const t = (VEHICLE_STATUS_TONE[status.replace(/\s+/g, '') as keyof typeof VEHICLE_STATUS_TONE] as string) || 'gray'; return t === 'green' ? C.ok : t === 'red' ? C.danger : t === 'orange' ? C.warn : C.mute; }

type Meta = { icon: string; name: string; what: string; fmt: string; where: string; live: boolean };
const KEY_META: Record<string, Meta> = {
  sheet: { icon: '📊', name: '판매 구글시트', what: '차·대여료·정책 (차 4탭)', fmt: '구글시트', where: '영업자 취합 시트', live: true },
  finder: { icon: '🖥️', name: 'ERP 파인더', what: '상품찾기 카탈로그', fmt: 'ERP 화면', where: '/finder', live: true },
  b2c: { icon: '🛒', name: 'B2C 손님 카탈로그', what: '손님용 카탈로그·상세', fmt: '손님 웹', where: '/shop · /q/[code]', live: true },
  whitelabel: { icon: '🏷️', name: '화이트라벨 채널', what: '채널 이름으로(노브랜드)', fmt: '채널 웹', where: '채널 도메인', live: true },
  channel: { icon: '🧾', name: '채널·정산 시트', what: '조건·머리띠·정산', fmt: '구글시트', where: '채널 시트', live: true },
  api: { icon: '🔌', name: '외부 영업채널 API', what: '차·요금·정책 push', fmt: 'REST', where: '(추가 예정)', live: false },
};

export default function DestDetailPage() {
  const params = useParams<{ key: string }>();
  const key = S(decodeURIComponent(S(params?.key)));
  const meta = KEY_META[key];
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [idx, setIdx] = useState<MasterIndex | null>(null);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const session = useSession(); const authReady = useAuthReady(); const authed = authReady && !!session;

  useEffect(() => {
    let alive = true;
    fetch('/data/vehicle-master.json').then((r) => r.json()).then((j) => { if (alive) setIdx(buildMasterIndex((Array.isArray(j) ? j : j.entries || []) as MasterEntry[])); }).catch(() => { if (alive) setIdx(buildMasterIndex([])); });
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  useEffect(() => { if (!authed) return; const unsub = subscribeFirestoreProducts((r) => { setRows(r); setErr(''); }, (e) => setErr(e instanceof Error ? e.message : '구독 실패 — 권한 확인')); return () => unsub(); }, [authed]);

  const d = useMemo(() => {
    // 나가는 원자 = 노출 대상(출고불가 제외 · listable). 옷마다 같은 샘을 읽는다.
    const out = (rows || []).filter((r) => r.listable !== false && !/불가/.test(S(r.status) || S(r.status_kind)));
    let bad = 0, warn = 0, ok = 0;
    const enr = out.map((r) => { const h = idx ? atomHealth(r, idx, now, Number.MAX_SAFE_INTEGER) : null; const hh = (h?.health || '정상') as Health; hh === '문제' ? bad++ : hh === '주의' ? warn++ : ok++; return { r, h: hh }; })
      .sort((a, b) => HEALTH_RANK[a.h] - HEALTH_RANK[b.h] || updatedAt(b.r) - updatedAt(a.r));
    return { out, enr, bad, warn, ok };
  }, [rows, idx, now]);

  const label = { fontSize: FS.cap, color: C.mute, flex: '0 0 92px', width: 92 } as const;
  const kv = (k: string, v: React.ReactNode) => (<div style={{ display: 'flex', padding: '5px 11px', fontSize: FS.sub, borderTop: `1px solid ${C.line2}` }}><span style={label}>{k}</span><span style={{ color: C.ink }}>{v}</span></div>);
  const card = { border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', background: C.taupeBg } as const;
  const sectionH = { fontSize: FS.cap, fontWeight: FW.head, color: C.mute, margin: '14px 2px 6px' } as const;

  if (!meta) return <Page title="목적지 세부"><CenterNote>알 수 없는 목적지 «{key}». <Link href="/connectors" style={{ color: C.accent }}>연동 허브로</Link></CenterNote></Page>;

  return (
    <Page title={`목적지 세부 — ${meta.name}`}>
      <div style={{ fontSize: FS.cap, color: C.mute, marginBottom: 8 }}><Link href="/connectors" style={{ color: C.accent }}>🔌 연동 허브</Link> › 목적지 세부 — <b style={{ color: C.ink }}>{meta.name}</b></div>
      {authReady && !session && <CenterNote>이 주소에서 로그인해야 보입니다.</CenterNote>}
      {authed && err && <CenterNote>{err}</CenterNote>}
      {authed && rows === null && !err && <Loading />}

      {authed && rows !== null && (
        <>
          <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, padding: '11px 14px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: FS.title, fontWeight: FW.head }}>{meta.icon} {meta.name}</span>
            <span style={{ fontSize: FS.sub, fontWeight: FW.strong }}><span style={{ fontFamily: NUM }}>{d.out.length}</span>대 나감 · <span style={{ color: C.ok }}>정상 {d.ok}</span> <span style={{ color: C.warn }}>주의 {d.warn}</span></span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: FS.cap, color: C.mute }}>{meta.live ? '연결됨' : '계획'} · 지금 발행 · 로그 <i style={{ color: C.faint }}>(발행 파이프라인 연결 예정)</i></span>
          </div>

          <div style={sectionH}>무엇을 · 어디로 내보내나</div>
          <div style={card}>
            {kv('무엇', meta.what)}
            {kv('형식', meta.fmt)}
            {kv('어디로', meta.where)}
            {kv('나가는 대상', `노출 원자 ${d.out.length}대 (출고불가 제외 · 계약중 포함)`)}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1.4 1 320px', minWidth: 280 }}>
              <div style={sectionH}>이 목적지로 나가는 원자 — 샘에서 온다</div>
              <div style={{ ...card, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: FS.sub, whiteSpace: 'nowrap' }}>
                  <thead><tr style={{ background: C.head, color: C.mute, fontSize: FS.cap, fontWeight: FW.label, textAlign: 'left' }}>{['건강', '차번', '차명', '상태', '대여료'].map((h) => <th key={h} style={{ padding: '6px 9px', borderBottom: `1px solid ${C.line}` }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {d.enr.slice(0, 12).map((e) => { const r = e.r; const low = lowestRent(r.price); const st = S(r.status) || S(r.status_kind);
                      return (
                        <tr key={S(r.car_number)} style={{ borderBottom: `1px solid ${C.line2}` }}>
                          <td style={{ padding: '4px 9px' }}><Badge tone={HEALTH_TONE[e.h]}>{e.h}</Badge></td>
                          <td style={{ padding: '4px 9px', fontFamily: NUM, fontWeight: FW.strong }}>{S(r.car_number)}</td>
                          <td style={{ padding: '4px 9px' }}>{[S(r.maker), S(r.model), S(r.sub_model), S(r.trim_name)].filter(Boolean).join(' · ') || '—'}</td>
                          <td style={{ padding: '4px 9px', color: statusColor(st), fontWeight: FW.strong }}>{st || '—'}</td>
                          <td style={{ padding: '4px 9px', fontFamily: NUM }}>{low ? wonMan(low) + '~' : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Link href="/spring" style={{ display: 'inline-block', padding: '8px 2px', color: C.accent, fontWeight: FW.strong, fontSize: FS.sub }}>＝ 샘(/spring)에서 전체 원자 보기 ›</Link>
            </div>
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <div style={sectionH}>발행 상태 — 언제 · 성패</div>
              <div style={{ ...card, padding: '10px 12px', fontSize: FS.sub, color: C.mute, lineHeight: 1.7 }}>
                마지막 발행·성패는 <Link href="/hub" style={{ color: C.accent, fontWeight: FW.strong }}>관제탑(/hub)</Link>에서 실시간으로 봅니다(파이프라인이 도는지).<br />
                이 화면은 <b style={{ color: C.ink }}>무엇이 나가나</b>(원자)를 보고, 발행 실행은 발행 파이프라인 몫입니다.
              </div>
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
