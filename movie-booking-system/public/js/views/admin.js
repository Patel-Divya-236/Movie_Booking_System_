/**
 * Admin panel — three tabs over the same page: Movies, Theatres, Shows.
 * The Shows tab is the one that matters day to day: it bulk-generates a
 * week of showtimes rather than making you create 35 shows by hand.
 */

import { html, raw, spinner, emptyState, rupees } from '../dom.js';
import { state, cityName } from '../state.js';
import { api } from '../api.js';
import { toast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'movies', label: 'Movies' },
  { id: 'theatres', label: 'Theatres' },
  { id: 'shows', label: 'Shows' },
];

const options = (list, selected) =>
  list.map(v => html`<option value="${v}" ${raw(v === selected ? 'selected' : '')}>${v}</option>`).join('');

// ------------------------------------------------------------- overview

async function renderOverview(host) {
  host.innerHTML = spinner();
  try {
    const [movies, theatres, bookings] = await Promise.all([
      api.movies(), api.theatres(), api.bookings(),
    ]);

    const live = bookings.filter(b => b.status !== 'cancelled');
    const revenue = live.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
    const seatsSold = live.reduce((sum, b) => sum + (b.seats?.length || 0), 0);

    const byCity = {};
    for (const b of live) {
      byCity[b.city] = (byCity[b.city] || 0) + (b.totalPrice || 0);
    }

    host.innerHTML = html`
      <div class="stat-row">
        <div class="stat-card"><div class="stat-value">${movies.length}</div><div class="stat-label">Movies</div></div>
        <div class="stat-card"><div class="stat-value">${theatres.length}</div><div class="stat-label">Theatres</div></div>
        <div class="stat-card"><div class="stat-value">${live.length}</div><div class="stat-label">Bookings</div></div>
        <div class="stat-card"><div class="stat-value">${seatsSold}</div><div class="stat-label">Seats sold</div></div>
        <div class="stat-card"><div class="stat-value">${rupees(revenue)}</div><div class="stat-label">Revenue</div></div>
      </div>

      <div class="admin-panel">
        <h3>Revenue by city</h3>
        ${Object.keys(byCity).length
          ? raw(html`<div class="bar-list">
              ${raw(Object.entries(byCity).sort((a, b) => b[1] - a[1]).map(([city, amount]) => {
                const max = Math.max(...Object.values(byCity));
                return html`
                  <div class="bar-row">
                    <span class="bar-label">${cityName(city)}</span>
                    <span class="bar-track"><span class="bar-fill" style="width:${Math.round(amount / max * 100)}%"></span></span>
                    <span class="bar-value">${rupees(amount)}</span>
                  </div>`;
              }).join(''))}
            </div>`)
          : raw(html`<p class="muted">No bookings yet.</p>`)}
      </div>

      ${bookings.filter(b => b.status === 'cancelled').length
        ? raw(html`<p class="muted">${bookings.filter(b => b.status === 'cancelled').length} cancelled booking(s) excluded from revenue.</p>`)
        : ''}`;
  } catch (err) {
    host.innerHTML = emptyState({ icon: '⚠️', title: 'Could not load stats', message: err.message });
  }
}

// --------------------------------------------------------------- movies

function movieForm(movie = {}) {
  const cfg = state.config;
  const selectedFormats = movie.formats || ['2D'];

  return html`
    <form id="movieForm" class="admin-form">
      <div class="field"><label>Title</label>
        <input id="f-title" required value="${movie.title || ''}"></div>

      <div class="field-row">
        <div class="field"><label>Genre</label>
          <select id="f-genre">${raw(options(cfg.genres, movie.genre))}</select></div>
        <div class="field"><label>Language</label>
          <select id="f-language">${raw(options(cfg.languages, movie.language))}</select></div>
      </div>

      <div class="field-row">
        <div class="field"><label>Certificate</label>
          <select id="f-certificate">${raw(options(cfg.certificates, movie.certificate))}</select></div>
        <div class="field"><label>Duration</label>
          <input id="f-duration" placeholder="2h 30m" value="${movie.duration || ''}"></div>
      </div>

      <div class="field"><label>Formats</label>
        <div class="checkbox-row">
          ${raw(Object.keys(cfg.formats).map(f => html`
            <label class="checkbox">
              <input type="checkbox" value="${f}" ${raw(selectedFormats.includes(f) ? 'checked' : '')}>
              <span>${f}</span>
              <small>${cfg.formats[f].surcharge ? `+${rupees(cfg.formats[f].surcharge)}` : 'base'}</small>
            </label>`).join(''))}
        </div>
      </div>

      <div class="field"><label>Status</label>
        <select id="f-status">
          <option value="now_showing" ${raw(movie.status !== 'coming_soon' ? 'selected' : '')}>Now showing</option>
          <option value="coming_soon" ${raw(movie.status === 'coming_soon' ? 'selected' : '')}>Coming soon</option>
        </select></div>

      <div class="field"><label>Poster URL</label>
        <input id="f-poster" type="url" value="${movie.posterUrl || ''}"></div>
      <div class="field"><label>Trailer URL (YouTube)</label>
        <input id="f-trailer" type="url" placeholder="https://www.youtube.com/watch?v=…" value="${movie.trailerUrl || ''}"></div>
      <div class="field"><label>Description</label>
        <textarea id="f-description" rows="3">${movie.description || ''}</textarea></div>

      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancelForm">Cancel</button>
        <button type="submit" class="btn btn-primary" id="saveMovie">${movie.movieId ? 'Save changes' : 'Add movie'}</button>
      </div>
    </form>`;
}

function readMovieForm(bodyEl) {
  return {
    title: bodyEl.querySelector('#f-title').value,
    genre: bodyEl.querySelector('#f-genre').value,
    language: bodyEl.querySelector('#f-language').value,
    certificate: bodyEl.querySelector('#f-certificate').value,
    duration: bodyEl.querySelector('#f-duration').value,
    status: bodyEl.querySelector('#f-status').value,
    posterUrl: bodyEl.querySelector('#f-poster').value,
    trailerUrl: bodyEl.querySelector('#f-trailer').value,
    description: bodyEl.querySelector('#f-description').value,
    formats: [...bodyEl.querySelectorAll('.checkbox-row input:checked')].map(i => i.value),
  };
}

function openMovieModal(movie, onDone) {
  openModal({
    title: movie?.movieId ? `Edit ${movie.title}` : 'Add movie',
    size: 'md',
    body: movieForm(movie || {}),
    onMount(bodyEl) {
      bodyEl.querySelector('#cancelForm').addEventListener('click', closeModal);
      bodyEl.querySelector('#movieForm').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = bodyEl.querySelector('#saveMovie');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const payload = readMovieForm(bodyEl);
          if (!payload.formats.length) throw new Error('Pick at least one format');
          if (movie?.movieId) await api.updateMovie(movie.movieId, payload);
          else await api.createMovie(payload);
          closeModal();
          toast(movie?.movieId ? 'Movie updated' : 'Movie added', 'success');
          onDone();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false; btn.textContent = 'Save';
        }
      });
    },
  });
}

async function renderMovies(host) {
  host.innerHTML = spinner();
  try {
    const movies = await api.movies();

    host.innerHTML = html`
      <div class="admin-bar">
        <h3>${movies.length} movies</h3>
        <button class="btn btn-primary btn-sm" id="addMovie">+ Add movie</button>
      </div>
      <div class="admin-list">
        ${raw(movies.map(m => html`
          <div class="admin-item">
            ${m.posterUrl
              ? raw(html`<img class="admin-thumb" src="${m.posterUrl}" alt="" loading="lazy">`)
              : raw(html`<div class="admin-thumb admin-thumb--empty">🎬</div>`)}
            <div class="admin-item-body">
              <strong>${m.title}</strong>
              <span class="muted">
                ${m.genre} · ${m.language} · ${m.certificate || '—'} ·
                ${(m.formats || []).join(', ')}
                ${m.status === 'coming_soon' ? ' · Coming soon' : ''}
                ${m.trailerUrl ? ' · 🎬 trailer' : ''}
              </span>
            </div>
            <div class="admin-item-actions">
              <button class="btn btn-ghost btn-sm" data-edit="${m.movieId}">Edit</button>
              <button class="btn btn-danger btn-sm" data-del="${m.movieId}" data-title="${m.title}">Delete</button>
            </div>
          </div>`).join(''))}
      </div>`;

    const reload = () => renderMovies(host);
    host.querySelector('#addMovie').addEventListener('click', () => openMovieModal(null, reload));

    host.addEventListener('click', async e => {
      const edit = e.target.closest('[data-edit]');
      if (edit) return openMovieModal(movies.find(m => m.movieId === edit.dataset.edit), reload);

      const del = e.target.closest('[data-del]');
      if (!del) return;
      if (!confirm(`Delete "${del.dataset.title}"?`)) return;
      try {
        await api.deleteMovie(del.dataset.del);
        toast('Movie deleted', 'success');
        reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  } catch (err) {
    host.innerHTML = emptyState({ icon: '⚠️', title: 'Could not load movies', message: err.message });
  }
}

// ------------------------------------------------------------- theatres

async function renderTheatres(host) {
  host.innerHTML = spinner();
  try {
    const theatres = await api.theatres();
    const byCity = {};
    for (const t of theatres) (byCity[t.city] = byCity[t.city] || []).push(t);

    host.innerHTML = html`
      <div class="admin-bar"><h3>${theatres.length} theatres</h3></div>
      ${raw(Object.entries(byCity).map(([city, list]) => html`
        <div class="admin-panel">
          <h4>${cityName(city)}</h4>
          ${raw(list.map(t => html`
            <div class="admin-item admin-item--stack">
              <div class="admin-item-body">
                <strong>${t.name}</strong>
                <span class="muted">${t.area || ''}</span>
                <div class="screen-chips">
                  ${raw((t.screens || []).map(s => html`
                    <span class="screen-chip">
                      <strong>${s.name}</strong>
                      <span>${s.layoutId} · ${s.supportedFormats.join('/')}</span>
                      <span>${Object.entries(s.basePrices).map(([k, v]) => `${k} ${rupees(v)}`).join(' · ')}</span>
                    </span>`).join(''))}
                </div>
              </div>
            </div>`).join(''))}
        </div>`).join(''))}`;
  } catch (err) {
    host.innerHTML = emptyState({ icon: '⚠️', title: 'Could not load theatres', message: err.message });
  }
}

// ---------------------------------------------------------------- shows

async function renderShows(host) {
  host.innerHTML = spinner();
  try {
    const [movies, theatres] = await Promise.all([
      api.movies({ status: 'now_showing' }),
      api.theatres(),
    ]);

    host.innerHTML = html`
      <div class="admin-panel">
        <h3>Generate a schedule</h3>
        <p class="muted">Creates the same daily showtimes across the next N days for one screen.</p>

        <form id="genForm" class="admin-form">
          <div class="field-row">
            <div class="field"><label>Movie</label>
              <select id="g-movie">
                ${raw(movies.map(m => html`<option value="${m.movieId}">${m.title} (${(m.formats || []).join('/')})</option>`).join(''))}
              </select></div>
            <div class="field"><label>Theatre</label>
              <select id="g-theatre">
                ${raw(theatres.map(t => html`<option value="${t.theatreId}">${t.name} — ${cityName(t.city)}</option>`).join(''))}
              </select></div>
          </div>

          <div class="field-row">
            <div class="field"><label>Screen</label><select id="g-screen"></select></div>
            <div class="field"><label>Format</label><select id="g-format"></select></div>
          </div>

          <div class="field-row">
            <div class="field"><label>Times (comma separated, 24h)</label>
              <input id="g-times" value="09:30, 13:00, 16:30, 20:00" placeholder="09:30, 13:00"></div>
            <div class="field"><label>Days ahead</label>
              <input id="g-days" type="number" min="1" max="30" value="7"></div>
          </div>

          <button type="submit" class="btn btn-primary" id="genBtn">Generate shows</button>
        </form>
      </div>`;

    const movieSel = host.querySelector('#g-movie');
    const theatreSel = host.querySelector('#g-theatre');
    const screenSel = host.querySelector('#g-screen');
    const formatSel = host.querySelector('#g-format');

    /** Only offer formats the film and the screen both support. */
    function refreshScreens() {
      const theatre = theatres.find(t => t.theatreId === theatreSel.value);
      screenSel.innerHTML = (theatre?.screens || [])
        .map(s => html`<option value="${s.screenId}">${s.name}</option>`).join('');
      refreshFormats();
    }

    function refreshFormats() {
      const movie = movies.find(m => m.movieId === movieSel.value);
      const theatre = theatres.find(t => t.theatreId === theatreSel.value);
      const screen = (theatre?.screens || []).find(s => s.screenId === screenSel.value);
      const shared = (screen?.supportedFormats || []).filter(f => (movie?.formats || []).includes(f));

      formatSel.innerHTML = shared.length
        ? shared.map(f => html`<option value="${f}">${f}</option>`).join('')
        : '<option value="">No compatible format</option>';
      formatSel.disabled = !shared.length;
      host.querySelector('#genBtn').disabled = !shared.length;
    }

    movieSel.addEventListener('change', refreshFormats);
    theatreSel.addEventListener('change', refreshScreens);
    screenSel.addEventListener('change', refreshFormats);
    refreshScreens();

    host.querySelector('#genForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = host.querySelector('#genBtn');
      btn.disabled = true; btn.textContent = 'Generating…';
      try {
        const res = await api.generateShows({
          movieId: movieSel.value,
          theatreId: theatreSel.value,
          screenId: screenSel.value,
          format: formatSel.value,
          times: host.querySelector('#g-times').value.split(',').map(s => s.trim()).filter(Boolean),
          days: Number(host.querySelector('#g-days').value),
        });
        toast(res.message, 'success');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Generate shows';
      }
    });
  } catch (err) {
    host.innerHTML = emptyState({ icon: '⚠️', title: 'Could not load form data', message: err.message });
  }
}

// ----------------------------------------------------------------- shell

export async function renderAdmin(container, { query }) {
  const active = TABS.some(t => t.id === query.tab) ? query.tab : 'overview';

  container.innerHTML = html`
    <div class="page-head">
      <h1>Admin</h1>
      <p>Manage the catalog, cinemas and schedule</p>
    </div>
    <div class="tab-row">
      ${raw(TABS.map(t => html`
        <a class="tab ${t.id === active ? 'is-active' : ''}" href="/admin?tab=${t.id}">${t.label}</a>`).join(''))}
    </div>
    <div id="tabHost"></div>`;

  const host = container.querySelector('#tabHost');
  const renderers = {
    overview: renderOverview,
    movies: renderMovies,
    theatres: renderTheatres,
    shows: renderShows,
  };
  renderers[active](host);
}
