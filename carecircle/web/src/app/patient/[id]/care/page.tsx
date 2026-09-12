'use client';

import { RequireConnection, RequirePatient } from '@/components/Guards';
import CarePage from '@/screens/CarePage';

export default function Page() {
  return (
    <RequireConnection>
      <RequirePatient>
        <CarePage />
      </RequirePatient>
    </RequireConnection>
  );
}
