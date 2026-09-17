export function Injectable(): ClassDecorator {
  return () => undefined;
}

export function Controller(path = ""): ClassDecorator {
  return () => undefined;
}

export function Get(path = ""): MethodDecorator {
  return () => undefined;
}

export function Post(path = ""): MethodDecorator {
  return () => undefined;
}

export function Module(_meta: unknown): ClassDecorator {
  return () => undefined;
}
