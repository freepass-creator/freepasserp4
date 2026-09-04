'use client';
import { useEffect, useMemo, useState } from 'react';
import { Page } from '@/components/Page';
import { C, FS, FW, NUM, R, SearchInput, Loading, CenterNote, VEHICLE_STATUS_TONE } from '@/components/ui';
import { subscribeFirestoreProducts } from '@/lib/firebase/firestore-products-client';
import type { EntityRecord } from '@/lib/intake/entities';

/**
 * 샘 — **오염 안 된 원자 데이터베이스(Firestore products) 그 자체**를 관리자가 보는 한 장.
 *
 * 사장님 2026-09-05 「제일 앞단의 데이터 저장. 물이 나오는 «샘»을 관리하는 거지. 오염되지 않은 딱
 *   데이터베이스 모아놓은. 이 페이지에서 구글시트도·ERP도·손님페이지도 만드는, 그 원천적인 샘.」
 *
 * ★관제탑(/hub)과 다르다 — 관제탑은 «파이프라인이 도는가」(요약 한 줄)를 보고, 여기는 «데이터 자체」
 *   (차 한 대 = 한 줄)를 본다. 여기서 흘러나간 것이 시트·ERP·손님화면이다. 그래서 «가공 전 원자» 그대로.
 * ★실시간 — Firestore onSnapshot(바뀐 문서만 과금). 한 줄이 지금 어떤 상태이고 언제 갱신됐는지 산다.
 * ★읽기만 — 샘은 «보고 지키는」 곳이지 여기서 값을 손으로 고치지 않는다(원천이 정본).
 */
const S = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function ago(ms: unknown, now: number): string {
  const t = num(ms); if (!t) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.round(s / 60)}분`;
  if (s < 86400) return `${Math.round(s / 3600)}시간`;
  return `${Math.round(s / 86400)}일`;
}
const wonMan = (n: number) => (n >= 10000 ? `${Math.round(n / 10000)}만` : n ? String(n) : '');
function priceLow(price: unknown): string {
  if (!price || typeof price !== 'object') return '';
  const rents = Object.values(price as Record<string, { rent?: number }>).map((p) => num(p?.rent)).filter((x) => x > 0);
  if (!rents.length) return '';
  return `${wonMan(Math.min(...rents))}~ (${Object.keys(price as object).length}종)`;
}
const SRC_LABEL: Record<string, string> = { sheet: '시트', iron: '홈피', sonokong: '손오공' };
const TONE_COLOR: Record<string, string> = { green: C.ok, red: C.danger, orange: C.warn, amber: C.warn, blue: C.accent, gray: C.mute };

export default function SpringPage() {
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const unsub = subscribeFirestoreProducts(
      (r) => { setRows(r); setErr(''); },
      (e) => setErr(e instanceof Error ? e.message : '구독 실패 — 로그인/권한 확인'),
    );
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => { unsub(); clearInterval(t); };
  }, []);

  const filtered = useMemo(() => {
    const all = rows || [];
    const needle = S(q).toLowerCase();
    const list = !needle ? all : all.filter((r) => {
      const hay = `${S(r.car_number)} ${S(r.maker)} ${S(r.model)} ${S(r.sub_model)} ${S(r.trim_name)} ${S(r.provider_company_code)} ${S(r.source_schema)}`.toLowerCase();
      return hay.includes(needle);
    });
    return [...list].sort((a, b) => num(b._var_polled_at || b._direct_ingest_at || b._mirror_at) - num(a._var_polled_at || a._direct_ingest_at || a._mirror_at));
  }, [rows, q]);

  const total = rows?.length || 0;
  const listable = (rows || []).filter((r) => r.listable !== false).length;
  const confirmed = (rows || []).filter((r) => r.확정 === true).length;

  return (
    <Page title="샘 — 원자 데이터베이스" meta={total}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', flexWrap: 'wrap' }}>
        <SearchInput value={q} onChange={setQ} placeholder="차번·제조사·모델·공급사" />
        <span style={{ fontSize: FS.cap, color: C.mute }}>
          전체 <b style={{ fontFamily: NUM, color: C.ink }}>{total}</b> · 노출 <b style={{ fontFamily: NUM, color: C.ok }}>{listable}</b> · 확정 <b style={{ fontFamily: NUM }}>{confirmed}</b> · <span style={{ color: C.accent }}>● 실시간</span>
        </span>
      </div>

      {err && <CenterNote>{err}</CenterNote>}
      {rows === null && !err && <Loading />}
      {rows !== null && !filtered.length && !err && <CenterNote>{q ? '검색 결과 없음' : '원자 없음'}</CenterNote>}

      {rows !== null && filtered.length > 0 && (
        <div style={{ overflowX: 'auto', border: `1px solid ${C.line}`, borderRadius: R }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: FS.sub, whiteSpace: 'nowrap' }}>
            <thead>
              <tr style={{ background: C.head, color: C.mute, fontSize: FS.cap, fontWeight: FW.label, textAlign: 'left' }}>
                {['차번', '차명(제조사·모델·세부모델·트림)', '색', '연식·연료', '상태', '대여료', '공급사', '원천', '갱신', '확정'].map((h) => (
                  <th key={h} style={{ padding: '7px 9px', borderBottom: `1px solid ${C.line}`, position: 'sticky', top: 0, background: C.head }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 600).map((r) => {
                const toneName = VEHICLE_STATUS_TONE[S(r.status).replace(/\s+/g, '') as keyof typeof VEHICLE_STATUS_TONE] || 'gray';
                const upd = num(r._var_polled_at || r._direct_ingest_at || r._mirror_at);
                return (
                  <tr key={S(r.car_number) || S(r._key)} style={{ borderBottom: `1px solid ${C.line}` }}>
                    <td style={{ padding: '6px 9px', fontFamily: NUM, fontWeight: FW.strong, color: C.ink }}>{S(r.car_number)}</td>
                    <td style={{ padding: '6px 9px', color: C.ink }}>
                      {[S(r.maker), S(r.model), S(r.sub_model), S(r.trim_name)].filter(Boolean).join(' · ') || <span style={{ color: C.faint }}>—</span>}
                    </td>
                    <td style={{ padding: '6px 9px', color: C.mute }}>{[S(r.ext_color), S(r.int_color)].filter(Boolean).join('/') || '—'}</td>
                    <td style={{ padding: '6px 9px', color: C.mute, fontFamily: NUM }}>{[S(r.year), S(r.fuel_type)].filter(Boolean).join(' ') || '—'}</td>
                    <td style={{ padding: '6px 9px' }}>
                      <span style={{ color: TONE_COLOR[toneName] || C.mute, fontWeight: FW.strong }}>{S(r.status) || S(r.status_kind) || '—'}</span>
                    </td>
                    <td style={{ padding: '6px 9px', fontFamily: NUM, color: C.ink }}>{priceLow(r.price) || <span style={{ color: C.faint }}>—</span>}</td>
                    <td style={{ padding: '6px 9px', color: C.mute }}>{S(r.provider_company_code) || S(r.partner_code) || '—'}</td>
                    <td style={{ padding: '6px 9px', color: C.mute, fontSize: FS.cap }}>{SRC_LABEL[S(r.source)] || S(r.source) || '—'}{S(r.sheet_source_tab) ? ` · ${S(r.sheet_source_tab)}` : ''}</td>
                    <td style={{ padding: '6px 9px', fontFamily: NUM, color: upd && now - upd < 3600_000 ? C.ok : C.mute, fontSize: FS.cap }}>{ago(upd, now)} 전</td>
                    <td style={{ padding: '6px 9px', fontSize: FS.cap, color: r.확정 === true ? C.ok : C.warn }}>{r.확정 === true ? '확정' : S(r.검수상태) || '검수'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > 600 && <div style={{ padding: 8, fontSize: FS.cap, color: C.mute, textAlign: 'center' }}>상위 600줄만 표시 · 검색으로 좁히세요 (전체 {filtered.length})</div>}
    </Page>
  );
}
