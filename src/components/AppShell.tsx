import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Maximize2, Minimize2 } from 'lucide-react';
import { isFullscreen, isMacElectron, onFullscreenChange, toggleFullscreen } from '@/lib/platform';
import './app-shell.css';

interface AppShellProps {
  title?: string;
  backTo?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function AppShell({ title, backTo, actions, children }: AppShellProps) {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let mounted = true;
    void isFullscreen().then((v) => mounted && setFullscreen(v));
    const unsub = onFullscreenChange(setFullscreen);
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('has-mac-titlebar', isMacElectron && !fullscreen);
  }, [fullscreen]);

  return (
    <div className="shell">
      <header className="shell__header">
        {backTo && (
          <Link to={backTo} className="btn btn--icon" title="Back">
            <ChevronLeft size={20} />
          </Link>
        )}
        <Link to="/" className="shell__brand">
          <span className="shell__logo">♞</span>
          <span>Chess Trainer</span>
        </Link>
        {title && (
          <>
            <span className="shell__divider" />
            <span className="shell__title">{title}</span>
          </>
        )}
        <div className="shell__actions">
          {actions}
          <button
            className="btn btn--icon"
            onClick={() => void toggleFullscreen()}
            title={fullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </header>
      <main className="shell__content">{children}</main>
    </div>
  );
}
