import './globals.css';
import { CompanyProvider } from '@/lib/CompanyContext';

export const metadata = {
  title: 'Insurance Claims MIS',
  description: 'Insurance Claims Management Information System',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <CompanyProvider>
          {children}
        </CompanyProvider>
      </body>
    </html>
  );
}
