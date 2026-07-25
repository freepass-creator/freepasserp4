import type { EntityRecord } from '@/lib/intake/entities';
import { CONTRACT_STATES, getProgress } from '@/lib/domain/contract';
import { matchContractQuery } from '@/lib/domain/search';

export type ContractSort = 'date' | 'status' | 'progress' | 'name';
export type ContractFilter = '진행' | 'all' | (typeof CONTRACT_STATES)[number];

export const CONTRACT_SORT_OPTIONS: { value: ContractSort; label: string }[] = [
  { value: 'status', label: '상태순' },
  { value: 'progress', label: '진행순' },
  { value: 'name', label: '계약자순' },
  { value: 'date', label: '최근순' },
];

export const CONTRACT_FILTER_OPTIONS: { key: ContractFilter; label: string }[] = [
  { key: '진행', label: '진행' },
  { key: 'all', label: '전체' },
  ...CONTRACT_STATES.map((state) => ({ key: state, label: state })),
];

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
    const status = String(contract.contract_status || '');
    return !!status && status !== '계약취소';
  }
  return filter === 'all' || String(contract.contract_status || '') === filter;
}

type Params = {
  contracts: EntityRecord[];
  query: string;
  filter: ContractFilter;
  month: string;
};

export function filterContracts(params: Params & { sort: ContractSort | '' }): EntityRecord[] {
  return params.contracts
    .filter((contract) => matchContractQuery(contract, params.query))
    .filter((contract) => matchesFilter(contract, params.filter))
    .filter((contract) => !params.month || contractMonth(contract) === params.month)
    .slice()
    .sort((a, b) => {
      if (!params.sort) return 0;
      if (params.sort === 'name') return String(a.customer_name || '').localeCompare(String(b.customer_name || ''), 'ko');
      if (params.sort === 'progress') {
        return getProgress(b).done - getProgress(a).done
          || String(b.contract_date || '').localeCompare(String(a.contract_date || ''));
      }
      if (params.sort === 'status') {
        const aIndex = CONTRACT_STATES.indexOf(String(a.contract_status || '') as typeof CONTRACT_STATES[number]);
        const bIndex = CONTRACT_STATES.indexOf(String(b.contract_status || '') as typeof CONTRACT_STATES[number]);
        return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex);
      }
      return String(b.contract_date || '').localeCompare(String(a.contract_date || ''));
    });
}

export function contractPreviewCount(params: Params): number {
  return params.contracts
    .filter((contract) => matchContractQuery(contract, params.query))
    .filter((contract) => matchesFilter(contract, params.filter))
    .filter((contract) => !params.month || contractMonth(contract) === params.month)
    .length;
}
