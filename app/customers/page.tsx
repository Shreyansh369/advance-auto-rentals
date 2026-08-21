import { CustomerDirectory } from "@/components/customer-directory";
import { ProtectedPage } from "@/components/protected-page";

export default function CustomersPage() {
  return (
    <ProtectedPage>
      <CustomerDirectory />
    </ProtectedPage>
  );
}