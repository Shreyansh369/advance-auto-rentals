import type { Metadata } from "next";
import "./globals.css";
import { FirebaseProvider } from "@/components/firebase-provider";

export const metadata: Metadata = {
  title: "Advance Auto Rentals",
  description: "Secure rental operations management",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <FirebaseProvider>{children}</FirebaseProvider>
      </body>
    </html>
  );
}
