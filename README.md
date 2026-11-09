# Sawaari

Sawaari is an Expo / React Native ride-booking app foundation for Pakistan. The mobile app, website, and admin panel use a Node.js API on the VPS and PostgreSQL. Supabase is not used by the running application. The PostgreSQL database starts empty; the existing Supabase project and its data are left untouched as a backup and are not imported.

The old `supabase/migrations/` SQL files are retained only as legacy reference. Do not apply them for this VPS backend; `server/schema.sql` is the current PostgreSQL schema.

## Local development

1. Install Node.js 22 and run `npm ci`.
2. Copy `.env.example` to `.env`. Set `EXPO_PUBLIC_API_URL` to the API's public `/api` URL for native app builds, and add optional Google Maps keys if configured.
3. Run `npm run web` for the local web preview or `npx expo start` for Expo Go.

Web builds use the same-origin `/api` route. Native builds call `EXPO_PUBLIC_API_URL` (defaults to `https://sawaari.online/api`). A running VPS API and PostgreSQL database are required for user accounts, email verification, driver documents, and shared rides. The preview does not create fake accounts or drivers.

The map uses Photon, OpenStreetMap, and OSRM public demo services unless Google Maps is configured. Address search can only return house numbers present in OpenStreetMap data. Riders can choose an exact pickup or destination by moving the map pin and can enter a street address or house number manually; ride coordinates are saved even when reverse geocoding has no street address. Public OSM-backed services have usage limits and no production SLA; choose suitable commercial services before a production launch. Starter fare values are examples, not current market rates or live quotes.

On the Ride page, Sawaari centers the map on the rider when location permission has already been granted. Otherwise, an in-page prompt lets the rider request location access; browser/device permission is still required. Ride and driver alerts and confirmations are displayed inside Sawaari rather than browser alert dialogs. Browser push notifications are not configured.

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
| `EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY` | Optional restricted Maps key |

Do not add database, SMTP, admin, or PostgreSQL credentials to GitHub Actions. They belong only in `/etc/sawaari/api.env` on the VPS. After deployment, test `/`, `/drive`, `/trips`, `/profile`, `/auth/confirm`, `/admin`, and `/api/health`.

### Faster first load on mobile

Enable gzip in the active Nginx `http` configuration so large JavaScript and CSS assets are compressed over the network. On Ubuntu VPS installations where `/etc/nginx/nginx.conf` includes `/etc/nginx/conf.d/*.conf`, install this once:

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

If Nginx reports that gzip directives are not allowed in this file, remove the snippet and put the same directives inside the `http { ... }` block in `/etc/nginx/nginx.conf`. Verify compression with:

```sh
asset=$(curl -fsS https://sawaari.online/ | grep -oE '/_expo/static/js/web/__common-[^"]+\.js' | head -n 1)
test -n "$asset"
curl -sSI -H 'Accept-Encoding: gzip' "https://sawaari.online$asset" | grep -iE 'content-encoding|vary'
```

The response should include `Content-Encoding: gzip`. A deployment rebuilds the app assets, but gzip is a separate one-time Nginx setting.

For Android/iOS builds, set `EXPO_PUBLIC_API_URL=https://sawaari.online/api` in the build environment and rebuild the app. Native sessions are kept in Expo SecureStore; web sessions use an HttpOnly Secure cookie.

## Features and current limitations

- Signup, password login, Hostinger email confirmation, and confirmation resend use the VPS API.
- Riders can create and cancel ride requests; approved drivers can share foreground location, discover nearby requests, accept a request, and mark it complete.
- The driver dashboard shows account and approved vehicle details, recent completed rides, and a driver-confirmed cash fare ledger. Cash is exchanged directly between rider and driver; the ledger does not process or transfer money. Bank, wallet, card, and electronic payout methods are not connected.
- Drivers can submit four private verification documents; the independent admin login reviews applications and serves private documents through expiring links.
- The database is fresh. Existing Supabase users and ride data are not migrated. Users must create new accounts and confirm them; old password hashes and documents remain only in the old Supabase project.
- Configure and periodically test encrypted database and private-document backups before storing real user data.
- Location updates run only while the driver app is open. The app does not yet include phone/SMS verification, electronic payments or payouts, counter-offers, turn-by-turn navigation, background location, SOS/support, fraud monitoring, or government identity checks. Do not treat this MVP as ready for real passenger operations without the relevant safety, privacy, security, legal, and operational work.
- Public map/geocoding/routing services are best-effort. Select production providers and review their terms before commercial use.

## Driver verification and admin operations

The admin page is available at `https://sawaari.online/admin`. Its username and password are configured separately by the VPS setup script and do not share rider/driver credentials. The review queue displays pending applications, opens private documents through expiring URLs, and supports approval, change requests, or rejection.

Driver applications collect a legal name, vehicle category/make/model/year, CNIC, driving licence, vehicle registration, and vehicle photo. The CNIC and licence sides should be combined in one PDF or image per document type. Documents are stored privately; the app does not verify identities against NADRA or government databases. Do not upload real identity documents without a lawful basis, informed consent, appropriate retention/deletion rules, and security procedures.

## Google Maps

Google Maps is optional. Configure the restricted web key in `.env` for Maps JavaScript, Places API (New), and Routes API. For native builds configure Android/iOS Maps SDKs, restrict the mobile key to package and bundle identifier `com.sawaari.pakistan`, and set `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`. The key is public in a client app; restrict it by platform and API.
