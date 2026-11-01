# Sawaari

Sawaari is an Expo / React Native ride-booking app foundation for Pakistan. The current build is a rider-side mobile MVP, not a live ride-hailing service.

## Run the local web preview

1. In this folder, run `npm install`.
2. Run `npm run web`.
3. Open the localhost URL printed by Expo (usually `http://localhost:8081`).

The web preview works without an API key: it shows OpenStreetMap road tiles, searches Photon place data, and requests a driving route and distance from the public OSRM demo service. Search Pakistan by default or switch to Worldwide. Both selected places appear on the map; after both are selected, the road route is drawn and its distance is used for an editable fare suggestion. Browser geolocation requires permission. These public community/demo services are suitable for trying the local preview, but are best-effort, have usage limits/no production SLA, and should not be used for a commercial ride service at scale. OpenStreetMap requires visible attribution and its public tile server has a usage policy; choose a suitable commercial map provider before a production launch.

To use Google Maps instead, configure the optional restricted web key as described below. Once configured, Google Maps provides the web map, Places autocomplete, and driving route. The app does not require Google keys to make the local web preview usable.

Starter fare assumptions are Bike PKR 50 + 30/km, Rickshaw PKR 80 + 45/km, Car PKR 120 + 55/km, and Premium PKR 200 + 80/km, rounded up to the next PKR 10. These are configurable examples, not current market rates or a live operator quote. Native place search still uses the Photon geocoder; native fares are explicitly labeled direct-distance estimates. Without Supabase configuration, ride requests are saved locally and are not broadcast. With Supabase configured, signed-in riders can send a request and search for online drivers; the app still does not provide live turn-by-turn navigation.

## Prepare a web build for a VPS

This project includes a GitHub Actions workflow at `.github/workflows/deploy-vps.yml`. After the one-time setup below, every push to the repository's `master` or `main` branch builds the web app, runs typecheck and lint, and securely uploads `dist` to the VPS. You can also start a deployment from GitHub **Actions → Build and deploy Sawaari website → Run workflow**. This deploys only the static website; it does not change the mobile apps or replace Supabase.

### One-time VPS and domain setup

1. Purchase `sawaari.online`, then add DNS A records for `@` and `www` pointing to the VPS public IPv4 address. DNS must resolve to the VPS before requesting an HTTPS certificate.
2. Connect to Ubuntu 22.04 over SSH as a sudo-capable account. Install Nginx and rsync:

   ```sh
   sudo apt update
   sudo apt install -y nginx rsync
   ```

3. Create a dedicated deploy account (replace `sawaari-deploy` only if you choose a different username), allow Nginx to read its files, and prepare the upload directory:

   ```sh
   sudo adduser --disabled-password --gecos "" sawaari-deploy
   sudo usermod -aG www-data sawaari-deploy
   sudo mkdir -p /var/www/sawaari/dist
   sudo chown -R sawaari-deploy:www-data /var/www/sawaari
   sudo find /var/www/sawaari -type d -exec chmod 755 {} \;
   ```

   On your computer, generate a dedicated key pair with `ssh-keygen -t ed25519 -C "github-actions-sawaari"`. Add the **public** key (the `.pub` file) as a single line in `/home/sawaari-deploy/.ssh/authorized_keys` and confirm you can log in with it before configuring GitHub. Put only the matching **private** key in the GitHub secret; never commit either key. Restrict SSH access in your VPS firewall to trusted IPs when practical.
4. Copy `deploy/nginx.sawaari.conf.example` to `/etc/nginx/sites-available/sawaari`, keeping the configured `sawaari.online` domain and `/var/www/sawaari/dist` root. Enable it and check Nginx:

   ```sh
   sudo ln -s /etc/nginx/sites-available/sawaari /etc/nginx/sites-enabled/sawaari
   sudo nginx -t
   sudo systemctl reload nginx
   ```

5. After DNS points to the VPS, install the HTTPS certificate:

   ```sh
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d sawaari.online -d www.sawaari.online
   ```

   Allow inbound web traffic (ports 80 and 443) in the VPS firewall/provider panel. Verify `https://sawaari.online` loads over HTTPS.

### Add GitHub Actions secrets

In the GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret**. Add the following. Do not put these in source files or commit `.env`.

| Secret name | Value |
|---|---|
| `VPS_HOST` | VPS public IPv4 address (or SSH hostname) |
| `VPS_USER` | `sawaari-deploy` |
| `VPS_SSH_PRIVATE_KEY` | Full private SSH key matching the public key installed for the deploy account |
| `VPS_KNOWN_HOSTS` | Verified SSH host-key line for the VPS |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable/anon client key only |
| `EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY` | Optional restricted Google Maps web key; omit or leave unset to use the current OpenStreetMap web map |
| `VPS_PORT` | Optional SSH port; leave unset for port `22` |

To obtain `VPS_KNOWN_HOSTS`, run `ssh-keyscan -t ed25519 -H <your-vps-ip> > sawaari-vps-known-hosts` on your computer, check its fingerprint with `ssh-keygen -lf sawaari-vps-known-hosts`, compare it with the fingerprint shown by your VPS provider, then paste the file contents as the secret. Use the same host/IP in `VPS_HOST` and host-key lookup. Do not trust an unverified SSH host key. Never add a Supabase `service_role` secret to GitHub for this client-side website.

### Deploy from GitHub

1. Upload/push this repository to GitHub, including `.github/workflows/deploy-vps.yml`. The workflow deploys pushes to either `master` or `main`; if you use another branch name, add it under `on.push.branches` in the workflow.
2. Confirm all required GitHub secrets above are set. Push a commit to `master` or `main`; GitHub **Actions** will show the build, typecheck, lint, and VPS upload. A missing secret or failed check stops deployment instead of publishing a broken build.
3. After the workflow succeeds, open `https://sawaari.online` and test the home page and direct refreshes on `/drive`, `/trips`, and `/profile`.
4. In Supabase **Authentication → URL Configuration**, set the production **Site URL** to `https://sawaari.online` and add `https://sawaari.online/**` to **Redirect URLs**. Add `https://www.sawaari.online/**` too if users will use the `www` address. Confirm the required SQL migrations are applied before testing sign-up, document submission, or driver matching.
5. Test sign-in, map, and storage with test accounts and sample documents. Do not use real identity documents or real passenger trips until privacy, legal, safety, and operational procedures are ready.

The Supabase publishable key and any `EXPO_PUBLIC_*` values are included in browser code and are not secrets. Supabase row-level security and storage policies must protect data. The current public Photon, OSRM, and OpenStreetMap services have no production SLA; deploying the website does not make them suitable for commercial scale or turn this MVP into a production-ready ride service.

## Driver document review and ride matching

The app includes a Driver tab, account sign-in, private driver-document uploads, reviewer approval, online driver location updates, nearby request discovery, atomic ride acceptance, and rider-side nearby-driver status.

1. Create a Supabase project and use its Project URL and publishable/anon client key (never the `service_role` secret). Put these in the ignored local `.env` file.
2. In the Supabase SQL Editor, run `supabase/migrations/20261101000000_rider_driver_matching.sql` if it has not already been run.
3. Then run `supabase/migrations/20261102000000_driver_document_review.sql`. It creates a private Storage bucket, application and reviewer tables, row-level security policies, review RPCs, and server-side enforcement that only approved drivers can go online or accept a ride.
4. Enable email/password sign-up in Supabase Auth. If email confirmation is on, confirm the account from the email before signing in.
5. To give yourself reviewer access, first create and confirm your Sawaari account. In Supabase **SQL Editor**, run the following after replacing the example email with the exact email for that account:

   ```sql
   insert into public.driver_reviewers (user_id)
   select id from auth.users where email = 'your-reviewer-email@example.com'
   on conflict (user_id) do nothing;
   ```

   The command must insert one row. Do not make every driver a reviewer. Sign out and back in to the app if you had it open; your Drive tab will show **Review driver applications**.
6. A driver signs in, opens **Drive**, and submits their legal name, vehicle category/make/model/year, CNIC (front and back), driving licence (front and back), vehicle registration, and a vehicle photo. The CNIC and licence sides should be combined into one PDF or a clear image for each document type. Each PDF/JPG/PNG must be at most 10 MB.
7. The driver sees **Application under review** while an authorized reviewer views the private files from the app's review queue and approves, requests changes, or rejects with feedback. The driver can resubmit after feedback. Only an approved application for the submitted vehicle category can go online.
8. For matching, the approved driver chooses their verified vehicle category, allows location, and taps **Go online**. A signed-in rider on another device can send a request. Rider Trips and the driver's request list check for updates about every 10 seconds. Location sharing works only while the driver app is open.

For local web email confirmation, open **Authentication → URL Configuration** in Supabase and add `http://localhost:8081/**` to **Redirect URLs**. The app directs new web confirmation emails back to the web origin currently open. If an older confirmation email redirects to an unavailable localhost page, return to the running app at `http://localhost:8081` and try signing in; the account may already be confirmed.

The verification screen only collects and stores files for manual review; it does not verify identities against NADRA or government databases. Never use public buckets or put document links in chat. Set an appropriate retention/deletion policy for personal documents, restrict reviewer accounts, and do not upload real identity documents until you have the proper legal basis, consent, and privacy/security processes in place. Do not use this MVP for real passenger trips.

Without the Supabase settings, rider place search and local ride drafts still work, but the app does not fabricate drivers or claim a local draft was broadcast. This is not a complete or production-ready inDrive replacement: phone/SMS verification, automated identity checks, counter-offers, payments, navigation, background location, SOS/support, fraud monitoring, and legal/compliance processes still need implementation and operational setup.

## Run on an Android phone for daily development

1. Install **Expo Go** from the Play Store on your Android phone.
2. Connect the phone and computer to the same Wi-Fi network. In the project folder run `npx expo start`.
3. Scan the QR code shown in the terminal with Expo Go. Keep the computer and Expo server running while testing.
4. Sign in on the phone. For driver testing, allow location permission and keep Expo Go open. Use another device/account as the rider.

This is a development preview, not an installed store app. If QR scanning cannot connect, run `npx expo start --tunnel` and scan the new QR code. For a distributable install or app-specific native Maps configuration, create an EAS development/preview build; Google Maps is optional and is not required for the OpenStreetMap web preview.

## Google Maps for store builds

The map uses `react-native-maps`. To build an installable app with Google Maps:

1. Google Maps is optional for the local web preview. To configure it, create a Google Cloud project, enable billing, and enable the APIs for the platform you are configuring.
2. For the browser, enable **Maps JavaScript API**, **Places API (New)**, and **Routes API**. Create a key restricted by website referrer to your local development URL and production domains, and restrict its API access to those services.
3. For Android/iOS, enable **Maps SDK for Android** and **Maps SDK for iOS**. Create a mobile key restricted to Android package `com.sawaari.pakistan` and iOS bundle identifier `com.sawaari.pakistan`; restrict API access to the matching SDKs.
4. Copy `.env.example` to `.env`. Set `EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY` to the browser key and `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` to the mobile key. Restart Expo after changing `.env`.
5. Create a development or release build so native Maps configuration is included. An OTA update cannot add native map configuration to an existing binary.

Both keys are visible to their respective clients and are not server secrets. Keep them protected with website/app and API restrictions; never use unrestricted keys. Do not send API keys in chat or commit `.env`. Google Maps requires an account, billing, and enabled APIs. I cannot create a key in someone else's Google Cloud account.

## Current limitations

This is not ready to accept real passengers or drivers. Shared authenticated matching and manual document review are available only after the Supabase project is configured and both SQL migrations are applied. The manual review feature is not official identity verification and does not provide phone verification, counter-offers, live trip tracking/navigation, payment processing, safety/SOS service, support operation, fraud controls, or a full admin audit/compliance system. Local-only saved requests are drafts and are **not** sent to drivers. Do not use this MVP to arrange real rides.

Before a public launch, the backend, authentication and SMS provider, map/search and routing services, payment providers, operational support, data retention and privacy policy, driver verification, safety processes, and Pakistan city-specific compliance must be implemented and configured. Provider accounts and API keys require accepting their terms, configuring billing, and setting up security restrictions in accounts you control. No API credentials, SMS account, payment account, production backend, or deployment credentials were supplied, so none are fabricated or embedded here.

## Development checks

```powershell
npx tsc --noEmit
npx expo config --type public
npx expo-doctor
```
