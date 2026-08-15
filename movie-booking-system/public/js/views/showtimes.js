import { html, raw, spinner, emptyState, dayLabel, rupees } from '../dom.js';
import { state, cityName } from '../state.js';
import { api } from '../api.js';

const AVAILABILITY_LABEL = {
  available: 'Available',
  fast_filling: 'Filling fast',
  sold_out: 'Sold out',
};

function showChip(show) {
  const cheapest = Math.min(...Object.values(show.prices || {}).filter(Number.isFinite));
  const soldOut = show.availability === 'sold_out';

  return html`
    <a class="show-chip is-${show.availability} ${soldOut ? 'is-disabled' : ''}"
       ${raw(soldOut ? '' : `href="/show/${show.showId}/seats"`)}
       title="${show.screenName} · ${show.language} · ${AVAILABILITY_LABEL[show.availability]} · from ${rupees(cheapest)}">
      <span class="show-chip-time">${show.time}</span>
      <span class="show-chip-format">${show.format}</span>
      <span class="show-chip-meta">${soldOut ? 'Sold out' : `${show.seatsLeft} left`}</span>
    </a>`;
}

/**
 * Shows are grouped by language first, then format — that's the order a
 * cinema-goer decides in: which language am I watching this in, then 2D or 3D.
 */
function theatreBlock(theatre) {
  const byLanguage = new Map();
  for (const show of theatre.shows) {
    if (!byLanguage.has(show.language)) byLanguage.set(show.language, new Map());
    const formats = byLanguage.get(show.language);
    if (!formats.has(show.format)) formats.set(show.format, []);
    formats.get(show.format).push(show);
  }

  const languageBlocks = [...byLanguage.entries()].map(([language, formats]) => html`
    <div class="lang-group">
      <div class="lang-group-head">
        <span class="lang-badge">${language}</span>
        ${[...formats.values()][0][0].isDubbed
          ? raw(html`<span class="dub-note">dubbed</span>`)
          : ''}
      </div>
      ${raw([...formats.entries()].map(([format, shows]) => html`
        <div class="format-group">
          <div class="format-group-label">
            <span class="format-pill format-pill--solid">${format}</span>
            <span class="format-group-screen">${shows[0].screenName}</span>
          </div>
          <div class="show-chips">${raw(shows.map(showChip).join(''))}</div>
        </div>`).join(''))}
    </div>`).join('');

  return html`
    <section class="theatre-block">
      <header class="theatre-head">
        <div>
          <h3>${theatre.theatreName}</h3>
          ${theatre.area ? raw(html`<p class="theatre-area">📍 ${theatre.area}</p>`) : ''}
        </div>
      </header>
      ${raw(languageBlocks)}
    </section>`;
}

export async function renderShowtimes(container, { params, query }) {
  const movieId = params.movieId;

  if (!state.city) {
    container.innerHTML = emptyState({
      icon: '📍', title: 'Pick a city first',
      message: 'Use the city selector in the header to see showtimes.',
    });
    return;
  }

  container.innerHTML = spinner();

  let movie, dates;
  try {
    [movie, dates] = await Promise.all([
      api.movie(movieId),
      api.showDates({ movieId, city: state.city }).then(r => r.dates || []),
    ]);
  } catch (err) {
    container.innerHTML = emptyState({ icon: '⚠️', title: 'Could not load showtimes', message: err.message });
    return;
  }

  state.movie = movie;

  if (!dates.length) {
    container.innerHTML = html`
      <a class="back-link" href="/movie/${movieId}">← ${movie.title}</a>
      ${raw(emptyState({
        icon: '🎭',
        title: `Not playing in ${cityName()}`,
        message: 'There are no upcoming shows for this film in your city. Try another city.',
        action: '<a class="btn btn-primary" href="/" style="margin-top:16px">Browse movies</a>',
      }))}`;
    return;
  }

  const selected = dates.includes(query.date) ? query.date : dates[0];

  container.innerHTML = html`
    <a class="back-link" href="/movie/${movieId}">← ${movie.title}</a>

    <div class="page-head page-head--tight">
      <h1>${movie.title}</h1>
      <p>${[movie.certificate, movie.genre, movie.language].filter(Boolean).join(' · ')} · ${cityName()}</p>
    </div>

    <div class="date-strip" role="tablist" aria-label="Show date">
      ${raw(dates.map(d => {
        const { top, bottom } = dayLabel(d);
        return html`
          <button class="date-pill ${d === selected ? 'is-active' : ''}" data-date="${d}"
                  role="tab" aria-selected="${d === selected ? 'true' : 'false'}">
            <span class="date-pill-top">${top}</span>
            <span class="date-pill-bottom">${bottom}</span>
          </button>`;
      }).join(''))}
    </div>

    <div class="show-filters" id="showFilters"></div>

    <div class="legend-row">
      <span class="legend-dot is-available"></span> Available
      <span class="legend-dot is-fast_filling"></span> Filling fast
      <span class="legend-dot is-sold_out"></span> Sold out
    </div>

    <div id="theatreHost">${raw(spinner())}</div>`;

  const host = container.querySelector('#theatreHost');
  const filterHost = container.querySelector('#showFilters');

  let dayData = null;
  let pickedFormat = 'all';
  let pickedLanguage = 'all';

  /** Filters are built from what is actually on today, never a fixed list. */
  function paintFilters() {
    const all = dayData.theatres.flatMap(t => t.shows);
    const formats = [...new Set(all.map(s => s.format))].sort();
    const languages = [...new Set(all.map(s => s.language))].sort();

    // A single option is not a choice — don't clutter the page with it.
    const groups = [];
    if (languages.length > 1) {
      groups.push({ key: 'language', label: 'Language', values: languages, picked: pickedLanguage });
    }
    if (formats.length > 1) {
      groups.push({ key: 'format', label: 'Format', values: formats, picked: pickedFormat });
    }

    filterHost.innerHTML = groups.map(g => html`
      <div class="filter-group">
        <span class="filter-label">${g.label}</span>
        <div class="chip-row">
          <button class="chip ${g.picked === 'all' ? 'is-active' : ''}" data-${g.key}="all">All</button>
          ${raw(g.values.map(v => html`
            <button class="chip ${g.picked === v ? 'is-active' : ''}" data-${g.key}="${v}">${v}</button>`).join(''))}
        </div>
      </div>`).join('');
  }

  function paintTheatres() {
    const filtered = dayData.theatres
      .map(t => ({
        ...t,
        shows: t.shows.filter(s =>
          (pickedFormat === 'all' || s.format === pickedFormat) &&
          (pickedLanguage === 'all' || s.language === pickedLanguage)
        ),
      }))
      .filter(t => t.shows.length);

    host.innerHTML = filtered.length
      ? filtered.map(theatreBlock).join('')
      : emptyState({
          icon: '🎭',
          title: 'Nothing matches those filters',
          message: 'Try a different language or format, or another date.',
        });
  }

  filterHost.addEventListener('click', e => {
    const chip = e.target.closest('[data-format], [data-language]');
    if (!chip) return;
    if (chip.dataset.format !== undefined) pickedFormat = chip.dataset.format;
    if (chip.dataset.language !== undefined) pickedLanguage = chip.dataset.language;
    paintFilters();
    paintTheatres();
  });

  async function loadDay(date) {
    host.innerHTML = spinner();
    filterHost.innerHTML = '';
    pickedFormat = 'all';
    pickedLanguage = 'all';
    try {
      dayData = await api.shows({ movieId, city: state.city, date });
      if (!dayData.theatres.length) {
        host.innerHTML = emptyState({
          icon: '🕐',
          title: 'No shows left today',
          message: 'Every show for this date has already started. Try tomorrow.',
        });
        return;
      }
      paintFilters();
      paintTheatres();
    } catch (err) {
      host.innerHTML = emptyState({ icon: '⚠️', title: 'Could not load shows', message: err.message });
    }
  }

  container.querySelector('.date-strip').addEventListener('click', e => {
    const pill = e.target.closest('[data-date]');
    if (!pill) return;

    container.querySelectorAll('.date-pill').forEach(p => {
      const active = p === pill;
      p.classList.toggle('is-active', active);
      p.setAttribute('aria-selected', String(active));
    });

    // Keep the date in the URL so the page can be shared or reloaded.
    const url = `/movie/${movieId}/shows?date=${pill.dataset.date}`;
    window.history.replaceState({}, '', url);
    loadDay(pill.dataset.date);
  });

  loadDay(selected);
}
