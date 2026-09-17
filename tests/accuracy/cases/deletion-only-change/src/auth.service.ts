export class AuthService {
  generateToken(payload: string) {
    return sign(payload, "secret");
  }

  refresh(payload: string) {
    return sign(payload, "refresh");
  }
}

function sign(payload: string, secret: string) {
  return `${payload}:${secret}`;
}
