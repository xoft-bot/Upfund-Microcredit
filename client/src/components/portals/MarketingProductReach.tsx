import { useEffect, useState } from 'react';
import type { AuthIdentity } from '../../services/firebase.js';
import { getPortalOverview, type PortalOverview } from '../../services/api.js';
import { getFirebaseIdToken } from '../../services/firebase.js';

interface MarketingProductReachProps { identity: AuthIdentity; }

export function MarketingProductReach({ identity }: MarketingProductReachProps) {
  const [overview, setOverview] = useState<PortalOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await getFirebaseIdToken();
        if (!token) throw new Error('AUTH_TOKEN_UNAVAILABLE');
        const result = await getPortalOverview(token);
        if (active) setOverview(result);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'PORTAL_LOAD_FAILED');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [identity.uid]);

  if (loading) return <section className="portal-loading" role="status">Loading product reach…</section>;
  if (error) return <section className="portal-card"><p className="form-error" role="alert">{error}</p></section>;
  if (!overview) return null;

  return <div className="portal-grid">
    <section className="portal-card">
      <p className="eyebrow">Demand signal</p>
      <h3>{overview.metrics.submittedApplications} applications in review</h3>
      <p className="note">Marketing sees aggregate demand and active product availability only.</p>
    </section>
    <section className="portal-card">
      <p className="eyebrow">Live products</p>
      <div className="product-list">{overview.products.map((product) => <div className="product-row" key={product.id}><strong>{product.name}</strong><span>{product.code} · {product.currency}</span></div>)}</div>
    </section>
  </div>;
}
