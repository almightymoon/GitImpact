export class AuthService {
  generateToken(payload: string) {
    const secret = "new-secret";
    return sign(payload, secret);
  }
}

function sign(payload: string, secret: string) {
  return `${payload}:${secret}`;
}
