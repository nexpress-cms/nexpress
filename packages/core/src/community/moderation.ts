import {
  npRequireModerationCheckContext,
  npRequireModerationVerdict,
} from "../community-contract/contract.js";
import type {
  NpModerationCheckContext,
  NpModerationVerdict,
  NpProfanityAdapter,
  NpSpamAdapter,
} from "../community-contract/types.js";
import { getLogger } from "../observability/logger.js";

import { npRecordCommunityRuntimeDiagnostic } from "./diagnostics.js";

const UNAVAILABLE_VERDICT: NpModerationVerdict = {
  kind: "flag",
  reason: "Moderation adapter unavailable",
};

async function runModerationCheck(
  source: "spam" | "profanity",
  adapter: NpSpamAdapter | NpProfanityAdapter,
  text: string,
  context: NpModerationCheckContext,
): Promise<NpModerationVerdict> {
  const checkedContext = npRequireModerationCheckContext(context);
  try {
    return npRequireModerationVerdict(await adapter.check(text, checkedContext));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    npRecordCommunityRuntimeDiagnostic(source, message);
    getLogger().warn(`${source} adapter contract failed — flagging content`, { error: message });
    return { ...UNAVAILABLE_VERDICT };
  }
}

export function runSpamCheck(
  adapter: NpSpamAdapter,
  text: string,
  context: NpModerationCheckContext,
): Promise<NpModerationVerdict> {
  return runModerationCheck("spam", adapter, text, context);
}

export function runProfanityCheck(
  adapter: NpProfanityAdapter,
  text: string,
  context: NpModerationCheckContext,
): Promise<NpModerationVerdict> {
  return runModerationCheck("profanity", adapter, text, context);
}
