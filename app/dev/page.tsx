'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getStore, clearStoreCache, peekList } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, setRole, ROLE_LABEL, type Role } from '@/lib/domain/deal';
import { getSession } from '@/lib/auth-session';
import { isAdminUiAllowed } from '@/lib/auth-gate';
import { auditMasterFit, reconcileToMaster, type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { loadVehicleMaster } from '@/lib/domain/vehicle-master-load';
import { checkInventory } from '@/lib/domain/data-check';
import { confirmDialog, toast } from '@/components/Toaster';
import {
  Page, Btn, Loading, CenterNote, Badge, FormCard, CopyBlock, Message,
  PaneHead, PaneBody, FeedListRow, FeedThumbIcon, FeedTitle, FeedSub,
} from '@/components/ui';
import { MasterFitSummary } from '@/components/MasterFitSummary';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { RefreshCw, Car, Stethoscope, Link2, type LucideIcon } from 'lucide-react';
import type { BadgeTone } from '@/components/ui';
import { NAV_LABEL } from '@/lib/tabbar';
import dynamic from 'next/dynamic';

// 공급사 연동은 무겁다(시트 파서·차종마스터). 도구를 고를 때 불러온다.
const SheetSync = dynamic(() => import('@/components/SheetSync').then((m) => m.SheetSync), {
  ssr: false,
  loading: () => <Loading />,
});

/** 재고관리 등에서 `/dev?tool=` 로 바로 열 수 있는 도구 키. */
const DEV_TOOL_KEYS = new Set(['sync', 'master', 'check', 'links']);

export default function DevTools() {
  const co = getCompanyId();
  const [ok, setOk] = useState<boolean | null>(null);
  const [rows, setRows] = useState<EntityRecord[] | null>(() => peekList('product', co));
  const [master, setMaster] = useState<MasterEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');
  const [channelBackfillLog, setChannelBackfillLog] = useState('');
  // /dev?tool=sync 등 — 재고관리 진입 버튼이 바로 이 도구를 연다.
  const [sel, setSel] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const tool = new URLSearchParams(window.location.search).get('tool');
    return tool && DEV_TOOL_KEYS.has(tool) ? tool : null;
  });
  const [role, setRoleLocal] = useState<Role>(() => (typeof window !== 'undefined' ? getRole() : 'agent'));

  const reload = useCallback(async () => {
    // product만 다시 — 전역 clearStoreCache는 다른 페이지 캐시까지 날려 전환 체감↓
    const list = await getStore().list('product', co);
    setRows(list);
    return list;
  }, [co]);

  const openTool = useCallback((key: string | null) => {
    setSel(key);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (key) url.searchParams.set('tool', key);
    else url.searchParams.delete('tool');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    (async () => {
      const r = getRole();
      setRoleLocal(r);
      if (!isAdminUiAllowed()) { setOk(false); return; }
      await seedIfEmpty(co);
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
    setLog('');
    const plan = reconcileToMaster(rows, master, { mode: 'auto' });
    if (!plan.patches.length) {
      const msg = `변환 0건 / 대상 ${rows.length} · 검토 ${plan.low}·미매칭 ${plan.unmatched}`;
      setLog(msg);
      toast(msg, 'info');
      return;
    }
    if (!await confirmDialog({
      title: '차종마스터 일괄 변환',
      message: `${plan.patches.length}대의 차종 필드를 v4 오버레이에 일괄 저장합니다.\n자동확정 high ${plan.high}건 · 중 ${plan.medium}건입니다. 실행할까요?`,
      danger: true,
      okLabel: '일괄 변환 실행',
    })) return;
    setBusy(true);
    try {
      const n = await getStore().bulkPatch('product', co, plan.patches.map(({ key, patch }) => ({ key, patch })));
      await reload();
      const msg = `변환 ${n}건 (high ${plan.high}·중 ${plan.medium}) · 검수 검토 ${plan.low}·미매칭 ${plan.unmatched}`;
      setLog(msg);
      toast(msg, plan.low || plan.unmatched ? 'info' : 'ok');
    } catch (e) {
      const msg = '변환 오류: ' + String((e as Error).message || e);
      setLog(msg);
      toast(msg, 'error');
    } finally { setBusy(false); }
  };

  const runChannelBackfill = async (dryRun: boolean) => {
    if (busy) return;
    if (!dryRun && !await confirmDialog({
      title: '개인채널 백필',
      message: '대상 회원의 영업채널 값을 일괄 변경합니다. 먼저 미리보기 결과를 확인했나요?',
      danger: true,
      okLabel: '백필 실행',
    })) return;
    setBusy(true);
    setChannelBackfillLog('');
    try {
      const { backfillPersonalAgentChannels } = await import('@/lib/firebase/auth');
      const result = await backfillPersonalAgentChannels({ dryRun });
      const n = result.updated.length;
      const message = dryRun
        ? `미리보기: ${n}명 대상 (스캔 ${result.scanned} · 건너뜀 ${result.skipped})`
        : `채널 백필 ${n}명 완료 (스캔 ${result.scanned} · 건너뜀 ${result.skipped})`;
      setChannelBackfillLog(message);
      toast(message, n ? 'ok' : 'info');
    } catch (error) {
      const message = '개인채널 백필 오류: ' + String((error as Error).message || error);
      setChannelBackfillLog(message);
      toast(message, 'error');
    } finally {
      setBusy(false);
    }
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

  /**
   * 도구 목록 — 계약·문의·정책과 같은 [목록 | 패널] 규격(WorkPage).
   *
   * 예전엔 720px 한 장에 카드를 세로로 쌓았다. 도구가 늘면서 «어디에 뭐가 있는지»를 잃었고,
   * 공급사 연동처럼 표를 넓게 펼쳐야 하는 도구가 그 폭에서 못 살았다. 화면 규격을 따로 만들지 않고
   * 다른 업무 페이지와 같은 목록행·패널을 쓴다 — 개발도구만 다르게 생길 이유가 없다.
   */
  const tools: DevTool[] = [
    {
      key: 'sync',
      label: '상품마스터 연동',
      hint: '상품마스터 검증 → ERP 반영 (재고 SSOT)',
      icon: RefreshCw,
      tone: 'blue' as const,
      render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <Message variant="info">공급사 시트와 홈페이지는 작성 참고용입니다. 확정된 판매용 4개 탭을 한 번에 검증한 뒤 ERP에 반영합니다.</Message>
          <SheetSync co={co} onImported={() => { void reload(); }} />
        </div>
      ),
    },
    {
      key: 'master',
      label: '차종마스터',
      hint: '거친 표기를 마스터 트리에 스냅 · 정합 현황',
      icon: Car,
      tone: 'green' as const,
      render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FormCard
            title="지금 있는 매물 → 차종마스터"
            hint="거친 표기·흩어진 칸을 모아 마스터 트리(제조사→모델→세대→파워→트림)에 스냅. high·중만 저장, 애매하면 미선택·검수. 임의 재조합 금지."
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Btn onClick={convertAll} disabled={busy || !masterReady || !rows?.length}>
                {busy ? '변환 중…' : `지금 매물 변환하기${rows ? ` (${rows.length})` : ''}`}
              </Btn>
              <Badge tone={masterReady ? 'green' : 'red'} variant="solid">
                {master === null ? '마스터 로딩' : masterReady ? `마스터 ${master!.length.toLocaleString()}세대` : '마스터 실패'}
              </Badge>
            </div>
            {log ? <CopyBlock text={log} label="로그 복사" /> : null}
          </FormCard>
          <FormCard title="마스터 정합 현황">
            {!fit ? (
              <CenterNote minHeight={48}>{rows === null ? '매물 로딩…' : '집계 중…'}</CenterNote>
            ) : (
              <MasterFitSummary fit={fit} />
            )}
          </FormCard>
        </div>
      ),
    },
    {
      key: 'check',
      label: '데이터 점검',
      hint: `자동감지 ${issues.length}종 · 표시 ${issueHits}건`,
      icon: Stethoscope,
      tone: 'gray' as const,
      render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FormCard title="데이터 이상" hint={`자동감지 ${issues.length}종 · 표시 ${issueHits}건`}>
            <Btn href="/data-check" size="sm" variant="ghost">데이터 점검 상세</Btn>
          </FormCard>
          <FormCard title="개인채널 백필" hint="SP999·빈 채널 개인 영업자를 user_code 채널로 고유화합니다. 실행 전 미리보기로 대상을 확인하세요.">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn variant="ghost" onClick={() => runChannelBackfill(true)} disabled={busy}>개인채널 백필 미리보기</Btn>
              <Btn variant="danger" onClick={() => runChannelBackfill(false)} disabled={busy}>
                {busy ? '처리 중…' : '백필 실행'}
              </Btn>
            </div>
            {channelBackfillLog ? <CopyBlock text={channelBackfillLog} label="로그 복사" /> : null}
          </FormCard>
        </div>
      ),
    },
    {
      key: 'links',
      label: '바로가기',
      hint: '재고·감사로그·회원 · 캐시 비우기',
      icon: Link2,
      tone: 'gray' as const,
      render: () => (
        <FormCard title="바로가기">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {/* ★직원이 «온종일 열어 두는» 화면이 먼저 선다 — 콕핏은 폰용이다. */}
            <Btn href="/settlement/intake" size="sm" variant="ghost">정산 접수(워크스테이션)</Btn>
            <Btn href="/settlement/board" size="sm" variant="ghost">정산 콕핏(폰)</Btn>
            <Btn href="/inventory" size="sm" variant="ghost">{NAV_LABEL.inventory}</Btn>
            <Btn href="/audit" size="sm" variant="ghost">감사로그</Btn>
            <Btn href="/data-check" size="sm" variant="ghost">데이터점검</Btn>
            <Btn href="/members" size="sm" variant="ghost">회원·파트너</Btn>
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => { clearStoreCache(); toast('목록 캐시 비움 — 다시 불러오세요', 'ok'); void reload(); }}
            >
              스토어 캐시 비우기
            </Btn>
          </div>
        </FormCard>
      ),
    },
  ];

  const current = tools.find((t) => t.key === sel) || null;
  const listEl = (
    <div>
      {tools.map((t) => (
        <FeedListRow
          key={t.key}
          selected={t.key === sel}
          onClick={() => openTool(t.key)}
          thumb={<FeedThumbIcon icon={t.icon} tone={t.tone} decorative />}
          lines={[
            <FeedTitle key="t">{t.label}</FeedTitle>,
            <FeedSub key="h">{t.hint}</FeedSub>,
          ]}
        />
      ))}
    </div>
  );
  const panes: WorkPane[] = [{
    key: current?.key || 'none',
    title: current?.label || '개발도구',
    node: (
      <>
        <PaneHead title={current?.label || '개발도구'} />
        <PaneBody>
          {current ? current.render() : <CenterNote>도구를 선택하세요.</CenterNote>}
        </PaneBody>
      </>
    ),
  }];

  return (
    <WorkPage
      title="개발도구"
      listCount={tools.length}
      countSuffix="개"
      list={listEl}
      panes={panes}
      selected={!!sel}
      onBack={() => openTool(null)}
      contextTitle={current?.label}
      // 목록 1/4 · 도구 3/4 — 공급사 연동처럼 표를 넓게 펼쳐야 하는 도구가 반반에서는 못 산다.
      // 넓은 모니터에서는 목록을 320 에서 멈춘다. 도구 6개짜리 목록이 640px 로 늘어나 봐야
      // 빈 공간만 생기고, 그만큼 표가 좁아진다 — 남는 폭은 전부 도구가 쓴다.
      paneRatio={3}
      listMaxWidth={320}
    />
  );
}

/** 개발도구 한 칸 — 목록행 2줄 규격(제목·설명)과 패널 본문. */
type DevTool = {
  key: string;
  label: string;
  /** 목록에서 한 줄로 «무엇을 하는 도구인지» */
  hint: string;
  icon: LucideIcon;
  tone: BadgeTone;
  render: () => React.ReactNode;
};

