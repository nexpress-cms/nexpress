import { hash, verify, type Options } from "@node-rs/argon2";

import {
  npAuthContractLimits,
  npIsAuthNewPassword,
  npIsAuthPasswordCandidate,
} from "../auth-contract/index.js";

export const ARGON2_OPTIONS: Options = {
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
};

// Test-only weak params — drops a hash from ~75ms to <1ms. Only kicks in
// when NP_TEST_FAST_HASH=1 is explicitly set (vitest's setup-env.ts does
// this) so production / dev never see weakened security.
const TEST_ARGON2_OPTIONS: Options = {
  memoryCost: 8,
  timeCost: 1,
  outputLen: 32,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  if (!npIsAuthNewPassword(password)) {
    throw new Error(
      `Password must contain ${npAuthContractLimits.passwordMinLength.toString()} through ${npAuthContractLimits.passwordMaxLength.toString()} characters.`,
    );
  }
  return hash(
    password,
    process.env.NP_TEST_FAST_HASH === "1" ? TEST_ARGON2_OPTIONS : ARGON2_OPTIONS,
  );
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  if (!npIsAuthPasswordCandidate(password)) return Promise.resolve(false);
  return verify(passwordHash, password);
}
