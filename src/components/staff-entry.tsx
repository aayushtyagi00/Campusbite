import Link from "next/link";
import { ArrowRight, ClipboardList, Store } from "lucide-react";
import { staffConfigured, staffOrigin } from "@/lib/staff/supabase";
import type { StaffArea } from "@/lib/staff/database";
import { StaffSignInForm } from "./staff-forms";
import { ApplicantEntry } from "./applicant-entry";
import { applicantSession } from "@/lib/vendor-applicant";
import { Back, Brand, Notice, Photo } from "./ui";

export async function VendorHome() {
  const configured = staffConfigured();
  const applicant = configured ? await applicantSession() : null;
  return <>
    <header className="student-header"><div className="wrap staff-entry-header">
      <Brand />
      <Link className="button secondary" href="/vendor/sign-in">Sign In</Link>
    </div></header>
    <main className="wrap staff-entry-main" id="main">
      <section className="vendor-landing-hero">
        <div className="stack">
          <p className="eyebrow"><Store size={17} /> CampusBite for vendors</p>
          <h1>Serve students on their schedule.</h1>
          <p>Apply to list your campus shop for scheduled pickup. If your shop already has access, sign in with the email CampusBite approved for you.</p>
          <div className="row wrap-row">
            <a className="button" href="#vendor-application">Apply as a Vendor <ArrowRight size={17} /></a>
            <Link className="button secondary" href="/vendor/sign-in">Sign In</Link>
          </div>
        </div>
        <Photo name="rolling" />
      </section>
      <section id="vendor-application" className="panel panel-pad stack vendor-application">
        <h2 className="row"><ClipboardList size={20} /> Apply as a Vendor</h2>
        <p>Save your business details and documents, then submit them for review. You can return here to check a decision or make corrections.</p>
        {!configured && <Notice>Application submissions are unavailable until the portal is configured.</Notice>}
        <ApplicantEntry disabled={!configured} email={applicant?.email} />
      </section>
    </main>
  </>;
}

export function StaffSignIn({ area, googleError }: { area: StaffArea; googleError?: boolean }) {
  const configured = staffConfigured();
  return <main className="wrap staff-entry-main" id="main">
    <div className="narrow auth">
      <Back href={area === "vendor" ? "/vendor" : "/"}>{area === "vendor" ? "Vendor homepage" : "CampusBite"}</Back>
      <div className="page-heading"><h1>{area === "vendor" ? "Vendor sign in" : "Admin sign in"}</h1>
        <p>{area === "admin" ? "Sign in with the owner's Google account, then verify your authenticator code." :
          "Use your approved email to continue with Google or sign in with a password. If this is your first time, you can set your password below."}</p></div>
      <section className="panel panel-pad stack">
        {!configured && <Notice>The sign-in service is unavailable until the portal is configured.</Notice>}
        {googleError && <Notice>Google sign-in could not be completed. Choose an account with approved access and try again.</Notice>}
        <StaffSignInForm area={area} disabled={!configured} googleDisabled={!configured || !staffOrigin()} />
      </section>
    </div>
  </main>;
}
