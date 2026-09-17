import { authenticate } from "../../../lib/auth";

export async function POST() {
  return Response.json(authenticate("a@b.com", "x"));
}
