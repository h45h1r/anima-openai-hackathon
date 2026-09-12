import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import { AppProvider } from '@/lib/state';
import { Shell } from '@/components/Shell';
import './globals.css';

const bricolage = Bricolage_Grotesque({
  variable: '--font-bricolage',
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
});
const instrument = Instrument_Sans({
  variable: '--font-instrument',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});
const jetbrains = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'CareCircle — your health, your circle',
  description: 'Patient-controlled family communication over live Anima synthetic clinical data.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f2f4f1',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${instrument.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full paper-grain">
        <AppProvider>
          <Shell>{children}</Shell>
        </AppProvider>
      </body>
    </html>
  );
}
