/**
 * DOM and formatting helpers.
 *
 * The `html` tagged template escapes every interpolated value by default, so
 * a movie title or a user's name can't inject markup. Anything that really is
 * markup has to be wrapped in raw() explicitly — which makes the unsafe path
 * visible at the call site instead of being the default.
 */

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class Raw {
  constructor(value) { this.value = value; }
}

/** Mark a string as already-safe markup. */
export const raw = value => new Raw(value);

function serialize(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(serialize).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += serialize(values[i]) + strings[i + 1];
  return out;
}

// ------------------------------------------------------------- selectors

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Delegated listener — survives the innerHTML re-renders the views do. */
export function on(root, event, selector, handler) {
  root.addEventListener(event, e => {
    const match = e.target.closest(selector);
    if (match && root.contains(match)) handler(e, match);
  });
}

// ------------------------------------------------------------ formatting

export function rupees(amount) {
  return `₹${Number(amount || 0).toLocaleString('en-IN')}`;
}

export function formatDate(value, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString('en-IN', opts);
}

export function formatDateTime(value) {
  return new Date(value).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** "Today" / "Tomorrow" / "Mon 4" for the date strip. */
export function dayLabel(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((date - today) / 86400000);
  if (diff === 0) return { top: 'TODAY', bottom: formatDate(date, { day: 'numeric', month: 'short' }) };
  if (diff === 1) return { top: 'TOMORROW', bottom: formatDate(date, { day: 'numeric', month: 'short' }) };
  return {
    top: date.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase(),
    bottom: formatDate(date, { day: 'numeric', month: 'short' }),
  };
}

/** YouTube watch/share/embed URL -> bare video id. */
export function youtubeId(url) {
  if (!url) return null;
  const match = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

export function initials(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

// --------------------------------------------------------------- markup

export function spinner() {
  return html`<div class="spinner" role="status" aria-label="Loading"></div>`;
}

/** Skeleton placeholders — steadier than a spinner while cards load. */
export function skeletonGrid(count = 8) {
  return raw(Array.from({ length: count }, () => `
    <div class="skeleton-card">
      <div class="skeleton skeleton-poster"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line short"></div>
    </div>`).join(''));
}

export function emptyState({ icon = '🎬', title, message, action }) {
  return html`
    <div class="empty-state">
      <div class="empty-icon">${icon}</div>
      <h3>${title}</h3>
      <p>${message}</p>
      ${action ? raw(action) : ''}
    </div>`;
}
