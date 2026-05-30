/**
 * pi-web-access — Global web access extension for pi
 *
 * Provides the `web_access` tool with 6 actions:
 *   grok_search, exa_search, zhipu_search, docs, fetch, map
 *
 * Install:
 *   pi install git:github.com/daoguademeng/pi-web-access
 *
 * Configure:
 *   cp web-access.example.json ~/.pi/agent/web-access.json
 *   # edit ~/.pi/agent/web-access.json with your API keys
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { webAccessTool, resetRound } from "./tool.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool(webAccessTool);

  pi.on("turn_start", (_event, ctx) => {
    resetRound();
    ctx.ui.setStatus("web-access", undefined);
  });
}
