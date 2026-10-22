import { env } from '@myfinances/env'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSignedUrl = vi.fn()
const send = vi.fn()

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrl(...args),
}))

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>()
  return { ...actual, S3Client: class { send = send } }
})

const { deleteFile, getSignedFileUrl, payslipKey, putFile, MAX_PAYSLIP_BYTES } =
  await import('./storage')

/** Input do GetObjectCommand passado ao presigner na última chamada. */
function signedInput() {
  return getSignedUrl.mock.calls[0][1].input as Record<string, unknown>
}

describe('storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSignedUrl.mockResolvedValue('https://signed.example/objeto')
  })

  it('limits payslips to 5 MiB', () => {
    expect(MAX_PAYSLIP_BYTES).toBe(5 * 1024 * 1024)
  })

  describe('payslipKey', () => {
    it('starts with the user id and ends in .pdf', () => {
      expect(payslipKey('user-1')).toMatch(/^user-1\/payslips\/[0-9a-f-]{36}\.pdf$/)
    })

    it('is unique per call', () => {
      expect(payslipKey('user-1')).not.toBe(payslipKey('user-1'))
    })
  })

  describe('putFile', () => {
    it('uploads the body with its content type', async () => {
      send.mockResolvedValue({})
      await putFile('u/payslips/a.pdf', Buffer.from('x'), 'application/pdf')

      const command = send.mock.calls[0][0]
      expect(command.input).toMatchObject({
        Bucket: env.S3_BUCKET,
        Key: 'u/payslips/a.pdf',
        ContentType: 'application/pdf',
      })
    })
  })

  describe('getSignedFileUrl', () => {
    it('signs a 900 s GET forcing the pdf type', async () => {
      const url = await getSignedFileUrl('u/payslips/a.pdf', 'holerite.pdf')

      expect(url).toBe('https://signed.example/objeto')
      expect(getSignedUrl.mock.calls[0][2]).toEqual({ expiresIn: 900 })
      expect(signedInput()).toMatchObject({
        Key: 'u/payslips/a.pdf',
        ResponseContentType: 'application/pdf',
      })
    })

    it('strips quotes, backslashes and line breaks from the download name', async () => {
      await getSignedFileUrl('k', 'ho"le\\rite\r\nX-Evil: 1\x00.pdf')

      const disposition = signedInput().ResponseContentDisposition as string
      expect(disposition).toMatch(/^attachment; filename="[^"\\\r\n]*"; /)
      expect(disposition).not.toMatch(/[\r\n\x00\\]/)
      expect(disposition).toContain('filename="holeriteX-Evil: 1.pdf"')
    })

    it('falls back to holerite.pdf when nothing is left', async () => {
      await getSignedFileUrl('k', '"\r\n"')

      expect(signedInput().ResponseContentDisposition).toContain(
        'filename="holerite.pdf"',
      )
    })

    it('keeps the quoted filename ASCII-only', async () => {
      await getSignedFileUrl('k', 'Holerite março.pdf')

      expect(signedInput().ResponseContentDisposition).toContain(
        'filename="Holerite mar_o.pdf"',
      )
    })

    it('does not throw on lone surrogates', async () => {
      await expect(getSignedFileUrl('k', 'a\ud800b.pdf')).resolves.toBeTruthy()
      expect(signedInput().ResponseContentDisposition).toContain('%EF%BF%BD')
    })

    it('sends an RFC 5987 name so accents survive', async () => {
      await getSignedFileUrl('k', 'Holerite março.pdf')

      expect(signedInput().ResponseContentDisposition).toContain(
        "filename*=UTF-8''Holerite%20mar%C3%A7o.pdf",
      )
    })
  })

  describe('deleteFile', () => {
    it('deletes the key', async () => {
      send.mockResolvedValue({})
      await deleteFile('u/payslips/a.pdf')

      expect(send.mock.calls[0][0].input).toMatchObject({
        Bucket: env.S3_BUCKET,
        Key: 'u/payslips/a.pdf',
      })
    })

    it('does not throw when the SDK fails, and reports it', async () => {
      const failure = new Error('boom')
      send.mockRejectedValue(failure)
      const onError = vi.fn()

      await expect(deleteFile('k', onError)).resolves.toBeUndefined()
      expect(onError).toHaveBeenCalledWith('k', failure)
    })

    it('logs the key and message by default, and does not throw', async () => {
      send.mockRejectedValue(new Error('boom'))
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(deleteFile('k')).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('k'), 'boom')
      spy.mockRestore()
    })
  })
})
