/**
 * 개인 영업자 채널 백필 — 브라우저(관리자 로그인)에서 members 화면 버튼으로 실행.
 * CLI는 인증 컨텍스트가 없어 여기선 dry-run 설명만.
 *
 * 실행(프로덕션 규칙 게시 전):
 *   1. 관리자로 /members 로그인
 *   2. 사용자 탭 · 선택 없음 → 「개인채널 백필 미리보기」→「실행」
 *   또는 콘솔:
 *     const { backfillPersonalAgentChannels } = await import('/lib/firebase/auth')
 *     await backfillPersonalAgentChannels({ dryRun: true })
 *
 * 대상: company_code===SP999 이고 agent_channel_code 가 ''|SP999 인 agent*
 * 결과: agent_channel_code = user_code || uid
 */
console.log(`
[backfill-agent-channels]
CLI로는 RTDB admin 쓰기를 하지 않습니다.
관리자 세션에서 /members → 「개인채널 백필」버튼을 쓰세요.
`);
