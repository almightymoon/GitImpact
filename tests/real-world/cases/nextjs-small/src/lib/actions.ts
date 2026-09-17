"use server";

import { hashPassword } from "@/lib/auth";

export async function createAccount(password: string) {
  return hashPassword(password);
}
