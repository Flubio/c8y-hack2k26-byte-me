import type { FnDef } from './store.ts'

/**
 * Builds the source for Cumulocity Cockpit's "HTML" widget in Advanced mode: a Lit
 * web component module, per the documented contract at
 * https://cumulocity.com/docs/cockpit/widgets-collection/#html
 *   import { LitElement, html, css } from 'lit';
 *   import { styleImports } from 'styles';
 *   export default class extends LitElement { static properties = {...}; render() {...} }
 * Paste the result into: dashboard -> Add widget -> HTML -> enable Advanced mode.
 *
 * Uses Lit's `fetch` import (not the ambient global - the docs call this out to
 * avoid issues) and Lit's `html` tagged template, which auto-escapes every
 * interpolated value, so the live function result can never inject markup.
 *
 * Everything from the function's own record (slug/description/url/example input)
 * is embedded via JSON.stringify'd module-level constants rather than pasted
 * into a template literal directly, so a value containing a backtick or `${`
 * can't break out of the generated source.
 */
export function buildLitWidget(fn: Pick<FnDef, 'slug' | 'description' | 'inputSchema' | 'exampleInput'> & { url: string }): string {
  const className = toClassName(fn.slug)
  const properties = (fn.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
  const fields = Object.keys(properties)
  const example = (fn.exampleInput as Record<string, unknown>) ?? {}

  return `import { LitElement, html, css } from 'lit';
import { styleImports } from 'styles';
import { fetch } from 'fetch'; // platform-provided fetch, not the ambient global

const SLUG = ${json(fn.slug)};
const DESCRIPTION = ${json(fn.description ?? '')};
const FN_URL = ${json(fn.url)};
const FIELDS = ${json(fields)};
const EXAMPLE_INPUT = ${json(example)};

export default class ${className} extends LitElement {
  static styles = css\`
    :host > div { padding: var(--c8y-root-component-padding-default); }
    .description { color: var(--c8y-text-muted, #666); font-size: 12px; margin-bottom: 8px; }
    label { display: block; font-size: 12px; margin: 4px 0 2px; }
    input { width: 100%; box-sizing: border-box; padding: 2px 4px; }
    pre { white-space: pre-wrap; background: var(--c8y-background-muted, #f5f5f5); padding: 8px; margin-top: 8px; max-height: 260px; overflow: auto; }
    .error { color: var(--c8y-danger, #c00); }
  \`;

  static properties = {
    input: { type: Object },
    value: { type: Object },
    error: { type: String },
    loading: { type: Boolean },
  };

  constructor() {
    super();
    this.input = { ...EXAMPLE_INPUT };
    this.value = null;
    this.error = null;
    this.loading = true;
  }

  connectedCallback() {
    super.connectedCallback();
    this.run();
  }

  updateField(key, raw) {
    this.input = { ...this.input, [key]: raw };
  }

  async run() {
    this.loading = true;
    this.error = null;
    try {
      const params = new URLSearchParams();
      for (const key of FIELDS) {
        if (this.input[key]) params.set(key, this.input[key]);
      }
      const qs = params.toString();
      const res = await fetch(FN_URL + (qs ? '?' + qs : ''));
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || JSON.stringify(body));
      this.value = body;
    } catch (e) {
      this.error = e?.message ?? String(e);
    } finally {
      this.loading = false;
    }
  }

  render() {
    return html\`
      <style>\${styleImports}</style>
      <div>
        <strong>\${SLUG}</strong>
        \${DESCRIPTION ? html\`<div class="description">\${DESCRIPTION}</div>\` : ''}
        \${FIELDS.map(key => html\`
          <label>\${key}
            <input .value=\${String(this.input[key] ?? '')} @input=\${e => this.updateField(key, e.target.value)}>
          </label>
        \`)}
        <button @click=\${this.run}>\${this.loading ? 'Loading…' : 'Refresh'}</button>
        \${this.error ? html\`<div class="error">\${this.error}</div>\` : ''}
        \${!this.error ? html\`<pre>\${JSON.stringify(this.value, null, 2)}</pre>\` : ''}
      </div>
    \`;
  }
}
`
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null)
}

/** slug (kebab-case, [a-z0-9-]) -> a valid, unique-enough JS class identifier. */
function toClassName(slug: string): string {
  const pascal = slug
    .split('-')
    .filter(Boolean)
    .map(part => part[0]!.toUpperCase() + part.slice(1))
    .join('')
  return /^[A-Za-z_$]/.test(pascal) ? `${pascal}Widget` : `Fn${pascal}Widget`
}
