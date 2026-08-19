/**
 * Deployment-dependent settings.
 *
 * The frontend is served from two places: the EC2 instance (same origin as the
 * API) and Vercel (a different origin entirely). This is the one file that has
 * to know the difference, and it works it out at runtime rather than at build
 * time — the project has no bundler, so there is no build step to inject an
 * environment variable into.
 *
 * BACKEND_ORIGIN must be HTTPS. A page served over HTTPS cannot call an HTTP
 * address: browsers block it as mixed content, with no override. Point it at
 * whatever fronts the EC2 instance with a certificate (a CloudFront
 * distribution, or nginx with a Let's Encrypt cert).
 */

const BACKEND_ORIGIN = 'https://REPLACE-WITH-YOUR-HTTPS-BACKEND';

/** True when this page is not served by the API itself. */
function isSplitDeployment() {
  const h = window.location.hostname;
  return h.endsWith('.vercel.app') || h.endsWith('.vercel.sh');
}

/**
 * Same-origin '/api' locally and on EC2, absolute when the frontend is hosted
 * separately. Keeping the relative form where it works avoids CORS entirely
 * for local development.
 */
export const API_BASE = isSplitDeployment() ? `${BACKEND_ORIGIN}/api` : '/api';

/** Where emailed links should land — the frontend, not the API. */
export const APP_ORIGIN = window.location.origin;
