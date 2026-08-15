/**
 * API client. One place that knows about auth headers, JSON handling and
 * what to do when a token expires.
 */

import { state, clearSession } from './state.js';

const BASE = '/api';

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };

  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (state.token) opts.headers.Authorization = `Bearer ${state.token}`;

  let res;
  try {
    res = await fetch(BASE + path, opts);
  } catch {
    throw new Error('Network error — is the server running?');
  }

  // The token expired or was tampered with: drop it and bounce to login once,
  // rather than letting every subsequent call fail in its own way.
  if (res.status === 401 && state.token) {
    clearSession();
    onUnauthorized();
    throw new Error('Your session expired — please sign in again');
  }

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error('Unexpected response from server'); }

  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const qs = params => {
  const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return clean.length ? '?' + new URLSearchParams(clean) : '';
};

export const api = {
  config: () => request('/config'),

  register: body => request('/auth/register', { method: 'POST', body }),
  login: body => request('/auth/login', { method: 'POST', body }),
  me: () => request('/auth/me'),
  checkEmail: email => request('/auth/check-email', { method: 'POST', body: { email } }),
  verifyEmail: token => request(`/auth/verify?token=${encodeURIComponent(token)}`),
  resendVerification: () => request('/auth/resend-verification', { method: 'POST' }),
  resendSignup: email => request('/auth/resend-signup', { method: 'POST', body: { email } }),
  changePassword: body => request('/auth/change-password', { method: 'POST', body }),

  supportTickets: (params = {}) => request(`/support${qs(params)}`),
  supportTicket: id => request(`/support/${id}`),
  raiseTicket: body => request('/support', { method: 'POST', body }),
  replyToTicket: (id, message) => request(`/support/${id}/reply`, { method: 'POST', body: { message } }),
  updateTicket: (id, body) => request(`/support/${id}`, { method: 'PATCH', body }),

  movies: (params = {}) => request(`/movies${qs(params)}`),
  movie: id => request(`/movies/${id}`),
  createMovie: body => request('/movies', { method: 'POST', body }),
  updateMovie: (id, body) => request(`/movies/${id}`, { method: 'PUT', body }),
  deleteMovie: id => request(`/movies/${id}`, { method: 'DELETE' }),

  reviews: movieId => request(`/reviews/${movieId}`),
  rateMovie: (movieId, body) => request(`/reviews/${movieId}`, { method: 'POST', body }),

  theatres: (params = {}) => request(`/theatres${qs(params)}`),
  createTheatre: body => request('/theatres', { method: 'POST', body }),
  updateTheatre: (id, body) => request(`/theatres/${id}`, { method: 'PUT', body }),
  deleteTheatre: id => request(`/theatres/${id}`, { method: 'DELETE' }),

  shows: (params = {}) => request(`/shows${qs(params)}`),
  showDates: (params = {}) => request(`/shows/dates${qs(params)}`),
  show: id => request(`/shows/${id}`),
  generateShows: body => request('/shows/generate', { method: 'POST', body }),
  deleteShow: id => request(`/shows/${id}`, { method: 'DELETE' }),

  bookings: () => request('/bookings'),
  booking: id => request(`/bookings/${id}`),
  seatsFor: showId => request(`/bookings/seats/${showId}`),
  book: body => request('/bookings', { method: 'POST', body }),
  cancelBooking: id => request(`/bookings/${id}`, { method: 'DELETE' }),

  /** Downloads the ticket PDF through fetch so the auth header is included. */
  async downloadTicket(bookingId, filename) {
    const res = await fetch(`${BASE}/bookings/${bookingId}/ticket`, {
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
    });
    if (!res.ok) throw new Error('Could not generate your ticket');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `CineCloud-${bookingId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
