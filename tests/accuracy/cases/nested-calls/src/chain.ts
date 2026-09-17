export function leaf() {
  return 1;
}

export function middle() {
  return leaf() + leaf();
}

export function top() {
  return middle();
}
