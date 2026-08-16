import { NextResponse } from "next/server";
import { cromaFetch } from "@/lib/croma";
import { screenDirectUsLists } from "@/lib/us-screening";
import type { Analysis } from "@/lib/types";

export const maxDuration = 60;

type Bulletin = {
  title?: string;
  url?: string;
  published_at?: string | null;
  excerpt?: string | null;
  body?: string | null;
  code?: string | null;
  bulletin_number?: string | null;
};

type ResearchSource = { title?: string; url?: string };
type WebResult = { title?: string; url?: string; highlights?: string[] };

type PossibleMention = {
  office: string;
  title: string;
  url: string;
  publishedAt: string | null;
  excerpt: string;
};

const searchableFiscalias = [
  ["Fiscalía de Chihuahua", "/mx/fiscalias/chihuahua/bulletins/v1"],
  ["Fiscalía de Veracruz", "/mx/fiscalias/veracruz/bulletins/v1"],
  ["Fiscalía de Jalisco", "/mx/fiscalias/jalisco/bulletins/v1"],
  ["Fiscalía de Nuevo León", "/mx/fiscalias/nuevoleon/bulletins/v1"],
  ["Fiscalía de Puebla", "/mx/fiscalias/puebla/bulletins/v1"],
] as const;

function isOfficialUsUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return ["treasury.gov", "fbi.gov", "dea.gov", "usmarshals.gov", "ice.gov", "state.gov", "justice.gov"]
      .some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function searchOfficialUs(subject: string, detail: string) {
  const query = `"${subject}" ${detail ? `"${detail}" ` : ""}(site:home.treasury.gov OR site:fbi.gov OR site:dea.gov OR site:usmarshals.gov OR site:ice.gov OR site:state.gov OR site:justice.gov)`.slice(0, 300);
  const normalizedSubject = subject.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedDetail = detail.toLowerCase().replace(/[^a-z0-9ñ&]/g, "");
  try {
    const data = await cromaFetch<{ results?: WebResult[] }>(
      "/global/web-search/v1",
      { query, limit: 10 },
    );
    return (data.results ?? []).flatMap((item) => {
      if (!item.url || !isOfficialUsUrl(item.url)) return [];
      const text = `${item.title ?? ""} ${item.highlights?.join(" ") ?? ""}`.toLowerCase();
      const compactText = text.replace(/[^a-z0-9ñ&]/g, "");
      const exactIdentityMention =
        (normalizedSubject.length >= 6 && text.includes(normalizedSubject)) ||
        (normalizedDetail.length >= 6 && compactText.includes(normalizedDetail));
      return exactIdentityMention
        ? [{
            title: item.title ?? "Resultado oficial de EE. UU.",
            url: item.url,
            snippet: (item.highlights?.[0] ?? "").slice(0, 500),
          }]
        : [];
    });
  } catch {
    return [];
  }
}

async function searchFiscalia(office: string, path: string, query: string) {
  try {
    const data = await cromaFetch<{ bulletins?: Bulletin[] }>(path, { query, page: 1 });
    return (data.bulletins ?? []).slice(0, 3).flatMap<PossibleMention>((item) =>
      item.url
        ? [{
            office,
            title: item.title ?? item.code ?? item.bulletin_number ?? "Boletín público",
            url: item.url,
            publishedAt: item.published_at ?? null,
            excerpt: (item.excerpt ?? item.body ?? "").slice(0, 500),
          }]
        : [],
    );
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    analysis?: Analysis;
    subject?: string;
    identifyingDetail?: string;
  };
  const analysis = body.analysis;
  const subject = body.subject?.trim().slice(0, 180) ?? "";
  const identifyingDetail = body.identifyingDetail?.trim().slice(0, 300) ?? "";
  if (!analysis || subject.length < 3) {
    return NextResponse.json(
      { error: "Escribe el nombre exacto de la persona o empresa que quieres investigar." },
      { status: 400 },
    );
  }

  const [fiscaliaGroups, officialUsResults, directUsScreening] = await Promise.all([
    Promise.all(
      searchableFiscalias.map(([office, path]) => searchFiscalia(office, path, subject)),
    ),
    searchOfficialUs(subject, identifyingDetail),
    screenDirectUsLists(subject, identifyingDetail),
  ]);
  const possibleMentions = fiscaliaGroups.flat().slice(0, 10);

  const query = `Realiza una investigación ampliada y responsable de debida diligencia sobre: ${subject}.
País o contexto: ${analysis.country}.
Identificador fiscal conocido: ${analysis.taxId ?? "no disponible"}.
Detalle adicional para distinguir homónimos: ${identifyingDetail || "no disponible"}.

Revisa prioritariamente fuentes oficiales y páginas primarias. Para México incluye boletines de Fiscalías. Para listas de Estados Unidos revisa, cuando sean pertinentes: Treasury/OFAC (incluidas designaciones relacionadas con narcotráfico), FBI Most Wanted, DEA Fugitives, U.S. Marshals, ICE Most Wanted, Department of State/INL Rewards y Department of Justice.

Posibles resultados recuperados directamente de las Fiscalías consultables por texto en Croma: ${JSON.stringify(possibleMentions)}

Separa el reporte en: identidad observada, coincidencias exactas, posibles homónimos, fuentes oficiales, indicios no oficiales, límites y próximos pasos. No presentes una coincidencia de nombre como identidad confirmada, acusación o condena. Una mención en un boletín solo describe lo publicado y su etapa procesal. La ausencia de resultados no significa que la persona o empresa esté libre de riesgos.`.slice(0, 2000);

  try {
    const data = await cromaFetch<{
      report?: string;
      sources?: ResearchSource[];
      pages_analyzed?: number;
    }>("/global/research/v1", { query });

    return NextResponse.json({
      report: data.report ?? "Croma Research no devolvió un reporte.",
      sources: (data.sources ?? [])
        .filter((source): source is { title?: string; url: string } => Boolean(source.url?.startsWith("http")))
        .map((source) => ({ title: source.title ?? "Fuente consultada", url: source.url })),
      pagesAnalyzed: data.pages_analyzed ?? null,
      possibleMentions,
      officialUsResults,
      directUsScreening,
      requestedCoverage: [
        "Croma Research · fuentes públicas en vivo",
        "Fiscalías de Chihuahua, Veracruz, Jalisco, Nuevo León y Puebla · búsqueda textual Croma",
        "Resto de Fiscalías mexicanas · búsqueda mediante Croma Research",
        "OFAC SDN y alias + FBI Wanted · registros oficiales completos, cotejados directamente",
        "ONU, Reino Unido y Canadá · listas oficiales consolidadas completas",
        "FinCEN Enforcement y Section 311 · acciones oficiales BSA/AML y medidas por preocupación de lavado",
        "DEA, U.S. Marshals, ICE, State/INL, DOJ, Unión Europea y fuentes LatAm · búsqueda oficial complementaria sin registro regional único",
      ],
      disclaimer:
        "La investigación no es exhaustiva. Toda coincidencia debe cotejarse con identificadores adicionales y la fuente primaria.",
    });
  } catch {
    return NextResponse.json(
      {
        report:
          "Croma Research no pudo generar el informe narrativo en este momento. Se muestran abajo las consultas estructuradas que sí terminaron; vuelve a intentar para obtener el reporte citado.",
        sources: [],
        pagesAnalyzed: null,
        possibleMentions,
        officialUsResults,
        directUsScreening,
        requestedCoverage: [
          "Croma Research · intento realizado, sin informe disponible",
          "Fiscalías de Chihuahua, Veracruz, Jalisco, Nuevo León y Puebla · búsqueda textual Croma",
          "OFAC SDN y alias + FBI Wanted · registros oficiales completos, cotejados directamente",
          "ONU, Reino Unido y Canadá · listas oficiales consolidadas completas",
          "FinCEN Enforcement y Section 311 · acciones oficiales BSA/AML",
          "DEA, U.S. Marshals, ICE, State/INL, DOJ, Unión Europea y fuentes LatAm · Croma Web Search y Research dirigidos a fuentes oficiales",
        ],
        disclaimer:
          "Resultado parcial y no exhaustivo. La ausencia de coincidencias no significa ausencia de riesgo.",
      },
      { status: 206 },
    );
  }
}
