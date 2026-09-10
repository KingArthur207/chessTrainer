import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { activities } from '@/activities/registry';
import type { ActivityCategory, ActivityDefinition } from '@/activities/types';
import { AppShell } from '@/components/AppShell';
import './home.css';

const ORDER: ActivityCategory[] = ['Vision and reflexes', 'Openings', 'Calculation and memory', 'Judgement', 'Technique and study'];

function ActivityCard({ activity }: { activity: ActivityDefinition }) {
  const Icon = activity.icon;
  const available = activity.status === 'available';
  const summary = activity.summary?.() ?? null;
  const body = (
    <>
      <div className="activity-card__icon">
        <Icon size={20} strokeWidth={1.75} />
      </div>
      <div className="activity-card__body">
        <h3 className="activity-card__title">{activity.title}</h3>
        <p className="activity-card__tagline">{activity.tagline}</p>
        <div className="activity-card__footer">
          <span>{summary ?? (available ? 'Not started' : 'In development')}</span>
        </div>
      </div>
      {available && <ChevronRight className="activity-card__chevron" size={18} />}
    </>
  );
  if (!available) {
    return (
      <div className="activity-card activity-card--soon" aria-disabled="true">
        {body}
      </div>
    );
  }
  return (
    <Link to={`/activity/${activity.id}`} className="activity-card activity-card--available">
      {body}
    </Link>
  );
}

export default function Home() {
  return (
    <AppShell>
      <div className="home">
        <header className="home__hero">
          <h1 className="home__title">Chess Trainer</h1>
          <p className="home__subtitle">Deliberate practice for every part of the game, with Stockfish as the referee.</p>
        </header>
        <div className="home__sections">
          {ORDER.map((category) => {
            const items = activities.filter((a) => a.category === category);
            if (items.length === 0) return null;
            return (
              <section key={category} className="home__section">
                <h2 className="home__section-title">{category}</h2>
                <div className="activity-grid">
                  {items.map((a) => (
                    <ActivityCard key={a.id} activity={a} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
