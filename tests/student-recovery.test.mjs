import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("student recovery limits and verification grants", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role; create schema campusbite_private");
  await db.exec(await readFile(new URL("../supabase/migrations/202611200004_student_recovery.sql", import.meta.url), "utf8"));
  const scalar = async (sql, args) => Object.values((await db.query(sql, args)).rows[0])[0];
  const email = "a".repeat(64), ip = "b".repeat(64), proof = "c".repeat(64);
  const send = (address=email, network=ip, captcha=false) => scalar("select student_request_recovery($1,$2,$3)", [address,network,captcha]);
  const check = (id, lease) => scalar("select student_check_recovery($1,$2,$3)", [id,email,lease]);
  const finish = (id, lease, verified=null, retry=false) => scalar("select student_finish_check($1,$2,$3,$4,$5,$6)", [id,lease,verified,proof,"encrypted-test-token",retry]);
  const consume = (id, key=proof) => scalar("select student_consume_recovery($1,$2)", [id,key]);
  await t.test("ordinary clients cannot access counters or mint grants", async () => {
    for (const role of ["anon","authenticated"]) {
      await db.exec("set role " + role);
      await assert.rejects(send(), /permission denied/);
      await assert.rejects(db.query("select * from campusbite_private.student_recoveries"), /permission denied/);
      await db.exec("reset role");
    }
  });
  await t.test("rolling email limits, cooldown and replacement", async () => {
    const results = await Promise.all([send(),send()]);
    const first = results.find(r=>r.attempt).attempt;
    assert.equal(results.filter(r=>r.attempt).length,1);
    assert.equal(results.find(r=>!r.attempt).wait,60);
    for (let i=1;i<5;i++) {
      await db.exec("update campusbite_private.student_recoveries set requested_at=requested_at-interval '61 seconds'");
      assert.ok((await send()).attempt);
    }
    assert.equal(await check(first,randomUUID()),"expired");
    await db.exec("update campusbite_private.student_recoveries set requested_at=requested_at-interval '61 seconds'");
    assert.ok((await send()).wait>3000);
    await db.exec("update campusbite_private.student_recoveries set requested_at=now()-interval '61 minutes'");
    assert.ok((await send()).attempt);
  });
  await t.test("twentieth shared-IP request requires a challenge, solved requests can continue", async () => {
    const network="d".repeat(64);
    for (let i=0;i<19;i++) assert.ok((await send(i.toString(16).padStart(64,"0"),network)).attempt);
    assert.equal((await send(proof,network)).challenge,true);
    assert.ok((await send(proof,network,true)).attempt);
  });
  const newAttempt = async () => {
    await db.exec("update campusbite_private.student_recoveries set requested_at=requested_at-interval '61 minutes'");
    return (await send()).attempt;
  };
  await t.test("five unsuccessful submissions lock the attempt, transient errors preserve a try", async () => {
    const id=await newAttempt();
    const lease=randomUUID();
    assert.equal(await check(id,lease),"ok");
    assert.equal(await check(id,randomUUID()),"busy");
    assert.equal(await finish(id,lease,null,true),"invalid");
    for (let i=1;i<=5;i++) {
      const next=randomUUID();
      assert.equal(await check(id,next),"ok");
      assert.equal(await finish(id,next,i===1 ? proof : null),i===5?"locked":"invalid");
    }
    assert.equal(await check(id,randomUUID()),"locked");
    assert.equal(await consume(id),null);
  });
  await t.test("a verified grant can be consumed only once and expires after ten minutes", async () => {
    for (const expire of [false,true]) {
      const id=await newAttempt(), lease=randomUUID();
      assert.equal(await check(id,lease),"ok");
      assert.equal(await finish(id,lease,email),"verified");
      assert.equal(await check(id,randomUUID()),"expired");
      assert.equal(await consume(id,ip),null);
      if(expire) await db.query("update campusbite_private.student_recoveries set verified_at=now()-interval '11 minutes' where id=$1",[id]);
      assert.equal(await consume(id),expire?null:"encrypted-test-token");
      assert.equal(await consume(id),null);
    }
  });
});
