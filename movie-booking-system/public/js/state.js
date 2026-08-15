/**
 * Application state.
 *
 * Auth and the chosen city persist to localStorage; everything else is
 * per-session. Views read `state` directly and call the setters below rather
 * than mutating persisted fields by hand.
 */

const STORAGE = { token: 'cc_token', user: 'cc_user', city: 'cc_city' };

function readJson(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

export const state = {
  token: localStorage.getItem(STORAGE.token) || null,
  user: readJson(STORAGE.user),
  city: localStorage.getItem(STORAGE.city) || null,

  // Server-provided config: cities, layouts, formats, fee rules.
  config: null,

  // Current booking journey.
  movie: null,
  show: null,
  layout: null,
  bookedSeats: [],
  selectedSeats: [],   // [{ id, tier, price }]

  lastBooking: null,
};

export const isLoggedIn = () => Boolean(state.token && state.user);
export const isAdmin = () => state.user?.role === 'admin';
export const isVerified = () => Boolean(state.user?.emailVerified);

/** Refresh the cached user after verification, without a re-login. */
export function updateUser(patch) {
  state.user = { ...state.user, ...patch };
  localStorage.setItem(STORAGE.user, JSON.stringify(state.user));
}

export function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem(STORAGE.token, token);
  localStorage.setItem(STORAGE.user, JSON.stringify(user));
}

export function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem(STORAGE.token);
  localStorage.removeItem(STORAGE.user);
}

export function setCity(cityId) {
  state.city = cityId;
  localStorage.setItem(STORAGE.city, cityId);
}

export function cityName(cityId = state.city) {
  return state.config?.cities?.find(c => c.id === cityId)?.name || 'Select city';
}

/** Clear everything to do with the in-progress seat selection. */
export function resetSelection() {
  state.selectedSeats = [];
  state.bookedSeats = [];
  state.show = null;
  state.layout = null;
}

export function toggleSeat(id, tier, price, maxSeats) {
  const index = state.selectedSeats.findIndex(s => s.id === id);
  if (index > -1) {
    state.selectedSeats.splice(index, 1);
    return { added: false };
  }
  if (state.selectedSeats.length >= maxSeats) {
    return { added: false, limitReached: true };
  }
  state.selectedSeats.push({ id, tier, price });
  return { added: true };
}

/**
 * Mirrors config/pricing.js on the server. Shown to the user for transparency;
 * the server recomputes it independently and its number is the one that counts.
 */
export function selectionTotals() {
  const fees = state.config?.fees || { conveniencePerTicket: 30, gstRate: 0.18 };
  const seats = state.selectedSeats;
  const subtotal = seats.reduce((sum, s) => sum + s.price, 0);
  const convenienceFee = seats.length * fees.conveniencePerTicket;
  const gst = Math.round(convenienceFee * fees.gstRate);

  const byTier = {};
  for (const s of seats) {
    byTier[s.tier] = byTier[s.tier] || { count: 0, amount: 0 };
    byTier[s.tier].count++;
    byTier[s.tier].amount += s.price;
  }

  return { seats, subtotal, convenienceFee, gst, total: subtotal + convenienceFee + gst, byTier };
}
