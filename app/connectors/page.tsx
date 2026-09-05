'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Page } from '@/components/Page';
import { C, FS, FW, NUM, R, Loading, CenterNote } from '@/components/ui';
import { useSession, useAuthReady } from '@/lib/auth-context';
import { subscribeFirestoreProducts } from '@/lib/firebase/firestore-products-client';
import type { EntityRecord } from '@/lib/intake/entities';
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';
import { buildMasterIndex, atomHealth, updatedAt } from '@/lib/domain/atom-health';
import type { MasterIndex } from '@/lib/domain/atom-invariants';

/**
 * 연동 허브 — 당겨오기(IN) · 샘 · 내보내기(OUT)를 한 장에. 위계 SSOT = docs/연동허브-커넥터.md.
 *   원천·목적지를 «요약»으로 보여주고, 누르면 세부/샘으로 간다. 읽기전용(Firestore products 파생).
 *   실제 당겨오기/내보내기(외부 자격)는 수집·발행 파이프라인 몫 — 버튼은 그걸 부른다(다음 단계).
 */
const S = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
function ago(ms: number, now: number): string {
  const t = num(ms); if (!t) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 3600) return `${Math.round(s / 60)}분`;
  if (s < 86400) return `${Math.round(s / 3600)}시간`;
  return `${Math.round(s / 86400)}일`;
}
const SRC_GROUP: Record<string, { icon: string; name: string }> = {
  sheet: { icon: '📄', name: '구글시트 (공급사 제공)' },
  sonokong: { icon: '🔗', name: '손오공 API' },
  iron: { icon: '🌐', name: '홈페이지 · 아이언렌트카' },
  mirror: { icon: '📥', name: '미러/수기 (원천표시 없음)' },
};
type Agg = { n: number; bad: number; warn: number; upd: number };
const OUTS: { icon: string; name: string; what: string; live: boolean }[] = [
  { icon: '📊', name: '판매 구글시트', what: '차 4탭·대여료·정책', live: true },
  { icon: '🖥️', name: 'ERP 파인더', what: '상품찾기 카탈로그', live: true },
  { icon: '🛒', name: 'B2C 손님 카탈로그', what: '/shop · /q 상세', live: true },
  { icon: '🏷️', name: '화이트라벨 채널', what: '채널 이름으로', live: true },
  { icon: '🧾', name: '채널·정산 시트', what: '조건·머리띠·정산', live: true },
  { icon: '🔌', name: '외부 영업채널 API', what: '차·요금·정책 push', live: false },
];

export default function ConnectorsPage() {
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [idx, setIdx] = useState<MasterIndex | null>(null);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const session = useSession();
  const authReady = useAuthReady();
  const authed = authReady && !!session;

  useEffect(() => {
    let alive = true;
    fetch('/data/vehicle-master.json').then((r) => r.json()).then((j) => {
      if (!alive) return;
      setIdx(buildMasterIndex((Array.isArray(j) ? j : j.entries || []) as MasterEntry[]));
    }).catch(() => { if (alive) setIdx(buildMasterIndex([])); });
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!authed) return;
    const unsub = subscribeFirestoreProducts((r) => { setRows(r); setErr(''); }, (e) => setErr(e instanceof Error ? e.message : '구독 실패 — 권한/규칙 확인'));
    return () => unsub();
  }, [authed]);

  const { total, hb, hw, ho, sheetProvs, groups } = useMemo(() => {
    const bump = (a: Agg, health: string, u: number) => { a.n++; if (health === '문제') a.bad++; else if (health === '주의') a.warn++; a.upd = Math.max(a.upd, u); };
    const mk = (): Agg => ({ n: 0, bad: 0, warn: 0, upd: 0 });
    const prov = new Map<string, Agg>(); const g: Record<string, Agg> = { sonokong: mk(), iron: mk(), mirror: mk() };
    let t = 0, b = 0, w = 0, o = 0;
    for (const r of rows || []) {
      const health = idx ? atomHealth(r, idx, now, Number.MAX_SAFE_INTEGER).health : '정상';
      t++; health === '문제' ? b++ : health === '주의' ? w++ : o++;
      const src = S(r.source); const p = S(r.provider_company_code) || S(r.partner_code); const u = updatedAt(r);
      if (src === 'sheet') { let e = prov.get(p || '?'); if (!e) { e = mk(); prov.set(p || '?', e); } bump(e, health, u); }
      else if (src === 'sonokong') bump(g.sonokong, health, u);
      else if (src === 'iron') bump(g.iron, health, u);
      else bump(g.mirror, health, u);
    }
    return { total: t, hb: b, hw: w, ho: o, sheetProvs: [...prov.entries()].sort((a, c) => c[1].n - a[1].n), groups: g };
  }, [rows, idx, now]);

  const dotColor = (a: Agg) => (a.bad ? C.danger : a.warn ? C.warn : C.ok);
  const sheetTotal = sheetProvs.reduce((s, [, a]) => s + a.n, 0);

  const cardStyle = { border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', background: C.taupeBg } as const;
  const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderBottom: `1px solid ${C.line2}`, textDecoration: 'none', color: C.ink } as const;
  const Dot = ({ color }: { color: string }) => <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flex: '0 0 auto' }} />;

  return (
    <Page title="연동 허브 — 당겨오기·내보내기" meta={total || undefined}>
      {authReady && !session && <CenterNote>이 주소에서 로그인해야 원천이 보입니다.</CenterNote>}
      {authed && err && <CenterNote>{err}</CenterNote>}
      {authed && rows === null && !err && <Loading />}

      {authed && rows !== null && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* 당겨오기 (IN) */}
          <div style={{ flex: '1 1 300px', minWidth: 260 }}>
            <div style={{ fontSize: FS.cap, fontWeight: FW.head, color: C.mute, marginBottom: 8 }}>당겨오기 (IN) · 원천 → 샘</div>
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 11px', background: C.head, fontSize: FS.sub, fontWeight: FW.head, borderBottom: `1px solid ${C.line2}` }}>
                📄 구글시트 (공급사 제공)<span style={{ marginLeft: 'auto', fontSize: FS.cap, color: C.mute, fontWeight: FW.meta }}>{sheetProvs.length}개사 · {sheetTotal}대</span>
              </div>
              {sheetProvs.map(([p, a]) => (
                <Link key={p} href={`/spring?in=${encodeURIComponent(p)}`} style={{ ...rowStyle, paddingLeft: 24 }}>
                  <span style={{ width: 12, textAlign: 'center', color: C.faint }}>•</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: FS.sub }}>{p}</span>
                  <span style={{ fontSize: FS.sub, color: C.mute, fontFamily: NUM }}>{a.n}</span>
                  <Dot color={dotColor(a)} />
                  <span style={{ fontSize: FS.cap, color: C.faint, width: 34, textAlign: 'right' }}>{ago(a.upd, now)}</span>
                  <span style={{ color: C.faint }}>›</span>
                </Link>
              ))}
              {(['sonokong', 'iron', 'mirror'] as const).filter((k) => groups[k].n).map((k) => (
                <Link key={k} href={`/spring?src=${k}`} style={rowStyle}>
                  <span style={{ width: 16, textAlign: 'center' }}>{SRC_GROUP[k].icon}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: FS.sub }}>{SRC_GROUP[k].name}</span>
                  <span style={{ fontSize: FS.sub, color: C.mute, fontFamily: NUM }}>{groups[k].n}</span>
                  <Dot color={dotColor(groups[k])} />
                  <span style={{ fontSize: FS.cap, color: C.faint, width: 34, textAlign: 'right' }}>{ago(groups[k].upd, now)}</span>
                  <span style={{ color: C.faint }}>›</span>
                </Link>
              ))}
              <div style={{ padding: '9px 11px', textAlign: 'center', fontSize: FS.sub, color: C.accent, fontWeight: FW.strong }}>＋ 새 원천 당겨오기 (시트·API·홈피·ERP)</div>
            </div>
          </div>

          {/* 샘 */}
          <div style={{ flex: '1 1 240px', minWidth: 220, display: 'flex', flexDirection: 'column', alignItems: 'stretch', paddingTop: 22 }}>
            <Link href="/spring" style={{ textDecoration: 'none', background: C.taupeBg, border: `2px solid ${C.brand}`, borderRadius: R, padding: 16, textAlign: 'center', display: 'block', color: C.ink }}>
              <div style={{ fontSize: FS.title, fontWeight: FW.head, color: C.brand }}>🛢️ 샘 · 원자 데이터베이스</div>
              <div style={{ fontSize: FS.page, fontWeight: FW.head, fontFamily: NUM, margin: '6px 0 2px', color: C.ink }}>{total.toLocaleString()}<span style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.meta }}> 대</span></div>
              <div style={{ fontSize: FS.cap, color: C.faint }}>차번 = 키 · 구조적 유일</div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 8, fontSize: FS.sub, fontWeight: FW.strong }}>
                <span style={{ color: C.danger }}>● 문제 {hb}</span><span style={{ color: C.warn }}>● 주의 {hw}</span><span style={{ color: C.ok }}>● 정상 {ho}</span>
              </div>
              <div style={{ marginTop: 10, fontSize: FS.cap, fontWeight: FW.strong, color: C.accent }}>＝ /spring 원자 데이터베이스 열기 ›</div>
            </Link>
            <div style={{ fontSize: FS.cap, color: C.mute, textAlign: 'center', marginTop: 8, lineHeight: 1.6 }}>원천이 뭘 줘도 여기서 원자화해 보관<br />모든 옷은 여기 하나를 읽는다 (안 갈라진다)</div>
          </div>

          {/* 내보내기 (OUT) */}
          <div style={{ flex: '1 1 300px', minWidth: 260 }}>
            <div style={{ fontSize: FS.cap, fontWeight: FW.head, color: C.mute, marginBottom: 8 }}>내보내기 (OUT) · 샘 → 목적지</div>
            <div style={cardStyle}>
              {OUTS.map((o) => (
                <div key={o.name} style={{ ...rowStyle, opacity: o.live ? 1 : 0.7 }}>
                  <span style={{ width: 16, textAlign: 'center' }}>{o.icon}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: FS.sub }}>{o.name}<small style={{ display: 'block', fontSize: FS.cap, color: C.faint }}>{o.what}</small></span>
                  <Dot color={o.live ? C.ok : C.faint} />
                  <span style={{ fontSize: FS.cap, color: C.faint, width: 34, textAlign: 'right' }}>{o.live ? '연결' : '계획'}</span>
                  <span style={{ color: C.faint }}>›</span>
                </div>
              ))}
              <div style={{ padding: '9px 11px', textAlign: 'center', fontSize: FS.sub, color: C.accent, fontWeight: FW.strong }}>＋ 새 목적지 내보내기</div>
            </div>
          </div>
        </div>
      )}

      {authed && rows !== null && (
        <div style={{ marginTop: 14, fontSize: FS.sub, color: C.mute, lineHeight: 1.7, border: `1px solid ${C.line}`, borderRadius: R, padding: '10px 13px' }}>
          <b style={{ color: C.ink }}>당겨오기와 내보내기는 «한 몸».</b> 왼쪽에서 당겨 오면 샘이 원자화해 보관, 오른쪽으로 내보내 여러 옷을 찍습니다. 어느 노드든 누르면 그 세부(원천은 위치·변환·나가는 곳 / 목적지는 발행 세부)로. 데이터는 늘 이 샘 하나 — 안 갈라집니다.
        </div>
      )}
    </Page>
  );
}
