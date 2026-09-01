'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileDown, FileStack, Search } from 'lucide-react';
import { getAuthClient } from '@/lib/firebase/client';
import { Btn, ButtonLabel, Checkbox, ICON, Input, ListGroup, ListRow, Message, Page } from '@/components/ui';

type Row = {
  contractCode: string;
  vehicleName: string;
  carNumber: string;
  contractStart: string;
  contractEnd: string;
  selectable: boolean;
};

async function authorizedFetch(url: string, init?: RequestInit) {
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(init?.headers || {}) },
    cache: 'no-store',
  });
}

const issueError = async (response: Response) => {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error || '확인서를 만들지 못했습니다.';
};

/**
 * 본계약·서명 화면과 분리된 기관제출용 발급 도구.
 * 한 계약을 기준으로 같은 고객의 확정 차량만 서버가 다시 걸러 준다.
 */
export default function RentalFactIssuancePage() {
  const [anchor, setAnchor] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('기준 계약을 불러오면 같은 임차인의 발급 가능한 차량만 표시됩니다.');

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('contract');
    if (value) setAnchor(value);
  }, []);

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.contractCode)), [rows, selected]);
  const load = async () => {
    const code = anchor.trim();
    if (!code) { setMessage('기준 계약번호를 입력해 주세요.'); return; }
    setBusy(true);
    try {
      const response = await authorizedFetch(`/api/freepass-esign/issuance/rental-fact?contractCode=${encodeURIComponent(code)}`);
      if (!response.ok) throw new Error(await issueError(response));
      const result = await response.json() as { rows?: Row[] };
      const next = result.rows || [];
      setRows(next);
      setSelected(new Set(next.filter((row) => row.selectable && row.contractCode === code).map((row) => row.contractCode)));
      setMessage(next.some((row) => row.selectable) ? '발급할 차량을 선택해 주세요. 계약번호·차량번호·기간은 확정된 기록만 표시됩니다.' : '발급 가능한 차량이 없습니다. 전자서명 완료와 인도일 확정 여부를 확인해 주세요.');
    } catch (error) { setRows([]); setSelected(new Set()); setMessage(error instanceof Error ? error.message : '계약을 불러오지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const issue = async () => {
    if (!selectedRows.length) { setMessage('발급할 차량을 하나 이상 선택해 주세요.'); return; }
    const viewer = window.open('about:blank', '_blank');
    if (viewer) viewer.opener = null;
    setBusy(true);
    try {
      const response = await authorizedFetch('/api/freepass-esign/issuance/rental-fact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contractCodes: selectedRows.map((row) => row.contractCode) }),
      });
      if (!response.ok) throw new Error(await issueError(response));
      const url = URL.createObjectURL(await response.blob());
      if (viewer) viewer.location.replace(url); else window.location.assign(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
      setMessage(selectedRows.length === 1 ? '차량 1대 확인서를 열었습니다.' : `${selectedRows.length}대 일괄 확인서를 열었습니다.`);
    } catch (error) { viewer?.close(); setMessage(error instanceof Error ? error.message : '확인서를 만들지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const toggle = (code: string) => setSelected((current) => {
    const next = new Set(current); next.has(code) ? next.delete(code) : next.add(code); return next;
  });

  return (
    <Page title="임대차 계약 사실확인서">
      <Message variant="info">전자계약 완료와 인도일 확정 기록을 기준으로, 차량 1대 또는 같은 임차인의 여러 대를 발급합니다.</Message>
      <ListGroup header="발급 기준 계약" footer={message}>
        <div style={{ display: 'flex', gap: 6, padding: 8 }}>
          <Input value={anchor} onChange={setAnchor} ariaLabel="기준 계약번호" placeholder="계약번호 입력" full />
          <Btn title="계약 불러오기" onClick={() => void load()} disabled={busy}>
            <ButtonLabel icon={<Search size={ICON.md} />}>불러오기</ButtonLabel>
          </Btn>
        </div>
      </ListGroup>
      {rows.length ? (
        <ListGroup header={`발급 차량 · ${selectedRows.length}대 선택`} footer="한 대만 선택하면 개별 확인서, 두 대 이상이면 같은 임차인의 차량을 한 확인서 표로 발급합니다.">
          {rows.map((row) => {
            const period = row.contractStart && row.contractEnd ? `${row.contractStart} ~ ${row.contractEnd}` : '인도일 미확정';
            return (
              <ListRow
                key={row.contractCode}
                badge={row.selectable ? undefined : '불가'}
                main={`${row.carNumber || '—'} · ${row.vehicleName || '—'}`}
                sub={`${row.contractCode} · ${period}`}
                selected={selected.has(row.contractCode)}
                right={(
                  <Checkbox
                    checked={selected.has(row.contractCode)}
                    disabled={!row.selectable || busy}
                    onChange={() => toggle(row.contractCode)}
                    ariaLabel={`${row.contractCode} 선택`}
                  />
                )}
              />
            );
          })}
          <div style={{ padding: 8 }}>
            <Btn full title="선택 차량 확인서 PDF 열기" disabled={busy || !selectedRows.length} onClick={() => void issue()}>
              <ButtonLabel icon={<FileDown size={ICON.md} />}>{selectedRows.length > 1 ? `${selectedRows.length}대 일괄 확인서 열기` : '선택 차량 확인서 열기'}</ButtonLabel>
            </Btn>
          </div>
        </ListGroup>
      ) : null}
      <Btn variant="ghost" href="/erp5/esign" title="계약서관리로 돌아가기">
        <ButtonLabel icon={<FileStack size={ICON.sm} />}>계약서관리로 돌아가기</ButtonLabel>
      </Btn>
    </Page>
  );
}
