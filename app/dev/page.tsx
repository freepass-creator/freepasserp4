'use client';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getStore, clearStoreCache, peekList } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, setRole, ROLE_LABEL, type Role } from '@/lib/domain/deal';
import { getSession, isGuest } from '@/lib/auth-session';
import { isAdminUiAllowed } from '@/lib/auth-gate';
import { auditMasterFit, reconcileToMaster, type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { loadVehicleMaster } from '@/lib/domain/vehicle-master-load';
import { checkInventory } from '@/lib/domain/data-check';
import { confirmDialog, toast } from '@/components/Toaster';
import {
  Page, Btn, C, R, Loading, CenterNote, SectionLabel, Badge, FS, NUM,
  PaneHead, PaneBody, FeedListRow, FeedThumbIcon, FeedTitle, FeedSub,
} from '@/components/ui';
import { MasterFitSummary } from '@/components/MasterFitSummary';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { RefreshCw, Car, ArrowLeftRight, ShieldCheck, Stethoscope, Link2, type LucideIcon } from 'lucide-react';
import type { BadgeTone } from '@/components/ui';
import { NAV_LABEL } from '@/lib/tabbar';
import dynamic from 'next/dynamic';

// 공급사 연동은 무겁다(시트 파서·차종마스터). 도구를 고를 때 불러온다.
const SheetSync = dynamic(() => import('@/components/SheetSync').then((m) => m.SheetSync), {
  ssr: false,
  loading: () => <Loading />,
});

async function saveMigrationBackup(kind: 'products' | 'settlements', backup: unknown): Promise<string> {
  const response = await fetch('/api/dev/migration-backup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, backup }),
  });
  const result = await response.json() as { ok?: boolean; path?: string; sha256?: string; error?: string };
  if (!response.ok || !result.ok || !result.path || !result.sha256) {
    throw new Error(result.error || '마이그레이션 백업 저장에 실패했습니다.');
  }
  return `${result.path} · SHA-256 ${result.sha256}`;
}

export default function DevTools() {
  const co = getCompanyId();
  const [ok, setOk] = useState<boolean | null>(null);
  const [rows, setRows] = useState<EntityRecord[] | null>(() => peekList('product', co));
  const [master, setMaster] = useState<MasterEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');
  const [migBusy, setMigBusy] = useState(false);
  const [migLog, setMigLog] = useState('');
  const [privateMigLog, setPrivateMigLog] = useState('');
  const [settlementMigLog, setSettlementMigLog] = useState('');
  const [diagLog, setDiagLog] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [role, setRoleLocal] = useState<Role>(() => (typeof window !== 'undefined' ? getRole() : 'agent'));

  const reload = useCallback(async () => {
    // product만 다시 — 전역 clearStoreCache는 다른 페이지 캐시까지 날려 전환 체감↓
    const list = await getStore().list('product', co);
    setRows(list);
    return list;
  }, [co]);

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
    if (isGuest()) {
      toast('둘러보기에서는 관리자 도구를 열 수 없습니다. 관리자 계정으로 로그인하세요.', 'info');
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

  // v3 라이브 매물 → v4 오버레이 1회 복사(소스 전환 준비). dryRun=미리보기(쓰기 없음).
  const runMigrate = async (dryRun: boolean) => {
    if (migBusy) return;
    setMigBusy(true); setMigLog('');
    try {
      const { migrateV3ProductsToV4 } = await import('@/lib/firebase/migrate-products');
      const r = await migrateV3ProductsToV4(dryRun);
      const head = dryRun ? '[미리보기] ' : '[복사 완료] ';
      const msg = `${head}v3 ${r.v3Total} · v4(전) ${r.v4Before} → ${dryRun ? '복사예정' : '복사'} ${r.copied}`
        + ` · 이미있음 ${r.skippedExists} · 건너뜀 ${r.skippedUnsafe} · v4(후) ${r.v4After}`;
      setMigLog(msg);
      toast(msg, r.copied || dryRun ? 'ok' : 'info');
      if (!dryRun) await reload();
    } catch (e) {
      const msg = '마이그레이션 오류: ' + String((e as Error).message || e);
      setMigLog(msg); toast(msg, 'error');
    } finally { setMigBusy(false); }
  };

  // 매물 중복 진단 — v3∪v4 병합 후 무엇이 몇 개 합쳐지는지 실데이터로 확인(쓰기 없음).
  const runDiag = async () => {
    if (migBusy) return;
    setMigBusy(true); setDiagLog('');
    try {
      const { diagnoseProductDedup } = await import('@/lib/firebase/migrate-products');
      const d = await diagnoseProductDedup();
      const ph = d.placeholderValues.map((x) => `  ${x.value} ×${x.count}`).join('\n');
      const dp = d.dupIdentities.map((x) => `  ${x.id} ×${x.count}`).join('\n');
      const st = d.statusCounts.map((x) => `  ${x.status} ${x.count}`).join('\n');
      const pv = d.providerCounts.map((x) => `  ${x.code} ${x.name || '?'} ${x.count}`).join('\n');
      const msg =
        `v3 ${d.v3} · v4 ${d.v4} · 병합 ${d.merged}\n`
        + `활성 유일대수: v3만 ${d.v3ActiveUnique} · v4만 ${d.v4ActiveUnique} · 합집합 ${d.uniqueByNewIdentity}\n`
        + `교집합 밖: v4에만(v3없음) ${d.v4NotInV3} · v3에만(v4없음) ${d.v3NotInV4}\n`
        + `분류: 실번호판 ${d.realPlateRows} · VIN만 ${d.vinOnlyRows} · placeholder ${d.placeholderRows} · 공백 ${d.blankRows}\n`
        + `dedup(재고): 새(신원) ${d.uniqueByNewIdentity}  vs  옛(원문차번) ${d.uniqueByRawCarNumber}\n`
        + `erp3정합: 재고 ${d.uniqueByNewIdentity} − status삭제 ${d.statusDeleted} = ${d.erp3Inventory}대 (노후빼면 ${d.erp3InvExOld})\n`
        + `층위: 재고 ${d.uniqueByNewIdentity} − 카슝 ${d.kashung} − 출고불가 ${d.hiddenFromCatalog} = 카탈로그 ${d.finderVisible} (노후 ${d.tooOld} 포함)\n`
        + (st ? `상태별:\n${st}\n` : '')
        + (pv ? `공급사별:\n${pv}\n` : '')
        + (ph ? `placeholder 값(오합침 원인):\n${ph}\n` : '')
        + (dp ? `실신원 중복(v3/v4 더블) TOP:\n${dp}` : '');
      setDiagLog(msg);
      toast('중복 진단 완료', 'ok');
    } catch (e) {
      const msg = '진단 오류: ' + String((e as Error).message || e);
      setDiagLog(msg); toast(msg, 'error');
    } finally { setMigBusy(false); }
  };

  const runPrivateMigration = async (dryRun: boolean) => {
    if (migBusy) return;
    if (!dryRun && !await confirmDialog({
      title: '민감 매물 필드 이동',
      message: '원가·VIN·내부 수수료를 products_private로 복사한 뒤 v3/v4 공개 노드에서 제거합니다.\n동일 스냅샷은 로컬 tmp/migration-backups에 자동 저장됩니다. dry-run 결과를 확인했나요?',
      danger: true,
      okLabel: '민감 필드 이동 실행',
    })) return;
    setMigBusy(true);
    setPrivateMigLog('');
    try {
      const { migrateProductsPrivate } = await import('@/lib/firebase/migrate-products-private');
      const result = await migrateProductsPrivate(dryRun, {
        beforeApply: async (backup) => {
          const saved = await saveMigrationBackup('products', backup);
          setPrivateMigLog(`[백업 완료] ${saved}`);
        },
        onProgress: (completed, total) => {
          setPrivateMigLog(`[이동 중] ${completed}/${total}배치 완료`);
        },
      });
      const message = `${dryRun ? '[미리보기]' : '[이동 완료]'} 검사 ${result.scannedProducts}대`
        + ` · 민감필드 상품 ${result.productsWithPrivate}`
        + ` · private 쓰기 ${result.privateWrites}`
        + ` · public 삭제 ${result.publicDeletes}`
        + ` · 안전제외 ${result.skippedUnsafe}`
        + ` · 계획경로/배치 ${result.plannedPaths}/${result.plannedBatches}`
        + ` · 적용경로 ${result.appliedPaths}`;
      setPrivateMigLog(message);
      toast(message, 'ok');
      if (!dryRun) await reload();
    } catch (error) {
      const message = '민감 필드 이동 오류: ' + String((error as Error).message || error);
      setPrivateMigLog(message);
      toast(message, 'error');
    } finally {
      setMigBusy(false);
    }
  };

  const runSettlementMigration = async (dryRun: boolean) => {
    if (migBusy) return;
    if (!dryRun && !await confirmDialog({
      title: '정산 금액 private 이동',
      message: 'R1·R2·순수익을 역할별 private 노드로 복사한 뒤 공개 정산에서 제거합니다.\n동일 스냅샷은 로컬 tmp/migration-backups에 자동 저장됩니다. dry-run 결과를 확인했나요?',
      danger: true,
      okLabel: '정산 금액 이동 실행',
    })) return;
    setMigBusy(true); setSettlementMigLog('');
    try {
      const { migrateSettlementsPrivate } = await import('@/lib/firebase/migrate-settlements-private');
      const result = await migrateSettlementsPrivate(dryRun, {
        beforeApply: async (backup) => {
          const saved = await saveMigrationBackup('settlements', backup);
          setSettlementMigLog(`[백업 완료] ${saved}`);
        },
      });
      const message = `${dryRun ? '[미리보기]' : '[이동 완료]'} 검사 ${result.scanned}건`
        + ` · 금액 정산 ${result.withFinance}`
        + ` · R1/R2/admin 쓰기 ${result.providerWrites}/${result.agentWrites}/${result.adminWrites}`
        + ` · public 삭제 ${result.publicDeletes}`
        + ` · 안전제외 ${result.skippedUnsafe}`
        + ` · 계획경로/배치 ${result.plannedPaths}/${result.plannedBatches}`
        + ` · 적용경로 ${result.appliedPaths}`;
      setSettlementMigLog(message); toast(message, 'ok');
    } catch (error) {
      const message = '정산 금액 이동 오류: ' + String((error as Error).message || error);
      setSettlementMigLog(message); toast(message, 'error');
    } finally { setMigBusy(false); }
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
  const card: CSSProperties = { border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: 14 };

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
      label: '공급사 상품 연동',
      hint: '시트·홈페이지 검증 → 들어올 상품 확인 → 반영',
      icon: RefreshCw,
      tone: 'blue' as const,
      render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div style={{ fontSize: FS.sub, color: C.mute, lineHeight: 1.5 }}>
            원본이 시트든 홈페이지든 절차는 하나입니다 — 검증하고, 들어올 상품을 눈으로 보고, 반영합니다.
          </div>
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
          <div style={{ ...card, background: C.selected }}>
            <SectionLabel mt={0}>지금 있는 매물 → 차종마스터</SectionLabel>
            <div style={{ fontSize: FS.cap, color: C.faint, lineHeight: 1.5, marginBottom: 10 }}>
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
            {log && <pre style={{ margin: '10px 0 0', fontSize: FS.cap, color: C.mute, whiteSpace: 'pre-wrap', fontFamily: NUM }}>{log}</pre>}
          </div>
          <div style={card}>
            <SectionLabel mt={0}>마스터 정합 현황</SectionLabel>
            {!fit ? (
              <div style={{ fontSize: FS.sub, color: C.faint }}>{rows === null ? '매물 로딩…' : '집계 중…'}</div>
            ) : (
              <MasterFitSummary fit={fit} />
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'migrate',
      label: 'v3 → v4 이관',
      hint: '중복 진단 · 복사 미리보기 (읽기 전용)',
      icon: ArrowLeftRight,
      tone: 'amber' as const,
      render: () => (
        <div style={{ ...card, background: C.selected }}>
          <SectionLabel mt={0}>v3 매물 → v4 복사 (소스 전환 준비)</SectionLabel>
          <div style={{ fontSize: FS.cap, color: C.faint, lineHeight: 1.5, marginBottom: 10 }}>
            운영 전수감사에서 child key 공통이 1개뿐이고 차량번호 중복·계약·채팅 참조가 확인됐습니다.
            직접 복사는 중복 재고와 참조 단절 위험 때문에 잠겨 있으며, 여기서는 읽기 전용 진단만 제공합니다.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Btn variant="ghost" onClick={runDiag} disabled={migBusy}>중복 진단(쓰기 없음)</Btn>
            <Btn variant="ghost" onClick={() => runMigrate(true)} disabled={migBusy}>미리보기(복사 안 함)</Btn>
          </div>
          {diagLog && <pre style={{ margin: '10px 0 0', fontSize: FS.cap, color: C.mute, whiteSpace: 'pre-wrap', fontFamily: NUM, lineHeight: 1.6 }}>{diagLog}</pre>}
          {migLog && <pre style={{ margin: '10px 0 0', fontSize: FS.cap, color: C.mute, whiteSpace: 'pre-wrap', fontFamily: NUM }}>{migLog}</pre>}
        </div>
      ),
    },
    {
      key: 'private',
      label: '민감 필드 분리',
      hint: '원가·VIN·정산 금액을 private 노드로',
      icon: ShieldCheck,
      tone: 'red' as const,
      render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ ...card, background: C.warnBg }}>
            <SectionLabel mt={0}>민감 매물 필드 → private 이동</SectionLabel>
            <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.6, marginBottom: 10 }}>
              원가·VIN·기간별 내부 수수료를 <code>v4/products_private</code>에 보존한 뒤
              v3/v4 공개 상품에서 제거합니다. 먼저 미리보기로 대상과 삭제 경로 수를 확인하세요.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn variant="ghost" onClick={() => runPrivateMigration(true)} disabled={migBusy}>민감 필드 미리보기</Btn>
              <Btn variant="danger" onClick={() => runPrivateMigration(false)} disabled={migBusy}>
                {migBusy ? '처리 중…' : 'private 이동 실행'}
              </Btn>
            </div>
            {privateMigLog && <pre style={{ margin: '10px 0 0', fontSize: FS.cap, color: C.mute, whiteSpace: 'pre-wrap', fontFamily: NUM }}>{privateMigLog}</pre>}
          </div>
          <div style={{ ...card, background: C.warnBg }}>
            <SectionLabel mt={0}>정산 금액 → 역할별 private 이동</SectionLabel>
            <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.6, marginBottom: 10 }}>
              공급사 청구(R1), 영업 지급(R2), 관리자 순수익을 각 private 노드에 보존한 뒤 공개 정산에서 제거합니다.
              실제 실행 전 미리보기와 RTDB 백업이 필요합니다.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn variant="ghost" onClick={() => runSettlementMigration(true)} disabled={migBusy}>정산 이동 미리보기</Btn>
              <Btn variant="danger" onClick={() => runSettlementMigration(false)} disabled={migBusy}>
                {migBusy ? '처리 중…' : '정산 private 이동 실행'}
              </Btn>
            </div>
            {settlementMigLog && <pre style={{ margin: '10px 0 0', fontSize: FS.cap, color: C.mute, whiteSpace: 'pre-wrap', fontFamily: NUM }}>{settlementMigLog}</pre>}
          </div>
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
        <div style={card}>
          <SectionLabel mt={0}>데이터 이상</SectionLabel>
          <div style={{ fontSize: FS.sub, color: C.mute, marginBottom: 8 }}>
            자동감지 {issues.length}종 · 표시 {issueHits}건
          </div>
          <Btn href="/data-check" size="sm" variant="ghost">데이터 점검 상세</Btn>
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
              onClick={() => { clearStoreCache(); toast('목록 캐시 비움 — 다시 불러오세요', 'ok'); void reload(); }}
            >
              스토어 캐시 비우기
            </Btn>
          </div>
        </div>
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
          onClick={() => setSel(t.key)}
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
      onBack={() => setSel(null)}
      contextTitle={current?.label}
      // 목록 1/4 · 도구 3/4 — 공급사 연동처럼 표를 넓게 펼쳐야 하는 도구가 반반에서는 못 산다.
      // 넓은 모니터에서는 목록을 320 에서 멈춘다. 도구 6개짜리 목록이 640px 로 늘어나 봐야
      // 빈 공간만 생기고, 그만큼 표가 좁아진다 — 남는 폭은 전부 도구가 쓴다.
      paneRatio={3}
      listMaxWidth={320}
    />
  );
}

/** 개발도구 한 칸 — 목록행 3줄 규격(제목·설명)과 패널 본문. */
type DevTool = {
  key: string;
  label: string;
  /** 목록에서 한 줄로 «무엇을 하는 도구인지» */
  hint: string;
  icon: LucideIcon;
  tone: BadgeTone;
  render: () => React.ReactNode;
};

