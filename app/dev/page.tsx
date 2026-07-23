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
import { Page, Btn, C, R, Loading, CenterNote, SectionLabel, Badge, FS, NUM } from '@/components/ui';
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
  const [migBusy, setMigBusy] = useState(false);
  const [migLog, setMigLog] = useState('');
  const [diagLog, setDiagLog] = useState('');
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

  // v3 라이브 매물 → v4 오버레이 1회 복사(소스 전환 준비). dryRun=미리보기(쓰기 없음).
  const runMigrate = async (dryRun: boolean) => {
    if (migBusy) return;
    if (!dryRun && typeof window !== 'undefined'
      && !window.confirm('v3 매물을 v4로 복사합니다.\n이미 v4에 있는 건 건너뛰고, v3 원본은 변경하지 않습니다.\n진행할까요?')) return;
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

  return (
    <Page title="개발도구">
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '12px 0 40px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: FS.sub, color: C.mute, lineHeight: 1.5 }}>
          수집된 차량 원자(시트·OCR·등록증·옵션·메모)를 전부 신호로 써서 차종마스터 규격에 맞춥니다.
          손님·영업에 보이는 차종은 마스터 표준. 원본은 보존.
        </div>

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

        <div style={{ ...card, background: C.selected }}>
          <SectionLabel mt={0}>v3 매물 → v4 복사 (소스 전환 준비)</SectionLabel>
          <div style={{ fontSize: FS.cap, color: C.faint, lineHeight: 1.5, marginBottom: 10 }}>
            v3 라이브 매물을 v4 오버레이로 1회 복사합니다. 이미 v4에 있는 건 건너뜀(편집본 보존),
            v3 원본은 변경 안 함. <b style={{ color: C.mute }}>미리보기로 대수를 먼저 확인</b>하고 복사 실행하세요.
            복사·검증 후 카탈로그를 v4 전용으로 전환합니다.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Btn variant="ghost" onClick={runDiag} disabled={migBusy}>중복 진단(쓰기 없음)</Btn>
            <Btn variant="ghost" onClick={() => runMigrate(true)} disabled={migBusy}>미리보기(복사 안 함)</Btn>
            <Btn onClick={() => runMigrate(false)} disabled={migBusy}>{migBusy ? '복사 중…' : 'v3→v4 복사 실행'}</Btn>
          </div>
          {diagLog && <pre style={{ margin: '10px 0 0', fontSize: FS.cap, color: C.mute, whiteSpace: 'pre-wrap', fontFamily: NUM, lineHeight: 1.6 }}>{diagLog}</pre>}
          {migLog && <pre style={{ margin: '10px 0 0', fontSize: FS.cap, color: C.mute, whiteSpace: 'pre-wrap', fontFamily: NUM }}>{migLog}</pre>}
        </div>

        <div style={card}>
          <SectionLabel mt={0}>마스터 정합 현황</SectionLabel>
          {!fit ? (
            <div style={{ fontSize: FS.sub, color: C.faint }}>{rows === null ? '매물 로딩…' : '집계 중…'}</div>
          ) : (
            <MasterFitSummary fit={fit} />
          )}
        </div>

        <div style={card}>
          <SectionLabel mt={0}>데이터 이상</SectionLabel>
          <div style={{ fontSize: FS.sub, color: C.mute, marginBottom: 8 }}>
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

        <div style={{ fontSize: FS.cap, color: C.faint }}>
          팁: 역할이 영업자면 재고·개발도구가 막힙니다. <Link href="/settings" style={{ color: C.accent }}>설정</Link>에서 관리자로 전환.
        </div>
      </div>
    </Page>
  );
}
