import { z } from "zod";

export const storefrontSettingsSchema = z.object({
  brandName: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .default("Atelier Market")
    .describe("헤더와 푸터에 표시할 브랜드 이름입니다."),
  announcement: z
    .string()
    .trim()
    .max(140)
    .default("새로운 계절의 물건을 천천히 소개합니다.")
    .describe("헤더 위 안내 바에 표시할 문장입니다."),
  tagline: z
    .string()
    .trim()
    .max(160)
    .default("오래 쓰고 자주 손이 가는 물건을 고릅니다.")
    .describe("브랜드 소개와 푸터에 표시할 짧은 문장입니다."),
  accentColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional()
    .describe("주요 링크와 Shop 공개 화면에 사용할 HEX 색상입니다."),
  productDensity: z
    .enum(["comfortable", "compact"])
    .default("comfortable")
    .describe("Shop 상품 카드의 기본 간격입니다."),
});

export type StorefrontSettings = z.infer<typeof storefrontSettingsSchema>;
