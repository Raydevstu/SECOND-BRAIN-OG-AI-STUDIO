import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'CORTEX Harness',
  description:
    'Unified AI Operating System shell combining multi-provider chat, agent runtime, Second Brain vault, LLM Wiki, knowledge graph, and workflow automation.',
  openGraph: {
    title: 'CORTEX Harness',
    description:
      'Unified AI Operating System shell combining multi-provider chat, agent runtime, Second Brain vault, LLM Wiki, knowledge graph, and workflow automation.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CORTEX Harness',
    description:
      'Unified AI Operating System shell combining multi-provider chat, agent runtime, Second Brain vault, LLM Wiki, knowledge graph, and workflow automation.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body
        className="bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 antialiased selection:bg-indigo-500/20"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
