import { Pipe, PipeTransform } from "@angular/core";
import { marked } from "marked";

/**
 * Markdown -> HTML for agent chat replies (code fences, bold, lists, links).
 * Returns a plain string, not a SafeHtml: Angular sanitizes any [innerHTML] binding
 * automatically (strips <script>, on* handlers, javascript: URLs, ...), so the agent's
 * LLM-generated output can't inject markup as long as callers keep using [innerHTML]
 * (not [innerHTML]="... | bypassSecurityTrustHtml", which this deliberately avoids).
 */
@Pipe({ name: "markdown", standalone: true })
export class MarkdownPipe implements PipeTransform {
  transform(content: string): string {
    return marked.parse(content ?? "", { async: false });
  }
}
