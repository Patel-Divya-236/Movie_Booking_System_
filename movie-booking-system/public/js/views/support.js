import { html, raw, spinner, emptyState, formatDateTime } from '../dom.js';
import { state, isAdmin } from '../state.js';
import { api } from '../api.js';
import { toast } from '../components/toast.js';
import * as router from '../router.js';

const STATUS_LABEL = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

const categoryLabel = id =>
  state.config?.supportCategories?.find(c => c.id === id)?.label || id;

function ticketRow(ticket) {
  const last = ticket.messages[ticket.messages.length - 1];
  return html`
    <a class="ticket-row" href="/support/${ticket.ticketId}">
      <div class="ticket-row-main">
        <div class="ticket-row-head">
          <strong>${ticket.subject}</strong>
          <span class="status-pill is-${ticket.status}">${STATUS_LABEL[ticket.status]}</span>
        </div>
        <p class="ticket-row-meta">
          ${ticket.ticketRef} · ${categoryLabel(ticket.category)}
          ${ticket.bookingRef ? ` · booking ${ticket.bookingRef}` : ''}
          ${isAdmin() ? ` · ${ticket.userName} <${ticket.userEmail}>` : ''}
        </p>
        <p class="ticket-row-preview">
          <span class="ticket-from">${last.from === 'support' ? 'Support' : last.author}:</span>
          ${last.body.slice(0, 110)}${last.body.length > 110 ? '…' : ''}
        </p>
      </div>
      <div class="ticket-row-side">
        ${ticket.priority === 'high' ? raw(html`<span class="priority-flag">High</span>`) : ''}
        <span class="ticket-time">${formatDateTime(ticket.updatedAt)}</span>
      </div>
    </a>`;
}

// ------------------------------------------------------------------ list

export async function renderSupport(container) {
  const admin = isAdmin();

  container.innerHTML = html`
    <div class="page-head">
      <h1>${admin ? 'Support queue' : 'Help & support'}</h1>
      <p>${admin
        ? 'Requests raised by customers'
        : 'Something wrong with a booking or the site? Tell us and we will get back to you by email.'}</p>
    </div>

    <div class="support-bar">
      ${admin
        ? raw(html`
          <div class="chip-row" id="statusChips">
            ${raw(['all', 'open', 'in_progress', 'resolved', 'closed'].map((s, i) => html`
              <button class="chip ${i === 0 ? 'is-active' : ''}" data-status="${s}">
                ${s === 'all' ? 'All' : STATUS_LABEL[s]}
              </button>`).join(''))}
          </div>`)
        : raw(html`<a class="btn btn-primary" href="/support/new">+ New request</a>`)}
    </div>

    <div id="ticketHost">${raw(spinner())}</div>`;

  const host = container.querySelector('#ticketHost');
  let tickets = [];

  function paint(filter = 'all') {
    const list = filter === 'all' ? tickets : tickets.filter(t => t.status === filter);
    host.innerHTML = list.length
      ? `<div class="ticket-list">${list.map(ticketRow).join('')}</div>`
      : emptyState({
          icon: '💬',
          title: admin ? 'Nothing in the queue' : 'No requests yet',
          message: admin
            ? 'Customer requests will appear here.'
            : "If something isn't working, raise a request and we'll help.",
          action: admin ? '' : '<a class="btn btn-primary" href="/support/new" style="margin-top:16px">Raise a request</a>',
        });
  }

  try {
    tickets = await api.supportTickets();
    paint();
  } catch (err) {
    host.innerHTML = emptyState({ icon: '⚠️', title: 'Could not load requests', message: err.message });
    return;
  }

  container.querySelector('#statusChips')?.addEventListener('click', e => {
    const chip = e.target.closest('[data-status]');
    if (!chip) return;
    container.querySelectorAll('#statusChips .chip')
      .forEach(c => c.classList.toggle('is-active', c === chip));
    paint(chip.dataset.status);
  });
}

// -------------------------------------------------------------- new ticket

export async function renderNewTicket(container) {
  const categories = state.config?.supportCategories || [];

  let bookings = [];
  try { bookings = await api.bookings(); } catch { /* optional field */ }

  container.innerHTML = html`
    <a class="back-link" href="/support">← Back to support</a>

    <div class="support-form-card">
      <h2>Raise a request</h2>
      <p class="auth-sub">Tell us what went wrong and we'll reply to ${state.user?.email}.</p>

      <form id="ticketForm">
        <div class="field">
          <label>What's it about?</label>
          <div class="category-grid" id="categoryGrid">
            ${raw(categories.map((c, i) => html`
              <button type="button" class="category-option ${i === 0 ? 'is-active' : ''}" data-category="${c.id}">
                <strong>${c.label}</strong>
                <small>${c.hint}</small>
              </button>`).join(''))}
          </div>
        </div>

        <div class="field">
          <label for="subject">Subject</label>
          <input id="subject" required maxlength="120" placeholder="Short summary of the problem">
        </div>

        ${bookings.length ? raw(html`
          <div class="field">
            <label for="bookingRef">Related booking (optional)</label>
            <select id="bookingRef">
              <option value="">Not about a specific booking</option>
              ${raw(bookings.map(b => html`
                <option value="${b.bookingRef}">${b.bookingRef} — ${b.movieTitle} (${b.date})</option>`).join(''))}
            </select>
          </div>`) : ''}

        <div class="field">
          <label for="message">What happened?</label>
          <textarea id="message" rows="6" required minlength="15" maxlength="4000"
            placeholder="Include anything useful — what you were doing, what you expected, and any error message you saw."></textarea>
          <small class="field-hint"><span id="charCount">0</span> / 4000</small>
        </div>

        <button type="submit" class="btn btn-primary btn-block btn-lg" id="submitTicket">Send request</button>
      </form>
    </div>`;

  let category = categories[0]?.id || 'other';

  container.querySelector('#categoryGrid').addEventListener('click', e => {
    const btn = e.target.closest('[data-category]');
    if (!btn) return;
    category = btn.dataset.category;
    container.querySelectorAll('.category-option')
      .forEach(b => b.classList.toggle('is-active', b === btn));
  });

  const message = container.querySelector('#message');
  const counter = container.querySelector('#charCount');
  message.addEventListener('input', () => { counter.textContent = message.value.length; });

  container.querySelector('#ticketForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = container.querySelector('#submitTicket');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const res = await api.raiseTicket({
        category,
        subject: container.querySelector('#subject').value,
        message: message.value,
        bookingRef: container.querySelector('#bookingRef')?.value || '',
      });
      toast(`Request raised — ${res.ticketRef}`, 'success');
      router.go(`/support/${res.ticketId}`, { replace: true });
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Send request';
    }
  });
}

// ------------------------------------------------------------------ thread

export async function renderTicket(container, { params }) {
  container.innerHTML = spinner();

  let ticket;
  try {
    ticket = await api.supportTicket(params.ticketId);
  } catch (err) {
    container.innerHTML = emptyState({ icon: '⚠️', title: 'Request not found', message: err.message });
    return;
  }

  const admin = isAdmin();
  const closed = ticket.status === 'closed';

  container.innerHTML = html`
    <a class="back-link" href="/support">← Back to support</a>

    <div class="ticket-head">
      <div>
        <h1>${ticket.subject}</h1>
        <p class="ticket-head-meta">
          ${ticket.ticketRef} · ${categoryLabel(ticket.category)}
          ${ticket.bookingRef ? ` · booking ${ticket.bookingRef}` : ''}
          · raised ${formatDateTime(ticket.createdAt)}
          ${admin ? ` · ${ticket.userName} <${ticket.userEmail}>` : ''}
        </p>
      </div>
      <span class="status-pill is-${ticket.status}">${STATUS_LABEL[ticket.status]}</span>
    </div>

    ${admin ? raw(html`
      <div class="admin-actions">
        <label>Status</label>
        <select id="statusSelect">
          ${raw((state.config?.supportStatuses || []).map(s => html`
            <option value="${s}" ${raw(s === ticket.status ? 'selected' : '')}>${STATUS_LABEL[s]}</option>`).join(''))}
        </select>
        <label>Priority</label>
        <select id="prioritySelect">
          ${raw(['low', 'normal', 'high'].map(p => html`
            <option value="${p}" ${raw(p === ticket.priority ? 'selected' : '')}>${p}</option>`).join(''))}
        </select>
      </div>`) : ''}

    <div class="thread" id="thread">
      ${raw(ticket.messages.map(messageBubble).join(''))}
    </div>

    ${closed
      ? raw(html`
        <div class="thread-closed">
          This request is closed. <a href="/support/new">Raise a new one</a> if you still need help.
        </div>`)
      : raw(html`
        <form class="reply-form" id="replyForm">
          <textarea id="replyBody" rows="3" required
            placeholder="${admin ? 'Reply to the customer…' : 'Add more detail…'}"></textarea>
          <button type="submit" class="btn btn-primary" id="sendReply">Send reply</button>
        </form>`)}`;

  function messageBubble(m) {
    const staff = m.from === 'support';
    return html`
      <div class="bubble ${staff ? 'is-support' : 'is-user'}">
        <div class="bubble-head">
          <strong>${staff ? 'CineCloud Support' : m.author}</strong>
          <span>${formatDateTime(m.at)}</span>
        </div>
        <div class="bubble-body">${m.body}</div>
      </div>`;
  }

  container.querySelector('#replyForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const body = container.querySelector('#replyBody');
    const btn = container.querySelector('#sendReply');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const res = await api.replyToTicket(ticket.ticketId, body.value);
      container.querySelector('#thread').insertAdjacentHTML('beforeend', messageBubble(res.reply));
      body.value = '';
      toast(admin ? 'Reply sent to the customer' : 'Reply added', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send reply';
    }
  });

  const onAdminChange = async () => {
    try {
      await api.updateTicket(ticket.ticketId, {
        status: container.querySelector('#statusSelect').value,
        priority: container.querySelector('#prioritySelect').value,
      });
      toast('Ticket updated', 'success');
      router.resolve();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  container.querySelector('#statusSelect')?.addEventListener('change', onAdminChange);
  container.querySelector('#prioritySelect')?.addEventListener('change', onAdminChange);
}
