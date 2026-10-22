import { z } from 'zod/v4'

type SwaggerTransformSchema = {
  body?: unknown
  headers?: unknown
  hide?: boolean
  params?: unknown
  querystring?: unknown
  response?: Record<string, unknown>
  [key: string]: unknown
}

type SwaggerTransformObjectInput = {
  openapiObject: {
    components?: {
      schemas?: Record<string, unknown>
      [key: string]: unknown
    }
    [key: string]: unknown
  }
}

type ZodRegistryJsonSchemaResult = {
  schemas: Record<string, unknown>
}

const defaultSkipList = [
  '/documentation/',
  '/documentation/initOAuth',
  '/documentation/json',
  '/documentation/uiConfig',
  '/documentation/yaml',
  '/documentation/*',
  '/documentation/static/*',
]

function isZodDate(schema: unknown) {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    'constructor' in schema &&
    schema.constructor?.name === 'ZodDate'
  )
}

function stripJsonSchemaInternals<T>(schema: T): T {
  if (typeof schema !== 'object' || schema === null) {
    return schema
  }

  const jsonSchema = { ...(schema as Record<string, unknown>) }

  delete jsonSchema.id
  delete jsonSchema.$id
  delete jsonSchema.$schema

  return jsonSchema as T
}

function zodSchemaToJsonSchema(zodSchema: z.ZodTypeAny, io: 'input' | 'output') {
  const jsonSchema = z.toJSONSchema(zodSchema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
    cycles: 'ref',
    reused: 'inline',
    override: ({ zodSchema, jsonSchema }) => {
      if (io === 'output' && isZodDate(zodSchema)) {
        jsonSchema.type = 'string'
        jsonSchema.format = 'date-time'
      }
    },
  })

  return stripJsonSchemaInternals(jsonSchema)
}

function getSchemaId(id: string, io: 'input' | 'output') {
  return io === 'input' ? `${id}Input` : id
}

function zodRegistryToJsonSchema(
  registry: typeof z.globalRegistry,
  io: 'input' | 'output'
) {
  const result = z.toJSONSchema(registry, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
    cycles: 'ref',
    reused: 'inline',
    uri: (id: string) => `#/components/schemas/${getSchemaId(id, io)}`,
  }) as ZodRegistryJsonSchemaResult

  const schemas: Record<string, unknown> = {}

  for (const id in result.schemas) {
    schemas[getSchemaId(id, io)] = stripJsonSchemaInternals(result.schemas[id])
  }

  return schemas
}

function resolveSchema(maybeSchema: unknown): z.ZodTypeAny {
  if (
    typeof maybeSchema === 'object' &&
    maybeSchema !== null &&
    'safeParse' in maybeSchema
  ) {
    return maybeSchema as z.ZodTypeAny
  }

  if (
    typeof maybeSchema === 'object' &&
    maybeSchema !== null &&
    'properties' in maybeSchema
  ) {
    return (maybeSchema as { properties: z.ZodTypeAny }).properties
  }

  throw new Error(`Invalid schema: ${JSON.stringify(maybeSchema)}`)
}

function isZodSchemaLike(value: unknown): value is z.ZodTypeAny {
  return typeof value === 'object' && value !== null && 'safeParse' in value
}

function isFastifyResponseSchema(value: unknown): value is { properties: z.ZodTypeAny } {
  return typeof value === 'object' && value !== null && 'properties' in value
}

export function swaggerSchemaTransform({
  schema,
  url,
}: {
  schema?: SwaggerTransformSchema
  url: string
}) {
  if (!schema) {
    return { schema, url }
  }

  const { response, headers, querystring, body, params, hide, ...rest } = schema
  const transformed: SwaggerTransformSchema = {}

  if (defaultSkipList.includes(url) || hide) {
    transformed.hide = true
    return { schema: transformed, url }
  }

  const inputs: Record<string, unknown> = { headers, querystring, body, params }

  for (const prop in inputs) {
    const zodSchema = inputs[prop]

    if (zodSchema) {
      transformed[prop] = zodSchemaToJsonSchema(
        zodSchema as z.ZodTypeAny,
        'input'
      )
    }
  }

  if (response && typeof response === 'object') {
    transformed.response = {}

    for (const statusCode in response) {
      const responseSchema = response[statusCode]

      ;(transformed.response as Record<string, unknown>)[statusCode] =
        isZodSchemaLike(responseSchema) || isFastifyResponseSchema(responseSchema)
          ? zodSchemaToJsonSchema(resolveSchema(responseSchema), 'output')
          : responseSchema
    }
  }

  for (const prop in rest) {
    const meta = rest[prop]

    if (meta) {
      transformed[prop] = meta
    }
  }

  return { schema: transformed, url }
}

export function swaggerTransformObject(input: {
  openapiObject: SwaggerTransformObjectInput['openapiObject']
}) {
  const inputSchemas = zodRegistryToJsonSchema(z.globalRegistry, 'input')
  const outputSchemas = zodRegistryToJsonSchema(z.globalRegistry, 'output')

  for (const key in outputSchemas) {
    if (inputSchemas[key]) {
      throw new Error(
        `Collision detected for schema "${key}". There is already an input schema with the same name.`
      )
    }
  }

  return {
    ...input.openapiObject,
    components: {
      ...input.openapiObject.components,
      schemas: {
        ...input.openapiObject.components?.schemas,
        ...inputSchemas,
        ...outputSchemas,
      },
    },
  }
}
