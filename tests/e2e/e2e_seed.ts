import { prisma } from '../src/utils/prisma';
import { generateAccessToken } from '../src/utils/jwt';
async function main() {
  const mk = async (email: string, name: string) => prisma.user.create({ data: { email, name, password: 'x', isVerified: true, personalId: 'PI-' + name } as never });
  const buyer = await mk('buyer-e2e@example.com', 'Amos'); const seller = await mk('seller-e2e@example.com', 'Sam');
  const prop = await prisma.category.create({ data: { name: 'Property', slug: 'property', icon: '🏠' } });
  const land = await prisma.category.create({ data: { name: 'Land & Plots', slug: 'land-plots', parentId: prop.id } });
  await prisma.savedSearch.create({ data: { userId: buyer.id, name: 'Land under 5M', filters: { category: 'land-plots', priceMax: '5000000' }, categorySlug: 'land-plots', emailAlert: true, notifyEmail: false, notifySound: true } });
  const token = generateAccessToken({ userId: buyer.id, email: buyer.email, role: 'BUYER' });
  console.log(JSON.stringify({ token, sellerId: seller.id, landId: land.id }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
