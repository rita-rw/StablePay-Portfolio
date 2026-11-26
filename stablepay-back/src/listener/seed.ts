import { getAddress } from "viem";
import { prisma } from "../prisma";
import { sendNotification } from "../mailer";
import { escrowReadAbi } from "../abi/StablePayEscrow.read.abi";
import { factoryReadAbi } from "../abi/EscrowFactory.read.abi";
import { milestoneLabelAt, parseMilestoneLabels } from "../services/escrowService";
import { MILESTONE_STATUS_MAP, backfillClient, client, knownEscrows } from "./chain";

export type EscrowCreatedArgs = {
  escrow: `0x${string}`;
  buyer: `0x${string}`;
  seller: `0x${string}`;
  token: `0x${string}`;
  totalAmount: bigint;
  milestoneCount: bigint;
  metadataHash: `0x${string}`;
};

type SeedFromCreationLogOptions = {
  claimMetadata: boolean;
  notify: boolean;
  context: string;
  milestoneReadClient: typeof client;
};

async function getMetadataForHash(metadataHash: `0x${string}`, claimMetadata: boolean) {
  if (claimMetadata) {
    try {
      const meta = await prisma.projectMetadata.delete({ where: { metadataHash } });
      return {
        title: meta.title,
        description: meta.description,
        milestoneLabels: parseMilestoneLabels(meta.milestoneLabels),
      };
    } catch {
      return { title: null, description: null, milestoneLabels: [] as string[] };
    }
  }

  const meta = await prisma.projectMetadata.findUnique({ where: { metadataHash } });
  return {
    title: meta?.title ?? null,
    description: meta?.description ?? null,
    milestoneLabels: parseMilestoneLabels(meta?.milestoneLabels),
  };
}

async function seedEscrowFromCreationLog(
  log: { args: EscrowCreatedArgs; transactionHash: `0x${string}` | null | undefined },
  options: SeedFromCreationLogOptions,
) {
  const { args } = log;
  knownEscrows.add(args.escrow.toLowerCase());

  try {
    const { title, description, milestoneLabels } = await getMetadataForHash(args.metadataHash, options.claimMetadata);

    await prisma.escrow.upsert({
      where: { id: args.escrow },
      create: {
        id: args.escrow,
        buyer: args.buyer,
        seller: args.seller,
        token: args.token,
        totalAmount: args.totalAmount.toString(),
        milestoneCount: Number(args.milestoneCount),
        metadataHash: args.metadataHash,
        title,
        description,
        txHash: log.transactionHash ?? null,
      },
      update: {
        txHash: log.transactionHash ?? undefined,
        title: title ?? undefined,
        description: description ?? undefined,
      },
    });

    for (let i = 0; i < Number(args.milestoneCount); i++) {
      try {
        const result = await options.milestoneReadClient.readContract({
          address: args.escrow,
          abi: escrowReadAbi,
          functionName: "milestones",
          args: [BigInt(i)],
        });

        const label = milestoneLabelAt(milestoneLabels, i);
        await prisma.milestone.upsert({
          where: { escrowAddress_milestoneIndex: { escrowAddress: args.escrow, milestoneIndex: i } },
          create: {
            escrowAddress: args.escrow,
            milestoneIndex: i,
            amount: result[0].toString(),
            status: MILESTONE_STATUS_MAP[Number(result[1])] ?? "PENDING",
            ...(label ? { label } : {}),
          },
          update: {
            amount: result[0].toString(),
            status: MILESTONE_STATUS_MAP[Number(result[1])] ?? "PENDING",
            ...(label ? { label } : {}),
          },
        });
      } catch (err) {
        console.error(`[${options.context}] milestone ${i} for ${args.escrow} failed`, err);
      }
    }

    if (options.notify) {
      void sendNotification("PROJECT_ASSIGNED", args.escrow);
    }
  } catch (err) {
    console.error(`[${options.context}] failed to seed ${args.escrow}`, err);
  }
}

export async function seedMissingEscrowFromChain(
  factoryAddress: `0x${string}`,
  escrowAddress: `0x${string}`,
) {
  const isValid = await backfillClient.readContract({
    address: factoryAddress,
    abi: factoryReadAbi,
    functionName: "isValidEscrow",
    args: [escrowAddress],
  }) as boolean;

  if (!isValid) {
    console.log(`[sync] escrow ${escrowAddress} is not registered in the factory`);
    return false;
  }

  // Read the same fields the EscrowCreated event carries straight from the
  // contract — the event itself would need eth_getLogs over the factory's whole
  // history, which the public RPC no longer allows (200-block cap).
  const [buyer, seller, token, totalAmount, milestoneCount, metadataHash] = await Promise.all([
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "BUYER" }),
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "SELLER" }),
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "TOKEN" }),
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "totalAmount" }),
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "milestoneCount" }),
    backfillClient.readContract({ address: escrowAddress, abi: escrowReadAbi, functionName: "METADATA_HASH" }),
  ]);

  await seedEscrowFromCreationLog(
    {
      args: {
        escrow: escrowAddress,
        buyer: getAddress(buyer as string),
        seller: getAddress(seller as string),
        token: getAddress(token as string),
        totalAmount: totalAmount as bigint,
        milestoneCount: milestoneCount as bigint,
        metadataHash: metadataHash as `0x${string}`,
      },
      // The creation tx hash only exists in the event; the receipt page hides the link without it.
      transactionHash: null,
    },
    {
      claimMetadata: false,
      notify: false,
      context: "self-heal",
      milestoneReadClient: backfillClient,
    },
  );
  console.log(`[sync] seeded escrow from direct chain reads: ${escrowAddress}`);
  return true;
}
