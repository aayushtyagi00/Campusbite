import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ids = {
  admin: "10000000-0000-0000-0000-000000000001",
  owner: "10000000-0000-0000-0000-000000000002",
  manager: "10000000-0000-0000-0000-000000000003",
  staff: "10000000-0000-0000-0000-000000000004",
  stranger: "10000000-0000-0000-0000-000000000005",
  unverified: "10000000-0000-0000-0000-000000000006",
};

const authSchema = `
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create role supabase_auth_admin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `;

test("the legacy bootstrap keeps both portals closed until the current migrations are installed", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(authSchema);
  await db.exec(await readFile(new URL("../supabase/setup-campus-admin.sql",import.meta.url),"utf8"));
  const email = "tyagiaayush3030@gmail.com";
  await db.query("insert into auth.users values($1,$2,now())",[ids.admin,email]);
  const { rows: [shop] } = await db.query("insert into vendor_shops(name) values ('Fixture') returning id");
  await db.query("insert into vendor_access(shop_id,email,role) values($1,$2,'owner')",[shop.id,email]);
  await db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[ids.admin]);
    assert.equal((await tx.query("select campusbite_is_admin() as ok")).rows[0].ok,false);
    assert.deepEqual((await tx.query("select * from vendor_access")).rows,[]);
    assert.deepEqual((await tx.query("select * from vendor_shops")).rows,[]);
  });
});

test("PostgreSQL enforces staff access independently of the web UI", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(authSchema);
  await db.exec(await readFile(new URL("../supabase/migrations/202611180001_staff_access.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/202611190001_shop_owner_team.sql", import.meta.url), "utf8"));
  for (const [actor, id] of Object.entries(ids)) {
    await db.query("insert into auth.users values ($1, $2, $3)", [id, `${actor}@example.test`, actor === "unverified" ? null : "2026-11-18T00:00:00Z"]);
  }
  await db.exec("insert into public.staff_admins values ('admin@example.test')");

  function asRole(role, identity, run) {
    return db.transaction(async tx => {
      assert(["anon", "authenticated", "service_role", "supabase_auth_admin"].includes(role));
      await tx.exec(`set local role ${role}`);
      if (identity) {
        await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [ids[identity]]);
      }
      return run(tx);
    });
  }
  const asUser = (name, run) => asRole("authenticated", name, run);
  const grant = (tx, shop, name, role) => tx.query(
    "select public.campusbite_grant_vendor_access($1,$2,$3)",
    [shop, `${name}@example.test`, role],
  );
  const [shopA, shopB] = await asUser("admin", async tx => {
    const result = await tx.query("insert into public.vendor_shops (name) values ('Shop A'), ('Shop B') returning id");
    return result.rows.map(shop => shop.id);
  });
  await asUser("admin", async tx => {
    await grant(tx, shopA, "owner", "owner");
    await grant(tx, shopB, "manager", "manager");
    await grant(tx, shopA, "staff", "staff");
    await grant(tx, shopA, "unverified", "owner");
  });
  await asRole("service_role", null, async tx => {
    await tx.query("insert into public.vendor_orders (shop_id,reference,status,pickup_at) values ($1,'A-order','ready',now()), ($2,'B-order','ready',now())", [shopA, shopB]);
    await tx.query("insert into public.vendor_sales (shop_id,reference,amount_paise) values ($1,'A-sale',10000), ($2,'B-sale',20000)", [shopA, shopB]);
    await tx.exec("insert into public.vendor_applications (shop_name,contact_name,email,phone,location) values ('Test Shop','Test Contact','applicant@example.test','1234567890','UniMall')");
  });

  await t.test("anonymous and ungranted or unverified identities have no data", async () => {
    await assert.rejects(asRole("anon", null, tx => tx.query("select * from public.vendor_orders")), /permission denied/i);
    await assert.rejects(asRole("anon", null, tx => tx.query("select * from public.vendor_applications")), /permission denied/i);
    for (const name of ["stranger", "unverified"]) await asUser(name, async tx => {
      assert.deepEqual((await tx.query("select * from public.vendor_shops")).rows, []);
      assert.deepEqual((await tx.query("select * from public.vendor_access")).rows, []);
      assert.deepEqual((await tx.query("select * from public.vendor_orders")).rows, []);
      assert.deepEqual((await tx.query("select * from public.vendor_sales")).rows, []);
    });
  });

  await t.test("owner and manager see only the explicitly assigned shop", async () => {
    for (const [actor, prefix, other] of [["owner", "A", shopB], ["manager", "B", shopA]]) {
      await asUser(actor, async tx => {
        assert.deepEqual((await tx.query("select name from public.vendor_shops")).rows, [{ name: `Shop ${prefix}` }]);
        assert.deepEqual((await tx.query("select reference from public.vendor_orders")).rows, [{ reference: `${prefix}-order` }]);
        assert.deepEqual((await tx.query("select reference from public.vendor_sales")).rows, [{ reference: `${prefix}-sale` }]);
        assert.deepEqual((await tx.query("select * from public.vendor_sales where shop_id = $1", [other])).rows, []);
        assert.deepEqual((await tx.query("select * from public.vendor_applications")).rows, []);
        assert.deepEqual((await tx.query("select * from public.vendor_access_audit")).rows, []);
      });
    }
  });

  await t.test("staff can read their shop's orders and cannot read sales or modify grants", async () => {
    await asUser("staff", async tx => {
      assert.deepEqual((await tx.query("select reference from public.vendor_orders")).rows, [{ reference: "A-order" }]);
      assert.deepEqual((await tx.query("select * from public.vendor_sales")).rows, []);
      const changed = await tx.query("update public.vendor_access set role = 'owner' returning role");
      assert.deepEqual(changed.rows, []);
    });
    await assert.rejects(asUser("staff", tx => grant(tx, shopB, "staff", "owner")), /row.level security/i);
    await assert.rejects(asUser("owner", tx => tx.query("insert into public.vendor_shops (name) values ('Unapproved')")), /row.level security/i);
  });

  await t.test("owners manage only staff and managers in their own shop", async () => {
    await asUser("owner", async tx => {
      await grant(tx, shopA, "new-member", "staff");
      await grant(tx, shopA, "new-member", "manager");
      const removed = await tx.query("delete from public.vendor_access where shop_id=$1 and email='new-member@example.test' returning role", [shopA]);
      assert.deepEqual(removed.rows, [{role: "manager"}]);
      const owners = await tx.query("delete from public.vendor_access where role='owner' returning role");
      assert.deepEqual(owners.rows, []);
    });
    await assert.rejects(asUser("owner", tx => grant(tx, shopB, "new-member", "staff")), /row.level security/i);
    await assert.rejects(asUser("owner", tx => grant(tx, shopA, "staff", "owner")), /row.level security/i);
    await assert.rejects(asUser("manager", tx => grant(tx, shopB, "new-member", "staff")), /row.level security/i);
  });

  await t.test("administrator review, role changes, revocations, and audit records", async () => {
    await asUser("admin", async tx => {
      assert.equal((await tx.query("select public.campusbite_is_admin() as allowed")).rows[0].allowed, true);
      assert.equal((await tx.query("select * from public.vendor_applications")).rows.length, 1);
      await tx.query("update public.vendor_applications set status = 'reviewed'");
      await grant(tx, shopA, "owner", "staff");
    });
    await asUser("owner", async tx => {
      assert.deepEqual((await tx.query("select * from public.vendor_sales")).rows, []);
      assert.equal((await tx.query("select * from public.vendor_orders")).rows.length, 1);
    });
    await asUser("admin", async tx => {
      await tx.query("delete from public.vendor_access where shop_id=$1 and email='owner@example.test'", [shopA]);
      const audit = await tx.query("select action, actor_id from public.vendor_access_audit where email='owner@example.test' order by id");
      assert.deepEqual(audit.rows, ["INSERT", "UPDATE", "DELETE"].map(action => ({ action, actor_id: ids.admin })));
    });
    await asUser("owner", async tx => {
      assert.deepEqual((await tx.query("select * from public.vendor_access")).rows, []);
      assert.deepEqual((await tx.query("select * from public.vendor_orders")).rows, []);
    });
  });

  await t.test("only service roles can run the rate limiter or invitation hook", async () => {
    const attempt = tx => tx.query("select public.campusbite_consume_attempt('test','key',1,60) as allowed");
    await assert.rejects(asUser("manager", attempt), /permission denied/i);
    await asRole("service_role", null, async tx => {
      assert.equal((await attempt(tx)).rows[0].allowed, true);
      assert.equal((await attempt(tx)).rows[0].allowed, false);
    });
    const hook = (tx, email) => tx.query("select public.campusbite_before_user_created($1::jsonb) as result", [{ user: { email } }]);
    await assert.rejects(asUser("manager", tx => hook(tx, "stranger@example.test")), /permission denied/i);
    await asRole("supabase_auth_admin", null, async tx => {
      assert.deepEqual((await hook(tx, "Manager@Example.Test")).rows[0].result, {});
      assert.equal((await hook(tx, "stranger@example.test")).rows[0].result.error.http_code, 403);
    });
  });
});
