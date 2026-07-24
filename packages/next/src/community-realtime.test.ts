import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reactState = vi.hoisted(() => ({
  cleanups: [] as Array<() => void>,
}));

vi.mock("react", () => ({
  useEffect(effect: () => void | (() => void)) {
    const cleanup = effect();
    if (cleanup) reactState.cleanups.push(cleanup);
  },
}));

import { npCommunityDocumentEventsUrl, useCommunityRealtime } from "./community-realtime.js";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readonly withCredentials: boolean;
  closed = false;
  readyState = FakeEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL, init?: EventSourceInit) {
    this.url = String(url);
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
}

describe("community realtime client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    reactState.cleanups.splice(0).forEach((cleanup) => cleanup());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("builds an encoded, validated document subscription URL", () => {
    expect(npCommunityDocumentEventsUrl("forum-posts", TARGET_ID)).toBe(
      `/api/community/events?scope=document&targetType=forum-posts&targetId=${TARGET_ID}`,
    );
    expect(() => npCommunityDocumentEventsUrl("Forum posts", TARGET_ID)).toThrow(
      /canonical collection slug/u,
    );
  });

  it("refreshes on connect and exact events, then polls during native resume", async () => {
    const onInvalidate = vi.fn();
    useCommunityRealtime({
      url: npCommunityDocumentEventsUrl("posts", TARGET_ID),
      onInvalidate,
    });

    const first = FakeEventSource.instances[0];
    expect(first).toMatchObject({ withCredentials: true, closed: false });
    if (first) first.readyState = FakeEventSource.OPEN;
    first?.onopen?.(new Event("open"));
    await vi.advanceTimersByTimeAsync(150);
    expect(onInvalidate).toHaveBeenLastCalledWith({ kind: "connected", id: null });

    first?.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          version: 1,
          id: EVENT_ID,
          kind: "comments.changed",
          occurredAt: "2026-07-23T00:00:00.000Z",
        }),
      }),
    );
    await vi.advanceTimersByTimeAsync(150);
    expect(onInvalidate).toHaveBeenLastCalledWith({
      version: 1,
      id: EVENT_ID,
      kind: "comments.changed",
      occurredAt: "2026-07-23T00:00:00.000Z",
    });

    if (first) first.readyState = FakeEventSource.CONNECTING;
    first?.onerror?.(new Event("error"));
    expect(first?.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(15_150);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(onInvalidate).toHaveBeenLastCalledWith({ kind: "poll", id: null });
  });

  it("fails closed to polling when an SSE payload is malformed", async () => {
    const onInvalidate = vi.fn();
    useCommunityRealtime({
      url: npCommunityDocumentEventsUrl("posts", TARGET_ID),
      onInvalidate,
      pollIntervalMs: 5_000,
    });
    const source = FakeEventSource.instances[0];
    source?.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ version: 1, kind: "comments.changed" }),
      }),
    );
    expect(source?.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_150);
    expect(onInvalidate).toHaveBeenCalledWith({ kind: "poll", id: null });
  });

  it("serializes refreshes and replays the latest queued invalidation", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstRefresh = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const onInvalidate = vi
      .fn()
      .mockImplementationOnce(() => firstRefresh)
      .mockResolvedValue(undefined);
    useCommunityRealtime({
      url: npCommunityDocumentEventsUrl("posts", TARGET_ID),
      onInvalidate,
    });
    const source = FakeEventSource.instances[0];
    source?.onopen?.(new Event("open"));
    await vi.advanceTimersByTimeAsync(150);
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    source?.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          version: 1,
          id: EVENT_ID,
          kind: "reactions.changed",
          occurredAt: "2026-07-23T00:00:00.000Z",
        }),
      }),
    );
    await vi.advanceTimersByTimeAsync(150);
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(onInvalidate).toHaveBeenLastCalledWith({
      version: 1,
      id: EVENT_ID,
      kind: "reactions.changed",
      occurredAt: "2026-07-23T00:00:00.000Z",
    });
  });
});
