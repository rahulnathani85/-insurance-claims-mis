import './globals.css';
import { CompanyProvider } from '@/lib/CompanyContext';
import { AuthProvider } from '@/lib/AuthContext';

export const metadata = {
  title: 'Insurance Claims MIS',
  description: 'Insurance Claims Management Information System',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <CompanyProvider>
            {children}
          </CompanyProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
