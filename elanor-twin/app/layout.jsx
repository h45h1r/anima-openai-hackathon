import "./globals.css";

export const metadata = {
  title: "Eleanor Twin · SIM-000006",
  description: "Synthetic simulation digital twin for Eleanor Chen",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
