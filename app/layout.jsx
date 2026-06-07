import { Inter, Playfair_Display } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair' });

export const metadata = {
  title: 'Beyond Labels',
  description: "Know what's really in your food",
  manifest: '/manifest.json',
  // themeColor is handled via the viewport export below (Next.js 14 App Router)
  icons: {
    apple: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
};

// Next.js 14 App Router: theme-color must be declared here, not in metadata
export const viewport = {
  themeColor: '#D4872A',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${playfair.variable}`}>
        {children}
      </body>
    </html>
  );
}
