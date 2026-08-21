import { VehicleDirectory } from "@/components/vehicle-directory";
import { ProtectedPage } from "@/components/protected-page";

export default function VehiclesPage() {
  return <ProtectedPage><VehicleDirectory /></ProtectedPage>;
}
