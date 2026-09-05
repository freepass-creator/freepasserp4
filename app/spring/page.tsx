'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSession, useAuthReady } from '@/lib/auth-context';
import { Page } from '@/components/Page';
import { C, FS, FW, NUM, R, SearchInput, Loading, CenterNote, VEHICLE_STATUS_TONE, Badge, PillTabs, Section, DetailGrid } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { subscribeFirestoreProducts } from '@/lib/firebase/firestore-products-client';
import { subscribeFirestorePolicies } from '@/lib/firebase/firestore-policy-client';
import type { EntityRecord } from '@/lib/intake/entities';
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';
import { nonCommonKeys, unknownKeys } from '@/lib/domain/atom-fields';
import { buildMasterIndex, atomHealth, joinPolicy, fareTable, lowestRent, updatedAt, HEALTH_RANK, type Health } from '@/lib/domain/atom-health';
import type { MasterIndex } from '@/lib/domain/atom-invariants';

/**
 * 샘 — 오염 안 된 «원자 데이터베이스(Firestore products)» 관리 + 실시간 감시 한 장.
 *   사장님 2026-09-05 「원자 관리 확실하게 + 실시간 모니터링. 문제 있는 것/없는 것 구분해서.」
 *
 * ★데이터 성질을 섞지 않는다(SSOT = lib/domain/atom-fields 역할표):
 *    공통(정체·제원) = 목록의 뼈대 · 변동(상태·주행·요금) = 매시간 · 정책 = 조인 · 비공통(원문) = 계산.
 * ★건강 = lib/domain/atom-health(불변식 엔진) — block 문제 · warn/미확정/지연 주의 · else 정상. 문제 먼저.
 * ★읽기만 — 원천이 정본. 여기선 값을 손으로 고치지 않는다.
 */
const S = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const HEALTH_TONE: Record<Health, 'green' | 'orange' | 'red'> = { 정상: 'green', 주의: 'orange', 문제: 'red' };
const SRC_LABEL: Record<string, string> = { sheet: '시트', iron: '홈피', sonokong: '손오공' };
const wonMan = (n: number) => (n >= 10000 ? `${Math.round(n / 10000)}만` : n ? String(n) : '');

function ago(ms: number, now: number): string {
  const t = num(ms); if (!t) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.round(s / 60)}분`;
  if (s < 86400) return `${Math.round(s / 3600)}시간`;
  return `${Math.round(s / 86400)}일`;
}
function statusTone(status: string): 'green' | 'red' | 'orange' | 'gray' {
  return (VEHICLE_STATUS_TONE[status.replace(/\s+/g, '') as keyof typeof VEHICLE_STATUS_TONE] as 'green' | 'red' | 'orange' | 'gray') || 'gray';
}

type Vio = { code: string; severity: 'block' | 'warn'; msg: string };
type Enriched = { r: EntityRecord; car: string; health: Health; reasons: string[]; vio: Vio[]; upd: number };

export default function SpringPage() {
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [policies, setPolicies] = useState<EntityRecord[]>([]);
  const [idx, setIdx] = useState<MasterIndex | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [hFilter, setHFilter] = useState<'전체' | Health>('전체');
  const [selCar, setSelCar] = useState<string>('');
  const [now, setNow] = useState(() => Date.now());
  const [inProv, setInProv] = useState(''); // 연동 허브에서 «이 원천만 보기»
  const [inSrc, setInSrc] = useState('');
  useEffect(() => { try { const p = new URLSearchParams(window.location.search); setInProv(S(p.get('in'))); setInSrc(S(p.get('src'))); } catch { /* */ } }, []);
  const mobile = useIsMobile();
  const session = useSession();
  const authReady = useAuthReady();
  const authed = authReady && !!session;   // ★인증(Firebase) 복원 뒤에만 구독 — 2026-09-04 파인더 사고 방지

  // 차종마스터 = 공개 에셋. 인증과 무관하게 미리 받는다.
  useEffect(() => {
    let alive = true;
    fetch('/data/vehicle-master.json').then((r) => r.json()).then((j) => {
      if (!alive) return;
      const entries = (Array.isArray(j) ? j : j.entries || []) as MasterEntry[];
      setIdx(buildMasterIndex(entries));
    }).catch(() => { if (alive) setIdx(buildMasterIndex([])); });
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // 구독은 «인증 준비 + 세션 있음» 뒤에만. 규칙에 막혀 빈 채로 굳는 것 방지(실패 시 클라이언트가 핸들 해제 → 재시도됨).
  useEffect(() => {
    if (!authed) return;
    const unsubP = subscribeFirestoreProducts((r) => { setRows(r); setErr(''); }, (e) => setErr(e instanceof Error ? e.message : '구독 실패 — 권한/규칙 확인'));
    const unsubPol = subscribeFirestorePolicies((p) => setPolicies(p as EntityRecord[]));
    return () => { unsubP(); unsubPol(); };
  }, [authed]);

  const polByKey = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const p of policies) m.set(S(p._key), p);
    return m;
  }, [policies]);

  const enriched = useMemo<Enriched[]>(() => {
    if (!rows || !idx) return [];
    return rows.map((r) => {
      const h = atomHealth(r, idx, now);
      return { r, car: S(r.car_number) || S(r._key), health: h.health, reasons: h.reasons, vio: [...h.blocks, ...h.warns], upd: updatedAt(r) };
    });
  }, [rows, idx, now]);

  const counts = useMemo(() => {
    const c = { 문제: 0, 주의: 0, 정상: 0 };
    for (const e of enriched) c[e.health]++;
    return c;
  }, [enriched]);

  const filtered = useMemo(() => {
    const needle = S(q).toLowerCase();
    const list = enriched.filter((e) => {
      if (hFilter !== '전체' && e.health !== hFilter) return false;
      const r = e.r;
      if (inProv && (S(r.provider_company_code) || S(r.partner_code)) !== inProv) return false;
      if (inSrc && S(r.source) !== inSrc) return false;
      if (!needle) return true;
      return `${S(r.car_number)} ${S(r.maker)} ${S(r.model)} ${S(r.sub_model)} ${S(r.trim_name)} ${S(r.provider_company_code)} ${S(r.policy_code)}`.toLowerCase().includes(needle);
    });
    return list.sort((a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || b.upd - a.upd);
  }, [enriched, q, hFilter, now, inProv, inSrc]);

  const total = rows?.length || 0;
  const sel = useMemo(() => (selCar ? enriched.find((e) => e.car === selCar) : null) || null, [selCar, enriched]);
  const CAP = 500;

  return (
    <Page title="샘 — 원자 데이터베이스" meta={total}>
      {/* ── 감시 머리: 건강 분포 · 실시간 · 검색 · 건강 필터 ── */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 0', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', fontWeight: FW.strong }}>
          <span style={{ color: C.danger }}>● 문제 <b style={{ fontFamily: NUM }}>{counts.문제}</b></span>
          <span style={{ color: C.warn }}>● 주의 <b style={{ fontFamily: NUM }}>{counts.주의}</b></span>
          <span style={{ color: C.ok }}>● 정상 <b style={{ fontFamily: NUM }}>{counts.정상}</b></span>
        </span>
        <span style={{ fontSize: FS.cap, color: C.accent }}>● 실시간 구독</span>
        <span style={{ flex: 1 }} />
        <SearchInput value={q} onChange={setQ} placeholder="차번·제조사·모델·공급사·정책" />
      </div>
      <div style={{ padding: '2px 0 8px' }}>
        <PillTabs<'전체' | Health>
          size="sm"
          value={hFilter}
          onChange={setHFilter}
          tabs={[
            { key: '전체', label: `전체 ${enriched.length}` },
            { key: '문제', label: `문제 ${counts.문제}` },
            { key: '주의', label: `주의 ${counts.주의}` },
            { key: '정상', label: `정상 ${counts.정상}` },
          ]}
        />
      </div>
      {(inProv || inSrc) && (
        <div style={{ padding: '0 0 8px', fontSize: FS.cap }}>
          <span style={{ background: C.selected, color: C.accent, borderRadius: R, padding: '2px 8px', fontWeight: FW.strong }}>원천 {inProv || inSrc}만 · {filtered.length}대</span>
          {' '}<a href="/spring" style={{ color: C.accent, fontWeight: FW.strong }}>· 전체 보기</a>
          {' '}<a href="/connectors" style={{ color: C.mute }}>· 연동 허브</a>
        </div>
      )}

      {authReady && !session && <CenterNote>이 주소에서 로그인해야 원자가 보입니다.</CenterNote>}
      {authed && err && <CenterNote>{err}</CenterNote>}
      {authed && rows === null && !err && <Loading />}
      {authed && rows !== null && !filtered.length && !err && <CenterNote>{q || hFilter !== '전체' ? '해당 원자 없음' : '원자 없음'}</CenterNote>}

      {rows !== null && filtered.length > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexDirection: mobile ? 'column' : 'row' }}>
          {/* ── 목록 = 공통(정체·제원) 뼈대 + 변동(상태·주행) + 건강 ── */}
          <div style={{ flex: mobile ? undefined : '1.7 1 0', width: mobile ? '100%' : undefined, minWidth: 0, overflowX: 'auto', border: `1px solid ${C.line}`, borderRadius: R }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: FS.sub, whiteSpace: 'nowrap' }}>
              <thead>
                <tr style={{ background: C.head, color: C.mute, fontSize: FS.cap, fontWeight: FW.label, textAlign: 'left' }}>
                  {['건강', '차번', '차명(제조사·모델·세부모델·트림)', '색', '제원', '상태', '주행', '대여료', '공급사', '원천', '갱신', '원문'].map((h) => (
                    <th key={h} style={{ padding: '7px 9px', borderBottom: `1px solid ${C.line}`, position: 'sticky', top: 0, background: C.head }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, CAP).map((e) => {
                  const r = e.r; const low = lowestRent(r.price); const nc = nonCommonKeys(r); const unk = unknownKeys(r);
                  return (
                    <tr
                      key={e.car}
                      onClick={() => setSelCar(e.car)}
                      style={{ borderBottom: `1px solid ${C.line}`, cursor: 'pointer', background: selCar === e.car ? C.selected : undefined }}
                    >
                      <td style={{ padding: '5px 9px' }}><Badge tone={HEALTH_TONE[e.health]}>{e.health}</Badge></td>
                      <td style={{ padding: '5px 9px', fontFamily: NUM, fontWeight: FW.strong, color: C.ink }}>{e.car}</td>
                      <td style={{ padding: '5px 9px', color: C.ink }}>{[S(r.maker), S(r.model), S(r.sub_model), S(r.trim_name)].filter(Boolean).join(' · ') || <span style={{ color: C.faint }}>—</span>}</td>
                      <td style={{ padding: '5px 9px', color: C.mute }}>{[S(r.ext_color), S(r.int_color)].filter(Boolean).join('/') || '—'}</td>
                      <td style={{ padding: '5px 9px', color: C.mute, fontSize: FS.cap }}>{[S(r.year), S(r.fuel_type), S(r.engine_cc) && `${S(r.engine_cc)}cc`, S(r.drive_type), S(r.seats) && `${S(r.seats)}인`].filter(Boolean).join(' · ') || '—'}</td>
                      <td style={{ padding: '5px 9px' }}><span style={{ color: C[statusTone(S(r.status) || S(r.status_kind)) === 'gray' ? 'mute' : statusTone(S(r.status) || S(r.status_kind)) === 'green' ? 'ok' : statusTone(S(r.status) || S(r.status_kind)) === 'red' ? 'danger' : 'warn'], fontWeight: FW.strong }}>{S(r.status) || S(r.status_kind) || '—'}</span></td>
                      <td style={{ padding: '5px 9px', fontFamily: NUM, color: C.mute }}>{S(r.mileage) ? `${Number(r.mileage).toLocaleString()}km` : '—'}</td>
                      <td style={{ padding: '5px 9px', fontFamily: NUM, color: C.ink }}>{low ? `${wonMan(low)}~` : <span style={{ color: C.faint }}>—</span>}</td>
                      <td style={{ padding: '5px 9px', color: C.mute }}>{S(r.provider_company_code) || S(r.partner_code) || '—'}</td>
                      <td style={{ padding: '5px 9px', color: C.mute, fontSize: FS.cap }}>{SRC_LABEL[S(r.source)] || S(r.source) || '—'}</td>
                      <td style={{ padding: '5px 9px', fontFamily: NUM, color: e.upd && now - e.upd < 3600_000 ? C.ok : C.mute, fontSize: FS.cap }}>{ago(e.upd, now)} 전</td>
                      <td style={{ padding: '5px 9px', fontSize: FS.cap, color: unk.length ? C.warn : C.faint }}>{unk.length ? `새칸 ${unk.length}` : nc.length ? '원문✓' : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > CAP && <div style={{ padding: 8, fontSize: FS.cap, color: C.mute, textAlign: 'center' }}>상위 {CAP}줄 표시 · 검색/필터로 좁히세요 (해당 {filtered.length})</div>}
          </div>

          {/* ── 상세 = 변동·무결성·정책·요금·원문(비공통) ── */}
          <div style={{ flex: mobile ? undefined : '1 1 0', width: mobile ? '100%' : undefined, minWidth: 0, position: mobile ? undefined : 'sticky', top: 8 }}>
            {sel ? <AtomDetail e={sel} polByKey={polByKey} now={now} /> : <CenterNote>줄을 고르면 그 원자의 변동·정책·요금·원문이 여기에</CenterNote>}
          </div>
        </div>
      )}
    </Page>
  );
}

function AtomDetail({ e, polByKey, now }: { e: Enriched; polByKey: Map<string, Record<string, unknown>>; now: number }) {
  const r = e.r;
  const pol = joinPolicy(polByKey, S(r.policy_code));
  const pv = (k: string) => S(pol?.[k]);
  const combo = (a: string, b: string) => { const A = pv(a), B = pv(b); return A ? (B && B !== A ? `${A} (${B})` : A) : ''; };
  const ft = fareTable(r.price);
  const 원문 = r.원문 as Record<string, unknown> | undefined;
  const unk = unknownKeys(r);

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone={HEALTH_TONE[e.health]}>{e.health}</Badge>
        <b style={{ fontFamily: NUM, fontSize: FS.body, color: C.ink }}>{e.car}</b>
        <span style={{ color: C.mute, fontSize: FS.sub }}>{[S(r.maker), S(r.model), S(r.sub_model), S(r.trim_name)].filter(Boolean).join(' · ')}</span>
      </div>

      {/* 변동 (매시간) */}
      <Section title="현재 상태 · 변동 (매시간 연동)">
        <DetailGrid rows={[
          ['출고상태', <span key="st" style={{ color: statusColor(S(r.status) || S(r.status_kind)), fontWeight: FW.strong }}>{S(r.status) || S(r.status_kind) || '—'}</span>],
          ['주행거리', S(r.mileage) ? `${Number(r.mileage).toLocaleString()} km` : ''],
          ['원천', SRC_LABEL[S(r.source)] || S(r.source)],
          ['갱신', `${ago(e.upd, now)} 전`],
        ]} />
      </Section>

      {/* 무결성 점검 */}
      <Section title={`무결성 점검 — ${e.health}`}>
        <DetailGrid rows={
          e.vio.length
            ? e.vio.map((v) => [`${v.severity === 'block' ? '문제' : '주의'} · ${v.code}`, v.msg] as [string, unknown])
            : [['정상', '불변식 위반 없음 · 확정 · 최신'] as [string, unknown]]
        } />
      </Section>

      {/* 주요 정책 (직원 안내) */}
      {pol ? (
        <>
          <Section title={`주요 정책 · 자격·연령 ${pv('policy_name') ? `— ${pv('policy_name')}` : ''}`}>
            <DetailGrid rows={[
              ['심사조건', pv('screening_criteria')], ['기본연령', pv('basic_driver_age')],
              ['연령인하', combo('driver_age_lowering', 'age_lowering_cost')], ['연령상한', pv('driver_age_upper_limit')],
              ['면허기간', pv('license_period')], ['추가운전자', combo('additional_driver_allowance_count', 'additional_driver_cost')],
            ]} />
          </Section>
          <Section title="주요 정책 · 주행·보험">
            <DetailGrid rows={[
              ['기본주행', pv('annual_mileage')], ['초과주행', pv('mileage_upcharge_per_10000km')],
              ['대인한도', pv('injury_compensation_limit')], ['대물한도', pv('property_compensation_limit')],
              ['자차면책', pv('own_damage_min_deductible') || pv('own_damage_max_deductible') ? `${pv('own_damage_min_deductible') || '—'}~${pv('own_damage_max_deductible') || '—'}` : ''],
              ['긴급출동', pv('annual_roadside_assistance')],
            ]} />
          </Section>
          <Section title="주요 정책 · 비용·결제">
            <DetailGrid rows={[
              ['보증금분납', pv('deposit_installment')], ['보증금카드', pv('deposit_card_payment')],
              ['결제방식', pv('payment_method')], ['탁송료', pv('delivery_fee')], ['대여지역', pv('rental_region')],
            ]} />
          </Section>
        </>
      ) : (
        <Section title="주요 정책">
          <div style={{ padding: '8px 12px', fontSize: FS.sub, color: C.warn }}>정책코드 «{S(r.policy_code) || '—'}» 미조인 — 프리패스 표준정책 자동적용 또는 미배정(검수 대상).</div>
        </Section>
      )}

      {/* 기간별 대여료 */}
      <Section title={`기간별 대여료 — ${ft.count}개 기간`}>
        {ft.count ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: FS.sub, whiteSpace: 'nowrap', width: '100%' }}>
              <thead>
                <tr style={{ color: C.mute, fontSize: FS.cap }}>
                  <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: `1px solid ${C.line2}` }}>구분</th>
                  {ft.periods.map((p) => <th key={p} style={{ padding: '4px 8px', textAlign: 'right', borderBottom: `1px solid ${C.line2}` }}>{p}개월</th>)}
                </tr>
              </thead>
              <tbody>
                {ft.rows.map((row) => (
                  <tr key={row.label}>
                    <td style={{ padding: '4px 8px', color: C.mute, borderBottom: `1px solid ${C.line2}` }}>{row.label}</td>
                    {row.values.map((v, i) => <td key={i} style={{ padding: '4px 8px', textAlign: 'right', fontFamily: NUM, color: v ? C.ink : C.faint, borderBottom: `1px solid ${C.line2}` }}>{v ? v.toLocaleString() : '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div style={{ padding: '8px 12px', fontSize: FS.sub, color: C.faint }}>요금 미수집</div>}
      </Section>

      {/* 공급사 원문 (비공통) */}
      <Section title={`공급사 원문 (비공통)${unk.length ? ` · 새 칸 ${unk.length}` : ''}`}>
        {원문 && typeof 원문 === 'object' ? (
          <DetailGrid rows={Object.entries(원문).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')] as [string, unknown])} />
        ) : <div style={{ padding: '8px 12px', fontSize: FS.sub, color: C.faint }}>원문 없음</div>}
        {unk.length > 0 && <div style={{ padding: '8px 12px', fontSize: FS.cap, color: C.warn }}>미등재 새 칸: {unk.join(', ')} — 검수 대상</div>}
      </Section>
    </div>
  );
}

function statusColor(status: string): string {
  const t = statusTone(status);
  return t === 'green' ? C.ok : t === 'red' ? C.danger : t === 'orange' ? C.warn : C.mute;
}
