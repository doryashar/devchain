// eslint-disable @typescript-eslint/no-empty-interface
// eslint-disable @typescript-eslint/no-extraneous-class

export type FileRole =
  | 'source'
  | 'test'
  | 'view'
  | 'controller'
  | 'service'
  | 'model'
  | 'config'
  | 'build'
  | 'asset'
  | 'doc'
  | 'docs'
  | 'generated'
  | 'unknown'
  | 'style'
  | 'type'
  | 'script'
  | 'utility';

export type AnalysisWarningCode =
  | 'partial_test_detection'
  | 'loc_unavailable'
  | 'coverage_unmeasured'
  | 'daily_churn_unavailable'
  | 'windowed_authors_unavailable'
  | 'shallow_git_history'
  | 'missing_dependency_data'
  | 'coupling_unavailable';

export type HotspotMetric =
  | 'size'
  | 'churn'
  | 'tests'
  | 'staleness'
  | 'coupling'
  | 'complexity'
  | 'ownership';

export interface AnalysisWarning {
  code: AnalysisWarningCode;
  message: string;
  data?: any;
}

export interface LanguageAdapter {
  id: string;
  extensions: string[];
  classifyRole(filePath: string, content: string): FileRole | null;
  extractImports(content: string): string[];
  countSymbols(content: string): number;
  computeComplexity(content: string): number;
  detectTestPair(filePath: string, allPaths: Set<string>): string | null;
  resolveImport?(specifier: string, importerPath: string, allPaths: ReadonlySet<string>): string | null;
}

export interface RegionNode {
  id: string;
  path: string;
  name: string;
  totalFiles: number;
  totalLOC: number;
}

export interface DistrictNode {
  id: string;
  regionId: string;
  path: string;
  name: string;
  totalFiles: number;
  totalLOC: number;
  churn7d: number;
  churn30d: number;
  inboundWeight: number;
  outboundWeight: number;
  couplingScore: number;
  testFileCount: number;
  testFileRatio: number | null;
  role: FileRole | 'mixed';
  complexityAvg: number | null;
  ownershipConcentration: number | null;
  testCoverageRate: number | null;
  blastRadius: number;
  primaryAuthorName: string | null;
  primaryAuthorShare: number | null;
  primaryAuthorRecentlyActive: boolean;
}

export interface DistrictSignals {
  districtId: string;
  name: string;
  path: string;
  regionId: string;
  regionName: string;
  files: number;
  sourceFileCount: number;
  supportFileCount: number;
  hasSourceFiles: boolean;
  loc: number;
  churn7d: number;
  churn30d: number;
  testCoverageRate: number | null;
  sourceCoverageMeasured: boolean;
  complexityAvg: number | null;
  inboundWeight: number;
  outboundWeight: number;
  blastRadius: number;
  couplingScore: number;
  ownershipHHI: number | null;
  ownershipMeasured: boolean;
  primaryAuthorName: string | null;
  primaryAuthorShare: number | null;
  primaryAuthorRecentlyActive: boolean;
  fileTypeBreakdown: { kind: 'extension'; counts: Record<string, number> };
}

export interface DependencyEdge {
  fromDistrictId: string;
  toDistrictId: string;
  weight: number;
  isCyclic: boolean;
}

export interface HotspotEntry {
  id: string;
  kind: string;
  targetId: string;
  metric: HotspotMetric;
  rank: number;
  score: number;
  label: string;
}

export interface ActivitySummary {
  targetId: string;
  targetKind: string;
  modifiedCount1d: number;
  modifiedCount7d: number;
  buildFailures7d: number | null;
  testFailures7d: number | null;
  latestTimestamp: number | null;
  dailyChurn?: Record<string, number>;
  recentContributors7d: Array<{ authorName: string; commitCount: number }>;
  recentContributors30d: Array<{ authorName: string; commitCount: number }>;
}

export interface CodebaseOverviewMetrics {
  totalRegions: number;
  totalDistricts: number;
  totalFiles: number;
  gitHistoryDaysAvailable: number | null;
  shallowHistoryDetected: boolean;
  dependencyCoverage: number | null;
  warnings: AnalysisWarning[];
  excludedAuthorCount: number;
  scopeConfigHash: string;
}

export interface StructureNode {
  id: string;
  districtId: string;
  path: string;
  role: FileRole | 'mixed';
  loc: number;
  lastModified: number;
  metrics: {
    churn7d: number;
    churn30d: number;
    staleDays: number;
    hasColocatedTest: boolean;
    symbolCount: number | null;
    complexity: number | null;
    coverage: number | null;
  };
}

export interface CommitSummary {
  sha: string;
  message: string;
  timestamp: number;
}

export interface AuthorShare {
  author: string;
  share: number;
}

export interface DependencyExemplarEdge {
  fromFileId: string;
  toFileId: string;
  fromPath: string;
  toPath: string;
  weight: number;
}

export interface DependencyPairDetail {
  fromDistrictId: string;
  toDistrictId: string;
  weight: number;
  isCyclic: boolean;
  summary: string;
  exemplarFileEdges: DependencyExemplarEdge[];
}

export interface DistrictFilePage {
  districtId: string;
  items: StructureNode[];
  nextCursor: string | null;
}

export interface TargetDetail {
  targetId: string;
  name?: string;
  displayName?: string;
  category?: string;
  description?: string;
  kind?: string;
  summary?: string;
  whyRanked?: string[];
  recentCommits?: CommitSummary[];
  topAuthors?: AuthorShare[];
  recentActivity?: ActivitySummary[];
  topInbound?: Array<{ districtId: string; weight: number }>;
  topOutbound?: Array<{ districtId: string; weight: number }>;
  blastRadius?: Array<{ districtId: string; depth: number }>;
}

export interface CodebaseOverviewSnapshot {
  snapshotId: string;
  version: number;
  timestamp: string;
  projectKey?: string;
  name?: string;
  regions: RegionNode[];
  districts: DistrictNode[];
  hotspots: HotspotEntry[];
  activity: ActivitySummary[];
  dependencies: DependencyEdge[];
  metrics: CodebaseOverviewMetrics;
  summary: unknown;
  signals: DistrictSignals[];
  globalContributors?: Array<{ authorName: string; commitCount7d: number; commitCount30d: number }>;
}

export function computeOverview(_root: string): Promise<CodebaseOverviewSnapshot> {
  return Promise.resolve({
    snapshotId: `stub-${Date.now()}`,
    version: 1,
    timestamp: new Date().toISOString(),
    regions: [],
    districts: [],
    hotspots: [],
    activity: [],
    dependencies: [],
    metrics: {
      totalRegions: 0,
      totalDistricts: 0,
      totalFiles: 0,
      gitHistoryDaysAvailable: null,
      shallowHistoryDetected: false,
      dependencyCoverage: null,
      warnings: [],
      excludedAuthorCount: 0,
      scopeConfigHash: '',
    } as CodebaseOverviewMetrics,
    summary: {},
    signals: [],
  });
}

export function getTargets(): TargetDetail[] {
  return [];
}
