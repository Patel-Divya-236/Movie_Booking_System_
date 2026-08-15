import { html, raw, skeletonGrid, emptyState } from '../dom.js';
import { state, cityName } from '../state.js';
import { api } from '../api.js';
import { openCityPicker } from '../components/navbar.js';

function movieCard(movie) {
  const poster = movie.posterUrl
    ? html`<img src="${movie.posterUrl}" alt="" class="poster" loading="lazy"
             onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'poster poster--empty',textContent:'🎬'}))">`
    : html`<div class="poster poster--empty">🎬</div>`;

  const formats = (movie.formats || []).slice(0, 3);

  return html`
    <a class="movie-card" href="/movie/${movie.movieId}">
      <div class="movie-card-poster">
        ${raw(poster)}
        ${movie.rating ? raw(html`<span class="rating-badge">★ ${movie.rating}</span>`) : ''}
        ${movie.status === 'coming_soon' ? raw(html`<span class="soon-badge">Coming soon</span>`) : ''}
      </div>
      <div class="movie-card-body">
        <h3 class="movie-card-title">${movie.title}</h3>
        <div class="movie-card-meta">
          <span class="tag tag-genre">${movie.genre}</span>
          <span class="tag tag-lang">${movie.language}</span>
        </div>
        <div class="format-strip">
          ${raw(formats.map(f => html`<span class="format-pill">${f}</span>`).join(''))}
        </div>
      </div>
    </a>`;
}

function section(title, subtitle, movies) {
  if (!movies.length) return '';
  return html`
    <section class="rail">
      <div class="rail-head">
        <h2>${title}</h2>
        ${subtitle ? raw(html`<p>${subtitle}</p>`) : ''}
      </div>
      <div class="movie-grid">${raw(movies.map(movieCard).join(''))}</div>
    </section>`;
}

export async function renderHome(container) {
  if (!state.city) {
    container.innerHTML = html`
      ${raw(emptyState({
        icon: '📍',
        title: 'Pick your city first',
        message: 'Cinemas and showtimes are listed per city.',
        action: '<button class="btn btn-primary" id="pickCity" style="margin-top:16px">Choose city</button>',
      }))}`;
    container.querySelector('#pickCity').addEventListener('click', () => openCityPicker({ force: true }));
    return;
  }

  container.innerHTML = html`
    <div class="page-head">
      <h1>Movies in ${cityName()}</h1>
      <p>Book tickets for what's playing near you</p>
    </div>
    <div class="filters">
      <input type="search" class="search-input" id="search" placeholder="Search movies…" aria-label="Search movies">
      <div class="chip-row" id="langChips"></div>
    </div>
    <div id="railHost"><div class="movie-grid">${raw(skeletonGrid(10))}</div></div>`;

  const railHost = container.querySelector('#railHost');

  let movies = [];
  try {
    movies = await api.movies({ city: state.city });
  } catch (err) {
    railHost.innerHTML = emptyState({ icon: '⚠️', title: 'Could not load movies', message: err.message });
    return;
  }

  // Languages present in this city, so the chips never offer an empty filter.
  const languages = ['All', ...new Set(movies.map(m => m.language).filter(Boolean))];
  container.querySelector('#langChips').innerHTML = languages
    .map((l, i) => html`<button class="chip ${i === 0 ? 'is-active' : ''}" data-lang="${l}">${l}</button>`)
    .join('');

  let search = '';
  let language = 'All';

  function paint() {
    const term = search.trim().toLowerCase();
    const filtered = movies.filter(m =>
      (language === 'All' || m.language === language) &&
      (!term || m.title.toLowerCase().includes(term))
    );

    if (!filtered.length) {
      railHost.innerHTML = emptyState({
        icon: '🔍',
        title: 'No movies match',
        message: 'Try a different search or language.',
      });
      return;
    }

    railHost.innerHTML =
      section('Now Showing', null, filtered.filter(m => m.status === 'now_showing')) +
      section('Coming Soon', 'Booking opens closer to release', filtered.filter(m => m.status === 'coming_soon'));
  }

  container.querySelector('#search').addEventListener('input', e => {
    search = e.target.value;
    paint();
  });

  container.querySelector('#langChips').addEventListener('click', e => {
    const chip = e.target.closest('[data-lang]');
    if (!chip) return;
    language = chip.dataset.lang;
    container.querySelectorAll('#langChips .chip')
      .forEach(c => c.classList.toggle('is-active', c === chip));
    paint();
  });

  paint();
}
