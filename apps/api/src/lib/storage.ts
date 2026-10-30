import { randomUUID } from 'node:crypto'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '@myfinances/env'

import { PAYSLIP_CONTENT_TYPES, type PayslipFileType } from './payslip/file-type'
import { toAccountEndpoint } from './s3-endpoint'

export const MAX_PAYSLIP_BYTES = 5 * 1024 * 1024

const READ_EXPIRES_SECONDS = 900

/** A extensão da chave foi posta por `payslipKey`; as chaves antigas são todas .pdf. */
function fileTypeOfKey(key: string): PayslipFileType {
  return key.endsWith('.png') ? 'png' : 'pdf'
}

const client = new S3Client({
  region: env.S3_REGION,
  endpoint: toAccountEndpoint(env.S3_ENDPOINT, env.S3_BUCKET),
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
})

/**
 * A chave é montada aqui, nunca aceita do cliente: o prefixo vem do usuário
 * autenticado e o nome é um UUID, então nada do que o cliente mandou entra nela.
 */
export function payslipKey(userId: string, type: PayslipFileType = 'pdf') {
  return `${userId}/payslips/${randomUUID()}.${type}`
}

export async function putFile(
  key: string,
  body: Buffer,
  contentType: (typeof PAYSLIP_CONTENT_TYPES)[PayslipFileType],
) {
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

export async function getFile(key: string) {
  const { Body } = await client.send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  )
  if (!Body) throw new Error(`O bucket devolveu ${key} sem conteúdo`)
  return Buffer.from(await Body.transformToByteArray())
}

/**
 * Tira o que quebraria o cabeçalho (aspas, barra invertida, CR/LF e demais
 * caracteres de controle). Sem nada sobrando, cai num nome fixo.
 */
function sanitizeDownloadName(name: string, type: PayslipFileType) {
  const cleaned = name
    .toWellFormed()
    // biome-ignore lint/suspicious/noControlCharactersInRegex: tirar os caracteres de controle é o objetivo.
    .replace(/["\\\u0000-\u001f\u007f]/g, '')
    .trim()
  return cleaned || `holerite.${type}`
}

export async function getSignedFileUrl(key: string, downloadName: string) {
  const type = fileTypeOfKey(key)
  const safeName = sanitizeDownloadName(downloadName, type)
  // O `filename` entre aspas só carrega ASCII; o nome real vai em `filename*`.
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, '_')
  // `filename*` (RFC 5987) leva o nome em UTF-8 para os acentos sobreviverem;
  // `filename` fica como alternativa para clientes que não o entendem.
  const encodedName = encodeURIComponent(safeName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      // Forçar o tipo na resposta impede que o arquivo volte como outra coisa.
      ResponseContentType: PAYSLIP_CONTENT_TYPES[type],
      ResponseContentDisposition: `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    }),
    { expiresIn: READ_EXPIRES_SECONDS },
  )
}

function defaultDeleteErrorLog(key: string, error: unknown) {
  // Só a chave e a mensagem: nunca o objeto de erro inteiro, que pode carregar
  // configuração do cliente.
  console.error(
    `Falha ao apagar ${key} do bucket:`,
    error instanceof Error ? error.message : String(error),
  )
}

/**
 * Uma falha aqui não derruba a resposta: o banco já mudou, e um objeto órfão
 * no bucket é um estrago menor do que um erro que o operador não sabe resolver.
 * Ela vai para `onError` para alguém varrer depois.
 */
export async function deleteFile(
  key: string,
  onError: (key: string, error: unknown) => void = defaultDeleteErrorLog,
) {
  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    )
  } catch (error) {
    onError(key, error)
  }
}
