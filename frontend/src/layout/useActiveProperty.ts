import { useCallback, useEffect, useState } from 'react';
import { matchPath, useLocation } from 'react-router-dom';

import { listProperties } from '../features/properties/api';
import type { Property } from '../features/properties/types';

const STORAGE_KEY = 'lc.activePropertyId';

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage unavailable (private mode) — selection just won't persist */
  }
}

/**
 * The property the sidebar's "Hotel" section and the AI assistant act on.
 *
 * Resolution order: the `:propertyId` in the current URL (the user is already
 * inside a property screen) → the last property they worked in (persisted) →
 * the first property they can see. Purely a navigation convenience — every
 * property route and API still enforces its own property-access check.
 */
export function useActiveProperty(enabled: boolean) {
  const location = useLocation();
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => readStored());

  const urlId = matchPath('/app/properties/:propertyId/*', location.pathname)?.params.propertyId ?? null;
  const inPropertiesArea = location.pathname.startsWith('/app/properties');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    listProperties({ pageSize: 50 })
      .then((res) => {
        if (!cancelled) setProperties(res.properties ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Re-fetch when leaving/entering the properties area so a newly created
    // property shows up in the switcher.
  }, [enabled, inPropertiesArea]);

  // Remember whichever property the user navigated into.
  useEffect(() => {
    if (urlId && urlId !== selectedId) {
      setSelectedId(urlId);
      writeStored(urlId);
    }
  }, [urlId, selectedId]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    writeStored(id);
  }, []);

  const known = (id: string | null) => !!id && properties.some((p) => p.id === id);
  const activeId = urlId ?? (known(selectedId) ? selectedId : (properties[0]?.id ?? null));
  const active = properties.find((p) => p.id === activeId) ?? null;

  return { properties, activeId, active, select };
}
