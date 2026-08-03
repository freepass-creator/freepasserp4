/** 스토어 캐시의 인증전환·write 후 늦은 Promise 재오염 방지 회귀검사. */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/store.ts', import.meta.url), 'utf8');
const rtdbSource = readFileSync(new URL('../lib/firebase/rtdb-adapter.ts', import.meta.url), 'utf8');
const patchListCacheSource = source.slice(
  source.indexOf('export function patchListCache'),
  source.indexOf('function findCached'),
);
let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean) => {
  if (ok) { passed += 1; console.log(`PASS ${name}`); return; }
  failed += 1;
  console.error(`FAIL ${name}`);
};

check('cache clear가 진행중 요청 token도 폐기',
  /clearStoreCache\(\)[\s\S]*?_listToken\.clear\(\)/.test(source));
check('일반 list 완료는 현재 token만 resolved 반영',
  /if \(_listToken\.get\(ck\) === token\) _listResolved\.set\(ck, rows\)/.test(source));
check('오래된 실패가 새 요청 cache를 삭제하지 않음',
  /if \(_listToken\.get\(ck\) !== token\) return;[\s\S]*?_listCache\.delete\(ck\)/.test(source));
check('write 무효화가 raw list cache도 포함',
  source.includes('key.startsWith(`raw::${entityKey}::`)') && patchListCacheSource.includes('_invalidateRaw(entityKey);'));
const tokenAt = patchListCacheSource.indexOf('_listToken.set(ck, Symbol(ck));');
const rowsAt = patchListCacheSource.indexOf('const rows = _listResolved.get(ck);');
const unresolvedBranch = patchListCacheSource.slice(patchListCacheSource.indexOf('if (!rows) {'));
check('write가 resolved 전 진행중 일반 list 세대도 끊음',
  tokenAt >= 0 && tokenAt < rowsAt
    && unresolvedBranch.includes('_listCache.delete(ck);')
    && unresolvedBranch.includes('_listAt.delete(ck);'));
check('방 메시지 in-flight cleanup도 token으로 격리',
  source.includes('_listToken.get(ck) !== token || _listCache.get(ck) !== p'));
const listFreshAt = source.lastIndexOf('async listFresh(');
const listFreshSource = source.slice(listFreshAt, source.indexOf('async listRawFresh(', listFreshAt));
const rawFreshAt = source.lastIndexOf('async listRawFresh(');
const rawFreshSource = source.slice(rawFreshAt, source.indexOf('async get(entityKey', rawFreshAt));
check('listFresh는 Dispatch 세션 cache를 우회해 base를 직접 조회',
  listFreshSource.includes('this.base.list(') && !listFreshSource.includes('_listCache'));
check('listRawFresh는 raw cache를 우회해 base raw를 직접 조회',
  rawFreshSource.includes('base.listRaw(') && !rawFreshSource.includes('_listCache'));
const allHealthAt = source.lastIndexOf('async listAllFreshWithHealth(');
const allHealthSource = source.slice(allHealthAt, source.indexOf('async get(entityKey', allHealthAt));
check('fresh health는 전체 회사 중 1곳만 실패해도 incomplete 보존',
  allHealthSource.includes('results.every((result) => result.complete)')
  && allHealthSource.includes('result.failures || []'));
check('활성+삭제 경합 판정은 base의 동일 health snapshot 우선',
  allHealthSource.includes("typeof base.listAllFreshWithHealth === 'function'")
  && allHealthSource.includes('return base.listAllFreshWithHealth(entityKey, company)'));
check('RTDB strict health 조회 실패를 빈 정상목록으로 인정하지 않음',
  /strictHealth[\s\S]*?complete: false[\s\S]*?failures:/.test(rtdbSource));
check('일반 화면의 v3+v4 tolerant read는 유지',
  rtdbSource.includes('liveRead.catch(() => [] as EntityRecord[])')
  && rtdbSource.includes('overlayRead.catch(() => [] as EntityRecord[])'));

console.log(`\nstore cache generation: ${passed}/${passed + failed} PASS`);
if (failed) process.exitCode = 1;
