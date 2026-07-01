import { getSupabase } from "@/lib/db";

export const dynamic = "force-dynamic";

function getSessionUser(req) {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/ops_session=([^;]+)/);
  if (!match) return null;
  try {
    const [data] = match[1].split(".");
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch { return null; }
}

// GET /api/reports/[id] — redirects to a fresh signed URL for the report file.
// Safe to bookmark: re-signs on every request.
export async function GET(req, { params }) {
  const user = getSessionUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from("report_archive")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !row) return Response.json({ error: "Not found" }, { status: 404 });

  // Vendors can only access their own company's reports
  if (user.role === "vendor") {
    if (row.cleaner_company !== user.vendor_company) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Download the file from Storage and proxy it with correct Content-Type.
  // A direct redirect to the signed URL causes browsers to display raw source
  // because Supabase Storage doesn't serve text/html with the charset browsers need.
  const { data: signedData, error: signErr } = await supabase.storage
    .from("cleaner-reports")
    .createSignedUrl(row.file_url, 60);

  if (signErr || !signedData?.signedUrl) {
    return Response.json({ error: "Could not generate download URL" }, { status: 500 });
  }

  const upstream = await fetch(signedData.signedUrl);
  if (!upstream.ok) {
    return Response.json({ error: "Report file not found" }, { status: 404 });
  }

  const html = await upstream.text();
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
