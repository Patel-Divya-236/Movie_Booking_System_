import { openModal } from './modal.js';
import { html, youtubeId } from '../dom.js';
import { toast } from './toast.js';

/**
 * Play a movie trailer in a dialog.
 *
 * youtube-nocookie avoids setting tracking cookies. The iframe src is blanked
 * on close — without that the video keeps playing (and keeps making noise)
 * after the modal is gone.
 */
export function openTrailer(movie) {
  const id = youtubeId(movie.trailerUrl);
  if (!id) {
    toast('No trailer available for this title yet', 'info');
    return;
  }

  let iframe = null;

  openModal({
    title: `${movie.title} — Trailer`,
    size: 'lg',
    body: html`
      <div class="trailer-frame">
        <iframe
          id="trailerIframe"
          src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1"
          title="${movie.title} trailer"
          frameborder="0"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        ></iframe>
      </div>`,
    onMount(bodyEl) {
      iframe = bodyEl.querySelector('#trailerIframe');
    },
    onClose() {
      if (iframe) iframe.src = 'about:blank';
    },
  });
}
