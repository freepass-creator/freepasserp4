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
import { buildMasterIndex, atomHealth, lowestRent, fareTable, updatedAt, HEALTH_RANK, type Health } from '@/lib/domain/atom-health';
import type { MasterIndex } from '@/lib/domain/atom-invariants';

/**
 * 원천 세부 — 한 원천(공급사)의 전체 생애. 위계 SSOT = docs/연동허브-커넥터.md §4.
 *   위치 → ①변환(원본→우리 원자) → ②원자 → ③나감 → ④직접. 읽기전용(products 파생).
 *   당겨오기/미리보기/정밀타격(외부 자격)은 수집 파이프라인 몫 — 버튼은 그걸 부른다(다음 단계).
 */
const S = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const HEALTH_TONE: Record<Health, 'green' | 'orange' | 'red'> = { 정상: 'green', 주의: 'orange', 문제: 'red' };
const SRC_LABEL: Record<string, string> = { sheet: '구글시트', iron: '홈페이지', sonokong: '손오공 API' };
const wonMan = (n: number) => (n >= 10000 ? `${Math.round(n / 10000)}만` : n ? String(n) : '');
function ago(ms: number, now: number): string { const t = num(ms); if (!t) return '—'; const s = Math.max(0, Math.round((now - t) / 1000)); if (s < 3600) return `${Math.round(s / 60)}분`; if (s < 86400) return `${Math.round(s / 3600)}시간`; return `${Math.round(s / 86400)}일`; }
function statusColor(status: string): string { const t = (VEHICLE_STATUS_TONE[status.replace(/\s+/g, '') as keyof typeof VEHICLE_STATUS_TONE] as string) || 'gray'; return t === 'green' ? C.ok : t === 'red' ? C.danger : t === 'orange' ? C.warn : C.mute; }
const OUTS = ['📊 판매 구글시트', '🖥️ ERP 파인더', '🛒 B2C 손님 카탈로그', '🏷️ 화이트라벨 채널'];

export default function SourceDetailPage() {
  const params = useParams<{ code: string }>();
  const code = S(decodeURIComponent(S(params?.code)));
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
    const mine = (rows || []).filter((r) => (S(r.provider_company_code) || S(r.partner_code)) === code);
    let bad = 0, warn = 0, ok = 0, upd = 0;
    const enr = mine.map((r) => { const h = idx ? atomHealth(r, idx, now, Number.MAX_SAFE_INTEGER) : null; const hh = (h?.health || '정상') as Health; hh === '문제' ? bad++ : hh === '주의' ? warn++ : ok++; upd = Math.max(upd, updatedAt(r)); return { r, h: hh, vio: h ? [...h.blocks, ...h.warns] : [] }; })
      .sort((a, b) => HEALTH_RANK[a.h] - HEALTH_RANK[b.h] || updatedAt(b.r) - updatedAt(a.r));
    const one = mine.find((r) => S((r.원문 as { 차명?: unknown } | undefined)?.차명)) || mine[0];
    return { mine, enr, bad, warn, ok, upd, one, src: S(mine[0]?.source), tab: S(mine[0]?.sheet_source_tab) };
  }, [rows, idx, code, now]);

  const label = { fontSize: FS.cap, color: C.mute, flex: '0 0 88px', width: 88 } as const;
  const kv = (k: string, v: React.ReactNode, isNum = false) => (
    <div style={{ display: 'flex', padding: '5px 11px', fontSize: FS.sub, borderTop: `1px solid ${C.line2}` }}>
      <span style={label}>{k}</span><span style={{ color: C.ink, fontFamily: isNum ? NUM : undefined }}>{v}</span>
    </div>
  );
  const card = { border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', background: C.taupeBg } as const;
  const sectionH = { fontSize: FS.cap, fontWeight: FW.head, color: C.mute, margin: '14px 2px 6px' } as const;
  const one = d.one; const ft = one ? fareTable(one.price) : null;
  const rawName = one ? S((one.원문 as { 차명?: unknown } | undefined)?.차명) : '';

  return (
    <Page title={`원천 세부 — ${code}`}>
      <div style={{ fontSize: FS.cap, color: C.mute, marginBottom: 8 }}><Link href="/connectors" style={{ color: C.accent }}>🔌 연동 허브</Link> › 원천 세부 — <b style={{ color: C.ink }}>{code}</b></div>
      {authReady && !session && <CenterNote>이 주소에서 로그인해야 원천이 보입니다.</CenterNote>}
      {authed && err && <CenterNote>{err}</CenterNote>}
      {authed && rows === null && !err && <Loading />}
      {authed && rows !== null && !d.mine.length && <CenterNote>원천 «{code}» 의 원자가 없습니다. <Link href="/connectors" style={{ color: C.accent }}>연동 허브로</Link></CenterNote>}

      {authed && d.mine.length > 0 && (
        <>
          {/* 머리 */}
          <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, padding: '11px 14px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: FS.title, fontWeight: FW.head }}>📄 {code} · {SRC_LABEL[d.src] || d.src || '원천'}</span>
            <span style={{ fontSize: FS.sub, fontWeight: FW.strong }}><span style={{ fontFamily: NUM }}>{d.mine.length}</span>대 · <span style={{ color: C.ok }}>정상 {d.ok}</span> <span style={{ color: C.warn }}>주의 {d.warn}</span> <span style={{ color: C.danger }}>문제 {d.bad}</span></span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: FS.cap, color: C.mute }}>지금 당겨오기 · 미리보기 · 검수 {d.warn}건 <i style={{ color: C.faint }}>(수집 파이프라인 연결 예정)</i></span>
          </div>

          {/* 📍 위치 */}
          <div style={sectionH}>📍 원천 위치 — 어디서 오나</div>
          <div style={card}>
            {kv('종류', SRC_LABEL[d.src] || d.src || '—')}
            {kv('탭/경로', d.tab || '—')}
            {kv('마지막 당겨오기', `${ago(d.upd, now)} 전`)}
            {kv('자동 갱신', '매시간 (평일 09~18)')}
          </div>

          {/* ① 변환 */}
          {one && (
            <>
              <div style={sectionH}>① 갖고 와서 어떻게 «우리 원자»로 했나 — 원본 → 원자 ({S(one.car_number)})</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
                <div style={{ ...card, flex: '1 1 260px', minWidth: 240 }}>
                  <div style={{ padding: '6px 11px', fontSize: FS.cap, fontWeight: FW.head, color: C.mute, borderBottom: `1px solid ${C.line2}` }}>공급사 원본 (준 그대로)</div>
                  {kv('차명', rawName || '—')}
                  {kv('옵션', S((one.원문 as { 옵션?: unknown } | undefined)?.옵션) || S(one.options) || '—')}
                  {kv('상태(원문)', S(one.status) || '—')}
                  {kv('색(원문)', [S(one.ext_color), S(one.int_color)].filter(Boolean).join('/') || '—')}
                  {kv('요금(원문)', ft && ft.count ? ft.periods.map((p) => p + '개월').join(' · ') : '—')}
                </div>
                <div style={{ ...card, flex: '1 1 300px', minWidth: 260 }}>
                  <div style={{ padding: '6px 11px', fontSize: FS.cap, fontWeight: FW.head, color: C.brand, background: C.selected, borderBottom: `1px solid ${C.line2}` }}>우리 원자 (정제·원자화 · 차번=키)</div>
                  {kv('제조사·모델', [S(one.maker), S(one.model)].filter(Boolean).join(' ') || '—')}
                  {kv('세부·트림', [S(one.sub_model), S(one.trim_name)].filter(Boolean).join(' · ') || '—')}
                  {kv('연료·배기량', [S(one.fuel_type), num(one.engine_cc) ? num(one.engine_cc) + 'cc' : ''].filter(Boolean).join(' · ') || '—')}
                  {kv('배차상태', <span style={{ color: statusColor(S(one.status)), fontWeight: FW.strong }}>{S(one.status) || '—'}</span>)}
                  {kv('기간별 요금', ft && ft.count ? `${ft.count}구간 {대여료·보증금}` : '—')}
                  {kv('건강', <Badge tone={HEALTH_TONE[d.enr.find((e) => e.r === one)?.h || '정상']}>{d.enr.find((e) => e.r === one)?.h || '정상'}</Badge>)}
                </div>
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* ② 원자 */}
            <div style={{ flex: '1.4 1 320px', minWidth: 280 }}>
              <div style={sectionH}>② 이 원천이 만든 원자 — 샘에 보관됨</div>
              <div style={{ ...card, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: FS.sub, whiteSpace: 'nowrap' }}>
                  <thead><tr style={{ background: C.head, color: C.mute, fontSize: FS.cap, fontWeight: FW.label, textAlign: 'left' }}>{['건강', '차번', '차명', '상태', '주행', '대여료'].map((h) => <th key={h} style={{ padding: '6px 9px', borderBottom: `1px solid ${C.line}` }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {d.enr.slice(0, 12).map((e) => { const r = e.r; const low = lowestRent(r.price); const st = S(r.status) || S(r.status_kind);
                      return (
                        <tr key={S(r.car_number)} style={{ borderBottom: `1px solid ${C.line2}` }}>
                          <td style={{ padding: '4px 9px' }}><Badge tone={HEALTH_TONE[e.h]}>{e.h}</Badge></td>
                          <td style={{ padding: '4px 9px', fontFamily: NUM, fontWeight: FW.strong }}>{S(r.car_number)}</td>
                          <td style={{ padding: '4px 9px' }}>{[S(r.maker), S(r.model), S(r.sub_model), S(r.trim_name)].filter(Boolean).join(' · ') || '—'}</td>
                          <td style={{ padding: '4px 9px', color: statusColor(st), fontWeight: FW.strong }}>{st || '—'}</td>
                          <td style={{ padding: '4px 9px', fontFamily: NUM, color: C.mute }}>{num(r.mileage) ? num(r.mileage).toLocaleString() + 'km' : '—'}</td>
                          <td style={{ padding: '4px 9px', fontFamily: NUM }}>{low ? wonMan(low) + '~' : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Link href={`/spring?in=${encodeURIComponent(code)}`} style={{ display: 'inline-block', padding: '8px 2px', color: C.accent, fontWeight: FW.strong, fontSize: FS.sub }}>＝ 샘(/spring)에서 이 원천({code}) {d.mine.length}대만 보기 ›</Link>
            </div>

            {/* ③ 나감 · ④ 직접 */}
            <div style={{ flex: '1 1 260px', minWidth: 240 }}>
              <div style={sectionH}>③ 이 원천의 원자가 어디로 나가나 (OUT)</div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {OUTS.map((o) => <span key={o} style={{ ...card, padding: '5px 11px', fontSize: FS.sub, display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: C.ok }} />{o}</span>)}
              </div>
              <div style={{ fontSize: FS.cap, color: C.mute, padding: '8px 2px' }}>→ 같은 원자가 이 옷들로 나갑니다. (목적지 세부는 다음 단계)</div>
              <div style={sectionH}>④ 원자 직접 처리</div>
              <div style={{ ...card, padding: '10px 12px', fontSize: FS.sub, color: C.mute }}>정밀타격(재수집) · 검수 {d.warn}건 · 원자 열기 <i style={{ color: C.faint }}>— 여기서 그 원천 원자를 바로 (파이프라인 연결 예정)</i></div>
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
