'use client';

import { RequireConnection, RequirePatient } from '@/components/Guards';
import AskPage from '@/screens/AskPage';

export default function Page() {
  return (
    <RequireConnection>
      <RequirePatient>
        <AskPage />
      </RequirePatient>
    </RequireConnection>
  );
}
