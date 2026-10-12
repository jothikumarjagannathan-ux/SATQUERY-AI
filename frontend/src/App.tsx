import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { Dashboard } from './features/dashboard/Dashboard';
import { NewAnalysis } from './features/new-analysis/NewAnalysis';
import { UploadAnalysis } from './features/upload-analysis/UploadAnalysis';
import { Workspace } from './features/workspace/Workspace';
import { ResultsEvidence } from './features/results-evidence/ResultsEvidence';
import { RegionIntelligenceList } from './features/region-intelligence/RegionIntelligenceList';
import { RegionIntelligenceDetail } from './features/region-intelligence/RegionIntelligenceDetail';
import { KnowledgeGraphPicker } from './features/knowledge-graph/KnowledgeGraphPicker';
import { KnowledgeGraphScreen } from './features/knowledge-graph/KnowledgeGraphScreen';
import { MissionHistory } from './features/mission-history/MissionHistory';
import { ModelRegistryScreen } from './features/model-registry/ModelRegistryScreen';
import { Correlation } from './features/correlation/Correlation';
import { Benchmark } from './features/benchmark/Benchmark';
import { Settings } from './features/settings/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new-analysis" element={<NewAnalysis />} />
          <Route path="/upload-analysis" element={<UploadAnalysis />} />
          <Route path="/workspace/:missionId" element={<Workspace />} />
          <Route path="/results/:missionId" element={<ResultsEvidence />} />
          <Route path="/region-intelligence" element={<RegionIntelligenceList />} />
          <Route path="/region-intelligence/:regionKey" element={<RegionIntelligenceDetail />} />
          <Route path="/knowledge-graph" element={<KnowledgeGraphPicker />} />
          <Route path="/knowledge-graph/:missionId" element={<KnowledgeGraphScreen />} />
          <Route path="/missions" element={<MissionHistory />} />
          <Route path="/models" element={<ModelRegistryScreen />} />
          <Route path="/correlation" element={<Correlation />} />
          <Route path="/correlation/:regionKey" element={<Correlation />} />
          <Route path="/benchmark" element={<Benchmark />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
