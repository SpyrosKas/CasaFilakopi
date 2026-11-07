import { adminI18n } from "@/lib/admin/i18n-server";
import {
  ActionButton,
  ActionForm,
  Field,
  SelectField,
} from "@/components/admin/form";
import { Badge, PageHead, Panel } from "@/components/admin/ui";
import {
  changeAdminRole,
  inviteAdmin,
  removeAdmin,
  resetTwoStep,
} from "@/lib/admin/actions/users";
import { requireOwner } from "@/lib/admin/session";
import { loadMembers, type AdminMember } from "@/lib/admin/users-data";

async function Actions({ member }: { member: AdminMember }) {
  const { t } = await adminI18n();
  const u = t.ops.users;

  const fields = { id: member.id };
  const toOwner = member.role === "staff";
  return (
    <div className="button-row">
      <ActionButton
        action={changeAdminRole}
        fields={{ ...fields, role: toOwner ? "owner" : "staff" }}
        label={toOwner ? u.makeOwner : u.makeStaff}
        pendingLabel={u.working}
        variant="quiet"
        confirm={toOwner ? u.makeOwnerConfirm : u.makeStaffConfirm}
      />
      {member.hasTwoStep && (
        <ActionButton
          action={resetTwoStep}
          fields={fields}
          label={u.resetTwoStep}
          pendingLabel={u.working}
          variant="quiet"
          confirm={u.resetTwoStepConfirm}
        />
      )}
      <ActionButton
        action={removeAdmin}
        fields={fields}
        label={u.remove}
        pendingLabel={u.working}
        variant="danger"
        confirm={u.removeConfirm}
      />
    </div>
  );
}

export default async function UsersPage() {
  const { t } = await adminI18n();
  const u = t.ops.users;

  const admin = await requireOwner();
  const members = await loadMembers(admin);

  return (
    <div className="stack">
      <PageHead title={u.title} intro={u.intro} />
      <Panel title={u.title}>
        <ul className="stack" data-testid="admin-users">
          {members.map((member) => (
            <li key={member.id} className="stack">
              <p>
                <strong>{member.name}</strong>{" "}
                <Badge>
                  {member.role === "owner" ? u.roleOwner : u.roleStaff}
                </Badge>{" "}
                {member.id === admin.userId && <Badge>{u.you}</Badge>}
              </p>
              <p className="muted small">
                {member.email}
                {" · "}
                {member.hasTwoStep ? u.twoStepOn : u.twoStepOff}
              </p>
              {member.id !== admin.userId && <Actions member={member} />}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={u.inviteTitle}>
        <p className="hint">{u.inviteHint}</p>
        <ActionForm
          action={inviteAdmin}
          submitLabel={u.inviteSubmit}
          pendingLabel={u.inviteSubmitting}
          resetOnOk
        >
          <Field label={u.name} name="displayName" autoComplete="off" />
          <Field label={u.email} name="email" type="email" autoComplete="off" />
          <SelectField
            label={u.role}
            name="role"
            defaultValue="staff"
            options={[
              { value: "staff", label: u.roleStaff },
              { value: "owner", label: u.roleOwner },
            ]}
          />
        </ActionForm>
      </Panel>
    </div>
  );
}
