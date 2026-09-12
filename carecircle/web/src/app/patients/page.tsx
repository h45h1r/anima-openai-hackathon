'use client';

import { RequireConnection } from '@/components/Guards';
import PatientsPage from '@/screens/PatientsPage';

export default function Page() {
  return (
    <RequireConnection>
      <PatientsPage />
    </RequireConnection>
  );
}
