'use client';

/**
 * 계약서관리 — **관리자 전용.** 4패널.
 *
 *   ① 목록          보낼 대상 계약(약정에서 기간·금액이 굳은 것)
 *   ② 프리패스 데이터  계약서에 들어갈 값 — 손님·계약조건·보험·상품/정책
 *   ③ 착한거래 연동   공급사 양식 고르고 → 계약서 만들고 → 링크 복사
 *   ④ 진행단계       손님이 서명 링크에서 어디까지 갔나
 *
 * ★역할 분담(2026-08-08 사장님)
 *   **프리패스는 계약서에 들어갈 데이터만 구성한다.** 계약서·발송·서명은 착한거래 몫이다.
 *   그래서 ②는 우리 데이터, ③은 넘기는 창구, ④는 되받는 상태다.
 *
 * ★데이터가 세 곳에서 온다
 *   손님·계약조건 = 계약 / 상품정보 = 재고관리 / 보험·연령·심사 = 정책관리.
 *   정책을 안 붙이면 손님 계약서의 보험 칸이 통째로 빈다(`resolveContractSources`).
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
import { EsignListRow } from '@/components/list-rows';
import { ChakhandealEsignButton } from '@/components/ChakhandealEsignButton';
import { toast } from '@/components/Toaster';
import {
  Badge, Btn, ButtonLabel, C, CenterNote, DetailRow, FS, FW, FilterChips, ICON, ListGroup,
  Loading, PaneBody, PaneHead, SectionLabel,
} from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { Copy, ExternalLink, Database, FileSignature, ListChecks } from 'lucide-react';
import {
  ESIGN_FILTERS, ESIGN_STEPS, compareEsign, consentAt, consentKeys, esignDocuments,
  esignIdentityShots, esignStage, isEsignIssued, matchesEsignFilter, type EsignFilter,
} from '@/lib/domain/esign-progress';
import {
  defaultTemplateFor, sentTemplateOf, templatesForContract, type EsignTemplate,
} from '@/lib/domain/esign-templates';
import {
  REQUIRED_DOCS, SAMPLE_AGREEMENT, buildConsentGroups, resolveContractSources,
} from '@/lib/domain/esign-consent-doc';
import { contractVehicleLabel } from '@/lib/domain/vehicle-label';
import { hasTermFrozen, isContractCancelled } from '@/lib/domain/contract';
import { contractHaystack, matchHay } from '@/lib/domain/search';

const S = (v: unknown) => String(v ?? '').trim();

async function syncChakhandealRows(rows: EntityRecord[]): Promise<Map<string, EntityRecord>> {
  const targets = rows
    .filter((row) => S(row.esign_id) && !['서명완료', '만료', '반려'].includes(S(row.sign_status)))
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
  const co = getCompanyId();
  const router = useRouter();
  const mobile = useIsMobile();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [products, setProducts] = useState<EntityRecord[]>([]);
  const [policies, setPolicies] = useState<EntityRecord[]>([]);
  const [filter, setFilter] = useState<EsignFilter>('전체');
  const [query, setQuery] = useState('');
  const [selKey, setSelKey] = useState('');

  const load = useCallback(async () => {
    try {
      const [list, prods, pols] = await Promise.all([
        getStore().list('contract', co),
        getStore().list('product', co).catch(() => [] as EntityRecord[]),
        getStore().list('policy', co).catch(() => [] as EntityRecord[]),
      ]);
      setProducts(prods);
      setPolicies(pols);
      const synced = await syncChakhandealRows(list);
      const current = list.map((row) => ({ ...row, ...(synced.get(S(row.contract_code)) || {}) }));
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
    () => (rows || []).find((c) => S(c.contract_code) === selKey) || null,
    [rows, selKey],
  );
  const sources = useMemo(
    () => (sel ? resolveContractSources(sel, products, policies) : { product: null, policy: null }),
    [sel, products, policies],
  );
  const attention = useMemo(
    () => (rows || []).filter((c) => ['반려', '만료'].includes(esignStage(c).state)).length,
    [rows],
  );
  // 패널 머리의 건수 — 「몇 개 묶음이 나가나」. 값 없는 묶음은 빠지므로 이 수가 곧 손님이 볼 화면 수다.
  const groupCount = useMemo(
    () => (sel ? buildConsentGroups(sel, sources.policy).filter((g) => g.rows.length).length : 0),
    [sel, sources.policy],
  );

  if (allowed === null) return <Loading />;

  const listEl = rows === null ? <Loading /> : shown.length === 0 ? (
    <CenterNote>
      {query || filter !== '전체'
        ? '조건에 맞는 계약이 없습니다.'
        : '약정에서 대여기간·금액을 확정한 계약이 아직 없습니다.'}
    </CenterNote>
  ) : (
    <ListGroup>
      {shown.map((c) => (
        <EsignListRow
          key={S(c.contract_code)}
          contract={c}
          stage={esignStage(c)}
          selected={S(c.contract_code) === selKey}
          onClick={() => setSelKey(S(c.contract_code))}
        />
      ))}
    </ListGroup>
  );

  // 패널 골격은 다른 업무화면과 같게 — 웹은 PaneHead(제목) + PaneBody pad, 모바일은 헤더 생략.
  const shell = (title: string, count: React.ReactNode, body: React.ReactNode) => (
    <>
      {!mobile && <PaneHead title={title} count={count} />}
      <PaneBody pad>{body}</PaneBody>
    </>
  );
  const empty = (title: string, text: string) => shell(title, undefined, <CenterNote>{text}</CenterNote>);

  // 패널은 **항상** 셋 다 띄운다 — 비었을 때 빼면 목록이 flex 를 다 먹어 4등분이 무너진다.
  const panes: WorkPane[] = [
    {
      key: 'data',
      title: '프리패스 데이터',
      icon: Database,
      node: sel
        ? shell('프리패스 데이터', groupCount, <DataPane contract={sel} product={sources.product} policy={sources.policy} />)
        : empty('프리패스 데이터', '계약을 고르면 계약서에 들어갈 데이터를 보여줍니다.'),
    },
    {
      key: 'chakhandeal',
      title: '착한거래 연동',
      icon: FileSignature,
      node: sel
        ? shell('착한거래 연동', undefined, <ChakhandealPane key={S(sel.contract_code)} contract={sel} onChanged={load} />)
        : empty('착한거래 연동', '계약을 고르면 여기서 계약서를 만들고 링크를 복사합니다.'),
    },
    {
      key: 'progress',
      title: '진행단계',
      icon: ListChecks,
      node: sel
        ? shell('진행단계', `${esignStage(sel).done}/${esignStage(sel).total}`, <ProgressPane contract={sel} />)
        : empty('진행단계', '계약을 고르면 손님이 어디까지 갔는지 보여줍니다.'),
    },
  ];

  return (
    <WorkPage
      title={NAV_LABEL.esign}
      statusLabel={NAV_LABEL.esign}
      statusCount={rows === null ? null : rows.length}
      listCount={rows === null ? null : shown.length}
      attentionLabel="확인 필요"
      attentionCount={attention || undefined}
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
      selected={!!sel}
      onBack={() => setSelKey('')}
    />
  );
}

/* ─────────────── ② 프리패스 데이터 ─────────────── */

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
  return (
    <PaneStack>
        {!policy ? (
          <Badge tone="red" variant="solid">정책이 연결되지 않아 보험 조건이 빕니다 — 정책관리 확인</Badge>
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

/* ─────────────── ③ 착한거래 연동 ─────────────── */

function ChakhandealPane({ contract, onChanged }: { contract: EntityRecord; onChanged: () => void | Promise<void> }) {
  const issued = isEsignIssued(contract);
  const options = useMemo(() => templatesForContract(contract), [contract]);
  const [pickId, setPickId] = useState(() => defaultTemplateFor(contract).id);
  const tpl = options.find((t) => t.id === pickId) || options[0];
  const sentTpl = sentTemplateOf(contract);
  const link = S(contract.esign_sign_url);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast('계약서 링크를 복사했습니다. 손님에게 보내세요.', 'ok');
    } catch {
      toast('복사에 실패했습니다. 링크를 길게 눌러 직접 복사하세요.', 'error');
    }
  };

  return (
    <PaneStack>
      {issued ? (
          <>
            <SectionLabel>보낸 양식</SectionLabel>
            <ListGroup>
              <DetailRow label="계약서 양식" value={sentTpl ? sentTpl.label : '기록 없음'} valueColor={sentTpl ? undefined : C.danger} />
              <DetailRow label="판" value={S(contract.esign_template_version) || sentTpl?.version || '—'} />
            </ListGroup>

            <SectionLabel>계약서 링크</SectionLabel>
            {link ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: FS.cap, color: C.mute, wordBreak: 'break-all', fontWeight: FW.strong }}>{link}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Btn title="링크 복사" onClick={copy}>
                    <ButtonLabel icon={<Copy size={ICON.md} aria-hidden />}>링크 복사</ButtonLabel>
                  </Btn>
                  <Btn title="링크 열기" onClick={() => window.open(link, '_blank', 'noreferrer')}>
                    <ButtonLabel icon={<ExternalLink size={ICON.md} aria-hidden />}>열어보기</ButtonLabel>
                  </Btn>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: FS.cap, color: C.danger }}>
                발행은 됐는데 링크가 저장되지 않았습니다. 착한거래 응답을 확인하세요.
              </div>
          )}
        </>
      ) : (
        <TemplatePicker contract={contract} options={options} tpl={tpl} onPick={setPickId} onSent={onChanged} />
      )}
    </PaneStack>
  );
}

function TemplatePicker({
  contract, options, tpl, onPick, onSent,
}: {
  contract: EntityRecord;
  options: EsignTemplate[];
  tpl: EsignTemplate;
  onPick: (id: string) => void;
  onSent: () => void | Promise<void>;
}) {
  const provider = S(contract.provider_company_code);
  return (
    <>
      <SectionLabel>계약서 양식</SectionLabel>
      <div style={{ fontSize: FS.cap, color: C.mute }}>
        {provider
          ? <>공급사 <b>{provider}</b> 와 협의된 양식과 표준 양식만 고를 수 있습니다.</>
          : <>공급사가 지정되지 않아 표준 양식만 쓸 수 있습니다.</>}
      </div>
      {/* 단일 선택 = 공용 칩 원자. raw <input type="radio"> 는 UI 계약 위반이다(check:ui). */}
      <FilterChips
        options={options.map((t) => ({ key: t.id, label: t.label }))}
        value={tpl.id}
        onChange={onPick}
        clearKey={tpl.id}
      />
      <ListGroup>
        <DetailRow label="판" value={tpl.version} />
        <DetailRow label="비고" value={tpl.note} stacked />
      </ListGroup>
      {tpl.isSample || SAMPLE_AGREEMENT.isSample ? (
        <Badge tone="amber" variant="solid">«{tpl.version}» 샘플 — 공급사 정본·법률 검토 전</Badge>
      ) : null}
      <div style={{ fontSize: FS.cap, color: C.mute }}>
        만들면 착한거래에 계약서가 생기고 링크가 나옵니다. 그 링크를 복사해 손님에게 보내세요.
      </div>
      <ChakhandealEsignButton
        contractCode={S(contract.contract_code)}
        templateId={tpl.id}
        label="계약서 만들기"
        onSent={onSent}
      />
    </>
  );
}

/* ─────────────── ④ 진행단계 ─────────────── */

/** 「2026-08-08 14:32」 — 단계 통과 시각. 없으면 빈 문자열. */
function stamp(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ProgressPane({ contract }: { contract: EntityRecord }) {
  const stage = esignStage(contract);
  const passed = consentKeys(contract.sign_consents);
  const docs = esignDocuments(contract);
  const shots = esignIdentityShots(contract);
  const issued = isEsignIssued(contract);
  const [pdfBusy, setPdfBusy] = useState(false);

  const openPdf = async () => {
    if (pdfBusy) return;
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

  return (
    <PaneStack>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Badge tone={stage.tone === 'green' ? 'green' : stage.tone === 'red' ? 'red' : stage.tone === 'amber' ? 'amber' : 'gray'} variant="solid">
            {stage.label}
          </Badge>
          {stage.state === '진행중' ? (
            <span style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.strong }}>{stage.done}/{stage.total} 단계</span>
          ) : null}
        </div>

        {stage.state === '서명완료' && S(contract.esign_document_sha256) ? (
          <Btn title="서명 완료 PDF 열기" onClick={openPdf} disabled={pdfBusy}>
            <ButtonLabel icon={<ExternalLink size={ICON.md} aria-hidden />}>
              {pdfBusy ? 'PDF 여는 중…' : '서명 완료 PDF'}
            </ButtonLabel>
          </Btn>
        ) : null}

        <SectionLabel>단계</SectionLabel>
        <ListGroup>
          {ESIGN_STEPS.map((step, i) => {
            const done = stage.state === '서명완료' || i < stage.done || passed.has(step.key);
            const here = stage.state === '진행중' && i === stage.done;
            // 통과 시각이 있으면 «완료» 대신 시각을 보여준다 — 언제 했는지가 분쟁 때 근거다.
            const at = stamp(consentAt(contract.sign_consents, step.key));
            return (
              <DetailRow
                key={step.key}
                label={`${i + 1}. ${step.label}`}
                value={done ? (at || '완료') : here ? '진행 중' : '—'}
                valueColor={done ? C.ok : here ? C.warn : C.faint}
              />
            );
          })}
        </ListGroup>

        <SectionLabel>본인확인 자료</SectionLabel>
        <ListGroup>
          <DetailRow label="신분증 사진" value={shots.idCard ? '제출됨' : '—'} valueColor={shots.idCard ? C.ok : C.faint} />
          <DetailRow label="본인 얼굴" value={shots.selfie ? '제출됨' : '—'} valueColor={shots.selfie ? C.ok : C.faint} />
          {shots.verifiedAt ? <DetailRow label="확인 시각" value={stamp(shots.verifiedAt)} /> : null}
        </ListGroup>

        <SectionLabel>첨부 서류</SectionLabel>
        <ListGroup>
          {REQUIRED_DOCS.map((need) => {
            const got = docs.find((d) => d.key === need.key);
            return (
              <DetailRow
                key={need.key}
                label={need.label}
                value={got ? (stamp(got.submittedAt) || '제출됨') : need.required ? '미제출' : '—'}
                valueColor={got ? C.ok : need.required ? C.danger : C.faint}
              />
            );
          })}
          {/* 목록에 없는 서류를 손님이 더 냈으면 그것도 보여준다 — 조용히 감추지 않는다. */}
          {docs.filter((d) => !REQUIRED_DOCS.some((n) => n.key === d.key)).map((d) => (
            <DetailRow key={d.key} label={d.label} value={stamp(d.submittedAt) || '제출됨'} valueColor={C.ok} />
          ))}
        </ListGroup>
        <div style={{ fontSize: FS.cap, color: C.faint }}>
          원본 파일은 착한거래가 보관합니다. 여기엔 제출 여부와 시각만 옵니다.
        </div>

        {!issued ? (
          <div style={{ fontSize: FS.cap, color: C.faint }}>
            아직 계약서를 만들지 않았습니다. 옆에서 양식을 고르고 만들면 진행이 시작됩니다.
          </div>
        ) : null}
    </PaneStack>
  );
}
