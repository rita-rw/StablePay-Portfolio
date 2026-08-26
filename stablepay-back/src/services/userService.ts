import { prisma } from "../prisma";
import { privateUserProfileSelect, publicUserProfileSelect } from "./viewSelects";

export async function findUser(address: string) {
  return prisma.user.findFirst({ where: { address: { equals: address, mode: "insensitive" } } });
}

export async function findPublicUserProfile(address: string) {
  return prisma.user.findFirst({ where: { address: { equals: address, mode: "insensitive" } }, select: publicUserProfileSelect });
}

export async function findPrivateUserProfile(address: string) {
  return prisma.user.findFirst({ where: { address: { equals: address, mode: "insensitive" } }, select: privateUserProfileSelect });
}

export async function createUser(data: {
  address: string;
  companyName: string;
  orgNumber: string;
  email: string;
  termsAcceptedAt: Date;
  paymentTermsAcceptedAt: Date;
}) {
  return prisma.user.create({ data });
}

export async function updateUser(address: string, data: { companyName: string; orgNumber: string; email: string }) {
  return prisma.user.update({ where: { address }, data });
}

export async function lookupCompanies(addresses: string[]): Promise<Record<string, string | null>> {
  if (addresses.length === 0) return {};
  const users = await prisma.user.findMany({
    where: { OR: addresses.map((addr) => ({ address: { equals: addr, mode: "insensitive" } })) },
    select: { address: true, companyName: true },
  });
  return Object.fromEntries(users.map((u) => [u.address.toLowerCase(), u.companyName]));
}
