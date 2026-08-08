'use client';

/**
 * 계약서관리 — 손님에게 나간 «전자계약»이 어디까지 갔는지 보는 곳. **관리자 전용.**
 *
 * ★`/contract` 와 축이 다르다
 *   저기는 «우리 일»이 어디까지(출고문의·서류·약정·입금·출고),
 *   여기는 «손님»이 서명 링크에서 어디까지(본인확인→…→서명). 판정은 `esign-progress.ts`.
 *
 * ★발송이 관리자 전용이라 목록도 관리자에게만 연다 — `canSendChakhandealContract` 와 같은 축.
 *
 * ★계약서 링크는 **착한거래 것**이다. 우리는 발행 결과(`esign_verify_url`)를 보관·복사만 한다
 *   (`docs/ESIGN_CHAKHANDEAL_INTEGRATION.md`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStore } from '@/lib/store';
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
  Loading, SectionLabel,
} from '@/components/ui';
import { Copy, ExternalLink, FileSignature } from 'lucide-react';
import {
  ESIGN_FILTERS, ESIGN_STEPS, compareEsign, consentKeys, esignStage,
  matchesEsignFilter, type EsignFilter,
} from '@/lib/domain/esign-progress';
import { buildConsentGroups, SAMPLE_AGREEMENT } from '@/lib/domain/esign-consent-doc';
import { contractVehicleLabel } from '@/lib/domain/vehicle-label';
import { hasTermFrozen, isContractCancelled } from '@/lib/domain/contract';
import { contractHaystack, matchHay } from '@/lib/domain/search';

const S = (v: unknown) => String(v ?? '').trim();

export default function EsignPage() {
  const co = getCompanyId();
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [filter, setFilter] = useState<EsignFilter>('전체');
  const [query, setQuery] = useState('');
  const [selKey, setSelKey] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await getStore().list('contract', co);
      // 약정에서 기간·금액이 굳은 계약만 계약서를 만들 수 있다 — 그 전 건은 여기 올 일이 없다.
      setRows(list.filter((c) => !isContractCancelled(c) && hasTermFrozen(c)));
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

  const shown = useMemo(() => {
    if (!rows) return [];
    return rows
      .filter((c) => matchesEsignFilter(c, filter))
      .filter((c) => (query ? matchHay(contractHaystack(c), query) : true))
      .sort(compareEsign);
  }, [rows, filter, query]);

  const sel = useMemo(
    () => shown.find((c) => S(c.contract_code) === selKey) || null,
    [shown, selKey],
  );

  const attention = useMemo(
    () => (rows || []).filter((c) => ['반려', '만료'].includes(esignStage(c).state)).length,
    [rows],
  );

  if (allowed === null) return <Loading />;

  const listEl = rows === null ? <Loading /> : shown.length === 0 ? (
    <CenterNote>{query || filter !== '전체' ? '조건에 맞는 계약이 없습니다.' : '약정이 끝난 계약이 아직 없습니다.'}</CenterNote>
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

  const panes: WorkPane[] = sel ? [{
    key: 'detail',
    title: contractVehicleLabel(sel) || S(sel.contract_code),
    icon: FileSignature,
    node: <EsignDetail contract={sel} onChanged={load} />,
  }] : [];

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
      selected={!!sel}
      onBack={() => setSelKey('')}
    />
  );
}

/** 상세 — 진행 계단 + 링크 + 손님이 볼 내용 미리보기. */
function EsignDetail({ contract, onChanged }: { contract: EntityRecord; onChanged: () => void | Promise<void> }) {
  const stage = esignStage(contract);
  const passed = consentKeys(contract.sign_consents);
  const link = S(contract.esign_verify_url);
  const groups = useMemo(() => buildConsentGroups(contract), [contract]);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Badge tone={stage.tone === 'green' ? 'green' : stage.tone === 'red' ? 'red' : stage.tone === 'amber' ? 'amber' : 'gray'} variant="solid">
          {stage.label}
        </Badge>
        {stage.state === '진행중' ? (
          <span style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.strong }}>{stage.done}/{stage.total} 단계</span>
        ) : null}
      </div>

      {/* 손님 여정 — 어디까지 왔는지 한눈에. 통과한 칸만 색이 든다. */}
      <SectionLabel>손님 진행</SectionLabel>
      <ListGroup>
        {ESIGN_STEPS.map((step, i) => {
          const done = stage.state === '서명완료' || i < stage.done || passed.has(step.key);
          const here = stage.state === '진행중' && i === stage.done;
          return (
            <DetailRow
              key={step.key}
              label={`${i + 1}. ${step.label}`}
              value={done ? '완료' : here ? '진행 중' : '—'}
              valueColor={done ? C.ok : here ? C.warn : C.faint}
            />
          );
        })}
      </ListGroup>

      <SectionLabel>계약서 링크</SectionLabel>
      {link ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: FS.cap, color: C.mute, wordBreak: 'break-all', fontWeight: FW.strong }}>{link}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn title="링크 복사" onClick={copy}>
              <ButtonLabel icon={<Copy size={ICON.md} aria-hidden />}>링크 복사</ButtonLabel>
            </Btn>
            <Btn title="링크 열기" onClick={() => window.open(link, '_blank', 'noreferrer')}>
              <ButtonLabel icon={<ExternalLink size={ICON.md} aria-hidden />}>열어보기</ButtonLabel>
            </Btn>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: FS.cap, color: C.faint }}>
            아직 계약서를 만들지 않았습니다. 만들면 착한거래 링크가 생기고, 그 링크를 복사해 손님에게 보냅니다.
          </div>
          <ChakhandealEsignButton contractCode={S(contract.contract_code)} onSent={onChanged} />
        </div>
      )}

      {/* 샘플 약관이 실계약에 나가면 사고다 — 눈에 보이게 둔다. */}
      {SAMPLE_AGREEMENT.isSample ? (
        <Badge tone="amber" variant="solid">약관이 «{SAMPLE_AGREEMENT.version}» 샘플입니다 — 법률 검토 전</Badge>
      ) : null}

      <SectionLabel>손님이 확인할 내용</SectionLabel>
      {groups.map((g) => (
        <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.head }}>{g.title}</div>
          <ListGroup>
            {g.rows.length
              ? g.rows.map((row) => <DetailRow key={row.label} label={row.label} value={row.value} />)
              : <DetailRow label="—" value="표시할 값이 없습니다" valueColor={C.danger} />}
          </ListGroup>
        </div>
      ))}
    </div>
  );
}
