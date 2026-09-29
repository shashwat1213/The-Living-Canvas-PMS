import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { ApiError } from '../../lib/api';
import type { PageMeta } from '../../lib/pagination';
import { getProperty } from '../properties/api';
import type { Property } from '../properties/types';
import { listContent } from './api';
import { ContentDialog } from './ContentDialog';
import { GenerateDialog } from './GenerateDialog';
import { canApproveMarketing, canManageMarketing, canReadMarketing } from './permissions';
import {
  FORMAT_LABEL,
  MARKETING_FORMATS,
  MARKETING_STATUSES,
  STATUS_LABEL,
  STATUS_TONE,
  type MarketingContent,
} from './types';
import './marketing.css';

export function MarketingPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { session } = useAuth();

  const mayRead = canReadMarketing(session);
  const mayManage = canManageMarketing(session);
  const mayApprove = canApproveMarketing(session);

  const [property, setProperty] = useState<Property | null>(null);
  const [items, setItems] = useState<MarketingContent[] | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [formatFilter, setFormatFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);

  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState<MarketingContent | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    getProperty(propertyId)
      .then((res) => setProperty(res))
      .catch(() => setProperty(null));
  }, [propertyId]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setRefreshing(true);
    try {
      const result = await listContent(propertyId, {
        search: appliedSearch || undefined,
        format: formatFilter === 'ALL' ? undefined : formatFilter,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        page,
      });
      setItems(result.content);
      setPageMeta(result.page);
      setError(null);
    } catch (err) {
      setItems([]);
      setPageMeta(null);
      setError(err instanceof ApiError ? err.message : 'Could not load marketing content.');
    } finally {
      setRefreshing(false);
    }
  }, [propertyId, appliedSearch, formatFilter, statusFilter, page]);

  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [appliedSearch, formatFilter, statusFilter]);

  useEffect(() => {
    if (!mayRead) return;
    void load();
  }, [mayRead, load]);

  // Auto-refresh while any piece is still generating, so a DRAFT appears
  // without the user reloading. Polls the list every 2.5s until nothing is
  // GENERATING, then stops. Also keeps an open dialog's copy in sync.
  const anyGenerating = (items ?? []).some((c) => c.status === 'GENERATING');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!anyGenerating) return;
    pollRef.current = setInterval(() => void load(), 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [anyGenerating, load]);

  if (!mayRead) {
    return (
      <section className="marketing-page">
        <h1>Marketing Studio</h1>
        <p className="empty-state">
          You don&apos;t have access to the marketing studio. A manager or admin in your organization can grant it.
        </p>
      </section>
    );
  }

  const columns: Column<MarketingContent>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (c) => <span className="marketing-title">{c.title || <em>Untitled</em>}</span>,
    },
    {
      key: 'format',
      header: 'Format',
      render: (c) => <span className="marketing-format">{FORMAT_LABEL[c.format]}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => (
        <span className="marketing-status-cell">
          <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
          {c.isEdited && <span className="marketing-edited-tag">edited</span>}
        </span>
      ),
    },
    {
      key: 'brief',
      header: 'Brief',
      secondary: true,
      render: (c) => <span className="marketing-brief-cell">{c.brief}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Open</span>,
      align: 'end',
      render: (c) => (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(c)}>
          Open
        </button>
      ),
    },
  ];

  const filtersActive = formatFilter !== 'ALL' || statusFilter !== 'ALL' || appliedSearch !== '';

  function clearFilters() {
    setSearch('');
    setFormatFilter('ALL');
    setStatusFilter('ALL');
  }

  const propertyName = property?.name ?? 'this property';

  return (
    <section className="marketing-page">
      <header className="marketing-header">
        <div>
          <p className="marketing-breadcrumb">
            <Link to="/app/properties">Properties</Link> / {propertyName}
          </p>
          <h1>Marketing Studio</h1>
          <p className="marketing-subtitle">
            AI-drafted marketing copy for {propertyName} — generate, review, edit and approve.
          </p>
        </div>
        {mayManage && (
          <button type="button" className="btn btn-primary" onClick={() => setGenerating(true)}>
            Generate content
          </button>
        )}
      </header>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      <div className="marketing-filters">
        <div className="field marketing-search">
          <label htmlFor="mk-search">Search</label>
          <input
            id="mk-search"
            type="search"
            placeholder="Brief, title or body…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="mk-format">Format</label>
          <select id="mk-format" value={formatFilter} onChange={(e) => setFormatFilter(e.target.value)}>
            <option value="ALL">All formats</option>
            {MARKETING_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABEL[f]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="mk-status">Status</label>
          <select id="mk-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">All statuses</option>
            {MARKETING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        {filtersActive && (
          <button type="button" className="btn btn-ghost btn-sm marketing-reset" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(c) => c.id}
        caption={`Marketing content for ${propertyName}`}
        loadingLabel="Loading content…"
        emptyState={
          filtersActive ? (
            <>
              <p>No content matches those filters.</p>
              <button type="button" className="btn btn-ghost btn-sm marketing-reset" onClick={clearFilters}>
                Clear filters
              </button>
            </>
          ) : (
            <p>
              No marketing content yet.{' '}
              {mayManage ? 'Generate your first piece to get started.' : 'A manager can generate content here.'}
            </p>
          )
        }
      />

      {pageMeta && (
        <Pagination
          page={pageMeta}
          onPageChange={setPage}
          itemLabel="pieces"
          itemLabelSingular="piece"
          busy={refreshing}
        />
      )}

      {generating && propertyId && (
        <GenerateDialog
          propertyId={propertyId}
          onClose={() => setGenerating(false)}
          onGenerated={(content) => {
            setGenerating(false);
            void load();
            setSelected(content);
          }}
        />
      )}

      {selected && propertyId && (
        <ContentDialog
          propertyId={propertyId}
          content={selected}
          canManage={mayManage}
          canApprove={mayApprove}
          onClose={() => setSelected(null)}
          onChanged={() => void load()}
        />
      )}
    </section>
  );
}
