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
   * Sends the full conversation to the c8y-fn-author agent and streams the reply back.
   * With `fullResponse=true` + `Accept: text/event-stream` the AI Agent Manager answers with
   * SSE `data: {...}` events (https://cumulocity.com/docs/ai/rest-api/#streaming):
   * `text-delta` chunks for the reply, `tool-*` events while the agent runs tools, `error`.
   * Falls back to parsing a plain / JSON body if the server doesn't stream.
   */
  async streamChatMessage(messages: ChatMessage[], handlers: StreamHandlers): Promise<string> {
    const response = await this.fetchClient.fetch(`/service/ai/agent/text/c8y-fn-author`, {
      method: "POST",
      params: { fullResponse: true },
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ messages }),
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("event-stream") || !response.body) {
      const reply = contentType.includes("json") ? extractReply(await response.json()) : await response.text();
      handlers.onText(reply);
      return reply;
    }

    let reply = "";
    const handleEvent = (raw: string) => {
      const data = raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!data || data === "[DONE]") {
        return;
      }
      const event = JSON.parse(data) as StreamEvent;
      if (event.type === "text-delta" && typeof event.text === "string") {
        reply += event.text;
        handlers.onText(reply);
      } else if (event.type.startsWith("tool-") && event.toolName) {
        handlers.onTool?.(event.toolName);
      } else if (event.type === "error") {
        throw new Error(event.errorText ?? "Agent stream reported an error");
      }
    };

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += value.replace(/\r\n/g, "\n");
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      events.forEach(handleEvent);
    }
    handleEvent(buffer);
    return reply;
  }
}

export interface StreamHandlers {
  /** Called with the full reply text so far after every chunk. */
  onText: (replySoFar: string) => void;
  /** Called with a tool name whenever the agent starts / finishes a tool call. */
  onTool?: (toolName: string) => void;
}

interface StreamEvent {
  type: string;
  text?: string;
  toolName?: string;
  errorText?: string;
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
