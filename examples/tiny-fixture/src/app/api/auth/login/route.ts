import { authenticate, register } from "../../../auth.service";

export async function POST(request: Request) {
  const body = (await request.json()) as { email: string; password: string };
  return Response.json(authenticate(body.email, body.password));
}

export async function PUT(request: Request) {
  const body = (await request.json()) as { email: string };
  return Response.json(register(body.email));
}
