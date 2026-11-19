# CampusBite

Mobile-first scheduled food pickup for LPU. CampusBite has a local preview and a provider-backed commerce mode.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

| Interface | Local route | Workflows |
| --- | --- | --- |
| Public ordering website | `/` | Browse stalls, register or sign in, choose a pickup window, pay, and track orders and refunds |
| Vendor portal | `/vendor` | Apply as a vendor or sign in with an authorized email |
| Vendor workspace | `/vendor/dashboard` | Open assigned shops and see recent orders and, for owners and managers, sales |
| Admin workspace | `/admin` | Review applications, manage shop access, enable storefronts, set pickup capacity, and review orders and support |

Google and email/password are available on all three sign-in pages once the providers are configured. Anyone can create a public ordering account at `/sign-in`. At `/vendor/sign-in` and `/admin/sign-in`, an approved email can create its account on first Google sign-in or use **Set or reset your password** for first-time email/password setup. Vendor approvals include a shop and role.

Student accounts, recovery, and order history always use Supabase. Preview mode only supplies a local browsing catalog and disables checkout.

Home reviews are public to visitors of the same server. They are stored in `.data/reviews` outside the public asset folder. Set `CAMPUSBITE_REVIEW_DIR` to a persistent writable directory when hosting a single server instance. A multi-instance deployment needs shared review storage.

## Production sign-in on Vercel

Set `CAMPUSBITE_MODE=live` and `CAMPUSBITE_STAFF_ORIGIN=https://campusbite-lpu.vercel.app` in the Production environment, then redeploy. Leave the student origin and student project overrides empty for this shared deployment. In Supabase Authentication → URL Configuration, set Site URL to `https://campusbite-lpu.vercel.app` and add these exact Redirect URLs:

- `https://campusbite-lpu.vercel.app/auth/student/callback`
- `https://campusbite-lpu.vercel.app/auth/staff/callback`
- `https://campusbite-lpu.vercel.app/recovery`

Use numeric code email templates for password recovery and staff password setup. Google Cloud's authorized redirect URI is the Supabase provider callback displayed in the Google provider settings.

## Verify

```sh
npm run typecheck
npm run test:policies
npm run build
npx playwright install chromium
npm run test:e2e
```

Set `CAMPUSBITE_TEST_BROWSER` to an existing Chromium executable to use it for the browser tests.

## Configure vendor and administrator access

1. Apply `supabase/migrations/202611180001_staff_access.sql` to a Supabase project for staff access.
2. Copy `.env.example` to `.env.local` and set the project URL, publishable key, and server-only secret key. Set `CAMPUSBITE_STAFF_ORIGIN` to the local URL for local development or the HTTPS URL for deployment. Keep the secret key out of browser code, source control, and public environment variables.
3. In Supabase Auth, enable the Email provider and email confirmation. Configure the Magic Link template to include the password setup code via `{{ .Token }}`. Set a short code expiry and configure [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp). For the shared project, allow new users to sign up and leave the staff-only Before User Created hook disabled. If previously enabled, disable that hook in Authentication → Hooks so students can register. Staff routes and database policies independently check active staff grants.
4. As the database project owner, add the first administrator's exact email address in the Supabase SQL Editor. Replace the example address with the intended administrator's verified mailbox.

   ```sql
   insert into public.staff_admins (email)
   values (lower(trim('admin@example.com')));
   ```

5. Enable the [Google provider](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) in Supabase. Use the Supabase Auth callback URL shown in that provider’s settings as the authorized redirect URI in Google Cloud. Add the app callback `<CAMPUSBITE_STAFF_ORIGIN>/auth/staff/callback` to Supabase Auth’s allowed redirect URLs for each environment.
6. Open `/admin/sign-in`. Use **Continue with Google** with the approved account or choose **Set or reset your password**, enter the emailed code, then sign in with email and password. In **Access Management**, create a shop, select it, and grant the vendor’s email **Owner**, **Manager**, or **Staff**. The approved person has the same two sign-in options at `/vendor/sign-in`.

Apply `supabase/migrations/202611190001_shop_owner_team.sql` once after the staff access migration to enable owner team management. From the vendor dashboard, an Owner can add, change, and revoke Staff and Manager memberships in their selected shop. The main administrator assigns Owner roles from Access Management. Creating a shop opens its grant form automatically. For an existing shop, click **Select shop** before granting access.

Owners and managers can view orders and sales for their assigned shops. Staff can view orders for their assigned shops. Both login methods require a verified email with an active grant for the requested portal. Access is evaluated on every protected request and by PostgreSQL row policies. Revoking access blocks future reads even when the person’s auth session still exists. Applications never grant access automatically. Grant changes are recorded in `vendor_access_audit`.

Before connecting live commerce, verify email delivery and role checks against your Supabase project using two different shops and two test accounts. Enable administrator MFA as part of the production auth rollout. Expired rows in the private `staff_rate_limits` table can be deleted by a scheduled database maintenance job.

## Configure live commerce in staging

1. Copy `.env.example` to **`.env.local`** at the root of the project. Keep secrets in this file locally and in your deployment's server environment settings. Use Razorpay **Test Mode** credentials while testing. Set `CAMPUSBITE_MODE=live` and restart Next.js after setting the variables.

   | Variable | Where it comes from |
   | --- | --- |
   | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Staff and commerce Supabase project |
   | `STUDENT_SUPABASE_URL`, `STUDENT_SUPABASE_PUBLISHABLE_KEY` | Optional pair for an existing separate student project. Leave both empty for shared Auth |
   | `CAMPUSBITE_STAFF_ORIGIN` | App origin, such as `http://127.0.0.1:3000` locally or your staging HTTPS origin |
   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay Dashboard → Test Mode → API Keys |
   | `RAZORPAY_WEBHOOK_SECRET` | A random secret you set in Razorpay when creating the webhook |
   | `COMMERCE_JOB_SECRET` | A different random secret, shared only with the scheduler |

2. In the staff/commerce Supabase project, apply `supabase/migrations/202611180001_staff_access.sql` if it has never been applied, then apply `supabase/migrations/202611180002_commerce.sql`. Load `supabase/seed.sql` for the staging menu. Review actual vendors, menu items, menu prices and opening hours before using live keys. Vendor owners and managers can update prices and mark items sold out in their dashboard. Add or edit catalog entries in `commerce_menu` as the database owner. Storefront names, hours and locations are defined in `src/lib/campus.ts`.
3. In the Supabase project used for student Auth, enable Email with confirmation, configure SMTP, and include `{{ .Token }}` in both **Confirm signup** and **Reset password** email templates. Enable Google using its OAuth client ID and secret in **Supabase Authentication → Providers → Google**. Add that Supabase project's callback URL in Google Cloud. In each project, set Authentication → URL Configuration → Site URL to its public HTTPS app origin. In the student project, allow the exact URL `<student-origin>/auth/student/callback`. Set `CAMPUSBITE_STUDENT_ORIGIN` if students use a different hostname from staff. Open the app on the configured hostname so the browser can return its sign-in cookie. Use a separate OAuth client or authorize both Supabase callback URLs if sharing a Google OAuth client. Enable the invite-only hook only on a dedicated staff Auth project. The shared project needs public registration with email confirmation. [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)
4. In Razorpay Test Mode, enable automatic capture and configure `https://YOUR-STAGING-HOST/api/payments/razorpay` for `payment.captured` and `refund.processed`. Match the webhook secret to the app setting. A local checkout callback verifies completed payments directly, and the webhook covers delayed payments and browser interruptions. Verify the webhook using the staging HTTPS URL. [Razorpay Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps) · [Webhook validation](https://razorpay.com/docs/webhooks/validate-test)
5. Configure a scheduler to **POST** `/api/jobs/commerce` every minute with `Authorization: Bearer <COMMERCE_JOB_SECRET>`. It expires held and unaccepted orders and processes the refund queue. Alert on failed job runs and check Razorpay and the admin order list when a refund keeps retrying.
6. In **Admin → Access Management**, create a vendor shop and authorize its staff. In **Admin → Commerce operations**, link a staging storefront to that shop, set its capacity, and enable checkout. Test during the storefront’s listed hours in IST. Use two student accounts to verify order isolation, and test payment, rejection/refund, acceptance, preparation, pickup code, and completed sale. The app keeps order details at `/orders`.

### Peak-time testing

The database takes a transaction lock per shop and pickup window to enforce capacity during a rush. Duplicate requests reuse the same reservation, abandoned holds expire, and a capture arriving after the hold deadline goes to the refund queue. Public catalog reads are cached and authenticated order reads use indexes. The active vendor board refreshes only while visible.

Run the reservation burst below against a **dedicated staging Supabase project** and an enabled test storefront. It reserves synthetic orders in a free pickup window, reports stored orders, successful reservations, full-window responses, unexpected error rate, throughput and median/p95 reservation latency, and fails if the database accepts more than the configured capacity. It creates no gateway payments. Test holds expire automatically.

```powershell
# Store STAGING_SUPABASE_URL and STAGING_SUPABASE_SECRET_KEY in an ignored .env.staging.local file.
$env:LOAD_TEST_STAGING = '1'
$env:LOAD_TEST_STALL = 'rolling-kitchen'
$env:LOAD_TEST_CONCURRENCY = '50'
node --env-file=.env.staging.local tests/checkout-load.mjs
```

Test expected normal traffic and meal-time bursts against the chosen deployment before switching to live payments. The staging script exercises database contention. It does not measure browser checkout, auth provider limits, gateway throughput, or production infrastructure. Push notifications, automated vendor payouts, shared public review storage, and tax/commission configuration are outside the current checkout flow.

## Stitch source

`design/` holds 10 HTML/PNG export pairs. The manifest records the exact screen IDs. Earlier Stitch iterations include eight requested originals and the earlier polished vendor board, for which there are no local exports.

Photo assets in `public/food/` come from the existing Stitch HTML exports. Additional sample menu items use a placeholder when there is no matching photo.
