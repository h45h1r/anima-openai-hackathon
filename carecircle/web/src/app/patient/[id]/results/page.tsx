'use client';

import { RequireConnection, RequirePatient } from '@/components/Guards';
import ResultsPage from '@/screens/ResultsPage';

export default function Page() {
  return (
    <RequireConnection>
      <RequirePatient>
        <ResultsPage />
      </RequirePatient>
    </RequireConnection>
  );
}
