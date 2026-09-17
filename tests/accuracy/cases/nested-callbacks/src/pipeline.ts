export function transform(value: string): string {
  return value.toUpperCase();
}

export function processItems(items: string[]): string[] {
  return items.map((item) => transform(item));
}

export function runPipeline(items: string[]): string[] {
  return processItems(items).filter((item) => item.length > 0);
}
