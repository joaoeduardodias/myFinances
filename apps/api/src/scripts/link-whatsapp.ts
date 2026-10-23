import { prisma } from '@/lib/prisma'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function main() {
  const [email, rawPhone] = process.argv.slice(2)
  if (!email || !rawPhone) {
    fail('Uso: pnpm whatsapp:link <email> <telefone>  (ex.: voce@exemplo.com 5511999999999)')
  }
  const phone = rawPhone.replace(/\D/g, '')
  if (phone.length < 10) fail(`Telefone inválido: ${rawPhone}`)

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!user) fail(`Usuário não encontrado: ${email}`)

  try {
    await prisma.user.update({ where: { id: user.id }, data: { whatsappPhone: phone } })
  } catch (error) {
    fail(`Falha ao gravar o telefone (já em uso por outro usuário?): ${(error as Error).message}`)
  }
  console.log(`WhatsApp ${phone} ligado a ${email}.`)
  process.exit(0)
}

main().catch((error) => fail(String(error)))
