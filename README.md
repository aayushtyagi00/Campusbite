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

The student preview stores its sample checkout state in browser storage and starts the simulated campus day at noon IST. Use **Use sample student** at student checkout. Sample student accounts and orders are independent of the staff workspaces.

Home reviews are public to visitors of the same server. They are stored in `.data/reviews` outside the public asset folder. Set `CAMPUSBITE_REVIEW_DIR` to a persistent writable directory when hosting a single server instance. A multi-instance deployment needs shared review storage.

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
3. In Supabase Auth, enable the Email provider and email confirmation. Configure the Magic Link template to include the password setup code via `{{ .Token }}`. Set a short code expiry and configure [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp). Enable the [Before User Created hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook) using `public.campusbite_before_user_created` on this staff-only project.
4. As the database project owner, add the first administrator's exact email address in the Supabase SQL Editor. Replace the example address with the intended administrator's verified mailbox.

   ```sql
   insert into public.staff_admins (email)
   values (lower(trim('admin@example.com')));
   ```

5. Enable the [Google provider](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) in Supabase. Use the Supabase Auth callback URL shown in that provider’s settings as the authorized redirect URI in Google Cloud. Add the app callback `<CAMPUSBITE_STAFF_ORIGIN>/auth/staff/callback` to Supabase Auth’s allowed redirect URLs for each environment.
6. Open `/admin/sign-in`. Use **Continue with Google** with the approved account or choose **Set or reset your password**, enter the emailed code, then sign in with email and password. In **Access Management**, create a shop, select it, and grant the vendor’s email **Owner**, **Manager**, or **Staff**. The approved person has the same two sign-in options at `/vendor/sign-in`.

Owners and managers can view orders and sales for their assigned shops. Staff can view orders for their assigned shops. Both login methods require a verified email with an active grant for the requested portal. Access is evaluated on every protected request and by PostgreSQL row policies. Revoking access blocks future reads even when the person’s auth session still exists. Applications never grant access automatically. Grant changes are recorded in `vendor_access_audit`.

Before connecting live commerce, verify email delivery and role checks against your Supabase project using two different shops and two test accounts. Enable administrator MFA as part of the production auth rollout. Expired rows in the private `staff_rate_limits` table can be deleted by a scheduled database maintenance job.

## Pilot rules implemented in the preview

- One stall per bag, a maximum of eight items, and no configurable add-ons. Newly sold-out or archived items block checkout, and price changes require acknowledgment.
- Pickup windows are 10 minutes, within stall hours and the next 60 minutes. The preview estimates preparation using the longest item estimate plus two minutes per additional unit, with 90 seconds for acceptance and two minutes of buffer.
- A simulated payment creates a sample order for the current server-held preview session. Orders open within `/orders`, and the session cookie controls which rows can be read, cancelled, or used for support. A pending sample order can be cancelled or expire after 90 seconds, which requests a preview refund.

The preview order store uses `.data/student-orders` on one server, or `CAMPUSBITE_STUDENT_PREVIEW_DIR` if configured. Signing out revokes the session. Legacy browser-only orders cannot be restored into a new session because their ownership cannot be verified. This preview session is separate from production student authentication.
- All preview prices are illustrative. Provider, commission, taxes, later cancellation and no-show policies, refund charge allocation, and support coverage remain product decisions.

## Configure live commerce in staging

1. Copy `.env.example` to **`.env.local`** at the root of the project. Keep secrets in this file locally and in your deployment's server environment settings. Use Razorpay **Test Mode** credentials while testing. Set `CAMPUSBITE_MODE=live` and restart Next.js after setting the variables.

   | Variable | Where it comes from |
   | --- | --- |
   | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Staff and commerce Supabase project |
   | `STUDENT_SUPABASE_URL`, `STUDENT_SUPABASE_PUBLISHABLE_KEY` | Separate public student Supabase Auth project |
   | `CAMPUSBITE_STAFF_ORIGIN` | App origin, such as `http://127.0.0.1:3000` locally or your staging HTTPS origin |
   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay Dashboard → Test Mode → API Keys |
   | `RAZORPAY_WEBHOOK_SECRET` | A random secret you set in Razorpay when creating the webhook |
   | `COMMERCE_JOB_SECRET` | A different random secret, shared only with the scheduler |

2. In the staff/commerce Supabase project, apply `supabase/migrations/202611180001_staff_access.sql` if it has never been applied, then apply `supabase/migrations/202611180002_commerce.sql`. Load `supabase/seed.sql` for the staging menu. Review actual vendors, menu items, menu prices and opening hours before using live keys. Vendor owners and managers can update prices and mark items sold out in their dashboard. Add or edit catalog entries in `commerce_menu` as the database owner. Storefront names, hours and locations are defined in `src/lib/campus.ts`.
3. In the student Auth project, enable Email with confirmation, configure SMTP, and include `{{ .Token }}` in both **Confirm signup** and **Reset password** email templates. Enable Google using its OAuth client ID and secret in **Supabase Authentication → Providers → Google**. Add that Supabase project's callback URL in Google Cloud. Allow the app's `/auth/student/callback` URL in Supabase, including the checkout and account `next` variants if your redirect configuration matches query strings. Use a separate OAuth client or authorize both Supabase callback URLs if sharing a Google OAuth client. Keep the existing invite-only hook in the staff project. [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)
4. In Razorpay Test Mode, enable automatic capture and configure `https://YOUR-STAGING-HOST/api/payments/razorpay` for `payment.captured` and `refund.processed`. Match the webhook secret to the app setting. A local checkout callback verifies completed payments directly, and the webhook covers delayed payments and browser interruptions. Verify the webhook using the staging HTTPS URL. [Razorpay Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps) · [Webhook validation](https://razorpay.com/docs/webhooks/validate-test)
5. Configure a scheduler to **POST** `/api/jobs/commerce` every minute with `Authorization: Bearer <COMMERCE_JOB_SECRET>`. It expires held and unaccepted orders and processes the refund queue. Alert on failed job runs and check Razorpay and the admin order list when a refund keeps retrying.
6. In **Admin → Access Management**, create a vendor shop and authorize its staff. In **Admin → Commerce operations**, link a staging storefront to that shop, set its capacity, and enable checkout. Test during the storefront’s listed hours in IST. Use two student accounts to verify order isolation, and test payment, rejection/refund, acceptance, preparation, pickup code, and completed sale. The app keeps order details at `/orders`.

### Peak-time testing

The database takes a transaction lock per shop and pickup window to enforce capacity during a rush. Duplicate requests reuse the same reservation, abandoned holds expire, and a capture arriving after the hold deadline goes to the refund queue. Public catalog reads are cached and authenticated order reads use indexes. The active vendor board refreshes only while visible.

Run the reservation burst below against a **dedicated staging Supabase project** and an enabled test storefront. It reserves synthetic orders in a free pickup window, prints acceptance and overflow counts with the p95 reservation latency, and fails if the database accepts more than the configured capacity. It creates no gateway payments. Test holds expire automatically.

```powershell
$env:LOAD_TEST_STAGING = '1'
$env:LOAD_TEST_STALL = 'rolling-kitchen'
$env:LOAD_TEST_CONCURRENCY = '50'
node --env-file=.env.local tests/checkout-load.mjs
```

Test expected normal traffic and meal-time bursts against the chosen deployment before switching to live payments. The staging script exercises database contention. It does not measure browser checkout, auth provider limits, gateway throughput, or production infrastructure. Push notifications, automated vendor payouts, shared public review storage, and tax/commission configuration are outside the current checkout flow.

## Stitch source

`design/` holds 10 HTML/PNG export pairs. The manifest records the exact screen IDs. Earlier Stitch iterations include eight requested originals and the earlier polished vendor board, for which there are no local exports.

Photo assets in `public/food/` come from the existing Stitch HTML exports. Additional sample menu items use a placeholder when there is no matching photo.
