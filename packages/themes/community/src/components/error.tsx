"use client";

interface CommunityErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function CommunityError({ error, reset }: CommunityErrorProps) {
  return (
    <main className="np-community-shell np-community-message np-community-error">
      <span className="np-community-message-code">ERROR</span>
      <h1>잠시 연결이 고르지 않아요.</h1>
      <p>
        {process.env.NODE_ENV === "production"
          ? "잠시 뒤 다시 시도해 주세요. 작성 중인 내용은 브라우저에 남아 있을 수 있습니다."
          : error.message}
      </p>
      <div className="np-community-message-actions">
        <button type="button" onClick={reset}>
          다시 시도
        </button>
        <a href="/">홈으로 가기</a>
      </div>
    </main>
  );
}
