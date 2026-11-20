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
| Vendor workspace | `/vendor/board` | Fulfill orders and verify pickup. Owners and managers can also edit the menu and availability, review onboarding, and view earnings. |
| Admin workspace | `/admin` | Review applications, manage shop access, enable storefronts, set pickup capacity, and review orders and support |

Google and email/password are available on all three sign-in pages once the providers are configured. Anyone can create a public ordering account at `/sign-in`. At `/vendor/sign-in` and `/admin/sign-in`, an approved email can create its account on first Google sign-in or use **Set or reset your password** for first-time email/password setup. Vendor approvals include a shop and role.

Student accounts, recovery, and order history always use Supabase. Preview mode only supplies a local browsing catalog and disables checkout.

Home reviews are public to visitors of the same server. They are stored in `.data/reviews` outside the public asset folder. Set `CAMPUSBITE_REVIEW_DIR` to a persistent writable directory when hosting a single server instance. A multi-instance deployment needs shared review storage.

## Production sign-in on Vercel

Set `CAMPUSBITE_MODE=live` and `CAMPUSBITE_STAFF_ORIGIN=https://campusbite-lpu.vercel.app` in the Production environment, then redeploy. Leave the student origin and student project overrides empty for this shared deployment. In Supabase Authentication → URL Configuration, set Site URL to `https://campusbite-lpu.vercel.app` and add these exact Redirect URLs:

- `https://campusbite-lpu.vercel.app/auth/student/callback`
- `https://campusbite-lpu.vercel.app/auth/staff/callback`
- `https://campusbite-lpu.vercel.app/recovery`

Use numeric code email templates for password recovery and staff password setup. Vendor applicants use the student Auth project to verify a contact email. Include `{{ .Token }}` in both its Confirm signup and Magic Link templates. Google Cloud's authorized redirect URI is the Supabase provider callback displayed in the Google provider settings.

## Verify

### Roll out vendor onboarding to an existing deployment

1. Open the Supabase project matching the production app's `SUPABASE_URL`. Confirm a recent database backup and run this read-only check in SQL Editor.

   ```sql
   select
     to_regclass('public.vendor_applications') is not null as staff_schema,
     to_regclass('public.commerce_stalls') is not null as commerce_schema,
     exists (select 1 from pg_policies where schemaname = 'public'
       and tablename = 'vendor_access' and policyname = 'access_owner_read') as owner_team,
     to_regprocedure('public.save_vendor_storefront(uuid,integer,jsonb)') is not null as onboarding;
   ```

2. With the first three flags true and `onboarding` false, the only pending file for this feature is [the vendor onboarding migration](supabase/migrations/202611190002_vendor_onboarding.sql). If this project has been maintained through SQL Editor, run the entire file once in a new query. If the project uses CLI-managed migration history, use the linked project's normal migration workflow and check that `supabase db push --dry-run` lists just that file before running `supabase db push`. A missing prerequisite calls for checking which earlier migration was applied before continuing. Skip the onboarding SQL if the flag is already true and the earlier migration completed successfully. [Supabase migration guide](https://supabase.com/docs/guides/deployment/database-migrations)
3. Verify all four flags are true. In Storage, confirm the `vendor-onboarding` bucket is private. In the student Auth project, include `{{ .Token }}` in the Confirm signup and Magic Link email templates so both first-time and returning applicants receive a code. [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
4. Deploy the matching app commit immediately after the migration. The migration changes permissions used by the old vendor admin forms. With Vercel's Git integration, merge the feature branch into the project's configured production branch. Check that the production deployment is Ready and that `CAMPUSBITE_MODE=live`. Open `/admin/vendors` with the admin account and use `/vendor` to verify email delivery and that an applicant can save and reopen a draft. [Vercel Git deployments](https://vercel.com/docs/git)

### Roll out the vendor workspace

1. Run the read-only schema check above. On an existing project, apply any missing prerequisites in filename order. If only the owner-team and onboarding flags are false, apply [owner team access](supabase/migrations/202611190001_shop_owner_team.sql), then [vendor onboarding](supabase/migrations/202611190002_vendor_onboarding.sql).
2. Once all four flags are true, check `select to_regprocedure('public.vendor_order_feed(uuid,uuid)');`. A null result means the workspace function is missing. Apply [the vendor workspace migration](supabase/migrations/202611200001_vendor_workspace.sql) once using the project's existing migration workflow, then deploy the matching app. The migration adds shop availability and menu revisions, the public menu-photo bucket, and the order feed. Repeating the query should return the function signature.
3. Sign in at `/vendor/sign-in` with an assigned shop account. On **Order board**, enable order alerts and use **Test sound** on the stall device. **Live updates** appears after the subscription connects. **Connected · polling** means the board is fetching the current queue every ten seconds while visible. Check the `supabase_realtime` publication includes `public.vendor_orders` if the board stays in polling mode.
4. In staging, place a paid test order and check the deadline, preparation estimate, rejection reason, refund request, and student order details. Use a second test order to check acceptance through collection. Confirm staff can fulfill orders and only owners and managers can open the management pages.

### Roll out shop categories and weekly schedules

After the vendor workspace migration, apply [menu categories and weekly pickup](supabase/migrations/202611200002_menu_categories_weekly_pickup.sql) before deploying the matching app. Existing shops start with their four menu categories, regular hours and ten-minute windows. Existing orders keep their original pickup duration.

Owners and managers can create or rename a category under **Menu editor → Manage categories**. Under **Availability**, each weekday can use regular hours, custom hours or a recurring closure. Date-specific closures take precedence. Window length is measured in whole minutes from 1 to 60. Windows start at the day's opening time in IST and must finish by closing.

### Roll out pickup availability and inventory

Apply [pickup availability and inventory](supabase/migrations/202611200003_pickup_availability_inventory.sql) after the weekly schedules migration, then deploy the app. Existing menu items default to unlimited stock. In **Vendor → Menu editor**, enter the number of unsold units on hand to enable tracking. That total includes units held by unpaid checkouts.

Checkout refreshes availability every ten seconds while visible. A reservation holds overlapping window capacity and tracked units until its payment deadline. Capture deducts tracked units once. Cancellation, rejection or an expired acceptance deadline releases the paid allocation. For a payment arriving after its hold expires, the database checks the original pickup window, current inventory and preparation time. If it cannot fulfill that window, it requests a full refund through the existing refund worker.

### Local checks

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

Apply `supabase/migrations/202611190001_shop_owner_team.sql` once after the staff access migration to enable owner team management. From the workspace Onboarding page, an Owner can add, change, and revoke Staff and Manager memberships in their selected shop. The main administrator assigns Owner roles from Access Management. Creating a shop opens its grant form automatically. For an existing shop, click **Select shop** before granting access.

Owners and managers can view orders and sales for their assigned shops. Staff can view orders for their assigned shops. Both login methods require a verified email with an active grant for the requested portal. Access is evaluated on every protected request and by PostgreSQL row policies. Revoking access blocks future reads even when the person’s auth session still exists. Submitting an application creates no shop access. An explicit admin approval grants its verified applicant the Owner role. Grant changes are recorded in `vendor_access_audit`.

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

2. Apply the migrations in `supabase/migrations` in filename order to the staff/commerce Supabase project with Storage enabled. For an existing installation through the owner-team migration, apply the onboarding and workspace migrations in the rollout order above. The onboarding migration preserves the three pilot storefront URLs, converts historical Reviewed applications to Under review, and creates the private vendor-onboarding PDF bucket. Previously enabled payments display a legacy status until an admin records verification. Load `supabase/seed.sql` for the optional staging menu. Live storefronts come from the database. Preview mode uses the sample catalog.
3. In the Supabase project used for student Auth, enable Email with confirmation, configure SMTP, and include `{{ .Token }}` in both **Confirm signup** and **Reset password** email templates. Enable Google using its OAuth client ID and secret in **Supabase Authentication → Providers → Google**. Add that Supabase project's callback URL in Google Cloud. In each project, set Authentication → URL Configuration → Site URL to its public HTTPS app origin. In the student project, allow the exact URL `<student-origin>/auth/student/callback`. Set `CAMPUSBITE_STUDENT_ORIGIN` if students use a different hostname from staff. Open the app on the configured hostname so the browser can return its sign-in cookie. Use a separate OAuth client or authorize both Supabase callback URLs if sharing a Google OAuth client. Enable the invite-only hook only on a dedicated staff Auth project. The shared project needs public registration with email confirmation. [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)
4. In Razorpay Test Mode, enable automatic capture and configure `https://YOUR-STAGING-HOST/api/payments/razorpay` for `payment.captured` and `refund.processed`. Match the webhook secret to the app setting. A local checkout callback verifies completed payments directly, and the webhook covers delayed payments and browser interruptions. Verify the webhook using the staging HTTPS URL. [Razorpay Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps) · [Webhook validation](https://razorpay.com/docs/webhooks/validate-test)
5. Configure a scheduler to **POST** `/api/jobs/commerce` every minute with `Authorization: Bearer <COMMERCE_JOB_SECRET>`. It expires held and unaccepted orders and processes the refund queue. Alert on failed job runs and check Razorpay and the admin order list when a refund keeps retrying.
6. At `/vendor`, verify the applicant email, save a draft, attach supporting PDFs, accept the displayed agreement and submit. In **Admin → Vendor applications**, start review, request corrections with a message, reject, or approve. Approval creates or explicitly links a shop and grants its applicant owner access. Applicants can track decisions and resubmit corrections at `/vendor/onboarding`. In **Admin → Current Vendors**, open the shop to publish its listing, add menu items, record the verified payment-provider reference, and enable paid orders. A published stall can be browse-only. Suspension hides its listing and disables new reservations. Test during storefront hours in IST with two student accounts and complete the payment, rejection/refund, acceptance, preparation, pickup and sale flows. Student order details are at `/orders`.

### Peak-time testing

The database takes a transaction lock per shop and pickup window to enforce capacity during a rush. Duplicate requests reuse the same reservation, abandoned holds expire, and a capture arriving after the hold deadline gets a feasibility check for its original window. Public catalog reads are cached and authenticated order reads use indexes. The active vendor board refreshes only while visible.

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
