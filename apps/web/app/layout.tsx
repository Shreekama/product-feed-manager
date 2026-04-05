import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { Sidebar } from '../components/layout/Sidebar';

export const metadata: Metadata = {
  title: 'Product Feed Manager',
  description: 'Manage and export Shopify product feeds',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Favicon: purple S (Shreekama brand) */}
        <link
          rel="icon"
          type="image/svg+xml"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23631664'/><text x='16' y='24' text-anchor='middle' font-family='Georgia,serif' font-size='22' font-weight='600' fill='%23C9A84C'>S</text></svg>"
        />
        {/* Fonts for login screen */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap"
          rel="stylesheet"
        />
        {/* Keyframe for login card fade-up animation */}
        <style>{`
          @keyframes pfm-fadeUp {
            from { opacity: 0; transform: translateY(16px); }
            to   { opacity: 1; transform: none; }
          }
        `}</style>
      </head>
      <body className="bg-gray-50 text-gray-900 antialiased">
        <Providers>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
