'use client';
import { useCallback, useEffect, useState } from 'react';
import { Page } from '@/components/Page';
import { Btn, C, CenterNote, FS, FW, Loading, NUM, R_CARD, SearchInput } from '@/components/ui';
import { getAuthClient } from '@/lib/firebase/client';
import {
  OPS_HEALTH_LABEL, OPS_STALE_MS, opsHealth,
  type OpsHealth, type OpsPipelineStatus,
} from '@/lib/ops-status';

/**
 * 원자관리 관제탑 — **매물 원자가 어디서 어떻게 들어왔나**를 실시간으로 보여 주는 한 장.
 *
 * 이름 그대로다(사장님 2026-09-04 「원자관리 관제탑이지」). 공급사 시트에서 원자(제원·대여료·
 * 정책·상태)를 긁어 정제하고 판매시트로 발행해 ERP 에 얹는 그 전 구간이 «지금» 어디까지 왔나를 본다.
 *
 * ★기능을 넣지 않는다(사장님 2026-09-04 「기능 없이 아주 심플하게, 필터 이런 거 없이
 *   실시간 모니터링에 집중한」). 검색도 필터도 정렬도 없다. **답만 있다** —
 *   지금 도는가 · 어디까지 왔나 · 무엇이 실패했나 · 언제 들어왔나.
 *
 * ★투박하게. 등폭 숫자와 선, 색은 초록·빨강·회색뿐이다. 예쁘게 만들 이유가 없다 —
 *   「데이터는 여기 확실히 있다」만 보이면 된다.
 *
 * ★읽는 것은 **문서 하나**다(`/api/ops/pipeline`). 매물 전량을 폴링하면 열 명이 10분마다
 *   봐도 월 50달러쯤 나가지만, 이 2KB 한 줄은 30초마다 봐도 월 몇 천 원이다.
 */

/**
 * 정밀타격 결과 — 차 한 대가 «어디서 왔나」와 «그 줄로 가는 주소».
 * 「⑥ 실패」만 보여 주면 아무도 못 고친다. 고칠 자리까지 찍어 줘야 관제탑이다.
 */
type Trace = {
  found: boolean;
  candidates?: string[];
  plate?: string;
  productCode?: string;
  supplier?: { code: string; name: string };
  origin?: { source: string; tab: string; gid: string; row: string; url: string };
  cellLink?: string;
  lastSync?: { runId: string; updatedAt: number | null; updatedBy: string };
  block?: { reason: string; at: string; statusOwner: string };
  status?: string;
};

/** 30초. 요약 한 줄이라 이 주기로 돌아도 비용이 거의 안 붙는다. */
const POLL_MS = 30_000;

const TONE: Record<OpsHealth, string> = {
  running: C.accent,
  stalled: C.danger,
  ok: C.ok,
  failed: C.danger,
  none: C.faint,
};

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분 전`;
}

export default function HubPage() {
  const [status, setStatus] = useState<OpsPipelineStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [plate, setPlate] = useState('');
  const [trace, setTrace] = useState<Trace | null>(null);
  const [tracing, setTracing] = useState(false);

  /** 차번 하나를 짚는다 — 폴링과 별개로, 누를 때만 부른다(전량 조회라 비싸다). */
  const runTrace = useCallback(async (q: string) => {
    const v = q.trim();
    if (!v) { setTrace(null); return; }
    setTracing(true);
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) return;
      const res = await fetch(`/api/ops/trace?q=${encodeURIComponent(v)}`, {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        cache: 'no-store',
      });
      setTrace(res.ok ? (await res.json() as Trace) : { found: false });
    } catch {
      setTrace({ found: false });
    } finally {
      setTracing(false);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) return;
      const res = await fetch('/api/ops/pipeline', {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        cache: 'no-store',
      });
      if (!res.ok) { setError(res.status === 403 ? '관리자만 볼 수 있습니다.' : '상태를 불러오지 못했습니다.'); setLoaded(true); return; }
      const body = await res.json() as { status: OpsPipelineStatus | null };
      setStatus(body.status);
      setError('');
      setLoaded(true);
    } catch {
      setError('상태를 불러오지 못했습니다.');
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { setNow(Date.now()); void load(); }, POLL_MS);
    // 초 단위 「몇 분 전」이 굳지 않게 시계만 따로 돌린다(네트워크는 안 탄다).
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(clock); };
  }, [load]);

  const health = opsHealth(status, now);
  const quiet = status ? now - (Number(status.updatedMs) || 0) : 0;

  return (
    <Page title="원자관리 관제탑" meta="매물 원자가 어디서 어떻게 들어왔나">
      {!loaded ? <Loading /> : error ? <CenterNote>{error}</CenterNote> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0 24px' }}>

          {/* ── 지금 상태 한 줄 — 이 화면의 전부다 ── */}
          <div style={{
            border: `1px solid ${C.line}`, borderRadius: R_CARD, padding: '18px 20px',
            display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          }}>
            <span style={{
              width: 12, aspectRatio: '1 / 1', borderRadius: 999, background: TONE[health], flex: '0 0 auto',
              boxShadow: health === 'running' ? `0 0 0 4px ${C.selected}` : undefined,
            }} />
            <span style={{ fontSize: 20, fontWeight: FW.head, color: C.ink, letterSpacing: '-0.02em' }}>
              {OPS_HEALTH_LABEL[health]}
            </span>
            {status ? (
              <>
                <span style={{ fontSize: FS.sub, color: C.mute, fontFamily: NUM }}>
                  {status.running ? `${status.currentStep || '진행 중'} · ${status.elapsedSec}초째` : `${status.elapsedSec}초 걸림`}
                </span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: FS.sub, color: C.faint, fontFamily: NUM }}>
                  {status.startedAt} 시작 · 갱신 {ago(status.updatedMs, now)}
                  {status.apply ? '' : ' · 미리보기'}
                  {status.host ? ` · ${status.host}` : ''}
                </span>
              </>
            ) : null}
          </div>

          {/* 멈춤은 조용히 넘기지 않는다 — 「돈다」고 적힌 채 죽어 있는 게 제일 위험하다. */}
          {health === 'stalled' ? (
            <div style={{ border: `1px solid ${C.danger}`, borderRadius: R_CARD, padding: '14px 18px', background: C.dangerBg }}>
              <div style={{ fontSize: FS.title, fontWeight: FW.title, color: C.danger }}>
                {Math.round(quiet / 60000)}분째 아무 소식이 없습니다
              </div>
              <div style={{ fontSize: FS.sub, color: C.sub, marginTop: 6, lineHeight: 1.7 }}>
                「돌고 있음」으로 남았지만 심장박동이 {Math.round(OPS_STALE_MS / 60000)}분 넘게 멈췄습니다.
                프로세스가 죽으면 상태를 닫아 줄 놈이 없어 이렇게 남습니다 — 그 기계에서
                <code style={{ fontFamily: NUM, margin: '0 4px' }}>tmp/hourly-sync.lock/</code>을 확인해 주세요.
              </div>
            </div>
          ) : null}

          {status?.stoppedBy ? (
            <div style={{ border: `1px solid ${C.danger}`, borderRadius: R_CARD, padding: '14px 18px', background: C.dangerBg }}>
              <div style={{ fontSize: FS.title, fontWeight: FW.title, color: C.danger }}>중단 — {status.stoppedBy}</div>
            </div>
          ) : null}

          {/* ── 단계 — 어디까지 왔나 ── */}
          {status?.steps?.length ? (
            <div style={{ border: `1px solid ${C.line}`, borderRadius: R_CARD, overflow: 'hidden' }}>
              {status.steps.map((s, i) => (
                <div key={`${s.단계}-${i}`} style={{
                  display: 'flex', alignItems: 'baseline', gap: 12, padding: '11px 18px',
                  borderTop: i ? `1px solid ${C.line2}` : 'none',
                  background: s.ok ? 'transparent' : C.dangerBg,
                }}>
                  <span style={{ width: 10, flex: '0 0 auto', color: s.ok ? C.ok : C.danger, fontWeight: FW.head }}>
                    {s.ok ? '✓' : '✗'}
                  </span>
                  <span style={{ fontSize: FS.body, fontWeight: FW.meta, color: C.ink, minWidth: 190 }}>{s.단계}</span>
                  <span style={{ fontSize: FS.sub, color: C.faint, fontFamily: NUM, minWidth: 56, textAlign: 'right' }}>
                    {s.초 != null ? `${s.초}초` : ''}
                  </span>
                  {s.신호 ? <span style={{ fontSize: FS.cap, fontWeight: FW.strong, color: C.warn }}>{s.신호}</span> : null}
                  <span style={{ fontSize: FS.sub, color: C.mute, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.요약 || ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {/* ── 차종마스터 매칭 — 「이름을 못 붙인 차」가 여기서 보인다 ── */}
          {status?.coverage ? (
            <div style={{ border: `1px solid ${C.line}`, borderRadius: R_CARD, padding: '16px 20px', display: 'flex', gap: 34, flexWrap: 'wrap' }}>
              {([
                ['매칭율', `${status.coverage.매칭율}%`],
                ['총', status.coverage.총],
                ['매칭', status.coverage.매칭],
                ['모델없음', status.coverage.모델없음],
                ['트림실패', status.coverage.트림실패],
              ] as const).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: FS.cap, color: C.faint }}>{k}</span>
                  <span style={{ fontSize: 20, fontWeight: FW.head, color: C.ink, fontFamily: NUM }}>{v}</span>
                </div>
              ))}
            </div>
          ) : null}

          {status?.warnings?.length ? (
            <div style={{ border: `1px solid ${C.warnLine}`, background: C.warnBg, borderRadius: R_CARD, padding: '14px 18px' }}>
              <div style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.warn, marginBottom: 6 }}>눈여겨볼 것</div>
              {status.warnings.map((w) => (
                <div key={w} style={{ fontSize: FS.sub, color: C.sub, lineHeight: 1.8 }}>· {w}</div>
              ))}
            </div>
          ) : null}

          {!status ? (
            <CenterNote>
              아직 한 번도 올라오지 않았습니다. 자동동기가 다음 회차를 돌면 여기에 나타납니다.
            </CenterNote>
          ) : null}

          {/* ── 정밀타격 — 차 한 대가 어디서 왔나. 누르면 그 시트 그 줄로 바로 간다 ── */}
          <div style={{ border: `1px solid ${C.line}`, borderRadius: R_CARD, padding: '16px 20px' }}>
            <div style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink, marginBottom: 4 }}>이 차 어디서 왔나</div>
            <div style={{ fontSize: FS.sub, color: C.mute, marginBottom: 12 }}>
              차량번호를 넣으면 원본 시트·탭·행과 마지막으로 닿은 회차를 짚어 줍니다.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <SearchInput value={plate} onChange={setPlate} placeholder="135허5711" style={{ flex: '1 1 220px', minWidth: 180 }} />
              <Btn size="sm" onClick={() => void runTrace(plate)}>추적</Btn>
            </div>

            {tracing ? <div style={{ marginTop: 12 }}><Loading /></div> : null}

            {!tracing && trace && !trace.found ? (
              <div style={{ marginTop: 12, fontSize: FS.sub, color: C.mute }}>
                {trace.candidates?.length
                  ? `여럿입니다 — ${trace.candidates.join(' · ')}`
                  : '그 차번을 못 찾았습니다.'}
              </div>
            ) : null}

            {!tracing && trace?.found ? (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([
                  ['차량', `${trace.plate} · ${trace.status || '상태없음'}`],
                  ['공급사', `${trace.supplier?.name || '-'}${trace.supplier?.code ? ` (${trace.supplier.code})` : ''}`],
                  ['원본', trace.origin?.tab
                    ? `${trace.origin.tab}${trace.origin.row ? ` · ${trace.origin.row}행` : ''}${trace.origin.gid ? ` · gid ${trace.origin.gid}` : ''}`
                    : (trace.origin?.source || '출처 기록 없음')],
                  ['마지막 동기', trace.lastSync?.updatedAt
                    ? `${ago(trace.lastSync.updatedAt, now)}${trace.lastSync.updatedBy ? ` · ${trace.lastSync.updatedBy}` : ''}`
                    : '기록 없음'],
                  ...(trace.block?.reason ? [['시트가 막음', `${trace.block.reason}${trace.block.at ? ` · ${trace.block.at}` : ''}`] as const] : []),
                ] as const).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                    <span style={{ fontSize: FS.sub, color: C.faint, minWidth: 88 }}>{k}</span>
                    <span style={{ fontSize: FS.body, color: C.ink, fontFamily: NUM }}>{v}</span>
                  </div>
                ))}
                {trace.cellLink ? (
                  <div style={{ marginTop: 6 }}>
                    <Btn size="sm" href={trace.cellLink} title="원본 시트의 그 줄로 바로 갑니다">원본 시트 그 줄로 가기</Btn>
                  </div>
                ) : (
                  <div style={{ marginTop: 6, fontSize: FS.cap, color: C.faint }}>
                    공급사 시트 주소가 없어 링크를 못 만듭니다 — 파트너사 관리에서 「구글시트 URL」을 채우면 됩니다.
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Btn variant="ghost" size="sm" onClick={() => { setNow(Date.now()); void load(); }}>새로고침</Btn>
            <span style={{ fontSize: FS.cap, color: C.faint }}>{POLL_MS / 1000}초마다 자동 갱신</span>
          </div>
        </div>
      )}
    </Page>
  );
}
