"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdministrator } from "@/modules/auth/session";
import { serverEnv } from "@/lib/env";
import type { ActionState } from "@/lib/action-state";
import type { UserRole } from "@/lib/types/database";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Invite a team member. Administrators only.
 *
 * The invitation row is written first so that `handle_new_user` can read the
 * intended role when the invitee accepts, then Supabase sends the email.
 */
export async function inviteTeamMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdministrator();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "member") as UserRole;

  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Enter a valid email address." };
  }
  if (role !== "administrator" && role !== "member") {
    return { error: "Choose a valid role." };
  }

  const supabase = await createClient();

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingProfile) {
    return { error: "That person already has an account." };
  }

  const { data: invitation, error: insertError } = await supabase
    .from("invitations")
    .insert({ email, role, invited_by: admin.id })
    .select("id")
    .single();

  if (insertError) {
    return insertError.code === "23505"
      ? { error: "That address already has a pending invitation." }
      : { error: "Could not record the invitation." };
  }

  const adminClient = createAdminClient();
  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${serverEnv.siteUrl}/auth/callback?next=/auth/set-password`,
  });

  if (inviteError) {
    // Roll the row back so the address can be invited again cleanly.
    await supabase.from("invitations").delete().eq("id", invitation.id);
    return { error: `Could not send the invitation: ${inviteError.message}` };
  }

  revalidatePath("/admin/team");
  return { success: `Invitation sent to ${email}.` };
}

/** Withdraw an invitation that has not been accepted. */
export async function revokeInvitation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdministrator();

  const invitationId = String(formData.get("invitation_id") ?? "");
  if (!invitationId) return { error: "Missing invitation." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("status", "pending");

  if (error) return { error: "Could not revoke that invitation." };

  revalidatePath("/admin/team");
  return { success: "Invitation revoked." };
}

/** Promote or demote a team member. */
export async function changeMemberRole(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdministrator();

  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "") as UserRole;

  if (role !== "administrator" && role !== "member") {
    return { error: "Choose a valid role." };
  }
  if (userId === admin.id && role !== "administrator") {
    return { error: "You cannot remove your own administrator access." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);

  if (error) return { error: "Could not update that role." };

  revalidatePath("/admin/team");
  return { success: "Role updated." };
}
