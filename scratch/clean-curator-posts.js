const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const CURATOR_ADDRESS = '0x0000000000000000000000000000000000000000000000000000000000000c01';
  
  console.log('Cleaning posts authored by curator...');
  const result = await prisma.post.deleteMany({
    where: {
      authorAddress: CURATOR_ADDRESS,
    },
  });
  
  console.log(`Deleted ${result.count} post(s) authored by the curator.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
