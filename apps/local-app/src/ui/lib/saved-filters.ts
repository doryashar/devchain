/**
 * LocalStorage CRUD utilities for saved board filters.
 *
 * Storage key pattern: devchain:board:savedFilters:${projectId}
 */

import { parseBoardFilters, serializeBoardFilters } from './url-filters';

export interface SavedFilter {
  id: string; // UUID
  name: string; // User-defined, unique per project
  qs: string; // Canonical query string from serializeBoardFilters()
}

const STORAGE_KEY_PREFIX = 'devchain:board:savedFilters';
const DEFAULT_KEY_PREFIX = 'devchain:board:defaultFilterId';

/**
 * Get the localStorage key for a project's saved filters.
 */
function getStorageKey(projectId: string): string {
  return `${STORAGE_KEY_PREFIX}:${projectId}`;
}

function getDefaultStorageKey(projectId: string): string {
  return `${DEFAULT_KEY_PREFIX}:${projectId}`;
}

/**
 * Get all saved filters for a project.
 * Returns empty array if no filters exist or on parse error.
 */
export function getSavedFilters(projectId: string): SavedFilter[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const key = getStorageKey(projectId);
    const stored = window.localStorage.getItem(key);
    if (!stored) {
      return [];
    }
    const parsed = JSON.parse(stored);
    // Validate array structure
    if (!Array.isArray(parsed)) {
      console.warn('Invalid saved filters data: expected array');
      return [];
    }
    // Basic validation of each item
    return parsed.filter(
      (item): item is SavedFilter =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.qs === 'string',
    );
  } catch (error) {
    console.error('Failed to load saved filters', error);
    return [];
  }
}

/**
 * Save filters to localStorage.
 */
function persistFilters(projectId: string, filters: SavedFilter[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const key = getStorageKey(projectId);
    window.localStorage.setItem(key, JSON.stringify(filters));
  } catch (error) {
    console.error('Failed to save filters', error);
  }
}

/**
 * Check if a filter name already exists for a project (case-insensitive).
 */
export function filterNameExists(projectId: string, name: string): boolean {
  const filters = getSavedFilters(projectId);
  const normalizedName = name.trim().toLowerCase();
  return filters.some((f) => f.name.trim().toLowerCase() === normalizedName);
}

/**
 * Generate a UUID-v4-format string for client-side filter IDs.
 * Cascades to handle non-secure-context browsers where crypto.randomUUID()
 * is unavailable (e.g. LAN HTTP access).
 */
function generateClientId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Save a new filter. Validates unique name.
 * @throws Error if name already exists
 */
export function saveFilter(projectId: string, name: string, qs: string): SavedFilter {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Filter name cannot be empty');
  }

  if (filterNameExists(projectId, trimmedName)) {
    throw new Error(`A filter named "${trimmedName}" already exists`);
  }

  const filters = getSavedFilters(projectId);
  const newFilter: SavedFilter = {
    id: generateClientId(),
    name: trimmedName,
    qs,
  };

  filters.push(newFilter);
  persistFilters(projectId, filters);

  return newFilter;
}

/**
 * Rename an existing filter.
 * @throws Error if filter not found or new name already exists
 */
export function renameFilter(projectId: string, filterId: string, newName: string): void {
  const trimmedName = newName.trim();
  if (!trimmedName) {
    throw new Error('Filter name cannot be empty');
  }

  const filters = getSavedFilters(projectId);
  const filterIndex = filters.findIndex((f) => f.id === filterId);

  if (filterIndex === -1) {
    throw new Error('Filter not found');
  }

  // Check if new name conflicts with another filter (not the same one)
  const normalizedNewName = trimmedName.toLowerCase();
  const conflict = filters.some(
    (f, idx) => idx !== filterIndex && f.name.trim().toLowerCase() === normalizedNewName,
  );

  if (conflict) {
    throw new Error(`A filter named "${trimmedName}" already exists`);
  }

  filters[filterIndex] = { ...filters[filterIndex], name: trimmedName };
  persistFilters(projectId, filters);
}

/**
 * Delete a filter by ID.
 * No-op if filter not found.
 * Clears the default pointer if the deleted filter was the default.
 */
export function deleteFilter(projectId: string, filterId: string): void {
  const filters = getSavedFilters(projectId);
  const newFilters = filters.filter((f) => f.id !== filterId);

  if (newFilters.length !== filters.length) {
    persistFilters(projectId, newFilters);
  }

  if (getDefaultFilterId(projectId) === filterId) {
    clearDefaultFilterId(projectId);
  }
}

/**
 * Update a filter's query string.
 * @throws Error if filter not found
 */
export function updateFilterQuery(projectId: string, filterId: string, qs: string): void {
  const filters = getSavedFilters(projectId);
  const filterIndex = filters.findIndex((f) => f.id === filterId);

  if (filterIndex === -1) {
    throw new Error('Filter not found');
  }

  filters[filterIndex] = { ...filters[filterIndex], qs };
  persistFilters(projectId, filters);
}

/**
 * Get a single filter by ID.
 * Returns undefined if not found.
 */
export function getFilterById(projectId: string, filterId: string): SavedFilter | undefined {
  const filters = getSavedFilters(projectId);
  return filters.find((f) => f.id === filterId);
}

/**
 * Get the default filter ID for a project.
 * Returns null if none set or if the pointer references a non-existent filter
 * (in which case the pointer is cleared opportunistically).
 */
export function getDefaultFilterId(projectId: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const key = getDefaultStorageKey(projectId);
    const id = window.localStorage.getItem(key);
    if (!id) {
      return null;
    }

    const filters = getSavedFilters(projectId);
    const exists = filters.some((f) => f.id === id);
    if (!exists) {
      window.localStorage.removeItem(key);
      return null;
    }

    return id;
  } catch {
    return null;
  }
}

/**
 * Set the default filter ID for a project.
 * Caller is responsible for verifying the filter exists.
 */
export function setDefaultFilterId(projectId: string, filterId: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const key = getDefaultStorageKey(projectId);
    window.localStorage.setItem(key, filterId);
  } catch {
    // Storage disabled or full — graceful no-op
  }
}

/**
 * Clear the default filter pointer for a project.
 */
export function clearDefaultFilterId(projectId: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const key = getDefaultStorageKey(projectId);
    window.localStorage.removeItem(key);
  } catch {
    // Storage disabled — graceful no-op
  }
}

/**
 * Returns true if the saved filter's qs matches the current BoardFilterParams.
 * Pagination is excluded from the comparison since saves intentionally omit it.
 */
export function isFilterActive(
  savedFilter: SavedFilter,
  currentFilters: Record<string, unknown>,
): boolean {
  const savedParams = parseBoardFilters(new URLSearchParams(savedFilter.qs));
  const currentParams = parseBoardFilters(
    new URLSearchParams(serializeBoardFilters(currentFilters)),
  );

  const stripPagination = (p: Record<string, unknown>) => {
    const { page, pageSize, ...rest } = p;
    void page;
    void pageSize;
    return rest;
  };

  return (
    serializeBoardFilters(stripPagination(savedParams)) ===
    serializeBoardFilters(stripPagination(currentParams))
  );
}
