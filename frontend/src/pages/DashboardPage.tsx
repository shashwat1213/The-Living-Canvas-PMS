import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError, apiFetch } from '../lib/api';
import './dashboard.css';

interface Organization {
  id: string;
  name: string;
}

interface Property {
  id: string;
}

export function DashboardPage() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [propertyCount, setPropertyCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<{ organization: Organization }>('/api/v1/organizations/me'),
      apiFetch<{ properties: Property[] }>('/api/v1/properties'),
    ])
      .then(([orgRes, propertiesRes]) => {
        setOrganization(orgRes.organization);
        setPropertyCount(propertiesRes.properties.length);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Could not load your dashboard.');
      });
  }, []);

  if (error) {
    return (
      <p className="page-error" role="alert">
        {error}
      </p>
    );
  }

  if (organization === null || propertyCount === null) {
    return (
      <p className="page-loading" role="status">
        Loading…
      </p>
    );
  }

  return (
    <section className="dashboard">
      <h1>Welcome, {organization.name}</h1>

      <div className="dashboard-cards">
        <Link to="/app/properties" className="dashboard-card">
          <span className="dashboard-card-value">{propertyCount}</span>
          <span className="dashboard-card-label">{propertyCount === 1 ? 'Property' : 'Properties'}</span>
        </Link>
      </div>

      {/* Honest placeholder for what this phase doesn't build yet — no
          fabricated occupancy/revenue numbers, just a clear note and a
          link to what's actually implemented. */}
      <p className="dashboard-note">
        Occupancy, revenue, and booking activity will appear here once those
        modules ship. For now, head to <Link to="/app/properties">Properties</Link> to
        manage your rooms.
      </p>
    </section>
  );
}
