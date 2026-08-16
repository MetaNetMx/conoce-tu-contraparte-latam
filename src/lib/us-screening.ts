import {
  globalSanctionsCacheTag,
  screenGlobalSanctions,
  warmGlobalSanctions,
} from "@/lib/global-sanctions";

const WEEK = 60 * 60 * 24 * 7;
const SCREENING_TAG = "us-screening-lists";
const OFAC_SDN_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV";
const OFAC_ALT_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV";
const FBI_API = "https://api.fbi.gov/wanted/v1/list";

export type DirectScreeningMatch = {
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
};

export type DirectScreeningResult = {
  checkedAt: string;
  subject: string;
  detail: string;
  matches: DirectScreeningMatch[];
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

type FbiItem = {
  title?: string;
  aliases?: string[] | null;
  dates_of_birth_used?: string[] | null;
  nationality?: string | null;
  subjects?: string[] | null;
  description?: string | null;
  caution?: string | null;
  uid?: string;
  url?: string;
};

type FbiPage = { total?: number; items?: FbiItem[] };

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ&]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sortedTokens(value: string) {
  return normalize(value).split(" ").filter(Boolean).sort().join(" ");
}

function nameMatch(candidate: string, subject: string) {
  const candidateNormalized = normalize(candidate);
  const subjectNormalized = normalize(subject);
  if (candidateNormalized === subjectNormalized) return "Nombre o alias exacto";
  if (sortedTokens(candidate) === sortedTokens(subject)) {
    return "Mismos componentes del nombre en distinto orden";
  }
  const candidateTokens = new Set(candidateNormalized.split(" ").filter(Boolean));
  const subjectTokens = new Set(subjectNormalized.split(" ").filter(Boolean));
  const smaller = candidateTokens.size <= subjectTokens.size ? candidateTokens : subjectTokens;
  const larger = candidateTokens.size <= subjectTokens.size ? subjectTokens : candidateTokens;
  if (smaller.size >= 3 && Array.from(smaller).every((token) => larger.has(token))) {
    return "Coincidencia sustancial; uno de los nombres contiene un componente adicional";
  }
  return null;
}

function parseCsvLine(line: string) {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(current.trim().replace(/^-0-$/, ""));
      current = "";
    } else {
      current += character;
    }
  }
  fields.push(current.trim().replace(/^-0-$/, ""));
  return fields;
}

async function fetchOfficialText(url: string) {
  const response = await fetch(url, {
    next: { revalidate: WEEK, tags: [SCREENING_TAG] },
    headers: { "User-Agent": "CounterpartyScreening/1.0" },
  });
  if (!response.ok) throw new Error(`OFFICIAL_SOURCE_${response.status}`);
  return {
    text: await response.text(),
    updatedAt: response.headers.get("last-modified"),
  };
}

async function fetchFbiPage(page: number, attempt = 0): Promise<{ data: FbiPage; updatedAt: string | null }> {
  const response = await fetch(`${FBI_API}?pageSize=50&page=${page}`, {
    next: { revalidate: WEEK, tags: [SCREENING_TAG] },
    headers: { "User-Agent": "CounterpartyScreening/1.0" },
  });
  if (!response.ok) {
    if (attempt < 2 && [429, 500, 502, 503, 504].includes(response.status)) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      return fetchFbiPage(page, attempt + 1);
    }
    throw new Error(`FBI_${response.status}`);
  }
  return {
    data: (await response.json()) as FbiPage,
    updatedAt: response.headers.get("last-modified"),
  };
}

function looksLikeIdentifier(value: string) {
  const compact = normalize(value).replace(/\s/g, "");
  return compact.length >= 6 && compact.length <= 30 && /\d/.test(compact);
}

function linkedNames(remarks: string) {
  return Array.from(remarks.matchAll(/Linked To:\s*([^.;]+)/gi), (match) => match[1].trim()).filter(Boolean);
}

function detailMatches(text: string, detail: string) {
  const normalizedDetail = normalize(detail);
  if (normalizedDetail.length < 4) return [];
  const haystack = normalize(text);
  const pieces = normalizedDetail.split(" ").filter((piece) => piece.length >= 4);
  const matches = pieces.filter((piece) => haystack.includes(piece));
  const sufficient = matches.length === pieces.length &&
    (matches.length >= 2 || matches.some((piece) => piece.length >= 6 && /\d/.test(piece)));
  return sufficient ? matches.slice(0, 5) : [];
}

async function screenOfac(subject: string, detail: string) {
  const [sdn, alt] = await Promise.all([
    fetchOfficialText(OFAC_SDN_URL),
    fetchOfficialText(OFAC_ALT_URL),
  ]);
  const aliasesByEntity = new Map<string, string[]>();
  let aliasRecords = 0;
  for (const line of alt.text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    const entityId = fields[0];
    const aliasName = fields[3];
    if (!entityId || !aliasName) continue;
    aliasRecords += 1;
    const aliases = aliasesByEntity.get(entityId) ?? [];
    aliases.push(aliasName);
    aliasesByEntity.set(entityId, aliases);
  }

  const matches: DirectScreeningMatch[] = [];
  let records = 0;
  for (const line of sdn.text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    const [entityId, primaryName, entityType, program, title, , , , , , , remarks] = fields;
    if (!entityId || !primaryName) continue;
    records += 1;
    const aliases = aliasesByEntity.get(entityId) ?? [];
    const names = [primaryName, ...aliases];
    const recordDetails = `${remarks ?? ""} ${entityType ?? ""} ${title ?? ""}`;
    const relationships = linkedNames(remarks ?? "");
    const identifierMatches = looksLikeIdentifier(subject) ? detailMatches(recordDetails, subject) : [];
    const directBasis = names.map((name) => nameMatch(name, subject)).find(Boolean)
      ?? (identifierMatches.length ? "Identificador exacto en el registro oficial" : null);
    const linkedName = relationships.find((name) => nameMatch(name, subject));
    if (!directBasis && !linkedName) continue;
    const programs = program ? program.split(/[,;]|\]\s*\[/).map((item) => item.replace(/[\[\]]/g, "").trim()).filter(Boolean) : [];
    const directUrl = `https://sanctionssearch.ofac.treas.gov/Details.aspx?id=${encodeURIComponent(entityId)}`;
    if (directBasis) {
      const corroboratingDetails = directBasis === "Identificador exacto en el registro oficial"
        ? identifierMatches
        : detailMatches(recordDetails, detail);
      matches.push({
        source: "OFAC",
        name: primaryName,
        aliases: aliases.slice(0, 20),
        matchBasis: [directBasis],
        corroboratingDetails,
        confidence: corroboratingDetails.length ? "strong" : "possible",
        programs,
        nationality: null,
        identifiers: remarks ? [remarks] : [],
        description: entityType || null,
        matchType: "designation",
        relatedTo: relationships,
        recordId: entityId,
        url: directUrl,
      });
    } else if (linkedName) {
      matches.push({
        source: "OFAC · relación publicada",
        name: primaryName,
        aliases: aliases.slice(0, 20),
        matchBasis: [`El registro de ${primaryName} menciona “Linked To: ${linkedName}”`],
        corroboratingDetails: [],
        confidence: "possible",
        programs,
        nationality: null,
        identifiers: remarks ? [remarks] : [],
        description: "Relación publicada en el registro de otra entidad; no equivale por sí sola a una designación independiente.",
        matchType: "linked_relationship",
        relatedTo: [linkedName],
        recordId: entityId,
        url: directUrl,
      });
    }
    if (matches.length >= 25) break;
  }
  return {
    matches,
    records: records + aliasRecords,
    updatedAt: sdn.updatedAt ?? alt.updatedAt,
  };
}

async function screenFbi(subject: string, detail: string) {
  const first = await fetchFbiPage(1);
  const total = first.data.total ?? first.data.items?.length ?? 0;
  const pages = Math.max(1, Math.ceil(total / 50));
  const remaining: Array<{ data: FbiPage; updatedAt: string | null }> = [];
  const pageNumbers = Array.from({ length: Math.max(0, pages - 1) }, (_, index) => index + 2);
  for (let start = 0; start < pageNumbers.length; start += 4) {
    const batch = pageNumbers.slice(start, start + 4);
    remaining.push(...await Promise.all(batch.map((page) => fetchFbiPage(page))));
  }
  const items = [first, ...remaining].flatMap((page) => page.data.items ?? []);
  const matches: DirectScreeningMatch[] = [];
  for (const item of items) {
    const primaryName = item.title?.trim();
    if (!primaryName) continue;
    const aliases = item.aliases?.filter(Boolean) ?? [];
    const names = [primaryName, ...aliases];
    const basis = names.map((name) => nameMatch(name, subject)).find(Boolean);
    if (!basis) continue;
    const detailText = [
      ...(item.dates_of_birth_used ?? []),
      item.nationality ?? "",
      ...(item.subjects ?? []),
      item.description ?? "",
      item.caution ?? "",
    ].join(" ");
    const corroboratingDetails = detailMatches(detailText, detail);
    matches.push({
      source: "FBI",
      name: primaryName,
      aliases: aliases.slice(0, 20),
      matchBasis: [basis],
      corroboratingDetails,
      confidence: corroboratingDetails.length ? "strong" : "possible",
      dateOfBirth: item.dates_of_birth_used ?? [],
      nationality: item.nationality ?? null,
      description: item.description ?? item.subjects?.join(", ") ?? null,
      url: item.url ?? (item.uid ? `https://www.fbi.gov/wanted/wcc/${item.uid}` : "https://www.fbi.gov/wanted"),
    });
    if (matches.length >= 25) break;
  }
  return {
    matches,
    records: items.length,
    updatedAt: first.updatedAt,
  };
}

export async function screenDirectUsLists(subject: string, detail: string): Promise<DirectScreeningResult> {
  const [ofacResult, fbiResult, globalResult] = await Promise.allSettled([
    screenOfac(subject, detail),
    screenFbi(subject, detail),
    screenGlobalSanctions(subject, detail),
  ]);
  const ofac = ofacResult.status === "fulfilled" ? ofacResult.value : null;
  const fbi = fbiResult.status === "fulfilled" ? fbiResult.value : null;
  const global = globalResult.status === "fulfilled" ? globalResult.value : null;
  return {
    checkedAt: new Date().toISOString(),
    subject,
    detail,
    matches: [...(ofac?.matches ?? []), ...(fbi?.matches ?? []), ...(global?.matches ?? [])],
    coverage: [
      {
        source: "OFAC SDN + aliases",
        mode: "complete_official_list",
        status: ofac ? "consulted" : "unavailable",
        records: ofac?.records,
        updatedAt: ofac?.updatedAt,
        note: "Lista SDN completa y archivo oficial de alias. Incluye programas de sanciones, entre ellos designaciones vinculadas con narcotráfico cuando corresponda.",
        url: "https://ofac.treasury.gov/sanctions-list-service",
      },
      {
        source: "FBI Wanted API",
        mode: "complete_official_list",
        status: fbi ? "consulted" : "unavailable",
        records: fbi?.records,
        updatedAt: fbi?.updatedAt,
        note: "Todos los registros devueltos por la API oficial FBI Wanted, con alias, fechas de nacimiento y nacionalidad cuando se publican.",
        url: "https://www.fbi.gov/wanted/api",
      },
      ...(global?.coverage ?? []),
      ...["DEA Fugitives", "U.S. Marshals", "ICE Most Wanted", "State/INL Rewards", "Department of Justice"].map((source) => ({
        source,
        mode: "official_search_only" as const,
        status: "consulted" as const,
        note: "El organismo no expone aquí un registro masivo oficial estable; se consulta mediante búsqueda dirigida a su dominio y Croma Research, sin prometer cobertura total.",
        url: source.startsWith("DEA")
          ? "https://www.dea.gov/fugitives"
          : source.startsWith("U.S.")
            ? "https://www.usmarshals.gov/what-we-do/fugitive-investigations"
            : source.startsWith("ICE")
              ? "https://www.ice.gov/most-wanted"
              : source.startsWith("State")
                ? "https://www.state.gov/inl-rewards-program/"
                : "https://www.justice.gov/",
      })),
    ],
  };
}

export const screeningCacheTags = [SCREENING_TAG, globalSanctionsCacheTag];
export async function warmDirectUsLists() {
  const [ofac, fbi, global] = await Promise.allSettled([
    screenOfac("__CACHE_WARM__", ""),
    screenFbi("__CACHE_WARM__", ""),
    warmGlobalSanctions(),
  ]);
  return {
    ofac: ofac.status === "fulfilled" ? { records: ofac.value.records, updatedAt: ofac.value.updatedAt } : { error: "unavailable" },
    fbi: fbi.status === "fulfilled" ? { records: fbi.value.records, updatedAt: fbi.value.updatedAt } : { error: "unavailable" },
    global: global.status === "fulfilled" ? global.value : [{ error: "unavailable" }],
  };
}
