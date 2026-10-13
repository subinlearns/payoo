import Link from "next/link";
import { readDb } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { getRates } from "@/lib/fx";
import { PageHeader } from "@/components/ui";
import { PayFlow } from "./pay-flow";

export const dynamic = "force-dynamic";

export default async function PayPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const [user, rates, sp] = await Promise.all([currentUser(), getRates(), searchParams]);
  const suppliers = readDb().suppliers.filter((s) => s.ownerId === user.id);
  return (
    <>
      <PageHeader
        eyebrow="New payment"
        title="Pay a supplier in China"
        sub="Enter the invoice amount in yuan. You'll see the exact NPR total, our fee and the rate before you pay. Nothing is hidden in the spread."
      />
      {suppliers.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-muted">Add a supplier first so we know where the CNY should go.</p>
          <Link href="/suppliers" className="btn-primary mt-4">
            Add a supplier
          </Link>
        </div>
      ) : (
        <PayFlow suppliers={suppliers} initialSupplier={sp.supplier} rates={rates} />
      )}
    </>
  );
}
