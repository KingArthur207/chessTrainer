import { Suspense } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { getActivity } from '@/activities/registry';
import { AppShell } from '@/components/AppShell';

export default function ActivityPage() {
  const { id } = useParams();
  const activity = getActivity(id);
  if (!activity || activity.status !== 'available' || !activity.component) {
    return <Navigate to="/" replace />;
  }
  const Component = activity.component;
  return (
    <AppShell title={activity.title} backTo="/">
      <Suspense fallback={<div className="loading">Loading…</div>}>
        <Component />
      </Suspense>
    </AppShell>
  );
}
