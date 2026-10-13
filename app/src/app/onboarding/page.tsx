import Link from "next/link";
import { Logo } from "@/components/ui";
import { OnboardingForm } from "./onboarding-form";

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <Link href="/">
        <Logo />
      </Link>
      <h1 className="mt-8 text-3xl font-extrabold tracking-tight">Open a Payoo account</h1>
      <p className="mt-2 text-sm text-muted">
        One KYC, then pay any supplier in China from your phone. We create a secure wallet for you behind the scenes,
        with no seed phrases or crypto to manage.
      </p>
      <OnboardingForm />
    </div>
  );
}
