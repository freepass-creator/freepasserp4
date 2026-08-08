import type { EntityRecord } from '@/lib/intake/entities';
import { STEPS, contractStage, getProgress, normalizeContractStatus } from '@/lib/domain/contract';
import { contractHaystack, matchHay } from '@/lib/domain/search';

export type ContractSort = 'date' | 'status' | 'progress' | 'name';
/** 단계 그룹은 `STEPS` 라벨과 **글자 그대로** 같다. 여기만 고치면 어긋난다 — 둘을 같이 움직일 것. */
export type ContractWorkflowGroup =
  | '확인 필요'
  | '출고문의'
  | '서류'
  | '약정'
  | '입금'
  | '출고'
  | '계약완료'
  | '계약취소';
export type ContractFilter = '진행' | 'all' | ContractWorkflowGroup;

export const CONTRACT_SORT_OPTIONS: { value: ContractSort; label: string }[] = [
  { value: 'status', label: '단계순' },
  { value: 'progress', label: '진행순' },
  { value: 'name', label: '계약자순' },
  { value: 'date', label: '최근순' },
];

/** 단계 칩·정렬축의 순서 = `STEPS` 순서. 손으로 나열하면 단계를 재배치할 때 조용히 어긋난다. */
const STEP_GROUPS = STEPS.map((step) => step.label as ContractWorkflowGroup);

export const CONTRACT_FILTER_OPTIONS: { key: ContractFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  // 기존 기본 동작(상태 없는 레코드·계약취소 제외)은 유지하되 실제 범위를 정확히 쓴다.
  { key: '진행', label: '계약취소 제외' },
  { key: '확인 필요', label: '확인 필요' },
  ...STEP_GROUPS.map((group) => ({ key: group as ContractFilter, label: `${group} 진행` })),
  { key: '계약완료', label: '계약완료' },
  { key: '계약취소', label: '계약취소' },
];

const WORKFLOW_ORDER: ContractWorkflowGroup[] = [
  '확인 필요', ...STEP_GROUPS, '계약완료', '계약취소',
];

/**
 * 계약 목록의 필터·정렬 분류 SSOT.
 * DB 상태를 새로 쓰지 않고 5단계 체크에서 파생한 행 뱃지와 같은 의미를 사용한다.
 * 레거시 상태·철회·거부·완료 전이 실패는 임의 해석하지 않고 운영 확인 대상으로 모은다.
 */
export function contractWorkflowGroup(contract: EntityRecord): ContractWorkflowGroup {
  const status = normalizeContractStatus(contract.contract_status);
  const stage = contractStage(contract);

  if (status === '계약취소') return '계약취소';
  if (status === '계약철회') return '확인 필요';
  if (status && !['계약요청', '계약완료', '계약취소'].includes(status)) return '확인 필요';
  if (!status || stage.tone === 'red' || stage.label === '완료 처리 대기') return '확인 필요';
  if (stage.label === '계약완료') return '계약완료';
  // 앞글자 매칭 금지 — «출고문의 진행»이 «출고»에 먼저 걸려 신규 계약이 마지막 단계로 분류됐다(2026-08-08).
  // contractStage 의 진행 라벨은 `${STEPS[i].label} 진행` 뿐이므로 통째로 맞춘다.
  const step = STEPS.find((s) => stage.label === `${s.label} 진행`);
  if (step) return step.label as ContractWorkflowGroup;
  return '확인 필요';
}

export const contractMonth = (contract: EntityRecord) => String(contract.contract_date || '').slice(0, 7);

export function contractMonthLabel(month: string): string {
  const [year, number] = month.split('-');
  if (!year || !number) return month;
  return `${year}년 ${Number(number)}월`;
}

export function contractMonthOptions(contracts: EntityRecord[]): { value: string; label: string }[] {
  const months = [...new Set(
    contracts.map(contractMonth).filter((month) => /^\d{4}-\d{2}$/.test(month)),
  )].sort().reverse();
  return months.map((month) => ({ value: month, label: contractMonthLabel(month) }));
}

function matchesFilter(contract: EntityRecord, filter: ContractFilter): boolean {
  if (filter === '진행') {
    const status = normalizeContractStatus(contract.contract_status);
    // 기본 라벨 '취소 제외' 그대로: 상태 누락도 숨기지 않고 확인 필요로 노출한다.
    return status !== '계약취소';
  }
  return filter === 'all' || contractWorkflowGroup(contract) === filter;
}

type Params = {
  contracts: EntityRecord[];
  query: string;
  filter: ContractFilter;
  month: string;
  /** 복원된 차량명·역할별 상대방도 화면에 보이는 그대로 검색한다. */
  searchText?: (contract: EntityRecord) => string;
};

export function filterContracts(params: Params & { sort: ContractSort | '' }): EntityRecord[] {
  return params.contracts
    .filter((contract) => matchHay(
      [contractHaystack(contract), params.searchText?.(contract) || ''].filter(Boolean).join(' '),
      params.query,
    ))
    .filter((contract) => matchesFilter(contract, params.filter))
    .filter((contract) => !params.month || contractMonth(contract) === params.month)
    .slice()
    .sort((a, b) => {
      if (!params.sort) return 0;
      if (params.sort === 'name') return String(a.customer_name || '').localeCompare(String(b.customer_name || ''), 'ko');
      if (params.sort === 'progress') {
        return getProgress(b).done - getProgress(a).done
          || String(b.contract_date || '').localeCompare(String(a.contract_date || ''))
          || String(a.contract_code || '').localeCompare(String(b.contract_code || ''), 'ko');
      }
      if (params.sort === 'status') {
        const aIndex = WORKFLOW_ORDER.indexOf(contractWorkflowGroup(a));
        const bIndex = WORKFLOW_ORDER.indexOf(contractWorkflowGroup(b));
        return aIndex - bIndex
          || String(b.contract_date || '').localeCompare(String(a.contract_date || ''))
          || String(a.contract_code || '').localeCompare(String(b.contract_code || ''), 'ko');
      }
      return String(b.contract_date || '').localeCompare(String(a.contract_date || ''))
        || String(a.contract_code || '').localeCompare(String(b.contract_code || ''), 'ko');
    });
}

export function contractPreviewCount(params: Params): number {
  return params.contracts
    .filter((contract) => matchHay(
      [contractHaystack(contract), params.searchText?.(contract) || ''].filter(Boolean).join(' '),
      params.query,
    ))
    .filter((contract) => matchesFilter(contract, params.filter))
    .filter((contract) => !params.month || contractMonth(contract) === params.month)
    .length;
}
