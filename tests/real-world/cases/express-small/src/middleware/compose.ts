export type Next = () => void | Promise<void>;

export type Handler = (
  req: { headers: Record<string, string>; body?: unknown },
  res: { status: (code: number) => { json: (body: unknown) => void } },
  next: Next,
) => void | Promise<void>;

export function compose(...middleware: Handler[]): Handler {
  return async (req, res, next) => {
    let index = -1;
    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) throw new Error("next() called multiple times");
      index = i;
      const fn = middleware[i];
      if (!fn) return next();
      await fn(req, res, () => dispatch(i + 1));
    };
    await dispatch(0);
  };
}
