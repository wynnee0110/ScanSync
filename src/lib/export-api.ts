/**
 * export-api.ts
 * -------------
 * Typed HTTP client for the ScanSync FastAPI CSV export endpoint.
 *
 * Security boundaries:
 * - The mobile app sends its Supabase access token (from the active session).
 * - The FastAPI backend verifies the token and re-enforces RLS role checks.
 * - No service-role key or Google credentials ever leave the backend.
 *
 * Usage:
 *   import { requestCsvExport } from '@/lib/export-api';
 *
 *   const result = await requestCsvExport({
 *     eventId: event.id,
 *     accessToken: session.access_token,
 *   });
 *   if (result.ok) {
 *     // open result.webLink
 *   }
 */

import Constants from 'expo-constants';

import { env } from '@/lib/env';

export function getResolvedApiUrl(): string {
  const configured = env.apiUrl;
  const hostUri = Constants.expoConfig?.hostUri;
  const hostIp = hostUri ? hostUri.split(':')[0] : null;

  if (configured) {
    if (hostIp && (configured.includes('localhost') || configured.includes('127.0.0.1'))) {
      return configured.replace('localhost', hostIp).replace('127.0.0.1', hostIp);
    }
    return configured;
  }

  if (hostIp) {
    return `http://${hostIp}:8000`;
  }

  return 'http://localhost:8000';
}

export type ExportCsvSuccess = {
  ok: true;
  jobId: string;
  fileId: string;
  webLink: string;
  rowCount: number;
  cached: boolean;
};

export type ExportCsvError = {
  ok: false;
  status: number;
  message: string;
};

export type ExportCsvResult = ExportCsvSuccess | ExportCsvError;

type ExportCsvParams = {
  eventId: string;
  /** Supabase access token from the active session. */
  accessToken: string;
  /**
   * Client-generated UUID for idempotency.
   * Defaults to a new UUID each call if not supplied.
   * Pass a stable key (e.g. stored per-event) to prevent duplicate exports
   * when the user taps the button more than once.
   */
  idempotencyKey?: string;
};

function generateUUID(): string {
  // Minimal RFC4122 v4 UUID — no external dependency required.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Sends a POST /export/csv request to the FastAPI backend.
 * Returns a typed result — never throws.
 */
export async function requestCsvExport(params: ExportCsvParams): Promise<ExportCsvResult> {
  const apiUrl = getResolvedApiUrl();

  if (!apiUrl || apiUrl === 'http://localhost:8000') {
    // Dev fallback notice — the real API URL must be set in .env.
    console.warn('[export-api] EXPO_PUBLIC_API_URL not configured. Using localhost:8000.');
  }

  const body = {
    event_id: params.eventId,
    idempotency_key: params.idempotencyKey ?? generateUUID(),
  };

  try {
    const response = await fetch(`${apiUrl}/export/csv`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const errorBody = (await response.json()) as { detail?: string };
        message = errorBody.detail ?? message;
      } catch {
        // Ignore JSON parse failure on error responses.
      }
      return { ok: false, status: response.status, message };
    }

    const data = (await response.json()) as {
      job_id: string;
      file_id: string;
      web_link: string;
      row_count: number;
      cached: boolean;
    };

    return {
      ok: true,
      jobId: data.job_id,
      fileId: data.file_id,
      webLink: data.web_link,
      rowCount: data.row_count,
      cached: data.cached,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { ok: false, status: 0, message };
  }
}
