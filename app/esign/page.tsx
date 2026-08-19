'use client';

/**
 * 계약서관리 — **관리자 전용.** 4패널.
 *
 * ★ Claude 후속 설계 전 필독:
 *   `docs/CLAUDE_ESIGN_SEND_CENTER_BUILD_MEMO_2026-08-10.md`
 *   사용자의 최신 결정은 「ERP 계약 선행 없는 자체 전자계약 발송센터」다.
 *   이 파일의 현재 4패널/hasTermFrozen 흐름을 최종 UX로 간주하지 말 것.
 *
 *   ① 목록           보낼 대상 계약(약정에서 기간·금액이 굳은 것)
 *   ② 프리패스 데이터  계약서 칸에 넣을 값(외부 ERP) — 손님·계약조건·보험·상품/정책
 *   ③ 프리패스 전자계약 발송  표준서식 확정 → 링크·A4 초안 만들기 → 복사 전달
 *   ④ 전자계약 진행상황       본인확인 자료·동의·서명 검토 → 승인·봉인 PDF
 *
 * ★2026-08-10 결정: 신규 발행은 프리패스 자체 전자계약. 기존 착한거래 발행분은 읽기 호환만 유지.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getAuthClient } from '@/lib/firebase/client';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import type { EntityRecord } from '@/lib/intake/entities';
import { isAdminUiAllowed } from '@/lib/auth-gate';
import { NAV_LABEL } from '@/lib/tabbar';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { ContractListRow, EsignCreateRow, EsignListRow } from '@/components/list-rows';
import { ChakhandealEsignButton } from '@/components/ChakhandealEsignButton';
import { FreepassEsignLinkPane, FreepassEsignProgressPane } from '@/components/FreepassEsignPanes';
import { EsignSendCenter } from '@/components/EsignSendCenter';
import { toast } from '@/components/Toaster';
import {
  Badge, Btn, ButtonLabel, C, CenterNote, DetailRow, FS, FW, FilterChips, ICON, ListGroup,
  FormGrid, Input, SearchInput, Textarea, Loading, NavBack, PaneBody, PaneHead, SectionLabel,
} from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { Copy, ExternalLink, Database, FileSignature, ListChecks, RefreshCw } from 'lucide-react';
import {
  ESIGN_FILTERS, ESIGN_STEPS, compareEsign, consentAt, consentKeys, esignDocuments,
  esignIdentityShots, esignStage, isEsignIssued, matchesEsignFilter, type EsignFilter,
} from '@/lib/domain/esign-progress';
import {
  contractKindFor, findTemplate, maturityOf, sentInsuranceSide, sentTemplateOf, standardTemplateSelectionError,
  templatesForContract, type EsignTemplate,
} from '@/lib/domain/esign-templates';
import { findContractKind, type MaturityKind } from '@/lib/domain/esign-contract-kind';
import {
  REQUIRED_DOCS, SAMPLE_AGREEMENT, buildConsentGroups, resolveContractSources,
} from '@/lib/domain/esign-consent-doc';
import { contractVehicleLabel } from '@/lib/domain/vehicle-label';
import {
  hasTermFrozen, isContractCancelled, isContractCompleted, isContractInProgress,
} from '@/lib/domain/contract';
import { contractHaystack, matchHay } from '@/lib/domain/search';
import { createDirectEsignContract } from '@/lib/domain/deal';
import { canIssueContract } from '@/lib/domain/policy-tier';

const S = (v: unknown) => String(v ?? '').trim();
const today = () => {
  const date = new Date();
  const p2 = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
};

type NewEsignContract = {
  providerCompanyCode: string;
  policyCode: string;
  contractDate: string;
  customerName: string;
  customerPhone: string;
  vehicleName: string;
  carNumber: string;
  rentMonths: string;
  rentAmount: string;
  depositAmount: string;
};

type ContractSourceFilter = '진행중' | '계약완료';

const emptyNewEsignContract = (): NewEsignContract => ({
  providerCompanyCode: '',
  policyCode: '',
  contractDate: today(),
  customerName: '',
  customerPhone: '',
  vehicleName: '',
  carNumber: '',
  rentMonths: '',
  rentAmount: '',
  depositAmount: '0',
});

async function syncChakhandealRows(rows: EntityRecord[]): Promise<Map<string, EntityRecord>> {
  const targets = rows
    .filter((row) => S(row.esign_provider) === 'chakhandeal' && S(row.esign_id) && !['서명완료', '만료', '반려'].includes(S(row.sign_status)))
    .map((row) => S(row.contract_code))
    .filter(Boolean);
  const user = getAuthClient()?.currentUser;
  if (!user || !targets.length) return new Map();

  const merged = new Map<string, EntityRecord>();
  for (let i = 0; i < targets.length; i += 50) {
    const response = await fetch('/api/chakhandeal/contracts/status', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await user.getIdToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contractCodes: targets.slice(i, i + 50) }),
      cache: 'no-store',
    });
    if (!response.ok) continue;
    const body = await response.json().catch(() => ({})) as {
      results?: Array<{ contractCode?: string; ok?: boolean; patch?: EntityRecord }>;
    };
    for (const result of body.results || []) {
      const code = S(result.contractCode);
      if (code && result.ok && result.patch) merged.set(code, result.patch);
    }
  }
  return merged;
}

export default function EsignPage() {
  return <EsignSendCenter />;
}

/** 이전 4패널 구현은 전환 검증이 끝날 때까지 코드 참조용으로만 보존한다. */
function LegacyEsignPage() {
  const co = getCompanyId();
  const router = useRouter();
  const mobile = useIsMobile();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [allContracts, setAllContracts] = useState<EntityRecord[]>([]);
  const [products, setProducts] = useState<EntityRecord[]>([]);
  const [policies, setPolicies] = useState<EntityRecord[]>([]);
  const [partners, setPartners] = useState<EntityRecord[]>([]);
  const [filter, setFilter] = useState<EsignFilter>('전체');
  const [query, setQuery] = useState('');
  const [selKey, setSelKey] = useState('');
  const [creating, setCreating] = useState<NewEsignContract | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createSourceFilter, setCreateSourceFilter] = useState<ContractSourceFilter>('진행중');
  const [createSourceQuery, setCreateSourceQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const [list, prods, pols, pts] = await Promise.all([
        getStore().list('contract', co),
        getStore().list('product', co).catch(() => [] as EntityRecord[]),
        getStore().list('policy', co).catch(() => [] as EntityRecord[]),
        getStore().list('partner', co).catch(() => [] as EntityRecord[]),
      ]);
      setProducts(prods);
      setPolicies(pols);
      setPartners(pts);
      const synced = await syncChakhandealRows(list);
      const current = list.map((row) => ({ ...row, ...(synced.get(S(row.contract_code)) || {}) }));
      // 신규 계약의 「기존 계약 불러오기」는 전자계약 발송대상보다 넓은 전체 계약 원장을 쓴다.
      // 기간·금액 확정 전 진행건도 찾아 원래 계약에서 이어갈 수 있어야 한다.
      setAllContracts(current);
      // 발송 대상 = 취소 아니고 약정에서 기간·금액이 굳은 계약.
      // 「보낼 것」과 「보낸 것」이 한 목록에 있어야 관리자가 빠뜨린 건을 본다.
      setRows(current.filter((c) => !isContractCancelled(c) && hasTermFrozen(c)));
    } catch {
      setRows([]);
    }
  }, [co]);

  useEffect(() => {
    (async () => {
      if (!isAdminUiAllowed()) { router.replace('/'); return; }
      await seedIfEmpty(co);
      setAllowed(true);
      await load();
    })();
    /* eslint-disable-next-line */
  }, []);

  // 관리자가 화면을 열어 둔 동안 손님 서명 상태를 15초마다 되받는다.
  useEffect(() => {
    if (!allowed) return undefined;
    const timer = window.setInterval(() => { void load(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [allowed, load]);

  const shown = useMemo(() => (rows || [])
    .filter((c) => matchesEsignFilter(c, filter))
    .filter((c) => (query ? matchHay(contractHaystack(c), query) : true))
    .sort(compareEsign), [rows, filter, query]);

  const sel = useMemo(
    () => allContracts.find((c) => S(c.contract_code) === selKey) || null,
    [allContracts, selKey],
  );
  const sources = useMemo(
    () => (sel ? resolveContractSources(sel, products, policies) : { product: null, policy: null }),
    [sel, products, policies],
  );
  // 패널 머리의 건수 — 「몇 개 묶음이 나가나」. 값 없는 묶음은 빠지므로 이 수가 곧 손님이 볼 화면 수다.
  const groupCount = useMemo(
    () => (sel ? buildConsentGroups(sel, sources.policy).filter((g) => g.rows.length).length : 0),
    [sel, sources.policy],
  );
  const providerOptions = useMemo(() => {
    const policyProviders = new Set(policies.map((policy) => S(policy.provider_company_code)).filter(Boolean));
    const names = new Map<string, string>();
    for (const partner of partners) {
      const value = S(partner.partner_code || partner.provider_company_code || partner._key);
      if (!value) continue;
      const isProvider = String(partner.partner_type || '').includes('공급')
        || !!partner.provider_company_code
        || policyProviders.has(value);
      if (!isProvider) continue;
      names.set(value, S(partner.name || partner.partner_name || value));
    }
    // 파트너 분류가 오래됐어도 정책에 귀속된 공급사는 계약서 작성에서 빠지면 안 된다.
    for (const value of policyProviders) if (!names.has(value)) names.set(value, value);
    return [...names].map(([value, label]) => ({ value, label }));
  }, [partners, policies]);
  const providerName = useMemo(
    () => new Map(providerOptions.map((option) => [option.value, option.label])),
    [providerOptions],
  );
  const policyOptions = useMemo(() => policies
    .filter((policy) => {
      const policyProvider = S(policy.provider_company_code);
      return !creating?.providerCompanyCode || !policyProvider || policyProvider === creating.providerCompanyCode;
    })
    .map((policy) => {
      const value = S(policy.policy_code || policy._key);
      const supplier = providerName.get(S(policy.provider_company_code)) || S(policy.provider_company_code);
      const name = S(policy.policy_name) || value;
      const ready = canIssueContract(policy).ok;
      return { value, label: [name, supplier, ready ? '' : '발송 전 확인 필요'].filter(Boolean).join(' · ') };
    })
    .filter((option) => option.value), [policies, creating?.providerCompanyCode, providerName]);
  const creatingPolicy = useMemo(
    () => policies.find((policy) => S(policy.policy_code || policy._key) === creating?.policyCode) || null,
    [policies, creating?.policyCode],
  );
  const creatingPolicyGate = useMemo(
    () => (creatingPolicy ? canIssueContract(creatingPolicy) : null),
    [creatingPolicy],
  );
  const createSourceRows = useMemo(() => allContracts
    .filter((contract) => !isContractCancelled(contract))
    .filter((contract) => (createSourceFilter === '계약완료'
      ? isContractCompleted(contract)
      : isContractInProgress(contract)))
    .filter((contract) => (createSourceQuery
      ? matchHay(contractHaystack(contract), createSourceQuery)
      : true))
    .sort((a, b) => {
      const dateOrder = S(b.contract_date).localeCompare(S(a.contract_date), 'ko');
      return dateOrder || S(b.contract_code).localeCompare(S(a.contract_code), 'ko');
    }), [allContracts, createSourceFilter, createSourceQuery]);

  const openCreate = () => {
    setSelKey('');
    setCreateSourceFilter('진행중');
    setCreateSourceQuery('');
    setCreating(emptyNewEsignContract());
  };
  const pickCreateSource = (source: EntityRecord) => {
    const sourceCode = S(source.contract_code);
    if (!sourceCode) return;
    // 진행중은 계약서 발송, 완료는 인도일 관리 대상이다. 어느 쪽도 새 계약으로 복제하지 않는다.
    setCreating(null);
    setSelKey(sourceCode);
    toast(isContractCompleted(source)
      ? '계약완료 건을 불러왔습니다. 착한거래 진행상황에서 인도일을 확인해 주세요.'
      : '계약진행중 건을 불러왔습니다. 내용을 확인하고 계약서를 발송해 주세요.', 'ok');
  };
  const updateCreate = (key: string, value: string) => {
    setCreating((current) => {
      if (!current) return current;
      const next = { ...current, [key]: value };
      if (key === 'providerCompanyCode' && current.policyCode) {
        const picked = policies.find((policy) => S(policy.policy_code || policy._key) === current.policyCode);
        const pickedProvider = S(picked?.provider_company_code);
        if (pickedProvider && pickedProvider !== value) next.policyCode = '';
      }
      return next;
    });
  };
  const saveCreate = async () => {
    if (!creating || createBusy) return;
    const policy = policies.find((item) => S(item.policy_code || item._key) === creating.policyCode);
    if (!creating.providerCompanyCode) { toast('공급사를 골라 주세요.', 'error'); return; }
    if (!policy) { toast('전자계약에 사용할 정책을 골라 주세요.', 'error'); return; }
    const policyProvider = S(policy.provider_company_code);
    if (policyProvider && policyProvider !== creating.providerCompanyCode) {
      toast('선택한 공급사에 맞는 정책을 골라 주세요.', 'error');
      return;
    }
    const gate = canIssueContract(policy);
    setCreateBusy(true);
    try {
      const code = await createDirectEsignContract({
        providerCompanyCode: creating.providerCompanyCode,
        policyCode: creating.policyCode,
        contractDate: creating.contractDate,
        customerName: creating.customerName,
        customerPhone: creating.customerPhone,
        vehicleName: creating.vehicleName,
        carNumber: creating.carNumber,
        rentMonths: Number(creating.rentMonths),
        rentAmount: Number(creating.rentAmount),
        depositAmount: Number(creating.depositAmount),
      });
      setCreating(null);
      setQuery('');
      setFilter('전체');
      await load();
      setSelKey(code);
      toast(gate.ok
        ? '새 계약서를 등록했습니다. 내용을 확인한 뒤 계약서 만들기를 눌러 주세요.'
        : '계약서 초안을 등록했습니다. 링크 발행 전 정책의 전자계약 필수항목을 완료해 주세요.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '계약서 등록에 실패했습니다.', 'error');
    } finally {
      setCreateBusy(false);
    }
  };

  if (allowed === null) return <Loading />;

  const listEl = rows === null ? <Loading /> : (
    <div>
      {/* 재고관리의 상품등록 행과 같은 자리 — 검색 결과가 0건이어도 신규 생성은 항상 맨 위에 둔다. */}
      <EsignCreateRow selected={!!creating} onClick={openCreate} />
      {shown.length === 0 ? (
        <CenterNote>
          {query || filter !== '전체'
            ? '조건에 맞는 계약이 없습니다.'
            : '작성된 계약서가 아직 없습니다.'}
        </CenterNote>
      ) : (
        <ListGroup>
          {shown.map((c) => (
            <EsignListRow
              key={S(c.contract_code)}
              contract={c}
              stage={esignStage(c)}
              selected={S(c.contract_code) === selKey}
              onClick={() => { setCreating(null); setSelKey(S(c.contract_code)); }}
            />
          ))}
        </ListGroup>
      )}
    </div>
  );

  const backToList = () => {
    if (creating) setCreating(null);
    else setSelKey('');
  };

  // 계약 데이터는 세로로 길다. 하단독까지 내려가지 않아도 목록으로 복귀할 수 있게
  // 웹은 PaneHead 우측, 모바일은 패널 최상단에 같은 공용 NavBack을 둔다.
  // 신규 입력이면 「목록」이 아니라 「취소」— 작성 중을 닫아야 패널이 사라진다.
  const shell = (
    title: string,
    count: React.ReactNode,
    body: React.ReactNode,
    back: false | 'list' | 'cancel' = false,
  ) => (
    <>
      {!mobile && (
        <PaneHead
          title={title}
          count={count}
          right={back ? <NavBack kind={back} onClick={backToList} showLabel /> : undefined}
        />
      )}
      {mobile && back ? (
        <div style={{
          position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center',
          padding: '4px 8px', borderBottom: `1px solid ${C.line}`, background: C.taupeBg,
        }}>
          <NavBack kind={back} onClick={backToList} showLabel />
        </div>
      ) : null}
      <PaneBody pad>{body}</PaneBody>
    </>
  );
  const empty = (title: string, text: string) => shell(title, undefined, <CenterNote>{text}</CenterNote>);

  // 착한거래 embed — 패널 열 높이를 한 덩어리로 채운다(Fragment면 flex 배분이 어긋날 수 있음).
  const embedShell = (title: string, body: React.ReactNode) => (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.taupeBg }}>
      {!mobile && <PaneHead title={title} />}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {body}
      </div>
    </div>
  );

  // 패널은 **항상** 셋 다 띄운다 — 비었을 때 빼면 목록이 flex 를 다 먹어 4등분이 무너진다.
  const panes: WorkPane[] = [
    {
      key: 'data',
      title: '프리패스 데이터',
      icon: Database,
      node: creating
        ? shell('프리패스 데이터 · 신규 입력', undefined, (
          <NewEsignDataPane
            form={creating}
            providerOptions={providerOptions}
            policyOptions={policyOptions}
            policyGate={creatingPolicyGate}
            policyCount={policies.length}
            sourceRows={createSourceRows}
            sourceFilter={createSourceFilter}
            sourceQuery={createSourceQuery}
            busy={createBusy}
            onChange={updateCreate}
            onSourceFilter={setCreateSourceFilter}
            onSourceQuery={setCreateSourceQuery}
            onPickSource={pickCreateSource}
            onSave={() => { void saveCreate(); }}
            onCancel={() => setCreating(null)}
          />
        ), 'cancel')
        : sel
          ? shell('프리패스 데이터', groupCount, <DataPane contract={sel} product={sources.product} policy={sources.policy} />, 'list')
          : empty('프리패스 데이터', '계약을 고르거나 신규 생성을 누르면 이 패널에서 데이터를 입력합니다.'),
    },
    {
      key: 'chakhandeal',
      title: '프리패스 계약서 작성·발송',
      icon: FileSignature,
      node: shell(
        '프리패스 계약서 작성·발송',
        undefined,
        <FreepassEsignLinkPane
          contract={sel}
          policy={sources.policy}
          onChanged={load}
        />,
      ),
    },
    {
      key: 'progress',
      title: '계약 진행상황',
      icon: ListChecks,
      node: shell(
        '계약 진행상황',
        undefined,
        <FreepassEsignProgressPane contract={sel} onChanged={load} />,
      ),
    },
  ];

  return (
    <>
      <WorkPage
        title={NAV_LABEL.esign}
        statusCount={rows === null ? null : rows.length}
        listCount={rows === null ? null : shown.length}
        list={listEl}
        listTools={{
          search: { value: query, onChange: setQuery, placeholder: '차번·계약번호·고객명' },
          filter: {
            count: filter === '전체' ? 0 : 1,
            label: filter === '전체' ? undefined : filter,
            onClear: () => setFilter('전체'),
            body: (
              <FilterChips
                options={ESIGN_FILTERS.map((f) => ({ key: f, label: f }))}
                value={filter}
                onChange={(v) => setFilter(v as EsignFilter)}
                clearKey="전체"
              />
            ),
          },
        }}
        panes={panes}
        // 목록 1 : 데이터 1 : 연동 1 : 진행 1 — 4등분.
        paneRatio={1}
        selected={!!sel || !!creating}
        contextTitle={creating ? '신규 계약서 입력' : undefined}
        onBack={backToList}
        backKind={creating ? 'cancel' : 'list'}
      />
    </>
  );
}

function ChakhandealStudioEmbed({
  panel,
  contractId,
  externalRef,
}: {
  panel: 'link' | 'progress';
  contractId: string;
  externalRef: string;
}) {
  const [tick, setTick] = useState(0);
  const [fail, setFail] = useState<string | null>(null);
  const rawBase = process.env.NEXT_PUBLIC_CHAKHANDEAL_EMBED_BASE_URL
    || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '');
  let src = '';
  try {
    const url = new URL(`/labs/contract-studio/embed/${panel}`, rawBase);
    if (contractId) url.searchParams.set('contractId', contractId);
    if (externalRef) url.searchParams.set('externalRef', externalRef);
    // 캐시된 연결거부 화면을 피하려고 리로드마다 bust
    url.searchParams.set('_', String(tick));
    src = url.toString();
  } catch {
    src = '';
  }

  useEffect(() => {
    if (!rawBase || process.env.NODE_ENV === 'production') return;
    let cancelled = false;
    (async () => {
      try {
        const probe = await fetch(rawBase.replace(/\/$/, '') + '/', { mode: 'no-cors', cache: 'no-store' });
        void probe;
        if (!cancelled) setFail(null);
      } catch {
        if (!cancelled) setFail('착한거래 로컬 서버(localhost:3000)에 연결되지 않습니다. npm run dev 로 프리패스를 다시 켜면 같이 기동됩니다.');
      }
    })();
    return () => { cancelled = true; };
  }, [rawBase, tick]);

  if (!src) {
    return <CenterNote>착한거래 embed 주소가 설정되지 않았습니다.</CenterNote>;
  }

  if (fail) {
    return (
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16, textAlign: 'center',
      }}>
        <div style={{ fontSize: FS.body, color: C.danger, lineHeight: 1.5 }}>{fail}</div>
        <Btn title="다시 연결" onClick={() => setTick((n) => n + 1)}>다시 연결</Btn>
      </div>
    );
  }

  return (
    <iframe
      key={`${panel}:${contractId}:${externalRef}:${tick}`}
      title={panel === 'link' ? '착한거래 데이터연동 및 링크' : '착한거래 진행상황'}
      src={src}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
      allow="clipboard-write"
      referrerPolicy="no-referrer"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: C.taupeBg }}
    />
  );
}

/* ─────────────── ② 프리패스 데이터 ─────────────── */

function NewEsignDataPane({
  form,
  providerOptions,
  policyOptions,
  policyGate,
  policyCount,
  sourceRows,
  sourceFilter,
  sourceQuery,
  busy,
  onChange,
  onSourceFilter,
  onSourceQuery,
  onPickSource,
  onSave,
  onCancel,
}: {
  form: NewEsignContract;
  providerOptions: Array<{ value: string; label: string }>;
  policyOptions: Array<{ value: string; label: string }>;
  policyGate: { ok: boolean } | null;
  policyCount: number;
  sourceRows: EntityRecord[];
  sourceFilter: ContractSourceFilter;
  sourceQuery: string;
  busy: boolean;
  onChange: (key: string, value: string) => void;
  onSourceFilter: (value: ContractSourceFilter) => void;
  onSourceQuery: (value: string) => void;
  onPickSource: (contract: EntityRecord) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <PaneStack>
      <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.6 }}>
        계약서에 들어갈 프리패스 데이터를 여기서 먼저 확정합니다. 저장하면 새 계약이 선택되고 다음 패널에서 착한거래 링크를 만들 수 있습니다.
      </div>

      <SectionLabel>기존 계약 불러오기</SectionLabel>
      <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.6 }}>
        계약진행중은 계약서 발송 대상, 계약완료는 인도일 관리 대상입니다. 둘 다 기존 계약을 그대로 열며, 완전히 새로운 계약만 아래에서 직접 입력합니다.
      </div>
      <FilterChips
        options={[
          { key: '진행중', label: '발송 대상 · 계약진행중' },
          { key: '계약완료', label: '인도일 관리 · 계약완료' },
        ]}
        value={sourceFilter}
        onChange={(value) => onSourceFilter(value as ContractSourceFilter)}
      />
      <SearchInput
        value={sourceQuery}
        onChange={onSourceQuery}
        placeholder="차번·계약번호·고객명 검색"
        full
      />
      {sourceRows.length ? (
        <>
          <ListGroup>
            {sourceRows.slice(0, 8).map((contract) => (
              <ContractListRow
                key={S(contract.contract_code)}
                c={contract}
                onClick={() => onPickSource(contract)}
              />
            ))}
          </ListGroup>
          {sourceRows.length > 8 ? (
            <div style={{ fontSize: FS.cap, color: C.faint }}>
              검색 결과 {sourceRows.length}건 중 최근 8건을 표시합니다. 차번·계약번호·고객명으로 더 좁혀 주세요.
            </div>
          ) : null}
        </>
      ) : (
        <CenterNote>조건에 맞는 기존 계약이 없습니다.</CenterNote>
      )}

      <FormGrid
        cols={1}
        showNotes
        form={form as unknown as EntityRecord}
        onChange={onChange}
        selectOptions={{
          providerCompanyCode: providerOptions,
          policyCode: policyOptions,
        }}
        fields={[
          { key: 'providerCompanyCode', label: '공급사', type: 'select', options: [], required: true, note: '계약 조건과 양식 범위를 정합니다' },
          { key: 'policyCode', label: '계약 정책', type: 'select', options: [], required: true, note: '선택한 공급사의 정책만 표시됩니다' },
          { key: 'contractDate', label: '계약일', type: 'date', required: true },
          { key: 'customerName', label: '고객명', type: 'text', required: true },
          { key: 'customerPhone', label: '연락처', type: 'text', required: true },
          { key: 'vehicleName', label: '차량명', type: 'text', required: true, note: '모델·세부모델·트림까지 입력합니다' },
          { key: 'carNumber', label: '차량번호', type: 'text', note: '신차면 비워 둘 수 있습니다' },
          { key: 'rentMonths', label: '대여기간(개월)', type: 'number', required: true },
          { key: 'rentAmount', label: '월 대여료(원)', type: 'number', required: true },
          { key: 'depositAmount', label: '보증금(원)', type: 'number', note: '무보증은 0원' },
        ]}
      />

      {!policyCount ? (
        <Badge tone="red" variant="solid">
          등록된 계약 정책이 없습니다. 정책관리에서 정책을 먼저 등록해 주세요.
        </Badge>
      ) : null}
      {policyGate && !policyGate.ok ? (
        <Badge tone="amber" variant="solid">
          데이터 저장은 가능합니다. 링크 발행 전 정책관리의 전자계약 필수항목을 완료해 주세요.
        </Badge>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn title="프리패스 데이터 저장" onClick={onSave} disabled={busy || !policyCount}>
          {busy ? '저장 중…' : '프리패스 데이터 저장'}
        </Btn>
        <Btn title="신규 입력 취소" variant="ghost" onClick={onCancel} disabled={busy}>취소</Btn>
      </div>
    </PaneStack>
  );
}

/**
 * 계약서에 들어갈 값 — 우리가 만드는 부분. 손님 화면에 **이 문자열 그대로** 나간다.
 * 값이 비면 «—» 로 채우지 않고 빨갛게 남긴다 — 빈 채로 계약서가 나가면 사고다.
 */
function DataPane({
  contract, product, policy,
}: {
  contract: EntityRecord;
  product: EntityRecord | null;
  policy: EntityRecord | null;
}) {
  const groups = useMemo(() => buildConsentGroups(contract, policy), [contract, policy]);
  const issueGate = useMemo(() => canIssueContract(policy), [policy]);
  return (
    <PaneStack>
        {!policy ? (
          <Badge tone="red" variant="solid">정책이 연결되지 않아 보험 조건이 빕니다 — 정책관리 확인</Badge>
        ) : null}
        {policy && !issueGate.ok ? (
          <Badge tone="red" variant="solid">링크 발행 전 정책 확인 — {issueGate.reason}</Badge>
        ) : null}
        {!product ? (
          <Badge tone="amber" variant="solid">재고에서 매물을 못 찾았습니다 — 계약 스냅샷만 씁니다</Badge>
        ) : null}

        {groups.map((g) => (
          <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <SectionLabel>{g.title}</SectionLabel>
            <ListGroup>
              {g.rows.length
                ? g.rows.map((row) => <DetailRow key={row.label} label={row.label} value={row.value} />)
                : <DetailRow label="—" value="값이 없습니다" valueColor={C.danger} />}
            </ListGroup>
          </div>
        ))}

        <SectionLabel>손님이 낼 서류</SectionLabel>
        <ListGroup>
          {REQUIRED_DOCS.map((d) => (
            <DetailRow key={d.key} label={d.label} value={d.required ? '필수' : '선택'} valueColor={d.required ? C.ink : C.faint} />
          ))}
        </ListGroup>

        <div style={{ fontSize: FS.cap, color: C.faint }}>
          출처 — 손님·계약조건은 계약, 상품정보는 재고관리, 보험·연령은 정책관리.
        </div>
    </PaneStack>
  );
}

/** 패널 안 세로 스택 — 섹션 간격을 한 곳에서 정한다(패널마다 gap 이 달라지는 걸 막는다). */
function PaneStack({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>;
}

/* ─────────────── ③ = 착한거래 스튜디오 ② 데이터연동·링크 ─────────────── */

/** 스튜디오 intakeSections 골격 (ContractStudio.jsx 와 동일 헤딩·care). */
const STUDIO_LINK_BLOCKS = [
  { key: 'every-guest', heading: '1. 손님정보', careLabel: '매번', open: true, count: 8 },
  { key: 'deal-out', heading: '2. 이번 계약', careLabel: '이번만', open: true, count: 6 },
  { key: 'stock-vehicle', heading: '3. 차량 (재고)', careLabel: '재고', open: true, count: 9 },
  { key: 'later-handover', heading: '4. 인도 후 확정', careLabel: '인도 후', open: false, count: 4 },
  { key: 'maybe-extra', heading: '5. 추가운전자 · 연대보증', careLabel: '해당 시', open: false, count: 11 },
  { key: 'policy-all', heading: '6. 정책 · 거의 고정', careLabel: '정책', open: false, count: 40 },
] as const;

/** 스튜디오 ③ 손님 여정 — LabEsignFlow MACROS / GUEST_FLOW_STEPS 와 동일. */
const GUEST_FLOW_STEPS = [
  { key: 'summary', label: '계약 확인' },
  { key: 'consent', label: '동의' },
  { key: 'identity', label: '본인확인', fixKey: 'identity_verified' },
  { key: 'contract', label: '계약서' },
  { key: 'terms', label: '약관', fixKey: 'agreement' },
  { key: 'cautions', label: '주의사항' },
  { key: 'docs', label: '첨부서류', fixKey: 'documents' },
  { key: 'sign', label: '서명' },
] as const;

type FixableStep = { key: string; label: string; fixKey: string };
const FIXABLE_STEPS: FixableStep[] = GUEST_FLOW_STEPS
  .filter((s): s is typeof s & { fixKey: string } => 'fixKey' in s && Boolean((s as { fixKey?: string }).fixKey))
  .map((s) => ({ key: s.key, label: s.label, fixKey: s.fixKey }));

function ChakhandealPane({
  contract, policy, onChanged,
}: {
  contract: EntityRecord | null;
  policy: EntityRecord | null;
  onChanged: () => void | Promise<void>;
}) {
  const issued = contract ? isEsignIssued(contract) : false;
  const code = contract ? S(contract.contract_code) : '';
  const link = contract ? S(contract.esign_sign_url) : '';
  const options = useMemo(
    () => (contract ? templatesForContract(contract) : []),
    [contract],
  );
  const [pickId, setPickId] = useState(() => findTemplate(contract?.standard_template_id)?.id || '');
  const [maturity, setMaturity] = useState<MaturityKind | ''>(() => (contract ? maturityOf(contract) : '') || '');
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    STUDIO_LINK_BLOCKS.forEach((b) => { init[b.key] = b.open; });
    return init;
  });
  useEffect(() => {
    setPickId(findTemplate(contract?.standard_template_id)?.id || '');
    setMaturity((contract ? maturityOf(contract) : '') || '');
  }, [contract?.contract_code, contract?.contract_kind, contract?.standard_template_id, contract?.esign_maturity]);
  const tpl = options.find((t) => t.id === pickId) || null;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast('계약서 링크를 복사했습니다. 손님에게 보내세요.', 'ok');
    } catch {
      toast('복사에 실패했습니다. 링크를 길게 눌러 직접 복사하세요.', 'error');
    }
  };

  const filledHint = issued ? null : 0;
  const totalHint = STUDIO_LINK_BLOCKS.reduce((n, b) => n + b.count, 0);

  return (
    <PaneStack>
      {/* 스튜디오 ② 순서: 계약서 저장 → 서명 링크 → 연동 데이터 */}
      <SectionLabel>계약서 저장 (손님 미리보기)</SectionLabel>
      <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.5 }}>
        서명 전에 손님이 종이 계약서를 달라고 하면, 값만 채운 초안 A4를 저장해 전달합니다.
        서명은 아직 없는 초안입니다.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Btn
          title="계약서 저장"
          onClick={() => { if (code) void openDraftPreview(code, true); }}
          disabled={!issued}
        >
          계약서 저장
        </Btn>
        <Btn
          title="미리보기"
          variant="ghost"
          onClick={() => { if (code) void openDraftPreview(code, false); }}
          disabled={!issued}
        >
          미리보기
        </Btn>
      </div>

      <SectionLabel>서명 링크</SectionLabel>
      {link ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: FS.cap, color: C.mute, wordBreak: 'break-all', fontWeight: FW.strong }}>{link}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Btn title="링크 복사" onClick={copy}>링크 복사</Btn>
            <Btn title="열어보기" variant="ghost" onClick={() => window.open(link, '_blank', 'noreferrer')}>
              열어보기
            </Btn>
          </div>
          <div style={{ fontSize: FS.cap, color: C.mute }}>
            문자·카카오 자동 발송 없음. 링크를 복사해 전달합니다.
          </div>
        </div>
      ) : (
        <div style={{ fontSize: FS.cap, color: C.faint }}>서명 링크가 아직 없습니다.</div>
      )}

      <SectionLabel>
        연동 데이터 ({filledHint == null ? '…' : filledHint}/{totalHint})
      </SectionLabel>
      <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.5 }}>
        계약 때: <b>손님</b> · <b>대여료·보증금·기간(개월)·연령</b> · 차량 재고 확인.
        시작일·종료일·출고 시 주행거리는 <b>차량 출고(인도)</b> 때 확정됩니다.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Btn
          title="계약용만 열기"
          variant="ghost"
          onClick={() => {
            const next: Record<string, boolean> = {};
            STUDIO_LINK_BLOCKS.forEach((b) => {
              next[b.key] = b.key === 'every-guest' || b.key === 'deal-out' || b.key === 'stock-vehicle';
            });
            setSectionOpen(next);
          }}
        >
          계약용만 열기
        </Btn>
        <Btn
          title="모두 접기"
          variant="ghost"
          onClick={() => {
            const next: Record<string, boolean> = {};
            STUDIO_LINK_BLOCKS.forEach((b) => { next[b.key] = false; });
            setSectionOpen(next);
          }}
        >
          모두 접기
        </Btn>
        <Btn
          title="모두 펼치기"
          variant="ghost"
          onClick={() => {
            const next: Record<string, boolean> = {};
            STUDIO_LINK_BLOCKS.forEach((b) => { next[b.key] = true; });
            setSectionOpen(next);
          }}
        >
          모두 펼치기
        </Btn>
      </div>

      {issued && code ? (
        <IssuedLinkedData contractCode={code} />
      ) : (
        <div style={{ display: 'grid', gap: 6, maxHeight: 320, overflow: 'auto' }}>
          {STUDIO_LINK_BLOCKS.map((block) => {
            const open = sectionOpen[block.key] ?? block.open;
            return (
              <div key={block.key} style={{ borderTop: `1px solid ${C.line}`, paddingTop: 6 }}>
                <Btn
                  title={open ? '접기' : '펼치기'}
                  variant="ghost"
                  onClick={() => setSectionOpen((prev) => ({ ...prev, [block.key]: !open }))}
                >
                  {open ? '▾' : '▸'} {block.heading}
                  <span style={{ marginLeft: 8, color: C.mute, fontWeight: FW.strong }}>
                    {block.careLabel} · 0/{block.count}
                  </span>
                </Btn>
                {open ? (
                  <div style={{ fontSize: FS.cap, color: C.faint, padding: '4px 8px' }}>
                    {block.key === 'later-handover' ? '인도 시 확정' : '값 필요'}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* 발행은 스튜디오 ②에 없음 — 링크가 없을 때만 맨 아래 유지 */}
      {contract && !issued ? (
        <>
          <SectionLabel>서명 링크 만들기</SectionLabel>
          <div style={{ fontSize: FS.cap, color: C.mute }}>
            착한거래 스튜디오에는 없는 프리패스 발행 단계입니다. 만든 뒤 위 서명 링크·연동 데이터에 반영됩니다.
          </div>
          <TemplatePicker
            contract={contract}
            policy={policy}
            options={options}
            tpl={tpl}
            maturity={maturity}
            onPick={setPickId}
            onMaturity={setMaturity}
            onSent={onChanged}
          />
        </>
      ) : null}
    </PaneStack>
  );
}

/** 관리자 Bearer로 HTML을 받아 Blob URL로 연다 — API Key는 브라우저에 안 나간다. */
async function openDraftPreview(contractCode: string, save: boolean) {
  try {
    const user = getAuthClient()?.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');
    const response = await fetch(
      `/api/chakhandeal/contracts/${encodeURIComponent(contractCode)}/preview?save=${save ? '1' : '0'}`,
      { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || '계약서 초안을 열지 못했습니다.');
    }
    const html = await response.text();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const viewer = window.open(url, '_blank', 'noreferrer');
    if (!viewer) {
      URL.revokeObjectURL(url);
      throw new Error('팝업이 차단되었습니다. 팝업을 허용해 주세요.');
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (error) {
    toast(error instanceof Error ? error.message : '계약서 초안을 열지 못했습니다.', 'error');
  }
}

type LinkedSection = { no: string; title: string; fields: string[] };

function IssuedLinkedData({ contractCode }: { contractCode: string }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [sections, setSections] = useState<LinkedSection[]>([]);
  const [filled, setFilled] = useState(0);
  const [total, setTotal] = useState(0);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!contractCode) return;
    setLoading(true);
    setErr('');
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인이 필요합니다.');
      const response = await fetch(
        `/api/chakhandeal/contracts/${encodeURIComponent(contractCode)}/template-fields`,
        { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' },
      );
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        fields?: Record<string, string>;
        labels?: Record<string, string>;
        sections?: LinkedSection[];
        filledCount?: number;
        totalCount?: number;
      };
      if (!response.ok) throw new Error(body.error || '연동 데이터를 불러오지 못했습니다.');
      const nextFields = body.fields && typeof body.fields === 'object' ? body.fields : {};
      const nextSections = Array.isArray(body.sections) ? body.sections : [];
      setFields(nextFields);
      setLabels(body.labels && typeof body.labels === 'object' ? body.labels : {});
      setSections(nextSections);
      setFilled(Number(body.filledCount) || Object.values(nextFields).filter(Boolean).length);
      setTotal(Number(body.totalCount) || Object.keys(nextFields).length);
      const initial: Record<string, boolean> = {};
      nextSections.forEach((sec, i) => {
        const key = `${sec.no}:${sec.title}` || String(i);
        const hasValue = sec.fields.some((f) => nextFields[f]);
        initial[key] = hasValue;
      });
      setOpenMap(initial);
    } catch (error) {
      setErr(error instanceof Error ? error.message : '연동 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [contractCode]);

  useEffect(() => { void load(); }, [load]);

  const sectionKeys = sections.map((sec, i) => `${sec.no}:${sec.title}` || String(i));

  return (
    <>
      {err ? <Badge tone="red" variant="solid">{err}</Badge> : null}
      {loading ? (
        <div style={{ fontSize: FS.cap, color: C.mute }}>발행 스냅샷 불러오는 중…</div>
      ) : (
        <div style={{ display: 'grid', gap: 8, maxHeight: 360, overflow: 'auto' }}>
          {sections.length ? sections.map((sec, i) => {
              const key = sectionKeys[i];
              const open = openMap[key] ?? false;
              const filledIn = sec.fields.filter((f) => fields[f]).length;
              return (
                <div key={key} style={{ borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
                  <Btn
                    title={open ? '접기' : '펼치기'}
                    variant="ghost"
                    onClick={() => setOpenMap((prev) => ({ ...prev, [key]: !open }))}
                  >
                    {open ? '▾' : '▸'} {sec.title} · {filledIn}/{sec.fields.length}
                  </Btn>
                  {open ? (
                    <ListGroup>
                      {sec.fields.map((field) => (
                        <DetailRow
                          key={field}
                          label={labels[field] || field}
                          value={fields[field] || '—'}
                          valueColor={fields[field] ? undefined : C.faint}
                          stacked
                        />
                      ))}
                    </ListGroup>
                  ) : null}
                </div>
              );
            }) : (
            <ListGroup>
              {Object.entries(fields).slice(0, 40).map(([field, value]) => (
                <DetailRow key={field} label={labels[field] || field} value={value || '—'} stacked />
              ))}
            </ListGroup>
          )}
          <div style={{ fontSize: FS.cap, color: C.mute }}>발행 스냅샷 {filled}/{total || '—'} · 읽기 전용</div>
        </div>
      )}
    </>
  );
}

function TemplatePicker({
  contract, policy, options, tpl, maturity, onPick, onMaturity, onSent,
}: {
  contract: EntityRecord;
  policy: EntityRecord | null;
  options: EsignTemplate[];
  tpl: EsignTemplate | null;
  maturity: MaturityKind | '';
  onPick: (id: string) => void;
  onMaturity: (value: MaturityKind) => void;
  onSent: () => void | Promise<void>;
}) {
  const provider = S(contract.provider_company_code);
  const spec = tpl && maturity ? contractKindFor(tpl, maturity) : null;
  const selectionError = tpl && spec ? standardTemplateSelectionError(tpl, spec, policy) : '';
  const [fieldPatch, setFieldPatch] = useState<Record<string, string>>({});
  return (
    <>
      <SectionLabel>프리패스 표준계약서 종류</SectionLabel>
      <div style={{ fontSize: FS.cap, color: C.mute }}>
        렌트 / 구독·보험포함 / 구독·보험별도 중 하나를 관리자가 확정합니다.
        {provider ? <> <b>{provider}</b> 전용 승인판이 있으면 같은 표준계약서를 기준으로 서버가 자동 적용합니다.</> : null}
      </div>
      <FilterChips
        options={options.map((t) => ({ key: t.id, label: t.label }))}
        value={tpl?.id || ''}
        onChange={onPick}
      />

      <SectionLabel>만기 선택</SectionLabel>
      <FilterChips
        options={[
          { key: '반납형', label: '반납' },
          { key: '인수형', label: '인수' },
        ]}
        value={maturity}
        onChange={(value) => onMaturity(value as MaturityKind)}
      />

      <TemplateFieldsEditor
        contractCode={S(contract.contract_code)}
        onPatchChange={setFieldPatch}
      />

      {tpl && spec ? (
        <>
          <ListGroup>
            <DetailRow label="확정 계약서" value={tpl.label} />
            <DetailRow label="만기 선택" value={maturity === '인수형' ? '인수' : '반납'} />
            <DetailRow label="보험" value={tpl.insuranceSide === '고객직접' ? '보험별도' : '보험포함'} />
            <DetailRow label="비고" value={tpl.note} stacked />
          </ListGroup>
          {tpl.isSample || SAMPLE_AGREEMENT.isSample ? (
            <Badge tone="amber" variant="solid">«{tpl.version}» 샘플 — 공급사 정본·법률 검토 전</Badge>
          ) : null}
          {selectionError ? <Badge tone="red" variant="solid">{selectionError}</Badge> : null}
          <div style={{ fontSize: FS.cap, color: C.mute }}>
            외부 데이터 + 위 직접 입력이 A4 칸(templateFields)으로 발행됩니다.
            문자·카카오는 보내지 않습니다 — 서명 링크를 만든 뒤 복사해 전달하세요.
          </div>
          {!selectionError ? (
            <ChakhandealEsignButton
              contractCode={S(contract.contract_code)}
              standardTemplateId={tpl.id}
              contractKind={spec.key}
              templateFields={fieldPatch}
              label="이 조합으로 계약서 확정"
              onSent={onSent}
            />
          ) : null}
        </>
      ) : (
        <Badge tone="amber" variant="solid">관리자가 계약서 종류와 인수/반납을 모두 선택해 주세요.</Badge>
      )}
    </>
  );
}

type FieldRow = { field: string; label: string; from: string; value: string };

function TemplateFieldsEditor({
  contractCode,
  onPatchChange,
}: {
  contractCode: string;
  onPatchChange: (patch: Record<string, string>) => void;
}) {
  const [rows, setRows] = useState<FieldRow[] | null>(null);
  const [emptyCount, setEmptyCount] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!contractCode) return;
    setErr('');
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인이 필요합니다.');
      const response = await fetch(
        `/api/chakhandeal/contracts/${encodeURIComponent(contractCode)}/template-fields`,
        { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' },
      );
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        rows?: FieldRow[];
        emptyCount?: number;
      };
      if (!response.ok) throw new Error(body.error || '칸 값을 불러오지 못했습니다.');
      setRows(Array.isArray(body.rows) ? body.rows : []);
      setEmptyCount(Number(body.emptyCount) || 0);
      setDraft({});
      onPatchChange({});
    } catch (error) {
      setErr(error instanceof Error ? error.message : '칸 값을 불러오지 못했습니다.');
      setRows([]);
    }
  }, [contractCode, onPatchChange]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (busy || !Object.keys(draft).length) return;
    setBusy(true);
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인이 필요합니다.');
      const response = await fetch(
        `/api/chakhandeal/contracts/${encodeURIComponent(contractCode)}/template-fields`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${await user.getIdToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ templateFields: draft }),
          cache: 'no-store',
        },
      );
      const body = await response.json().catch(() => ({})) as { error?: string; rows?: FieldRow[]; emptyCount?: number };
      if (!response.ok) throw new Error(body.error || '저장 실패');
      setRows(Array.isArray(body.rows) ? body.rows : []);
      setEmptyCount(Number(body.emptyCount) || 0);
      setDraft({});
      onPatchChange({});
      toast('계약서 칸 직접 입력을 저장했습니다.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '저장에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const visible = (rows || []).filter((r) => showAll || !r.value || draft[r.field] !== undefined);
  const setVal = (field: string, value: string) => {
    const next = { ...draft, [field]: value };
    if (!value) delete next[field];
    setDraft(next);
    onPatchChange(next);
  };

  return (
    <>
      <SectionLabel>착한거래 전송값 검증 (외부 + 직접 입력)</SectionLabel>
      <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.5 }}>
        착한거래 커스텀 양식의 칸에, 계약·정책·파트너 값을 넣고 빈 칸만 직접 보완합니다.
        {emptyCount ? <> 지금 빈 칸 <b>{emptyCount}</b>개.</> : null}
      </div>
      {err ? <Badge tone="red" variant="solid">{err}</Badge> : null}
      {rows === null ? (
        <div style={{ fontSize: FS.cap, color: C.mute }}>칸 불러오는 중…</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <Btn title={showAll ? '빈 칸만' : '전체 보기'} variant="ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? '빈 칸만' : '채운 칸도 보기'}
            </Btn>
            <Btn title="다시 불러오기" variant="ghost" onClick={() => { void load(); }}>새로고침</Btn>
            <Btn title="직접 입력 저장" onClick={() => { void save(); }} disabled={busy || !Object.keys(draft).length}>
              {busy ? '저장 중…' : '직접 입력 저장'}
            </Btn>
          </div>
          <div style={{ display: 'grid', gap: 8, maxHeight: 280, overflow: 'auto' }}>
            {visible.slice(0, showAll ? 80 : 40).map((r) => (
              <label key={r.field} style={{ display: 'grid', gap: 2, fontSize: FS.cap }}>
                <span style={{ color: C.mute }}>{r.label} · {r.from} · <code>{r.field}</code></span>
                <Input
                  value={draft[r.field] !== undefined ? draft[r.field] : r.value}
                  onChange={(value) => setVal(r.field, value)}
                  placeholder={r.value ? undefined : '직접 입력'}
                  ariaLabel={`${r.label} 직접 입력`}
                  full
                  style={{
                    background: r.value && draft[r.field] === undefined ? C.bg : C.taupeBg,
                  }}
                />
              </label>
            ))}
            {!visible.length ? (
              <div style={{ fontSize: FS.cap, color: C.mute }}>비어 있는 편집 칸이 없습니다.</div>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}

/* ─────────────── ④ = 착한거래 스튜디오 ③ 진행상황 ─────────────── */

/** 「2026-08-08 14:32」 — 단계 통과 시각. 없으면 빈 문자열. */
function stamp(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 스튜디오 guestStepDone 축에 가깝게 — 프리패스 consents 키를 손님 여정에 매핑. */
function guestDoneKeys(contract: EntityRecord | null): { done: number; current: string | null; signed: boolean } {
  const total = GUEST_FLOW_STEPS.length;
  if (!contract || !isEsignIssued(contract)) return { done: 0, current: null, signed: false };
  const c = consentKeys(contract.sign_consents);
  const signed = esignStage(contract).state === '서명완료' || c.has('signed');
  if (signed) return { done: total, current: null, signed: true };
  const checks = [
    c.has('identity_verified') || c.has('identity') || Number(contract.sign_opened_at) > 0, // summary≈열람
    c.has('identity_verified') || [...c].some((k) => k.startsWith('ack:')),
    c.has('identity_verified'),
    c.has('identity') && c.has('vehicle') && c.has('rental'),
    c.has('agreement'),
    c.has('cautions') || c.has('documents'),
    c.has('documents'),
    false,
  ];
  let done = 0;
  for (const ok of checks) {
    if (!ok) break;
    done += 1;
  }
  return {
    done,
    current: GUEST_FLOW_STEPS[Math.min(done, total - 1)]?.key || null,
    signed: false,
  };
}

function ProgressPane({
  contract,
  onRefresh,
}: {
  contract: EntityRecord | null;
  onRefresh: () => void | Promise<void>;
}) {
  const issued = contract ? isEsignIssued(contract) : false;
  const guest = guestDoneKeys(contract);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const signUrl = contract ? S(contract.esign_sign_url) : '';

  const refresh = async () => {
    if (syncBusy || !contract) return;
    setSyncBusy(true);
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인이 필요합니다.');
      const code = S(contract.contract_code);
      const response = await fetch('/api/chakhandeal/contracts/status', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contractCodes: [code] }),
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        results?: Array<{ ok?: boolean; error?: string }>;
      };
      if (!response.ok) throw new Error(body.error || '착한거래 진행상태를 가져오지 못했습니다.');
      const result = body.results?.[0];
      if (!result?.ok) throw new Error(result?.error || '착한거래 진행상태를 가져오지 못했습니다.');
      await onRefresh();
      toast('착한거래 진행상태를 다시 가져왔습니다.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '착한거래 진행상태를 가져오지 못했습니다.', 'error');
    } finally {
      setSyncBusy(false);
    }
  };

  const openPdf = async () => {
    if (pdfBusy || !contract) return;
    const viewer = window.open('about:blank', '_blank');
    if (viewer) viewer.opener = null;
    setPdfBusy(true);
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인이 필요합니다.');
      const code = S(contract.contract_code);
      const response = await fetch(`/api/chakhandeal/contracts/${encodeURIComponent(code)}/document`, {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || '계약서 PDF를 열지 못했습니다.');
      }
      const url = URL.createObjectURL(await response.blob());
      if (viewer) viewer.location.replace(url);
      else window.location.assign(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      viewer?.close();
      toast(error instanceof Error ? error.message : '계약서 PDF를 열지 못했습니다.', 'error');
    } finally {
      setPdfBusy(false);
    }
  };

  const nowLabel = guest.signed
    ? '서명 완료'
    : !issued
      ? '시작 전'
      : (GUEST_FLOW_STEPS.find((s) => s.key === guest.current)?.label || '시작 전');

  return (
    <PaneStack>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Btn
          title="새로고침"
          variant="ghost"
          onClick={() => { void refresh(); }}
          disabled={syncBusy || !issued}
        >
          <ButtonLabel icon={<RefreshCw size={ICON.md} aria-hidden />}>
            {syncBusy ? '동기화 중…' : '새로고침'}
          </ButtonLabel>
        </Btn>
        {issued && signUrl ? (
          <Btn title="열어보기" variant="ghost" onClick={() => window.open(signUrl, '_blank', 'noreferrer')}>
            <ButtonLabel icon={<ExternalLink size={ICON.md} aria-hidden />}>열어보기</ButtonLabel>
          </Btn>
        ) : null}
      </div>

      <SectionLabel>지금</SectionLabel>
      <div style={{ fontSize: FS.body, fontWeight: FW.strong }}>
        {nowLabel}
        <span style={{ marginLeft: 8, fontSize: FS.cap, color: C.mute }}>
          {guest.done}/{GUEST_FLOW_STEPS.length}
        </span>
      </div>

      <ListGroup>
        {GUEST_FLOW_STEPS.map((step, i) => {
          const done = guest.signed || i < guest.done;
          const here = !guest.signed && issued && i === guest.done;
          let at = '';
          if (contract) {
            if (step.key === 'identity') at = stamp(consentAt(contract.sign_consents, 'identity_verified'));
            else if (step.key === 'terms') at = stamp(consentAt(contract.sign_consents, 'agreement'));
            else if (step.key === 'docs') at = stamp(consentAt(contract.sign_consents, 'documents'));
            else if (step.key === 'sign' && guest.signed) at = stamp(Number(contract.sign_signed_at) || 0);
            else if (step.key === 'summary') at = stamp(Number(contract.sign_opened_at) || 0);
          }
          return (
            <DetailRow
              key={step.key}
              label={step.label}
              value={done ? (at || '완료') : here ? '지금' : '—'}
              valueColor={done ? C.ok : here ? C.warn : C.faint}
            />
          );
        })}
      </ListGroup>

      {contract && issued ? (
        <SupplementBlock contract={contract} signed={guest.signed} onDone={onRefresh} />
      ) : (
        <SupplementSkeleton disabled />
      )}

      <SectionLabel>계약 완료 PDF</SectionLabel>
      {guest.signed && contract && S(contract.esign_document_sha256) ? (
        <Btn title="완료 PDF 열기" onClick={openPdf} disabled={pdfBusy}>
          {pdfBusy ? 'PDF 여는 중…' : '완료 PDF 열기'}
        </Btn>
      ) : guest.signed ? (
        <div style={{ fontSize: FS.cap, color: C.faint }}>서명은 끝났고 PDF 봉인 준비 중입니다…</div>
      ) : (
        <div style={{ fontSize: FS.cap, color: C.faint }}>
          손님이 서명 링크에서 진행하면 여기가 갱신됩니다.
        </div>
      )}

      <HandoverBlock
        contract={contract}
        signed={guest.signed}
        onDone={onRefresh}
      />
    </PaneStack>
  );
}

function HandoverBlock({
  contract,
  signed,
  onDone,
}: {
  contract: EntityRecord | null;
  signed: boolean;
  onDone: () => void | Promise<void>;
}) {
  const saved = contract?.esign_handover && typeof contract.esign_handover === 'object'
    ? (contract.esign_handover as Record<string, unknown>)
    : null;
  const savedDate = S(saved?.handover_datetime).slice(0, 10);
  const [date, setDate] = useState(savedDate);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDate(savedDate); }, [savedDate, contract?.contract_code]);

  const enabled = !!(contract && signed);
  const start = S(saved?.contract_start);
  const end = S(saved?.contract_end);

  const save = async () => {
    if (!enabled || busy || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setBusy(true);
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인이 필요합니다.');
      const code = S(contract!.contract_code);
      const response = await fetch(
        `/api/chakhandeal/contracts/${encodeURIComponent(code)}/handover`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await user.getIdToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ handover_datetime: date }),
          cache: 'no-store',
        },
      );
      const body = await response.json().catch(() => ({})) as { error?: string; ok?: boolean };
      if (!response.ok || !body.ok) throw new Error(body.error || '인도일을 저장하지 못했습니다.');
      await onDone();
      toast('인도일을 확정했습니다.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '인도일을 저장하지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionLabel>인도일 보완</SectionLabel>
      <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.5, marginBottom: 6 }}>
        계약이 끝난 뒤, <b>차를 받은 날</b>만 적습니다.
        그 날이 계약 시작일이 되고, 대여 기간(개월)으로 종료일이 정해집니다.
      </div>
      {savedDate ? (
        <div style={{ fontSize: FS.cap, fontWeight: FW.strong, marginBottom: 6, wordBreak: 'break-all' }}>
          인도일 {savedDate}
          {start ? ` · ${start} ~ ${end}` : ''}
        </div>
      ) : (
        <div style={{ fontSize: FS.cap, color: C.faint, marginBottom: 6 }}>
          {enabled ? '아직 인도일 없음 · 보완 필요' : '서명 완료 후 입력합니다.'}
        </div>
      )}
      <Input
        type="date"
        value={date}
        onChange={setDate}
        ariaLabel="차량 인도일"
        disabled={!enabled}
        full
      />
      <div style={{ marginTop: 8 }}>
        <Btn
          title={savedDate ? '인도일 다시 확정' : '인도일 확정'}
          onClick={() => { void save(); }}
          disabled={!enabled || busy || !/^\d{4}-\d{2}-\d{2}$/.test(date)}
        >
          {busy ? '저장 중…' : savedDate ? '인도일 다시 확정' : '인도일 확정'}
        </Btn>
      </div>
    </>
  );
}

function SupplementSkeleton({ disabled }: { disabled?: boolean }) {
  return (
    <>
      <SectionLabel>보완 링크</SectionLabel>
      <div style={{ fontSize: FS.cap, color: C.mute, marginBottom: 6 }}>
        빠진·흐린 단계만 다시 받게 합니다. 손님 여정과 같은 단계입니다.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {FIXABLE_STEPS.map((step) => (
          <Btn key={step.key} title={step.label} variant="ghost" disabled={disabled} onClick={() => {}}>
            {step.label}
          </Btn>
        ))}
      </div>
      <Textarea
        value=""
        onChange={() => {}}
        placeholder="사유 (예: 신분증 글자가 흐려 확인이 어렵습니다)"
        ariaLabel="보완 사유"
        rows={2}
        full
        disabled={disabled}
      />
      <div style={{ marginTop: 8 }}>
        <Btn title="보완 링크 만들기" disabled>보완 링크 만들기</Btn>
      </div>
      <SectionLabel>보완 이력</SectionLabel>
      <div style={{ fontSize: FS.cap, color: C.faint }}>아직 보완 요청이 없습니다.</div>
    </>
  );
}

type SupplementRow = { items?: string[]; message?: string; requestedAt?: number | null };

function SupplementBlock({
  contract,
  signed,
  onDone,
}: {
  contract: EntityRecord;
  signed: boolean;
  onDone: () => void | Promise<void>;
}) {
  const selectable = signed
    ? FIXABLE_STEPS.filter((s) => s.fixKey === 'identity_verified' || s.fixKey === 'documents')
    : [...FIXABLE_STEPS];
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');

  const history: SupplementRow[] = Array.isArray(contract.esign_supplements)
    ? (contract.esign_supplements as SupplementRow[])
    : [];

  const toggle = (fixKey: string) => {
    setPicked((prev) => (prev.includes(fixKey) ? prev.filter((k) => k !== fixKey) : [...prev, fixKey]));
  };

  const create = async () => {
    if (busy || !picked.length) return;
    setBusy(true);
    try {
      const user = getAuthClient()?.currentUser;
      if (!user) throw new Error('로그인이 필요합니다.');
      const code = S(contract.contract_code);
      const response = await fetch(
        `/api/chakhandeal/contracts/${encodeURIComponent(code)}/supplement`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await user.getIdToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ items: picked, message }),
          cache: 'no-store',
        },
      );
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        ok?: boolean;
        supplementUrl?: string;
      };
      if (!response.ok || !body.ok) throw new Error(body.error || '보완 링크를 만들지 못했습니다.');
      setLink(S(body.supplementUrl));
      setPicked([]);
      setMessage('');
      await onDone();
      toast('보완 링크를 만들었습니다.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '보완 링크를 만들지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionLabel>보완 링크</SectionLabel>
      <div style={{ fontSize: FS.cap, color: C.mute, marginBottom: 6 }}>
        빠진·흐린 단계만 다시 받게 합니다. 손님 여정과 같은 단계입니다.
        {signed ? ' 서명 후에는 본인확인·첨부서류만 가능합니다.' : ''}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {selectable.map((step) => {
          const fixKey = step.fixKey || step.key;
          const on = picked.includes(fixKey);
          return (
            <Btn
              key={step.key}
              title={step.label}
              variant={on ? undefined : 'ghost'}
              onClick={() => toggle(fixKey)}
            >
              {on ? `✓ ${step.label}` : step.label}
            </Btn>
          );
        })}
      </div>
      <Textarea
        value={message}
        onChange={setMessage}
        placeholder="사유 (예: 신분증 글자가 흐려 확인이 어렵습니다)"
        ariaLabel="보완 사유"
        rows={2}
        full
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <Btn title="보완 링크 만들기" onClick={() => { void create(); }} disabled={busy || !picked.length}>
          {busy ? '만드는 중…' : '보완 링크 만들기'}
        </Btn>
        {link ? (
          <>
            <Btn title="보완 링크 복사" variant="ghost" onClick={() => { void navigator.clipboard.writeText(link); }}>
              보완 링크 복사
            </Btn>
            <Btn title="열어보기" variant="ghost" onClick={() => window.open(link, '_blank', 'noreferrer')}>
              열어보기
            </Btn>
          </>
        ) : null}
      </div>
      <SectionLabel>보완 이력</SectionLabel>
      {history.length ? (
        <ListGroup>
          {[...history].reverse().slice(0, 3).map((row, i) => (
            <DetailRow
              key={`${row.requestedAt || 0}-${i}`}
              label={stamp(Number(row.requestedAt) || 0) || `요청 ${i + 1}`}
              value={`${(row.items || []).join(' · ') || '—'}${row.message ? ` · ${row.message}` : ''}`}
              stacked
            />
          ))}
        </ListGroup>
      ) : (
        <div style={{ fontSize: FS.cap, color: C.faint }}>아직 보완 요청이 없습니다.</div>
      )}
    </>
  );
}
