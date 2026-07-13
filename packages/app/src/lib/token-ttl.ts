import {
  npAuthContractLimits,
  npAuthRuntimeDefaults,
  npReadAuthPositiveInteger,
} from "@nexpress/core/auth-contract";

/**
 * Single-use auth token TTLs (#288).
 *
 * Invite, password-reset, and email-verify tokens previously had their
 * lifetimes inlined in four separate route handlers. That meant
 *
 *   - changing the policy (e.g. cutting the reset window during an
 *     incident) required a code edit + redeploy,
 *   - the staff and member reset constants drifted independently,
 *   - and a future contributor changing one would silently miss the
 *     others.
 *
 * The values here are read once per process from env at module load.
 * Missing values use the documented default. Malformed, fractional, signed,
 * whitespace-padded, scientific-notation, zero, or out-of-range values fail
 * closed during app initialization.
 *
 * Defaults are intentionally **conservative on the safe side**:
 *   - 1-hour password reset (short attack window),
 *   - 24-hour email verification (one full day for users to find
 *     the message in spam),
 *   - 7-day invite (matches typical onboarding cycles).
 *
 * Operators tighten via env. JWT / refresh-token TTLs follow the same
 * pattern but live in `@nexpress/next` (`NP_TOKEN_EXPIRATION` /
 * `NP_REFRESH_TOKEN_EXPIRATION`); we keep single-use tokens here in
 * the app layer because that's where the route handlers live.
 */

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Invitation token TTL — admin invites a new staff member; the user
 * must complete signup within this window.
 *
 * Override via `NP_INVITE_TTL_HOURS` (integer hours, default 168).
 */
export const inviteTtlMs =
  npReadAuthPositiveInteger(
    "NP_INVITE_TTL_HOURS",
    process.env.NP_INVITE_TTL_HOURS,
    npAuthRuntimeDefaults.inviteTtlHours,
    npAuthContractLimits.inviteTtlHours,
  ) * HOUR_MS;

/**
 * Password-reset token TTL. Same value applies to staff and member
 * resets — there's no security argument for asymmetric windows, and
 * splitting them invites the kind of drift this module exists to
 * prevent.
 *
 * Override via `NP_RESET_TTL_MINUTES` (integer minutes, default 60).
 */
export const resetTtlMs =
  npReadAuthPositiveInteger(
    "NP_RESET_TTL_MINUTES",
    process.env.NP_RESET_TTL_MINUTES,
    npAuthRuntimeDefaults.resetTtlMinutes,
    npAuthContractLimits.resetTtlMinutes,
  ) * MINUTE_MS;

/**
 * Email-verification token TTL — member registers, must click the
 * link within this window.
 *
 * Override via `NP_VERIFY_TTL_HOURS` (integer hours, default 24).
 */
export const verifyTtlMs =
  npReadAuthPositiveInteger(
    "NP_VERIFY_TTL_HOURS",
    process.env.NP_VERIFY_TTL_HOURS,
    npAuthRuntimeDefaults.verifyTtlHours,
    npAuthContractLimits.verifyTtlHours,
  ) * HOUR_MS;
