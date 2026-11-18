# CampusBite

Mobile-first scheduled food pickup for LPU. The student site currently uses sample commerce data. Vendor applications, verification and shop access use the server and Supabase.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

| Interface | Local route | Workflows |
| --- | --- | --- |
| Student website | `/` | Explore stalls, browse products, build a bag, select a pickup window, sign in with a sample student, simulate payment, track fulfillment, and request support |
| Vendor portal | `/vendor` | Apply as a vendor or sign in with an authorized email |
| Vendor workspace | `/vendor/dashboard` | Open assigned shops and see recent orders and, for owners and managers, sales |
| Admin workspace | `/admin` | Review applications and manage shop access |

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
- A simulated payment creates a local sample order. Cancelling a pending sample order or letting its 90-second acceptance window expire creates a preview refund request.
- All preview prices are illustrative. Provider, commission, taxes, later cancellation and no-show policies, refund charge allocation, and support coverage remain product decisions.

## Backend integration pending

The staff access migration defines shop-scoped tables for orders and sales. They receive records only when a trusted commerce backend is connected. Production student authentication, catalog and checkout integration, inventory and pickup reservations, payments and refunds, fulfillment, push notifications, and settlements are separate work. The installable student shell provides an offline fallback and keeps order and account responses network-only.

## Stitch source

`design/` holds 10 HTML/PNG export pairs. The manifest records the exact screen IDs. Earlier Stitch iterations include eight requested originals and the earlier polished vendor board, for which there are no local exports.

Photo assets in `public/food/` come from the existing Stitch HTML exports. Additional sample menu items use a placeholder when there is no matching photo.
