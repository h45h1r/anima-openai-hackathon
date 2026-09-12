'use client';

import { RequireConnection, RequirePatient } from '@/components/Guards';
import HomePage from '@/screens/HomePage';

export default function Page() {
  return (
    <RequireConnection>
      <RequirePatient>
        <HomePage />
      </RequirePatient>
    </RequireConnection>
  );
}
