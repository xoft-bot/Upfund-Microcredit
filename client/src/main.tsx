import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main className="shell">
      <section className="card" aria-labelledby="title">
        <p className="eyebrow">STAGE 1 · SYSTEM FOUNDATION</p>
        <h1 id="title">Letsgrow Microcredit</h1>
        <p className="lede">A secure financial operating system begins with an authenticated command, an authorized API, and a traceable PostgreSQL transaction.</p>
        <div className="status" role="status">
          <span className="dot" aria-hidden="true" />
          <span>Implementation skeleton initialized</span>
        </div>
        <p className="note">Feature screens and payment integrations remain intentionally disabled until the ledger and security evidence gates pass.</p>
        <footer className="footer">System version 1.0.01</footer>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
