export const dynamic = "force-dynamic";

export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": "ops_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
    },
  });
}
