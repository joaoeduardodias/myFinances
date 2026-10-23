import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'

import { NativeSelect } from '@/components/native-select'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getApiErrorMessage } from '@/http/get-api-error-message'
import {
  DuplicatePayslipError,
  PAYSLIP_TYPE_LABELS,
  type PayslipType,
  type UploadPayslipInput,
  uploadPayslip,
} from '@/http/payslips'
import { zodResolver } from '@/lib/zod-resolver'

const MAX_BYTES = 5 * 1024 * 1024

const isPdf = (file: File) =>
  file.type === 'application/pdf' && file.name.toLowerCase().endsWith('.pdf')

const schema = z.object({
  file: z
    .custom<FileList>()
    .refine((files) => files?.length > 0, {
      message: 'Selecione o arquivo PDF',
    })
    .refine((files) => !files?.[0] || isPdf(files[0]), {
      message: 'O arquivo precisa ser um PDF',
    })
    .refine((files) => !files?.[0] || files[0].size <= MAX_BYTES, {
      message: 'O arquivo excede o limite de 5 MB',
    }),
  competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'Informe a competência',
  }),
  type: z.enum(['MONTHLY', 'ADVANCE', 'THIRTEENTH', 'VACATION']),
})

type FormData = z.infer<typeof schema>

export function PayslipUploadDialog() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { competence: '', type: 'MONTHLY' },
  })

  const upload = useMutation({
    mutationFn: (input: UploadPayslipInput) => uploadPayslip(input),
    onSuccess: async (payslip) => {
      await queryClient.invalidateQueries({ queryKey: ['payslips'] })
      reset()
      setOpen(false)
      navigate(`/holerites/${payslip.id}`)
    },
    onError: async (error) => {
      if (error instanceof DuplicatePayslipError) {
        setOpen(false)
        toast.error('Este arquivo já foi enviado')
        navigate(`/holerites/${error.payslipId}`)
        return
      }
      toast.error(
        await getApiErrorMessage(
          error,
          'Não foi possível enviar o holerite. Tente novamente.',
        ),
      )
    },
  })

  function onSubmit(data: FormData) {
    upload.mutate({
      competence: data.competence,
      type: data.type,
      file: data.file[0],
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Upload aria-hidden />
          Enviar holerite
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar holerite</DialogTitle>
          <DialogDescription>
            Envie o PDF do holerite (até 5 MB).
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payslip-file">Arquivo (PDF)</Label>
            <Input
              id="payslip-file"
              type="file"
              accept="application/pdf"
              {...register('file')}
            />
            {errors.file && (
              <p role="alert" className="text-destructive text-sm">
                {errors.file.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payslip-competence">Competência</Label>
            <Input
              id="payslip-competence"
              type="month"
              {...register('competence')}
            />
            {errors.competence && (
              <p role="alert" className="text-destructive text-sm">
                {errors.competence.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payslip-type">Tipo</Label>
            <NativeSelect id="payslip-type" {...register('type')}>
              {(Object.keys(PAYSLIP_TYPE_LABELS) as PayslipType[]).map((t) => (
                <option key={t} value={t}>
                  {PAYSLIP_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={upload.isPending}>
              Enviar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
