import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Eklavya Council',
  description: 'Multi-persona LLM debate engine for decisions, architecture, and mentoring',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 min-h-screen font-mono antialiased">
        {children}
      </body>
    </html>
  );
}
