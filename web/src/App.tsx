import { detectLanguage, tr } from './game/i18n';
import { useEffect, useState } from 'react';
import { useGame } from './game/useGame';
import { End } from './screens/End';
import { Play } from './screens/Play';
import { Start } from './screens/Start';
import { Shared } from './screens/Shared';
import { About } from './screens/About';

/** /r/<id> is a shared review; everything else is the game. */
function sharedId(): string | null {
  return /^\/r\/([A-Za-z0-9]{10})\/?$/.exec(window.location.pathname)?.[1] ?? null;
}

export function App() {
  useEffect(() => { document.documentElement.lang = detectLanguage(); }, []);
  const shared = sharedId();
  if (shared) return <Shared id={shared} />;
  if (/^\/about\/?$/.test(window.location.pathname)) return <About />;
  return <Game />;
}

function Game() {
  const game = useGame();
  const { view, resume, start, leave } = game;
  const [ended, setEnded] = useState(false);
  const [resuming, setResuming] = useState(() => new URLSearchParams(window.location.search).has('s'));

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('s');
    if (!id) return;
    resume(id)
      .catch(() => leave())
      .finally(() => setResuming(false));
  }, [resume, leave]);

  useEffect(() => {
    if (view?.status !== 'finished') setEnded(false);
  }, [view?.status, view?.id]);

  if (resuming) return <div className="loading">{tr("Finding your desk…")}</div>;
  if (!view) return <Start onStart={start} />;
  if (ended && view.status === 'finished')
    return (
      <End
        view={view}
        onAgain={() => {
          setEnded(false);
          leave();
        }}
      />
    );
  return <Play game={game} view={view} onFinish={() => setEnded(true)} />;
}
