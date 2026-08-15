import { html, raw, initials } from '../dom.js';
import { state, isLoggedIn, isAdmin, setCity, cityName, clearSession } from '../state.js';
import { openModal, closeModal } from './modal.js';
import * as router from '../router.js';
import { toast } from './toast.js';

/** Re-render the navbar to match the current session, city and route. */
export function renderNavbar() {
  const nav = document.getElementById('navbar');
  if (!nav) return;

  const path = router.currentPath();
  const active = p => (path === p || (p !== '/' && path.startsWith(p)) ? 'is-active' : '');

  nav.innerHTML = html`
    <div class="nav-inner">
      <a class="nav-brand" href="/">
        <span class="brand-mark">🎬</span>
        <span class="brand-text">CineCloud</span>
      </a>

      <button class="city-btn" id="cityBtn" aria-label="Change city">
        <span class="city-pin">📍</span>
        <span class="city-name">${state.city ? cityName() : 'Select city'}</span>
        <span class="city-caret">▾</span>
      </button>

      <div class="nav-links">
        <a href="/" class="nav-link ${active('/')}">Movies</a>
        ${isLoggedIn() ? raw(html`<a href="/bookings" class="nav-link ${active('/bookings')}">My Bookings</a>`) : ''}
        ${isLoggedIn() ? raw(html`<a href="/profile" class="nav-link ${active('/profile')}">Profile</a>`) : ''}
        ${isLoggedIn() ? raw(html`<a href="/support" class="nav-link ${active('/support')}">${isAdmin() ? 'Support queue' : 'Help'}</a>`) : ''}
        ${isAdmin() ? raw(html`<a href="/admin" class="nav-link ${active('/admin')}">Admin</a>`) : ''}
      </div>

      <div class="nav-auth">
        ${isLoggedIn()
          ? raw(html`
              <a class="user-chip" href="/profile" title="Your profile">
                <span class="user-avatar">${initials(state.user.name)}</span>
                <span class="user-name">${state.user.name}</span>
              </a>
              <button class="btn btn-ghost btn-sm" id="logoutBtn">Sign out</button>`)
          : raw(html`
              <a class="btn btn-ghost btn-sm" href="/login">Sign in</a>
              <a class="btn btn-primary btn-sm" href="/register">Sign up</a>`)}
      </div>

      <button class="nav-toggle" id="navToggle" aria-label="Menu" aria-expanded="false">☰</button>
    </div>`;

  nav.querySelector('#cityBtn').addEventListener('click', openCityPicker);

  nav.querySelector('#logoutBtn')?.addEventListener('click', () => {
    clearSession();
    renderNavbar();
    toast('Signed out', 'info');
    router.go('/');
  });

  const toggle = nav.querySelector('#navToggle');
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  // A navigation should close the mobile menu behind it.
  nav.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => nav.classList.remove('is-open'))
  );
}

/**
 * City chooser. Required before anything can be booked, so when no city is set
 * this opens undismissable — like BookMyShow's first-run prompt.
 */
export function openCityPicker({ force = false } = {}) {
  const cities = state.config?.cities || [];

  openModal({
    title: force ? 'Where are you watching?' : 'Change city',
    size: 'sm',
    dismissable: !force,
    body: html`
      <p class="modal-lede">Showtimes and cinemas are listed for the city you pick.</p>
      <div class="city-grid">
        ${raw(cities.map(c => html`
          <button class="city-option ${c.id === state.city ? 'is-active' : ''}" data-city="${c.id}">
            <span class="city-option-icon">🏙</span>
            <span>${c.name}</span>
          </button>`).join(''))}
      </div>`,
    onMount(bodyEl) {
      bodyEl.querySelectorAll('[data-city]').forEach(btn => {
        btn.addEventListener('click', () => {
          setCity(btn.dataset.city);
          closeModal();
          renderNavbar();
          toast(`Showing cinemas in ${cityName()}`, 'success');
          router.resolve(); // re-render the current view for the new city
        });
      });
    },
  });
}
