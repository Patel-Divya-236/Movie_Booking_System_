import { html } from '../dom.js';

const ICONS = { success: '✓', error: '!', info: 'i' };

export function toast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = html`<span class="toast-icon">${ICONS[type] || ICONS.info}</span><span>${message}</span>`;

  container.appendChild(el);

  const dismiss = () => {
    el.classList.add('toast-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };

  const timer = setTimeout(dismiss, duration);
  el.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
}
