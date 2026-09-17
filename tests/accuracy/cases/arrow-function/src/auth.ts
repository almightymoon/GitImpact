export const sign = (payload: string, secret: string): string =>
  `${payload}:${secret}`;

export const authenticate = (user: string): string => sign(user, "secret");

export const login = (user: string): string => authenticate(user);
