# Frontend on Vercel, backend on AWS

The frontend is the static contents of `public/`. The API stays on the EC2
instance, talking to DynamoDB. Only two things make that split work.

## 1. The backend must serve HTTPS

A page served over HTTPS cannot call an HTTP address — browsers block it as
mixed content and there is no override. `http://13.233.126.31` therefore
cannot be the API origin for a Vercel-hosted page.

Two ways to fix it, both free:

**CloudFront (AWS-native, no domain needed).** Create a distribution with the
EC2 public DNS as a custom origin, origin protocol **HTTP only**, viewer
protocol **redirect-to-HTTPS**. It comes with a certificate for its own
`dxxxxx.cloudfront.net` name, so nothing has to be bought or verified. For an
API, attach the **CachingDisabled** cache policy and the **AllViewer** origin
request policy — otherwise CloudFront strips the `Authorization` header and
caches responses that must not be cached. Allow all HTTP methods, or every
POST will fail.

**Let's Encrypt on the instance.** Point a free hostname (DuckDNS) at the
elastic IP, open 443 in `cinecloud-sg`, then `certbot --nginx`. Gives
`https://<name>.duckdns.org` straight from nginx.

## 2. Point the two halves at each other

- `public/js/config.js` → set `BACKEND_ORIGIN` to the HTTPS backend URL.
- On the instance, `.env` → `ALLOWED_ORIGINS=https://<project>.vercel.app`
  (comma-separated for more than one).
- On the instance, `.env` → `APP_BASE_URL=https://<project>.vercel.app`, so
  verification and password-reset links open the frontend rather than the API.
- `pm2 restart cinecloud --update-env` for both to take effect.

## Deploying

Vercel builds nothing: `outputDirectory` is `public/` and the rewrite sends
non-file paths to `index.html` so the History-API router keeps working on a
refresh or a deep link. Push to `main` and Vercel redeploys.

## Checking it

    curl -I https://<backend>/api/health
    curl -H "Origin: https://<project>.vercel.app" -I https://<backend>/api/health

The second must come back with `access-control-allow-origin`. If it does not,
`ALLOWED_ORIGINS` is wrong or pm2 was restarted without `--update-env`.
