import { z } from "zod";

export const communitySettingsSchema = z.object({
  communityName: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .default("모두의 광장")
    .describe("헤더와 회원 화면에 표시할 커뮤니티 이름입니다."),
  tagline: z
    .string()
    .trim()
    .max(120)
    .default("취향과 경험이 모이는 열린 커뮤니티")
    .describe("로고 옆과 홈 인트로에 표시할 짧은 소개입니다."),
  accentColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional()
    .describe("주요 링크와 버튼에 사용할 6자리 HEX 색상입니다."),
  denseLists: z
    .boolean()
    .default(true)
    .describe("글 목록과 포럼 행을 한국형 커뮤니티의 조밀한 간격으로 표시합니다."),
  showUtilityBar: z
    .boolean()
    .default(true)
    .describe("헤더 위쪽의 새 글·알림·로그인 바로가기를 표시합니다."),
  footerMessage: z
    .string()
    .trim()
    .max(180)
    .default("서로의 경험을 존중하며 오래 남을 이야기를 나눠요.")
    .describe("푸터에 표시할 커뮤니티 운영 메시지입니다."),
});

export type CommunitySettings = z.infer<typeof communitySettingsSchema>;
