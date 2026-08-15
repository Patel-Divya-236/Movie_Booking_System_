/**
 * History-API router.
 *
 * Real URLs, so pages are shareable and the back button works — the server
 * already serves index.html for any non-API path, so a deep link loads fine.
 */

const routes = [];
let notFound = () => {};
let beforeEach = () => true;

/** define('/movie/:id', handler) — :params are captured and passed through. */
export function define(pattern, handler, opts = {}) {
  const names = [];
  const regex = new RegExp(
    '^' + pattern.replace(/:[^/]+/g, m => { names.push(m.slice(1)); return '([^/]+)'; }) + '/?$'
  );
  routes.push({ pattern, regex, names, handler, ...opts });
}

export function setNotFound(fn) { notFound = fn; }
export function setGuard(fn) { beforeEach = fn; }

export function currentPath() {
  return window.location.pathname || '/';
}

/** Navigate, pushing a history entry unless `replace` is set. */
export function go(path, { replace = false, state: histState = {} } = {}) {
  if (path === currentPath() && !replace) return resolve();
  window.history[replace ? 'replaceState' : 'pushState'](histState, '', path);
  resolve();
}

export function back() {
  window.history.back();
}

export async function resolve() {
  const path = currentPath();

  for (const route of routes) {
    const match = path.match(route.regex);
    if (!match) continue;

    const params = {};
    route.names.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
    const query = Object.fromEntries(new URLSearchParams(window.location.search));

    const allowed = await beforeEach(route, { params, query });
    if (allowed === false) return;

    window.scrollTo({ top: 0, behavior: 'instant' });
    return route.handler({ params, query, route });
  }

  return notFound();
}

export function start() {
  window.addEventListener('popstate', resolve);

  // Any <a href="/..."> becomes a client-side navigation, so views can use
  // plain links instead of onclick handlers.
  document.addEventListener('click', e => {
    const link = e.target.closest('a[href^="/"]');
    if (!link) return;
    if (link.target === '_blank' || link.hasAttribute('download')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;

    e.preventDefault();
    go(link.getAttribute('href'));
  });

  resolve();
}
