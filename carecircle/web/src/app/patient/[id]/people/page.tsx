'use client';

import { RequireConnection, RequirePatient } from '@/components/Guards';
import PeoplePage from '@/screens/PeoplePage';

export default function Page() {
  return (
    <RequireConnection>
      <RequirePatient>
        <PeoplePage />
      </RequirePatient>
    </RequireConnection>
  );
}
