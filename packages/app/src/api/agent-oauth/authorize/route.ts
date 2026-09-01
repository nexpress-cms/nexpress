import type {
  NpAgentEnabledGatewayExposureMode,
  NpAgentScope,
} from "@nexpress/core/agent-contract";
import type { NpAgentOauthConsentViewV1 } from "@nexpress/core/agents";
import { readJsonBody } from "@nexpress/next";
import type { NextRequest } from "next/server";

import { requireAgentOauthStaff } from "../../../lib/agents/studio-admin";
import {
  agentOauthNotFound,
  getAgentOauthSurface,
  oauthError,
  oauthJson,
} from "../../../lib/agents/oauth-http";
import { ensureFor } from "../../../lib/init-core";

const QUERY_KEYS = [
  "client_id",
  "code_challenge",
  "code_challenge_method",
  "nexpress_gateway_mode",
  "redirect_uri",
  "resource",
  "response_type",
  "scope",
  "state",
] as const;

function exactQuery(request: NextRequest): Record<(typeof QUERY_KEYS)[number], string | undefined> {
  const params = request.nextUrl.searchParams;
  const keys = [...new Set(params.keys())];
  if (
    keys.some((key) => !QUERY_KEYS.includes(key as (typeof QUERY_KEYS)[number])) ||
    keys.some((key) => params.getAll(key).length !== 1)
  ) {
    throw new Error("invalid_request");
  }
  return Object.fromEntries(QUERY_KEYS.map((key) => [key, params.get(key) ?? undefined])) as Record<
    (typeof QUERY_KEYS)[number],
    string | undefined
  >;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&#39;";
  });
}

function consentHtml(view: NpAgentOauthConsentViewV1): string {
  const rank: Record<NpAgentEnabledGatewayExposureMode, number> = {
    read: 1,
    propose: 2,
    "approved-execute": 3,
  };
  const modes = (["read", "propose", "approved-execute"] as const).filter(
    (mode) => rank[mode] <= rank[view.gatewayMode],
  );
  const challenge = JSON.stringify(view.consentChallenge).replace(/</gu, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize ${escapeHtml(view.client.name)}</title>
<style>body{font:14px system-ui,sans-serif;margin:0;background:#f5f5f5;color:#171717}.card{max-width:620px;margin:7vh auto;background:white;border:1px solid #ddd;border-radius:14px;padding:28px}.muted{color:#666}.box{background:#f7f7f7;border-radius:9px;padding:12px;margin:12px 0}fieldset{border:0;padding:0;margin:20px 0}label{display:block;margin:9px 0}button{border:1px solid #aaa;border-radius:8px;padding:9px 14px;background:white;cursor:pointer}.primary{background:#111;color:white;border-color:#111}.actions{display:flex;gap:8px}.error{color:#a00}</style></head>
<body><main class="card"><h1>Authorize ${escapeHtml(view.client.name)}</h1>
<p class="muted">This registered client is requesting access to this NexPress site.</p>
<div class="box"><strong>Site</strong><br>${escapeHtml(view.siteId)}<br><br><strong>Redirect host</strong><br>${escapeHtml(view.redirectHost)}<br><br><strong>Resource</strong><br>${escapeHtml(view.resource)}<br><br><strong>Expires</strong><br>${escapeHtml(view.expiresAt)}</div>
<form id="consent"><fieldset><legend><strong>Scopes</strong></legend>${view.requestedScopes
    .map(
      (scope) =>
        `<label><input type="checkbox" name="scope" value="${escapeHtml(scope)}" checked${scope === "site:read" ? " disabled" : ""}> ${escapeHtml(scope)}</label>`,
    )
    .join("")}</fieldset>
<fieldset><legend><strong>Gateway mode</strong></legend>${modes
    .map(
      (mode) =>
        `<label><input type="radio" name="mode" value="${mode}"${mode === "read" ? " checked" : ""}> ${mode}</label>`,
    )
    .join("")}</fieldset>
<p class="muted">This consent never shares provider credentials, browser-session tokens, or authority beyond the selected site, scopes, and Gateway mode.</p>
<p id="error" class="error" role="alert"></p><div class="actions"><button type="button" id="deny">Deny</button><button class="primary" type="submit">Authorize</button></div></form></main>
<script>(()=>{const challenge=${challenge};const form=document.getElementById("consent");const error=document.getElementById("error");const csrf=()=>document.cookie.split(";").map(v=>v.trim()).find(v=>v.startsWith("np-csrf="))?.slice(8)||"";async function decide(approve){error.textContent="";const scopes=[...form.querySelectorAll('input[name="scope"]')].filter(v=>v.checked||v.disabled).map(v=>v.value).sort();const gatewayMode=form.querySelector('input[name="mode"]:checked').value;const response=await fetch(location.pathname,{method:"POST",headers:{"content-type":"application/json","x-csrf-token":decodeURIComponent(csrf())},body:JSON.stringify({consentChallenge:challenge,approve,scopes,gatewayMode})});const body=await response.json().catch(()=>({}));if(!response.ok||typeof body.redirectUri!=="string")throw new Error("Authorization could not be completed.");location.assign(body.redirectUri)}form.addEventListener("submit",event=>{event.preventDefault();decide(true).catch(caught=>error.textContent=caught.message)});document.getElementById("deny").addEventListener("click",()=>decide(false).catch(caught=>error.textContent=caught.message));})();</script></body></html>`;
}

export async function GET(request: NextRequest) {
  await ensureFor("read");
  let staff;
  try {
    staff = await requireAgentOauthStaff(request);
  } catch {
    return oauthJson({ error: "login_required" }, 401);
  }
  const surface = await getAgentOauthSurface(staff.siteId);
  if (!surface) return agentOauthNotFound();
  try {
    const query = exactQuery(request);
    const view = await surface.oauth.startAuthorization({
      siteId: staff.siteId,
      actor: staff.actor,
      request: {
        responseType: query.response_type,
        clientId: query.client_id,
        redirectUri: query.redirect_uri,
        state: query.state,
        scope: query.scope,
        resource: query.resource,
        codeChallenge: query.code_challenge,
        codeChallengeMethod: query.code_challenge_method,
        gatewayMode: query.nexpress_gateway_mode,
      },
    });
    return new Response(consentHtml(view), {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
      },
    });
  } catch (error) {
    return oauthError(error);
  }
}

function exactDecision(value: unknown): {
  consentChallenge: unknown;
  approve: boolean;
  scopes: NpAgentScope[];
  gatewayMode: NpAgentEnabledGatewayExposureMode;
} {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join(",") !== "approve,consentChallenge,gatewayMode,scopes"
  ) {
    throw new Error("invalid_request");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.approve !== "boolean" || !Array.isArray(record.scopes)) {
    throw new Error("invalid_request");
  }
  return record as unknown as {
    consentChallenge: unknown;
    approve: boolean;
    scopes: NpAgentScope[];
    gatewayMode: NpAgentEnabledGatewayExposureMode;
  };
}

export async function POST(request: NextRequest) {
  await ensureFor("write");
  let staff;
  try {
    staff = await requireAgentOauthStaff(request);
  } catch (error) {
    return oauthError(error);
  }
  const surface = await getAgentOauthSurface(staff.siteId);
  if (!surface) return agentOauthNotFound();
  try {
    const decision = exactDecision(await readJsonBody(request));
    return oauthJson(
      await surface.oauth.decideAuthorization({
        siteId: staff.siteId,
        actor: staff.actor,
        ...decision,
      }),
    );
  } catch (error) {
    return oauthError(error);
  }
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
