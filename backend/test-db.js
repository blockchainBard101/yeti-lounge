const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('LATEST POSTS:', JSON.stringify(posts, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
