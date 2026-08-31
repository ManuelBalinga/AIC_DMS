import { permanentRedirect } from "next/navigation";

export default async function LegacyPersonPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  permanentRedirect(`/admin/people/${encodeURIComponent(userId)}`);
}
