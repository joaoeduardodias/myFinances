/**
 * zodResolver compatible with Zod v4.
 *
 * @hookform/resolvers@3.x checks `error.errors` (Zod v3 API).
 * Zod v4 renamed that property to `error.issues`.
 * This thin wrapper normalises the error shape so forms work with Zod v4.
 */
import { toNestErrors, validateFieldsNatively } from '@hookform/resolvers'
import type {
  FieldError,
  FieldValues,
  ResolverOptions,
  ResolverResult,
} from 'react-hook-form'
import { appendErrors } from 'react-hook-form'
import type { ZodIssue, ZodType } from 'zod'

function parseIssues(
  issues: ZodIssue[],
  validateAll: boolean,
): Record<string, FieldError> {
  const errors: Record<string, FieldError> = {}
  for (const issue of issues) {
    const path = issue.path.join('.')
    if (!errors[path]) {
      errors[path] = { message: issue.message, type: issue.code }
    }
    if (validateAll) {
      errors[path] = appendErrors(
        path,
        validateAll,
        errors,
        issue.code,
        issue.message,
      ) as FieldError
    }
  }
  return errors
}

export function zodResolver<T extends ZodType>(schema: T) {
  return async <TFieldValues extends FieldValues, TContext>(
    values: TFieldValues,
    _context: TContext | undefined,
    options: ResolverOptions<TFieldValues>,
  ): Promise<ResolverResult<TFieldValues>> => {
    try {
      const data = await schema.parseAsync(values)
      if (options.shouldUseNativeValidation) {
        validateFieldsNatively({}, options)
      }
      return { values: data as TFieldValues, errors: {} }
    } catch (error: unknown) {
      const err = error as Record<string, unknown>
      const issues: ZodIssue[] | null = Array.isArray(err?.issues)
        ? (err.issues as ZodIssue[])
        : Array.isArray(err?.errors)
          ? (err.errors as ZodIssue[])
          : null

      if (issues) {
        const validateAll =
          !options.shouldUseNativeValidation && options.criteriaMode === 'all'
        return {
          values: {} as Record<string, never>,
          errors: toNestErrors(parseIssues(issues, validateAll), options),
        } as ResolverResult<TFieldValues>
      }
      throw error
    }
  }
}
