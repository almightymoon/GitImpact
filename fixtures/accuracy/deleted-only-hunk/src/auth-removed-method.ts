export class AuthService {
  refresh(payload: string) {
    return sign(payload, "refresh");
  }
}

function sign(payload: string, secret: string) {
  return `${payload}:${secret}`;
}
