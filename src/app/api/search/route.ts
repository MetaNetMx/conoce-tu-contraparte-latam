import { NextResponse } from "next/server";
import { cromaFetch } from "@/lib/croma";
import { screenDirectUsLists, type DirectScreeningResult } from "@/lib/us-screening";
import type { CountryCode, SearchCandidate, SearchResult } from "@/lib/types";

export const maxDuration = 60;

type RuesEntity = {
  registry_id: string;
  nit: string | null;
  verification_digit: string | null;
  name: string;
  chamber_name: string;
  registration_status: string;
  legal_organization: string;
  last_renewed_year: string | null;
  detail?: {
    nit?: string | null;
    primary_activity?: { description?: string | null } | null;
  } | null;
};

type SiemEstablishment = {
  establishment_id: string;
  commercial_name: string;
  chamber: string;
  state: string;
  state_code: number;
};

type SunatContributor = {
  ruc: string;
  name: string;
  location: string;
  status: string;
};

type SunatDetail = {
  found?: boolean;
  ruc?: string;
  name?: string;
  status?: string | null;
  condition?: string | null;
  type?: string | null;
};

function normalizeRfc(value: string) {
  return value.toUpperCase().replace(/^RFC\s*:?[\s-]*/i, "").replace(/[\s-]/g, "");
}

function addGlobalScreeningCandidate(
  result: SearchResult,
  screening: DirectScreeningResult,
  query: string,
  country: CountryCode,
  mode: "name" | "id",
) {
  const matches = screening.matches;
  if (!matches.length && result.candidates.length) return result;
  const strongMatches = matches.filter((match) => match.confidence === "strong").length;
  const firstMatch = matches[0];
  const candidate: SearchCandidate = {
    country,
    sourceId: `unregistered:${country}:${encodeURIComponent(query)}`,
    taxId: mode === "id" ? normalizeRfc(query) : null,
    name: firstMatch?.name ?? query,
    status: strongMatches
      ? `${strongMatches} coincidencia(s) oficial(es) con identificador adicional`
      : matches.length
        ? `${matches.length} posible(s) coincidencia(s) en listas oficiales`
        : "Sin coincidencia registral; screening global disponible",
    location: country === "CO" ? "Colombia" : country === "MX" ? "México" : "Perú",
    subtitle: matches.length
      ? `${matches.map((match) => match.source).filter((value, index, all) => all.indexOf(value) === index).join(", ")} · revisar fuente primaria`
      : "Continuar con listas globales y evidencia pública",
    source: "Screening global oficial",
    metadata: {
      subjectType: "company",
      possibleMatches: String(matches.length),
      strongMatches: String(strongMatches),
      identifyingDetail: mode === "id" ? query : "",
      screenedAt: screening.checkedAt,
    },
  };
  return {
    ...result,
    candidates: [candidate, ...result.candidates],
    source: `${result.source} + screening global oficial`,
    disclaimer: matches.length
      ? `${matches.length} posible(s) coincidencia(s) oficial(es) detectada(s). Revisa identidad, identificadores y fuente primaria. ${result.disclaimer}`
      : `${result.disclaimer} Puedes continuar con el nombre ingresado a listas globales y evidencia pública.`,
  };
}

function rfcDetails(value: string) {
  const rfc = normalizeRfc(value);
  const match = rfc.match(/^([A-ZÑ&]{3,4})(\d{2})(\d{2})(\d{2})([A-Z0-9]{3})$/);
  if (!match) return null;
  const [, prefix, year, month, day] = match;
  const fullYear = Number(year) + (Number(year) <= new Date().getFullYear() % 100 ? 2000 : 1900);
  const date = new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== fullYear ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day) ||
    date > new Date()
  ) return null;
  return {
    rfc,
    kind: prefix.length === 3 ? "Persona moral" : "Persona física",
    date: date.toISOString().slice(0, 10),
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    country?: CountryCode;
    query?: string;
    mode?: "name" | "id";
    subjectType?: "company" | "person";
    identifyingDetail?: string;
  };
  const country = body.country;
  const mode = body.mode ?? "name";
  const subjectType = body.subjectType ?? "company";
  const identifyingDetail = body.identifyingDetail?.trim().slice(0, 300) ?? "";
  const query = body.query?.trim() ?? "";

  if (!country || !["CO", "MX", "PE"].includes(country)) {
    return NextResponse.json({ error: "Selecciona un país válido." }, { status: 400 });
  }
  if (mode === "name" && query.length < 3) {
    return NextResponse.json(
      { error: "Escribe al menos 3 caracteres del nombre empresarial." },
      { status: 400 },
    );
  }

  try {
    if (subjectType === "person") {
      const screening = await screenDirectUsLists(query, identifyingDetail);
      const possibleMatches = screening.matches.length;
      const strongMatches = screening.matches.filter((match) => match.confidence === "strong").length;
      const designationMatches = screening.matches.filter((match) => match.matchType !== "linked_relationship").length;
      const relationshipMatches = screening.matches.filter((match) => match.matchType === "linked_relationship").length;
      const candidate: SearchCandidate = {
        country,
        sourceId: `person:${encodeURIComponent(query)}`,
        taxId: null,
        name: query,
        status: designationMatches && relationshipMatches
          ? `${designationMatches} registro(s) directo(s) y ${relationshipMatches} relación(es) publicadas por OFAC`
          : strongMatches
            ? `${strongMatches} coincidencia(s) con dato adicional; requiere revisión`
            : designationMatches
              ? `${designationMatches} posible(s) registro(s) directo(s) oficial(es)`
              : relationshipMatches
                ? `${relationshipMatches} relación(es) publicadas; no equivalen a designación`
                : "Sin coincidencias exactas en listas completas",
        location: country === "CO" ? "Colombia" : country === "MX" ? "México" : "Perú",
        subtitle: "Persona · identidad pendiente de cotejo con datos adicionales",
        source: "Screening global oficial",
        metadata: {
          subjectType: "person",
          possibleMatches: String(possibleMatches),
          strongMatches: String(strongMatches),
          designationMatches: String(designationMatches),
          relationshipMatches: String(relationshipMatches),
          screenedAt: screening.checkedAt,
          identifyingDetail,
        },
      };
      const result: SearchResult = {
        query,
        country,
        mode: "name",
        candidates: [candidate],
        source: "OFAC, FBI, Reino Unido, ONU, Canadá, FinCEN y cobertura Croma",
        total: 1,
        capped: false,
        disclaimer: designationMatches && relationshipMatches
          ? "OFAC contiene un registro directo del nombre y otros registros que lo mencionan en el campo “Linked To”. El reporte separa designación y relación; revisa cada ficha oficial."
          : strongMatches
            ? "El nombre y al menos un dato adicional aparecen en un registro oficial. Analiza la fuente primaria antes de concluir identidad o tomar una decisión."
            : possibleMatches
              ? "Hay posibles coincidencias por nombre, alias o relación publicada. Debes revisar la ficha y aportar otro identificador antes de concluir identidad."
              : "No hubo coincidencias exactas en las listas completas consultadas. Esto no descarta otros riesgos ni sustituye la investigación ampliada.",
      };
      return NextResponse.json(result);
    }

    const companyScreening = await screenDirectUsLists(query, mode === "id" ? query : "");

    if (mode === "id") {
      if (country === "MX") {
        const details = rfcDetails(query);
        if (!details) {
          return NextResponse.json(
            { error: "El RFC no tiene una estructura y fecha válidas." },
            { status: 400 },
          );
        }
        const siem = await cromaFetch<{
          establishments?: SiemEstablishment[];
          pagination?: { total?: number };
        }>("/mx/siem/establishments/v1", { name: details.rfc, page: 1 });
        const siemCount = siem.pagination?.total ?? siem.establishments?.length ?? 0;
        const candidate: SearchCandidate = {
          country,
          sourceId: `rfc:${details.rfc}`,
          taxId: details.rfc,
          name: `RFC ${details.rfc}`,
          status: "Estructura válida; registro no confirmado",
          location: "México",
          subtitle: `${details.kind} · Fecha codificada ${details.date}`,
          source: "RFC + SIEM",
          metadata: {
            rfcKind: details.kind,
            encodedDate: details.date,
            siemMatches: String(siemCount),
          },
        };
        const result: SearchResult = {
          query,
          country,
          mode,
          candidates: [candidate],
          source: "Validación estructural + SIEM mediante Croma",
          total: 1,
          capped: false,
          disclaimer:
            "La estructura del RFC es válida, pero esto no confirma su inscripción en SAT ni la identidad de su titular. SIEM no permite búsqueda oficial directa por RFC.",
        };
        return NextResponse.json(addGlobalScreeningCandidate(result, companyScreening, query, country, mode));
      }

      if (country === "CO") {
        const documentNumber = query.replace(/\D/g, "").replace(/^0+/, "");
        if (documentNumber.length < 4) {
          return NextResponse.json({ error: "Ingresa un NIT válido." }, { status: 400 });
        }
        const data = await cromaFetch<{ found?: boolean; entity?: RuesEntity | null }>(
          "/co/rues/entity-by-nit/v1",
          { document_number: documentNumber },
        );
        const entity = data.found ? data.entity : null;
        const candidates: SearchCandidate[] = entity
          ? [{
              country,
              sourceId: entity.registry_id,
              taxId: entity.nit ?? documentNumber,
              name: entity.name,
              status: entity.registration_status,
              location: entity.chamber_name,
              subtitle: `${entity.legal_organization} · Cámara ${entity.chamber_name}`,
              source: "RUES",
              metadata: {
                renewedYear: entity.last_renewed_year,
                activity: entity.detail?.primary_activity?.description ?? null,
              },
            }]
          : [];
        const result: SearchResult = {
          query,
          country,
          mode,
          candidates,
          source: "RUES · Registro empresarial de Colombia",
          total: candidates.length,
          capped: false,
          disclaimer: candidates.length
            ? "Coincidencia exacta consultada por NIT."
            : "RUES no devolvió una entidad para ese NIT.",
        };
        return NextResponse.json(addGlobalScreeningCandidate(result, companyScreening, query, country, mode));
      }

      const ruc = query.replace(/\D/g, "");
      if (ruc.length !== 11) {
        return NextResponse.json({ error: "El RUC debe tener 11 dígitos." }, { status: 400 });
      }
      const data = await cromaFetch<SunatDetail>("/pe/sunat/ruc/v1", { ruc });
      const candidates: SearchCandidate[] = data.found
        ? [{
            country,
            sourceId: data.ruc ?? ruc,
            taxId: data.ruc ?? ruc,
            name: data.name ?? `RUC ${ruc}`,
            status: data.status ?? null,
            location: data.condition ?? null,
            subtitle: `${data.type ?? "Contribuyente"} · ${data.condition ?? "Condición no reportada"}`,
            source: "SUNAT",
          }]
        : [];
      const result: SearchResult = {
        query,
        country,
        mode,
        candidates,
        source: "SUNAT · Registro tributario de Perú",
        total: candidates.length,
        capped: false,
        disclaimer: candidates.length
          ? "Coincidencia exacta consultada por RUC."
          : "SUNAT no devolvió un contribuyente para ese RUC.",
      };
      return NextResponse.json(addGlobalScreeningCandidate(result, companyScreening, query, country, mode));
    }

    if (country === "CO") {
      const data = await cromaFetch<{
        entities?: RuesEntity[];
        capped?: boolean;
        pagination?: { total?: number };
      }>("/co/rues/entities-by-name/v1", { name: query, page: 1 });

      const candidates: SearchCandidate[] = (data.entities ?? []).map((entity) => ({
        country,
        sourceId: entity.registry_id,
        taxId: entity.nit ?? entity.detail?.nit ?? null,
        name: entity.name,
        status: entity.registration_status,
        location: entity.chamber_name,
        subtitle: `${entity.legal_organization} · Cámara ${entity.chamber_name}`,
        source: "RUES",
        metadata: {
          renewedYear: entity.last_renewed_year,
          activity: entity.detail?.primary_activity?.description ?? null,
        },
      }));

      const result: SearchResult = {
        query,
        country,
        mode,
        candidates,
        source: "RUES · Registro empresarial de Colombia",
        total: data.pagination?.total ?? candidates.length,
        capped: Boolean(data.capped),
        disclaimer: "Elige la entidad correcta. El nombre por sí solo no confirma identidad.",
      };
      return NextResponse.json(addGlobalScreeningCandidate(result, companyScreening, query, country, mode));
    }

    if (country === "MX") {
      const data = await cromaFetch<{
        establishments?: SiemEstablishment[];
        pagination?: { total?: number };
      }>("/mx/siem/establishments/v1", { name: query, page: 1 });

      const candidates: SearchCandidate[] = (data.establishments ?? []).map(
        (establishment) => ({
          country,
          sourceId: establishment.establishment_id,
          taxId: null,
          name: establishment.commercial_name,
          status: null,
          location: establishment.state,
          subtitle: `${establishment.chamber} · ${establishment.state}`,
          source: "SIEM",
          metadata: { stateCode: String(establishment.state_code) },
        }),
      );

      const result: SearchResult = {
        query,
        country,
        mode,
        candidates,
        source: "SIEM · Directorio empresarial de México",
        total: data.pagination?.total ?? candidates.length,
        capped: (data.pagination?.total ?? 0) > candidates.length,
        disclaimer:
          "SIEM es un directorio voluntario y autodeclarado. La ausencia de una empresa no es una señal adversa.",
      };
      return NextResponse.json(addGlobalScreeningCandidate(result, companyScreening, query, country, mode));
    }

    const data = await cromaFetch<{
      contributors?: SunatContributor[];
      count?: number;
      capped?: boolean;
    }>("/pe/sunat/name/v1", { name: query });

    const candidates: SearchCandidate[] = (data.contributors ?? []).map(
      (contributor) => ({
        country,
        sourceId: contributor.ruc,
        taxId: contributor.ruc,
        name: contributor.name,
        status: contributor.status,
        location: contributor.location,
        subtitle: `RUC ${contributor.ruc} · ${contributor.location}`,
        source: "SUNAT",
      }),
    );

    const result: SearchResult = {
      query,
      country,
      mode,
      candidates,
      source: "SUNAT · Registro tributario de Perú",
      total: data.count ?? candidates.length,
      capped: Boolean(data.capped),
      disclaimer: "Selecciona el RUC correcto antes de generar la revisión.",
    };
    return NextResponse.json(addGlobalScreeningCandidate(result, companyScreening, query, country, mode));
  } catch (error) {
    console.error("Croma search failed", error);
    return NextResponse.json(
      { error: "Croma no pudo completar la búsqueda. Intenta con un nombre más específico." },
      { status: 502 },
    );
  }
}
