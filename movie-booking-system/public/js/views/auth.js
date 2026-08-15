import { html, raw } from '../dom.js';
import { api } from '../api.js';
import { setSession } from '../state.js';
import { toast } from '../components/toast.js';
import { renderNavbar } from '../components/navbar.js';
import { checkName, checkEmail, checkPassword, debounce } from '../validation.js';
import * as router from '../router.js';

/** Where to go after signing in — set by guards that bounce you here. */
let redirectTo = null;
export function setPostAuthRedirect(path) { redirectTo = path; }

function consumeRedirect() {
  const target = redirectTo || '/';
  redirectTo = null;
  return target;
}

// ---------------------------------------------------------------- helpers

/** Attach a validation message to a field and mark it good or bad. */
function setFieldState(input, state, message = '') {
  const field = input.closest('.field');
  const note = field.querySelector('.field-error');

  field.classList.toggle('is-invalid', state === 'invalid');
  field.classList.toggle('is-valid', state === 'valid');
  field.classList.toggle('is-checking', state === 'checking');

  note.textContent = message;
  note.className = `field-error${state === 'valid' ? ' is-ok' : ''}`;
  input.setAttribute('aria-invalid', state === 'invalid' ? 'true' : 'false');
}

const field = ({ id, label, type = 'text', autocomplete, placeholder, extra = '' }) => html`
  <div class="field">
    <label for="${id}">${label}</label>
    <div class="field-input">
      <input type="${type}" id="${id}" autocomplete="${autocomplete}" placeholder="${placeholder}"
             aria-describedby="${id}-error" required>
      ${type === 'password' ? raw(`<button type="button" class="field-toggle" data-toggle="${id}"
             aria-label="Show password">Show</button>`) : ''}
    </div>
    ${raw(extra)}
    <small class="field-error" id="${id}-error" role="status"></small>
  </div>`;

// ------------------------------------------------------------------ login

export function renderLogin(container) {
  container.innerHTML = html`
    <div class="auth-card">
      <h2>Welcome back</h2>
      <p class="auth-sub">Sign in to book your seats</p>
      <form id="loginForm" novalidate>
        ${raw(field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email', placeholder: 'you@example.com' }))}
        ${raw(field({ id: 'password', label: 'Password', type: 'password', autocomplete: 'current-password', placeholder: 'Your password' }))}
        <button type="submit" class="btn btn-primary btn-block btn-lg" id="submit">Sign in</button>
      </form>
      <p class="auth-alt">New here? <a href="/register">Create an account</a></p>
    </div>`;

  wirePasswordToggles(container);

  const form = container.querySelector('#loginForm');
  const btn = container.querySelector('#submit');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const data = await api.login({
        email: container.querySelector('#email').value,
        password: container.querySelector('#password').value,
      });
      setSession(data.token, data.user);
      renderNavbar();
      toast(`Welcome back, ${data.user.name}`, 'success');
      router.go(consumeRedirect(), { replace: true });
    } catch (err) {
      toast(err.message, 'error');
      setFieldState(container.querySelector('#password'), 'invalid', err.message);
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
}

// --------------------------------------------------------------- register

export function renderRegister(container) {
  container.innerHTML = html`
    <div class="auth-card">
      <h2>Create your account</h2>
      <p class="auth-sub">You'll get a link by email to confirm your address</p>

      <form id="registerForm" novalidate>
        ${raw(field({ id: 'name', label: 'Full name', autocomplete: 'name', placeholder: 'Your name' }))}
        ${raw(field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email', placeholder: 'you@example.com' }))}
        ${raw(field({
          id: 'password',
          label: 'Password',
          type: 'password',
          autocomplete: 'new-password',
          placeholder: 'At least 8 characters',
          extra: `
            <div class="pw-meter" id="pwMeter" aria-hidden="true">
              <span class="pw-bar"></span><span class="pw-bar"></span>
              <span class="pw-bar"></span><span class="pw-bar"></span>
            </div>
            <div class="pw-requirements" id="pwReqs">
              <span data-req="length">8+ characters</span>
              <span data-req="letter">a letter</span>
              <span data-req="number">a number</span>
              <span data-req="symbol">a symbol (optional)</span>
            </div>`,
        }))}
        <button type="submit" class="btn btn-primary btn-block btn-lg" id="submit">Create account</button>
      </form>
      <p class="auth-alt">Already have an account? <a href="/login">Sign in</a></p>
    </div>`;

  wirePasswordToggles(container);

  const nameEl = container.querySelector('#name');
  const emailEl = container.querySelector('#email');
  const pwEl = container.querySelector('#password');
  const btn = container.querySelector('#submit');
  const meter = container.querySelector('#pwMeter');
  const reqs = container.querySelector('#pwReqs');

  // --- name
  nameEl.addEventListener('blur', () => {
    if (!nameEl.value) return setFieldState(nameEl, 'none');
    const r = checkName(nameEl.value);
    setFieldState(nameEl, r.valid ? 'valid' : 'invalid', r.valid ? '' : r.error);
  });

  // --- email: instant format check, then ask the server about the domain
  const verifyWithServer = debounce(async value => {
    setFieldState(emailEl, 'checking', 'Checking…');
    try {
      const res = await api.checkEmail(value);
      if (res.ok) {
        setFieldState(emailEl, 'valid', res.verifiedDomain ? 'Looks good' : '');
      } else {
        setFieldState(emailEl, 'invalid', res.error);
        if (res.suggestion) offerSuggestion(res.suggestion);
      }
    } catch {
      // Never block signup because the check itself failed.
      setFieldState(emailEl, 'none');
    }
  }, 600);

  function offerSuggestion(suggestion) {
    const note = emailEl.closest('.field').querySelector('.field-error');
    note.innerHTML = `Did you mean <button type="button" class="link-btn" id="useSuggestion">${suggestion}</button>?`;
    note.querySelector('#useSuggestion').addEventListener('click', () => {
      emailEl.value = suggestion;
      verifyWithServer(suggestion);
    });
  }

  emailEl.addEventListener('input', () => {
    const r = checkEmail(emailEl.value);
    if (!r.valid) {
      // Stay quiet until they've typed enough to be meaningful.
      if (emailEl.value.length > 4) setFieldState(emailEl, 'invalid', r.error);
      else setFieldState(emailEl, 'none');
      if (r.suggestion) offerSuggestion(r.suggestion);
      return;
    }
    verifyWithServer(emailEl.value);
  });

  // --- password: live meter and requirement ticks
  pwEl.addEventListener('input', () => {
    const r = checkPassword(pwEl.value, { email: emailEl.value, name: nameEl.value });

    meter.dataset.score = pwEl.value ? String(r.score) : '';
    [...meter.children].forEach((bar, i) => bar.classList.toggle('is-on', i < r.score));

    for (const el of reqs.querySelectorAll('[data-req]')) {
      el.classList.toggle('is-met', Boolean(r.checks[el.dataset.req]));
    }

    if (!pwEl.value) return setFieldState(pwEl, 'none');
    setFieldState(pwEl, r.valid ? 'valid' : 'invalid', r.valid ? `${r.label} password` : r.error);
  });

  // --- submit
  container.querySelector('#registerForm').addEventListener('submit', async e => {
    e.preventDefault();

    // Re-run everything, so submitting without touching a field still reports.
    const n = checkName(nameEl.value);
    const em = checkEmail(emailEl.value);
    const pw = checkPassword(pwEl.value, { email: emailEl.value, name: nameEl.value });

    if (!n.valid) { setFieldState(nameEl, 'invalid', n.error); nameEl.focus(); return; }
    if (!em.valid) { setFieldState(emailEl, 'invalid', em.error); emailEl.focus(); return; }
    if (!pw.valid) { setFieldState(pwEl, 'invalid', pw.error); pwEl.focus(); return; }

    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const email = emailEl.value.trim().toLowerCase();

      // No session yet: the account does not exist until the emailed link is
      // clicked, which is what stops someone signing up as an address they
      // don't own — and lets them correct a typo by simply signing up again.
      const res = await api.register({ name: nameEl.value.trim(), email, password: pwEl.value });
      renderCheckEmail(container, { email, sent: res.emailSent, message: res.message });
    } catch (err) {
      // The server names the offending field, so the message lands on it.
      const target = { name: nameEl, email: emailEl, password: pwEl }[err.data?.field];
      if (target) {
        setFieldState(target, 'invalid', err.message);
        target.focus();
      } else {
        toast(err.message, 'error');
      }
      btn.disabled = false;
      btn.textContent = 'Create account';
    }
  });
}

/**
 * Post-signup screen. Nothing has been created yet — this explains that, and
 * gives an obvious way out if the address was typed wrong.
 */
function renderCheckEmail(container, { email, sent, message }) {
  container.innerHTML = html`
    <div class="auth-card" style="text-align:center">
      <div style="font-size:44px;margin-bottom:10px">${sent ? '📬' : '⚠️'}</div>
      <h2>${sent ? 'Check your email' : "We couldn't send that email"}</h2>
      <p class="auth-sub">${message}</p>

      ${sent ? raw(html`
        <div class="check-email-note">
          <p>Your account is created the moment you click the link. It expires in 24 hours.</p>
          <p class="muted">Nothing in your inbox? Look in spam, or resend below.</p>
        </div>
        <button class="btn btn-ghost btn-block" id="resend">Resend the link</button>`) : ''}

      <button class="btn ${sent ? 'btn-ghost' : 'btn-primary'} btn-block" id="wrongEmail">
        ${sent ? 'Wrong address? Start again' : 'Try a different address'}
      </button>
      <p class="auth-alt">Already confirmed? <a href="/login">Sign in</a></p>
    </div>`;

  container.querySelector('#wrongEmail').addEventListener('click', () => renderRegister(container));

  if (sent) watchForVerification(container, email);

  container.querySelector('#resend')?.addEventListener('click', async e => {
    e.target.disabled = true;
    e.target.textContent = 'Sending…';
    try {
      const res = await api.resendSignup(email);
      toast(res.message, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      e.target.disabled = false;
      e.target.textContent = 'Resend the link';
    }
  });
}

/**
 * Notice that the user has verified, and move them on.
 *
 * The "check your email" screen is a dead end otherwise: verification happens
 * somewhere else entirely — another tab, or more often a phone — and this tab
 * has no way of hearing about it. Two mechanisms, because they cover different
 * cases:
 *
 *   • storage event — the verify page calls setSession(), which writes the
 *     token to localStorage. Other tabs of the SAME browser get a storage
 *     event immediately. Instant and free, but same-browser only.
 *
 *   • polling — covers the common case of opening the link on a phone, where
 *     no storage event can ever reach this tab. Reuses /auth/check-email,
 *     which already reports `registered` and caches its DNS lookup, rather
 *     than adding a near-duplicate endpoint.
 *
 * Both stop as soon as the screen is gone, so navigating away leaves nothing
 * running.
 */
function watchForVerification(container, email) {
  const POLL_MS = 4000;
  const GIVE_UP_MS = 10 * 60 * 1000;
  const startedAt = Date.now();

  let stopped = false;
  let timer = null;
  const card = container.querySelector('.auth-card');

  /** True once this screen has been replaced by another view. */
  const gone = () => !card || !card.isConnected;

  function stop() {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', onVisible);
  }

  /**
   * Coming back to this tab is the single most likely moment for the link to
   * have just been clicked, so check immediately instead of waiting out the
   * interval. Also why the timer skips hidden tabs — polling while the user is
   * away in their mail app is wasted work.
   */
  function onVisible() {
    if (!document.hidden) check();
  }

  /** Same browser: the other tab signed us in, so just carry on as them. */
  function onStorage(e) {
    if (e.key !== 'cc_token' || !e.newValue || gone()) return;
    stop();
    renderNavbar();
    toast('Email verified — you are signed in', 'success');
    router.go('/');
  }

  /** Different device: the account now exists, but not on this one. */
  function onVerifiedElsewhere() {
    stop();
    container.innerHTML = html`
      <div class="auth-card" style="text-align:center">
        <div style="font-size:44px;margin-bottom:10px">✅</div>
        <h2>Email verified</h2>
        <p class="auth-sub">${email} is confirmed and your account is ready. Sign in to start booking.</p>
        <a class="btn btn-primary btn-block" href="/login">Sign in</a>
      </div>`;
  }

  async function check() {
    if (stopped) return;
    if (gone() || Date.now() - startedAt > GIVE_UP_MS) return stop();

    try {
      const res = await api.checkEmail(email);
      // `registered: true` means a Users record exists — which, with pending
      // signups, only happens once the link has actually been clicked.
      if (res.registered && !gone()) onVerifiedElsewhere();
    } catch {
      // Offline or a blip — keep waiting rather than giving up on the user.
    }
  }

  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', onVisible);

  timer = setInterval(() => {
    if (document.hidden) return;
    check();
  }, POLL_MS);
}

/** Show/hide buttons on password inputs. */
function wirePasswordToggles(container) {
  container.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = container.querySelector(`#${btn.dataset.toggle}`);
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });
}
