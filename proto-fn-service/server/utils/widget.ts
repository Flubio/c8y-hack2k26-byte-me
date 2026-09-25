import type { FnDef } from './store.ts'

/**
 * Builds the source for Cumulocity Cockpit's "HTML" widget in Advanced mode: a Lit
 * web component module, per the documented contract at
 * https://cumulocity.com/docs/cockpit/widgets-collection/#html
 *   import { LitElement } from 'lit';
 *   export default class extends LitElement { static properties = {...}; render() {...} }
 * Paste the result into: dashboard -> Add widget -> HTML -> enable Advanced mode.
 *
 * Uses Lit's `fetch` import (not the ambient global - the docs call this out to
 * avoid issues). It builds DOM nodes with textContent rather than HTML strings,
 * so function results and metadata cannot inject markup.
 *
 * Everything from the function's own record (slug/description/url/example input)
 * is UTF-8/Base64 encoded before embedding it and decoded in the browser. This
 * leaves only a parser-safe alphabet in the generated module, including when
 * Cockpit handles the source more than once.
 *
 * Cockpit's editor has rejected template literals in generated widgets. The
 * output therefore contains no backticks at all: Lit accepts a DOM Node as the
 * value returned from render(), so the component is still contract-compliant.
 */
export function buildLitWidget(fn: Pick<FnDef, 'slug' | 'description' | 'inputSchema' | 'exampleInput'> & { url: string }): string {
  const className = toClassName(fn.slug)
  const properties = (fn.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
  const fields = Object.keys(properties)
  const example = (fn.exampleInput as Record<string, unknown>) ?? {}

  return `import { LitElement } from 'lit';
import { fetch } from 'fetch'; // platform-provided fetch, not the ambient global

function decodeJson(encoded) {
  const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

const SLUG = decodeJson('${encodedJson(fn.slug)}');
const DESCRIPTION = decodeJson('${encodedJson(fn.description ?? '')}');
const FN_URL = decodeJson('${encodedJson(fn.url)}');
const FIELDS = decodeJson('${encodedJson(fields)}');
const EXAMPLE_INPUT = decodeJson('${encodedJson(example)}');

export default class ${className} extends LitElement {
  constructor() {
    super();
    this.input = { ...EXAMPLE_INPUT };
    this.value = null;
    this.error = null;
    this.loading = true;
    this.root = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.run();
  }

  updateField(key, raw) {
    this.input = { ...this.input, [key]: raw };
  }

  createRoot() {
    const root = document.createElement('div');
    root.style.padding = 'var(--c8y-root-component-padding-default)';

    const title = document.createElement('strong');
    title.textContent = SLUG;
    root.append(title);

    if (DESCRIPTION) {
      const description = document.createElement('div');
      description.textContent = DESCRIPTION;
      description.style.color = 'var(--c8y-text-muted, #666)';
      description.style.fontSize = '12px';
      description.style.marginBottom = '8px';
      root.append(description);
    }

    for (const key of FIELDS) {
      const label = document.createElement('label');
      label.textContent = key;
      label.style.display = 'block';
      label.style.fontSize = '12px';
      label.style.margin = '4px 0 2px';

      const input = document.createElement('input');
      input.type = 'text';
      input.value = String(this.input[key] ?? '');
      input.style.width = '100%';
      input.style.boxSizing = 'border-box';
      input.style.padding = '2px 4px';
      input.addEventListener('input', event => this.updateField(key, event.target.value));
      label.append(input);
      root.append(label);
    }

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.addEventListener('click', () => this.run());
    root.append(this.button);

    this.errorElement = document.createElement('div');
    this.errorElement.style.color = 'var(--c8y-danger, #c00)';
    root.append(this.errorElement);

    this.resultElement = document.createElement('pre');
    this.resultElement.style.whiteSpace = 'pre-wrap';
    this.resultElement.style.background = 'var(--c8y-background-muted, #f5f5f5)';
    this.resultElement.style.padding = '8px';
    this.resultElement.style.marginTop = '8px';
    this.resultElement.style.maxHeight = '260px';
    this.resultElement.style.overflow = 'auto';
    root.append(this.resultElement);
    return root;
  }

  sync() {
    if (!this.root) return;
    this.button.textContent = this.loading ? 'Loading…' : 'Refresh';
    this.errorElement.textContent = this.error ?? '';
    this.errorElement.hidden = !this.error;
    this.resultElement.hidden = Boolean(this.error) || this.value === null;
    this.resultElement.textContent = this.value === null ? '' : JSON.stringify(this.value, null, 2);
  }

  async run() {
    this.loading = true;
    this.error = null;
    this.sync();
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
      this.sync();
    }
  }

  render() {
    this.root ??= this.createRoot();
    this.sync();
    return this.root;
  }
}
`
}

function encodedJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value ?? null), 'utf8').toString('base64')
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
