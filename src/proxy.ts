import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  if ([
    "/pitch-deck-conoce-contraparte-latam.pptx",
    "/source-repo.zip",
  ].includes(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const previewUser = process.env.PREVIEW_USER;
  const previewPassword = process.env.PREVIEW_PASSWORD;

  if (!previewUser || !previewPassword) return NextResponse.next();

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    const encoded = authorization.slice(6);
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);

    if (user === previewUser && password === previewPassword) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Acceso protegido", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Vista previa GovTech"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|pitch-deck-conoce-contraparte-latam.pptx|source-repo.zip).*)"],
};
