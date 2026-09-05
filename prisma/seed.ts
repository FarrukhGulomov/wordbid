/**
 * DEVELOPMENT SEED — obviously fake sample data so the leaderboard is not empty locally.
 *
 * Never run this against production. It refuses to run when NODE_ENV=production, and every
 * brand it creates uses an example.com destination so it cannot be mistaken for real traffic.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SAMPLE = [
  { word: 'ai', display: 'AI', brand: 'AcmeAI', amount: 482000 },
  { word: 'video', display: 'VIDEO', brand: 'VideoX', amount: 321000 },
  { word: 'coding', display: 'CODING', brand: 'DevX', amount: 285000 },
  { word: 'design', display: 'DESIGN', brand: 'Pixelry', amount: 140000 },
  { word: 'coffee', display: 'COFFEE', brand: 'BeanCo', amount: 52000 },
  { word: 'robot', display: 'ROBOT', brand: 'RoboWorks', amount: 1000 },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed sample data in production.');
  }

  for (const [index, sample] of SAMPLE.entries()) {
    const word = await prisma.word.upsert({
      where: { normalized: sample.word },
      update: {},
      create: { normalized: sample.word, display: sample.display },
    });
    if (word.currentOwnershipId) continue;

    const domain = `${sample.brand.toLowerCase()}.example.com`;
    const owner = await prisma.owner.create({
      data: {
        domain,
        name: sample.brand,
        url: `https://${domain}`,
        description: `Sample brand for local development.`,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        amountCents: sample.amount,
        status: 'CONFIRMED',
        provider: 'seed',
        providerReference: `seed_${sample.word}`,
        wordId: word.id,
        ownerId: owner.id,
        confirmedAt: new Date(Date.now() - index * 60_000),
      },
    });
    const startedAt = new Date(Date.now() - index * 60_000);
    const ownership = await prisma.ownership.create({
      data: {
        wordId: word.id,
        ownerId: owner.id,
        amountCents: sample.amount,
        paymentId: payment.id,
        startedAt,
      },
    });
    await prisma.word.update({
      where: { id: word.id },
      data: { valueCents: sample.amount, currentOwnershipId: ownership.id, ownedSince: startedAt },
    });
    await prisma.activity.create({
      data: {
        type: 'CLAIMED',
        wordId: word.id,
        ownerId: owner.id,
        amountCents: sample.amount,
        createdAt: startedAt,
      },
    });
  }

  console.log(`Seeded ${SAMPLE.length} sample words. This is development data only.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
