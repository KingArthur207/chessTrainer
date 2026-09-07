import { Cpu, TriangleAlert } from 'lucide-react';
import type { EngineStatus as Status } from '@/engine/useEngineStatus';

export function EngineStatus({ status }: { status: Status }) {
  if (status.state === 'ready') {
    return (
      <div className="engine-status is-ready" data-state="ready">
        <Cpu size={16} /> {status.name} ready
      </div>
    );
  }
  if (status.state === 'missing') {
    return (
      <div className="engine-status is-missing" data-state="missing">
        <TriangleAlert size={16} /> {status.message}
      </div>
    );
  }
  return (
    <div className="engine-status is-starting" data-state="starting">
      <Cpu size={16} /> Starting the engine…
    </div>
  );
}
