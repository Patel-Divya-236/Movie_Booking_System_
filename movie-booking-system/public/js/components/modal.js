/**
 * Modal host. One element is reused for every dialog; `openModal` returns a
 * handle so callers can update or close it.
 *
 * Closing always runs the caller's onClose — the trailer relies on that to
 * blank the iframe src so audio stops.
 */

import { raw } from '../dom.js';

let active = null;

function ensureHost() {
  let host = document.getElementById('modalHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'modalHost';
    document.body.appendChild(host);
  }
  return host;
}

export function closeModal() {
  if (!active) return;
  const { host, onClose, keyHandler } = active;
  document.removeEventListener('keydown', keyHandler);
  document.body.classList.remove('modal-open');
  host.innerHTML = '';
  active = null;
  if (onClose) onClose();
}

export function openModal({ title = '', body = '', size = 'md', dismissable = true, onClose = null, onMount = null }) {
  closeModal();

  const host = ensureHost();
  host.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <div class="modal modal-${size}" role="dialog" aria-modal="true" ${title ? 'aria-label="' + title.replace(/"/g, '') + '"' : ''}>
        ${title || dismissable ? `
          <div class="modal-head">
            <h3 class="modal-title">${title}</h3>
            ${dismissable ? '<button class="modal-close" data-modal-close aria-label="Close">✕</button>' : ''}
          </div>` : ''}
        <div class="modal-body" data-modal-body>${body}</div>
      </div>
    </div>`;

  document.body.classList.add('modal-open');

  const keyHandler = e => { if (e.key === 'Escape' && dismissable) closeModal(); };
  document.addEventListener('keydown', keyHandler);

  active = { host, onClose, keyHandler };

  if (dismissable) {
    host.querySelector('[data-modal-backdrop]').addEventListener('click', e => {
      if (e.target.hasAttribute('data-modal-backdrop')) closeModal();
    });
    host.querySelector('[data-modal-close]')?.addEventListener('click', closeModal);
  }

  const bodyEl = host.querySelector('[data-modal-body]');
  if (onMount) onMount(bodyEl);

  return {
    element: bodyEl,
    setBody(markup) { bodyEl.innerHTML = markup instanceof Object ? String(markup) : markup; },
    close: closeModal,
  };
}

export { raw };
