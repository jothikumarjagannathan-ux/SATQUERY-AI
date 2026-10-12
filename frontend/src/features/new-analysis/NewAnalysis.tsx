import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Mode, QueryUnderstanding, Region, ValidateInputsResponse } from '../../api/types';
import { Panel, SectionLabel } from '../../components/Panel';
import { Button } from '../../components/Button';
import { CheckRow } from '../../components/StatusBadge';
import { TopBar } from '../../layout/AppShell';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState } from '../../components/States';

const MODES: { key: Mode; title: string; description: string; tasks: string[] }[] = [
  {
    key: 'single_image',
    title: 'Single Image',
    description: 'One optical/multispectral observation. Ask about land cover, features, or request a scene description.',
    tasks: ['Visual Question Answering', 'Captioning', 'Text-Guided Grounding'],
  },
  {
    key: 'optical_sar',
    title: 'Optical + SAR',
    description: 'Co-registered optical and SAR observations of the same footprint, cross-checked against each other.',
    tasks: ['Cross-Modal Analysis', 'Conflict Detection'],
  },
  {
    key: 'bi_temporal',
    title: 'Bi-Temporal',
    description: 'Two observations of the same region at different times — detect, localize and quantify change.',
    tasks: ['Change Detection', 'Change Quantification'],
  },
  {
    key: 'region_centric',
    title: 'Region-Centric',
    description: 'Start from a geographic region and let SatQuery AI organize every compatible observation around it.',
    tasks: ['Region Intelligence'],
  },
];

const SUGGESTED_QUERY: Record<string, string> = {
  'aoi-riverside-corridor': 'Has the built-up area increased between these dates, and where?',
  'aoi-coastal-wetland': 'Verify the water extent in this wetland using SAR and flag any disagreement.',
  'aoi-agro-mosaic': 'Describe the agricultural activity in this image and highlight the water body.',
};

export function NewAnalysis() {
  const navigate = useNavigate();
  const location = useLocation();
  const preset = location.state as { mode?: Mode; regionKey?: string } | null;
  const regions = useAsync(() => api.listRegions(), []);
  const [mode, setMode] = useState<Mode | null>(preset?.mode ?? null);
  const [regionKey, setRegionKey] = useState<string | null>(preset?.regionKey ?? null);
  const [queryText, setQueryText] = useState('');
  const [qu, setQu] = useState<QueryUnderstanding | null>(null);
  const [validation, setValidation] = useState<ValidateInputsResponse | null>(null);
  const [validating, setValidating] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const compatibleRegions = useMemo<Region[]>(
    () => (regions.data ?? []).filter((r) => (mode ? r.modes.includes(mode) : false)),
    [regions.data, mode],
  );

  useEffect(() => {
    if (!mode) return;
    if (mode === 'region_centric') return;
    const first = compatibleRegions[0];
    if (first && !compatibleRegions.some((r) => r.key === regionKey)) {
      setRegionKey(first.key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, compatibleRegions.length]);

  useEffect(() => {
    if (regionKey && !queryText) {
      setQueryText(SUGGESTED_QUERY[regionKey] ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionKey]);

  useEffect(() => {
    if (!mode || !regionKey || mode === 'region_centric') {
      setValidation(null);
      return;
    }
    setValidating(true);
    api
      .validateInputs(mode, regionKey)
      .then(setValidation)
      .finally(() => setValidating(false));
  }, [mode, regionKey]);

  useEffect(() => {
    if (!queryText.trim()) {
      setQu(null);
      return;
    }
    const t = setTimeout(() => {
      api.understandQuery(queryText).then(setQu).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [queryText]);

  const canRun = mode && mode !== 'region_centric' && regionKey && queryText.trim().length > 0 && validation?.overall_status;

  async function runAnalysis() {
    if (!mode || !regionKey || mode === 'region_centric') return;
    setRunning(true);
    setRunError(null);
    try {
      const mission = await api.analyze(mode, regionKey, queryText);
      navigate(`/workspace/${mission.id}`);
    } catch (e) {
      setRunError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="New Analysis" subtitle="Select an analysis mode, an observation set, and describe what you want to know." />
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent-soft/30 p-4 shadow-sm">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 text-accent text-xs">⇪</span>
                <span className="text-sm font-semibold text-ink-primary">Want to analyze your own imagery?</span>
              </div>
              <p className="mt-1 text-xs text-ink-secondary">
                Upload your custom satellite, aerial, or drone image directly for land-cover classification, scene understanding, or bi-temporal change detection.
              </p>
            </div>
            <Button
              variant="secondary"
              className="shrink-0 text-xs border-accent/50 text-accent hover:bg-accent-soft"
              onClick={() => navigate('/upload-analysis')}
            >
              Upload Image →
            </Button>
          </div>

          <div>
            <SectionLabel className="mb-3">1 — Analysis mode</SectionLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  onClick={() => {
                    setMode(m.key);
                    setRegionKey(null);
                    setQueryText('');
                  }}
                  className={`rounded-lg border p-4 text-left transition-all ${
                    mode === m.key
                      ? 'border-accent bg-accent-soft shadow-glow'
                      : 'border-border-subtle bg-surface hover:border-border-strong'
                  }`}
                >
                  <div className="text-[13px] font-bold text-ink-primary">{m.title}</div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">{m.description}</p>
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {m.tasks.map((t) => (
                      <span key={t} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-ink-muted">
                        {t}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {mode === 'region_centric' && (
            <Panel>
              <p className="text-sm text-ink-secondary">
                Region-Centric analysis starts from a geographic region rather than a specific upload. Continue to
                Region Intelligence to select a region and see every compatible observation organized around it.
              </p>
              <Button variant="primary" className="mt-4" onClick={() => navigate('/region-intelligence')}>
                Continue to Region Intelligence →
              </Button>
            </Panel>
          )}

          {mode && mode !== 'region_centric' && (
            <>
              <div>
                <SectionLabel className="mb-3">2 — Observation set</SectionLabel>
                {regions.loading && <LoadingState />}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {compatibleRegions.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => setRegionKey(r.key)}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        regionKey === r.key ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-surface hover:border-border-strong'
                      }`}
                    >
                      <div className="text-[13px] font-semibold text-ink-primary">{r.label}</div>
                      <div className="mt-1 text-xs text-ink-muted">{r.observations.length} observation(s) in catalog</div>
                    </button>
                  ))}
                </div>
              </div>

              {regionKey && (
                <ObservationCards region={compatibleRegions.find((r) => r.key === regionKey)!} mode={mode} />
              )}

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Panel eyebrow="Step 3" title="Natural-language query">
                  <textarea
                    value={queryText}
                    onChange={(e) => setQueryText(e.target.value)}
                    rows={4}
                    placeholder="e.g. Has the built-up area increased between these dates, and where?"
                    className="w-full resize-none rounded-md border border-border-subtle bg-surface-raised p-3 text-sm text-ink-primary placeholder:text-ink-muted focus:border-accent focus:outline-none"
                  />
                  {qu && (
                    <div className="mt-3 rounded-md border border-border-subtle bg-surface-raised p-3">
                      <SectionLabel className="mb-2">Live query understanding</SectionLabel>
                      <div className="flex flex-wrap gap-1.5 text-xs">
                        <Tag label={`Intent: ${qu.intent.replace(/_/g, ' ')}`} />
                        {qu.wants_quantification && <Tag label="Quantification requested" />}
                        {qu.wants_grounding && <Tag label="Grounding requested" />}
                        {qu.wants_cross_sensor_verification && <Tag label="SAR verification requested" />}
                        {qu.temporal_reference_detected && <Tag label="Temporal reference detected" />}
                      </div>
                    </div>
                  )}
                </Panel>

                <Panel eyebrow="Step 4" title="Input compatibility check">
                  {validating && <LoadingState label="Validating inputs…" />}
                  {validation && (
                    <div className="divide-y divide-border-subtle">
                      {validation.checks.map((c) => (
                        <CheckRow key={c.key} label={c.label} status={c.status} detail={c.detail} />
                      ))}
                    </div>
                  )}
                </Panel>
              </div>

              <div className="flex items-center gap-3">
                <Button variant="primary" className="px-6 py-3 text-sm" disabled={!canRun} loading={running} onClick={runAnalysis}>
                  Run SatQuery
                </Button>
                {!validation?.overall_status && validation && (
                  <span className="text-xs text-warn">Resolve input compatibility issues before running.</span>
                )}
                {runError && <span className="text-xs text-bad">{runError}</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return <span className="rounded border border-accent/30 bg-accent-soft px-2 py-0.5 text-accent">{label}</span>;
}

function ObservationCards({ region, mode }: { region: Region; mode: Mode }) {
  const roleFilter: Record<string, string[]> = {
    bi_temporal: ['before', 'after'],
    optical_sar: ['optical', 'sar'],
    region_centric: ['optical', 'sar'],
    single_image: ['single'],
  };
  const relevant = region.observations.filter((o) => roleFilter[mode]?.includes(o.role));

  return (
    <div>
      <SectionLabel className="mb-3">Observation metadata</SectionLabel>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {relevant.map((o) => (
          <div key={o.id} className="rounded-lg border border-border-subtle bg-surface p-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-ink-primary">{o.name}</span>
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase text-ink-muted">{o.role}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] text-ink-muted">
              <span>Sensor: {o.sensor_type}</span>
              <span>CRS: {o.crs}</span>
              <span>Res: {o.resolution_m}m</span>
              <span>Bands: {o.bands.length}</span>
              <span className="col-span-2">Acquired: {new Date(o.acquisition_time).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
