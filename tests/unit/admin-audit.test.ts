import { beforeEach, describe, expect, it, vi } from "vitest";

const secretRpc = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/admin", () => ({
  createAdminClient: () => ({ rpc: secretRpc }),
}));

const { callAdminRpc } = await import("@/lib/admin/audit");

function adminWithRole(role: string | null, error: Error | null = null) {
  const userRpc = vi.fn().mockResolvedValue({ data: role, error });
  return {
    userRpc,
    admin: { userId: "admin-1", supabase: { rpc: userRpc } } as never,
  };
}

describe("callAdminRpc", () => {
  beforeEach(() => {
    secretRpc.mockReset();
    secretRpc.mockResolvedValue({ data: "done", error: null });
  });

  it("checks the role through the user's client, then names the actor", async () => {
    const { admin, userRpc } = adminWithRole("owner");
    const args = { p_booking_id: "b-1" };
    await expect(callAdminRpc(admin, "cancel_booking", args)).resolves.toBe(
      "done",
    );
    expect(userRpc).toHaveBeenCalledWith("current_admin_role");
    expect(secretRpc).toHaveBeenCalledWith("cancel_booking", {
      p_booking_id: "b-1",
      p_actor: "admin-1",
    });
  });

  it("never reaches the secret key without a role", async () => {
    const { admin } = adminWithRole(null);
    await expect(
      callAdminRpc(admin, "cancel_booking", { p_booking_id: "b-1" }),
    ).rejects.toThrow("not_authorised");
    expect(secretRpc).not.toHaveBeenCalled();
  });

  it("never reaches the secret key if the role check fails", async () => {
    const { admin } = adminWithRole(null, new Error("network"));
    await expect(
      callAdminRpc(admin, "cancel_booking", { p_booking_id: "b-1" }),
    ).rejects.toThrow("network");
    expect(secretRpc).not.toHaveBeenCalled();
  });

  it("passes on a database error", async () => {
    secretRpc.mockResolvedValue({ data: null, error: new Error("boom") });
    const { admin } = adminWithRole("staff");
    await expect(
      callAdminRpc(admin, "cancel_booking", { p_booking_id: "b-1" }),
    ).rejects.toThrow("boom");
  });
});
