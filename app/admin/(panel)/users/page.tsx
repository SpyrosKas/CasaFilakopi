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
import { t } from "@/lib/admin/strings";
import { loadMembers, type AdminMember } from "@/lib/admin/users-data";

const u = t.ops.users;

/** Anything that makes or unmakes an Owner needs their email typed in full. */
function Typed({
  member,
  action,
  label,
  warning,
  role,
  danger,
}: {
  member: AdminMember;
  action: Parameters<typeof ActionForm>[0]["action"];
  label: string;
  warning: string;
  role?: "owner" | "staff";
  danger?: boolean;
}) {
  return (
    <details>
      <summary className="button button-quiet">{label}</summary>
      <p className="hint">{warning}</p>
      <ActionForm
        action={action}
        submitLabel={label}
        pendingLabel={u.working}
        danger={danger}
      >
        <input type="hidden" name="id" value={member.id} />
        {role && <input type="hidden" name="role" value={role} />}
        <Field
          label={u.typeEmail(member.email)}
          name="confirmEmail"
          type="email"
          autoComplete="off"
        />
      </ActionForm>
    </details>
  );
}

function Actions({ member }: { member: AdminMember }) {
  const fields = { id: member.id };
  const isOwner = member.role === "owner";
  return (
    <div className="stack">
      <Typed
        member={member}
        action={changeAdminRole}
        label={isOwner ? u.makeStaff : u.makeOwner}
        warning={isOwner ? u.makeStaffConfirm : u.makeOwnerConfirm}
        role={isOwner ? "staff" : "owner"}
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
      {isOwner ? (
        <Typed
          member={member}
          action={removeAdmin}
          label={u.remove}
          warning={u.removeConfirm}
          danger
        />
      ) : (
        <ActionButton
          action={removeAdmin}
          fields={fields}
          label={u.remove}
          pendingLabel={u.working}
          variant="danger"
          confirm={u.removeConfirm}
        />
      )}
    </div>
  );
}

export default async function UsersPage() {
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
          <Field
            label={u.confirmEmail}
            hint={u.confirmEmailHint}
            name="confirmEmail"
            type="email"
            autoComplete="off"
          />
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
