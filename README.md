# Conoce a tu contraparte LatAm

MVP para el IA-Hackathon GOV-TECH de Croma. Convierte datos públicos en una revisión clara de contrapartes para fintechs, equipos legales y PyMEs.

## Flujo

1. Selecciona Colombia, México o Perú.
2. Busca por razón social o identificación fiscal.
3. Elige la coincidencia correcta antes de analizar.
4. Revisa identidad, señales disponibles, vacíos, cobertura y próximos pasos.
5. Opcionalmente conecta OpenAI durante la sesión para explicar el reporte y buscar evidencia pública.
6. Descarga el reporte o imprímelo como PDF.

## Fuentes reales mediante Croma

- **Colombia:** RUES por nombre o NIT; sanciones SECOP por NIT.
- **México:** SIEM por nombre. Para RFC se valida la estructura y se intenta un contraste textual en SIEM; Croma no ofrece una consulta oficial directa por RFC.
- **Perú:** SUNAT por nombre o RUC y obligaciones reportadas por SAT Lima, cuya cobertura se limita a la provincia de Lima.
- **Global:** Croma Web Search recupera evidencia pública para cada análisis.
- **Investigación ampliada opcional:** Croma Research, Fiscalías mexicanas consultables por texto y búsqueda dirigida a dominios oficiales de Treasury/OFAC, FBI, DEA, U.S. Marshals, ICE, State/INL y DOJ.

La ausencia de resultados nunca se interpreta automáticamente como una señal positiva. Las listas y boletines no se consideran coincidencias confirmadas sin cotejar identificadores adicionales.

## RFC mexicano

La plataforma acepta RFC de persona física o moral, normaliza el valor y valida su estructura y fecha codificada. Esto **no demuestra** que el RFC esté inscrito en SAT, esté activo o pertenezca a una razón social. El reporte exige constancia de situación fiscal y verificación oficial.

## Screening global directo

La investigación ampliada coteja directamente:

- **OFAC SDN y alias:** lista completa, incluidos programas relacionados con narcotráfico cuando corresponda.
- **FBI Wanted API:** todos los registros publicados por la API oficial.
- **UK Sanctions List:** lista oficial completa del Reino Unido.
- **Consejo de Seguridad de la ONU:** lista consolidada completa.
- **Canadá:** lista consolidada oficial de sanciones autónomas.
- **FinCEN:** acciones oficiales de cumplimiento BSA/AML y medidas Section 311 por preocupación primaria de lavado de dinero.

El cotejo exige nombre o alias exacto —también admite el mismo nombre en distinto orden— y eleva la coincidencia solo cuando un segundo dato aparece en el registro. Una coincidencia sin ese segundo dato se muestra como posible homónimo. Una sanción general no se describe como lavado de dinero salvo que el programa o documento oficial lo indique.

Unión Europea, DEA, U.S. Marshals, ICE, State/INL, DOJ y fuentes nacionales de Latinoamérica no exponen en este entorno un registro regional masivo único y estable. Se consultan mediante Croma Web Search y Croma Research dirigidos a dominios oficiales y se etiquetan como cobertura no exhaustiva.

Los archivos oficiales se almacenan en la caché de datos de Vercel y se revalidan cada lunes a las 06:00, hora de Ciudad de México. Una rutina separada supervisa cambios y fallas semanalmente.

## Trazabilidad de fuentes

Cada reporte distingue:

- **Croma API:** registros estructurados oficiales.
- **Croma Web Search:** resultados de la web pública recuperados por Croma.
- **Croma Research:** investigación ampliada con citas.
- **Fuente pública:** enlaces que requieren validación manual.
- **Validación local:** comprobaciones de formato realizadas por la aplicación.
- **OpenAI:** interpretación adicional aportada por el usuario, separada de Croma.

El mapa de cobertura muestra fuentes consultadas, fuentes disponibles para revisión ampliada y fuentes no aplicables al caso.

## Asistente con OpenAI

OpenAI es opcional y funciona con una clave aportada por cada visitante:

- La clave se conserva únicamente en memoria y desaparece al recargar o cerrar la página.
- Se envía al servidor solo para cada consulta y no se guarda en archivos ni bases de datos.
- El modelo utilizado es `gpt-4.1-mini` con búsqueda web.
- La cuenta de API del visitante asume el costo y necesita facturación activa.
- OpenAI explica e investiga; no genera el reporte estructurado ni confirma identidades.

## Configuración

Copia `.env.example` como `.env.local` y guarda allí una clave de organización de Croma:

```bash
CROMA_API_KEY=tu_clave
```

Opcionalmente protege una vista previa:

```bash
PREVIEW_USER=demo
PREVIEW_PASSWORD=una_clave_segura
CRON_SECRET=un_secreto_aleatorio
```

La aplicación no necesita una clave central de OpenAI porque cada usuario conecta la suya durante la sesión.

## Ejecutar y validar

```bash
npm install
npm run dev
npm run lint
npm run build
```

## Uso responsable

Este producto no acusa, sentencia ni reemplaza una revisión legal, de cumplimiento o crediticia. Resume señales disponibles, identifica límites de cobertura y recomienda verificaciones adicionales. Los resultados web y las respuestas de IA son indicios que deben cotejarse con documentos y fuentes oficiales.
