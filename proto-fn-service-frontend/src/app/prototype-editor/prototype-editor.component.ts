import { Component, ElementRef, ViewChild } from "@angular/core";
import { NgFor, NgIf } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import byteMeLogo from "../../assets/byte-me-logo.png";
import { AlertService, ContextRouteService, ViewContext, getActivatedRoute } from "@c8y/ngx-components";
import { ChatMessage, FunctionMeta, PrototypeEditorService } from "./prototype-editor.service";
import { MarkdownPipe } from "./markdown.pipe";

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

  constructor(
    private prototypeEditorService: PrototypeEditorService,
    private alertService: AlertService,
    private router: Router,
    private contextRouteService: ContextRouteService,
  ) {}

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

  async sendChat() {
    const content = this.chatInput.trim();
    if (!content || this.isSending) {
      return;
    }

    this.messages = [...this.messages, { role: "user", content }];
    this.chatInput = "";
    this.isSending = true;
    try {
      // The dashboard id is context for the agent's tools, not something the user typed -
      // stamp it onto the first turn's wire payload without polluting the visible transcript.
      const dashboardId = this.getDashboardId();
      const wireMessages =
        dashboardId && this.messages.length === 1
          ? [{ role: "user" as const, content: `[Context: current Cockpit dashboard id = ${dashboardId}. Use this dashboard for any dashboard-widget tools unless told otherwise.]\n\n${content}` }]
          : this.messages;
      const reply = await this.prototypeEditorService.sendChatMessage(wireMessages);
      this.messages = [...this.messages, { role: "assistant", content: reply }];
    } catch (error) {
      console.error("Unable to reach the agent:", error);
      this.messages = [
        ...this.messages,
        { role: "assistant", content: "Something went wrong reaching the agent. Please try again." },
      ];
      this.alertService.danger("Unable to reach the agent.");
    } finally {
      this.isSending = false;
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
