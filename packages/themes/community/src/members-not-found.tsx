export function CommunityMembersNotFound() {
  return (
    <div className="np-community-message np-community-members-not-found">
      <span className="np-community-message-code">MEMBER</span>
      <h1>회원 링크가 만료되었어요.</h1>
      <p>
        인증 또는 비밀번호 재설정 링크는 한 번 사용하면 만료됩니다. 로그인 화면에서 다시 시작해
        주세요.
      </p>
      <div className="np-community-message-actions">
        <a href="/members/login">로그인으로 가기</a>
      </div>
    </div>
  );
}
