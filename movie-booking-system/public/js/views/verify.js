import { html, raw, spinner } from '../dom.js';
import { api } from '../api.js';
import { state, setSession, isLoggedIn } from '../state.js';
import { toast } from '../components/toast.js';
import { renderNavbar } from '../components/navbar.js';

/** Landing page for the link in the verification email. */
export async function renderVerify(container, { query }) {
  if (!query.token) {
    container.innerHTML = result({
      icon: '🔗',
      title: 'Nothing to verify',
      message: 'This page is reached from the link in your verification email.',
      actions: '<a class="btn btn-primary" href="/">Back to movies</a>',
    });
    return;
  }

  container.innerHTML = html`
    <div class="auth-card">
      ${raw(spinner())}
      <p class="auth-sub">Verifying your email…</p>
    </div>`;

  try {
    const res = await api.verifyEmail(query.token);

    // The server hands back a fresh token carrying emailVerified: true, so the
    // banner disappears without the user signing in again.
    if (res.token && res.user) {
      setSession(res.token, res.user);
      renderNavbar();
    }

    container.innerHTML = result({
      icon: '✅',
      title: res.alreadyVerified ? 'Already verified' : 'Email verified',
      message: res.alreadyVerified
        ? 'This address was verified earlier — nothing more to do.'
        : `${state.user?.email || 'Your address'} is confirmed. You're all set to book.`,
      actions: '<a class="btn btn-primary" href="/">Browse movies</a>',
    });
  } catch (err) {
    const expired = err.data?.expired;
    container.innerHTML = result({
      icon: expired ? '⏰' : '⚠️',
      title: expired ? 'This link has expired' : "That link didn't work",
      message: err.message,
      actions: isLoggedIn()
        ? '<button class="btn btn-primary" id="resend">Send me a new link</button>'
        : '<a class="btn btn-primary" href="/login">Sign in</a>',
    });

    container.querySelector('#resend')?.addEventListener('click', async e => {
      e.target.disabled = true;
      e.target.textContent = 'Sending…';
      try {
        const res = await api.resendVerification();
        toast(res.message, res.sent ? 'success' : 'error');
      } catch (err2) {
        toast(err2.message, 'error');
      } finally {
        e.target.disabled = false;
        e.target.textContent = 'Send me a new link';
      }
    });
  }
}

function result({ icon, title, message, actions }) {
  return html`
    <div class="auth-card" style="text-align:center">
      <div style="font-size:44px;margin-bottom:10px">${icon}</div>
      <h2>${title}</h2>
      <p class="auth-sub">${message}</p>
      ${raw(actions)}
    </div>`;
}

/**
 * Persistent nudge for unverified accounts. Rendered above every view rather
 * than blocking anything, so an unverified user can still look around.
 */
export function verificationBanner() {
  if (!isLoggedIn() || state.user?.emailVerified) return '';

  const blocking = state.config?.requireEmailVerification;
  return html`
    <div class="verify-banner" id="verifyBanner">
      <span class="verify-icon">✉️</span>
      <span class="verify-text">
        <strong>Confirm your email</strong>
        ${blocking
          ? ' — you need to verify before you can book.'
          : ` — we sent a link to ${state.user.email}.`}
      </span>
      <button class="btn btn-sm" id="resendBanner">Resend link</button>
      <button class="verify-dismiss" id="dismissBanner" aria-label="Dismiss">✕</button>
    </div>`;
}

/** Wire the banner's buttons after it has been inserted. */
export function bindVerificationBanner(root) {
  const banner = root.querySelector('#verifyBanner');
  if (!banner) return;

  banner.querySelector('#dismissBanner').addEventListener('click', () => banner.remove());

  banner.querySelector('#resendBanner').addEventListener('click', async e => {
    e.target.disabled = true;
    e.target.textContent = 'Sending…';
    try {
      const res = await api.resendVerification();
      toast(res.message, res.sent ? 'success' : 'error');
      if (res.sent) banner.remove();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      e.target.disabled = false;
      e.target.textContent = 'Resend link';
    }
  });
}
