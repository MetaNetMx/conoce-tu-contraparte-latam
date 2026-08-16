import { NextResponse } from "next/server";
import { cromaFetch } from "@/lib/croma";
import { screenDirectUsLists, type DirectScreeningMatch } from "@/lib/us-screening";
import type { Analysis, SearchCandidate } from "@/lib/types";

export type { Analysis } from "@/lib/types";

export const maxDuration = 60;

type RuesEntity = {
  nit: string | null;
  name: string;
  chamber_name: string;
  registration_status: string;
  legal_organization: string;
  last_renewed_year: string | null;
  detail?: { primary_activity?: { description?: string | null } | null } | null;
};

type SiemEstablishment = {
  establishment_id: string;
  commercial_name: string;
  chamber: string;
  state: string;
  state_code: number;
};

type SiemDetail = {
  found?: boolean;
  establishment?: {
    rfc?: string | null;
    legal_name?: string | null;
    person_name?: string | null;
    commercial_name?: string | null;
    main_activity?: string | null;
    state?: string | null;
    status?: string | null;
    registration_date?: string | null;
    updated_date?: string | null;
    expiration_date?: string | null;
    profile?: { chamber?: string | null; government_supplier?: boolean | null } | null;
  } | null;
};

type SunatDetail = {
  found?: boolean;
  ruc?: string;
  name?: string;
  type?: string | null;
  trade_name?: string | null;
  status?: string | null;
  condition?: string | null;
  registration_date?: string | null;
  activities_start_date?: string | null;
  economic_activities?: Array<{ description?: string | null; type?: string | null }>;
};

type SanctionsResponse = { count?: number; sanctions?: unknown[] };
type SatLimaResponse = {
  found?: boolean;
  clear?: boolean;
  summary?: { total?: number | null; items_count?: number | null };
  debts?: unknown[];
};

type CromaWebResult = {
  url?: string;
  title?: string;
  published_at?: string | null;
  author?: string | null;
  highlights?: string[];
  score?: number | null;
};

function noData(candidate: SearchCandidate, relationship: string): Analysis {
  return {
    company: candidate.name,
    country: candidate.country,
    taxId: candidate.taxId,
    relationship,
    confidence: 30,
    risk: "Sin clasificar",
    summary: "No fue posible recuperar el detalle de la entidad seleccionada.",
    positives: [],
    alerts: ["La identidad necesita validación documental adicional."],
    missing: ["Documento oficial actualizado."],
    recommendation: "Confirma la identificación fiscal y vuelve a intentar la revisión.",
    dataMode: "real",
      checkedAt: new Date().toISOString(),
    sources: [{
      name: candidate.source,
      status: "Detalle no disponible",
      origin: "croma_official",
    }],
  };
}

function buildSourceAudit(analysis: Analysis): NonNullable<Analysis["sourceAudit"]> {
  const consulted: NonNullable<Analysis["sourceAudit"]> = analysis.sources.map((source) => ({
    name: source.name,
    status: source.origin === "public_manual" ? "available" : "consulted",
    reason: `${source.status}${source.coverage ? ` · ${source.coverage}` : ""}`,
    origin: source.origin === "local"
      ? "local"
      : source.origin === "public_manual"
        ? "public"
        : source.origin === "openai"
          ? "openai"
          : "croma",
  }));

  consulted.push(
    {
      name: "Croma Research",
      status: "available",
      reason: "Investigación ampliada opcional con fuentes en vivo y citas; tiene cuota limitada.",
      origin: "croma",
    },
    {
      name: "Listas globales oficiales",
      status: "available",
      reason: "OFAC, FBI, Reino Unido, ONU, Canadá y FinCEN se cotejan directamente; UE, DEA, Marshals, ICE, State, DOJ y fuentes LatAm se revisan como cobertura oficial complementaria.",
      origin: "public",
    },
  );

  if (analysis.country === "México") {
    consulted.push(
      {
        name: "Fiscalías de México · Croma",
        status: "available",
        reason: "Solo en investigación ampliada. Son boletines de prensa, no antecedentes ni condenas.",
        origin: "croma",
      },
      {
        name: "SIEM y dominios oficiales de México · segunda pasada",
        status: analysis.sources.some((source) => source.name === "Segunda pasada nacional de México") ? "consulted" : "available",
        reason: analysis.sources.some((source) => source.name === "Segunda pasada nacional de México")
          ? "Se regeneró la consulta nacional usando la razón social e identificadores publicados por la lista internacional."
          : "Se activa automáticamente cuando una lista internacional aporta una razón social o RFC relacionado.",
        origin: "croma",
      },
    );
  } else if (analysis.country === "Colombia") {
    consulted.push({
      name: "Otras fuentes personales y vehiculares · Croma",
      status: "not_applicable",
      reason: "Requieren una persona, placa o dato distinto al NIT de la empresa revisada.",
      origin: "croma",
    });
  } else if (analysis.country === "Perú") {
    consulted.push({
      name: "Fuentes vehiculares y personales · Croma",
      status: "not_applicable",
      reason: "Requieren placa, DNI u otro identificador que no forma parte de esta revisión empresarial.",
      origin: "croma",
    });
  }
  return consulted;
}

async function mexicoNationalSecondPass(
  analysis: Analysis,
  matches: DirectScreeningMatch[],
): Promise<Analysis> {
  if (analysis.country !== "México" || !matches.length) return analysis;
  const officialMatch = matches.find((match) => match.source === "OFAC") ?? matches[0];
  const isIndividual = officialMatch.description?.toLowerCase() === "individual";
  const publishedText = [officialMatch.name, ...(officialMatch.identifiers ?? [])].join(" ");
  const detectedRfc = publishedText.toUpperCase().match(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/)?.[0]
    ?? analysis.taxId?.toUpperCase().match(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/)?.[0]
    ?? null;
  const exactName = officialMatch.name;
  const officialQuery = [
    detectedRfc ? `"${detectedRfc}"` : "",
    `"${exactName}"`,
    "(site:gob.mx OR site:dof.gob.mx OR site:sat.gob.mx OR site:siem.economia.gob.mx)",
  ].filter(Boolean).join(" ");
  try {
    const [siemOutcome, officialWebOutcome] = await Promise.allSettled([
      isIndividual
        ? Promise.resolve({ establishments: [] as SiemEstablishment[] })
        : cromaFetch<{ establishments?: SiemEstablishment[]; pagination?: { total?: number } }>(
            "/mx/siem/establishments/v1",
            { name: exactName, page: 1 },
          ),
      cromaFetch<{ results?: CromaWebResult[] }>(
        "/global/web-search/v1",
        { query: officialQuery.slice(0, 300), limit: 10 },
      ),
    ]);
    const siemFailed = siemOutcome.status === "rejected";
    const officialWebFailed = officialWebOutcome.status === "rejected";
    const siemResults = siemOutcome.status === "fulfilled" ? siemOutcome.value.establishments ?? [] : [];
    const officialResults = (officialWebOutcome.status === "fulfilled" ? officialWebOutcome.value.results ?? [] : []).filter((item): item is CromaWebResult & { url: string } => {
      if (!item.url?.startsWith("http")) return false;
      try {
        const hostname = new URL(item.url).hostname.toLowerCase();
        return hostname.endsWith(".gob.mx") || hostname === "gob.mx";
      } catch {
        return false;
      }
    });
    const evidence = [...(analysis.evidence ?? [])];
    for (const establishment of siemResults.slice(0, 5)) {
      evidence.push({
        title: `SIEM México: ${establishment.commercial_name}`,
        url: "https://siem.economia.gob.mx/",
        snippet: `Resultado nacional recuperado después de detectar la relación internacional. Cámara: ${establishment.chamber}. Estado: ${establishment.state}. Identificador SIEM: ${establishment.establishment_id}.`,
        origin: "croma_official",
      });
    }
    for (const item of officialResults) {
      evidence.push({
        title: item.title ?? "Resultado oficial de México",
        url: item.url,
        snippet: (item.highlights?.[0] ?? `Resultado localizado por razón social${detectedRfc ? ` y RFC ${detectedRfc}` : ""} en un dominio oficial mexicano.`).slice(0, 1000),
        origin: "croma_web",
      });
    }
    const sources: Analysis["sources"] = [...analysis.sources, {
      name: "Segunda pasada nacional de México",
      status: `${isIndividual ? "SIEM no aplica a personas" : siemFailed ? "SIEM no disponible" : `${siemResults.length} resultado(s) SIEM`} · ${officialWebFailed ? "búsqueda oficial web no disponible" : `${officialResults.length} resultado(s) en dominios oficiales`}`,
      coverage: `Consulta regenerada con ${isIndividual ? "el nombre" : "la razón social"} publicado por ${officialMatch.source}${detectedRfc ? ` y el RFC ${detectedRfc}` : ""}.`,
      url: "https://www.gob.mx/",
      origin: "croma_official" as const,
    }];
    if (detectedRfc) sources.push({
      name: "SAT · verificación pública de RFC",
      status: "Revisión manual requerida",
      coverage: "SAT utiliza controles interactivos y no ofrece en este flujo una confirmación automatizada de situación fiscal o titularidad.",
      url: "https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/index.jsf",
      origin: "public_manual",
    });
    return {
      ...analysis,
      taxId: analysis.taxId ?? detectedRfc,
      summary: `${analysis.summary} Se regeneró una búsqueda nacional con ${isIndividual ? "el nombre oficial" : "la razón social oficial"}${detectedRfc ? ` y el RFC ${detectedRfc}` : ""}: ${isIndividual ? "SIEM no aplica a personas" : siemFailed ? "SIEM no estuvo disponible" : `${siemResults.length} resultado(s) SIEM`} y ${officialWebFailed ? "la búsqueda en dominios gubernamentales no estuvo disponible" : `${officialResults.length} resultado(s) en dominios gubernamentales mexicanos`}.`,
      evidence,
      sources,
      missing: detectedRfc
        ? Array.from(new Set([...analysis.missing, "Constancia de situación fiscal o validación interactiva directa ante SAT."]))
        : analysis.missing,
    };
  } catch (error) {
    console.error("Mexico national second pass failed", error);
    return {
      ...analysis,
      sources: [...analysis.sources, {
        name: "Segunda pasada nacional de México",
        status: "No disponible temporalmente",
        coverage: detectedRfc ? `Se intentó con RFC ${detectedRfc} y razón social oficial.` : `Se intentó con ${isIndividual ? "el nombre oficial" : "la razón social oficial"}.`,
        url: "https://www.gob.mx/",
        origin: "croma_official",
      }],
    };
  }
}

async function enrichWithDirectScreening(analysis: Analysis): Promise<Analysis> {
  const screening = await screenDirectUsLists(analysis.company, analysis.taxId ?? "");
  const designationMatches = screening.matches.filter((match) => match.matchType !== "linked_relationship");
  const relationshipMatches = screening.matches.filter((match) => match.matchType === "linked_relationship");
  const strongMatches = designationMatches.filter((match) => match.confidence === "strong");
  const possibleMatches = designationMatches.filter((match) => match.confidence === "possible");
  const matchEvidence = screening.matches.slice(0, 15).map((match) => ({
    title: match.matchType === "linked_relationship" ? `OFAC · entidad relacionada: ${match.name}` : `${match.source}: ${match.name}`,
    url: match.url,
    snippet: [
      match.matchBasis.join(" "),
      match.programs?.length ? `Programa: ${match.programs.join(", ")}` : "",
      match.matchType === "linked_relationship" ? "Esta tarjeta describe una relación publicada; no una designación independiente de la persona buscada" : "Registro directo de la persona o empresa consultada",
      match.relatedTo?.length ? `Linked To: ${match.relatedTo.join(", ")}` : "",
      match.identifiers?.length ? `Datos del registro: ${match.identifiers.join(" ")}` : "",
      match.aliases.length ? `Alias: ${match.aliases.join(", ")}` : "",
    ].filter(Boolean).join(". "),
    origin: "public_manual" as const,
  }));
  const evidence = [...(analysis.evidence ?? [])];
  for (const item of matchEvidence) {
    const existingIndex = evidence.findIndex((existing) => existing.url === item.url);
    if (existingIndex < 0) evidence.unshift(item);
    else if (item.snippet.length > evidence[existingIndex].snippet.length) evidence[existingIndex] = item;
  }
  const sources = [...analysis.sources];
  for (const source of screening.coverage) {
    if (!sources.some((existing) => existing.name === source.source)) {
      sources.push({
        name: source.source,
        status: source.status === "consulted"
          ? `${source.records ? `${source.records.toLocaleString("es")} registros · ` : ""}${source.mode === "complete_official_list" ? "lista completa consultada" : "búsqueda oficial complementaria"}`
          : "Fuente temporalmente no disponible",
        coverage: source.note,
        url: source.url,
        origin: "public_manual",
      });
    }
  }
  const newAlerts = screening.matches.map((match) => match.matchType === "linked_relationship"
    ? `${match.source}: el registro de ${match.name} menciona a la persona consultada en “Linked To”. Esto documenta una relación publicada, no una designación independiente.`
    : `${match.source}: ${match.name}. ${match.matchBasis.join(" ")}${match.corroboratingDetails.length ? ` Datos coincidentes: ${match.corroboratingDetails.join(", ")}.` : " Sin segundo identificador corroborado; puede ser un homónimo."}`,
  );
  const enriched: Analysis = {
    ...analysis,
    risk: strongMatches.length ? "Alto" : (possibleMatches.length || relationshipMatches.length) && analysis.risk !== "Alto" ? "Medio" : analysis.risk,
    confidence: strongMatches.length ? Math.max(analysis.confidence, 78) : possibleMatches.length ? Math.max(analysis.confidence, 42) : analysis.confidence,
    summary: designationMatches.length && relationshipMatches.length
      ? `OFAC devolvió ${designationMatches.length} registro(s) directo(s) de la persona o empresa consultada y ${relationshipMatches.length} registro(s) adicionales que la mencionan como “Linked To”. Las relaciones se muestran por separado y no equivalen por sí solas a una designación. ${analysis.summary}`
      : strongMatches.length
        ? `Alerta: ${strongMatches.length} coincidencia(s) oficial(es) con dato adicional. ${analysis.summary}`
        : possibleMatches.length
          ? `Atención: ${possibleMatches.length} posible(s) registro(s) directo(s) en listas oficiales; la identidad requiere cotejo. ${analysis.summary}`
          : relationshipMatches.length
            ? `Se localizaron ${relationshipMatches.length} relación(es) publicadas por OFAC. No equivalen por sí solas a una designación de la persona buscada. ${analysis.summary}`
            : analysis.summary,
    alerts: Array.from(new Set([...newAlerts, ...analysis.alerts])),
    evidence,
    sources,
    screening: {
      checkedAt: screening.checkedAt,
      matches: screening.matches,
      coverage: screening.coverage,
    },
  };
  return mexicoNationalSecondPass(enriched, screening.matches);
}

async function enrichWithCromaWeb(input: Analysis): Promise<Analysis> {
  const analysis = await enrichWithDirectScreening(input);
  const identity = analysis.taxId
    ? `"${analysis.taxId}" ${analysis.company.startsWith("RFC ") ? "" : `"${analysis.company}"`}`
    : `"${analysis.company}" ${analysis.country}`;
  try {
    const data = await cromaFetch<{ results?: CromaWebResult[] }>(
      "/global/web-search/v1",
      { query: identity.trim().slice(0, 300), limit: 5 },
    );
    const evidence = (data.results ?? [])
      .filter((item): item is CromaWebResult & { url: string } => Boolean(item.url?.startsWith("http")))
      .map((item) => ({
        title: item.title ?? "Resultado público",
        url: item.url,
        snippet: (item.highlights?.[0] ?? "Resultado indexado por Croma Web Search.").slice(0, 700),
        origin: "croma_web" as const,
      }));
    const enriched: Analysis = {
      ...analysis,
      evidence: [...(analysis.evidence ?? []), ...evidence],
      sources: [
        ...analysis.sources,
        {
          name: "Croma Web Search",
          status: evidence.length ? `${evidence.length} evidencia(s) pública(s)` : "Sin resultados relevantes",
          coverage: "Web pública indexada; los resultados requieren cotejo con fuentes primarias",
          url: "https://usecroma.com/es#sources",
          origin: "croma_web",
        },
      ],
    };
    return { ...enriched, sourceAudit: buildSourceAudit(enriched) };
  } catch {
    const enriched: Analysis = {
      ...analysis,
      sources: [
        ...analysis.sources,
        {
          name: "Croma Web Search",
          status: "No disponible o cuota alcanzada",
          coverage: "La falta de resultados no se interpreta como señal positiva",
          url: "https://usecroma.com/es#sources",
          origin: "croma_web",
        },
      ],
    };
    return { ...enriched, sourceAudit: buildSourceAudit(enriched) };
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    candidate?: SearchCandidate;
    relationship?: string;
  };
  const candidate = body.candidate;
  const relationship = body.relationship?.trim().slice(0, 80) || "Contraparte de negocio";
  if (!candidate?.sourceId || !["CO", "MX", "PE"].includes(candidate.country)) {
    return NextResponse.json({ error: "Selecciona una entidad válida." }, { status: 400 });
  }

  try {
    if (candidate.sourceId.startsWith("person:") || candidate.sourceId.startsWith("unregistered:")) {
      const isPerson = candidate.sourceId.startsWith("person:");
      const screening = await screenDirectUsLists(candidate.name, candidate.metadata?.identifyingDetail ?? "");
      const designationMatches = screening.matches.filter((match) => match.matchType !== "linked_relationship");
      const relationshipMatches = screening.matches.filter((match) => match.matchType === "linked_relationship");
      const strongMatches = designationMatches.filter((match) => match.confidence === "strong");
      const possibleMatches = designationMatches.filter((match) => match.confidence === "possible");
      const risk: Analysis["risk"] = strongMatches.length ? "Alto" : possibleMatches.length || relationshipMatches.length ? "Medio" : "Sin clasificar";
      const countryName = candidate.country === "CO" ? "Colombia" : candidate.country === "MX" ? "México" : "Perú";
      const result: Analysis = {
        company: candidate.name,
        country: countryName,
        taxId: candidate.taxId,
        relationship,
        confidence: strongMatches.length ? 78 : possibleMatches.length ? 42 : 25,
        risk,
        summary: designationMatches.length && relationshipMatches.length
          ? `Se encontró ${designationMatches.length} registro(s) directo(s) y ${relationshipMatches.length} registro(s) de entidades que mencionan a la persona en “Linked To”.`
          : strongMatches.length
            ? `Se encontraron ${strongMatches.length} coincidencia(s) en registros oficiales con al menos un dato adicional corroborado.`
            : possibleMatches.length
              ? `Se encontraron ${possibleMatches.length} posible(s) registro(s) directo(s) por nombre o alias. La identidad todavía no está confirmada.`
              : relationshipMatches.length
                ? `Se encontraron ${relationshipMatches.length} relación(es) publicadas en registros oficiales; no equivalen por sí solas a una designación.`
                : `No se encontraron coincidencias exactas en los registros completos consultados. ${isPerson ? "La identidad de la persona" : "La identidad registral de la empresa"} sigue pendiente de validación.`,
        positives: [],
        alerts: [
          ...screening.matches.slice(0, 10).map((match) => match.matchType === "linked_relationship"
            ? `${match.source}: el registro de ${match.name} menciona a la persona consultada en “Linked To”. No equivale por sí solo a una designación independiente.`
            : `${match.source}: ${match.name}. ${match.matchBasis.join(" ")}${match.corroboratingDetails.length ? ` Datos coincidentes: ${match.corroboratingDetails.join(", ")}.` : " Sin segundo identificador corroborado; puede ser un homónimo."}`,
          ),
          ...(!screening.matches.length
            ? ["La ausencia de coincidencias no demuestra que la persona o empresa esté libre de riesgos."]
            : []),
        ],
        missing: [
          isPerson
            ? "Fecha de nacimiento, nacionalidad e identificador oficial para descartar homónimos."
            : "Registro fiscal, razón social exacta y documentos corporativos para confirmar identidad.",
        ],
        recommendation: strongMatches.length
          ? "No avances sin cotejar el registro primario y revisar la coincidencia con legal o cumplimiento."
          : possibleMatches.length
            ? "Aporta un segundo identificador y revisa cada fuente primaria antes de tomar una decisión."
            : "Continúa con Croma Research, evidencia pública y documentación oficial; no interpretes la ausencia como aprobación.",
        dataMode: "real",
        checkedAt: screening.checkedAt,
        evidence: screening.matches.slice(0, 15).map((match) => ({
          title: match.matchType === "linked_relationship" ? `OFAC · entidad relacionada: ${match.name}` : `${match.source}: ${match.name}`,
          url: match.url,
          snippet: `${match.matchBasis.join(" ")}. ${match.description ?? "Registro oficial"}${match.programs?.length ? ` · Programa: ${match.programs.join(", ")}` : ""}${match.relatedTo?.length ? ` · Linked To: ${match.relatedTo.join(", ")}` : ""}`,
          origin: "public_manual" as const,
        })),
        sources: screening.coverage.map((source) => ({
          name: source.source,
          status: source.status === "consulted"
            ? `${source.records ? `${source.records.toLocaleString("es")} registros · ` : ""}${source.mode === "complete_official_list" ? "lista completa consultada" : "búsqueda oficial complementaria"}`
            : "Fuente temporalmente no disponible",
          coverage: source.note,
          url: source.url,
          origin: "public_manual" as const,
        })),
      };
      return NextResponse.json(await enrichWithCromaWeb(result));
    }

    if (candidate.country === "CO") {
      if (!candidate.taxId) {
        const result: Analysis = {
          company: candidate.name,
          country: "Colombia",
          taxId: null,
          relationship,
          confidence: 65,
          risk: "Sin clasificar",
          summary:
            "Seleccionaste una coincidencia de RUES, pero no tiene NIT público para confirmar identidad y consultar señales adicionales.",
          positives: [
            ...(candidate.status ? [`Estado reportado: ${candidate.status}.`] : []),
            ...(candidate.location ? [`Cámara de comercio: ${candidate.location}.`] : []),
          ],
          alerts: ["No se asigna riesgo sin una identificación fiscal concluyente."],
          missing: ["NIT y certificado de existencia actualizado."],
          recommendation: "Solicita el NIT antes de tomar una decisión comercial.",
          dataMode: "real",
      checkedAt: new Date().toISOString(),
          sources: [{
            name: "RUES · Croma",
            status: "Coincidencia seleccionada",
            coverage: "Registro empresarial de Colombia",
            url: "https://www.rues.org.co/",
          }],
        };
        return NextResponse.json(await enrichWithCromaWeb(result));
      }

      const normalizedNit =
        candidate.taxId.replace(/\D/g, "").replace(/^0+/, "") || "0";
      const [registry, sanctions] = await Promise.all([
        cromaFetch<{ found?: boolean; entity?: RuesEntity | null }>(
          "/co/rues/entity-by-nit/v1",
          { document_number: normalizedNit },
        ),
        cromaFetch<SanctionsResponse>("/co/secop/sanctions-by-provider/v1", {
          document_number: normalizedNit,
        }),
      ]);
      const entity = registry.found ? registry.entity : null;
      if (!entity) return NextResponse.json(await enrichWithCromaWeb(noData(candidate, relationship)));

      const sanctionsCount = sanctions.count ?? sanctions.sanctions?.length ?? 0;
      const active = entity.registration_status.toUpperCase().includes("ACTIVA");
      const risk: Analysis["risk"] = sanctionsCount > 0 || !active ? "Alto" : "Bajo";
      const activity = entity.detail?.primary_activity?.description;

      const result: Analysis = {
        company: entity.name,
        country: "Colombia",
        taxId: entity.nit,
        relationship,
        confidence: 96,
        risk,
        summary: "Identidad confirmada por NIT en RUES y contrastada con sanciones SECOP.",
        positives: [
          `Estado registral: ${entity.registration_status}.`,
          `Cámara de comercio: ${entity.chamber_name}.`,
          ...(entity.last_renewed_year
            ? [`Último año renovado: ${entity.last_renewed_year}.`]
            : []),
          ...(activity ? [`Actividad principal: ${activity}.`] : []),
          ...(sanctionsCount === 0 ? ["Sin sanciones encontradas en la consulta SECOP."] : []),
        ],
        alerts: [
          ...(!active ? ["El estado registral no aparece activo."] : []),
          ...(sanctionsCount > 0
            ? [`SECOP reporta ${sanctionsCount} sanción(es) asociada(s).`]
            : []),
        ],
        missing: ["Referencias comerciales y documentos aportados por la contraparte."],
        recommendation:
          risk === "Alto"
            ? "Revisa los hallazgos con legal o cumplimiento antes de avanzar."
            : "Continúa con la validación documental y contractual habitual.",
        dataMode: "real",
      checkedAt: new Date().toISOString(),
        sources: [
          {
            name: "RUES · Croma",
            status: "Identidad confirmada",
            coverage: "Registro empresarial de Colombia",
            url: "https://www.rues.org.co/",
          },
          {
            name: "SECOP sanciones · Croma",
            status: sanctionsCount ? `${sanctionsCount} resultado(s)` : "Sin resultados",
            coverage: "Multas y sanciones registradas contra contratistas del Estado",
            url: "https://www.colombiacompra.gov.co/",
          },
        ],
      };
      return NextResponse.json(await enrichWithCromaWeb(result));
    }

    if (candidate.country === "MX") {
      if (candidate.sourceId.startsWith("rfc:")) {
        const rfc = candidate.taxId ?? candidate.sourceId.slice(4);
        const encodedDate = candidate.metadata?.encodedDate;
        const siemMatches = Number(candidate.metadata?.siemMatches ?? 0);
        const result: Analysis = {
          company: `RFC ${rfc}`,
          country: "México",
          taxId: rfc,
          relationship,
          confidence: 45,
          risk: "Sin clasificar",
          summary:
            "El RFC tiene una estructura y fecha plausibles. No fue posible confirmar automáticamente su inscripción ante SAT ni asociarlo de forma concluyente con una razón social.",
          positives: [
            "La longitud y estructura corresponden al formato mexicano de RFC.",
            ...(encodedDate ? [`Fecha codificada en el RFC: ${encodedDate}.`] : []),
          ],
          alerts: [
            "Una estructura válida no demuestra que el RFC exista, esté activo o pertenezca a la empresa indicada.",
            ...(siemMatches
              ? [`SIEM devolvió ${siemMatches} coincidencia(s) al consultar el RFC como texto; deben verificarse manualmente.`]
              : ["SIEM no devolvió coincidencias al consultar el RFC como texto."]),
          ],
          missing: [
            "Constancia de situación fiscal emitida por SAT.",
            "Razón social completa y domicilio fiscal para cotejo.",
          ],
          recommendation:
            "Solicita la constancia de situación fiscal y verifica el RFC directamente en SAT. Usa el asistente con OpenAI solo para localizar evidencia pública adicional, no como confirmación oficial.",
          dataMode: "real",
          checkedAt: new Date().toISOString(),
          sources: [
            {
              name: "Validación estructural",
              status: "Formato y fecha plausibles; existencia no confirmada",
              origin: "local",
              coverage: "Sintaxis del RFC mexicano únicamente",
            },
            {
              name: "SIEM · Croma",
              status: siemMatches ? `${siemMatches} coincidencia(s) textual(es)` : "Sin coincidencias por RFC",
              origin: "croma_official",
              coverage: "Directorio voluntario; no ofrece búsqueda oficial directa por RFC",
              url: "https://siem.economia.gob.mx/",
            },
            {
              name: "SAT",
              status: "Verificación oficial pendiente",
              origin: "public_manual",
              coverage: "La comprobación definitiva debe realizarse ante SAT",
              url: "https://www.sat.gob.mx/",
            },
            {
              name: "Búsqueda pública exacta",
              status: "Disponible para investigación complementaria",
              origin: "public_manual",
              coverage: "Resultados web no oficiales que requieren cotejo",
              url: `https://www.google.com/search?q=${encodeURIComponent(`"${rfc}"`)}`,
            },
          ],
        };
        return NextResponse.json(await enrichWithCromaWeb(result));
      }

      const data = await cromaFetch<SiemDetail>("/mx/siem/establishment/v1", {
        establishment_id: candidate.sourceId,
      });
      const entity = data.found ? data.establishment : null;
      if (!entity) return NextResponse.json(await enrichWithCromaWeb(noData(candidate, relationship)));

      const current = /actualizado|vigente|activo/i.test(entity.status ?? "");
      const result: Analysis = {
        company: entity.legal_name || entity.commercial_name || candidate.name,
        country: "México",
        taxId: entity.rfc ?? null,
        relationship,
        confidence: entity.rfc ? 88 : 72,
        risk: "Sin clasificar",
        summary:
          "Perfil seleccionado y recuperado desde SIEM. Esta fuente es voluntaria y autodeclarada, por lo que no basta para asignar un riesgo concluyente.",
        positives: [
          ...(entity.commercial_name ? [`Nombre comercial: ${entity.commercial_name}.`] : []),
          ...(entity.status ? [`Estado SIEM: ${entity.status}.`] : []),
          ...(entity.main_activity ? [`Actividad declarada: ${entity.main_activity}.`] : []),
          ...(entity.state ? [`Estado: ${entity.state}.`] : []),
          ...(entity.registration_date ? [`Registro SIEM: ${entity.registration_date}.`] : []),
        ],
        alerts: [
          ...(!current && entity.status ? ["El registro SIEM no aparece actualizado o vigente."] : []),
          "SIEM es voluntario: presencia o ausencia no prueba legitimidad ni incumplimiento.",
        ],
        missing: [
          ...(entity.rfc ? [] : ["RFC declarado."]),
          "Constancia de situación fiscal y validaciones regulatorias aplicables.",
        ],
        recommendation:
          "Confirma el RFC y solicita documentación fiscal antes de cerrar la relación comercial.",
        dataMode: "real",
      checkedAt: new Date().toISOString(),
        sources: [{
          name: "SIEM · Croma",
          status: "Perfil seleccionado consultado",
          coverage: "Directorio voluntario y autodeclarado de establecimientos en México",
          url: "https://siem.economia.gob.mx/",
        }],
      };
      return NextResponse.json(await enrichWithCromaWeb(result));
    }

    const [data, satLima] = await Promise.all([
      cromaFetch<SunatDetail>("/pe/sunat/ruc/v1", {
        ruc: candidate.sourceId,
      }),
      cromaFetch<SatLimaResponse>("/pe/sat-lima/account-status/v1", {
        document_type: "ruc",
        document_number: candidate.sourceId,
      }),
    ]);
    if (!data.found) return NextResponse.json(await enrichWithCromaWeb(noData(candidate, relationship)));

    const active = (data.status ?? "").toUpperCase() === "ACTIVO";
    const habida = (data.condition ?? "").toUpperCase() === "HABIDO";
    const hasLimaDebt = satLima.found === true && satLima.clear === false;
    const risk: Analysis["risk"] = !active
      ? "Alto"
      : !habida || hasLimaDebt
        ? "Medio"
        : "Bajo";
    const activity = data.economic_activities?.find((item) =>
      /principal/i.test(item.type ?? ""),
    )?.description ?? data.economic_activities?.[0]?.description;

    const result: Analysis = {
      company: data.name || candidate.name,
      country: "Perú",
      taxId: data.ruc ?? candidate.taxId,
      relationship,
      confidence: 96,
      risk,
      summary: "Identidad tributaria confirmada por RUC en SUNAT.",
      positives: [
        `Estado SUNAT: ${data.status ?? "No reportado"}.`,
        `Condición: ${data.condition ?? "No reportada"}.`,
        ...(data.type ? [`Tipo de contribuyente: ${data.type}.`] : []),
        ...(data.trade_name ? [`Nombre comercial: ${data.trade_name}.`] : []),
        ...(activity ? [`Actividad principal: ${activity}.`] : []),
        ...(satLima.found && satLima.clear
          ? ["Sin deuda pendiente reportada por SAT Lima para el RUC consultado."]
          : []),
      ],
      alerts: [
        ...(!active ? ["El contribuyente no aparece con estado ACTIVO."] : []),
        ...(active && !habida ? ["La condición del domicilio no aparece como HABIDO."] : []),
        ...(hasLimaDebt
          ? [`SAT Lima reporta ${satLima.summary?.items_count ?? satLima.debts?.length ?? 0} obligación(es) pendiente(s), con cobertura limitada a Lima.`]
          : []),
      ],
      missing: ["Referencias comerciales y documentos aportados por la contraparte."],
      recommendation:
        risk === "Alto"
          ? "No avances sin aclarar el estado tributario y revisar con legal o cumplimiento."
          : risk === "Medio"
            ? "Aclara la condición tributaria o las obligaciones municipales encontradas antes de avanzar."
            : "Continúa con la validación documental y contractual habitual.",
      dataMode: "real",
      checkedAt: new Date().toISOString(),
      sources: [
        {
          name: "SUNAT · Croma",
          status: "Identidad por RUC confirmada",
          coverage: "Registro tributario nacional de Perú",
          url: "https://www.sunat.gob.pe/",
        },
        {
          name: "SAT Lima · Croma",
          status: satLima.found
            ? satLima.clear
              ? "Sin deuda pendiente reportada"
              : "Obligaciones pendientes reportadas"
            : "Sin cuenta resuelta",
          coverage: "Obligaciones municipales en la provincia de Lima únicamente",
          url: "https://www.sat.gob.pe/",
        },
      ],
    };
    return NextResponse.json(await enrichWithCromaWeb(result));
  } catch (error) {
    console.error("Croma analysis failed", error);
    return NextResponse.json(
      { error: "Croma no pudo completar el análisis. Intenta de nuevo." },
      { status: 502 },
    );
  }
}
