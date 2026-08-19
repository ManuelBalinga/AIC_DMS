import { requireProfile } from "@/modules/auth/session";
import { Badge, Card } from "@/components/ui";
import { ChangePasswordForm } from "./change-password-form";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Your account | AIC Documents" };

export default async function AccountPage() {
  const profile = await requireProfile();

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Your account
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {profile.email}
        </p>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Role
          </h2>
          <Badge tone={profile.role === "administrator" ? "blue" : "neutral"}>
            {profile.role}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Only an administrator can change a role. Ask one if this looks wrong.
        </p>
      </Card>

      <ProfileForm defaultName={profile.full_name ?? ""} />
      <ChangePasswordForm />
    </div>
  );
}
