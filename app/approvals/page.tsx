import { ApprovalsQueue } from "@/components/approvals-queue";
import { ProtectedPage } from "@/components/protected-page";

export default function ApprovalsPage() {
  return (
    <ProtectedPage>
      <ApprovalsQueue />
    </ProtectedPage>
  );
}
