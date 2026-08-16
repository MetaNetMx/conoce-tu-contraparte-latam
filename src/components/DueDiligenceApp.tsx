"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  Analysis,
  CountryCode,
  SearchCandidate,
  SearchResult,
} from "@/lib/types";
import styles from "./DueDiligenceApp.module.css";

const countries: Array<{
  code: CountryCode;
  name: string;
  idLabel: string;
  source: string;
  example: string;
}> = [
  { code: "CO", name: "Colombia", idLabel: "NIT", source: "RUES + SECOP", example: "Almacenes Exito" },
  { code: "MX", name: "México", idLabel: "RFC", source: "SIEM + validación RFC", example: "OXXO" },
  { code: "PE", name: "Perú", idLabel: "RUC", source: "SUNAT + SAT Lima", example: "Telefonica" },
];

const globalScreeningSources = [
  "OFAC SDN y alias",
  "FBI Wanted",
  "UK Sanctions List",
  "Consejo de Seguridad de la ONU",
  "Canadá · sanciones consolidadas",
  "FinCEN Enforcement y Section 311",
];

async function keepProcessVisible(startedAt: number, minimumMs = 2400) {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
}

const complementarySources = [
  "DEA Fugitives",
  "U.S. Marshals",
  "ICE Most Wanted",
  "State/INL y DOJ",
  "Unión Europea",
  "Fiscalías y fuentes nacionales de LatAm",
];

type Step = "search" | "results" | "analyzing" | "report";
type ScreeningMatch = NonNullable<Analysis["screening"]>["matches"][number];
type AssistantMessage = {
  role: "user" | "assistant";
  text: string;
  citations?: Array<{ title: string; url: string }>;
};
type ResearchResult = {
  report: string;
  sources: Array<{ title: string; url: string }>;
  pagesAnalyzed: number | null;
  possibleMentions: Array<{
    office: string;
    title: string;
    url: string;
    publishedAt: string | null;
    excerpt: string;
  }>;
  officialUsResults: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
  directUsScreening: {
    checkedAt: string;
    matches: Array<{
      source: string;
      name: string;
      aliases: string[];
      matchBasis: string[];
      corroboratingDetails: string[];
      confidence: "possible" | "strong";
      programs?: string[];
      dateOfBirth?: string[];
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
      mode: "complete_official_list" | "official_search_only";
      status: "consulted" | "unavailable";
      records?: number;
      updatedAt?: string | null;
      note: string;
      url: string;
    }>;
  };
  requestedCoverage: string[];
  disclaimer: string;
};

export default function DueDiligenceApp() {
  const [country, setCountry] = useState<CountryCode>("MX");
  const [subjectType, setSubjectType] = useState<"company" | "person">("company");
  const [searchMode, setSearchMode] = useState<"name" | "id">("name");
  const [query, setQuery] = useState("Casa Tequilera El Origen del Tequila");
  const [identifyingDetail, setIdentifyingDetail] = useState("");
  const [relationship, setRelationship] = useState("Proveedor");
  const [step, setStep] = useState<Step>("search");
  const [progressPhase, setProgressPhase] = useState(0);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<SearchCandidate | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [openAIKey, setOpenAIKey] = useState("");
  const [error, setError] = useState("");
  const currentCountry = useMemo(
    () => countries.find((item) => item.code === country) ?? countries[0],
    [country],
  );

  useEffect(() => {
    if (step !== "analyzing") return;
    const timer = window.setInterval(() => {
      setProgressPhase((current) => Math.min(current + 1, 9));
    }, 750);
    return () => window.clearInterval(timer);
  }, [step]);

  function changeCountry(nextCountry: CountryCode) {
    const config = countries.find((item) => item.code === nextCountry)!;
    setCountry(nextCountry);
    setSearchMode("name");
    setQuery(subjectType === "company" ? config.example : "");
    setSearchResult(null);
    setSelected(null);
    setAnalysis(null);
    setError("");
    setStep("search");
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const startedAt = Date.now();
    setError("");
    setSelected(null);
    setAnalysis(null);
    setProgressPhase(0);
    setStep("analyzing");

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country, query, mode: searchMode, subjectType, identifyingDetail }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No pudimos completar la búsqueda.");
      await keepProcessVisible(startedAt);
      setSearchResult(data);
      setSelected(subjectType === "person" && data.candidates?.length === 1 ? data.candidates[0] : null);
      setStep("results");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No pudimos completar la búsqueda.",
      );
      setStep("search");
    }
  }

  async function analyze(candidateOverride?: SearchCandidate) {
    const startedAt = Date.now();
    const target = candidateOverride ?? selected;
    if (!target) return;
    setSelected(target);
    setError("");
    setProgressPhase(0);
    setStep("analyzing");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate: target, relationship }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No pudimos completar el análisis.");
      await keepProcessVisible(startedAt);
      setAnalysis(data);
      setStep("report");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No pudimos completar el análisis.",
      );
      setStep("results");
    }
  }

  function reset() {
    setSearchResult(null);
    setSelected(null);
    setAnalysis(null);
    setIdentifyingDetail("");
    setError("");
    setStep("search");
  }

  function loadExample(example: "company" | "person" | "rfc") {
    setCountry("MX");
    setRelationship("Proveedor");
    setIdentifyingDetail("");
    setSearchResult(null);
    setSelected(null);
    setAnalysis(null);
    setError("");
    setStep("search");
    if (example === "person") {
      setSubjectType("person");
      setSearchMode("name");
      setQuery("Roberto Jiménez Arias");
      return;
    }
    setSubjectType("company");
    setSearchMode(example === "rfc" ? "id" : "name");
    setQuery(example === "rfc" ? "SSC190313CY6" : "Casa Tequilera El Origen del Tequila");
  }

  return (
    <main className={styles.page}>
      <nav className={styles.nav} aria-label="Navegación principal">
        <a className={styles.brand} href="#inicio" aria-label="Inicio">
          <span className={styles.mark} aria-hidden="true">◇</span>
          <span>Contraparte <b>LatAm</b></span>
        </a>
        <div className={styles.navLinks}>
          <a href="#cobertura">Cobertura</a>
          <a href="#producto">Cómo funciona</a>
        </div>
        <div className={styles.navMeta}>
          <span className={styles.statusDot} />
          Croma conectado
        </div>
      </nav>

      <section className={styles.hero} id="inicio">
        <div className={styles.eyebrow}>Centro de investigación de contraparte</div>
        <h1>Ve la conexión.<br />Abre la fuente.</h1>
        <p>
          Sigue cada dato desde la consulta hasta el registro oficial. Separamos designaciones,
          relaciones publicadas y posibles homónimos para que decidas con contexto.
        </p>
        <div className={styles.flowLegend} aria-label="Cómo se construye el reporte">
          <span><b>01</b> Identidad</span><i />
          <span><b>02</b> Fuentes</span><i />
          <span><b>03</b> Relaciones</span><i />
          <span><b>04</b> Evidencia exacta</span>
        </div>

        <div className={styles.coverageBar} id="cobertura">
          {countries.map((item) => (
            <div key={item.code}>
              <span>{item.code}</span>
              <strong>{item.name}</strong>
              <small>{item.source}</small>
            </div>
          ))}
        </div>

        <section className={styles.sourceOverview} aria-labelledby="source-title">
          <div className={styles.sourceOverviewHeader}>
            <div>
              <span className={styles.kicker}>Cobertura verificable</span>
              <h2 id="source-title">Sabes qué buscamos y de dónde viene</h2>
              <p>
                Cada resultado identifica si proviene de Croma, un registro oficial directo,
                una fuente pública o OpenAI. No presentamos como consultada una fuente que no usamos.
              </p>
            </div>
            <a href="https://usecroma.com/es#sources" target="_blank" rel="noreferrer">Ver catálogo de Croma ↗</a>
          </div>

          <div className={styles.sourceSummaryGrid}>
            <div>
              <b>Croma API</b>
              <strong>Identidad y señales oficiales</strong>
              <span>RUES, SECOP, SIEM, SUNAT y SAT Lima según el país.</span>
            </div>
            <div>
              <b>Croma Web Search</b>
              <strong>Evidencia pública automática</strong>
              <span>Se consulta al analizar y devuelve enlaces, fragmentos y origen.</span>
            </div>
            <div>
              <b>Registros directos</b>
              <strong>Screening global ampliado</strong>
              <span>OFAC, FBI, Reino Unido, ONU, Canadá y FinCEN.</span>
            </div>
            <div>
              <b>OpenAI opcional</b>
              <strong>Interpretación separada</strong>
              <span>Solo funciona con la clave temporal del usuario; no sustituye las fuentes.</span>
            </div>
          </div>

          <details className={styles.sourceCatalog}>
            <summary>Ver todas las fuentes, el momento de consulta y sus límites</summary>
            <div className={styles.catalogGrid}>
              <div>
                <span>Consulta automática por país</span>
                <strong>Colombia</strong>
                <p>RUES para identidad, SECOP para sanciones de contratación y Croma Web Search para evidencia pública.</p>
                <strong>México</strong>
                <p>SIEM para establecimientos, validación estructural de RFC y Croma Web Search. SAT requiere cotejo oficial manual.</p>
                <strong>Perú</strong>
                <p>SUNAT para identidad, SAT Lima para obligaciones municipales y Croma Web Search.</p>
              </div>
              <div>
                <span>Al pulsar “Investigación ampliada”</span>
                <strong>Registros oficiales completos</strong>
                <ul>{globalScreeningSources.map((source) => <li key={source}>{source}</li>)}</ul>
              </div>
              <div>
                <span>Cobertura oficial complementaria</span>
                <strong>Búsqueda dirigida, no exhaustiva</strong>
                <ul>{complementarySources.map((source) => <li key={source}>{source}</li>)}</ul>
                <p>Estas fuentes no ofrecen aquí un registro masivo único y se etiquetan con esa limitación.</p>
              </div>
              <div>
                <span>Regla de interpretación</span>
                <strong>Coincidencia no es identidad</strong>
                <p>Nombre o alias inicia una revisión. Fecha de nacimiento, nacionalidad, RFC u otro identificador determinan si hay corroboración.</p>
              </div>
            </div>
          </details>
        </section>

        <div className={styles.workspace} id="producto">
          <div className={styles.workspaceHeader}>
            <div>
              <span className={styles.kicker}>Nueva revisión</span>
              <h2>Encuentra y confirma tu contraparte</h2>
            </div>
            <div className={styles.steps} aria-label="Progreso">
              <span className={styles.stepActive}>1 Buscar</span>
              <span className={step !== "search" && step !== "analyzing" ? styles.stepActive : ""}>2 Elegir</span>
              <span className={step === "report" ? styles.stepActive : ""}>3 Analizar</span>
            </div>
          </div>

          <form onSubmit={search} className={styles.searchForm}>
            <div className={styles.demoRoutes} aria-label="Ejemplos guiados">
              <div>
                <span className={styles.kicker}>Prueba un recorrido</span>
                <p>Carga un caso para entender cómo se conectan los datos.</p>
              </div>
              <button type="button" onClick={() => loadExample("company")}><b>Empresa</b> Casa Tequilera</button>
              <button type="button" onClick={() => loadExample("person")}><b>Persona</b> Roberto Jiménez Arias</button>
              <button type="button" onClick={() => loadExample("rfc")}><b>RFC exacto</b> SSC190313CY6</button>
            </div>
            <fieldset className={styles.subjectPicker}>
              <legend>¿Qué quieres revisar?</legend>
              <div>
                <button
                  type="button"
                  className={subjectType === "company" ? styles.subjectActive : ""}
                  onClick={() => {
                    setSubjectType("company");
                    setSearchMode("name");
                    setQuery(currentCountry.example);
                    setIdentifyingDetail("");
                    setSearchResult(null);
                    setSelected(null);
                  }}
                >
                  <strong>Empresa</strong>
                  <span>Razón social, NIT, RFC o RUC</span>
                </button>
                <button
                  type="button"
                  className={subjectType === "person" ? styles.subjectActive : ""}
                  onClick={() => {
                    setSubjectType("person");
                    setSearchMode("name");
                    setQuery("");
                    setIdentifyingDetail("");
                    setSearchResult(null);
                    setSelected(null);
                  }}
                >
                  <strong>Persona</strong>
                  <span>Nombre, alias y listas oficiales</span>
                </button>
              </div>
            </fieldset>

            <fieldset className={styles.countryPicker}>
              <legend>{subjectType === "company" ? "País de registro" : "País de contexto"}</legend>
              <div>
                {countries.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    className={country === item.code ? styles.countryActive : ""}
                    onClick={() => changeCountry(item.code)}
                  >
                    <span>{item.code}</span>
                    {item.name}
                  </button>
                ))}
              </div>
            </fieldset>

            {subjectType === "company" ? (
            <div className={styles.modePicker}>
              <button
                type="button"
                className={searchMode === "name" ? styles.modeActive : ""}
                onClick={() => {
                  setSearchMode("name");
                  setQuery(currentCountry.example);
                }}
              >
                Buscar por nombre
              </button>
              <button
                type="button"
                className={searchMode === "id" ? styles.modeActive : ""}
                onClick={() => {
                  setSearchMode("id");
                  setQuery("");
                }}
              >
                Buscar por {currentCountry.idLabel}
              </button>
              {country === "MX" && <small>Valida estructura y contrasta SIEM; SAT requiere verificación oficial.</small>}
            </div>
            ) : (
              <div className={styles.personModeNotice}>
                La búsqueda de personas no usa SIEM. Coteja nombre y alias directamente en listas oficiales globales; una coincidencia necesita otro identificador para confirmarse.
              </div>
            )}

            <div className={styles.searchPlan}>
              <div>
                <span className={`${styles.sourcePill} ${styles.sourcePillCroma}`}>Croma API</span>
                <strong>{subjectType === "person" ? "Listas oficiales globales" : primarySearchSource(country, searchMode)}</strong>
                <small>{subjectType === "person" ? "OFAC, FBI, Reino Unido, ONU, Canadá y FinCEN se cotejan desde la búsqueda inicial." : primarySearchExplanation(country, searchMode)}</small>
              </div>
              <div>
                <span className={`${styles.sourcePill} ${styles.sourcePillCroma}`}>Croma Web</span>
                <strong>Evidencia pública</strong>
                <small>Se activa después de confirmar el sujeto y genera enlaces trazables.</small>
              </div>
              <div>
                <span className={`${styles.sourcePill} ${styles.sourcePillDirect}`}>Opcional</span>
                <strong>{subjectType === "person" ? "Croma Research" : "Screening global"}</strong>
                <small>{subjectType === "person" ? "Profundiza en fuentes oficiales y evidencia pública después del reporte inicial." : "Listas completas y Croma Research al solicitar investigación ampliada."}</small>
              </div>
            </div>

            <div className={`${styles.searchGrid} ${subjectType === "person" ? styles.searchGridPerson : ""}`}>
              <label>
                <span>{subjectType === "person" ? "Nombre completo de la persona" : searchMode === "name" ? "Nombre o razón social" : currentCountry.idLabel}</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={subjectType === "person" ? "Ej: Joaquín Archivaldo Guzmán Loera" : searchMode === "name" ? `Ej: ${currentCountry.example}` : `Ingresa el ${currentCountry.idLabel}`}
                  minLength={subjectType === "person" || searchMode === "name" ? 3 : undefined}
                  inputMode={subjectType === "company" && searchMode === "id" && country !== "MX" ? "numeric" : "text"}
                  required
                />
              </label>
              {subjectType === "person" && (
                <label>
                  <span>Dato adicional recomendado</span>
                  <input
                    value={identifyingDetail}
                    onChange={(event) => setIdentifyingDetail(event.target.value)}
                    placeholder="Ej: México, 1957 o identificación"
                  />
                </label>
              )}
              <label>
                <span>Relación comercial</span>
                <select
                  value={relationship}
                  onChange={(event) => setRelationship(event.target.value)}
                >
                  <option>Proveedor</option>
                  <option>Cliente</option>
                  <option>Socio comercial</option>
                  <option>Solicitud de crédito</option>
                </select>
              </label>
              <button type="submit" disabled={step === "analyzing"}>
                {step === "analyzing" && !selected ? "Buscando…" : subjectType === "person" ? "Buscar persona" : "Buscar empresa"}
                <span>→</span>
              </button>
            </div>
            <p className={styles.searchHint}>
              {subjectType === "person" ? (
                <>Fuentes: listas oficiales completas y cobertura Croma. Un nombre coincidente genera una alerta preliminar, no una declaración de identidad o culpabilidad.</>
              ) : (
                <>Fuente: {currentCountry.source}. {searchMode === "name"
                  ? "Primero verás coincidencias; si el registro no encuentra nada podrás continuar al screening ampliado."
                  : country === "MX"
                    ? "Validamos la estructura y consultamos SIEM; la inscripción solo se confirma ante SAT."
                    : "La consulta por identificación busca una coincidencia exacta."}</>
              )}
            </p>
            {error && <p className={styles.error}>{error}</p>}
          </form>

          {step === "analyzing" && (
            <SourceProgress query={selected?.name ?? query} country={country} mode={searchMode} subjectType={subjectType} analyzingEntity={Boolean(selected)} progressPhase={progressPhase} />
          )}

          {searchResult && (step === "results" || step === "analyzing") && (
            <section className={styles.resultsSection} aria-live="polite">
              <div className={styles.resultsHeader}>
                <div>
                  <span className={styles.kicker}>Paso 2 · Confirmar identidad</span>
                  <h3>{subjectType === "person"
                    ? "Persona lista para cotejo"
                    : searchResult.mode === "id"
                      ? country === "MX" ? "Revisión del RFC" : "Resultado exacto"
                      : `${searchResult.candidates.length} coincidencias mostradas`}</h3>
                  <p>{searchResult.source} · {searchResult.total} resultado(s) reportados</p>
                </div>
                <button type="button" className={styles.textButton} onClick={reset}>
                  Nueva búsqueda
                </button>
              </div>

              {searchResult.candidates.length ? (
                <div className={styles.candidateList}>
                  {searchResult.candidates.map((candidate) => {
                    const isSelected = selected?.sourceId === candidate.sourceId;
                    return (
                      <button
                        type="button"
                        key={`${candidate.country}-${candidate.sourceId}`}
                        className={`${styles.candidateCard} ${isSelected ? styles.candidateSelected : ""}`}
                        onClick={() => setSelected(candidate)}
                      >
                        <span className={styles.radio}>{isSelected ? "✓" : ""}</span>
                        <div className={styles.candidateMain}>
                          <strong>{candidate.name}</strong>
                          <span>{candidate.subtitle}</span>
                          <small>
                            {candidate.taxId ? `${currentCountry.idLabel} ${candidate.taxId}` : `ID ${candidate.sourceId}`}
                          </small>
                        </div>
                        <div className={styles.candidateSide}>
                          {candidate.status && (
                            <span className={statusClass(candidate.status, styles)}>
                              {candidate.status}
                            </span>
                          )}
                          <small>{candidate.source}</small>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <strong>No encontramos coincidencias en el registro empresarial.</strong>
                  <p>
                    Esto no significa que el sujeto no exista. Puedes continuar con el nombre
                    ingresado para revisar listas globales, Croma Web Search y fuentes públicas.
                  </p>
                  <button
                    type="button"
                    className={styles.fallbackButton}
                    onClick={() => void analyze({
                      country,
                      sourceId: `unregistered:${country}:${encodeURIComponent(query)}`,
                      taxId: null,
                      name: query,
                      status: null,
                      location: currentCountry.name,
                      subtitle: "Sin coincidencia registral · screening alternativo",
                      source: "Screening global",
                      metadata: { subjectType: "company" },
                    })}
                  >
                    Continuar con screening ampliado
                  </button>
                </div>
              )}

              <div className={styles.selectionFooter}>
                <p>{searchResult.disclaimer}</p>
                <button
                  type="button"
                  onClick={() => void analyze()}
                  disabled={!selected || step === "analyzing"}
                >
                  {step === "analyzing" ? "Consultando señales…" : subjectType === "person" ? "Analizar persona y posibles coincidencias" : "Analizar entidad elegida"}
                  <span>→</span>
                </button>
              </div>
            </section>
          )}

          {analysis && step === "report" && (
            <Report
              analysis={analysis}
              onReset={reset}
              openAIKey={openAIKey}
              onOpenAIKeyChange={setOpenAIKey}
            />
          )}
        </div>
      </section>

      <section className={styles.valueStrip} aria-label="Beneficios">
        <div><strong>01</strong><span>Busca una empresa o persona</span></div>
        <div><strong>02</strong><span>Coteja identidad y posibles homónimos</span></div>
        <div><strong>03</strong><span>Consulta señales oficiales</span></div>
      </section>
    </main>
  );
}

function primarySearchSource(country: CountryCode, mode: "name" | "id") {
  if (country === "CO") return mode === "id" ? "RUES por NIT" : "RUES por razón social";
  if (country === "MX") return mode === "id" ? "Validación RFC + contraste SIEM" : "SIEM por nombre";
  return mode === "id" ? "SUNAT por RUC" : "SUNAT por razón social";
}

function primarySearchExplanation(country: CountryCode, mode: "name" | "id") {
  if (country === "MX" && mode === "id") {
    return "Confirma sintaxis y fecha; SIEM no sustituye la validación oficial de SAT.";
  }
  return mode === "id"
    ? "Busca una identificación exacta antes de generar señales."
    : "Devuelve candidatos para que el usuario confirme la entidad correcta.";
}

function SourceProgress({
  query,
  country,
  mode,
  subjectType,
  analyzingEntity,
  progressPhase,
}: {
  query: string;
  country: CountryCode;
  mode: "name" | "id";
  subjectType: "company" | "person";
  analyzingEntity: boolean;
  progressPhase: number;
}) {
  const localSource = subjectType === "person"
    ? { name: "Nombre, alias e identificadores", origin: "Cotejo de identidad" }
    : { name: primarySearchSource(country, mode), origin: country === "MX" && mode === "id" ? "Validación local + Croma API" : "Croma API" };
  const sourceQueue = [
    localSource,
    { name: "OFAC SDN y alias", origin: "Registro oficial de EE. UU." },
    { name: "FBI Wanted", origin: "Registro oficial de EE. UU." },
    { name: "Reino Unido y Consejo de Seguridad de la ONU", origin: "Listas oficiales" },
    { name: "Canadá · sanciones consolidadas", origin: "Lista oficial" },
    { name: "FinCEN Enforcement y Section 311", origin: "Registro oficial de EE. UU." },
    ...(analyzingEntity && country === "MX" ? [{ name: "Segunda pasada por razón social y RFC detectado", origin: "SIEM + dominios oficiales de México" }] : []),
    ...(analyzingEntity ? [{ name: "Evidencia pública indexada", origin: "Croma Web Search" }] : []),
    { name: "DEA, Marshals, ICE, DOJ, UE y fuentes LatAm", origin: "Cobertura complementaria" },
  ];
  const rows = sourceQueue.map((source, index) => ({
    ...source,
    status: index < progressPhase ? "Consultada" : index === progressPhase ? "Consultando ahora" : "En espera",
    active: index === progressPhase,
    done: index < progressPhase,
  }));

  return (
    <section className={styles.sourceProgress} aria-live="polite">
      <div className={styles.progressIntro}>
        <div>
          <span className={styles.kicker}>{analyzingEntity ? "Analizando contraparte" : "Buscando identidad"}</span>
          <h3>Consultando la red de fuentes</h3>
        </div>
        <span className={styles.liveBadge}>Proceso en vivo</span>
      </div>
      <div className={styles.progressQuery}><span aria-hidden="true" />{query}</div>
      <div className={styles.progressTrack} aria-hidden="true">
        <span style={{ width: `${Math.min(100, ((progressPhase + 1) / rows.length) * 100)}%` }} />
      </div>
      <p className={styles.progressCounter}>Fuente {Math.min(progressPhase + 1, rows.length)} de {rows.length}</p>
      <div className={styles.progressRows}>
        {rows.map((row) => (
          <div key={`${row.origin}-${row.name}`}>
            <span className={row.done ? styles.progressDone : row.active ? styles.progressPulse : styles.progressIdle} />
            <b>{row.origin}</b>
            <strong>{row.name}</strong>
            <small>{row.status}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function InvestigationDashboard({
  analysis,
  checkedAt,
}: {
  analysis: Analysis;
  checkedAt: string;
}) {
  const matches = analysis.screening?.matches ?? [];
  const directMatches = matches.filter((match) => match.matchType !== "linked_relationship");
  const linkedMatches = matches.filter((match) => match.matchType === "linked_relationship");
  const primary = directMatches[0];
  const programs = Array.from(new Set(directMatches.flatMap((match) => match.programs ?? [])));
  const isPerson = primary?.description?.toLowerCase() === "individual";
  const publishedRelations = Array.from(new Set([
    ...(!isPerson ? primary?.relatedTo ?? [] : []),
    ...linkedMatches.map((match) => match.name),
  ]));
  const nationalPass = analysis.sources.find((source) => source.name === "Segunda pasada nacional de México");
  const directCoverage = analysis.screening?.coverage ?? [];
  const extraCoverage = analysis.sources
    .filter((source) => !directCoverage.some((item) => item.source === source.name))
    .map((source) => ({
      source: source.name,
      status: /no disponible|cuota|fall/i.test(source.status) ? "unavailable" as const : "consulted" as const,
      records: undefined as number | undefined,
      note: `${source.status}${source.coverage ? ` · ${source.coverage}` : ""}`,
      url: source.url ?? "https://usecroma.com/es#sources",
    }));
  const provenanceSources = [...directCoverage, ...extraCoverage].slice(0, 12);
  const consultedSources = provenanceSources.filter((source) => source.status === "consulted").length;

  return (
    <section className={styles.intelligenceDashboard} aria-label="Resumen visual de la investigación">
      <header className={styles.dashboardHeader}>
        <div className={styles.dashboardBrand}>
          <span>CL</span>
          <div><b>Contraparte LatAm</b><small>Mapa de inteligencia verificable</small></div>
        </div>
        <div className={styles.dashboardQuery}><span aria-hidden="true" />{analysis.company}</div>
      </header>

      <div className={styles.dashboardMetrics}>
        <div><small>Señal preliminar</small><strong className={styles[`metric_${analysis.risk.replace(" ", "_")}`]}>{analysis.risk}</strong></div>
        <div><small>Registro directo</small><strong>{directMatches.length || "—"}</strong><span>{directMatches.length ? "en listas oficiales" : "sin coincidencia exacta"}</span></div>
        <div><small>Relaciones publicadas</small><strong>{publishedRelations.length}</strong><span>separadas de la designación</span></div>
        <div><small>Fuentes consultadas</small><strong>{consultedSources || analysis.sources.length}</strong><span>consultado {checkedAt}</span></div>
      </div>

      <div className={styles.dashboardMain}>
        <article className={styles.identityPanel}>
          <div className={styles.identityIcon}>{isPerson ? "P" : "E"}</div>
          <span>{isPerson ? "Persona física" : "Entidad empresarial"}</span>
          <h3>{analysis.company}</h3>
          {analysis.taxId && <p className={styles.identityId}>ID fiscal · {analysis.taxId}</p>}
          <div className={styles.identityAlert}>
            <small>Hallazgo principal</small>
            <strong>{directMatches.length ? `${directMatches.length} registro(s) directo(s)` : "Sin registro directo"}</strong>
            <span>{primary?.source ?? "La evidencia requiere revisión adicional"}</span>
          </div>
          {isPerson && Boolean(primary?.relatedTo?.length) && (
            <div className={styles.primaryRelations}>
              <small>Vinculado en su ficha a</small>
              <strong>{primary?.relatedTo?.join(", ")}</strong>
            </div>
          )}
          {programs.length > 0 && (
            <div className={styles.programList}>
              <small>Programas publicados</small>
              {programs.map((program) => <span key={program}>{program}</span>)}
            </div>
          )}
          {primary?.url && <a className={styles.officialButton} href={primary.url} target="_blank" rel="noreferrer">Abrir ficha oficial exacta</a>}
        </article>

        <article className={styles.relationshipPanel}>
          <div className={styles.panelHeading}>
            <div><span>Red publicada</span><h3>{isPerson ? "Entidades y personas relacionadas" : "Personas o entidades vinculadas"}</h3></div>
            <b>{publishedRelations.length} vínculo(s)</b>
          </div>
          {publishedRelations.length ? (
            <div className={styles.relationshipList}>
              {(!isPerson ? primary?.relatedTo ?? [] : []).map((name) => (
                <div key={`primary-${name}`}>
                  <span>Linked To en el registro directo</span>
                  <strong>{name}</strong>
                  <small>Relación publicada por {primary?.source}; no describe por sí sola el tipo de participación.</small>
                </div>
              ))}
              {linkedMatches.map((match) => (
                <div key={`${match.source}-${match.name}`}>
                  <span>Entidad que menciona al sujeto</span>
                  <strong>{match.name}</strong>
                  <small>{match.matchBasis[0]}</small>
                  <a href={match.url} target="_blank" rel="noreferrer">Ver ficha oficial</a>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyRelationships}>La fuente no publicó relaciones estructuradas para este resultado.</div>
          )}
          <p className={styles.relationshipCaveat}>Un vínculo publicado se muestra separado del registro directo y no se interpreta automáticamente como culpabilidad.</p>
        </article>
      </div>

      <article className={styles.lineagePanel}>
        <div className={styles.panelHeading}>
          <div><span>Linaje del dato</span><h3>Cómo llegó la información al reporte</h3></div>
        </div>
        <div className={styles.lineageFlow}>
          <div><b>01</b><span>Entrada</span><strong>{analysis.taxId ? `ID ${analysis.taxId}` : "Nombre exacto"}</strong></div>
          <i aria-hidden="true" />
          <div><b>02</b><span>Fuente global</span><strong>{primary?.source ?? "Listas oficiales"}</strong></div>
          <i aria-hidden="true" />
          <div><b>03</b><span>Hallazgo</span><strong>{directMatches.length ? "Registro directo" : linkedMatches.length ? "Relación publicada" : "Sin coincidencia"}</strong></div>
          <i aria-hidden="true" />
          <div><b>04</b><span>Segunda pasada</span><strong>{nationalPass?.status ?? (analysis.country === "México" ? "Fuentes nacionales" : "No requerida")}</strong></div>
        </div>
      </article>

      <article className={styles.provenancePanel}>
        <div className={styles.panelHeading}>
          <div><span>Procedencia</span><h3>Estado de cada base de datos</h3></div>
        </div>
        <div className={styles.provenanceGrid}>
          {provenanceSources.map((source) => (
            <a key={source.source} href={source.url} target="_blank" rel="noreferrer">
              <b>{source.status === "consulted" ? "Consultada" : "No disponible"}</b>
              <strong>{source.source}</strong>
              <small>{source.records ? `${source.records.toLocaleString("es")} registros` : source.note}</small>
            </a>
          ))}
        </div>
      </article>
    </section>
  );
}

function EvidenceDisclosure({
  item,
  match,
}: {
  item: NonNullable<Analysis["evidence"]>[number];
  match?: ScreeningMatch;
}) {
  const [open, setOpen] = useState(false);
  const isOfac = item.title.startsWith("OFAC") || match?.source.includes("OFAC");
  const programs = match?.programs ?? [];
  const relatedTo = match?.relatedTo ?? [];
  return (
    <article className={`${styles.evidenceItem} ${isOfac ? styles.evidenceOfficial : ""} ${open ? styles.evidenceItemOpen : ""}`}>
      <button
        type="button"
        className={styles.evidenceToggle}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <b>{isOfac ? "Registro oficial OFAC" : originLabel(item.origin)}</b>
        <strong>{match?.name ?? item.title}</strong>
        <small>{isOfac ? `${programs.length || 1} programa(s) · ficha oficial trazable` : "Evidencia recuperada dentro del reporte"}</small>
        <span>{open ? "Ocultar ficha" : "Desplegar evidencia"}</span>
      </button>
      {open && (
        <div className={styles.evidenceDetail}>
          {isOfac ? (
            <div className={styles.officialRegistryCard}>
              <header><span aria-hidden="true">◇</span><div><small>Fuente primaria</small><h4>OFAC Official Registry</h4></div></header>
              {match?.recordId && <p className={styles.recordFolio}>Folio del registro <b>{match.recordId}</b></p>}
              {programs.length > 0 && (
                <div className={styles.registryPrograms}>
                  {programs.map((program) => <div key={program}><span>Programa</span><strong>{program}</strong></div>)}
                </div>
              )}
              {relatedTo.length > 0 && (
                <div className={styles.registryRelationship}>
                  <span>Vinculado a</span>
                  {relatedTo.map((name) => <strong key={name}>{name}</strong>)}
                  <small>Relación publicada por la fuente; no implica culpabilidad por sí sola.</small>
                </div>
              )}
              <p className={styles.registryExcerpt}>{item.snippet || "La fuente no entregó un extracto adicional."}</p>
              <a href={item.url} target="_blank" rel="noreferrer">Abrir la ficha específica en OFAC ↗</a>
            </div>
          ) : (
            <>
              <p>{item.snippet || "La fuente no entregó un extracto. Abre la ficha original para revisar el registro."}</p>
              <a href={item.url} target="_blank" rel="noreferrer">Abrir la fuente original ↗</a>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function Report({
  analysis,
  onReset,
  openAIKey,
  onOpenAIKeyChange,
}: {
  analysis: Analysis;
  onReset: () => void;
  openAIKey: string;
  onOpenAIKeyChange: (key: string) => void;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantError, setAssistantError] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [researchSubject, setResearchSubject] = useState(analysis.company);
  const [identifyingDetail, setIdentifyingDetail] = useState(analysis.taxId ?? "");
  const [researchResult, setResearchResult] = useState<ResearchResult | null>(null);
  const [researchError, setResearchError] = useState("");
  const [researchLoading, setResearchLoading] = useState(false);
  const checkedAt = new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(analysis.checkedAt));

  function connectOpenAI(event: FormEvent) {
    event.preventDefault();
    const key = keyInput.trim();
    if (!key.startsWith("sk-")) {
      setAssistantError("La clave debe ser una clave válida de la API de OpenAI.");
      return;
    }
    onOpenAIKeyChange(key);
    setKeyInput("");
    setAssistantError("");
  }

  function disconnectOpenAI() {
    onOpenAIKeyChange("");
    setAssistantMessages([]);
    setAssistantError("");
  }

  async function askAssistant(question: string) {
    const cleanQuestion = question.trim();
    if (!openAIKey || !cleanQuestion || assistantLoading) return;
    const userMessage: AssistantMessage = { role: "user", text: cleanQuestion };
    const history = assistantMessages.map(({ role, text }) => ({ role, text }));
    setAssistantMessages((current) => [...current, userMessage]);
    setAssistantQuestion("");
    setAssistantError("");
    setAssistantLoading(true);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenAI-Key": openAIKey,
        },
        body: JSON.stringify({ analysis, question: cleanQuestion, history }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "OpenAI no pudo responder.");
      setAssistantMessages((current) => [
        ...current,
        { role: "assistant", text: data.answer, citations: data.citations },
      ]);
    } catch (requestError) {
      setAssistantError(
        requestError instanceof Error ? requestError.message : "OpenAI no pudo responder.",
      );
    } finally {
      setAssistantLoading(false);
    }
  }

  async function runResearch(event: FormEvent) {
    event.preventDefault();
    if (researchLoading || researchSubject.trim().length < 3) return;
    setResearchLoading(true);
    setResearchError("");
    setResearchResult(null);
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis,
          subject: researchSubject,
          identifyingDetail,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Croma Research no pudo responder.");
      setResearchResult(data);
    } catch (requestError) {
      setResearchError(
        requestError instanceof Error
          ? requestError.message
          : "Croma Research no pudo responder.",
      );
    } finally {
      setResearchLoading(false);
    }
  }

  return (
    <section className={styles.reportSection} aria-live="polite">
      <InvestigationDashboard analysis={analysis} checkedAt={checkedAt} />
      <div className={styles.reportTop}>
        <div>
          <span className={styles.kicker}>Paso 3 · Revisión completada</span>
          <h2>{analysis.company}</h2>
          <p>
            {analysis.country}
            {analysis.taxId ? ` · ID fiscal ${analysis.taxId}` : ""}
            {` · ${analysis.relationship}`}
          </p>
          <small className={styles.checkedAt}>Consultado el {checkedAt}</small>
        </div>
        <div className={`${styles.riskBadge} ${riskClass(analysis.risk, styles)}`}>
          <span>Señal preliminar</span>
          <strong>{analysis.risk}</strong>
        </div>
      </div>

      <div className={styles.confidence}>
        <div><span>Confianza de identidad</span><strong>{analysis.confidence}%</strong></div>
        <div className={styles.confidenceTrack}>
          <span style={{ width: `${analysis.confidence}%` }} />
        </div>
      </div>

      <p className={styles.summary}>{analysis.summary}</p>

      <div className={styles.reportGrid}>
        <ReportList title="Señales positivas" items={analysis.positives} tone="positive" />
        <ReportList title="Señales a revisar" items={analysis.alerts} tone="alert" />
        <ReportList title="Información faltante" items={analysis.missing} tone="neutral" />
        <div className={styles.sourcesCard}>
          <h3>Evidencias y cobertura</h3>
          {analysis.sources.map((source) => (
            <div key={source.name}>
              <span>
                <b className={`${styles.originBadge} ${styles[`origin_${source.origin ?? "croma_official"}`]}`}>
                  {originLabel(source.origin)}
                </b>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a>
                ) : source.name}
                {source.coverage && <em>{source.coverage}</em>}
              </span>
              <small>{source.status}</small>
            </div>
          ))}
        </div>
      </div>

      {analysis.evidence?.length ? (
        <div className={styles.evidenceSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.kicker}>Relaciones y coincidencias encontradas</span>
              <h3>Fuentes oficiales y evidencia pública</h3>
            </div>
            <span>{analysis.evidence.length} resultado(s)</span>
          </div>
          <div className={styles.evidenceList}>
            {analysis.evidence.map((item, index) => {
              const match = analysis.screening?.matches.find((candidate) =>
                candidate.url === item.url || item.title.toLowerCase().includes(candidate.name.toLowerCase()),
              );
              return <EvidenceDisclosure key={`${item.url}-${index}`} item={item} match={match} />;
            })}
          </div>
          <small>Primero revisa el detalle recuperado aquí. Después abre la fuente original para confirmar el contexto completo.</small>
        </div>
      ) : null}

      {analysis.sourceAudit?.length ? (
        <div className={styles.auditSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.kicker}>Mapa de cobertura</span>
              <h3>Qué se consultó y qué quedó fuera</h3>
            </div>
          </div>
          <div className={styles.auditGrid}>
            {analysis.sourceAudit.map((item) => (
              <div key={`${item.status}-${item.name}`} className={styles[`audit_${item.status}`]}>
                <span>{auditStatusLabel(item.status)}</span>
                <strong>{item.name}</strong>
                <p>{item.reason}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.recommendation}>
        <span>Próximo paso recomendado</span>
        <p>{analysis.recommendation}</p>
      </div>

      <div className={styles.researchBox}>
        <div className={styles.assistantHeading}>
          <div>
            <span className={styles.kicker}>Investigación ampliada con Croma</span>
            <p>
              Usa Croma Research y coteja registros oficiales de sanciones, cumplimiento y
              personas buscadas en América, Reino Unido y ONU. La cuota es limitada.
            </p>
          </div>
          <b className={`${styles.originBadge} ${styles.origin_croma_research}`}>Croma Research</b>
        </div>
        <form className={styles.researchForm} onSubmit={runResearch}>
          <label>
            <span>Persona o empresa exacta</span>
            <input
              value={researchSubject}
              onChange={(event) => setResearchSubject(event.target.value)}
              placeholder="Nombre completo o razón social"
              required
            />
          </label>
          <label>
            <span>Dato para distinguir homónimos</span>
            <input
              value={identifyingDetail}
              onChange={(event) => setIdentifyingDetail(event.target.value)}
              placeholder="RFC, fecha de nacimiento, nacionalidad u otro dato"
            />
          </label>
          <button type="submit" disabled={researchLoading}>
            {researchLoading ? "Investigando…" : "Iniciar investigación ampliada"}
          </button>
        </form>
        <p className={styles.researchNotice}>
          Una coincidencia de nombre no confirma identidad, participación delictiva ni condena.
          El resultado no es exhaustivo y siempre exige revisión de la fuente primaria.
        </p>
        {researchError && <div className={styles.assistantError}>{researchError}</div>}
        {researchResult && (
          <div className={styles.researchResult}>
            <div className={styles.researchMeta}>
              <span>{researchResult.pagesAnalyzed ?? "—"} páginas analizadas</span>
              <span>{researchResult.sources.length} fuentes citadas</span>
              <span>{researchResult.possibleMentions.length} posibles boletines</span>
              <span>{researchResult.directUsScreening.matches.length} coincidencias oficiales</span>
              <span>{researchResult.officialUsResults.length} resultados oficiales adicionales</span>
            </div>
            <div className={styles.researchReport}>{researchResult.report}</div>
            <div className={styles.directScreening}>
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.kicker}>Cotejo directo</span>
                  <h3>Sanciones y cumplimiento oficiales</h3>
                </div>
                <span>{researchResult.directUsScreening.matches.length} coincidencia(s)</span>
              </div>
              <div className={styles.directCoverage}>
                {researchResult.directUsScreening.coverage.map((source) => (
                  <a key={source.source} href={source.url} target="_blank" rel="noreferrer">
                    <span>{source.mode === "complete_official_list" ? "Registro completo" : "Búsqueda oficial"}</span>
                    <strong>{source.source}</strong>
                    <p>{source.records ? `${source.records.toLocaleString("es")} registros · ` : ""}{source.note}</p>
                  </a>
                ))}
              </div>
              {researchResult.directUsScreening.matches.length ? (
                <div className={styles.directMatches}>
                  {researchResult.directUsScreening.matches.map((match) => (
                    <details key={`${match.source}-${match.name}`}>
                      <summary>
                        <span>{match.matchType === "linked_relationship" ? `${match.source} · Relación “Linked To” publicada` : `${match.source} · ${match.confidence === "strong" ? "Registro directo con dato adicional" : "Posible registro directo"}`}</span>
                        <strong>{match.name}</strong>
                        <small>Ver información en esta página</small>
                      </summary>
                      <div>
                        {match.aliases.length > 0 && <p>Alias: {match.aliases.join(", ")}</p>}
                        {Boolean(match.relatedTo?.length) && <p>Personas o entidades vinculadas en la ficha: {match.relatedTo?.join(", ")}</p>}
                        <p>{match.matchBasis.join(" · ")}{match.matchType === "linked_relationship" ? " · Esta relación no equivale por sí sola a una designación independiente." : match.corroboratingDetails.length ? ` · Datos cotejados: ${match.corroboratingDetails.join(", ")}` : " · Sin segundo identificador corroborado"}</p>
                        {Boolean(match.programs?.length) && <p>Programa oficial: {match.programs?.join(", ")}</p>}
                        {Boolean(match.identifiers?.length) && <p>Datos publicados por la fuente: {match.identifiers?.join(" ")}</p>}
                        <a href={match.url} target="_blank" rel="noreferrer">Abrir la fuente oficial</a>
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <p className={styles.noDirectMatches}>
                  Sin coincidencias exactas de nombre o alias en los registros completos consultados. Esto no descarta riesgos ni sustituye otras fuentes.
                </p>
              )}
            </div>
            <div className={styles.coverageRequested}>
              <strong>Cobertura solicitada a Croma</strong>
              <ul>{researchResult.requestedCoverage.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            {researchResult.officialUsResults.length > 0 && (
              <div className={styles.possibleMentions}>
                <strong>Resultados en dominios oficiales de EE. UU.; requieren cotejo de identidad</strong>
                {researchResult.officialUsResults.map((item) => (
                  <a key={item.url} href={item.url} target="_blank" rel="noreferrer">
                    <span>Croma Web Search · fuente oficial de EE. UU.</span>
                    <b>{item.title}</b>
                  </a>
                ))}
              </div>
            )}
            {researchResult.possibleMentions.length > 0 && (
              <div className={styles.possibleMentions}>
                <strong>Posibles menciones en boletines; requieren cotejo</strong>
                {researchResult.possibleMentions.map((item) => (
                  <a key={`${item.office}-${item.url}`} href={item.url} target="_blank" rel="noreferrer">
                    <span>{item.office}</span>
                    <b>{item.title}</b>
                  </a>
                ))}
              </div>
            )}
            <div className={styles.citations}>
              {researchResult.sources.map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>
              ))}
            </div>
            <small>{researchResult.disclaimer}</small>
          </div>
        )}
      </div>

      <div className={styles.assistantBox}>
        <div className={styles.assistantHeading}>
          <div>
            <span className={styles.kicker}>Asistente con OpenAI</span>
            <p>
              Explica el reporte y puede buscar evidencia pública. Croma sigue siendo la
              fuente estructurada; la IA no confirma identidades ni sustituye a SAT.
            </p>
          </div>
          {openAIKey && (
            <button type="button" className={styles.disconnectButton} onClick={disconnectOpenAI}>
              Desconectar
            </button>
          )}
        </div>

        {!openAIKey ? (
          <form className={styles.keyForm} onSubmit={connectOpenAI}>
            <label>
              <span>Clave de la API de OpenAI</span>
              <input
                type="password"
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
                placeholder="sk-…"
                autoComplete="off"
                required
              />
            </label>
            <button type="submit">Conectar por esta sesión</button>
            <small>
              Necesitas una cuenta de API con facturación. La clave se mantiene solo en
              memoria hasta recargar la página, se envía cifrada por HTTPS y no se guarda.
            </small>
          </form>
        ) : (
          <>
            <div className={styles.connectionStatus}>OpenAI conectado para esta sesión</div>
            <div className={styles.assistantQuestions}>
              <button type="button" onClick={() => askAssistant("¿Qué significa esta señal y qué no permite concluir?")}>¿Qué significa la señal?</button>
              <button type="button" onClick={() => askAssistant("¿Qué documentos debo solicitar y cómo los cotejo?")}>¿Qué documentos debo pedir?</button>
              <button type="button" onClick={() => askAssistant(`Busca evidencia pública del identificador ${analysis.taxId ?? analysis.company} y separa fuentes oficiales de indicios no oficiales.`)}>Buscar evidencia pública</button>
            </div>

            {assistantMessages.length > 0 && (
              <div className={styles.chatLog}>
                {assistantMessages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={message.role === "user" ? styles.userMessage : styles.aiMessage}>
                    <strong>{message.role === "user" ? "Tú" : "OpenAI"}</strong>
                    <p>{message.text}</p>
                    {message.citations?.length ? (
                      <div className={styles.citations}>
                        {message.citations.map((citation) => (
                          <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer">{citation.title} ↗</a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                {assistantLoading && <div className={styles.aiMessage}><strong>OpenAI</strong><p>Consultando el reporte y fuentes públicas…</p></div>}
              </div>
            )}

            <form
              className={styles.chatForm}
              onSubmit={(event) => {
                event.preventDefault();
                void askAssistant(assistantQuestion);
              }}
            >
              <input
                value={assistantQuestion}
                onChange={(event) => setAssistantQuestion(event.target.value)}
                placeholder="Pregunta sobre la contraparte o las evidencias"
                maxLength={1000}
                disabled={assistantLoading}
              />
              <button type="submit" disabled={assistantLoading || !assistantQuestion.trim()}>
                Enviar
              </button>
            </form>
          </>
        )}
        {assistantError && <div className={styles.assistantError}>{assistantError}</div>}
      </div>

      <div className={styles.disclaimer}>
        Resultado generado con consultas reales mediante Croma. No constituye una
        acusación, una decisión legal ni una evaluación crediticia automatizada. Cada
        fuente tiene límites de cobertura que deben considerarse.
      </div>

      <div className={styles.reportActions}>
        <button type="button" className={styles.resetButton} onClick={onReset}>
          Iniciar otra revisión
        </button>
        <button type="button" className={styles.exportButton} onClick={() => downloadReport(analysis)}>
          Descargar reporte
        </button>
        <button type="button" className={styles.exportButton} onClick={() => window.print()}>
          Imprimir / PDF
        </button>
      </div>
    </section>
  );
}

function ReportList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "positive" | "alert" | "neutral";
}) {
  return (
    <div className={`${styles.reportCard} ${styles[tone]}`}>
      <h3>{title}</h3>
      {items.length ? (
        <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : (
        <p className={styles.noSignals}>Sin señales en esta categoría.</p>
      )}
    </div>
  );
}

function downloadReport(analysis: Analysis) {
  const section = (title: string, items: string[]) =>
    `## ${title}\n${items.length ? items.map((item) => `- ${item}`).join("\n") : "- Sin señales."}`;
  const content = [
    `# Revisión de contraparte: ${analysis.company}`,
    `**País:** ${analysis.country}`,
    `**Identificación fiscal:** ${analysis.taxId ?? "No disponible"}`,
    `**Relación:** ${analysis.relationship}`,
    `**Señal preliminar:** ${analysis.risk}`,
    `**Confianza de identidad:** ${analysis.confidence}%`,
    `**Consultado:** ${analysis.checkedAt}`,
    `\n${analysis.summary}`,
    section("Señales positivas", analysis.positives),
    section("Señales a revisar", analysis.alerts),
    section("Información faltante", analysis.missing),
    `## Próximo paso\n${analysis.recommendation}`,
    `## Fuentes\n${analysis.sources.map((source) => `- ${source.name}: ${source.status}${source.coverage ? ` — ${source.coverage}` : ""}${source.url ? ` (${source.url})` : ""}`).join("\n")}`,
    "\n> Este reporte no constituye una acusación, decisión legal ni evaluación crediticia automatizada.",
  ].join("\n\n");
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `reporte-${analysis.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "contraparte"}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function originLabel(origin?: Analysis["sources"][number]["origin"]) {
  if (origin === "croma_web") return "Croma Web";
  if (origin === "croma_research") return "Croma Research";
  if (origin === "openai") return "OpenAI";
  if (origin === "public_manual") return "Fuente pública";
  if (origin === "local") return "Validación local";
  return "Croma API";
}

function auditStatusLabel(status: NonNullable<Analysis["sourceAudit"]>[number]["status"]) {
  if (status === "consulted") return "Consultada";
  if (status === "available") return "Disponible en revisión ampliada";
  return "No aplicable a esta consulta";
}

function riskClass(risk: Analysis["risk"], stylesMap: Record<string, string>) {
  if (risk === "Bajo") return stylesMap.riskLow;
  if (risk === "Alto") return stylesMap.riskHigh;
  if (risk === "Sin clasificar") return stylesMap.riskUnknown;
  return stylesMap.riskMedium;
}

function statusClass(status: string, stylesMap: Record<string, string>) {
  return /activa|activo|actualizado|vigente/i.test(status)
    ? stylesMap.statusGood
    : stylesMap.statusMuted;
}
