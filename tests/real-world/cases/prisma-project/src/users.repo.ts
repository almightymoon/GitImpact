import { PrismaClient } from "./generated-client";

const prisma = new PrismaClient();

export async function listUsers() {
  return prisma.user.findMany();
}

export async function getUser(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export async function createUser(email: string) {
  return prisma.user.create({ data: { email } });
}

export async function loadUsersDynamic() {
  const mod = await import("./generated-client");
  const client = new mod.PrismaClient();
  return client.user.findMany();
}
