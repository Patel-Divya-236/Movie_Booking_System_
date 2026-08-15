import { html, raw, spinner, emptyState, youtubeId } from '../dom.js';
import { state, cityName } from '../state.js';
import { api } from '../api.js';
import { openTrailer } from '../components/trailerModal.js';
import { toast } from '../components/toast.js';

export async function renderMovieDetail(container, { params }) {
  container.innerHTML = spinner();

  let movie;
  try {
    movie = await api.movie(params.movieId);
  } catch (err) {
    container.innerHTML = emptyState({
      icon: '⚠️',
      title: 'Movie not found',
      message: err.message,
      action: '<a class="btn btn-primary" href="/" style="margin-top:16px">Back to movies</a>',
    });
    return;
  }

  state.movie = movie;
  const hasTrailer = Boolean(youtubeId(movie.trailerUrl));
  const comingSoon = movie.status === 'coming_soon';

  const poster = movie.posterUrl
    ? html`<img src="${movie.posterUrl}" alt="${movie.title} poster" class="detail-poster">`
    : html`<div class="detail-poster detail-poster--empty">🎬</div>`;

  container.innerHTML = html`
    <a class="back-link" href="/">← Movies in ${cityName()}</a>

    <article class="detail">
      ${movie.backdropUrl
        ? raw(html`<div class="detail-backdrop" style="background-image:url('${movie.backdropUrl}')"></div>`)
        : ''}

      <div class="detail-main">
        <div class="detail-poster-wrap">
          ${raw(poster)}
          ${hasTrailer ? raw(html`<button class="trailer-btn" id="playTrailer">▶ Watch trailer</button>`) : ''}
        </div>

        <div class="detail-info">
          <h1>${movie.title}</h1>

          <div class="detail-tags">
            ${movie.rating ? raw(html`<span class="tag tag-rating">★ ${movie.rating}</span>`) : ''}
            <span class="tag tag-genre">${movie.genre}</span>
            <span class="tag tag-lang">${movie.language}</span>
            ${movie.certificate ? raw(html`<span class="tag tag-cert">${movie.certificate}</span>`) : ''}
            ${movie.duration ? raw(html`<span class="tag">⏱ ${movie.duration}</span>`) : ''}
          </div>

          <div class="format-strip format-strip--lg">
            ${raw((movie.formats || []).map(f => html`<span class="format-pill">${f}</span>`).join(''))}
          </div>

          ${movie.description ? raw(html`<p class="detail-synopsis">${movie.description}</p>`) : ''}

          <div class="ratings" id="ratingsBlock"></div>

          <div class="detail-actions">
            ${comingSoon
              ? raw(html`<button class="btn btn-lg" disabled>Booking not open yet</button>`)
              : raw(html`<a class="btn btn-primary btn-lg" href="/movie/${movie.movieId}/shows">
                   Book tickets in ${cityName()}
                 </a>`)}
            ${hasTrailer ? raw(html`<button class="btn btn-ghost btn-lg" id="playTrailer2">▶ Trailer</button>`) : ''}
          </div>
        </div>
      </div>
    </article>

    <section class="reviews" id="reviewsList"></section>`;

  if (hasTrailer) {
    container.querySelector('#playTrailer')?.addEventListener('click', () => openTrailer(movie));
    container.querySelector('#playTrailer2')?.addEventListener('click', () => openTrailer(movie));
  }

  // Loaded after the page paints — the poster, synopsis and Book button are
  // what the visitor came for, and none of them should wait on the ratings.
  loadRatings(container, movie);
}

/** Filled stars up to `value`, hollow after — used for both display and input. */
function starRow(value, max = 5) {
  return Array.from({ length: max }, (_, i) => (i < Math.round(value) ? '★' : '☆')).join('');
}

/** Always one decimal: a bare "3" beside "5.6/10" reads as a different scale. */
const score = n => Number(n).toFixed(1);

async function loadRatings(container, movie) {
  const block = container.querySelector('#ratingsBlock');
  const listHost = container.querySelector('#reviewsList');
  if (!block) return;

  let data;
  try {
    data = await api.reviews(movie.movieId);
  } catch {
    // A ratings failure must not take the page down with it.
    block.remove();
    return;
  }

  const { summary, reviews, mine, canReview, reason } = data;

  /* --- the two scores, each labelled with its own source and scale --------
     TMDB is out of 10 and ours is out of 5. Showing "8.4" beside "4.2" with
     no labels reads as one being twice the other, so the scale is always
     printed next to the number. */
  const tmdbRow = summary.tmdb
    ? html`
      <div class="rating-src">
        <span class="rating-src-name">TMDB</span>
        <span class="rating-src-score">★ ${score(summary.tmdb)}<small>/10</small></span>
      </div>`
    : '';

  const userRow = summary.count
    ? html`
      <div class="rating-src">
        <span class="rating-src-name">CineCloud</span>
        <span class="rating-src-score">★ ${score(summary.user)}<small>/5</small></span>
        <span class="rating-src-count">${summary.count} ${summary.count === 1 ? 'rating' : 'ratings'}</span>
      </div>`
    : html`
      <div class="rating-src rating-src--empty">
        <span class="rating-src-name">CineCloud</span>
        <span class="rating-src-score">No ratings yet</span>
      </div>`;

  block.innerHTML = html`
    <div class="rating-sources">
      ${raw(tmdbRow)}
      ${raw(userRow)}
    </div>
    ${summary.provisional
      ? raw(html`<p class="rating-note">Based on only a few ratings so far.</p>`)
      : ''}
    <div class="rating-mine" id="rateHost"></div>`;

  /* --- the star control ------------------------------------------------- */
  const rateHost = block.querySelector('#rateHost');

  function paintControl(current, message = '') {
    if (!canReview) {
      rateHost.innerHTML = html`<p class="rating-locked">${reason}</p>`;
      return;
    }
    rateHost.innerHTML = html`
      <span class="rating-mine-label">${current ? 'Your rating' : 'Rate this film'}</span>
      <span class="star-input" role="radiogroup" aria-label="Your rating">
        ${raw([1, 2, 3, 4, 5].map(n => html`
          <button type="button" class="star ${current && n <= current ? 'is-on' : ''}"
                  data-star="${n}" role="radio" aria-checked="${current === n ? 'true' : 'false'}"
                  aria-label="${n} out of 5">${current && n <= current ? '★' : '☆'}</button>`).join(''))}
      </span>
      ${message ? raw(html`<span class="rating-thanks">${message}</span>`) : ''}`;

    rateHost.querySelectorAll('[data-star]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const value = Number(btn.dataset.star);
        rateHost.querySelectorAll('[data-star]').forEach(b => { b.disabled = true; });
        try {
          const res = await api.rateMovie(movie.movieId, { rating: value });
          // Repaint the aggregate from the server's answer rather than
          // recomputing locally — it is the only copy that counts.
          if (res.summary && res.summary.count) {
            block.querySelector('.rating-sources').innerHTML = html`
              ${raw(tmdbRow)}
              <div class="rating-src">
                <span class="rating-src-name">CineCloud</span>
                <span class="rating-src-score">★ ${score(res.summary.user)}<small>/5</small></span>
                <span class="rating-src-count">${res.summary.count} ${res.summary.count === 1 ? 'rating' : 'ratings'}</span>
              </div>`;
          }
          toast(res.message, 'success');
          paintControl(value, 'Saved');
        } catch (err) {
          toast(err.message, 'error');
          paintControl(current);
        }
      });
    });
  }

  paintControl(mine ? mine.rating : 0);

  /* --- what people said -------------------------------------------------- */
  if (reviews.length) {
    listHost.innerHTML = html`
      <h2 class="reviews-head">What people are saying</h2>
      <div class="review-grid">
        ${raw(reviews.map(r => html`
          <article class="review">
            <div class="review-top">
              <span class="review-who">${r.userName}</span>
              <span class="review-stars">${starRow(r.rating)}</span>
            </div>
            ${r.comment ? raw(html`<p class="review-body">${r.comment}</p>`) : ''}
          </article>`).join(''))}
      </div>`;
  }
}
