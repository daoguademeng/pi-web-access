/**
 * Type augmentation for pi ExtensionAPI — adds missing event names
 * that exist at runtime but aren't in the published type definitions.
 */

declare module "@earendil-works/pi-coding-agent" {
  interface ExtensionAPI {
    on(
      event: "turn_start" | "turn_end" | "session_start" | "session_end"
        | "before_agent_start" | "agent_end" | "agent_start"
        | "tool_result" | "session_before_fork",
      callback: (event: unknown, ctx: ExtensionContext) => void | Promise<void>,
    ): void;
  }
}

// Re-import ExtensionContext for use in the augmentation
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
