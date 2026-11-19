import { editTeamMember } from "@/lib/staff/actions";
import { vendorRoles, type VendorAccess, type StaffArea } from "@/lib/staff/database";
import { StaffForm } from "./staff-forms";

export function ShopMembers({ shopId, grants, area }: { shopId: string; grants: VendorAccess[]; area: StaffArea }) {
  if (!grants.length) return <p>No team members on this page.</p>;
  return <ul className="stack">{grants.map(grant => <li key={grant.email} className="access-row">
    <span>{grant.email}</span>
    {area === "vendor" && grant.role === "owner" ? <strong>Owner</strong> : <>
      <StaffForm key={grant.role} action={editTeamMember.bind(null, area, "change")} label="Change role" secondary>
        <input name="shop_id" type="hidden" value={shopId} /><input name="email" type="hidden" value={grant.email} />
        <input name="previous_role" type="hidden" value={grant.role} />
        <label className="field"><span className="sr-only">Role for {grant.email}</span>
          <select name="role" defaultValue={grant.role}>
            {Object.entries(vendorRoles).filter(([role]) => area === "admin" || role !== "owner")
              .map(([role, label]) => <option key={role} value={role}>{label}</option>)}
          </select>
        </label>
      </StaffForm>
      <StaffForm action={editTeamMember.bind(null, area, "revoke")} label="Revoke access" secondary>
        <input name="shop_id" type="hidden" value={shopId} /><input name="email" type="hidden" value={grant.email} />
        <input name="previous_role" type="hidden" value={grant.role} />
      </StaffForm>
    </>}
  </li>)}</ul>;
}
