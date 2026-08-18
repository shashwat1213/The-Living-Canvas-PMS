import { useEffect, useState } from 'react';
import './App.css';

type ApiStatus = 'checking' | 'online' | 'offline';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_URL}/health`)
      .then((res) => (res.ok ? setApiStatus('online') : setApiStatus('offline')))
      .catch(() => {
        if (!cancelled) setApiStatus('offline');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <h1>The Living Canvas PMS</h1>
      <p className="tagline">Multi-property hospitality management platform</p>
      <p className="api-status" data-status={apiStatus}>
        API: {apiStatus}
      </p>
    </main>
  );
}

export default App;
