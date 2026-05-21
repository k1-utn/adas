import type { VinProfile } from '@adas/shared';

/*
  API client. Talks to the NestJS backend through Next's /api rewrite. In dev it uses a
  base64 'dev principal' token matching the API's DevTokenVerifier so the whole flow works
  without standing up Clerk. Swap getToken() for the Clerk session token in production.
*/

function getToken(): string {
  // DEV ONLY — mirrors the seeded demo owner. Replace with Clerk session token.
  const principal = {
    userId: 'seed_user',
    organizationId: 'seed_org',
    role: 'OWNER',
    email: 'owner@demo.test',
  };
  return btoa(JSON.stringify(principal));
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface RequirementView {
  id: string;
  kind: string;
  explanation: string;
  confidenceScore: number;
  confidenceBand: 'HIGH' | 'MEDIUM' | 'LOW';
  needsHumanReview: boolean;
  isSupplementCandidate: boolean;
  oemReferences: { id: string; citation: string; procedure: { title: string } }[];
}

export const api = {
  decodeVin: (vin: string) => req<VinProfile>('/vin/decode', { method: 'POST', body: JSON.stringify({ vin }) }),

  uploadEstimate: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{ id: string; jobId: string }>('/estimates', { method: 'POST', body: fd });
  },

  getEstimate: (id: string) => req<{ id: string; status: string; source: string }>(`/estimates/${id}`),

  getRequirements: (id: string) => req<RequirementView[]>(`/estimates/${id}/requirements`),

  reportUrl: (id: string) => `/api/v1/estimates/${id}/report`,
};
