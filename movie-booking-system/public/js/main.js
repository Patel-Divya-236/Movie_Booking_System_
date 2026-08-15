/**
 * Entry point: loads config, wires routes and guards, then starts the router.
 */

import { api, setUnauthorizedHandler } from './api.js';
import { state, isLoggedIn, isAdmin } from './state.js';
import * as router from './router.js';
import { html, emptyState, raw } from './dom.js';
import { toast } from './components/toast.js';
import { renderNavbar, openCityPicker } from './components/navbar.js';
import { closeModal } from './components/modal.js';

import { renderHome } from './views/home.js';
import { renderLogin, renderRegister, setPostAuthRedirect } from './views/auth.js';
import { renderMovieDetail } from './views/movieDetail.js';
import { renderShowtimes } from './views/showtimes.js';
import { renderSeats } from './views/seats.js';
import { renderConfirmation } from './views/confirmation.js';
import { renderMyBookings } from './views/myBookings.js';
import { renderAdmin } from './views/admin.js';
import { renderVerify, verificationBanner, bindVerificationBanner } from './views/verify.js';
import { renderSupport, renderNewTicket, renderTicket } from './views/support.js';
import { renderProfile } from './views/profile.js';

const app = () => document.getElementById('app');

/** Wrap a view so failures land on screen instead of only in the console. */
function view(fn, { banner = true } = {}) {
  return async ctx => {
    const container = app();
    try {
      await fn(container, ctx);
    } catch (err) {
      console.error(err);
      container.innerHTML = emptyState({
        icon: '⚠️',
        title: 'Something went wrong',
        message: err.message || 'Please try again.',
        action: '<a class="btn btn-primary" href="/" style="margin-top:16px">Back to movies</a>',
      });
    }

    // Nudge unverified accounts, above whatever the view rendered.
    if (banner) {
      const markup = verificationBanner();
      if (markup) {
        container.insertAdjacentHTML('afterbegin', markup);
        bindVerificationBanner(container);
      }
    }

    renderNavbar();
  };
}

function defineRoutes() {
  // `needsCity` marks the routes that genuinely depend on a chosen city. The
  // picker used to open on boot for every route, which meant a visitor going
  // straight to /login or a verification link got a modal in the way.
  router.define('/', view(renderHome), { needsCity: true });
  router.define('/login', view(renderLogin));
  router.define('/register', view(renderRegister));
  router.define('/movie/:movieId', view(renderMovieDetail), { needsCity: true });
  router.define('/movie/:movieId/shows', view(renderShowtimes), { needsCity: true });
  router.define('/show/:showId/seats', view(renderSeats));
  router.define('/booking/:bookingId', view(renderConfirmation), { auth: true });
  router.define('/bookings', view(renderMyBookings), { auth: true });
  router.define('/profile', view(renderProfile), { auth: true });
  router.define('/verify', view(renderVerify, { banner: false }));
  router.define('/support', view(renderSupport), { auth: true });
  router.define('/support/new', view(renderNewTicket), { auth: true });
  router.define('/support/:ticketId', view(renderTicket), { auth: true });
  router.define('/admin', view(renderAdmin), { auth: true, admin: true });

  router.setNotFound(() => {
    app().innerHTML = emptyState({
      icon: '🎬',
      title: 'Page not found',
      message: "That page doesn't exist.",
      action: '<a class="btn btn-primary" href="/" style="margin-top:16px">Back to movies</a>',
    });
    renderNavbar();
  });

  // Any dialog left open belongs to the page we're leaving.
  router.setGuard(route => {
    closeModal();

    // Ask for a city only where one is actually needed. The view still
    // renders behind the dialog, so dismissing it leaves a usable page.
    if (route.needsCity && !state.city) {
      openCityPicker({ force: true });
    }

    if (route.auth && !isLoggedIn()) {
      setPostAuthRedirect(router.currentPath());
      toast('Please sign in to continue', 'info');
      router.go('/login', { replace: true });
      return false;
    }
    if (route.admin && !isAdmin()) {
      toast('Admin access required', 'error');
      router.go('/', { replace: true });
      return false;
    }
    return true;
  });
}

async function boot() {
  setUnauthorizedHandler(() => {
    renderNavbar();
    router.go('/login');
  });

  try {
    state.config = await api.config();
  } catch (err) {
    app().innerHTML = html`
      ${raw(emptyState({
        icon: '🔌',
        title: 'Cannot reach the server',
        message: err.message,
      }))}`;
    return;
  }

  // Fall back to the first configured city rather than blocking on a modal.
  if (state.city && !state.config.cities.some(c => c.id === state.city)) {
    state.city = null;
  }

  renderNavbar();
  defineRoutes();
  router.start(); // the route guard prompts for a city where one is needed
}

boot();
