# Sawaari

Sawaari is an Expo / React Native ride-booking app foundation for Pakistan. The mobile app, website, and admin panel use a Node.js API on the VPS and PostgreSQL. Supabase is not used by the running application. The PostgreSQL database starts empty; the existing Supabase project and its data are left untouched as a backup and are not imported.

The old `supabase/migrations/` SQL files are retained only as legacy reference. Do not apply them for this VPS backend; `server/schema.sql` is the current PostgreSQL schema.

## Local development

1. Install Node.js 22 and run `npm ci`.
2. Copy `.env.example` to `.env`. Set `EXPO_PUBLIC_API_URL` to the API's public `/api` URL for native app builds. Set `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` to a URL-restricted Mapbox public token for the website, and set `TOMTOM_API_KEY_SERVER` to a TomTom Search key for local web location search. Keep the TomTom key server-only; it is used by a localhost-only proxy and is not included in the web bundle. Set `EXPO_PUBLIC_WHATSAPP_SUPPORT_NUMBER` to the official WhatsApp Business number in international format using digits only; leave it blank until the real number is available.
3. Run `npm run web` for the local web preview or `npx expo start` for Expo Go.

Web builds use the same-origin `/api` route. Native builds call `EXPO_PUBLIC_API_URL` (defaults to `https://sawaari.online/api`). A running VPS API and PostgreSQL database are required for user accounts, email verification, driver documents, and shared rides. The preview does not create fake accounts or drivers.

The website uses Mapbox GL JS for map rendering, reverse geocoding, and road directions. TomTom Search provides primary website autocomplete; Photon/OpenStreetMap is queried only when TomTom returns no acceptable location match. The native app keeps its existing map/provider path. Riders can choose pickup and destination from search, map taps, or draggable pins; actual route distance and duration feed the existing fare estimate. Location access still requires browser/device permission. Starter fare values are examples, not current market rates or live quotes.

Start the local TomTom proxy in one terminal with `npm run map-search:dev`, then start Expo web in another with `npm run web`. The proxy binds only to `127.0.0.1`; do not expose it to the network. The production API uses the server-only `TOMTOM_API_KEY_SERVER` setting in `/etc/sawaari/api.env`.

On the Ride page, Sawaari centers the map on the rider when location permission has already been granted. Otherwise, an in-page prompt lets the rider request location access; browser/device permission is still required. Ride and driver alerts and confirmations are displayed inside Sawaari rather than browser alert dialogs. Browser push notifications are not configured.

The **Driver mode** tab opens a separate driver welcome screen. Choosing **Driver** continues to the existing sign-in, document application, approval, and driver dashboard flow; an existing Sawaari account is reused. Courier mode is shown as coming soon because delivery requests and courier onboarding are not implemented.

## VPS backend setup

The API uses PostgreSQL, Hostinger SMTP, private files on the VPS, a separate admin password, and rate-limited database-backed user sessions. Apply these steps on the VPS before deploying the new website, so the app's API routes are ready when the website changes.

### 1. Install prerequisites and PostgreSQL

On Ubuntu, install Node.js 22, PostgreSQL, Nginx, and rsync. Create a dedicated PostgreSQL database and user. For a local PostgreSQL install:

```sh
sudo -u postgres createuser --pwprompt sawaari_app
sudo -u postgres createdb --owner=sawaari_app sawaari
```

Use the resulting connection URL in setup, for example `postgresql://sawaari_app:YOUR_DATABASE_PASSWORD@127.0.0.1:5432/sawaari`. If using a remote managed PostgreSQL host, use its connection URL and answer yes if its connection requires TLS.

### 2. Install the source and prepare the deployment account

Keep the API source at `/opt/sawaari-source`. Clone this repository there using your GitHub access method, then prepare the directory for the deploy and service users:

```sh
sudo mkdir -p /opt/sawaari-source
sudo chown -R sawaari-deploy:www-data /opt/sawaari-source
```

The repository's GitHub Actions workflow uploads the `server/` source and package manifests to that directory. It also restarts `sawaari-api` after deployment. Permit only that exact restart command for the deploy account:

```sh
echo 'sawaari-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart sawaari-api' | sudo tee /etc/sudoers.d/sawaari-deploy-api
sudo chmod 440 /etc/sudoers.d/sawaari-deploy-api
sudo visudo -cf /etc/sudoers.d/sawaari-deploy-api
```

Change `sawaari-deploy` in these instructions if your GitHub Actions `VPS_USER` is different. Never grant the deployment account unrestricted sudo access.

### 3. Configure the API, database, SMTP, and admin login

From the source directory, run the setup interactively as root. The script prompts for your PostgreSQL URL, Hostinger SMTP host/port/email/password, sender address, and a separate admin username/password. Secret input is hidden. Enter these credentials only in the VPS terminal, never in chat or source control.

```sh
cd /opt/sawaari-source
sudo node server/setup-vps.mjs
```

Hostinger commonly uses `smtp.hostinger.com` on port `465` (SSL) or `587` (STARTTLS); verify the outgoing mail settings in your Hostinger email account. Use a valid sender address from your Hostinger mailbox/domain. The setup writes `/etc/sawaari/api.env` with restricted permissions and creates `/var/lib/sawaari/private-documents` for private driver files.

Install the service and initialize the empty database:

```sh
sudo systemctl disable --now sawaari-admin-api
sudo cp deploy/sawaari-api.service /etc/systemd/system/sawaari-api.service
sudo systemctl daemon-reload
cd /opt/sawaari-source
npm ci --omit=dev
sudo -u www-data /usr/bin/node --env-file=/etc/sawaari/api.env server/migrate.mjs
sudo systemctl enable --now sawaari-api
sudo systemctl status sawaari-api
```

The service also runs the idempotent schema migration at startup. PostgreSQL stores account password hashes, one-time email verification tokens, sessions, rides, driver presence, cash-collection confirmations, and review state. Identity documents are outside the web root, limited to 10 MB per file, and accessible only through short-lived admin links.

### 4. Configure Nginx and HTTPS

The Nginx example proxies all `/api/` requests to the local API, allows driver document uploads, and serves the static web app. Use it as the basis for the HTTPS server block in `/etc/nginx/sites-available/sawaari`:

```nginx
location /api/ {
    client_max_body_size 45m;
    proxy_pass http://127.0.0.1:3210/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Confirm the `/api/` location is in the HTTPS server block and takes precedence over the SPA fallback. Then validate/reload Nginx:

```sh
sudo nginx -t
sudo systemctl reload nginx
curl -fsS https://sawaari.online/api/health
```

Expected health response: `{"status":"ok"}`. Configure DNS, ports 80/443, and an HTTPS certificate for `sawaari.online` before allowing public use.

## Website deployment

The GitHub Actions workflow builds the web app, typechecks and lints it, deploys `dist/`, uploads the VPS API source, and restarts the API. Configure repository secrets:

| Secret | Purpose |
|---|---|
| `VPS_HOST` | VPS IP or hostname |
| `VPS_USER` | Deployment account, normally `sawaari-deploy` |
| `VPS_SSH_PRIVATE_KEY` | Private deployment key; the matching public key goes on the VPS |
| `VPS_KNOWN_HOSTS` | Verified SSH host-key line |
| `VPS_PORT` | Optional SSH port, defaults to 22 |
| `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` | Required for the production website map; use a public token with URL restrictions for local and production domains |

Set `TOMTOM_API_KEY_SERVER` in `/etc/sawaari/api.env` for production website location search. For a new VPS, the setup script prompts for this key without echoing it. Never set it as an `EXPO_PUBLIC_*` variable or include it in a client build.

If GitHub Actions is unavailable, SSH to the VPS as the deployment account and run this from its cloned source directory. The deployment account must be able to write `/var/www/sawaari/dist/` and run the authorized API restart command. Set any optional public map or WhatsApp numbers in the shell before building; do not put database, SMTP, or admin secrets here.

```sh
cd /opt/sawaari-source
git pull --ff-only origin main
npm ci
npm run typecheck
npm run lint
npm run build:web
rsync -az --delete dist/ /var/www/sawaari/dist/
npm ci --omit=dev
sudo systemctl restart sawaari-api
curl -fsS https://sawaari.online/api/health
```

Do not add database, SMTP, admin, or PostgreSQL credentials to GitHub Actions. They belong only in `/etc/sawaari/api.env` on the VPS. After deployment, test `/`, `/drive`, `/trips`, `/profile`, `/auth/confirm`, `/admin`, and `/api/health`.

### Faster and more reliable website loads

The JavaScript and CSS bundles use content-hashed filenames. Enable gzip in the active Nginx `http` configuration to reduce their transfer size, revalidate HTML on every visit so it cannot keep pointing at deleted bundles, and cache hashed assets for seven days. On Ubuntu VPS installations where `/etc/nginx/nginx.conf` includes `/etc/nginx/conf.d/*.conf`, enable compression once:

```sh
sudo tee /etc/nginx/conf.d/sawaari-gzip.conf >/dev/null <<'EOF'
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_comp_level 5;
gzip_types text/plain text/css application/json application/javascript text/javascript application/xml text/xml image/svg+xml;
EOF
sudo nginx -t
sudo systemctl reload nginx
```

If Nginx reports that gzip directives are not allowed in this file, remove the snippet and put the same directives inside the `http { ... }` block in `/etc/nginx/nginx.conf`. In the active Sawaari `server` block, make the SPA and asset locations use these cache policies (the full example is `deploy/nginx.sawaari.conf.example`):

```nginx
location / {
    try_files $uri $uri.html $uri/ /index.html;
    add_header Cache-Control "no-cache, must-revalidate" always;
}

location ~* \.(?:js|css|png|jpg|jpeg|gif|svg|ico|webp|woff2?)$ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=604800, immutable";
}
```

`no-cache` makes browsers check for the current HTML before reusing it; hashed assets remain cacheable without risking a different build under the same URL. Reload Nginx after updating its configuration. Verify compression and the response headers with:

```sh
asset=$(curl -fsS https://sawaari.online/ | grep -oE '/_expo/static/js/web/__common-[^"]+\.js' | head -n 1)
test -n "$asset"
curl -sSI -H 'Accept-Encoding: gzip' "https://sawaari.online$asset" | grep -iE 'content-encoding|vary'
curl -sSI https://sawaari.online/trips | grep -i cache-control
```

The JavaScript response should include `Content-Encoding: gzip`; the Trips HTML should include `Cache-Control: no-cache, must-revalidate`. A deployment rebuilds the app assets, but these Nginx settings must be applied separately. Reload the page after the change; you do not need to clear all browser data.

For Android/iOS builds, set `EXPO_PUBLIC_API_URL=https://sawaari.online/api` in the build environment and rebuild the app. Native sessions are kept in Expo SecureStore; web sessions use an HttpOnly Secure cookie.

## Features and current limitations

- Signup, password login, Hostinger email confirmation, and confirmation resend use the VPS API.
- Riders can create and cancel ride requests; approved drivers can share foreground location, discover nearby requests, accept a request, and mark it complete.
- The driver dashboard shows account and approved vehicle details, recent completed rides, and a driver-confirmed cash fare ledger. Cash is exchanged directly between rider and driver; the ledger does not process or transfer money. Bank, wallet, card, and electronic payout methods are not connected.
- Drivers can submit four private verification documents; the independent admin login reviews applications and serves private documents through expiring links.
- The database is fresh. Existing Supabase users and ride data are not migrated. Users must create new accounts and confirm them; old password hashes and documents remain only in the old Supabase project.
- Configure and periodically test encrypted database and private-document backups before storing real user data.
- Riders and drivers can open a private support chat from Profile or Driver mode. Signed-in support messages are stored on the VPS and handled through the authenticated admin panel's live support inbox. The WhatsApp action is available after `EXPO_PUBLIC_WHATSAPP_SUPPORT_NUMBER` is set to the official business number. The chat is not an emergency service and is not staffed automatically.
- Location updates run only while the driver app is open. The app does not yet include phone/SMS verification, electronic payments or payouts, counter-offers, turn-by-turn navigation, background location, SOS/emergency response, fraud monitoring, or government identity checks. Do not treat this MVP as ready for real passenger operations without the relevant safety, privacy, security, legal, and operational work.
- Public map/geocoding/routing services are best-effort. Select production providers and review their terms before commercial use.

## Driver verification and admin operations

The admin page is available at `https://sawaari.online/admin`. Its username and password are configured separately by the VPS setup script and do not share rider/driver credentials. The review queue displays pending applications, opens private documents through expiring URLs, and supports approval, change requests, or rejection. The dashboard keeps ride history out of the main overview; open an account from the registered-user directory or a live ride/driver card to view that rider's or driver's paginated ride history and recorded ride locations.

Driver applications collect a legal name, vehicle category/make/model/year, CNIC, driving licence, vehicle registration, and vehicle photo. The CNIC and licence sides should be combined in one PDF or image per document type. Documents are stored privately; the app does not verify identities against NADRA or government databases. Do not upload real identity documents without a lawful basis, informed consent, appropriate retention/deletion rules, and security procedures.

## Website map and location search

The website uses Mapbox GL JS for map rendering, Mapbox Directions for road routes, and Mapbox reverse geocoding for map pins. TomTom Search is the primary website autocomplete provider; queries are debounced and proxied through the server so its key stays private. When TomTom returns no acceptable match, the app requests Photon results from OpenStreetMap and labels street- or area-level results as approximate. Search selection uses the coordinates returned by the provider; it never invents coordinates or substitutes a city center. Map clicks and draggable pickup/destination pins continue to use reverse geocoding. The map includes street/satellite/outdoors styles, fullscreen, zoom controls, route alternatives, distance/time, nearby drivers, and the existing accepted-driver live location. The existing Socket.IO and ride data flows are not changed.

Search quality varies by provider and area; neither provider guarantees every building, business, or house number. The shared Photon endpoint is best-effort and has no production SLA. Its results are visibly attributed to OpenStreetMap and street/area matches are marked approximate; review provider quotas, licensing, data-retention terms, and service policies before commercial use. For production volumes or stronger availability requirements, use a contracted provider or operate an appropriately licensed search service.

1. Create an account and public access token at [Mapbox account tokens](https://account.mapbox.com/access-tokens/). Use a `pk.*` public token only. Never put an `sk.*` secret token into an Expo `EXPO_PUBLIC_*` variable or browser bundle.
2. Add the public scopes needed for the map and directions (`styles:read`, `fonts:read`, and `directions:read`). Keep secret scopes disabled. Restrict the token to your local development URL and production site URL (for example `http://localhost:8081/*` and `https://sawaari.online/*`) before deploying. Mapbox GL JS displays the map data attribution automatically.
3. For local development, set `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk...` in your ignored `.env`, then restart with `npm run web`. The `.env.example` file is only a template.
4. For GitHub deployment, add the same restricted token as the Actions repository secret `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`. The workflow injects it when building the website. For a manual build, set that environment variable before `npm run build:web`; rebuild/redeploy after changing the token.

Mapbox account signup offers a trial without a payment card, subject to current account eligibility and plan terms. The default trial token may not support custom URL restrictions; do not deploy an unrestricted trial token publicly. If the account does not allow creating a restricted token, use local testing only until a properly restricted token is available. Current included request/load quotas and billing rules change over time; check the [Mapbox pricing page](https://www.mapbox.com/pricing/) and account dashboard before use, set usage alerts, and monitor token usage.

**Data and commercial-use limits:** Geocoding v6 defaults to temporary results, which Mapbox says may not be cached; permanent results require a payment method or an enterprise contract. This app persists selected pickup/destination labels and coordinates in ride records, so do not launch with temporary Geocoding results until Mapbox confirms the permitted retention/use or the account is configured for an eligible permanent-data option. Mapbox's [pricing terms](https://www.mapbox.com/pricing/) state a Commercial Application License is required for production or non-production vehicle usage. Obtain Mapbox's written confirmation/license for this ride-hailing use before launch. These are provider terms, not limitations that can be solved by a code change.

The native app was not migrated as part of this web-provider replacement: it retains its current native map and Google-backed server endpoints. If enabling those native routes/search calls, configure the separate Android/iOS application-restricted keys and the VPS-only `GOOGLE_MAPS_SERVER_API_KEY` as documented in the server setup; never expose the VPS key to the browser.
