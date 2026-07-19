import { buildPageMetadata } from "@nexpress/next";
import type { NpRouteRenderProps } from "@nexpress/next";

import {
  getForumMessages,
  listForumBoards,
  resolveForumSkin,
  type NpForumRuntime,
} from "../runtime.js";

export function createBoardIndexMetadata(runtime: NpForumRuntime) {
  return async function boardIndexMetadata() {
    const messages = await getForumMessages();
    return buildPageMetadata({
      title: messages.boards,
      description: "Community boards",
      path: runtime.basePath,
    });
  };
}

export function createBoardIndexRoute(runtime: NpForumRuntime) {
  return async function BoardIndexRoute(_props: NpRouteRenderProps) {
    const [boards, messages] = await Promise.all([listForumBoards(runtime), getForumMessages()]);
    return resolveForumSkin(runtime).renderBoardIndex({
      basePath: runtime.basePath,
      boards,
      messages,
    });
  };
}
