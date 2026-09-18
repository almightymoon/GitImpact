export async function loadProfile(userId: string) {
  const response = await fetch(`https://api.example.com/users/${userId}`);
  return response.json();
}

export async function ping() {
  return fetch("https://api.example.com/health");
}
