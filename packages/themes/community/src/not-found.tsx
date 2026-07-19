export function CommunityNotFound() {
  return (
    <div className="np-community-message np-community-not-found">
      <span className="np-community-message-code">404</span>
      <h1>찾던 이야기가 보이지 않아요.</h1>
      <p>주소가 바뀌었거나 공개가 끝난 글일 수 있습니다. 홈에서 새로운 이야기를 둘러보세요.</p>
      <div className="np-community-message-actions">
        <a href="/">홈으로 가기</a>
        <a href="/blog">전체 글 보기</a>
      </div>
    </div>
  );
}
