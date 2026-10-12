import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { QueryUnderstanding } from '../../api/types';
import { Button } from '../../components/Button';
import { Panel, SectionLabel } from '../../components/Panel';
import { TopBar } from '../../layout/AppShell';

interface ImageFileState {
  file: File;
  previewUrl: string;
  width?: number;
  height?: number;
}

const PRESET_QUERIES = [
  { label: 'Scene Description', query: 'Describe the scene, land-cover composition, and dominant terrain features.' },
  { label: 'Water Detection', query: 'Is there any water body, river, or wetland visible in this image and where?' },
  { label: 'Built-up / Urban', query: 'Identify built-up settlements, buildings, or infrastructure in this scene.' },
  { label: 'Vegetation / Crops', query: 'Analyze the vegetation coverage and agricultural cropland in this image.' },
];

export function UploadAnalysis() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileAfterInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<'single_image' | 'bi_temporal'>('single_image');
  const [primaryImage, setPrimaryImage] = useState<ImageFileState | null>(null);
  const [afterImage, setAfterImage] = useState<ImageFileState | null>(null);
  const [title, setTitle] = useState('');
  const [queryText, setQueryText] = useState('Describe the scene, land-cover composition, and dominant terrain features.');
  const [qu, setQu] = useState<QueryUnderstanding | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (primaryImage) URL.revokeObjectURL(primaryImage.previewUrl);
      if (afterImage) URL.revokeObjectURL(afterImage.previewUrl);
    };
  }, [primaryImage, afterImage]);

  // Live query understanding
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

  function handleFileSelected(file: File, isAfter = false) {
    if (!file.type.startsWith('image/') && !file.name.match(/\.(png|jpe?g|webp|tif|tiff)$/i)) {
      setError('Please select a valid image file (PNG, JPG, TIFF, WebP).');
      return;
    }
    setError(null);
    const previewUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const state: ImageFileState = { file, previewUrl, width: img.naturalWidth, height: img.naturalHeight };
      if (isAfter) {
        setAfterImage(state);
      } else {
        setPrimaryImage(state);
        if (!title) {
          setTitle(`Analysis — ${file.name.replace(/\.[^/.]+$/, '')}`);
        }
      }
    };
    img.src = previewUrl;
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  }

  async function handleStartAnalysis() {
    if (!primaryImage) {
      setError('Please upload an image to analyze.');
      return;
    }
    if (mode === 'bi_temporal' && !afterImage) {
      setError('Please upload the secondary (T2 / After) image for bi-temporal analysis.');
      return;
    }
    if (!queryText.trim()) {
      setError('Please enter a query or question about the image.');
      return;
    }

    setUploading(true);
    setError(null);
    setUploadStage('Uploading imagery to SatQuery AI...');

    try {
      const formData = new FormData();
      formData.append('file', primaryImage.file);
      formData.append('query_text', queryText.trim());
      formData.append('title', title.trim() || `Uploaded Image Analysis`);
      formData.append('mode', mode);

      if (mode === 'bi_temporal' && afterImage) {
        formData.append('file_after', afterImage.file);
      }

      setUploadStage('Running 9-stage AI orchestration pipeline...');
      const mission = await api.uploadAndAnalyze(formData);

      setUploadStage('Analysis complete! Opening mission workspace...');
      navigate(`/workspace/${mission.id}`);
    } catch (err) {
      setError((err as Error).message || 'Failed to analyze uploaded image.');
      setUploading(false);
      setUploadStage('');
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title="Upload & Analyze Imagery"
        subtitle="Upload your custom satellite, aerial, or drone images to run genuine pixel land-cover analysis, scene understanding, or bi-temporal change detection."
      />

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Analysis Type */}
          <div>
            <SectionLabel className="mb-3">1 — Analysis mode</SectionLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode('single_image')}
                className={`rounded-lg border p-4 text-left transition-all ${
                  mode === 'single_image'
                    ? 'border-accent bg-accent-soft shadow-glow'
                    : 'border-border-subtle bg-surface hover:border-border-strong'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-bold text-ink-primary">Single Image Analysis</div>
                  <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">VQA & Land Cover</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
                  Upload an optical/multispectral satellite or aerial image. SatQuery AI computes per-pixel land-cover distribution, scene caption, answers questions, and grounds spatial features.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setMode('bi_temporal')}
                className={`rounded-lg border p-4 text-left transition-all ${
                  mode === 'bi_temporal'
                    ? 'border-accent bg-accent-soft shadow-glow'
                    : 'border-border-subtle bg-surface hover:border-border-strong'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-bold text-ink-primary">Bi-Temporal Change Analysis</div>
                  <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">T1 vs T2 Diff</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
                  Upload two images of the same area taken at different times (Before & After). Detects land-use changes, quantifies affected area, and isolates change hotspots.
                </p>
              </button>
            </div>
          </div>

          {/* Upload Area */}
          <div>
            <SectionLabel className="mb-3">
              {mode === 'single_image' ? '2 — Upload satellite / aerial image' : '2 — Upload before & after imagery pair'}
            </SectionLabel>

            <div className={`grid grid-cols-1 gap-4 ${mode === 'bi_temporal' ? 'sm:grid-cols-2' : ''}`}>
              {/* Primary Image */}
              <div>
                {mode === 'bi_temporal' && (
                  <div className="mb-2 text-xs font-semibold text-ink-muted">T1 (Before Observation)</div>
                )}
                {!primaryImage ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-all ${
                      dragActive
                        ? 'border-accent bg-accent-soft/40'
                        : 'border-border-subtle bg-surface hover:border-accent/60 hover:bg-surface-raised'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/tiff"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
                    />
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
                      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                    </div>
                    <div className="mt-3 text-sm font-semibold text-ink-primary">
                      Click to browse or drag & drop image
                    </div>
                    <div className="mt-1 text-xs text-ink-muted">
                      Supports PNG, JPG, JPEG, TIFF, WebP (auto-normalized to standard raster grid)
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border-subtle bg-surface p-4">
                    <div className="flex items-start gap-4">
                      <img
                        src={primaryImage.previewUrl}
                        alt="Primary Preview"
                        className="h-28 w-28 rounded-md border border-border-subtle object-cover bg-black"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm font-semibold text-ink-primary">
                          {primaryImage.file.name}
                        </div>
                        <div className="mt-1 text-xs text-ink-muted">
                          {(primaryImage.file.size / (1024 * 1024)).toFixed(2)} MB •{' '}
                          {primaryImage.width && primaryImage.height
                            ? `${primaryImage.width}×${primaryImage.height} px`
                            : 'Image loaded'}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="rounded border border-border px-2.5 py-1 text-xs text-ink-secondary hover:border-accent hover:text-accent"
                          >
                            Replace
                          </button>
                          <button
                            type="button"
                            onClick={() => setPrimaryImage(null)}
                            className="rounded border border-bad/30 px-2.5 py-1 text-xs text-bad hover:bg-bad/10"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/tiff"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
                    />
                  </div>
                )}
              </div>

              {/* After Image (Bi-Temporal) */}
              {mode === 'bi_temporal' && (
                <div>
                  <div className="mb-2 text-xs font-semibold text-ink-muted">T2 (After Observation)</div>
                  {!afterImage ? (
                    <div
                      onClick={() => fileAfterInputRef.current?.click()}
                      className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border-subtle bg-surface p-8 text-center transition-all hover:border-accent/60 hover:bg-surface-raised"
                    >
                      <input
                        ref={fileAfterInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/tiff"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0], true)}
                      />
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
                        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                      </div>
                      <div className="mt-3 text-sm font-semibold text-ink-primary">
                        Upload After (T2) Image
                      </div>
                      <div className="mt-1 text-xs text-ink-muted">
                        Same footprint or area for bi-temporal change detection
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border-subtle bg-surface p-4">
                      <div className="flex items-start gap-4">
                        <img
                          src={afterImage.previewUrl}
                          alt="After Preview"
                          className="h-28 w-28 rounded-md border border-border-subtle object-cover bg-black"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-sm font-semibold text-ink-primary">
                            {afterImage.file.name}
                          </div>
                          <div className="mt-1 text-xs text-ink-muted">
                            {(afterImage.file.size / (1024 * 1024)).toFixed(2)} MB •{' '}
                            {afterImage.width && afterImage.height
                              ? `${afterImage.width}×${afterImage.height} px`
                              : 'Image loaded'}
                          </div>
                          <div className="mt-3 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => fileAfterInputRef.current?.click()}
                              className="rounded border border-border px-2.5 py-1 text-xs text-ink-secondary hover:border-accent hover:text-accent"
                            >
                              Replace
                            </button>
                            <button
                              type="button"
                              onClick={() => setAfterImage(null)}
                              className="rounded border border-bad/30 px-2.5 py-1 text-xs text-bad hover:bg-bad/10"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                      <input
                        ref={fileAfterInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/tiff"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0], true)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Mission Details & Query */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Panel eyebrow="Step 3" title="Analysis query & question">
              <div className="mb-2 text-xs text-ink-muted">Quick query templates:</div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {PRESET_QUERIES.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setQueryText(p.query)}
                    className="rounded bg-surface-raised border border-border-subtle px-2 py-1 text-[11px] text-ink-secondary hover:border-accent/50 hover:text-ink-primary"
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <textarea
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                rows={4}
                placeholder="Ask what you would like SatQuery AI to analyze in this image..."
                className="w-full resize-none rounded-md border border-border-subtle bg-surface-raised p-3 text-sm text-ink-primary placeholder:text-ink-muted focus:border-accent focus:outline-none"
              />

              {qu && (
                <div className="mt-3 rounded-md border border-border-subtle bg-surface-raised p-3">
                  <SectionLabel className="mb-2">Query understanding pipeline</SectionLabel>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded border border-accent/30 bg-accent-soft px-2 py-0.5 text-accent">
                      Intent: {qu.intent.replace(/_/g, ' ')}
                    </span>
                    {qu.wants_quantification && (
                      <span className="rounded border border-accent/30 bg-accent-soft px-2 py-0.5 text-accent">
                        Quantification requested
                      </span>
                    )}
                    {qu.wants_grounding && (
                      <span className="rounded border border-accent/30 bg-accent-soft px-2 py-0.5 text-accent">
                        Spatial Grounding requested
                      </span>
                    )}
                  </div>
                </div>
              )}
            </Panel>

            <Panel eyebrow="Step 4" title="Mission metadata">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-secondary mb-1">
                    Analysis Title (Optional)
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Flood Basin Inspection - Q3"
                    className="w-full rounded-md border border-border-subtle bg-surface-raised p-2.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-accent focus:outline-none"
                  />
                </div>

                <div className="rounded-md border border-border-subtle bg-surface-raised p-3">
                  <div className="text-xs font-semibold text-ink-primary mb-1">Pipeline Specifications</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-ink-muted font-mono">
                    <div>Modality: Optical Multispectral / RGB</div>
                    <div>CRS: EPSG:4326 (WGS 84)</div>
                    <div>Target Grid: 512×512 Standard</div>
                    <div>Processing: Genuine Raster Math</div>
                  </div>
                </div>

                {uploading && (
                  <div className="rounded-md border border-accent/40 bg-accent-soft p-3">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                      <span className="text-xs font-medium text-accent">{uploadStage}</span>
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          </div>

          {/* Action Row */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="primary"
              className="px-6 py-3 text-sm"
              loading={uploading}
              disabled={uploading || !primaryImage || (mode === 'bi_temporal' && !afterImage)}
              onClick={handleStartAnalysis}
            >
              Analyze Uploaded Image →
            </Button>

            {error && <span className="text-xs text-bad">{error}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
