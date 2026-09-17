/** Minimal stand-in for a generated Prisma client */
export class PrismaClient {
  user = {
    findMany: async () => [{ id: "1", email: "a@b.co" }],
    findUnique: async (args: { where: { id: string } }) => ({
      id: args.where.id,
      email: "a@b.co",
    }),
    create: async (args: { data: { email: string } }) => ({
      id: "2",
      email: args.data.email,
    }),
  };
}
