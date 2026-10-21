import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';

import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
import { Pagination } from '../../components/Pagination';
import { ApiError } from '../../lib/api';
import type { PageMeta } from '../../lib/pagination';
import {
  ACCEPTED_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  deleteMedia,
  formatBytes,
  getDownloadUrl,
  listAlbums,
  listMedia,
  updateMedia,
  uploadMedia,
  type MediaAsset,
} from './media-api';

interface UploadJob {
  key: string;
  name: string;
  progress: number;
  error?: string;
  done?: boolean;
}

const parseTags = (s: string) =>
  s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);

/**
 * Marketing Studio media library: event / campaign photos and videos for a
 * property, grouped into albums. Files upload straight to object storage.
 */
export function MediaLibrary({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
  const [items, setItems] = useState<MediaAsset[] | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta | null>(null);
  const [albums, setAlbums] = useState<{ album: string; count: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [album, setAlbum] = useState<string>('');
  const [kind, setKind] = useState<'' | 'IMAGE' | 'VIDEO'>('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [uploadAlbum, setUploadAlbum] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [res, al] = await Promise.all([
        listMedia(propertyId, {
          page,
          pageSize: 24,
          album: album || undefined,
          kind: kind || undefined,
          search: appliedSearch || undefined,
        }),
        listAlbums(propertyId),
      ]);
      setItems(res.media);
      setPageMeta(res.page);
      setAlbums(al.albums);
      setError(null);
    } catch (err) {
      setItems([]);
      setError(err instanceof ApiError ? err.message : 'Could not load the media library.');
    }
  }, [propertyId, page, album, kind, appliedSearch]);

  useEffect(() => {
    const t = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [album, kind, appliedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function startUploads(files: FileList | File[]) {
    const list = Array.from(files);
    const meta = {
      album: uploadAlbum.trim() || album || undefined,
      tags: parseTags(uploadTags),
    };
    for (const file of list) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      const isVideo = file.type.startsWith('video/');
      let precheck: string | undefined;
      if (!ACCEPTED_TYPES.includes(file.type)) precheck = 'Unsupported file type.';
      else if (file.size > (isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES))
        precheck = `Too large (max ${isVideo ? '500' : '25'} MB).`;
      setJobs((j) => [...j, { key, name: file.name, progress: 0, error: precheck }]);
      if (precheck) continue;
      try {
        await uploadMedia(propertyId, file, meta, (p) =>
          setJobs((j) => j.map((x) => (x.key === key ? { ...x, progress: p } : x))),
        );
        setJobs((j) => j.map((x) => (x.key === key ? { ...x, progress: 1, done: true } : x)));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed.';
        setJobs((j) => j.map((x) => (x.key === key ? { ...x, error: message } : x)));
      }
    }
    void load();
    setTimeout(() => setJobs((j) => j.filter((x) => !x.done)), 2500);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (canManage && e.dataTransfer.files.length) void startUploads(e.dataTransfer.files);
  }

  return (
    <div className="media-library">
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {canManage && (
        <div
          className={`media-dropzone ${dragging ? 'media-dropzone-active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="media-dropzone-text">
            <strong>Drop event photos or videos here</strong>
            <span>JPG, PNG, WebP, GIF, AVIF up to 25 MB · MP4, WebM, MOV up to 500 MB</span>
          </div>
          <div className="media-upload-fields">
            <div className="field">
              <label htmlFor="media-up-album">Album / event</label>
              <input
                id="media-up-album"
                list="media-album-list"
                placeholder={album || 'e.g. Diwali 2026'}
                value={uploadAlbum}
                maxLength={80}
                onChange={(e) => setUploadAlbum(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="media-up-tags">Tags</label>
              <input
                id="media-up-tags"
                placeholder="lobby, festive"
                value={uploadTags}
                onChange={(e) => setUploadTags(e.target.value)}
              />
            </div>
            <button type="button" className="btn btn-primary" onClick={() => fileInput.current?.click()}>
              Choose files
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept={ACCEPTED_TYPES.join(',')}
              aria-label="Upload media files"
              onChange={(e) => {
                if (e.target.files?.length) void startUploads(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          {jobs.length > 0 && (
            <ul className="media-jobs" aria-live="polite">
              {jobs.map((j) => (
                <li key={j.key} className={j.error ? 'media-job-error' : ''}>
                  <span className="media-job-name">{j.name}</span>
                  {j.error ? (
                    <span>{j.error}</span>
                  ) : (
                    <progress max={1} value={j.progress} aria-label={`Uploading ${j.name}`} />
                  )}
                  {j.error && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setJobs((x) => x.filter((y) => y.key !== j.key))}
                    >
                      Dismiss
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <datalist id="media-album-list">
        {albums.map((a) => (
          <option key={a.album} value={a.album} />
        ))}
      </datalist>

      <div className="media-toolbar">
        <div className="media-albums" role="tablist" aria-label="Albums">
          <button
            type="button"
            role="tab"
            aria-selected={album === ''}
            className={`media-chip ${album === '' ? 'media-chip-active' : ''}`}
            onClick={() => setAlbum('')}
          >
            All media
          </button>
          {albums.map((a) => (
            <button
              key={a.album}
              type="button"
              role="tab"
              aria-selected={album === a.album}
              className={`media-chip ${album === a.album ? 'media-chip-active' : ''}`}
              onClick={() => setAlbum(a.album)}
            >
              {a.album} <span className="media-chip-count">{a.count}</span>
            </button>
          ))}
        </div>
        <div className="media-filters">
          <div className="field">
            <label htmlFor="media-search">Search</label>
            <input
              id="media-search"
              type="search"
              placeholder="Title, file, tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="media-kind">Type</label>
            <select id="media-kind" value={kind} onChange={(e) => setKind(e.target.value as '' | 'IMAGE' | 'VIDEO')}>
              <option value="">Photos &amp; videos</option>
              <option value="IMAGE">Photos</option>
              <option value="VIDEO">Videos</option>
            </select>
          </div>
        </div>
      </div>

      {items === null ? (
        <p className="media-empty">Loading media…</p>
      ) : items.length === 0 ? (
        <div className="media-empty">
          <p>
            {album || appliedSearch || kind
              ? 'Nothing matches those filters.'
              : canManage
                ? 'No media yet — upload your first event photos above.'
                : 'No media yet. A manager can upload photos and videos here.'}
          </p>
        </div>
      ) : (
        <ul className="media-grid">
          {items.map((m) => (
            <li key={m.id}>
              <button type="button" className="media-tile" onClick={() => setSelected(m)}>
                {m.kind === 'IMAGE' && m.url ? (
                  <img src={m.url} alt={m.title ?? m.fileName} loading="lazy" />
                ) : m.url ? (
                  <video src={m.url} muted preload="metadata" />
                ) : (
                  <span className="media-tile-placeholder">Processing…</span>
                )}
                {m.kind === 'VIDEO' && <span className="media-tile-badge">Video</span>}
                <span className="media-tile-caption">
                  <span className="media-tile-title">{m.title || m.fileName}</span>
                  {m.album && <span className="media-tile-album">{m.album}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {pageMeta && pageMeta.totalPages > 1 && (
        <Pagination page={pageMeta} onPageChange={setPage} itemLabel="files" itemLabelSingular="file" />
      )}

      {selected && (
        <MediaDialog
          propertyId={propertyId}
          asset={selected}
          canManage={canManage}
          albums={albums.map((a) => a.album)}
          onClose={() => setSelected(null)}
          onChanged={(next) => {
            if (next) setSelected(next);
            else setSelected(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function MediaDialog({
  propertyId,
  asset,
  canManage,
  albums,
  onClose,
  onChanged,
}: {
  propertyId: string;
  asset: MediaAsset;
  canManage: boolean;
  albums: string[];
  onClose: () => void;
  onChanged: (next: MediaAsset | null) => void;
}) {
  const [title, setTitle] = useState(asset.title ?? '');
  const [description, setDescription] = useState(asset.description ?? '');
  const [album, setAlbum] = useState(asset.album ?? '');
  const [tags, setTags] = useState(asset.tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await updateMedia(propertyId, asset.id, {
        title: title.trim() || null,
        description: description.trim() || null,
        album: album.trim() || null,
        tags: parseTags(tags),
      });
      onChanged(res.media);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes.');
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    try {
      const { url } = await getDownloadUrl(propertyId, asset.id);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the download.');
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteMedia(propertyId, asset.id);
      onChanged(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this file.');
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  const facts = [
    asset.kind === 'VIDEO' ? 'Video' : 'Photo',
    formatBytes(asset.sizeBytes),
    asset.width && asset.height ? `${asset.width}×${asset.height}` : null,
    asset.durationMs ? `${Math.round(asset.durationMs / 1000)}s` : null,
    asset.createdBy ? `by ${asset.createdBy.firstName} ${asset.createdBy.lastName}` : null,
    new Date(asset.createdAt).toLocaleDateString(),
  ].filter(Boolean);

  return (
    <>
      <Modal
        title={asset.title || asset.fileName}
        description={facts.join(' · ')}
        onClose={onClose}
        size="wide"
        footer={
          <>
            {canManage && (
              <button
                type="button"
                className="btn btn-ghost media-delete"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                Delete
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => void download()}>
              Download
            </button>
            {canManage && (
              <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            )}
          </>
        }
      >
        <div className="media-detail">
          <div className="media-preview">
            {asset.kind === 'IMAGE' && asset.url ? (
              <img src={asset.url} alt={asset.title ?? asset.fileName} />
            ) : asset.url ? (
              <video src={asset.url} controls />
            ) : null}
          </div>
          {error && (
            <p className="page-error" role="alert">
              {error}
            </p>
          )}
          {canManage ? (
            <div className="media-detail-fields">
              <div className="field">
                <label htmlFor="md-title">Title</label>
                <input id="md-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="md-album">Album / event</label>
                <input
                  id="md-album"
                  list="md-album-list"
                  value={album}
                  maxLength={80}
                  onChange={(e) => setAlbum(e.target.value)}
                />
                <datalist id="md-album-list">
                  {albums.map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label htmlFor="md-tags">Tags (comma separated)</label>
                <input id="md-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="md-desc">Notes</label>
                <textarea
                  id="md-desc"
                  rows={3}
                  maxLength={1000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="media-detail-fields">
              {asset.album && <p>Album: {asset.album}</p>}
              {asset.tags.length > 0 && <p>Tags: {asset.tags.join(', ')}</p>}
              {asset.description && <p>{asset.description}</p>}
            </div>
          )}
        </div>
      </Modal>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this file?"
          message="It will be removed from the library and from storage. This cannot be undone."
          confirmLabel="Delete"
          destructive
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
