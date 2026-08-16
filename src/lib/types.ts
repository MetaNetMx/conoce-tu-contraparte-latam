export type CountryCode = "CO" | "MX" | "PE";

export type SearchCandidate = {
  country: CountryCode;
  sourceId: string;
  taxId: string | null;
  name: string;
  status: string | null;
  location: string | null;
  subtitle: string;
  source: string;
  metadata?: Record<string, string | null>;
};

export type SearchResult = {
  query: string;
  country: CountryCode;
  mode: "name" | "id";
  candidates: SearchCandidate[];
  source: string;
  total: number;
  capped: boolean;
  disclaimer: string;
};

export type Analysis = {
  company: string;
  country: string;
  taxId: string | null;
  relationship: string;
  confidence: number;
  risk: "Bajo" | "Medio" | "Alto" | "Sin clasificar";
  summary: string;
  positives: string[];
  alerts: string[];
  missing: string[];
  recommendation: string;
  dataMode: "real" | "demo";
  checkedAt: string;
  sources: {
    name: string;
    status: string;
    coverage?: string;
    url?: string;
    origin?: "croma_official" | "croma_web" | "croma_research" | "openai" | "public_manual" | "local";
  }[];
  evidence?: {
    title: string;
    url: string;
    snippet: string;
    origin: "croma_official" | "croma_web" | "croma_research" | "openai" | "public_manual" | "local";
  }[];
  sourceAudit?: {
    name: string;
    status: "consulted" | "available" | "not_applicable";
    reason: string;
    origin: "croma" | "public" | "openai" | "local";
  }[];
  screening?: {
    checkedAt: string;
    matches: Array<{
      source: string;
      name: string;
      aliases: string[];
      matchBasis: string[];
      corroboratingDetails: string[];
      confidence: "possible" | "strong";
      programs?: string[];
      nationality?: string | null;
      identifiers?: string[];
      description?: string | null;
      matchType?: "designation" | "linked_relationship";
      relatedTo?: string[];
      recordId?: string;
      url: string;
    }>;
    coverage: Array<{
      source: string;
      status: "consulted" | "unavailable";
      records?: number;
      note: string;
      url: string;
    }>;
  };
};
