import { verifySession } from "@/lib/auth";
import { listUsers } from "@/lib/users";

export async function GET(request: Request) {
  const token = request.headers.get("authorization") ?? "";
  if (!(await verifySession(token))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const users = await listUsers();
  return Response.json({ users });
}
