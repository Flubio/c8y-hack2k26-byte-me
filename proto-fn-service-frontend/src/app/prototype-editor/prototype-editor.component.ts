import { Component, ElementRef, ViewChild } from "@angular/core";
import { NgFor, NgIf } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import byteMeLogo from "../../assets/byte-me-logo.png";
import { AlertService, ContextRouteService, ViewContext, getActivatedRoute } from "@c8y/ngx-components";
import { ChatMessage, FunctionMeta, PrototypeEditorService } from "./prototype-editor.service";
import { MarkdownPipe } from "./markdown.pipe";

// Keeps both the localStorage payload and the per-turn request to the agent bounded -
// without a cap, a long-lived persisted chat would grow both indefinitely.
const MAX_STORED_MESSAGES = 40;
const CONTEXT_PREFIX = "[Context: current Cockpit dashboard id = ";

@Component({
  selector: "t3k-prototype-editor",
  templateUrl: "./prototype-editor.component.html",
  styleUrl: "./prototype-editor.component.less",
  imports: [FormsModule, NgFor, NgIf, MarkdownPipe],
})
export class PrototypeEditorComponent {
  @ViewChild("widgetDialog") widgetDialog!: ElementRef<HTMLDialogElement>;

  messages: ChatMessage[] = [];
  chatInput = "";
  isSending = false;

  functions: FunctionMeta[] = [];
  isLoadingFunctions = false;
  selectedSlug = "";
  generatedWidget = "";
  isGeneratingWidget = false;

  readonly byteMeLogo = byteMeLogo;

  private readonly storageKey: string;

  constructor(
    private prototypeEditorService: PrototypeEditorService,
    private alertService: AlertService,
    private router: Router,
    private contextRouteService: ContextRouteService,
  ) {
    // Scoped per dashboard (falling back to a generic key when no dashboard context
    // resolves) so switching dashboards doesn't show a stale, unrelated conversation.
    this.storageKey = `pfn-chat:${this.getDashboardId() ?? "default"}`;
    this.messages = this.loadMessages();
  }

  private loadMessages(): ChatMessage[] {
    try {
      const raw = localStorage.getItem(this.storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
    } catch (error) {
      console.error("Unable to load persisted chat:", error);
      return [];
    }
  }

  private saveMessages() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.messages));
    } catch (error) {
      console.error("Unable to persist chat:", error);
    }
  }

  clearChat() {
    this.messages = [];
    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
      console.error("Unable to clear persisted chat:", error);
    }
  }

  handleChatKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.sendChat();
    }
  }

  /**
   * This widget lives inside the dashboard it should target, so read the id instead of
   * making the user copy it out of the address bar, as the reference MCP-widget tutorial
   * does. Widgets are dynamically instantiated by Cockpit's dashboard host, not declared
   * as routed components, so plain `ActivatedRoute` injection into this component isn't
   * reliable - `getActivatedRoute(router)` is the framework's own documented workaround
   * for exactly that ("ActivatedRoute injection only works in components"). Falls back
   * to a plain regex on the URL if the context service doesn't resolve a Dashboard
   * context (e.g. the widget isn't actually on a dashboard route) - unverified against
   * a live tenant either way, hence the fallback rather than trusting either alone.
   */
  private getDashboardId(): string | null {
    try {
      const context = this.contextRouteService.getContextData(getActivatedRoute(this.router));
      if (context?.context === ViewContext.Dashboard && context.contextData?.id != null) {
        return String(context.contextData.id);
      }
    } catch (error) {
      console.error("ContextRouteService could not resolve the dashboard context:", error);
    }
    return this.router.url.match(/dashboard\/([^/?#]+)/)?.[1] ?? null;
  }

  /**
   * Forces the current route's component tree (the dashboard we're sitting on) to be
   * torn down and recreated, so a tile the agent just added shows up immediately. Angular
   * skips re-resolving a navigation to the same URL by default, so the reuse strategy is
   * disabled just for this one navigation rather than doing a full `location.reload()`.
   */
  private reloadDashboardRoute() {
    const originalShouldReuseRoute = this.router.routeReuseStrategy.shouldReuseRoute;
    this.router.routeReuseStrategy.shouldReuseRoute = () => false;
    this.router
      .navigateByUrl(this.router.url, { onSameUrlNavigation: "reload", skipLocationChange: true })
      .finally(() => {
        this.router.routeReuseStrategy.shouldReuseRoute = originalShouldReuseRoute;
      });
  }

  async sendChat() {
    const content = this.chatInput.trim();
    if (!content || this.isSending) {
      return;
    }

    this.messages = [...this.messages, { role: "user" as const, content }].slice(-MAX_STORED_MESSAGES);
    this.chatInput = "";
    this.isSending = true;
    this.saveMessages();
    try {
      // Stamp the dashboard id onto every turn's wire payload (never into the stored/
      // displayed message - see CONTEXT_PREFIX's other use). "Stamp only the first turn"
      // doesn't work here: the stamp lives only in this ephemeral copy, never written back
      // into `this.messages`, so a persisted or MAX_STORED_MESSAGES-capped history can
      // never prove context was already given - re-stamping each turn is cheap (one line)
      // and the only way that's actually robust against both.
      // The agent's API rejects any message with empty text content (a tool-only turn can
      // leave a stored assistant reply blank - see the fallback below) - drop those here so
      // one bad turn doesn't permanently 400 every turn after it for the life of the history.
      const nonEmptyMessages = this.messages.filter((m) => m.content.trim().length > 0);
      const dashboardId = this.getDashboardId();
      const wireMessages = dashboardId
        ? nonEmptyMessages.map((m, i) =>
            i === nonEmptyMessages.length - 1
              ? { ...m, content: `${CONTEXT_PREFIX}${dashboardId}. Use this dashboard for any dashboard-widget tools unless told otherwise.]\n\n${m.content}` }
              : m,
          )
        : nonEmptyMessages;
      const reply = await this.prototypeEditorService.sendChatMessage(wireMessages);
      this.messages = [...this.messages, { role: "assistant" as const, content: reply.trim() || "(no reply text)" }].slice(
        -MAX_STORED_MESSAGES,
      );
      // The agent may have just called add_widget_to_dashboard - re-resolve this dashboard's
      // route in place so a newly added tile shows up without the user hitting F5.
      if (dashboardId) {
        this.reloadDashboardRoute();
      }
    } catch (error) {
      console.error("Unable to reach the agent:", error);
      this.messages = [
        ...this.messages,
        { role: "assistant" as const, content: "Something went wrong reaching the agent. Please try again." },
      ].slice(-MAX_STORED_MESSAGES);
      this.alertService.danger("Unable to reach the agent.");
    } finally {
      this.isSending = false;
      this.saveMessages();
    }
  }

  async openWidgetDialog() {
    this.generatedWidget = "";
    this.widgetDialog.nativeElement.showModal();
    this.isLoadingFunctions = true;
    try {
      this.functions = await this.prototypeEditorService.listFunctions();
      this.selectedSlug = this.functions[0]?.slug ?? "";
    } catch (error) {
      console.error("Unable to load functions:", error);
      this.alertService.danger("Unable to load deployed functions.");
    } finally {
      this.isLoadingFunctions = false;
    }
  }

  async generateWidget() {
    if (!this.selectedSlug || this.isGeneratingWidget) {
      return;
    }
    this.isGeneratingWidget = true;
    try {
      this.generatedWidget = await this.prototypeEditorService.getWidgetSnippet(this.selectedSlug);
    } catch (error) {
      console.error("Unable to generate widget:", error);
      this.alertService.danger("Unable to generate the widget.");
    } finally {
      this.isGeneratingWidget = false;
    }
  }

  async copyWidget() {
    try {
      await navigator.clipboard.writeText(this.generatedWidget);
      this.alertService.success("Copied. Paste it into an HTML widget with Advanced mode enabled.");
    } catch (error) {
      console.error("Unable to copy to clipboard:", error);
      this.alertService.danger("Unable to copy - select and copy the text manually.");
    }
  }

  closeWidgetDialog() {
    this.widgetDialog.nativeElement.close();
  }
}
