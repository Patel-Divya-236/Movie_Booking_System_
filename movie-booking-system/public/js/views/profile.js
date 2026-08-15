import { html, raw, spinner, emptyState, rupees, formatDate, initials } from '../dom.js';
import { state, isAdmin, clearSession, updateUser } from '../state.js';
import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { renderNavbar } from '../components/navbar.js';
import { openModal, closeModal } from '../components/modal.js';
import * as router from '../router.js';

export async function renderProfile(container) {
  container.innerHTML = spinner();

  // Everything on this page comes from data the user already owns, so the
  // three reads can go out together.
  const [me, bookings, tickets] = await Promise.all([
    api.me().then(r => r.user).catch(() => state.user),
    api.bookings().catch(() => []),
    api.supportTickets().catch(() => []),
  ]);

  updateUser({ emailVerified: me.emailVerified });

  const live = bookings.filter(b => b.status !== 'cancelled');
  const spent = live.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
  const seats = live.reduce((sum, b) => sum + (b.seats?.length || 0), 0);
  const upcoming = live.filter(b => new Date(b.startsAt) > new Date());
  const openTickets = tickets.filter(t => ['open', 'in_progress'].includes(t.status));

  const favouriteCity = (() => {
    const counts = {};
    for (const b of live) counts[b.city] = (counts[b.city] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? state.config?.cities?.find(c => c.id === top[0])?.name : null;
  })();

  container.innerHTML = html`
    <div class="page-head">
      <h1>Your profile</h1>
      <p>Account details and activity</p>
    </div>

    <div class="profile-grid">
      <section class="profile-card">
        <div class="profile-identity">
          <span class="profile-avatar">${initials(me.name)}</span>
          <div>
            <h2>${me.name}</h2>
            <p class="profile-email">${me.email}</p>
            <div class="profile-badges">
              ${me.emailVerified
                ? raw(html`<span class="status-pill is-confirmed">✓ Verified</span>`)
                : raw(html`<span class="status-pill is-in_progress">Unverified</span>`)}
              ${isAdmin() ? raw(html`<span class="status-pill is-open">Admin</span>`) : ''}
            </div>
          </div>
        </div>

        ${!me.emailVerified ? raw(html`
          <div class="profile-notice">
            <p>Your email address isn't confirmed yet.</p>
            <button class="btn btn-sm btn-primary" id="resendVerify">Resend the link</button>
          </div>`) : ''}

        <div class="profile-actions">
          <button class="btn btn-ghost" id="changePassword">Change password</button>
          <button class="btn btn-ghost" id="signOutEverywhere">Sign out</button>
        </div>
      </section>

      <section class="profile-card">
        <h3>Activity</h3>
        <div class="profile-stats">
          <div><strong>${live.length}</strong><span>Bookings</span></div>
          <div><strong>${seats}</strong><span>Seats booked</span></div>
          <div><strong>${rupees(spent)}</strong><span>Total spent</span></div>
          <div><strong>${upcoming.length}</strong><span>Upcoming</span></div>
        </div>
        ${favouriteCity ? raw(html`<p class="muted">Most booked city: <strong>${favouriteCity}</strong></p>`) : ''}
      </section>
    </div>

    <section class="profile-card">
      <div class="admin-bar">
        <h3>Upcoming shows</h3>
        <a class="btn btn-ghost btn-sm" href="/bookings">All bookings</a>
      </div>
      ${upcoming.length
        ? raw(html`<div class="upcoming-list">
            ${raw(upcoming.slice(0, 4).map(b => html`
              <div class="upcoming-row">
                <div>
                  <strong>${b.movieTitle}</strong>
                  <span class="muted">${b.theatreName} · ${b.screenName}</span>
                </div>
                <div class="upcoming-when">
                  <strong>${formatDate(b.startsAt, { day: 'numeric', month: 'short' })}</strong>
                  <span class="muted">${b.time}</span>
                </div>
              </div>`).join(''))}
          </div>`)
        : raw(emptyState({
            icon: '🎟',
            title: 'Nothing booked yet',
            message: 'Your upcoming shows will appear here.',
            action: '<a class="btn btn-primary" href="/" style="margin-top:14px">Browse movies</a>',
          }))}
    </section>

    ${openTickets.length ? raw(html`
      <section class="profile-card">
        <div class="admin-bar">
          <h3>Open support requests</h3>
          <a class="btn btn-ghost btn-sm" href="/support">View all</a>
        </div>
        ${raw(openTickets.slice(0, 3).map(t => html`
          <a class="upcoming-row" href="/support/${t.ticketId}">
            <div>
              <strong>${t.subject}</strong>
              <span class="muted">${t.ticketRef}</span>
            </div>
            <span class="status-pill is-${t.status}">${t.status === 'open' ? 'Open' : 'In progress'}</span>
          </a>`).join(''))}
      </section>`) : ''}`;

  // --- resend verification
  container.querySelector('#resendVerify')?.addEventListener('click', async e => {
    e.target.disabled = true;
    e.target.textContent = 'Sending…';
    try {
      const res = await api.resendVerification();
      toast(res.message, res.sent ? 'success' : 'error');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      e.target.disabled = false;
      e.target.textContent = 'Resend the link';
    }
  });

  // --- change password
  container.querySelector('#changePassword').addEventListener('click', () => {
    openModal({
      title: 'Change password',
      size: 'sm',
      body: html`
        <form id="pwForm">
          <div class="field">
            <label for="currentPw">Current password</label>
            <div class="field-input"><input type="password" id="currentPw" autocomplete="current-password" required></div>
            <small class="field-error"></small>
          </div>
          <div class="field">
            <label for="newPw">New password</label>
            <div class="field-input"><input type="password" id="newPw" autocomplete="new-password" required></div>
            <small class="field-error"></small>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="cancelPw">Cancel</button>
            <button type="submit" class="btn btn-primary" id="savePw">Update password</button>
          </div>
        </form>`,
      onMount(bodyEl) {
        bodyEl.querySelector('#cancelPw').addEventListener('click', closeModal);
        bodyEl.querySelector('#pwForm').addEventListener('submit', async e => {
          e.preventDefault();
          const btn = bodyEl.querySelector('#savePw');
          btn.disabled = true;
          btn.textContent = 'Updating…';
          try {
            await api.changePassword({
              currentPassword: bodyEl.querySelector('#currentPw').value,
              newPassword: bodyEl.querySelector('#newPw').value,
            });
            closeModal();
            toast('Password updated', 'success');
          } catch (err) {
            bodyEl.querySelectorAll('.field-error')[err.data?.field === 'newPassword' ? 1 : 0]
              .textContent = err.message;
            btn.disabled = false;
            btn.textContent = 'Update password';
          }
        });
      },
    });
  });

  container.querySelector('#signOutEverywhere').addEventListener('click', () => {
    clearSession();
    renderNavbar();
    toast('Signed out', 'info');
    router.go('/');
  });
}
