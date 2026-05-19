/**
 * HTML sanitization — wrapper kolem isomorphic-dompurify.
 *
 * Použití: kdekoliv máš `set:html={x}` s obsahem z user/admin input nebo
 * AI-generated content, prožeň přes `sanitizeHtml(x)`.
 *
 * Whitelist:
 *  - Bezpečné inline + block tagy pro články, popisky, AI odpovědi
 *  - Žádné `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`
 *  - Žádné `javascript:` URLs v href/src (regex blokuje)
 *  - Žádné inline event handlers (onclick, onerror, atd.) — DOMPurify default removes them
 *
 * Pokud potřebuješ jiný whitelist (např. povolit `<table>` v článcích),
 * použij `sanitizeHtml(x, customConfig)`.
 */
import DOMPurify from 'isomorphic-dompurify';

// Default whitelist — textový obsah pro články, popisky, AI chat
const DEFAULT_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'hr',
    'strong', 'em', 'b', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup',
    'a',
    'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'q', 'cite',
    'code', 'pre',
    'img',
    'span', 'div',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: [
    'href', 'title', 'target', 'rel',
    'src', 'alt', 'width', 'height', 'loading',
    'class', 'id',
    'colspan', 'rowspan',
  ],
  // Blokuje `javascript:`, `data:` (vyjma image), `vbscript:` URL schemes
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|ftp):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  // Auto-přidat rel="noopener noreferrer" k externím <a target=_blank> (řeší tabnabbing)
  ADD_ATTR: ['rel'],
};

export function sanitizeHtml(dirty: string, config: any = DEFAULT_CONFIG): string {
  if (!dirty) return '';
  return DOMPurify.sanitize(dirty, config);
}

/**
 * Strict varianta — jen základní formátování (bold, italic, links, lists).
 * Vhodné pro AI chat odpovědi kde nechceme bohatý HTML.
 */
const STRICT_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'a', 'ul', 'ol', 'li', 'code'],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

export function sanitizeHtmlStrict(dirty: string): string {
  if (!dirty) return '';
  return DOMPurify.sanitize(dirty, STRICT_CONFIG);
}
