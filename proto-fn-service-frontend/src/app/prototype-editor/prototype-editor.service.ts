import { Injectable } from "@angular/core";
import { FetchClient } from "@c8y/client";

// proto-fn-service's contextPath (see nitro.config.ts there) - keep in sync if that changes
const PROTO_FN_BASE = "/service/proto-fn";

export interface FunctionMeta {
  slug: string;
  description?: string;
  inputSchema?: unknown;
  exampleInput?: unknown;
  exampleOutput?: unknown;
  allowWrite: boolean;
  version: number;
  updatedAt: string;
  url: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

@Injectable({ providedIn: "root" })
export class PrototypeEditorService {
  public constructor(private fetchClient: FetchClient) {}

  async listFunctions(): Promise<FunctionMeta[]> {
    const response = await this.fetchClient.fetch(`${PROTO_FN_BASE}/functions`);
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  /** Ready-to-paste Cockpit HTML-widget (Advanced mode) source for a deployed function. */
  async getWidgetSnippet(slug: string): Promise<string> {
    const response = await this.fetchClient.fetch(`${PROTO_FN_BASE}/functions/${encodeURIComponent(slug)}/widget`);
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  /**
   * Sends the full conversation to the c8y-fn-author agent and returns its reply text.
   * The agent's own response shape isn't verified against a live tenant yet - this
   * defensively handles the shapes it plausibly returns and falls back to raw JSON.
   */
  async sendChatMessage(messages: ChatMessage[]): Promise<string> {
    const response = await this.fetchClient.fetch(`/service/ai/agent/text/c8y-fn-author`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      return response.text();
    }

    const body = await response.json();
    return extractReply(body);
  }
}

function extractReply(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record["content"] === "string") {
      return record["content"];
    }
    if (typeof record["reply"] === "string") {
      return record["reply"];
    }
    if (typeof record["text"] === "string") {
      return record["text"];
    }
    if (Array.isArray(record["messages"])) {
      const last = [...record["messages"]].reverse().find((m) => m && typeof m === "object" && m.role !== "user");
      if (last && typeof last.content === "string") {
        return last.content;
      }
    }
  }
  return JSON.stringify(body, null, 2);
}
