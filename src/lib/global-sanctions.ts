const WEEK = 60 * 60 * 24 * 7;
const TAG = "global-sanctions-lists";
const UK_URL = "https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv";
const UN_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml";
const CANADA_URL = "https://www.international.gc.ca/world-monde/assets/office_docs/international_relations-relations_internationales/sanctions/sema-lmes.xml";
const FINCEN_ENFORCEMENT_URL = "https://www.fincen.gov/news-room/enforcement-actions";
const FINCEN_311_URL = "https://www.fincen.gov/resources/statutes-and-regulations/311-special-measures";

export type GlobalSanctionsMatch = {
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
  url: string;
};

export type GlobalCoverage = {
  source: string;
  mode: "complete_official_list" | "official_search_only";
  status: "consulted" | "unavailable";
  records?: number;
  updatedAt?: string | null;
  note: string;
  url: string;
};

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

function detailMatches(text: string, detail: string) {
  const pieces = normalize(detail).split(" ").filter((piece) => piece.length >= 4);
  if (!pieces.length) return [];
  const haystack = normalize(text);
  const matches = pieces.filter((piece) => haystack.includes(piece));
  const sufficient = matches.length === pieces.length &&
    (matches.length >= 2 || matches.some((piece) => piece.length >= 6 && /\d/.test(piece)));
  return sufficient ? matches.slice(0, 5) : [];
}

function sameIdentity(candidate: string, subject: string) {
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
  return smaller.size >= 3 && Array.from(smaller).every((token) => larger.has(token))
    ? "Coincidencia sustancial; uno de los nombres contiene un componente adicional"
    : null;
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string) {
  return decodeXml(block.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "");
}

function tags(block: string, name: string) {
  return Array.from(block.matchAll(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "gi")))
    .map((match) => decodeXml(match[1]))
    .filter(Boolean);
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
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      fields.push(current.trim());
      current = "";
    } else current += character;
  }
  fields.push(current.trim());
  return fields;
}

async function officialText(url: string) {
  const response = await fetch(url, {
    next: { revalidate: WEEK, tags: [TAG] },
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CounterpartyScreening/1.0)" },
  });
  if (!response.ok) throw new Error(`SOURCE_${response.status}`);
  return { text: await response.text(), updatedAt: response.headers.get("last-modified") };
}

async function screenUnitedKingdom(subject: string, detail: string) {
  const data = await officialText(UK_URL);
  const lines = data.text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith("Last Updated,"));
  const header = parseCsvLine(lines[headerIndex] ?? "");
  const index = (name: string) => header.indexOf(name);
  const uniqueIds = new Set<string>();
  const matches = new Map<string, GlobalSanctionsMatch>();
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim()) continue;
    const row = parseCsvLine(line);
    const uniqueId = row[index("Unique ID")] || `row-${uniqueIds.size}`;
    uniqueIds.add(uniqueId);
    const names = ["Name 6", "Name 1", "Name 2", "Name 3", "Name 4", "Name 5"]
      .map((name) => row[index(name)])
      .filter(Boolean);
    const displayName = names.join(" ").trim();
    const basis = names.map((name) => sameIdentity(name, subject)).find(Boolean) ?? sameIdentity(displayName, subject);
    if (!basis) continue;
    const corroboratingDetails = detailMatches(line, detail);
    const existing = matches.get(uniqueId);
    const aliases = Array.from(new Set([...(existing?.aliases ?? []), displayName])).filter(Boolean);
    matches.set(uniqueId, {
      source: "UK Sanctions List",
      name: existing?.name ?? displayName,
      aliases,
      matchBasis: [basis],
      corroboratingDetails,
      confidence: corroboratingDetails.length ? "strong" : "possible",
      programs: [row[index("Regime Name")], row[index("Sanctions Imposed")]].filter(Boolean),
      dateOfBirth: row[index("D.O.B")] ? [row[index("D.O.B")]] : [],
      nationality: row[index("Nationality(/ies)")] || null,
      identifiers: [row[index("National Identifier number")], row[index("Business registration number (s)")]].filter(Boolean),
      description: [row[index("Designation Type")], row[index("UK Statement of Reasons")], row[index("Other Information")]].filter(Boolean).join(" · ") || null,
      url: "https://www.gov.uk/government/publications/the-uk-sanctions-list",
    });
  }
  return { matches: Array.from(matches.values()).slice(0, 25), records: uniqueIds.size, updatedAt: data.updatedAt ?? lines[0]?.replace("Report Date:", "").trim() };
}

async function screenUnitedNations(subject: string, detail: string) {
  const data = await officialText(UN_URL);
  const blocks = [
    ...Array.from(data.text.matchAll(/<ENTITY>([\s\S]*?)<\/ENTITY>/gi), (match) => ({ type: "Entity", block: match[1] })),
    ...Array.from(data.text.matchAll(/<INDIVIDUAL>([\s\S]*?)<\/INDIVIDUAL>/gi), (match) => ({ type: "Individual", block: match[1] })),
  ];
  const matches: GlobalSanctionsMatch[] = [];
  for (const item of blocks) {
    const primary = [tag(item.block, "FIRST_NAME"), tag(item.block, "SECOND_NAME"), tag(item.block, "THIRD_NAME"), tag(item.block, "FOURTH_NAME")].filter(Boolean).join(" ");
    const aliases = [...tags(item.block, "ALIAS_NAME"), ...tags(item.block, "NAME_ORIGINAL_SCRIPT")];
    const names = [primary, ...aliases].filter(Boolean);
    const basis = names.map((name) => sameIdentity(name, subject)).find(Boolean);
    if (!basis) continue;
    const corroboratingDetails = detailMatches(item.block, detail);
    matches.push({
      source: "UN Security Council",
      name: primary,
      aliases,
      matchBasis: [basis],
      corroboratingDetails,
      confidence: corroboratingDetails.length ? "strong" : "possible",
      programs: [tag(item.block, "UN_LIST_TYPE"), tag(item.block, "REFERENCE_NUMBER")].filter(Boolean),
      dateOfBirth: tags(item.block, "DATE"),
      nationality: tags(item.block, "NATIONALITY").join(", ") || null,
      identifiers: [tag(item.block, "DATAID"), tag(item.block, "REFERENCE_NUMBER")].filter(Boolean),
      description: `${item.type} · ${tag(item.block, "COMMENTS1")}`,
      url: "https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list",
    });
  }
  const generatedAt = data.text.match(/dateGenerated="([^"]+)"/)?.[1] ?? data.updatedAt;
  return { matches: matches.slice(0, 25), records: blocks.length, updatedAt: generatedAt };
}

async function screenCanada(subject: string, detail: string) {
  const data = await officialText(CANADA_URL);
  const blocks = Array.from(data.text.matchAll(/<record>([\s\S]*?)<\/record>/gi), (match) => match[1]);
  const matches: GlobalSanctionsMatch[] = [];
  for (const block of blocks) {
    const entity = tag(block, "EntityOrShip");
    const person = [tag(block, "GivenName"), tag(block, "LastName")].filter(Boolean).join(" ");
    const primary = entity || person;
    const aliases = tags(block, "Aliases");
    const basis = [primary, ...aliases].map((name) => sameIdentity(name, subject)).find(Boolean);
    if (!basis) continue;
    const corroboratingDetails = detailMatches(block, detail);
    matches.push({
      source: "Canada Consolidated Sanctions",
      name: primary,
      aliases,
      matchBasis: [basis],
      corroboratingDetails,
      confidence: corroboratingDetails.length ? "strong" : "possible",
      programs: [tag(block, "Country"), tag(block, "Schedule")].filter(Boolean),
      dateOfBirth: tag(block, "DateOfBirthOrShipBuildDate") ? [tag(block, "DateOfBirthOrShipBuildDate")] : [],
      nationality: tag(block, "Country") || null,
      identifiers: [tag(block, "Item"), tag(block, "ShipIMONumber")].filter(Boolean),
      description: tag(block, "TitleOrShip") || null,
      url: "https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx?lang=eng",
    });
  }
  return { matches: matches.slice(0, 25), records: blocks.length, updatedAt: data.updatedAt };
}

function stripHtml(value: string) {
  return decodeXml(value.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, ""));
}

async function screenFinCen(subject: string, detail: string) {
  const [enforcement, specialMeasures] = await Promise.all([
    officialText(FINCEN_ENFORCEMENT_URL),
    officialText(FINCEN_311_URL),
  ]);
  const actions = Array.from(enforcement.text.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi))
    .map((match) => ({ href: match[1], title: stripHtml(match[2]) }))
    .filter((item) => /\/system\/files\//.test(item.href) && item.title.length >= 5);
  const matches: GlobalSanctionsMatch[] = [];
  for (const action of actions) {
    const title = action.title.replace(/^In the Matter of\s+/i, "").trim();
    const normalizedTitle = normalize(title);
    const normalizedSubject = normalize(subject);
    if (!normalizedTitle.includes(normalizedSubject) && !normalizedSubject.includes(normalizedTitle)) continue;
    const corroboratingDetails = detailMatches(title, detail);
    matches.push({
      source: "FinCEN Enforcement",
      name: title,
      aliases: [],
      matchBasis: ["Nombre incluido en una acción oficial de cumplimiento FinCEN"],
      corroboratingDetails,
      confidence: corroboratingDetails.length ? "strong" : "possible",
      programs: ["BSA/AML enforcement action"],
      description: "Acción oficial de cumplimiento. Debe leerse el documento para conocer la conducta, resolución y alcance exactos.",
      url: action.href.startsWith("http") ? action.href : `https://www.fincen.gov${action.href}`,
    });
  }
  const rows = Array.from(specialMeasures.text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi), (match) => stripHtml(match[1]));
  for (const row of rows) {
    const basis = sameIdentity(row, subject) || (normalize(row).includes(normalize(subject)) ? "Nombre exacto en medida especial Section 311" : null);
    if (!basis) continue;
    const corroboratingDetails = detailMatches(row, detail);
    matches.push({
      source: "FinCEN Section 311",
      name: subject,
      aliases: [],
      matchBasis: [basis],
      corroboratingDetails,
      confidence: corroboratingDetails.length ? "strong" : "possible",
      programs: ["Primary Money Laundering Concern / Special Measure"],
      description: row.slice(0, 900),
      url: FINCEN_311_URL,
    });
  }
  return {
    matches: matches.slice(0, 25),
    records: actions.length + rows.length,
    updatedAt: enforcement.updatedAt ?? specialMeasures.updatedAt,
  };
}

export async function screenGlobalSanctions(subject: string, detail: string) {
  const settled = await Promise.allSettled([
    screenUnitedKingdom(subject, detail),
    screenUnitedNations(subject, detail),
    screenCanada(subject, detail),
    screenFinCen(subject, detail),
  ]);
  const configs = [
    { source: "UK Sanctions List", url: "https://www.gov.uk/government/publications/the-uk-sanctions-list", note: "Lista oficial completa del Reino Unido, con entidades, personas, alias, motivos y medidas." },
    { source: "UN Security Council Consolidated List", url: "https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list", note: "Lista consolidada completa del Consejo de Seguridad de la ONU." },
    { source: "Canada Consolidated Autonomous Sanctions List", url: "https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx?lang=eng", note: "Lista oficial consolidada completa de Canadá, relevante para contrapartes del continente americano." },
    { source: "FinCEN Enforcement + Section 311", url: FINCEN_ENFORCEMENT_URL, note: "Acciones oficiales BSA/AML y medidas finales por preocupación primaria de lavado de dinero." },
  ];
  const matches: GlobalSanctionsMatch[] = [];
  const coverage: GlobalCoverage[] = settled.map((result, index) => {
    const config = configs[index];
    if (result.status === "fulfilled") {
      matches.push(...result.value.matches);
      return { ...config, mode: "complete_official_list", status: "consulted", records: result.value.records, updatedAt: result.value.updatedAt };
    }
    return { ...config, mode: "complete_official_list", status: "unavailable" };
  });
  coverage.push(
    {
      source: "European Union Financial Sanctions",
      mode: "official_search_only",
      status: "consulted",
      note: "La descarga oficial de la UE requiere un mecanismo de acceso variable; se consulta mediante Croma Research y dominios oficiales, sin declarar cobertura masiva completa.",
      url: "https://finance.ec.europa.eu/eu-and-world/sanctions-restrictive-measures/overview-sanctions-and-related-tools_en",
    },
    {
      source: "Fuentes oficiales de Latinoamérica",
      mode: "official_search_only",
      status: "consulted",
      note: "No existe una lista regional única de empresas sancionadas por lavado. Se complementa con Croma, autoridades nacionales y listas globales oficiales, sin mezclar investigaciones con sanciones finales.",
      url: "https://usecroma.com/es#sources",
    },
  );
  return { matches: matches.slice(0, 75), coverage };
}

export async function warmGlobalSanctions() {
  const result = await screenGlobalSanctions("__CACHE_WARM__", "");
  return result.coverage.map((item) => ({ source: item.source, status: item.status, records: item.records, updatedAt: item.updatedAt }));
}

export const globalSanctionsCacheTag = TAG;
