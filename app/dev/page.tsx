'use client';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getStore, clearStoreCache, peekList } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, setRole, ROLE_LABEL, type Role } from '@/lib/domain/deal';
import { getSession } from '@/lib/auth-session';
import { auditMasterFit, reconcileToMaster, type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { loadVehicleMaster } from '@/lib/domain/vehicle-master-load';
import { checkInventory } from '@/lib/domain/data-check';
import { toast } from '@/components/Toaster';
import { Page, Btn, C, R, Loading, CenterNote, SectionLabel, Badge } from '@/components/ui';
import { MasterFitSummary } from '@/components/MasterFitSummary';
import { NAV_LABEL } from '@/lib/tabbar';
import Link from 'next/link';

export default function DevTools() {
  const co = getCompanyId();
  const [ok, setOk] = useState<boolean | null>(null);
  const [rows, setRows] = useState<EntityRecord[] | null>(() => peekList('product', co));
  const [master, setMaster] = useState<MasterEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');
  const [role, setRoleLocal] = useState<Role>(() => (typeof window !== 'undefined' ? getRole() : 'agent'));

  const reload = useCallback(async () => {
    // product만 다시 — 전역 clearStoreCache는 다른 페이지 캐시까지 날려 전환 체감↓
    const list = await getStore().list('product', co);
    setRows(list);
    return list;
  }, [co]);

  useEffect(() => {
    (async () => {
      await seedIfEmpty(co);
      const r = getRole();
      setRoleLocal(r);
      if (r !== 'admin') { setOk(false); return; }
      await reload();
      setOk(true);
    })();
    loadVehicleMaster()
      .then((entries) => setMaster(entries))
      .catch(() => { setMaster([]); toast('차종마스터 로드 실패', 'error'); });
    /* eslint-disable-next-line */
  }, []);

  const enterAsAdmin = () => {
    if (getSession()) {
      toast('로그인 계정 역할은 바꿀 수 없습니다. 관리자 계정으로 로그인하세요.', 'info');
      return;
    }
    setRole('admin');
    setRoleLocal('admin');
    setOk(null);
    void (async () => {
      await reload();
      setOk(true);
    })();
  };

  const fit = useMemo(() => (rows && master && master.length ? auditMasterFit(rows, master) : null), [rows, master]);
  const issues = useMemo(() => (rows ? checkInventory(rows) : []), [rows]);
  const issueHits = issues.reduce((a, g) => a + g.hits.length, 0);

  const convertAll = async () => {
    if (busy || !master?.length || !rows) return;
    setBusy(true);
    setLog('');
    try {
      const { patches, high, medium, low, unmatched } = reconcileToMaster(rows, master, { mode: 'auto' });
      if (!patches.length) {
        const msg = `변환 0건 / 대상 ${rows.length} · 검토 ${low}·미매칭 ${unmatched}`;
        setLog(msg);
        toast(msg, 'info');
        return;
      }
      const n = await getStore().bulkPatch('product', co, patches.map(({ key, patch }) => ({ key, patch })));
      await reload();
      const msg = `변환 ${n}건 (high ${high}·중 ${medium}) · 검수 검토 ${low}·미매칭 ${unmatched}`;
      setLog(msg);
      toast(msg, low || unmatched ? 'info' : 'ok');
    } catch (e) {
      const msg = '변환 오류: ' + String((e as Error).message || e);
      setLog(msg);
      toast(msg, 'error');
    } finally { setBusy(false); }
  };

  if (ok === null) return <Loading />;
  if (!ok) {
    const canDemoSwitch = !getSession();
    return (
      <Page title="개발도구">
        <CenterNote>
          관리자만 사용할 수 있습니다. 지금 역할: {ROLE_LABEL[role] || role}
        </CenterNote>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          {canDemoSwitch ? (
            <Btn size="sm" onClick={enterAsAdmin}>관리자로 열고 들어가기</Btn>
          ) : null}
          <Btn href="/settings" size="sm" variant="ghost">설정</Btn>
        </div>
      </Page>
    );
  }

  const masterReady = !!(master && master.length);
  const card: CSSProperties = { border: `1px solid ${C.line}`, borderRadius: R, background: '#fff', padding: 14 };

  return (
    <Page title="개발도구">
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '12px 0 40px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12.5, color: C.mute, lineHeight: 1.5 }}>
          수집된 차량 원자(시트·OCR·등록증·옵션·메모)를 전부 신호로 써서 차종마스터 규격에 맞춥니다.
          손님·영업에 보이는 차종은 마스터 표준. 원본은 보존.
        </div>

        <div style={{ ...card, background: C.selected }}>
          <SectionLabel mt={0}>지금 있는 매물 → 차종마스터</SectionLabel>
          <div style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.5, marginBottom: 10 }}>
            거친 표기·흩어진 칸을 모아 마스터 트리(제조사→모델→세대→파워→트림)에 스냅.
            high·중만 저장, 애매하면 미선택·검수. 임의 재조합 금지.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Btn onClick={convertAll} disabled={busy || !masterReady || !rows?.length}>
              {busy ? '변환 중…' : `지금 매물 변환하기${rows ? ` (${rows.length})` : ''}`}
            </Btn>
            <Badge tone={masterReady ? 'green' : 'red'} variant="solid">
              {master === null ? '마스터 로딩' : masterReady ? `마스터 ${master!.length.toLocaleString()}세대` : '마스터 실패'}
            </Badge>
          </div>
          {log && <pre style={{ margin: '10px 0 0', fontSize: 11.5, color: C.mute, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)' }}>{log}</pre>}
        </div>

        <div style={card}>
          <SectionLabel mt={0}>마스터 정합 현황</SectionLabel>
          {!fit ? (
            <div style={{ fontSize: 12.5, color: C.faint }}>{rows === null ? '매물 로딩…' : '집계 중…'}</div>
          ) : (
            <MasterFitSummary fit={fit} />
          )}
        </div>

        <div style={card}>
          <SectionLabel mt={0}>데이터 이상</SectionLabel>
          <div style={{ fontSize: 12.5, color: C.mute, marginBottom: 8 }}>
            자동감지 {issues.length}종 · 표시 {issueHits}건
          </div>
          <Btn href="/data-check" size="sm" variant="ghost">데이터 점검 상세</Btn>
        </div>

        <div style={card}>
          <SectionLabel mt={0}>바로가기</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Btn href="/inventory" size="sm" variant="ghost">{NAV_LABEL.inventory}</Btn>
            <Btn href="/audit" size="sm" variant="ghost">감사로그</Btn>
            <Btn href="/data-check" size="sm" variant="ghost">데이터점검</Btn>
            <Btn href="/members" size="sm" variant="ghost">회원·파트너</Btn>
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => { clearStoreCache(); toast('목록 캐시 비움 — 다시 불러오세요', 'ok'); reload(); }}
            >
              스토어 캐시 비우기
            </Btn>
          </div>
        </div>

        <div style={{ fontSize: 11, color: C.faint }}>
          팁: 역할이 영업자면 재고·개발도구가 막힙니다. <Link href="/settings" style={{ color: C.accent }}>설정</Link>에서 관리자로 전환.
        </div>
      </div>
    </Page>
  );
}
