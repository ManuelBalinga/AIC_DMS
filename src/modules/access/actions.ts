"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/modules/auth/session";
import type { ActionState } from "@/lib/action-state";
import type { DocumentRole } from "@/lib/types/database";

const DOCUMENT_ROLES: DocumentRole[] = ["viewer", "commenter", "editor"];

/**
 * Grant a team member access to a document.
 *
 * No ownership check is written here: the `document_access_insert` policy calls
 * `can_manage_document`, so a non-owner simply gets a policy violation back.
 */
export async function grantDocumentAccess(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();

  const documentId = String(formData.get("document_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "viewer") as DocumentRole;

  if (!documentId || !userId) return { error: "Choose a team member." };
  if (userId === profile.id) return { error: "You already own this document." };
  if (!DOCUMENT_ROLES.includes(role)) return { error: "Choose a valid role." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("document_access")
    .insert({ document_id: documentId, user_id: userId, role, granted_by: profile.id });

  if (error) {
    if (error.code === "23505") return { error: "They already have access." };
    return { error: "You are not allowed to share this document." };
  }

  revalidatePath(`/documents/${documentId}`);
  return { success: "Access granted." };
}

/**
 * Change what an existing grant permits.
 *
 * Separate from granting so that changing somebody from Viewer to Editor is not
 * a revoke-and-regrant — which would lose `created_at` and, more importantly,
 * briefly remove their access in the middle of an operation that was meant to
 * widen it.
 */
export async function changeDocumentRole(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();

  const documentId = String(formData.get("document_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "") as DocumentRole;

  if (!documentId || !userId) return { error: "Missing details." };
  if (!DOCUMENT_ROLES.includes(role)) return { error: "Choose a valid role." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_access")
    .update({ role })
    .eq("document_id", documentId)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();

  if (error) return { error: "Could not change that role." };
  if (!data) return { error: "You are not allowed to change sharing here." };

  revalidatePath(`/documents/${documentId}`);
  return { success: "Role updated." };
}

/** Withdraw a previously granted access. */
export async function revokeDocumentAccess(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();

  const documentId = String(formData.get("document_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");

  if (!documentId || !userId) return { error: "Missing details." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("document_access")
    .delete()
    .eq("document_id", documentId)
    .eq("user_id", userId);

  if (error) return { error: "You are not allowed to change sharing here." };

  revalidatePath(`/documents/${documentId}`);
  return { success: "Access revoked." };
}

/** Grant the whole Team one durable role; membership is resolved by Postgres. */
export async function grantTeamDocumentAccess(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile();
  const documentId = String(formData.get("document_id") ?? "").trim();
  const teamId = String(formData.get("team_id") ?? "").trim();
  const role = String(formData.get("role") ?? "viewer") as DocumentRole;

  if (!documentId || !teamId) return { error: "Choose a Team." };
  if (!DOCUMENT_ROLES.includes(role)) return { error: "Choose a valid role." };

  const supabase = await createClient();
  const { error } = await supabase.from("document_team_access").insert({
    document_id: documentId,
    team_id: teamId,
    role,
    granted_by: profile.id,
  });

  if (error?.code === "23505") return { error: "That Team already has access." };
  if (error) return { error: "You are not allowed to share with that Team." };

  revalidatePath(`/documents/${documentId}`);
  return { success: "Team access granted." };
}

export async function changeTeamDocumentRole(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();
  const documentId = String(formData.get("document_id") ?? "").trim();
  const teamId = String(formData.get("team_id") ?? "").trim();
  const role = String(formData.get("role") ?? "") as DocumentRole;

  if (!documentId || !teamId) return { error: "Missing Team grant." };
  if (!DOCUMENT_ROLES.includes(role)) return { error: "Choose a valid role." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_team_access")
    .update({ role })
    .eq("document_id", documentId)
    .eq("team_id", teamId)
    .select("team_id")
    .maybeSingle();

  if (error || !data) return { error: "That Team role could not be changed." };

  revalidatePath(`/documents/${documentId}`);
  return { success: "Team role updated." };
}

export async function revokeTeamDocumentAccess(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireProfile();
  const documentId = String(formData.get("document_id") ?? "").trim();
  const teamId = String(formData.get("team_id") ?? "").trim();
  if (!documentId || !teamId) return { error: "Missing Team grant." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("document_team_access")
    .delete()
    .eq("document_id", documentId)
    .eq("team_id", teamId);

  if (error) return { error: "That Team access could not be removed." };

  revalidatePath(`/documents/${documentId}`);
  return { success: "Team access removed." };
}
