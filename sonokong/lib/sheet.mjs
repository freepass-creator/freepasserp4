/** 구글시트 다루는 로직 — 읽기·쓰기·헤더로 열 찾기·백업.
 *  ★열은 위치가 아니라 이름으로 찾는다. 위치로 쓰면 열이 하나 늘 때 원본이 깨진다(2026-08-19 실제 사고).
 *
 *  import { sheet } from '../lib/sheet.mjs';
 *  const s = await sheet(SHEET.업무내비게이션);
 *  const t = await s.table('해야 할 일', { headerRow: 2 });   // {rows, col, get(row,'업무명'), rowNo}
 *  await s.set('해야 할 일', 5, '코멘트', '확인했습니다');     // 행 5의 「코멘트」 칸
 *  await s.patch([{ tab:'해야 할 일', row:5, col:'완료', value:true }]);
 *  await s.backup('backups/2026-08-20');
 */
import { token, makeCall } from './goog.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const SS = 'https://sheets.googleapis.com/v4/spreadsheets';
export const colL = (n) => { let s = ''; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };
export const num = (v) => Number(String(v ?? '').replace(/[,\s원]/g, '')) || 0;
/** 구글 날짜 serial ↔ 문자열 */
export const serial2date = (s) => new Date((Number(s) - 25569) * 864e5).toISOString().slice(0, 10);
export const date2serial = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5);

export async function sheet(id) {
  const call = makeCall(await token());
  const api = {
    id, call,
    async meta() { return call(`${SS}/${id}?fields=properties.title,sheets(properties(title,sheetId,index,hidden,gridProperties))`); },
    async tabs() { return (await api.meta()).sheets.map((s) => s.properties); },
    async values(tab, range = 'A1:ZZ2000', mode = 'FORMATTED_VALUE') {
      return (await call(`${SS}/${id}/values/${encodeURIComponent(`${tab}!${range}`)}?valueRenderOption=${mode}`)).values || [];
    },
    /** 헤더 행을 읽어 이름→열번호(0-based)를 만들고, 데이터 행을 돌려준다 */
    async table(tab, { headerRow = 2, range = 'A1:ZZ2000', mode = 'FORMATTED_VALUE', keyCol = 0 } = {}) {
      const v = await api.values(tab, range, mode);
      const header = (v[headerRow - 1] || []).map((h) => String(h ?? '').trim());
      const col = Object.fromEntries(header.map((h, i) => [h, i]).filter(([h]) => h));
      const rows = v.slice(headerRow).map((r, i) => ({ r, rowNo: headerRow + 1 + i })).filter((x) => String(x.r[keyCol] ?? '').trim() !== '');
      const get = (x, name) => { if (!(name in col)) throw new Error(`${tab}에 「${name}」 열이 없습니다 (있는 열: ${header.filter(Boolean).join('·')})`); return x.r[col[name]]; };
      return { header, col, rows, get, tab };
    },
    /** 한 칸 쓰기 — 열은 이름으로 */
    async set(tab, rowNo, colName, value, t = null) {
      const tb = t || await api.table(tab);
      if (!(colName in tb.col)) throw new Error(`${tab}에 「${colName}」 열 없음`);
      return call(`${SS}/${id}/values/${encodeURIComponent(`'${tab}'!${colL(tb.col[colName])}${rowNo}`)}?valueInputOption=USER_ENTERED`, { method: 'PUT', body: JSON.stringify({ values: [[value]] }) });
    },
    /** 여러 칸 한 번에 — [{tab,row,col,value}] */
    async patch(items) {
      const tabs = {};
      for (const it of items) tabs[it.tab] ||= await api.table(it.tab);
      const data = items.map((it) => ({ range: `'${it.tab}'!${colL(tabs[it.tab].col[it.col])}${it.row}`, values: [[it.value]] }));
      for (let i = 0; i < data.length; i += 200) await call(`${SS}/${id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: data.slice(i, i + 200) }) });
      return data.length;
    },
    /** 범위 통째 쓰기 */
    async write(tab, a1, values) { return call(`${SS}/${id}/values/${encodeURIComponent(`${tab}!${a1}`)}?valueInputOption=USER_ENTERED`, { method: 'PUT', body: JSON.stringify({ values }) }); },
    /** 행 덧붙이기 (마지막 데이터 행 다음부터) */
    async append(tab, values, { headerRow = 2 } = {}) {
      const tb = await api.table(tab, { headerRow });
      const start = tb.rows.length ? tb.rows[tb.rows.length - 1].rowNo + 1 : headerRow + 1;
      await api.write(tab, `A${start}:${colL(values[0].length - 1)}${start + values.length - 1}`, values);
      return { start, count: values.length };
    },
    async batchUpdate(requests) { return call(`${SS}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) }); },
    /** 전 탭 값·수식 백업 (되돌릴 수 있게 — 시트를 고치기 전에 반드시) */
    async backup(dir) {
      mkdirSync(dir, { recursive: true });
      const m = await api.meta(); const out = { title: m.properties.title, id, at: new Date().toISOString(), tabs: [] };
      for (const s of m.sheets) {
        const t = s.properties.title;
        const [v, f] = await Promise.all([api.values(t, 'A1:ZZ2000', 'UNFORMATTED_VALUE'), api.values(t, 'A1:ZZ2000', 'FORMULA')]);
        out.tabs.push({ props: s.properties, values: v, formulas: f });
      }
      const p = `${dir}/${m.properties.title.replace(/[\\/:*?"<>|]/g, '_')}.json`;
      writeFileSync(p, JSON.stringify(out, null, 1)); return p;
    },
    /** 마지막 수정자·시각 (다른 AI·사람이 만지고 있는지 확인하고 시작할 것) */
    async lastEdit() {
      const d = await call(`https://www.googleapis.com/drive/v3/files/${id}?fields=modifiedTime,lastModifyingUser(displayName,emailAddress)&supportsAllDrives=true`);
      return { at: d.modifiedTime, who: d.lastModifyingUser?.emailAddress || d.lastModifyingUser?.displayName || '?' };
    },
  };
  return api;
}
