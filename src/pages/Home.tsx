import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { activities } from '@/activities/registry';
import type { ActivityDefinition } from '@/activities/types';
import { AppShell } from '@/components/AppShell';
import './home.css';

function ActivityCard({ activity }: { activity: ActivityDefinition }) {
  const Icon = activity.icon;
  const available = activity.status === 'available';
  const summary = activity.summary?.() ?? null;
  const style = { '--card-accent': activity.accent } as React.CSSProperties;
  const body = (
    <>
      <div className="activity-card__top">
        <div className="activity-card__icon">
          <Icon size={24} />
        </div>
        <span className={`activity-card__status ${available ? 'is-available' : ''}`}>
          {available ? 'Ready' : 'Coming soon'}
        </span>
      </div>
      <div>
        <h3 className="activity-card__title">{activity.title}</h3>
        <p className="activity-card__tagline">{activity.tagline}</p>
      </div>
      <div className="activity-card__footer">
        <span>{summary ?? (available ? 'No runs yet' : 'In development')}</span>
        {available && (
          <span className="activity-card__cta">
            Open <ArrowRight size={14} />
          </span>
        )}
      </div>
    </>
  );

  if (!available) {
    return (
      <div className="activity-card activity-card--soon" style={style} aria-disabled="true">
        {body}
      </div>
    );
  }
  return (
    <Link to={`/activity/${activity.id}`} className="activity-card activity-card--available" style={style}>
      {body}
    </Link>
  );
}

export default function Home() {
  return (
    <AppShell>
      <div className="home">
        <section className="home__hero">
          <span className="home__eyebrow">Training studio</span>
          <h1 className="home__title">
            Sharpen your <span>chess</span>.
          </h1>
          <p className="home__subtitle">
            Pick an activity. Reflex drills today; master games, engine analysis and more as the
            studio grows.
          </p>
        </section>
        <h2 className="home__section-title">Activities</h2>
        <div className="activity-grid">
          {activities.map((a) => (
            <ActivityCard key={a.id} activity={a} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
