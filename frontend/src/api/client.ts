import type {
  CorrelationResult,
  ExternalObservation,
  KnowledgeGraph,
  MissionDetail,
  MissionSummary,
  Mode,
  ModelRegistryEntry,
  QueryUnderstanding,
  Region,
  ValidateInputsResponse,
} from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const headers: Record<string, string> = {};
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export function assetUrl(imagePath: string): string {
  return `${API_BASE}/static/imagery/${imagePath}`;
}

export const api = {
  health: () => request<{ status: string; mode: string }>('/api/health'),

  understandQuery: (query_text: string) =>
    request<QueryUnderstanding>('/api/understand-query', { method: 'POST', body: JSON.stringify({ query_text }) }),

  validateInputs: (mode: Mode, region_key: string) =>
    request<ValidateInputsResponse>('/api/validate-inputs', {
      method: 'POST',
      body: JSON.stringify({ mode, region_key }),
    }),

  analyze: (mode: Mode, region_key: string, query_text: string, title?: string) =>
    request<MissionDetail>('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ mode, region_key, query_text, title }),
    }),

  uploadAndAnalyze: (formData: FormData) =>
    request<MissionDetail>('/api/upload-and-analyze', {
      method: 'POST',
      body: formData,
    }),

  listMissions: () => request<MissionSummary[]>('/api/missions'),
  getMission: (id: string) => request<MissionDetail>(`/api/missions/${id}`),
  updateMissionFeedback: (id: string, body: { saved?: boolean; user_feedback?: string }) =>
    request<MissionSummary>(`/api/missions/${id}/feedback`, { method: 'PATCH', body: JSON.stringify(body) }),

  getKnowledgeGraph: (missionId: string) => request<KnowledgeGraph>(`/api/knowledge-graph/${missionId}`),

  generateReport: (missionId: string) =>
    request<{ mission_id: string; format: string; content: string }>(`/api/report/${missionId}`, { method: 'POST' }),

  listModels: () => request<ModelRegistryEntry[]>('/api/models'),

  listRegions: () => request<Region[]>('/api/regions'),
  getRegion: (key: string) => request<Region>(`/api/regions/${key}`),
  externalObservations: (key: string) => request<ExternalObservation[]>(`/api/regions/${key}/external-observations`),
  correlate: (key: string) => request<CorrelationResult>(`/api/regions/${key}/correlate`, { method: 'POST' }),
};
