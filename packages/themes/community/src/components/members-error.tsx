"use client";

interface CommunityMembersErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function CommunityMembersError({ error, reset }: CommunityMembersErrorProps) {
  return (
    <main className="np-community-shell np-community-message np-community-members-error">
      <span className="np-community-message-code">MEMBER ERROR</span>
      <h1>회원 정보를 불러오지 못했어요.</h1>
      <p>
        {process.env.NODE_ENV === "production"
          ? "다시 시도하거나 새로 로그인하면 대부분 해결됩니다."
          : error.message}
      </p>
      <div className="np-community-message-actions">
        <button type="button" onClick={reset}>
          다시 시도
        </button>
        <a href="/members/login">로그인으로 가기</a>
      </div>
    </main>
  );
}
